import { Fn, sin, cos } from 'three/tsl';

export function heightAt(x, z) {
  return (
    Math.sin(x * 0.15) * 0.8 +
    Math.cos(z * 0.12) * 0.6 +
    Math.sin((x + z) * 0.07) * 1.0
  );
}

export const heightAtNode = Fn(([xz]) =>
  sin(xz.x.mul(0.15)).mul(0.8)
    .add(cos(xz.y.mul(0.12)).mul(0.6))
    .add(sin(xz.x.add(xz.y).mul(0.07)).mul(1.0))
, { xz: 'vec2', return: 'float' });
