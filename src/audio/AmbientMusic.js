import { uTimeOfDay } from '../state/worldState.js';
import { getAudioContext } from './audioContext.js';

const DAY_URL = './audio/day.mp3'; // "Calm Ambient Dreamscape" door morgan-ambient (Pixabay)
const NIGHT_URL = './audio/night.mp3'; // "Ambient - Ambient Music" door leberch (Pixabay)
const VOLUME = 0.5; // totaalvolume (0..1): zacht, het is achtergrondmuziek
const FADE = 0.4; // s: tijdsconstante van het aan- en uitzetten (geen harde knip)
const CROSSFADE_GLIDE = 0.1; // s: tijdsconstante waarmee het volume naar de nieuwe dag/nacht-mix glijdt
const CROSSFADE_STEP = 0.005; // pas bijsturen als de mix zoveel veranderd is

export class AmbientMusic {
  constructor() {
    this.context = getAudioContext();
    this.master = this.context.createGain();
    this.master.gain.value = VOLUME;
    this.master.connect(this.context.destination);
    this.on = true;
    this.button = document.getElementById('music-button');
    this.button.addEventListener('click', () => this.toggle());
  }

  start() {
    getAudioContext(); // binnen de klik: de gepauzeerde context hervatten (resume)
    this.day = this.createTrack(DAY_URL);
    this.night = this.createTrack(NIGHT_URL);
    this.update();
    this.button.hidden = false;
  }

  createTrack(url) {
    const audio = new Audio(url);
    audio.loop = true;
    const gain = this.context.createGain();
    gain.gain.value = 0; // stil beginnen: update() laat het volume zacht naar de dag/nacht-mix glijden
    this.context.createMediaElementSource(audio).connect(gain).connect(this.master);
    audio.play().catch((error) => console.warn('Muziek kan niet starten:', error));
    return { audio, gain };
  }

  toggle() {
    this.on = !this.on;
    this.master.gain.setTargetAtTime(this.on ? VOLUME : 0, this.context.currentTime, FADE);
    this.button.setAttribute('aria-pressed', String(this.on));
    const tracks = [this.day.audio, this.night.audio];
    clearTimeout(this.pauseTimer);
    if (this.on) {
      tracks.forEach((audio) => audio.play());
    } else {
      this.pauseTimer = setTimeout(() => tracks.forEach((audio) => audio.pause()), FADE * 5 * 1000);
    }
  }

  update() {
    if (!this.day) return; // nummers starten pas na de klik
    const t = uTimeOfDay.value;
    if (Math.abs(t - (this.lastMix ?? -1)) < CROSSFADE_STEP) return;
    this.lastMix = t;
    const angle = (t * Math.PI) / 2;
    const now = this.context.currentTime;
    this.day.gain.gain.setTargetAtTime(Math.sin(angle), now, CROSSFADE_GLIDE);
    this.night.gain.gain.setTargetAtTime(Math.cos(angle), now, CROSSFADE_GLIDE);
  }
}
