import * as THREE from 'three/webgpu';
import { daylightFromBrightness, isManualOverride } from '../state/worldState.js';
import { Fn, Loop, float, vec2, vec3, texture, instancedArray, instanceIndex, dot, pow } from 'three/tsl';

/**
 * De webcam als sensor:
 *
 * 1. Handtracking: MediaPipe Hand Landmarker (Google, zonder ml5) in een Web Worker
 *    (handWorker.js), zodat de wei vlot blijft. Herkent alleen handen, geen hoofd of lichaam.
 *    Het midden van je handpalm stuurt een Pointer met een groot aanraakgebied
 *    (FlowerPhysics) en een cirkel op het scherm.
 * 2. Lichtmeter op de GPU (compute shaders in TSL): de gemiddelde helderheid van het
 *    camerabeeld stuurt dag en nacht (donkere kamer = nacht).
 */

// Lichtmeter: het camerabeeld als rooster van vakjes, per vakje de helderheid
const GRID_W = 64;
const GRID_H = 48;
const CELLS = GRID_W * GRID_H;
const BRIGHTNESS_EVERY = 6; // niet elk camerabeeld meten: licht verandert traag

// Hand
// Eén detectie duurt ±80–160 ms, dus ±6–11 per seconde. Meer workers (om beurten een camerabeeld)
// geven meer detecties, maar in de praktijk was dat glitchy: elke worker volgt de hand apart en ze
// zijn het net niet eens (zigzag), en ze vechten met de wei om de processor. Daarom: één worker,
// en tussen twee detecties voorspellen waar de hand nu is (PREDICT_MAX).
const HAND_WORKERS = 1;
const REACH = 1.2; // handbeweging uitvergroten: randen halen zonder je hand uit beeld te bewegen
const FOLLOW_SPEED = 14; // afvlakken van het schokken (hoger = sneller, maar onrustiger)
const LOST_AFTER = 500; // ms zonder hand: hand-aanwijzer laat los (ruim boven één trage detectie)
// Voorspellen: een detectie toont de hand zoals ze was toen het camerabeeld genomen werd (±160 ms
// geleden). Met de snelheid tussen de laatste detecties schuiven we ze door naar "nu".
const PREDICT_MAX = 0.2; // nooit verder dan 0,2 s vooruit voorspellen (anders schiet ze door bij stoppen)
const VELOCITY_SMOOTHING = 0.5; // nieuwe snelheid half meetellen: minder schokken door meetruis

// Luma: hoe helder een kleur lijkt (groen weegt het zwaarst voor het oog)
const LUMA = vec3(0.2126, 0.7152, 0.0722);

export class CameraVision {
  constructor(renderer, handPointer, perf) {
    this.renderer = renderer;
    this.handPointer = handPointer;
    this.perf = perf; // prestatiemeter (?debug): detecties per seconde en ms per detectie
    this.running = false;

    this.handTarget = { x: 0, y: 0 }; // laatst gevonden handpositie (NDC)
    this.handVelocity = { x: 0, y: 0 }; // snelheid van de hand (NDC per seconde), voor het voorspellen
    this.handTime = 0; // wanneer het camerabeeld van de laatste detectie genomen werd (ms)
    this.handSmoothed = { x: 0, y: 0 }; // afgevlakte positie (NDC)
    this.handLastSeen = 0;
    this.hasHand = false;
    this.indicator = document.getElementById('hand-indicator');

    // Handherkenning: { worker, ready, busy } per worker. busy = nog bezig met een camerabeeld
    this.workers = [];
    this.workerReady = false; // minstens één worker klaar
    this.workerErrors = 0;
    this.sendingFrame = false; // camerabeeld wordt net verkleind
    this.lastHandTimestamp = 0; // nieuwste verwerkte beeld: oudere resultaten negeren

    this.newFrame = false;
    this.framesSinceBrightness = 0;
    this.readPending = false;
    this.exposureLocked = false;
    this.brightness = null; // laatste lichtmeting (0..1), null = nog geen meting

    this.video = document.getElementById('camera-video');
    this.button = document.getElementById('camera-button');
    this.status = document.getElementById('camera-status');
    this.button.addEventListener('click', () => (this.running ? this.stop() : this.start()));

    this.createLightMeter();
  }

  /** Knop tonen (na het startscherm) */
  show() {
    this.button.hidden = false;
  }

  // --- Lichtmeter op de GPU ---

  createLightMeter() {
    // Camerabeeld als textuur. sRGB (vereist door Three.js): de GPU leest lineaire kleuren,
    // die rekenen we hieronder terug naar waargenomen helderheid.
    this.videoTexture = new THREE.VideoTexture(this.video);
    this.videoTexture.colorSpace = THREE.SRGBColorSpace;
    const videoTex = texture(this.videoTexture);

    this.lumaBuffer = instancedArray(CELLS, 'float'); // helderheid per vakje
    this.brightnessBuffer = instancedArray(1, 'float'); // gemiddelde
    const lumaBuffer = this.lumaBuffer;

    // Compute 1: per vakje de helderheid (één thread per vakje)
    const lumaCompute = Fn(() => {
      const i = instanceIndex;
      const uv = vec2(float(i.mod(GRID_W)).add(0.5).div(GRID_W), float(i.div(GRID_W)).add(0.5).div(GRID_H));
      const rgb = videoTex.sample(uv).level(0).rgb;
      // Lineaire helderheid → waargenomen helderheid (zoals het oog)
      lumaBuffer.element(i).assign(pow(dot(rgb, LUMA), 1 / 2.2));
    })().compute(CELLS);

    // Compute 2: gemiddelde van alle vakjes (één thread telt alles op)
    const averageCompute = Fn(() => {
      const sum = float(0).toVar();
      Loop(CELLS, ({ i }) => {
        sum.addAssign(lumaBuffer.element(i));
      });
      this.brightnessBuffer.element(0).assign(sum.div(CELLS));
    })().compute(1);

    this.lightComputes = [lumaCompute, averageCompute];
  }

  // --- Webcam ---

  async start() {
    this.button.disabled = true;
    try {
      this.setStatus('Camera starten…');
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: 640, height: 480, facingMode: 'user' },
        audio: false,
      });
      this.video.srcObject = stream;
      await this.video.play();

      this.running = true;
      this.watchFrames();
      this.video.classList.add('visible');
      this.button.textContent = '📷 Camera uit';

      this.startHandTracking();
      this.exposureLocked = await lockExposure(stream.getVideoTracks()[0]);
    } catch (error) {
      console.warn('Camera niet beschikbaar:', error);
      this.stopStream();
      this.setStatus('Geen camera: de muis en de pijltjes werken gewoon verder');
    }
    this.button.disabled = false;
  }

  stop() {
    this.running = false;
    this.stopStream();
    this.brightness = null;
    this.loseHand();
    this.button.textContent = '📷 Camera aan';
    this.setStatus('');
  }

  /** Bij elk nieuw camerabeeld (±30 per seconde): lichtmeter en handherkenning bijwerken */
  watchFrames() {
    const onFrame = () => {
      if (!this.running) return;
      this.newFrame = true;
      this.sendFrameToWorker();
      this.video.requestVideoFrameCallback(onFrame);
    };
    this.video.requestVideoFrameCallback(onFrame);
  }

  // --- Handtracking (MediaPipe in een Web Worker) ---

  /** Workers één keer aanmaken en het handmodel laden (de eerste keer ±20 MB, daarna uit de cache) */
  startHandTracking() {
    if (this.workers.length) return;
    this.setStatus('Handmodel laden…');
    for (let n = 0; n < HAND_WORKERS; n++) {
      const entry = { worker: new Worker(new URL('./handWorker.js', import.meta.url), { type: 'module' }), ready: false, busy: false };
      entry.worker.onmessage = ({ data }) => this.onWorkerMessage(entry, data);
      // CPU eerst: dan blijft de GPU helemaal voor de wei (gemeten: GPU liet de wei zakken)
      entry.worker.postMessage({ type: 'init', delegates: ['CPU', 'GPU'] });
      this.workers.push(entry);
    }
  }

  onWorkerMessage(entry, data) {
    if (data.type === 'ready') {
      entry.ready = true;
      if (!this.workerReady && this.running) this.setStatus('Hou je hand voor de camera');
      this.workerReady = true;
    } else if (data.type === 'error') {
      console.warn('Handtracking niet beschikbaar:', data.message);
      // Pas opgeven als geen enkele worker het model kon laden
      if (++this.workerErrors === this.workers.length) this.setStatus('Handmodel kon niet laden: de muis werkt gewoon verder');
    } else if (data.type === 'hand') {
      entry.busy = false;
      this.perf?.record('hand', data.ms);
      this.perf?.count('hand');
      // Een worker met een ouder camerabeeld kan later klaar zijn: dat resultaat is al achterhaald
      if (data.timestamp < this.lastHandTimestamp) return;
      this.lastHandTimestamp = data.timestamp;
      if (this.running && data.palm) this.onHand(data.palm, data.timestamp);
    }
  }

  /** Camerabeeld als ImageBitmap naar een vrije worker (overgedragen, niet gekopieerd) */
  async sendFrameToWorker() {
    const entry = this.workers.find((w) => w.ready && !w.busy);
    if (!entry || this.sendingFrame) return;
    entry.busy = true;
    this.sendingFrame = true;
    try {
      // Verkleind: het handmodel werkt intern op ±224 px, groter beeld kost alleen extra tijd
      const bitmap = await createImageBitmap(this.video, { resizeWidth: 320, resizeHeight: 240 });
      entry.worker.postMessage({ type: 'frame', bitmap, timestamp: performance.now() }, [bitmap]);
    } catch {
      entry.busy = false;
    }
    this.sendingFrame = false;
  }

  /**
   * Hand gevonden: palm = midden van de handpalm (0..1 in het beeld, al gespiegeld),
   * timestamp = wanneer dat camerabeeld genomen werd (ms)
   */
  onHand(palm, timestamp) {
    // Beeld → NDC (-1..1, y omhoog), uitvergroot zodat je de randen haalt
    const x = Math.max(-1, Math.min(1, (palm.x * 2 - 1) * REACH));
    const y = Math.max(-1, Math.min(1, -(palm.y * 2 - 1) * REACH));

    if (!this.hasHand) {
      // Hand verschijnt: meteen op de juiste plek, niet van de vorige plek aan komen glijden
      this.handSmoothed.x = x;
      this.handSmoothed.y = y;
      this.handVelocity.x = 0;
      this.handVelocity.y = 0;
      this.hasHand = true;
    } else {
      // Snelheid = verplaatsing / tijd tussen de twee camerabeelden, afgevlakt tegen meetruis
      const seconds = (timestamp - this.handTime) / 1000;
      if (seconds > 0) {
        const vx = (x - this.handTarget.x) / seconds;
        const vy = (y - this.handTarget.y) / seconds;
        this.handVelocity.x += (vx - this.handVelocity.x) * VELOCITY_SMOOTHING;
        this.handVelocity.y += (vy - this.handVelocity.y) * VELOCITY_SMOOTHING;
      }
    }
    this.handTarget.x = x;
    this.handTarget.y = y;
    this.handTime = timestamp;
    this.handLastSeen = performance.now();
  }

  /** Elke frame: hand volgen; bij een nieuw camerabeeld af en toe het licht meten */
  update(delta) {
    if (!this.running) return;
    this.followHand(delta);

    if (!this.newFrame) return;
    this.newFrame = false;
    if (++this.framesSinceBrightness < BRIGHTNESS_EVERY) return;
    this.framesSinceBrightness = 0;

    this.renderer.compute(this.lightComputes);
    if (this.readPending) return;
    this.readPending = true;
    // Asynchroon teruglezen: niet wachten op de GPU
    this.renderer.getArrayBufferAsync(this.brightnessBuffer.value).then((buffer) => {
      if (this.running) {
        this.brightness = new Float32Array(buffer)[0];
        this.showLight();
      }
      this.readPending = false;
    });
  }

  /** Vloeiend naar de (voorspelde) handpositie, aanwijzer en cirkel bijwerken */
  followHand(delta) {
    if (this.hasHand && performance.now() - this.handLastSeen > LOST_AFTER) this.loseHand();
    if (!this.hasHand) return;

    // Voorspellen: waar is de hand nu, als ze zo verder beweegt sinds het laatste camerabeeld?
    const ahead = Math.min((performance.now() - this.handTime) / 1000, PREDICT_MAX);
    const goalX = Math.max(-1, Math.min(1, this.handTarget.x + this.handVelocity.x * ahead));
    const goalY = Math.max(-1, Math.min(1, this.handTarget.y + this.handVelocity.y * ahead));

    const t = 1 - Math.exp(-FOLLOW_SPEED * delta);
    this.handSmoothed.x += (goalX - this.handSmoothed.x) * t;
    this.handSmoothed.y += (goalY - this.handSmoothed.y) * t;
    this.handPointer.moveTo(this.handSmoothed.x, this.handSmoothed.y);

    // NDC → pixels voor de cirkel op het scherm
    const px = ((this.handSmoothed.x + 1) / 2) * window.innerWidth;
    const py = ((1 - this.handSmoothed.y) / 2) * window.innerHeight;
    this.indicator.style.transform = `translate(${px}px, ${py}px) translate(-50%, -50%)`;
    this.indicator.classList.add('visible');
  }

  loseHand() {
    this.hasHand = false;
    this.handPointer.leave();
    this.indicator.classList.remove('visible');
  }

  /** Statusregel: wat meet de lichtmeter, en wat maakt de wereld ervan? */
  showLight() {
    if (!this.workerReady) return; // eerst "Handmodel laden…" laten staan
    const percent = Math.round(this.brightness * 100);
    if (isManualOverride()) {
      this.setStatus(`Licht in je kamer: ${percent}% · pijltjes hebben even voorrang`);
      return;
    }
    const t = daylightFromBrightness(this.brightness);
    const moment = t < 0.25 ? 'nacht' : t < 0.6 ? 'schemering' : 'dag';
    const limited = this.exposureLocked ? '' : ' (camera regelt zelf de belichting)';
    this.setStatus(`Licht in je kamer: ${percent}% → ${moment}${limited}`);
  }

  setStatus(text) {
    this.status.textContent = text;
  }

  stopStream() {
    this.video.srcObject?.getTracks().forEach((track) => track.stop());
    this.video.srcObject = null;
    this.video.classList.remove('visible');
  }
}

/**
 * Automatische belichting vastzetten, als camera en browser dat toelaten.
 * Anders maakt de webcam een donkere kamer zelf weer licht, en ziet de lichtmeter weinig verschil.
 */
async function lockExposure(track) {
  const capabilities = track.getCapabilities?.() ?? {};
  if (!capabilities.exposureMode?.includes('manual')) return false;
  try {
    // Even wachten zodat de automatische belichting zich eerst op de kamer afstemt
    await new Promise((resolve) => setTimeout(resolve, 1500));
    await track.applyConstraints({ advanced: [{ exposureMode: 'manual' }] });
    return true;
  } catch {
    return false;
  }
}
