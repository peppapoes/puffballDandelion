import { Vector2, Vector3, Color, MathUtils } from 'three/webgpu';
import { uniform } from 'three/tsl';

const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;

let cycle = prefersDark ? 0.5 : 0;
let cycleTarget = cycle;

export const uTimeOfDay = uniform(timeOfDayFromCycle(cycle));

function timeOfDayFromCycle(c) {
  const phase = c - Math.floor(c); // 0..1, ook voor negatieve waarden
  return 1 - 2 * Math.min(phase, 1 - phase); // middag 1 → middernacht 0 → middag 1
}

export const uWindStrength = uniform(0.6);

export const uWindDirection = uniform(new Vector2(1, 0.35).normalize());

export const uWindOffset = uniform(new Vector2());

const WIND_BASE = 0.6; // windkracht zonder blazen
const WIND_BLOW = 1.4; // extra windkracht bij hard blazen (hoe harder, hoe meer)
const WIND_RISE = 2.5; // per seconde: hoe snel een windstoot opsteekt
const WIND_FALL = 0.6; // per seconde: hoe traag hij weer gaat liggen
const WIND_TURN = 2; // per seconde: hoe snel de wind naar een nieuwe richting draait
const WAVE_SPEED = 2.5; // m/s waarmee de windgolven over de wei trekken bij de basiswind

const windTarget = uWindDirection.value.clone(); // richting van de windroos (de wind draait er vloeiend naartoe)

export function setWindDirection(x, z) {
  windTarget.set(x, z).normalize();
}

export function getWindTarget() {
  return windTarget;
}

export function updateWind(delta, blow) {
  const strength = WIND_BASE + blow * WIND_BLOW;
  const rate = strength > uWindStrength.value ? WIND_RISE : WIND_FALL;
  uWindStrength.value += (strength - uWindStrength.value) * (1 - Math.exp(-rate * delta));

  const direction = uWindDirection.value;
  direction.lerp(windTarget, 1 - Math.exp(-WIND_TURN * delta)).normalize();

  const distance = WAVE_SPEED * (uWindStrength.value / WIND_BASE) * delta;
  uWindOffset.value.addScaledVector(direction, distance);
}

export const uSunHeight = uniform(0);
export const uSunDirection = uniform(new Vector3(0, 1, 0));

const SUN_HEIGHT_NIGHT = 0.32; // laagste stand in het origineel
const SUN_HEIGHT_SUNSET = 0.55; // net boven de horizon
const SUN_HEIGHT_NOON = 1.32; // hoogste stand in het origineel
const HALF_FOV = Math.tan(MathUtils.degToRad(60)) / 2; // 'fov/2.0' uit het origineel

export const uHorizonColor = uniform(new Color());

const HORIZON_KEYS = [
  [0, new Color('#0b1110')], // middernacht
  [0.25, new Color('#0d0803')], // late schemering
  [0.375, new Color('#241a0a')], // schemering
  [0.5, new Color('#392d16')], // zonsondergang
  [0.625, new Color('#6b654d')], // gouden uur
  [0.75, new Color('#70736a')], // namiddag
  [0.875, new Color('#646d6f')],
  [1, new Color('#646f74')], // middag
];

function updateHorizonColor(t) {
  for (let i = 1; i < HORIZON_KEYS.length; i++) {
    const [t1, c1] = HORIZON_KEYS[i];
    if (t <= t1) {
      const [t0, c0] = HORIZON_KEYS[i - 1];
      uHorizonColor.value.lerpColors(c0, c1, (t - t0) / (t1 - t0));
      return;
    }
  }
}

function updateSun() {
  const t = uTimeOfDay.value;
  const height =
    t < 0.5
      ? MathUtils.lerp(SUN_HEIGHT_NIGHT, SUN_HEIGHT_SUNSET, t * 2)
      : MathUtils.lerp(SUN_HEIGHT_SUNSET, SUN_HEIGHT_NOON, (t - 0.5) * 2);
  const side = Math.sin(cycle * Math.PI * 2) * 1.1;

  const front = t < 0.5 ? -HALF_FOV : MathUtils.lerp(-HALF_FOV, 0.6, (t - 0.5) * 2);

  uSunHeight.value = height;
  uSunDirection.value.set(side, height - 0.5, front).normalize();

  updateHorizonColor(t);
}

const CYCLE_STEP = 0.125; // één tik = een kwart van dag naar nacht
const CYCLE_HOLD_SPEED = 0.1; // ingedrukt: een volle dag in 10 seconden
const CYCLE_MAX_AHEAD = 0.5; // doel loopt nooit meer dan een halve dag voor (snel tikken)
const CYCLE_FOLLOW_SPEED = 0.6; // hoe snel de wereld het doel volgt (per seconde)

let heldDirection = 0; // -1 = ↑ ingedrukt, 1 = ↓ ingedrukt, 0 = niets

const ROOM_DARK = 0.1; // gemiddelde helderheid van het camerabeeld in een donkere kamer → nacht
const ROOM_BRIGHT = 0.45; // ... in een lichte kamer → dag
const ROOM_FLAT = 0.03; // daaronder: vlak beeld → nacht, hoe helder de camera het ook maakt
const ROOM_DETAILED = 0.08; // daarboven: gewone kamer met vormen en randen
const MANUAL_OVERRIDE_MS = 20000; // na een pijltje volgt de wereld 20 s de pijltjes, niet het licht
let manualUntil = 0;

const KEY_DIRECTIONS = { ArrowUp: -1, ArrowDown: 1 };

export function initWorldStateInput() {
  window.addEventListener('keydown', (event) => {
    const direction = KEY_DIRECTIONS[event.key];
    if (!direction) return;
    event.preventDefault(); // pagina niet laten scrollen
    manualUntil = performance.now() + MANUAL_OVERRIDE_MS;
    if (event.repeat) return; // automatische herhaling: update() regelt het doorlopen
    cycleTarget += direction * CYCLE_STEP;
    heldDirection = direction;
  });

  window.addEventListener('keyup', (event) => {
    if (KEY_DIRECTIONS[event.key] === heldDirection) heldDirection = 0;
    manualUntil = performance.now() + MANUAL_OVERRIDE_MS;
  });
  window.addEventListener('blur', () => (heldDirection = 0));
}

export function daylightFromRoom(brightness, contrast) {
  const light = MathUtils.smoothstep(brightness, ROOM_DARK, ROOM_BRIGHT);
  const detail = MathUtils.smoothstep(contrast, ROOM_FLAT, ROOM_DETAILED);
  return light * detail;
}

export function isManualOverride() {
  return performance.now() < manualUntil;
}

export function setDaylightFromRoom(brightness, contrast) {
  if (performance.now() < manualUntil) return;

  const t = daylightFromRoom(brightness, contrast); // 0 = nacht, 1 = dag
  const evening = (1 - t) / 2; // die tijd van de dag op de avondkant van de cyclus (0..0.5)
  const base = Math.floor(cycle);
  let best = cycleTarget;
  let bestDistance = Infinity;
  for (const candidate of [base - 1, base, base + 1].flatMap((k) => [k + evening, k + 1 - evening])) {
    const distance = Math.abs(candidate - cycle);
    if (distance < bestDistance) {
      best = candidate;
      bestDistance = distance;
    }
  }
  cycleTarget = best;
}

export function updateWorldState(delta) {
  cycleTarget += heldDirection * CYCLE_HOLD_SPEED * delta;
  cycleTarget = MathUtils.clamp(cycleTarget, cycle - CYCLE_MAX_AHEAD, cycle + CYCLE_MAX_AHEAD);

  cycle += (cycleTarget - cycle) * (1 - Math.exp(-CYCLE_FOLLOW_SPEED * delta));
  uTimeOfDay.value = timeOfDayFromCycle(cycle);
  updateSun();
}

updateSun();
