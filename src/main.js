import { App } from './App.js';
import { DEBUG } from './core/PerfMonitor.js';

const app = new App();

// Tijdens het ontwikkelen of met ?debug: 'app' bereikbaar in de browserconsole om te testen
if (import.meta.env.DEV || DEBUG) window.app = app;

// Laden (Blender-model, shaders) loopt al terwijl het startscherm zichtbaar is
const ready = app.init(document.getElementById('scene'));

// Startscherm: pluisjes die traag omhoog dwarrelen
const SEED_COUNT = 14;
const SEED_SVG =
  '<svg viewBox="0 0 20 32"><line x1="10" y1="31" x2="10" y2="10"/><line x1="10" y1="10" x2="2" y2="3"/>' +
  '<line x1="10" y1="10" x2="6" y2="1"/><line x1="10" y1="10" x2="10" y2="0.5"/><line x1="10" y1="10" x2="14" y2="1"/>' +
  '<line x1="10" y1="10" x2="18" y2="3"/></svg>';
const seeds = document.getElementById('floating-seeds');
for (let i = 0; i < SEED_COUNT; i++) {
  seeds.insertAdjacentHTML('beforeend', SEED_SVG);
  const seed = seeds.lastElementChild;
  seed.classList.add('floating-seed');
  // Elk pluisje een eigen plek, grootte en tempo (CSS-variabelen, gebruikt in style.css)
  seed.style.setProperty('--x', `${(i / SEED_COUNT) * 100 + Math.random() * 6}%`);
  seed.style.setProperty('--size', `${14 + Math.random() * 16}px`);
  seed.style.setProperty('--duration', `${12 + Math.random() * 10}s`);
  seed.style.setProperty('--delay', `${-Math.random() * 20}s`); // negatief: ze zweven al bij het openen
}

// De knop werkt meteen: klik je voor alles geladen is, dan start het zodra het klaar is.
// De klik geeft ook toestemming voor geluid.
const startScreen = document.getElementById('start-screen');
const startButton = document.getElementById('start-button');
startButton.addEventListener(
  'click',
  async () => {
    startButton.disabled = true;
    startButton.textContent = 'Just a moment…';
    await ready;
    startScreen.classList.add('hidden');
    app.start();
  },
  { once: true }
);
