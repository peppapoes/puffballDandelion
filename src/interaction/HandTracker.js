/**
 * Handtracking via de webcam met ml5 handPose (MediaPipe Hands-model).
 * De hand stuurt een eigen Pointer met een groot aanraakgebied: wrijf je
 * hand door de wei en je raakt veel meer pluizenbollen dan met de muis.
 *
 * ml5 wordt pas geladen als je op de knop klikt (4,5 MB): wie de muis
 * gebruikt, merkt er niets van. Geen webcam = gewoon de muis.
 */

// Vaste versie van de CDN: een update van ml5 verandert het project niet ongemerkt
const ML5_URL = 'https://unpkg.com/ml5@1.4.0/dist/ml5.min.js';

const PALM_POINTS = ['wrist', 'index_finger_mcp', 'middle_finger_mcp', 'ring_finger_mcp', 'pinky_finger_mcp'];
const REACH = 1.3; // handbeweging uitvergroten: randen halen zonder je hand uit beeld te bewegen
const FOLLOW_SPEED = 18; // afvlakken van het schokken (hoger = sneller, maar onrustiger)
const LOST_AFTER = 300; // ms zonder hand: aanwijzer laat los

// Detecteren blokkeert de pagina even (±50 ms). Gemeten naast de wei:
// onbegrensd ±14 fps, max 15/s ±25 fps, max 10/s ±38 fps. Hoger = vlottere hand, tragere wei.
const DETECTIONS_PER_SECOND = 10;

export class HandTracker {
  constructor(pointer) {
    this.pointer = pointer;
    this.running = false;

    this.target = { x: 0, y: 0 }; // laatst gedetecteerde positie (NDC)
    this.smoothed = { x: 0, y: 0 }; // afgevlakte positie (NDC)
    this.lastSeen = 0;
    this.hasHand = false;

    this.button = document.getElementById('hand-button');
    this.status = document.getElementById('hand-status');
    this.indicator = document.getElementById('hand-indicator');

    this.button.addEventListener('click', () => (this.running ? this.stop() : this.start()));
  }

  /** Knop tonen (na het startscherm) */
  show() {
    this.button.hidden = false;
  }

  async start() {
    this.button.disabled = true;
    try {
      this.setStatus('Camera starten…');
      this.video = await startWebcam();

      this.setStatus('Handmodel laden…');
      await loadScript(ML5_URL);
      // TensorFlow.js (onder ml5) kiest anders zelf WebGPU, en dat botst met de WebGPU-renderer
      // van de wei: de detectie loopt dan nooit. WebGL laat beide naast elkaar werken.
      await window.ml5.setBackend('webgl');
      // runtime 'mediapipe': ±50 ms per detectie, tegenover ±280 ms met 'tfjs' (gemeten naast de wei).
      // Buiten p5.js geeft ml5 een Promise terug die het geladen model oplevert.
      // Let op: de video moet width/height hebben (zie startWebcam), anders zijn alle punten NaN.
      this.handPose = await window.ml5.handPose({
        maxHands: 1,
        flipped: true,
        modelType: 'lite',
        runtime: 'mediapipe',
      });
      await this.handPose.ready;

      this.running = true;
      this.detectLoop();
      this.video.classList.add('visible');
      this.button.textContent = '🖱 Gebruik de muis';
      this.setStatus('Hou je hand voor de camera');
    } catch (error) {
      console.warn('Handtracking niet beschikbaar:', error);
      this.stopWebcam();
      this.setStatus('Geen camera: de muis werkt gewoon verder');
    }
    this.button.disabled = false;
  }

  /**
   * Eigen detectielus i.p.v. ml5's detectStart (dat zo vaak detecteert als het kan):
   * maximaal DETECTIONS_PER_SECOND keer, zodat de wei vlot blijft renderen.
   */
  async detectLoop() {
    // Volgnummer: na snel uit- en weer aanzetten stopt een oude lus, i.p.v. naast de nieuwe te lopen
    const loopId = (this.loopId = (this.loopId ?? 0) + 1);
    while (this.running && loopId === this.loopId) {
      const started = performance.now();
      const hands = await this.handPose.detect(this.video);
      this.onHands(hands);

      const wait = 1000 / DETECTIONS_PER_SECOND - (performance.now() - started);
      if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
    }
  }

  stop() {
    this.stopWebcam();
    this.running = false;
    this.hasHand = false;
    this.pointer.leave();
    this.indicator.classList.remove('visible');
    this.button.textContent = '✋ Gebruik je hand';
    this.setStatus('');
  }

  /** Resultaat van ml5, na elke detectie */
  onHands(hands) {
    if (!this.running || hands.length === 0) return;
    const hand = hands[0];

    // Midden van de handpalm = gemiddelde van pols en knokkels (in pixels van het webcambeeld)
    let x = 0;
    let y = 0;
    for (const name of PALM_POINTS) {
      x += hand[name].x;
      y += hand[name].y;
    }
    x /= PALM_POINTS.length;
    y /= PALM_POINTS.length;
    if (!Number.isFinite(x) || !Number.isFinite(y)) return; // ongeldige detectie overslaan

    // Pixels → NDC (-1..1, y omhoog), uitvergroot en begrensd
    const ndcX = ((x / this.video.videoWidth) * 2 - 1) * REACH;
    const ndcY = -((y / this.video.videoHeight) * 2 - 1) * REACH;
    this.target.x = Math.max(-1, Math.min(1, ndcX));
    this.target.y = Math.max(-1, Math.min(1, ndcY));

    if (!this.hasHand) {
      // Hand verschijnt: meteen op de juiste plek, niet van de vorige plek aan komen glijden
      this.smoothed.x = this.target.x;
      this.smoothed.y = this.target.y;
      this.hasHand = true;
      this.setStatus('');
    }
    this.lastSeen = performance.now();
  }

  /** Elke frame: vloeiend volgen, aanwijzer en cirkel op het scherm bijwerken */
  update(delta) {
    if (!this.running) return;

    if (this.hasHand && performance.now() - this.lastSeen > LOST_AFTER) {
      this.hasHand = false;
      this.pointer.leave();
      this.indicator.classList.remove('visible');
      this.setStatus('Hou je hand voor de camera');
    }
    if (!this.hasHand) return;

    const t = 1 - Math.exp(-FOLLOW_SPEED * delta);
    this.smoothed.x += (this.target.x - this.smoothed.x) * t;
    this.smoothed.y += (this.target.y - this.smoothed.y) * t;
    this.pointer.moveTo(this.smoothed.x, this.smoothed.y);

    // NDC → pixels voor de cirkel op het scherm
    const px = ((this.smoothed.x + 1) / 2) * window.innerWidth;
    const py = ((1 - this.smoothed.y) / 2) * window.innerHeight;
    this.indicator.style.transform = `translate(${px}px, ${py}px) translate(-50%, -50%)`;
    this.indicator.classList.add('visible');
  }

  setStatus(text) {
    this.status.textContent = text;
  }

  stopWebcam() {
    this.video?.srcObject?.getTracks().forEach((track) => track.stop());
    this.video?.classList.remove('visible');
  }
}

async function startWebcam() {
  const stream = await navigator.mediaDevices.getUserMedia({
    video: { width: 640, height: 480, facingMode: 'user' },
    audio: false,
  });
  const video = document.getElementById('hand-video');
  video.srcObject = stream;
  await video.play();
  // ml5 gebruikt width/height van het element om te spiegelen (flipped); zonder deze
  // attributen zijn ze 0 en worden alle coördinaten NaN
  video.width = video.videoWidth;
  video.height = video.videoHeight;
  return video;
}

/** Script van een CDN laden, één keer */
function loadScript(src) {
  if (window.ml5) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = src;
    script.onload = resolve;
    script.onerror = () => reject(new Error(`Kon ${src} niet laden`));
    document.head.appendChild(script);
  });
}
