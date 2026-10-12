import { uTimeOfDay } from '../state/worldState.js';

const DAY_URL = './audio/day.mp3'; // "Calm Ambient Dreamscape" door morgan-ambient (Pixabay)
const NIGHT_URL = './audio/night.mp3'; // "Ambient - Ambient Music" door leberch (Pixabay)
const VOLUME = 0.5; // totaalvolume (0..1): zacht, het is achtergrondmuziek
const FADE = 0.4; // s: tijdsconstante van het aan- en uitzetten (geen harde knip)

/**
 * Ambient muziek die meegaat met dag en nacht (Web Audio API).
 *
 * Twee <audio>-elementen in een lus (dag en nacht), allebei altijd aan het spelen.
 * Elk gaat door een eigen volumeknop (GainNode); die van de dag volgt uTimeOfDay,
 * dezelfde waarde als de lucht (src/state/worldState.js). Zo vloeit de muziek mee over
 * als het nacht wordt. Daarna nog één hoofdknop voor aan/uit.
 *
 *   dag-element   → dagvolume   ─┐
 *                                ├→ hoofdvolume → speakers
 *   nacht-element → nachtvolume ─┘
 *
 * <audio>-elementen streamen: de muziek begint al voor het hele bestand binnen is.
 * Het volume regelen we met GainNodes, niet met audio.volume (dat kan niet op een iPhone).
 */
export class AmbientMusic {
  constructor() {
    this.context = null;
    this.on = true;
    this.button = document.getElementById('music-button');
    this.button.addEventListener('click', () => this.toggle());
  }

  /** Na de klik op het startscherm: browsers laten pas geluid toe na een klik van de gebruiker */
  start() {
    this.context = new AudioContext();
    this.master = this.context.createGain();
    this.master.gain.value = VOLUME;
    this.master.connect(this.context.destination);
    this.day = this.createTrack(DAY_URL);
    this.night = this.createTrack(NIGHT_URL);
    this.update();
    this.button.hidden = false;
  }

  /** <audio>-element in een lus → eigen volumeknop → hoofdvolume */
  createTrack(url) {
    const audio = new Audio(url);
    audio.loop = true;
    const gain = this.context.createGain();
    this.context.createMediaElementSource(audio).connect(gain).connect(this.master);
    audio.play().catch((error) => console.warn('Muziek kan niet starten:', error));
    return { audio, gain };
  }

  /** Aan/uit met een korte fade; uit = ook pauzeren (de browser hoeft niets meer te decoderen) */
  toggle() {
    this.on = !this.on;
    // setTargetAtTime: het volume glijdt exponentieel naar het doel, op de klok van de audio
    this.master.gain.setTargetAtTime(this.on ? VOLUME : 0, this.context.currentTime, FADE);
    this.button.setAttribute('aria-pressed', String(this.on));
    const tracks = [this.day.audio, this.night.audio];
    clearTimeout(this.pauseTimer);
    if (this.on) {
      tracks.forEach((audio) => audio.play());
    } else {
      // Pas pauzeren als de fade voorbij is (na 5 tijdsconstanten is het stil)
      this.pauseTimer = setTimeout(() => tracks.forEach((audio) => audio.pause()), FADE * 5 * 1000);
    }
  }

  /**
   * Elke frame: overvloeien volgens de tijd van de dag (0 = nacht, 1 = dag).
   * Equal-power crossfade: sinus en cosinus in plaats van t en 1 − t. Bij een lineaire mix
   * klinkt de schemering zachter (twee keer half volume klinkt stiller dan één keer vol);
   * met sin² + cos² = 1 blijft het totale geluidsvermogen overal hetzelfde.
   */
  update() {
    if (!this.context) return;
    const angle = (uTimeOfDay.value * Math.PI) / 2;
    this.day.gain.gain.value = Math.sin(angle);
    this.night.gain.gain.value = Math.cos(angle);
  }
}
