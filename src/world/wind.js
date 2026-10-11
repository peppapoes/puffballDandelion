import { Fn, vec3, time, sin, mx_noise_float } from 'three/tsl';
import { uWindStrength, uWindDirection, uWindOffset } from '../state/worldState.js';

/**
 * Het windveld: één gedeelde TSL-functie voor de bloemen en de vliegende pluisjes.
 *
 * Ruis die in de windrichting over de wei schuift, zodat vlagen als golven
 * over het veld trekken: bloemen buigen na elkaar mee, niet allemaal tegelijk.
 * Richting (windroos) en kracht (microfoon) komen uit worldState.js (updateWind).
 *
 * In:  xz = wereldpositie op de wei (vec2)
 * Uit: verplaatsing in x/z (vec2), richting = windrichting, grootte = lokale windkracht
 */
export const windAt = Fn(([xz]) => {
  const WAVE_SCALE = 0.08; // grootte van de windgolven (kleiner = bredere golven)

  // Ruis sampelen op een positie die tegen de windrichting in schuift (uWindOffset groeit met de wind mee)
  const p = xz.sub(uWindOffset).mul(WAVE_SCALE);
  const gust = mx_noise_float(vec3(p.x, p.y, time.mul(0.1))).mul(0.5).add(0.5); // 0..1

  // Klein, snel natrillen bovenop de grote golven
  const flutter = sin(time.mul(3.0).add(xz.x.mul(1.7)).add(xz.y.mul(1.3))).mul(0.08);

  return uWindDirection.mul(gust.add(flutter).mul(uWindStrength));
});
