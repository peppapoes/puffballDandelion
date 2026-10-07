import { Vector2, Vector3, MathUtils } from 'three/webgpu';
import { uniform } from 'three/tsl';

/**
 * Gedeelde toestand van de wereld. Lucht, bloemen, pluisjes en audio lezen
 * allemaal dezelfde waarden, zodat dag/nacht en wind één geheel vormen.
 *
 * De TSL-uniforms (uTimeOfDay, uWindStrength, ...) gaan rechtstreeks naar de GPU;
 * de rest van de code leest .value.
 */

const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;

// Doorlopende dagcyclus: 0 = middag, 0.25 = zonsondergang, 0.5 = middernacht,
// 0.75 = zonsopgang, 1 = weer middag, ... Nooit begrensd, zodat de pijltjes eindeloos rondgaan.
// Startwaarde volgt de dark-mode-instelling van het systeem.
let cycle = prefersDark ? 0.5 : 0;
let cycleTarget = cycle;

// 0 = nacht, 1 = dag. Afgeleid van de cyclus; lucht, grond, bloemen en licht lezen dit.
export const uTimeOfDay = uniform(timeOfDayFromCycle(cycle));

function timeOfDayFromCycle(c) {
  const phase = c - Math.floor(c); // 0..1, ook voor negatieve waarden
  return 1 - 2 * Math.min(phase, 1 - phase); // middag 1 → middernacht 0 → middag 1
}

// Basiswind over de wei (0 = windstil). Muis, microfoon en vlagen tellen hier later bij op.
export const uWindStrength = uniform(0.6);

// Richting waarin de windgolven over de wei trekken (genormaliseerd x/z)
export const uWindDirection = uniform(new Vector2(1, 0.35).normalize());

// Zonnestand voor de Circadian-lucht (Sky.js) en het zonlicht (App.js).
// uSunHeight komt overeen met 'uvMouse.y' uit de originele shader:
// < 0.5 = zon onder de horizon (sterren + noorderlicht), hoger = dag.
export const uSunHeight = uniform(0);
export const uSunDirection = uniform(new Vector3(0, 1, 0));

const SUN_HEIGHT_NIGHT = 0.32; // laagste stand in het origineel
const SUN_HEIGHT_SUNSET = 0.55; // net boven de horizon
const SUN_HEIGHT_NOON = 1.32; // hoogste stand in het origineel
const HALF_FOV = Math.tan(MathUtils.degToRad(60)) / 2; // 'fov/2.0' uit het origineel

function updateSun() {
  const t = uTimeOfDay.value;
  // 0 → 0.5 → 1 = nacht → zonsondergang → middag
  const height =
    t < 0.5
      ? MathUtils.lerp(SUN_HEIGHT_NIGHT, SUN_HEIGHT_SUNSET, t * 2)
      : MathUtils.lerp(SUN_HEIGHT_SUNSET, SUN_HEIGHT_NOON, (t - 0.5) * 2);
  // Zon gaat rond: 's avonds onder aan de ene kant (+x), 's ochtends op aan de andere (-x),
  // zoals 'uvMouse.x' in het origineel
  const side = Math.sin(cycle * Math.PI * 2) * 1.1;

  // Bij zonsondergang staat de zon vóór de camera (-z, zoals in het origineel);
  // overdag schuift ze naar achter, zodat je in het blauw kijkt en niet in de gloed
  const front = t < 0.5 ? -HALF_FOV : MathUtils.lerp(-HALF_FOV, 0.6, (t - 0.5) * 2);

  uSunHeight.value = height;
  // Zelfde opbouw als 'Ds' in het origineel
  uSunDirection.value.set(side, height - 0.5, front).normalize();
}

// Pijltjes: tikken = één stap, ingedrukt houden = de tijd loopt door.
// ↓ = vooruit in de tijd (richting nacht, dan weer ochtend), ↑ = achteruit (richting dag).
const CYCLE_STEP = 0.125; // één tik = een kwart van dag naar nacht
const CYCLE_HOLD_SPEED = 0.1; // ingedrukt: een volle dag in 10 seconden
const CYCLE_MAX_AHEAD = 0.5; // doel loopt nooit meer dan een halve dag voor (snel tikken)
const CYCLE_FOLLOW_SPEED = 0.6; // hoe snel de wereld het doel volgt (per seconde)

let heldDirection = 0; // -1 = ↑ ingedrukt, 1 = ↓ ingedrukt, 0 = niets

const KEY_DIRECTIONS = { ArrowUp: -1, ArrowDown: 1 };

export function initWorldStateInput() {
  window.addEventListener('keydown', (event) => {
    const direction = KEY_DIRECTIONS[event.key];
    if (!direction) return;
    event.preventDefault(); // pagina niet laten scrollen
    if (event.repeat) return; // automatische herhaling: update() regelt het doorlopen
    cycleTarget += direction * CYCLE_STEP;
    heldDirection = direction;
  });

  window.addEventListener('keyup', (event) => {
    if (KEY_DIRECTIONS[event.key] === heldDirection) heldDirection = 0;
  });
  // Venster verliest focus terwijl een pijltje ingedrukt is: niet blijven doorlopen
  window.addEventListener('blur', () => (heldDirection = 0));
}

export function updateWorldState(delta) {
  cycleTarget += heldDirection * CYCLE_HOLD_SPEED * delta;
  cycleTarget = MathUtils.clamp(cycleTarget, cycle - CYCLE_MAX_AHEAD, cycle + CYCLE_MAX_AHEAD);

  // Exponentieel naar het doel toe: vloeiend en framerate-onafhankelijk
  cycle += (cycleTarget - cycle) * (1 - Math.exp(-CYCLE_FOLLOW_SPEED * delta));
  uTimeOfDay.value = timeOfDayFromCycle(cycle);
  updateSun();
}

updateSun();
