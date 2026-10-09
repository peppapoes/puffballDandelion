import * as THREE from 'three/webgpu';
import { daylightFromBrightness, isManualOverride } from '../state/worldState.js';
import {
  Fn, Loop, If, float, vec2, vec3, vec4, int, uniform, texture, instancedArray, instanceIndex,
  positionGeometry, screenUV, abs, clamp, dot, floor, max, mix, pow, smoothstep,
} from 'three/tsl';

/**
 * De webcam als sensor, volledig op de GPU (compute shaders in TSL), zonder AI-library.
 *
 * 1. Beweging (frame differencing): het camerabeeld wordt een rooster van GRID_W × GRID_H vakjes.
 *    Per vakje vergelijkt de GPU de helderheid met het vorige camerabeeld: groot verschil =
 *    daar beweegt iets. Zo ontstaat een bewegingskaart die langzaam uitdooft (een veeg laat een spoor).
 * 2. Lichtmeter: de gemiddelde helderheid van het hele beeld (donkere kamer = nacht).
 *
 * 3. Handtracking: het zwaartepunt van de beweging is waar je hand beweegt. Dat punt stuurt
 *    een Pointer met een groot aanraakgebied (FlowerPhysics) en een cirkel op het scherm.
 *
 * De resultaten gaan asynchroon terug naar JavaScript. Een zachte gloed op het scherm
 * toont wat de camera als beweging ziet.
 */

const GRID_W = 64;
const GRID_H = 48;
const CELLS = GRID_W * GRID_H;

const NOISE = 0.035; // kleinere verschillen zijn ruis van de camera, geen beweging
const GAIN = 8; // verschil in helderheid → bewegingssterkte (0..1)
const DECAY = 0.82; // per camerabeeld: hoe snel het spoor van een beweging uitdooft
const BRIGHTNESS_EVERY = 6; // lichtmeter niet elk camerabeeld teruglezen (licht verandert traag)
const OVERLAY_STRENGTH = 0.15; // zichtbaarheid van de gloed op het scherm (de cirkel toont de hand al)

// Hand = zwaartepunt van de beweging
const HAND_CELL_THRESHOLD = 0.15; // vakjes met minder beweging tellen niet mee
const HAND_MIN_MOTION = 4; // totale beweging nodig om van "een hand" te spreken
const REACH = 1.2; // handbeweging uitvergroten: randen halen zonder je hand uit beeld te bewegen
const FOLLOW_SPEED = 14; // afvlakken van het schokken (hoger = sneller, maar onrustiger)
const LOST_AFTER = 300; // ms zonder beweging: hand-aanwijzer laat los

// Luma: hoe helder een kleur lijkt (groen weegt het zwaarst voor het oog)
const LUMA = vec3(0.2126, 0.7152, 0.0722);

export class CameraVision {
  constructor(renderer, handPointer) {
    this.renderer = renderer;
    this.handPointer = handPointer;
    this.running = false;

    this.handTarget = { x: 0, y: 0 }; // laatst gevonden handpositie (NDC)
    this.handSmoothed = { x: 0, y: 0 }; // afgevlakte positie (NDC)
    this.handLastSeen = 0;
    this.hasHand = false;
    this.indicator = document.getElementById('hand-indicator');
    this.newFrame = false;
    this.framesSinceBrightness = 0;
    this.readPending = false;
    this.exposureLocked = false;

    this.motion = new Float32Array(CELLS); // laatste bewegingskaart op de CPU (0..1 per vakje)
    this.brightness = null; // laatste lichtmeting (0..1), null = nog geen meting

    this.video = document.getElementById('camera-video');
    this.button = document.getElementById('camera-button');
    this.status = document.getElementById('camera-status');
    this.button.addEventListener('click', () => (this.running ? this.stop() : this.start()));

    this.createGpuPrograms();
  }

  /** Knop tonen (na het startscherm) */
  show() {
    this.button.hidden = false;
  }

  // --- GPU: compute shaders ---

  createGpuPrograms() {
    // Camerabeeld als textuur. sRGB (vereist door Three.js): de GPU leest lineaire kleuren,
    // die rekenen we hieronder terug naar waargenomen helderheid.
    this.videoTexture = new THREE.VideoTexture(this.video);
    this.videoTexture.colorSpace = THREE.SRGBColorSpace;

    // Opslagbuffers op de GPU
    this.lumaBuffer = instancedArray(CELLS, 'float'); // helderheid per vakje, vorig camerabeeld
    this.motionBuffer = instancedArray(CELLS, 'float'); // bewegingskaart
    this.brightnessBuffer = instancedArray(1, 'float'); // lichtmeter

    const videoTex = texture(this.videoTexture);
    const lumaBuffer = this.lumaBuffer;
    const motionBuffer = this.motionBuffer;

    // Compute 1: per vakje helderheid meten en vergelijken met het vorige camerabeeld
    this.motionCompute = Fn(() => {
      const i = instanceIndex;
      const cx = float(i.mod(GRID_W));
      const cy = float(i.div(GRID_W));

      // Midden van het vakje; rij 0 = bovenaan het scherm.
      // x gespiegeld (bewegen als in een spiegel); y omgekeerd: v = 0 is onderaan de videotextuur
      const center = vec2(cx.add(0.5).div(GRID_W), cy.add(0.5).div(GRID_H));
      const uv = vec2(float(1).sub(center.x), float(1).sub(center.y));

      // Vier stalen per vakje: minder ruis dan één pixel
      const d = vec2(0.25 / GRID_W, 0.25 / GRID_H);
      const rgb = videoTex.sample(uv.add(vec2(d.x.negate(), d.y.negate()))).level(0).rgb
        .add(videoTex.sample(uv.add(vec2(d.x, d.y.negate()))).level(0).rgb)
        .add(videoTex.sample(uv.add(vec2(d.x.negate(), d.y))).level(0).rgb)
        .add(videoTex.sample(uv.add(d)).level(0).rgb)
        .mul(0.25);
      // Lineaire helderheid → waargenomen helderheid (zoals het oog: donkere tinten beter onderscheiden)
      const luma = pow(dot(rgb, LUMA), 1 / 2.2);

      const previous = lumaBuffer.element(i);
      const difference = max(abs(luma.sub(previous)).sub(NOISE), 0).mul(GAIN);
      const motion = motionBuffer.element(i);
      motion.assign(clamp(max(difference, motion.mul(DECAY)), 0, 1));
      previous.assign(luma);
    })().compute(CELLS);

    // Compute 2: gemiddelde helderheid van het hele beeld (één thread telt alle vakjes op)
    this.brightnessCompute = Fn(() => {
      const sum = float(0).toVar();
      Loop(CELLS, ({ i }) => {
        sum.addAssign(lumaBuffer.element(i));
      });
      this.brightnessBuffer.element(0).assign(sum.div(CELLS));
    })().compute(1);

    this.overlay = this.createOverlay();
  }

  /** Zachte gloed over het scherm waar beweging is (bilineair tussen de vakjes) */
  createOverlay() {
    const motionBuffer = this.motionBuffer;
    const strength = uniform(0);
    this.overlayStrength = strength;

    const cell = (x, y) => {
      const cx = clamp(x, 0, GRID_W - 1);
      const cy = clamp(y, 0, GRID_H - 1);
      return motionBuffer.element(int(cy).mul(GRID_W).add(int(cx)));
    };

    const material = new THREE.MeshBasicNodeMaterial({
      transparent: true,
      depthTest: false,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    material.fog = false;
    // Volledig scherm, los van de camera: hoeken van het vlak = hoeken van het scherm
    material.vertexNode = vec4(positionGeometry.xy, 0, 1);
    material.colorNode = Fn(() => {
      const g = vec2(screenUV.x.mul(GRID_W).sub(0.5), screenUV.y.mul(GRID_H).sub(0.5));
      const g0 = floor(g);
      const f = g.sub(g0);
      const top = mix(cell(g0.x, g0.y), cell(g0.x.add(1), g0.y), f.x);
      const bottom = mix(cell(g0.x, g0.y.add(1)), cell(g0.x.add(1), g0.y.add(1)), f.x);
      const m = smoothstep(0.05, 0.8, mix(top, bottom, f.y));
      return vec3(0.75, 0.95, 1).mul(m).mul(strength);
    })();

    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), material);
    mesh.frustumCulled = false;
    mesh.renderOrder = 999;
    mesh.visible = false;
    return mesh;
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
      this.exposureLocked = await lockExposure(stream.getVideoTracks()[0]);

      this.running = true;
      this.watchFrames();
      this.overlay.visible = true;
      this.video.classList.add('visible');
      this.button.textContent = '📷 Camera uit';
      this.setStatus(
        this.exposureLocked
          ? 'Beweeg door de wei · het licht van je kamer stuurt de dag'
          : 'Beweeg door de wei · lichtmeter beperkt (camera regelt zelf de belichting)'
      );
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
    this.overlay.visible = false;
    this.motion.fill(0);
    this.brightness = null;
    this.loseHand();
    this.button.textContent = '📷 Camera aan';
    this.setStatus('');
  }

  /** Alleen rekenen als de webcam een nieuw beeld heeft (±30 per seconde) */
  watchFrames() {
    const onFrame = () => {
      if (!this.running) return;
      this.newFrame = true;
      this.video.requestVideoFrameCallback(onFrame);
    };
    this.video.requestVideoFrameCallback(onFrame);
  }

  /** Elke frame: hand volgen; bij een nieuw camerabeeld de compute shaders draaien en teruglezen */
  update(delta) {
    this.overlayStrength.value = this.running ? OVERLAY_STRENGTH : 0;
    if (!this.running) return;

    this.followHand(delta);
    if (!this.newFrame) return;
    this.newFrame = false;

    const measureLight = ++this.framesSinceBrightness >= BRIGHTNESS_EVERY;
    if (measureLight) this.framesSinceBrightness = 0;
    this.renderer.compute(measureLight ? [this.motionCompute, this.brightnessCompute] : this.motionCompute);

    // Asynchroon teruglezen: niet wachten, de physics gebruikt het laatste resultaat
    if (this.readPending) return;
    this.readPending = true;
    const reads = [this.renderer.getArrayBufferAsync(this.motionBuffer.value)];
    if (measureLight) reads.push(this.renderer.getArrayBufferAsync(this.brightnessBuffer.value));
    Promise.all(reads).then(([motion, brightness]) => {
      if (this.running) {
        this.motion.set(new Float32Array(motion));
        if (brightness) {
          this.brightness = new Float32Array(brightness)[0];
          this.showLight();
        }
        this.onMotion();
      }
      this.readPending = false;
    });
  }

  /** Statusregel: wat meet de lichtmeter, en wat maakt de wereld ervan? */
  showLight() {
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

  /** Nieuwe bewegingskaart binnen: waar is de hand? */
  onMotion() {
    const hand = this.findHand();
    if (!hand) return;
    this.handTarget.x = hand.x;
    this.handTarget.y = hand.y;
    if (!this.hasHand) {
      // Hand verschijnt: meteen op de juiste plek, niet van de vorige plek aan komen glijden
      this.handSmoothed.x = hand.x;
      this.handSmoothed.y = hand.y;
      this.hasHand = true;
    }
    this.handLastSeen = performance.now();
  }

  /** Elke frame: vloeiend naar de handpositie, aanwijzer en cirkel bijwerken */
  followHand(delta) {
    if (this.hasHand && performance.now() - this.handLastSeen > LOST_AFTER) this.loseHand();
    if (!this.hasHand) return;

    const t = 1 - Math.exp(-FOLLOW_SPEED * delta);
    this.handSmoothed.x += (this.handTarget.x - this.handSmoothed.x) * t;
    this.handSmoothed.y += (this.handTarget.y - this.handSmoothed.y) * t;
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

  /**
   * Handpositie uit de bewegingskaart: het zwaartepunt van alle vakjes waar duidelijk
   * beweging is. Beweeg je je hand, dan ligt dat punt op je hand.
   * Geeft { x, y } in NDC (-1..1), of null als er te weinig beweging is.
   */
  findHand() {
    let total = 0;
    let sumX = 0;
    let sumY = 0;
    for (let i = 0; i < CELLS; i++) {
      const m = this.motion[i];
      if (m < HAND_CELL_THRESHOLD) continue;
      total += m;
      sumX += (i % GRID_W) * m;
      sumY += Math.floor(i / GRID_W) * m;
    }
    if (total < HAND_MIN_MOTION) return null;

    // Vakje → NDC (rij 0 = bovenaan), uitvergroot zodat je de randen haalt
    const x = (((sumX / total + 0.5) / GRID_W) * 2 - 1) * REACH;
    const y = -(((sumY / total + 0.5) / GRID_H) * 2 - 1) * REACH;
    return { x: Math.max(-1, Math.min(1, x)), y: Math.max(-1, Math.min(1, y)) };
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
