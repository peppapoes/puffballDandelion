import { Vector2, Vector3, Color, MathUtils } from 'three/webgpu';
import { uniform } from 'three/tsl';

/**
 * Gedeelde toestand van de wereld. Lucht, grond, bloemen, pluisjes en vuurvliegjes lezen
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

// Wind over de wei: kracht (0 = windstil) = basis + blazen in de microfoon
export const uWindStrength = uniform(0.6);

// Richting waarin de wind waait (genormaliseerd x/z), ingesteld met de windroos
export const uWindDirection = uniform(new Vector2(1, 0.35).normalize());

// Hoe ver de windgolven al opgeschoven zijn (m, x/z). Opgeteld per frame (richting × snelheid),
// zodat draaien aan de windroos of harder blazen de golven niet doet verspringen.
export const uWindOffset = uniform(new Vector2());

const WIND_BASE = 0.6; // windkracht zonder blazen
const WIND_BLOW = 1.4; // extra windkracht bij hard blazen (hoe harder, hoe meer)
const WIND_RISE = 2.5; // per seconde: hoe snel een windstoot opsteekt
const WIND_FALL = 0.6; // per seconde: hoe traag hij weer gaat liggen
const WIND_TURN = 2; // per seconde: hoe snel de wind naar een nieuwe richting draait
const WAVE_SPEED = 2.5; // m/s waarmee de windgolven over de wei trekken bij de basiswind

const windTarget = uWindDirection.value.clone(); // richting van de windroos (de wind draait er vloeiend naartoe)

/** Windroos: de wind waait in richting (x, z) */
export function setWindDirection(x, z) {
  windTarget.set(x, z).normalize();
}

/** Richting waarnaar de wind aan het draaien is (voor de windroos) */
export function getWindTarget() {
  return windTarget;
}

/** Elke frame: windkracht volgt het blazen (0..1), richting en golven schuiven op */
export function updateWind(delta, blow) {
  const strength = WIND_BASE + blow * WIND_BLOW;
  const rate = strength > uWindStrength.value ? WIND_RISE : WIND_FALL;
  uWindStrength.value += (strength - uWindStrength.value) * (1 - Math.exp(-rate * delta));

  const direction = uWindDirection.value;
  direction.lerp(windTarget, 1 - Math.exp(-WIND_TURN * delta)).normalize();

  // Sterkere wind = snellere golven
  const distance = WAVE_SPEED * (uWindStrength.value / WIND_BASE) * delta;
  uWindOffset.value.addScaledVector(direction, distance);
}

// Zonnestand voor de Circadian-lucht (Sky.js) en het zonlicht (App.js).
// uSunHeight komt overeen met 'uvMouse.y' uit de originele shader:
// < 0.5 = zon onder de horizon (sterren + noorderlicht), hoger = dag.
export const uSunHeight = uniform(0);
export const uSunDirection = uniform(new Vector3(0, 1, 0));

const SUN_HEIGHT_NIGHT = 0.32; // laagste stand in het origineel
const SUN_HEIGHT_SUNSET = 0.55; // net boven de horizon
const SUN_HEIGHT_NOON = 1.32; // hoogste stand in het origineel
const HALF_FOV = Math.tan(MathUtils.degToRad(60)) / 2; // 'fov/2.0' uit het origineel

// Kleur van de lucht net boven de horizon, voor de nevel over de wei (App.js).
// Gemeten in de Circadian-shader (zonder tonemapping), per uTimeOfDay.
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

  updateHorizonColor(t);
}

// Pijltjes: tikken = één stap, ingedrukt houden = de tijd loopt door.
// ↓ = vooruit in de tijd (richting nacht, dan weer ochtend), ↑ = achteruit (richting dag).
const CYCLE_STEP = 0.125; // één tik = een kwart van dag naar nacht
const CYCLE_HOLD_SPEED = 0.1; // ingedrukt: een volle dag in 10 seconden
const CYCLE_MAX_AHEAD = 0.5; // doel loopt nooit meer dan een halve dag voor (snel tikken)
const CYCLE_FOLLOW_SPEED = 0.6; // hoe snel de wereld het doel volgt (per seconde)

let heldDirection = 0; // -1 = ↑ ingedrukt, 1 = ↓ ingedrukt, 0 = niets

// Lichtmeter (webcam): helderheid van de kamer → dag/nacht. Pijltjes nemen even voorrang.
const ROOM_DARK = 0.1; // gemiddelde helderheid van het camerabeeld in een donkere kamer → nacht
const ROOM_BRIGHT = 0.45; // ... in een lichte kamer → dag
// Contrast (standaardafwijking van de vakjes): de webcam licht een donker beeld zelf op
// (automatische belichting), maar een bedekte camera of donkere kamer blijft vlak.
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
  // Venster verliest focus terwijl een pijltje ingedrukt is: niet blijven doorlopen
  window.addEventListener('blur', () => (heldDirection = 0));
}

/**
 * Kamer (webcam) → tijd van de dag (0 = nacht, 1 = dag).
 * Alleen licht ÉN contrast is dag: donker = nacht, maar ook een vlak beeld = nacht
 * (bedekte camera die de automatische belichting weer grijs-helder maakt).
 */
export function daylightFromRoom(brightness, contrast) {
  const light = MathUtils.smoothstep(brightness, ROOM_DARK, ROOM_BRIGHT);
  const detail = MathUtils.smoothstep(contrast, ROOM_FLAT, ROOM_DETAILED);
  return light * detail;
}

/** Volgt de wereld nu de pijltjes (true) of het licht van de kamer (false)? */
export function isManualOverride() {
  return performance.now() < manualUntil;
}

/**
 * Lichtmeter: helderheid en contrast van de kamer (webcam) sturen dag/nacht.
 * Kiest het dichtstbijzijnde punt in de cyclus met die tijd van de dag, zodat de wereld
 * niet plots de andere kant van de dag op draait. Doet niets kort na een pijltje.
 */
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

  // Exponentieel naar het doel toe: vloeiend en framerate-onafhankelijk
  cycle += (cycleTarget - cycle) * (1 - Math.exp(-CYCLE_FOLLOW_SPEED * delta));
  uTimeOfDay.value = timeOfDayFromCycle(cycle);
  updateSun();
}

updateSun();
