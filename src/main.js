import { App } from './App.js';
import { DEBUG } from './core/PerfMonitor.js';

const app = new App();

// Tijdens het ontwikkelen of met ?debug: 'app' bereikbaar in de browserconsole om te testen
if (import.meta.env.DEV || DEBUG) window.app = app;

// Laden (Blender-model, shaders) loopt al terwijl het startscherm zichtbaar is
const ready = app.init(document.getElementById('scene'));

// De knop werkt meteen: klik je voor alles geladen is, dan start het zodra het klaar is.
// De klik geeft ook toestemming voor geluid.
const startScreen = document.getElementById('start-screen');
const startButton = document.getElementById('start-button');
startButton.addEventListener(
  'click',
  async () => {
    startButton.disabled = true;
    startButton.textContent = 'Laden…';
    await ready;
    startScreen.classList.add('hidden');
    app.start();
  },
  { once: true }
);
