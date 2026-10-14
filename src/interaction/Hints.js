import { isManualOverride } from '../state/worldState.js';

const CENTER_DELAY = 2; // s na de start: tip in het midden (rondkijken en zoomen)
const CENTER_TIME = 10; // s: zo lang blijft die staan, tenzij je al sleept of scrolt
const FIRST_DELAY = 4; // s na de tip in het midden: de eerste tip onderaan
const SHOW_TIME = 14; // s: zo lang blijft een tip staan
const PAUSE = 8; // s tussen twee tips
const FOCUS_HINT_TIME = 6; // s: tip "terug naar de wei" na het inzoomen op een bloem
const MOUSE_TRAVEL = 1500; // px muisbeweging over de wei: dan heb je de eerste tip al ontdekt

/**
 * Tips na het starten. Eerst één in het midden van het scherm: slepen om rond te kijken,
 * scrollen om te zoomen. Die verdwijnt zodra je de camera zelf beweegt (OrbitControls).
 *
 * Daarna een zacht kaartje onderaan dat vertelt wat je nog kan proberen,
 * met een knop om het meteen te doen (bv. de camera aanzetten). De bijhorende knop
 * rechtsonder pulseert zolang de tip staat.
 *
 * De tips komen één voor één. Een tip die je al gedaan hebt (camera staat al aan, je bent al
 * ingezoomd, ...) wordt overgeslagen, en verdwijnt vanzelf als je hem uitvoert terwijl hij staat.
 */
export class Hints {
  constructor({ cameraVision, microphone, flowerFocus, controls }) {
    // Tip bovenaan zodra je op een bloem ingezoomd bent: hoe kom je terug naar de wei?
    this.flowerFocus = flowerFocus;
    this.focusHint = document.getElementById('focus-hint');
    this.focusTimer = 0;
    this.wasZoomed = false;

    // Tip in het midden: heb je al zelf rondgekeken of gezoomd? 'start' = je begint te slepen of
    // te scrollen, 'change' = de camera beweegt (ook door de vloeiende inzoom-vlucht, daarom
    // alleen tellen tussen 'start' en 'end')
    this.center = document.getElementById('center-hint');
    this.centerTimer = -CENTER_DELAY;
    this.lookedAround = false;
    let dragging = false;
    controls.addEventListener('start', () => (dragging = true));
    controls.addEventListener('end', () => (dragging = false));
    controls.addEventListener('change', () => {
      if (dragging) this.lookedAround = true;
    });

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

  /** Elke frame: eerst de tip in het midden, daarna de volgende tip onderaan */
  update(delta) {
    // Na een haperend frame (bv. het opstarten van het geluid) niet in één keer een tip overslaan
    delta = Math.min(delta, 0.1);
    this.updateFocusHint(delta); // ook als alle andere tips al gezien zijn
    if (!this.started) return;
    if (!this.centerDone) {
      this.updateCenter(delta);
      return;
    }
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

  /**
   * Ingezoomd op een bloem (en de camera is aangekomen): tip bovenaan, FOCUS_HINT_TIME lang.
   * Elke keer opnieuw als je inzoomt; terug naar de wei = meteen weg.
   */
  updateFocusHint(delta) {
    const zoomed = this.flowerFocus.focused !== null && !this.flowerFocus.flight;
    if (zoomed && !this.wasZoomed) {
      this.focusTimer = 0;
      this.focusHint.classList.remove('leaving');
      this.focusHint.hidden = false;
    }
    this.wasZoomed = zoomed;
    if (this.focusHint.hidden || this.focusHint.classList.contains('leaving')) return;

    this.focusTimer += delta;
    if (!zoomed || this.focusTimer > FOCUS_HINT_TIME) {
      this.focusHint.classList.add('leaving');
      setTimeout(() => {
        if (this.focusHint.classList.contains('leaving')) this.focusHint.hidden = true;
      }, 600);
    }
  }

  /** Tip in het midden: na CENTER_DELAY tonen, weg als je rondkijkt of na CENTER_TIME */
  updateCenter(delta) {
    this.centerTimer += delta;
    const visible = !this.center.hidden;
    if (!visible && this.centerTimer >= 0 && !this.lookedAround && this.flowerFocus.focused === null) {
      this.center.classList.remove('leaving');
      this.center.hidden = false;
      return;
    }
    // Ook weg als je op een bloem inzoomt: anders staat ze midden over de pluizenbol
    const zooming = this.flowerFocus.focused !== null;
    if (this.lookedAround || zooming || this.centerTimer > CENTER_TIME) {
      this.centerDone = true; // vanaf nu de tips onderaan (na FIRST_DELAY)
      if (!visible) return;
      this.center.classList.add('leaving');
      setTimeout(() => (this.center.hidden = true), 600);
    }
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
