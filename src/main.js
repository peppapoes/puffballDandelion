import { App } from './App.js';

const app = new App();
await app.init(document.getElementById('scene'));

// Alleen tijdens het ontwikkelen: 'app' bereikbaar in de browserconsole om te testen
if (import.meta.env.DEV) window.app = app;

// De wei draait al achter het startscherm; de klik geeft toestemming voor geluid
const startScreen = document.getElementById('start-screen');
document.getElementById('start-button').addEventListener(
  'click',
  () => {
    startScreen.classList.add('hidden');
    app.start();
  },
  { once: true }
);
