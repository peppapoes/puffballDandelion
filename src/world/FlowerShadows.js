import {
  Fn, If, float, int, vec2, vec3, instancedArray, instanceIndex, normalize, dot, length, clamp, max, round, floor, fract,
  mix, smoothstep, select,
} from 'three/tsl';
import { uTimeOfDay, uSunDirection } from '../state/worldState.js';
import { heightAtNode } from './terrain.js';
import { GRID } from './Meadow.js';

const MAP_SIZE = 512;
const MAP_EXTENT = GRID.cells * GRID.spacing + 2; // m: de hele wei plus een randje
const MAP_ORIGIN = -MAP_EXTENT / 2;
const UPDATE_EVERY = 2; // schaduwkaart om de 2 frames opnieuw berekenen

const SUN_MIN_HEIGHT = 0.55;
const SEARCH_HEIGHT = 1.8; // m: typische hoogte van een bol; daar zoeken we de bloemen die schaduw kunnen geven
const PUFF_SHADOW = 0.4; // een pluizenbol is luchtig: zachte, halfdonkere schaduw
const PUFF_SOFT = 0.35; // binnen 35% van de straal volle schaduw, daarbuiten zacht uitlopend
const STEM_SHADOW = 0.4;
const STEM_WIDTH = 0.07; // m: halve breedte van de steelschaduw (iets breder dan echt: een vakje is ±14 cm)
const FOOT_SHADOW = 0.3; // donker plekje aan de voet van de steel (licht dat er nergens bij kan)
const FOOT_RADIUS = 0.25; // m
const NIGHT_SHADOW = 0.3; // 's nachts (maanlicht): veel zwakkere schaduwen

export class FlowerShadows {
  constructor(renderer, meadow) {
    this.renderer = renderer;
    this.meadow = meadow;
    this.map = instancedArray(MAP_SIZE * MAP_SIZE, 'float'); // 1 = vol licht, lager = schaduw
    this.compute = this.createCompute().compute(MAP_SIZE * MAP_SIZE);
  }

  createCompute() {
    const { meadow } = this;

    return Fn(() => {
      const texel = vec2(float(instanceIndex.mod(MAP_SIZE)), float(instanceIndex.div(MAP_SIZE))).add(0.5);
      const xz = texel.mul(MAP_EXTENT / MAP_SIZE).add(MAP_ORIGIN);
      const p = vec3(xz.x, heightAtNode(xz), xz.y).toVar();
      const toSun = normalize(vec3(uSunDirection.x, max(uSunDirection.y, SUN_MIN_HEIGHT), uSunDirection.z)).toVar();

      const search = xz.add(toSun.xz.div(toSun.y).mul(SEARCH_HEIGHT));
      const cell = round(search.sub(GRID.origin).div(GRID.spacing)).toVar();

      const light = float(1).toVar();
      for (let dz = -1; dz <= 1; dz++) {
        for (let dx = -1; dx <= 1; dx++) {
          const ix = cell.x.add(dx);
          const iz = cell.y.add(dz);
          const inside = ix.greaterThanEqual(0).and(ix.lessThan(GRID.cells)).and(iz.greaterThanEqual(0)).and(iz.lessThan(GRID.cells));
          const index = int(clamp(iz, 0, GRID.cells - 1).mul(GRID.cells).add(clamp(ix, 0, GRID.cells - 1)));
          const flower = meadow.shadowGrid.element(index);

          If(inside.and(flower.greaterThanEqual(0)), () => {
            const head = meadow.headWorld.element(int(flower));
            const foot = meadow.flowerBuffer.element(int(flower)).xyz;

            const toHead = head.xyz.sub(p);
            const along = dot(toHead, toSun);
            const miss = length(toHead.sub(toSun.mul(along)));
            const inFront = select(along.greaterThan(0), float(1), float(0)); // bol tussen grond en zon
            const puff = smoothstep(head.w, head.w.mul(PUFF_SOFT), miss).mul(inFront);

            const stem = head.xyz.sub(foot);
            const w0 = p.sub(foot);
            const b = dot(toSun, stem);
            const c = dot(stem, stem);
            const d = dot(toSun, w0);
            const e = dot(stem, w0);
            const s = clamp(e.sub(b.mul(d)).div(max(c.sub(b.mul(b)), 1e-5)), 0, 1); // plek op de steel (0..1)
            const onStem = foot.add(stem.mul(s));
            const t = dot(onStem.sub(p), toSun); // plek op de straal
            const gap = length(p.add(toSun.mul(t)).sub(onStem));
            const stemShadow = smoothstep(STEM_WIDTH, STEM_WIDTH * 0.3, gap).mul(select(t.greaterThan(0), float(1), float(0)));

            const footShadow = smoothstep(FOOT_RADIUS, 0, length(xz.sub(foot.xz)));

            light.mulAssign(float(1).sub(puff.mul(PUFF_SHADOW)));
            light.mulAssign(float(1).sub(stemShadow.mul(STEM_SHADOW)));
            light.mulAssign(float(1).sub(footShadow.mul(FOOT_SHADOW)));
          });
        }
      }

      const sunHigh = smoothstep(0.1, 0.5, uSunDirection.y);
      const strength = mix(float(NIGHT_SHADOW), float(1), uTimeOfDay.mul(sunHigh));
      this.map.element(instanceIndex).assign(mix(float(1), light, strength));
    })();
  }

  update() {
    this.frame = (this.frame ?? 0) + 1;
    if (this.frame % UPDATE_EVERY === 0) this.renderer.compute(this.compute);
  }

  lightAt(xz) {
    const texel = xz.sub(MAP_ORIGIN).mul(MAP_SIZE / MAP_EXTENT).sub(0.5);
    const base = floor(texel);
    const f = fract(texel);
    const read = (ox, oz) => {
      const x = base.x.add(ox);
      const z = base.y.add(oz);
      const inside = x.greaterThanEqual(0).and(x.lessThan(MAP_SIZE)).and(z.greaterThanEqual(0)).and(z.lessThan(MAP_SIZE));
      const index = int(clamp(z, 0, MAP_SIZE - 1).mul(MAP_SIZE).add(clamp(x, 0, MAP_SIZE - 1)));
      return select(inside, this.map.element(index), float(1)); // buiten de wei: geen schaduw
    };
    return mix(mix(read(0, 0), read(1, 0), f.x), mix(read(0, 1), read(1, 1), f.x), f.y);
  }
}
