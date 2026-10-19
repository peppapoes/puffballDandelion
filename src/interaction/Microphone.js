import { getAudioContext } from '../audio/audioContext.js';

const LOUD_MIN = 0.008; // daaronder: stilte of achtergrondgeluid
const LOUD_MAX = 0.06; // hard blazen (op een armlengte van de laptop)
const NOISE_MIN = 0.25; // daaronder: stem, muziek, een fluitje
const NOISE_MAX = 0.45; // daarboven: zeker ruis (blazen, "sssh")
const NOISE_BAND = [80, 4000]; // Hz: hier meten we de vlakheid (blazen rommelt vooral laag)
const ATTACK = 6; // per seconde: stijgt niet bij een kort geluidje (een "s" in een woord), wel bij blijven blazen
const RELEASE = 3; // per seconde: na het blazen nog even nablazen

export class Microphone {
  constructor(perf) {
    this.perf = perf; // prestatiemeter (?debug): volume, ruisachtigheid en blaaskracht tonen
    this.level = 0; // blaaskracht 0..1, afgevlakt
    this.loudness = 0;
    this.noisiness = 0;
    this.analyser = null;
    this.button = document.getElementById('mic-button');
    this.meter = document.getElementById('mic-meter');
    this.meterBar = this.meter.firstElementChild;
    this.button.addEventListener('click', () => (this.analyser ? this.stop() : this.start()));
  }

  show() {
    this.button.hidden = false;
  }

  async start() {
    this.button.disabled = true;
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
      });
      this.context = getAudioContext(); // gedeeld met de muziek (audioContext.js)
      this.analyser = this.context.createAnalyser();
      this.analyser.fftSize = 2048;
      this.analyser.smoothingTimeConstant = 0.3;
      this.source = this.context.createMediaStreamSource(this.stream);
      this.source.connect(this.analyser);
      this.samples = new Float32Array(this.analyser.fftSize);
      this.spectrum = new Float32Array(this.analyser.frequencyBinCount);
      const hzPerBin = this.context.sampleRate / this.analyser.fftSize;
      this.band = NOISE_BAND.map((hz) => Math.round(hz / hzPerBin));
      this.button.setAttribute('aria-pressed', 'true');
      this.meter.hidden = false;
    } catch (error) {
      console.warn('Microfoon niet beschikbaar:', error);
      this.button.querySelector('.label').textContent = 'No mic';
    }
    this.button.disabled = false;
  }

  stop() {
    this.stream?.getTracks().forEach((track) => track.stop());
    this.source?.disconnect(); // niet de context sluiten: die is gedeeld met de muziek
    this.analyser = null;
    this.level = 0;
    this.meter.hidden = true;
    this.button.setAttribute('aria-pressed', 'false');
  }

  update(delta) {
    if (!this.analyser) return;

    this.analyser.getFloatTimeDomainData(this.samples);
    let sum = 0;
    for (const sample of this.samples) sum += sample * sample;
    this.loudness = Math.sqrt(sum / this.samples.length);

    this.analyser.getFloatFrequencyData(this.spectrum); // in decibel
    let logSum = 0;
    let powerSum = 0;
    const [from, to] = this.band;
    for (let bin = from; bin < to; bin++) {
      const power = 10 ** (Math.max(this.spectrum[bin], -160) / 10) * bin;
      logSum += Math.log(power);
      powerSum += power;
    }
    const count = to - from;
    this.noisiness = Math.exp(logSum / count) / (powerSum / count || 1);

    const target = smoothstep(LOUD_MIN, LOUD_MAX, this.loudness) * smoothstep(NOISE_MIN, NOISE_MAX, this.noisiness);
    const speed = target > this.level ? ATTACK : RELEASE;
    this.level += (target - this.level) * (1 - Math.exp(-speed * delta));

    const width = `${Math.round(this.level * 100)}%`;
    if (width !== this.meterBar.style.width) this.meterBar.style.width = width;
    this.perf?.info('mic', `volume ${this.loudness.toFixed(3)}  ruis ${this.noisiness.toFixed(2)}  blazen ${this.level.toFixed(2)}`);
  }
}

function smoothstep(edge0, edge1, x) {
  const t = Math.min(Math.max((x - edge0) / (edge1 - edge0), 0), 1);
  return t * t * (3 - 2 * t);
}
