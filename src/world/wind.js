import { Fn, vec3, time, sin, mx_noise_float } from 'three/tsl';
import { uWindStrength, uWindDirection, uWindOffset } from '../state/worldState.js';

export const windAt = Fn(([xz]) => {
  const WAVE_SCALE = 0.08; // grootte van de windgolven (kleiner = bredere golven)

  const p = xz.sub(uWindOffset).mul(WAVE_SCALE);
  const gust = mx_noise_float(vec3(p.x, p.y, time.mul(0.1))).mul(0.5).add(0.5); // 0..1

  const flutter = sin(time.mul(3.0).add(xz.x.mul(1.7)).add(xz.y.mul(1.3))).mul(0.08);

  return uWindDirection.mul(gust.add(flutter).mul(uWindStrength));
});
