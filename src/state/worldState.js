import { Vector2 } from 'three/webgpu';
import { uniform } from 'three/tsl';

/**
 * Gedeelde toestand van de wereld. Lucht, bloemen, pluisjes en audio lezen
 * allemaal dezelfde waarden, zodat dag/nacht en wind één geheel vormen.
 *
 * De TSL-uniforms (uTimeOfDay, uWindStrength, ...) gaan rechtstreeks naar de GPU;
 * de rest van de code leest .value.
 */

const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;

// 0 = nacht, 1 = dag. Startwaarde volgt de dark-mode-instelling van het systeem.
export const uTimeOfDay = uniform(prefersDark ? 0 : 1);

// Basiswind over de wei (0 = windstil). Muis, microfoon en vlagen tellen hier later bij op.
export const uWindStrength = uniform(0.6);

// Richting waarin de windgolven over de wei trekken (genormaliseerd x/z)
export const uWindDirection = uniform(new Vector2(1, 0.35).normalize());

// Doelwaarde voor dag/nacht: de pijltjes zetten het doel, update() glijdt er vloeiend naartoe
let timeOfDayTarget = uTimeOfDay.value;
const TIME_OF_DAY_STEP = 0.25;
const TIME_OF_DAY_SPEED = 0.6; // hoe snel de overgang volgt (per seconde)

export function initWorldStateInput() {
  window.addEventListener('keydown', (event) => {
    if (event.key === 'ArrowUp') {
      timeOfDayTarget = Math.min(1, timeOfDayTarget + TIME_OF_DAY_STEP);
    } else if (event.key === 'ArrowDown') {
      timeOfDayTarget = Math.max(0, timeOfDayTarget - TIME_OF_DAY_STEP);
    }
  });
}

export function updateWorldState(delta) {
  // Exponentieel naar het doel toe: vloeiend en framerate-onafhankelijk
  const t = 1 - Math.exp(-TIME_OF_DAY_SPEED * delta);
  uTimeOfDay.value += (timeOfDayTarget - uTimeOfDay.value) * t;
}
