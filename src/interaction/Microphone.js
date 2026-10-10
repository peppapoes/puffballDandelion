const BLOW_MIN = 0.03; // volume (RMS) waaronder niets gebeurt: achtergrondgeluid
const BLOW_MAX = 0.25; // volume waarbij je "hard" blaast
const ATTACK = 15; // hoe snel de blaaskracht stijgt (per seconde)
const RELEASE = 3; // hoe snel ze weer zakt: na een stoot nog even nablazen

/**
 * Microfoon als blaassensor (Web Audio API).
 * Blazen in een microfoon geeft een luide ruis: het volume (RMS van het geluidssignaal)
 * wordt de blaaskracht `level` (0..1), die Seeds.js gebruikt om pluisjes weg te blazen.
 * Ruisonderdrukking en automatische volumeregeling staan uit: die zouden net het blazen wegfilteren.
 */
export class Microphone {
  constructor() {
    this.level = 0; // blaaskracht 0..1, afgevlakt
    this.analyser = null;
    this.button = document.getElementById('mic-button');
    this.button.addEventListener('click', () => (this.analyser ? this.stop() : this.start()));
  }

  /** Knop tonen (na het startscherm) */
  show() {
    this.button.hidden = false;
  }

  async start() {
    this.button.disabled = true;
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
      });
      this.context = new AudioContext();
      this.analyser = this.context.createAnalyser();
      this.analyser.fftSize = 1024;
      this.context.createMediaStreamSource(this.stream).connect(this.analyser);
      this.samples = new Float32Array(this.analyser.fftSize);
      this.button.textContent = '🎤 Microfoon uit';
    } catch (error) {
      console.warn('Microfoon niet beschikbaar:', error);
      this.button.textContent = '🎤 Geen microfoon';
    }
    this.button.disabled = false;
  }

  stop() {
    this.stream?.getTracks().forEach((track) => track.stop());
    this.context?.close();
    this.analyser = null;
    this.level = 0;
    this.button.textContent = '🎤 Microfoon aan';
  }

  /** Elke frame: volume meten → blaaskracht */
  update(delta) {
    if (!this.analyser) return;
    this.analyser.getFloatTimeDomainData(this.samples);
    let sum = 0;
    for (const sample of this.samples) sum += sample * sample;
    const rms = Math.sqrt(sum / this.samples.length);

    const target = smoothstep(BLOW_MIN, BLOW_MAX, rms);
    const speed = target > this.level ? ATTACK : RELEASE;
    this.level += (target - this.level) * (1 - Math.exp(-speed * delta));
  }
}

function smoothstep(edge0, edge1, x) {
  const t = Math.min(Math.max((x - edge0) / (edge1 - edge0), 0), 1);
  return t * t * (3 - 2 * t);
}
