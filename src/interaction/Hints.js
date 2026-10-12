import { isManualOverride } from '../state/worldState.js';

const FIRST_DELAY = 4; // s na de start: eerst even rondkijken
const SHOW_TIME = 14; // s: zo lang blijft een tip staan
const PAUSE = 8; // s tussen twee tips
const MOUSE_TRAVEL = 1500; // px muisbeweging over de wei: dan heb je de eerste tip al ontdekt

/**
 * Tips na het starten: een zacht kaartje onderaan dat vertelt wat je nog kan proberen,
 * met een knop om het meteen te doen (bv. de camera aanzetten). De bijhorende knop
 * rechtsonder pulseert zolang de tip staat.
 *
 * De tips komen één voor één. Een tip die je al gedaan hebt (camera staat al aan, je bent al
 * ingezoomd, ...) wordt overgeslagen, en verdwijnt vanzelf als je hem uitvoert terwijl hij staat.
 */
export class Hints {
  constructor({ cameraVision, microphone, flowerFocus }) {
    // Hoeveel heb je de muis al door de wei bewogen (px)? Zo weten we of de eerste tip nog nodig is
    this.mouseTravel = 0;
    this.canvas = document.getElementById('scene');
    this.canvas.addEventListener('pointermove', (event) => {
      if (event.pointerType === 'mouse') this.mouseTravel += Math.hypot(event.movementX, event.movementY);
    });

    // done(): is deze tip al uitgevoerd? action: wat de knop op het kaartje doet
    this.hints = [
      {
        icon: '🌾',
        text: 'Move your cursor through the meadow and watch the flowers sway',
        done: () => this.mouseTravel > MOUSE_TRAVEL,
      },
      {
        icon: '🖐️',
        text: 'Wave through the dandelions with your own hands',
        action: 'Turn on camera',
        onAction: () => cameraVision.start(),
        done: () => cameraVision.running,
        button: cameraVision.button,
      },
      {
        icon: '🌬️',
        text: 'Blow into your microphone and feel the wind pick up',
        action: 'Turn on mic',
        onAction: () => microphone.start(),
        done: () => microphone.analyser !== null,
        button: microphone.button,
      },
      {
        icon: '🌼',
        text: 'Click a dandelion to get up close, then brush or blow its seeds away',
        done: () => flowerFocus.focused !== null,
      },
      {
        icon: '🌙',
        text: 'Press ↑ or ↓ to drift through day and night',
        done: () => isManualOverride(),
      },
    ];
    this.index = -1; // welke tip staat er nu (-1 = nog geen)
    this.timer = -FIRST_DELAY; // negatief = wachten tot de volgende tip
    this.started = false;

    this.root = document.getElementById('hint');
    this.icon = this.root.querySelector('.hint-icon');
    this.text = this.root.querySelector('.hint-text');
    this.actionButton = this.root.querySelector('.hint-action');
    this.root.querySelector('.hint-close').addEventListener('click', () => this.hide());
    this.actionButton.addEventListener('click', () => {
      this.hints[this.index]?.onAction?.();
      this.hide();
    });
  }

  /** Na de klik op het startscherm */
  start() {
    this.started = true;
  }

  /** Elke frame: volgende tip tonen, of de huidige laten verdwijnen */
  update(delta) {
    if (!this.started) return;
    this.timer += delta;
    const current = this.hints[this.index];

    if (this.showing) {
      if (current.done() || this.timer > SHOW_TIME) this.hide();
      return;
    }
    if (this.timer < 0) return;

    // Volgende tip die je nog niet gedaan hebt
    do this.index++;
    while (this.index < this.hints.length && this.hints[this.index].done());
    if (this.index >= this.hints.length) {
      this.started = false; // alle tips gezien
      return;
    }
    this.show(this.hints[this.index]);
  }

  show(hint) {
    this.showing = true;
    this.timer = 0;
    this.icon.textContent = hint.icon;
    this.text.textContent = hint.text;
    this.actionButton.hidden = !hint.action;
    this.actionButton.textContent = hint.action ?? '';
    hint.button?.classList.add('highlight');
    this.root.classList.remove('leaving');
    this.root.hidden = false;
  }

  /** Zacht laten verdwijnen (CSS-animatie), daarna pas verbergen */
  hide() {
    if (!this.showing) return;
    this.showing = false;
    this.timer = -PAUSE;
    this.hints[this.index]?.button?.classList.remove('highlight');
    this.root.classList.add('leaving');
    setTimeout(() => {
      if (!this.showing) this.root.hidden = true;
    }, 400);
  }
}
