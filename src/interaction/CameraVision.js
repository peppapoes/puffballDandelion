import * as THREE from 'three/webgpu';
import { daylightFromRoom, isManualOverride } from '../state/worldState.js';
import { Fn, Loop, float, vec2, vec3, texture, instancedArray, instanceIndex, dot, pow } from 'three/tsl';

/**
 * De webcam als sensor:
 *
 * 1. Handtracking: MediaPipe Hand Landmarker (Google, zonder ml5) in een Web Worker
 *    (handWorker.js), zodat de wei vlot blijft. Herkent alleen handen, geen hoofd of lichaam.
 *    Het midden van je handpalm stuurt een Pointer met een groot aanraakgebied
 *    (FlowerPhysics) en een cirkel op het scherm.
 * 2. Lichtmeter op de GPU (compute shaders in TSL): de gemiddelde helderheid én het contrast
 *    van het camerabeeld sturen dag en nacht. Donker of vlak (bedekte camera, donkere kamer
 *    die de camera zelf oplicht) = nacht.
 */

// Lichtmeter: het camerabeeld als rooster van vakjes, per vakje de helderheid
const GRID_W = 64;
const GRID_H = 48;
const CELLS = GRID_W * GRID_H;
const BRIGHTNESS_EVERY = 6; // niet elk camerabeeld meten: licht verandert traag
const CELL_SAMPLES = 4; // per vakje 4×4 pixels middelen (ruis van de camera uitvlakken)

// Hand
// Eén detectie duurt ±80–160 ms, dus ±6–11 per seconde. Meer workers (om beurten een camerabeeld)
// geven meer detecties, maar in de praktijk was dat glitchy: elke worker volgt de hand apart en ze
// zijn het net niet eens (zigzag), en ze vechten met de wei om de processor. Daarom: één worker,
// en tussen twee detecties voorspellen waar de hand nu is (PREDICT_MAX).
const HAND_WORKERS = 1;
const REACH = 1.2; // handbeweging uitvergroten: randen halen zonder je hand uit beeld te bewegen
const LOST_AFTER = 700; // ms zonder hand: hand-aanwijzer laat los (ruim boven één trage detectie)
// Glijden: de cirkel volgt de hand met een kritisch gedempte veer (zoals de stelen), zonder
// te springen bij elke nieuwe detectie. De veer is zo stijf dat ze ongeveer in de tijd tussen
// twee detecties aankomt: snelle detecties = strak volgen, trage = de beweging uitsmeren.
const GLIDE = 3.5; // stijfheid (ω) = GLIDE / tijd tussen detecties
const GLIDE_MIN = 6; // ω nooit lager (anders sleept de cirkel te ver achter)
const GLIDE_MAX = 30; // ω nooit hoger (anders trilt de meetruis mee)
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
    this.handGlide = { x: 0, y: 0 }; // snelheid van de cirkel zelf (de veer)
    this.detectionInterval = 0.15; // gemeten tijd tussen twee detecties (s), afgevlakt
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
    this.contrast = 0; // laatste contrastmeting (standaardafwijking van de vakjes, 0..0.5)

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
    this.brightnessBuffer = instancedArray(2, 'float'); // [gemiddelde helderheid, contrast]
    const lumaBuffer = this.lumaBuffer;

    // Compute 1: per vakje de helderheid (één thread per vakje). Gemiddelde van CELL_SAMPLES×CELL_SAMPLES
    // pixels in het vakje: een camera die zijn versterking opdraait (bedekt, donkere kamer) geeft
    // korrelige ruis, en die mag niet als "contrast" meetellen.
    const lumaCompute = Fn(() => {
      const i = instanceIndex;
      const corner = vec2(float(i.mod(GRID_W)).div(GRID_W), float(i.div(GRID_W)).div(GRID_H));
      const sum = float(0).toVar();
      Loop(CELL_SAMPLES, ({ i: sx }) => {
        Loop(CELL_SAMPLES, ({ i: sy }) => {
          const offset = vec2(float(sx).add(0.5).div(CELL_SAMPLES * GRID_W), float(sy).add(0.5).div(CELL_SAMPLES * GRID_H));
          const rgb = videoTex.sample(corner.add(offset)).level(0).rgb;
          // Lineaire helderheid → waargenomen helderheid (zoals het oog)
          sum.addAssign(pow(dot(rgb, LUMA), 1 / 2.2));
        });
      });
      lumaBuffer.element(i).assign(sum.div(CELL_SAMPLES * CELL_SAMPLES));
    })().compute(CELLS);

    // Compute 2: gemiddelde en contrast van alle vakjes (één thread telt alles op).
    // Contrast = standaardafwijking: hoeveel de vakjes van elkaar verschillen.
    // Een gewone kamer heeft randen en vormen (veel contrast), een bedekte camera of een
    // donkere kamer is vlak, ook als de camera het beeld zelf oplicht.
    const averageCompute = Fn(() => {
      const sum = float(0).toVar();
      const sumSquares = float(0).toVar();
      Loop(CELLS, ({ i }) => {
        const luma = lumaBuffer.element(i);
        sum.addAssign(luma);
        sumSquares.addAssign(luma.mul(luma));
      });
      const mean = sum.div(CELLS);
      const variance = sumSquares.div(CELLS).sub(mean.mul(mean)).max(0); // E[x²] − E[x]²
      this.brightnessBuffer.element(0).assign(mean);
      this.brightnessBuffer.element(1).assign(variance.sqrt());
    })().compute(1);

    this.lightComputes = [lumaCompute, averageCompute];
  }

  // --- Webcam ---

  async start() {
    this.button.disabled = true;
    try {
      this.setStatus('Starting your camera…');
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: 640, height: 480, facingMode: 'user' },
        audio: false,
      });
      this.video.srcObject = stream;
      await this.video.play();

      this.running = true;
      this.watchFrames();
      this.video.classList.add('visible');
      this.button.setAttribute('aria-pressed', 'true');

      this.startHandTracking();
      this.exposureLocked = await lockExposure(stream.getVideoTracks()[0]);
    } catch (error) {
      console.warn('Camera niet beschikbaar:', error);
      this.stopStream();
      this.setStatus('No camera found · your mouse works just as well');
    }
    this.button.disabled = false;
  }

  stop() {
    this.running = false;
    this.stopStream();
    this.brightness = null;
    this.loseHand();
    this.button.setAttribute('aria-pressed', 'false');
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
    this.setStatus('Waking up the hand tracker…');
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
      if (!this.workerReady && this.running) this.setStatus('Hold up your hand to the camera');
      this.workerReady = true;
    } else if (data.type === 'error') {
      console.warn('Handtracking niet beschikbaar:', data.message);
      // Pas opgeven als geen enkele worker het model kon laden
      if (++this.workerErrors === this.workers.length) this.setStatus('Hand tracking could not load · your mouse works just as well');
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
      this.handGlide.x = 0;
      this.handGlide.y = 0;
      this.hasHand = true;
    } else {
      // Snelheid = verplaatsing / tijd tussen de twee camerabeelden, afgevlakt tegen meetruis
      const seconds = (timestamp - this.handTime) / 1000;
      if (seconds > 0) {
        this.detectionInterval += (Math.min(seconds, 1) - this.detectionInterval) * 0.3;
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
        [this.brightness, this.contrast] = new Float32Array(buffer);
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

    // Kritisch gedempte veer naar het doel. Geen knik in de beweging als er een nieuwe detectie
    // binnenkomt, alleen een zachte bocht.
    // Exacte oplossing in plaats van stapjes (Euler): met stapjes werd de veer instabiel zodra
    // stijfheid × frametijd ≥ 1 (snelle detecties + 30 fps), en schoot de cirkel van het scherm.
    // De exacte formule klopt bij elke frametijd:
    //   e = plek − doel,  e(t) = (e + (v + ω·e)·t)·e^(−ωt),  v(t) = (v − ω·(v + ω·e)·t)·e^(−ωt)
    const omega = Math.min(GLIDE_MAX, Math.max(GLIDE_MIN, GLIDE / this.detectionInterval));
    const decay = Math.exp(-omega * delta);
    for (const axis of ['x', 'y']) {
      const goal = axis === 'x' ? goalX : goalY;
      const e = this.handSmoothed[axis] - goal;
      const v = this.handGlide[axis];
      const k = (v + omega * e) * delta;
      this.handSmoothed[axis] = goal + (e + k) * decay;
      this.handGlide[axis] = (v - omega * k) * decay;
    }
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
    // Ook in het ?debug-paneel, om af te stellen
    const measured = `licht ${Math.round(this.brightness * 100)}% · contrast ${Math.round(this.contrast * 100)}%`;
    this.perf?.info('kamer', measured);
    if (!this.workerReady) return; // eerst "Waking up the hand tracker…" laten staan
    // Op het scherm geen percentages (die staan in ?debug), wel wat de kamer met de wei doet
    if (isManualOverride()) {
      this.setStatus('Arrow keys are in charge for a moment');
      return;
    }
    const t = daylightFromRoom(this.brightness, this.contrast);
    const moment = t < 0.25 ? 'night 🌙' : t < 0.6 ? 'dusk 🌇' : 'day ☀️';
    this.setStatus(`Your room says: ${moment}`);
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
