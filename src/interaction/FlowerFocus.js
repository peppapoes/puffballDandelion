import * as THREE from 'three/webgpu';
import { OVERVIEW_LIMITS, FOCUS_LIMITS, applyCameraLimits } from '../core/camera.js';

const CLICK_TOLERANCE = 5; // px: meer bewegen tussen indrukken en loslaten = slepen (camera draaien), geen klik
const PICK_MARGIN = 1.1; // een klik net naast de pluisjes telt nog voor die bloem
const FLY_DURATION = 1.2; // seconden voor het inzoomen en terugkeren
const FOCUS_DISTANCE = 3.5; // × straal van de pluizenbol: zo ver staat de camera na het inzoomen
const FOCUS_ELEVATION = THREE.MathUtils.degToRad(20); // een beetje van boven op de bol kijken

/**
 * Inzoomen op één bloem:
 * - klik op een bloem: camera en draaipunt glijden vloeiend naar de pluizenbol
 * - ingezoomd: rond de bloem draaien en dichterbij komen (FOCUS_LIMITS)
 * - Escape of een klik naast de bloem: terug naar waar je in de wei stond
 *
 * Alleen de camera verandert: wind, physics en vuurvliegjes lopen gewoon door.
 * De gekozen bloem beweegt nog maar zachtjes (meadow.uFocusIndex / uFocusHold).
 */
export class FlowerFocus {
  constructor(camera, controls, canvas, meadow) {
    this.camera = camera;
    this.controls = controls;
    this.canvas = canvas;
    this.meadow = meadow;

    this.focused = null; // nummer van de bloem waarop ingezoomd is, of null
    this.saved = null; // camera en draaipunt in de wei, om naar terug te keren
    this.flight = null; // lopende overgang (inzoomen of terug), of null
    this.raycaster = new THREE.Raycaster();
    this.pressed = null; // waar de muisknop ingedrukt werd

    canvas.addEventListener('pointerdown', (event) => {
      if (event.button === 0) this.pressed = { x: event.clientX, y: event.clientY };
    });
    canvas.addEventListener('pointerup', (event) => {
      if (!this.pressed) return;
      const moved = Math.hypot(event.clientX - this.pressed.x, event.clientY - this.pressed.y);
      this.pressed = null;
      if (moved < CLICK_TOLERANCE) this.onClick(event);
    });
    window.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') this.back();
    });
  }

  /** Minimale hoogte van de camera boven de grond: laag bij een bloem (en onderweg), hoog in de wei */
  get minHeight() {
    return this.focused !== null ? FOCUS_LIMITS.minHeight : OVERVIEW_LIMITS.minHeight;
  }

  /**
   * Voor de scherptediepte (core/postprocessing.js): null in de wei, anders
   * strength (0..1, glijdt mee met de overgang), de afstand tot de bol langs de kijkrichting
   * en de straal van de bol
   */
  get depthOfField() {
    const strength = this.meadow.uFocusHold.value;
    if (this.focused === null || strength <= 0) return null;
    const toHead = this.focusHead.clone().sub(this.camera.position);
    const look = this.camera.getWorldDirection(new THREE.Vector3());
    return { strength, distance: toHead.dot(look), radius: this.focusRadius };
  }

  onClick(event) {
    if (this.flight) return; // tijdens een overgang niet opnieuw beginnen
    const rect = this.canvas.getBoundingClientRect();
    const ndc = new THREE.Vector2(
      ((event.clientX - rect.left) / rect.width) * 2 - 1,
      -((event.clientY - rect.top) / rect.height) * 2 + 1
    );
    this.raycaster.setFromCamera(ndc, this.camera);
    const index = this.pick(this.raycaster.ray);

    if (this.focused === null) {
      if (index !== null) this.focus(index);
    } else if (index !== this.focused) {
      this.back(); // klik naast de bloem
    }
  }

  /**
   * Welke bloem raakt de straal? De bol in rust (zonder wind) die het dichtst bij de straal
   * ligt en het dichtst bij de camera staat. Op de CPU: de GPU-instances kan de gewone
   * raycaster niet zien, en 4000 bollen nakijken bij een klik is snel genoeg.
   */
  pick(ray) {
    const head = new THREE.Vector3();
    let best = null;
    let bestDepth = Infinity;
    this.meadow.flowers.forEach((flower, i) => {
      head.copy(flower.position).add(flower.headOffset);
      const depth = head.clone().sub(ray.origin).dot(ray.direction); // afstand langs de straal
      if (depth <= 0 || depth >= bestDepth) return;
      const radius = this.meadow.headRadius * flower.scale * PICK_MARGIN;
      if (ray.distanceSqToPoint(head) < radius * radius) {
        best = i;
        bestDepth = depth;
      }
    });
    return best;
  }

  /** Inzoomen op bloem i: camera schuin voor de bol, aan de kant waar je al stond */
  focus(i) {
    const flower = this.meadow.flowers[i];
    const head = flower.position.clone().add(flower.headOffset);
    const radius = this.meadow.headRadius * flower.scale;

    // Richting van de bol naar de camera, horizontaal: je blijft aan dezelfde kant staan
    const side = this.camera.position.clone().sub(head).setY(0).normalize();
    const distance = FOCUS_DISTANCE * radius;
    const position = head.clone()
      .addScaledVector(side, Math.cos(FOCUS_ELEVATION) * distance)
      .add(new THREE.Vector3(0, Math.sin(FOCUS_ELEVATION) * distance, 0));

    this.saved = { position: this.camera.position.clone(), target: this.controls.target.clone() };
    this.focusHead = head; // voor de scherptediepte (depthOfField)
    this.focusRadius = radius;
    this.focused = i;
    this.meadow.uFocusIndex.value = i;
    this.fly(position, head, 1, () => applyCameraLimits(this.controls, FOCUS_LIMITS, radius));
  }

  /** Terug naar de wei, naar waar je stond voor het inzoomen */
  back() {
    if (this.focused === null || this.flight) return;
    this.fly(this.saved.position, this.saved.target, 0, () => {
      applyCameraLimits(this.controls, OVERVIEW_LIMITS);
      this.focused = null;
      this.meadow.uFocusIndex.value = -1;
    });
  }

  /** Overgang starten: camera, draaipunt en "vasthouden" van de bloem glijden samen */
  fly(position, target, hold, onDone) {
    this.flight = {
      fromPosition: this.camera.position.clone(),
      fromTarget: this.controls.target.clone(),
      fromHold: this.meadow.uFocusHold.value,
      position,
      target,
      hold,
      t: 0,
      onDone,
    };
    this.controls.enabled = false; // niet slepen tijdens de overgang
  }

  /** Elke frame (in plaats van controls.update()): overgang afspelen of de camera gewoon laten draaien */
  update(delta) {
    const flight = this.flight;
    if (!flight) {
      this.controls.update();
      return;
    }

    flight.t = Math.min(1, flight.t + delta / FLY_DURATION);
    const e = easeInOutCubic(flight.t);
    this.camera.position.lerpVectors(flight.fromPosition, flight.position, e);
    this.controls.target.lerpVectors(flight.fromTarget, flight.target, e);
    this.camera.lookAt(this.controls.target);
    this.meadow.uFocusHold.value = THREE.MathUtils.lerp(flight.fromHold, flight.hold, e);

    if (flight.t === 1) {
      this.flight = null;
      flight.onDone();
      this.controls.enabled = true;
      this.controls.update();
    }
  }
}

/** Zacht vertrekken, zacht landen: traag → snel → traag */
function easeInOutCubic(t) {
  return t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2;
}
