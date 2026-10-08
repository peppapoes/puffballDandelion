import * as THREE from 'three/webgpu';
import {
  Fn, Loop, If, float, vec2, vec3, vec4, texture, time, select,
  screenSize, screenCoordinate, positionWorldDirection,
  abs, clamp, cos, dot, exp, exp2, floor, fract, length, max, min, mix,
  normalize, pow, sin, smoothstep, sqrt, step,
} from 'three/tsl';
import { uSunHeight, uSunDirection, uHorizonColor } from '../state/worldState.js';

/**
 * De lucht: TSL-port van "Circadian" by Kiri
 * https://www.shadertoy.com/view/stdBWN
 * Origineel (GLSL) ter referentie in shaders/original/circadian.glsl
 *
 * Fysiek gebaseerde atmosfeer (Rayleigh + Mie scattering) met wolken,
 * sterren, noorderlicht en een spiegeling onder de horizon.
 *
 * Aanpassingen t.o.v. het origineel:
 * - kijkrichting komt van de Three.js-camera i.p.v. vaste schermcoördinaten
 * - zonnestand komt uit uTimeOfDay (pijltjes) i.p.v. automatisch uit iTime
 * - iChannel0 ("RGBA Noise Small") wordt in code nagemaakt
 * - uitgeschakelde onderdelen (regen, simple sun, blur) zijn weggelaten
 * - onder de horizon de nevelkleur i.p.v. een waterspiegeling (naadloos met de wei)
 * - geen gamma-correctie op het einde: Three.js doet de sRGB-omzetting zelf
 */

// --- Instellingen (de #defines en consts uit het origineel) ---

const CLOUDY = 0.5; // 0 = heldere lucht
const HAZE = 0.01 * (CLOUDY * 20);
const RAIN_MULTI = 5.0; // dikkere wolken
const CAMERA_HEIGHT = 5e1;
const MIN_CLOUD_HEIGHT = 5e3;
const MAX_CLOUD_HEIGHT = 8e3;
const CLOUD_NOISE = 2e-4;
const CLOUD_NEAR = 1.0;
const CLOUD_FAR = 1e3;

const STEPS = 16; // stappen langs de kijkstraal
const STEPS_SUN = 16; // stappen richting de zon

const R0 = 6360e3; // straal van de planeet
const RA = 6380e3; // straal van de atmosfeer
const I = 10; // kracht van het zonlicht
const SI = 5; // kracht van de zonneschijf
const G = 0.45; // concentratie van het licht (Mie)
const G2 = G * G;
const S = 0.999; // concentratie voor de zon
const S2 = S; // SOFT_SUN
const HR = 8e3; // hoogte Rayleigh-verstrooiing
const HM = 1.2e3; // hoogte Mie-verstrooiing
const TS = CAMERA_HEIGHT / 2.5e5;

const bM = vec3(21e-6); // Mie-coëfficiënt
const bR = vec3(5.8e-6, 13.5e-6, 33.1e-6); // Rayleigh-coëfficiënt (blauwe lucht)
const C = vec3(0, -R0, 0); // middelpunt van de planeet

// --- iChannel0: ruistextuur, nagemaakt in code ---

/**
 * Maakt de Shadertoy-textuur "RGBA Noise Small" na (256x256).
 * De truc van iq: groen = rood verschoven over (37, 17). Zo leest Noise()
 * met één textuur-lookup twee lagen van 3D-ruis tegelijk.
 */
function createNoiseTexture() {
  const SIZE = 256;
  const data = new Uint8Array(SIZE * SIZE * 4);

  // Vaste seed: elke keer dezelfde wolken
  let seed = 1337;
  const random = () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let r = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    r = (r + Math.imul(r ^ (r >>> 7), 61 | r)) ^ r;
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };

  for (let i = 0; i < SIZE * SIZE; i++) {
    data[i * 4 + 0] = random() * 255;
    data[i * 4 + 2] = random() * 255;
    data[i * 4 + 3] = random() * 255;
  }
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const source = ((y - 17) & 255) * SIZE + ((x - 37) & 255);
      data[(y * SIZE + x) * 4 + 1] = data[source * 4 + 0];
    }
  }

  const noiseTexture = new THREE.DataTexture(data, SIZE, SIZE);
  noiseTexture.wrapS = noiseTexture.wrapT = THREE.RepeatWrapping;
  noiseTexture.magFilter = noiseTexture.minFilter = THREE.LinearFilter;
  noiseTexture.generateMipmaps = false;
  noiseTexture.needsUpdate = true;
  return noiseTexture;
}

const noiseTexture = createNoiseTexture();

// --- Ruis ---

/** 2D-ruis: één textuur-lookup ('noise' in het origineel) */
const noise2D = Fn(([v]) => {
  return texture(noiseTexture, v.add(0.5).div(256)).level(0).r;
}, { v: 'vec2', return: 'float' });

/** 3D-ruis by iq ('Noise' in het origineel) */
const noise3D = Fn(([x]) => {
  const p = floor(x);
  const f = fract(x).toVar();
  f.assign(f.mul(f).mul(f.mul(-2).add(3)));

  const uv = p.xy.add(vec2(37, 17).mul(p.z)).add(f.xy);
  const rg = texture(noiseTexture, uv.add(0.5).div(256)).level(0).yx;
  return mix(rg.x, rg.y, f.z);
}, { x: 'vec3', return: 'float' });

/** Fractale ruis: 6 lagen ruis op elkaar, schuift mee in de tijd */
const fnoise = Fn(([pIn]) => {
  const p = pIn.mul(0.25).toVar();
  const f = float(0).toVar();

  f.addAssign(noise3D(p).mul(0.5));
  p.assign(p.mul(3.02).sub(vec3(0, time.mul(0.1), 0)));
  f.addAssign(noise3D(p).mul(0.25));
  p.assign(p.mul(3.03).add(vec3(0, time.mul(0.06), 0)));
  f.addAssign(noise3D(p).mul(0.125));
  p.assign(p.mul(3.01));
  f.addAssign(noise3D(p).mul(0.0625));
  p.assign(p.mul(3.03));
  f.addAssign(noise3D(p).mul(0.03125));
  p.assign(p.mul(3.02));
  f.addAssign(noise3D(p).mul(0.015625));

  return f;
}, { pIn: 'vec3', return: 'float' });

// --- Atmosfeer en wolken ---

/** Wolkendichtheid op een punt */
const cloud = Fn(([p]) => {
  const cld = smoothstep(0.44, 0.64, fnoise(p.mul(CLOUD_NOISE)).add(CLOUDY * 0.1)).toVar();
  cld.mulAssign(cld.mul(5 * RAIN_MULTI));
  return cld.add(HAZE);
}, { p: 'vec3', return: 'float' });

/**
 * Luchtdichtheid op een punt: x = Rayleigh (lucht), y = Mie (waas + wolken).
 * In het origineel een functie met twee 'out'-parameters; hier één vec2.
 */
const densities = Fn(([pos]) => {
  const h = length(pos.sub(C)).sub(R0);
  const rayleigh = exp(h.negate().div(HR));
  const dist = length(pos.xz);

  const cld = float(0).toVar();
  If(h.greaterThan(MIN_CLOUD_HEIGHT).and(h.lessThan(MAX_CLOUD_HEIGHT)), () => {
    // Wolken schuiven met de tijd (xaxiscloud / zaxiscloud)
    const moved = pos.add(vec3(time.mul(5e2), 0, time.mul(6e2)));
    cld.assign(cloud(moved).mul(CLOUDY));
    cld.mulAssign(sin(h.sub(MIN_CLOUD_HEIGHT).mul(3.1415).div(MIN_CLOUD_HEIGHT)).mul(CLOUDY));
  });

  // ORIG_CLOUD: geen wolken vlak boven de camera
  If(dist.lessThan(CLOUD_FAR), () => {
    cld.mulAssign(clamp(float(1).sub(float(CLOUD_FAR).sub(dist).div(CLOUD_FAR - CLOUD_NEAR)), 0, 1));
  });

  const mie = exp(h.negate().div(HM)).add(cld).add(HAZE);
  return vec2(rayleigh, mie);
}, { pos: 'vec3', return: 'vec2' });

/** Afstand tot waar een straal de bol met straal R verlaat (-1 = mist de bol) */
const escape = Fn(([p, d, R]) => {
  const v = p.sub(C);
  const b = dot(v, d);
  const c = dot(v, v).sub(R.mul(R));
  const det2 = b.mul(b).sub(c);
  const det = sqrt(max(det2, 0));
  const t1 = b.negate().sub(det);
  const t2 = b.negate().add(det);
  return select(det2.lessThan(0), float(-1), select(t1.greaterThanEqual(0), t1, t2));
}, { p: 'vec3', d: 'vec3', R: 'float', return: 'float' });

/**
 * Lichtverstrooiing langs de kijkstraal (de kleur van de lucht).
 * xyz = kleur, w = totale Mie-diepte (voor 'scat' in mainImage).
 * Uitleg: scratchapixel.com — simulating the colors of the sky
 */
const scatter = Fn(([o, d]) => {
  const L = escape(o, d, float(RA));
  const mu = dot(d, uSunDirection);
  const opmu2 = mu.mul(mu).add(1);
  const phaseR = opmu2.mul(0.0596831);
  const phaseM = opmu2.mul(0.1193662 * (1 - G2)).div(pow(mu.mul(-2 * G).add(1 + G2), 1.5).mul(2 + G2));
  const phaseS = opmu2.mul(0.1193662 * (1 - S2)).div(pow(mu.mul(-2 * S).add(1 + S2), 1.5).mul(2 + S2));

  const depthR = float(0).toVar();
  const depthM = float(0).toVar();
  const R = vec3(0).toVar();
  const M = vec3(0).toVar();
  const dl = L.div(STEPS);

  Loop(STEPS, ({ i }) => {
    const p = o.add(d.mul(dl.mul(float(i)))).toVar();
    const dens = densities(p).mul(dl).toVar(); // (dR, dM)
    depthR.addAssign(dens.x);
    depthM.addAssign(dens.y);

    const Ls = escape(p, uSunDirection, float(RA)).toVar();
    If(Ls.greaterThan(0), () => {
      // Hoeveel licht van de zon tot hier geraakt
      const dls = Ls.div(STEPS_SUN);
      const depthRs = float(0).toVar();
      const depthMs = float(0).toVar();

      Loop({ start: 0, end: STEPS_SUN, name: 'j' }, ({ j }) => {
        const ps = p.add(uSunDirection.mul(dls.mul(float(j))));
        const densSun = densities(ps).mul(dls).toVar();
        depthRs.addAssign(densSun.x);
        depthMs.addAssign(densSun.y);
      });

      const A = exp(bR.mul(depthRs.add(depthR)).add(bM.mul(depthMs.add(depthM))).negate()).toVar();
      R.addAssign(A.mul(dens.x));
      M.addAssign(A.mul(dens.y));
    });
  });

  // Mie (waas) + NICE_HACK_SUN (zonneschijf) + Rayleigh (blauw)
  const col = M.mul(bM).mul(phaseM.mul(I).add(phaseS.mul(SI))).add(R.mul(bR).mul(phaseR.mul(I)));
  return vec4(col, depthM);
}, { o: 'vec3', d: 'vec3', return: 'vec4' });

// --- Sterren ---

const hash33 = Fn(([pIn]) => {
  const p = fract(pIn.mul(vec3(443.8975, 397.2973, 491.1871))).toVar();
  p.addAssign(dot(p.zxy, p.yxz.add(19.27)));
  return fract(vec3(p.x.mul(p.y), p.z.mul(p.x), p.y.mul(p.z)));
}, { pIn: 'vec3', return: 'vec3' });

const stars = Fn(([pIn]) => {
  const p = pIn.toVar();
  const c = vec3(0).toVar();
  const res = screenSize.x.mul(2.5 * 0.15);

  Loop(4, ({ i }) => {
    const fi = float(i);
    const q = fract(p.mul(res)).sub(0.5);
    const id = floor(p.mul(res));
    const rn = hash33(id).xy.toVar();
    const c2 = float(1).sub(smoothstep(0, 0.6, length(q))).mul(step(rn.x, fi.mul(fi).mul(0.001).add(0.0005)));
    c.addAssign(c2.mul(mix(vec3(1, 0.49, 0.1), vec3(0.75, 0.9, 1), rn.y).mul(0.1).add(0.9)));
    p.mulAssign(1.3);
  });

  return c.mul(c).mul(0.8);
}, { pIn: 'vec3', return: 'vec3' });

// --- Noorderlicht (by nimitz) ---

/** v * mat2(c, s, -s, c) uit het origineel ('mm2') */
const rotate = (v, angle) => {
  const c = cos(angle);
  const s = sin(angle);
  return vec2(v.x.mul(c).add(v.y.mul(s)), v.y.mul(c).sub(v.x.mul(s)));
};

/** v * mat2(0.95534, 0.29552, -0.29552, 0.95534) uit het origineel ('m2') */
const rotateM2 = (v) => vec2(v.x.mul(0.95534).add(v.y.mul(0.29552)), v.y.mul(0.95534).sub(v.x.mul(0.29552)));

const tri = Fn(([x]) => clamp(abs(fract(x).sub(0.5)), 0.01, 0.49), { x: 'float', return: 'float' });

const tri2 = Fn(([p]) => vec2(tri(p.x).add(tri(p.y)), tri(p.y.add(tri(p.x)))), { p: 'vec2', return: 'vec2' });

const triNoise2d = Fn(([pIn, spd]) => {
  const p = rotate(pIn, pIn.x.mul(0.06)).toVar();
  const bp = vec2(p).toVar();
  const z = float(1.8).toVar();
  const z2 = float(2.5).toVar();
  const rz = float(0).toVar();

  Loop(5, () => {
    const dg = rotate(tri2(bp.mul(1.85)).mul(0.75), time.mul(spd));
    p.subAssign(dg.div(z2));
    bp.mulAssign(1.3);
    z2.mulAssign(1.45);
    z.mulAssign(0.42);
    p.mulAssign(rz.sub(1).mul(0.02).add(1.21));
    rz.addAssign(tri(p.x.add(tri(p.y))).mul(z));
    p.assign(rotateM2(p).negate());
  });

  return clamp(float(1).div(pow(rz.mul(29), 1.3)), 0, 0.55);
}, { pIn: 'vec2', spd: 'float', return: 'float' });

const hash21 = Fn(([n]) => fract(sin(dot(n, vec2(12.9898, 4.1414))).mul(43758.5453)), { n: 'vec2', return: 'float' });

/** 'dither' = hash21(gl_FragCoord.xy), als parameter want functies kennen gl_FragCoord niet */
const aurora = Fn(([roIn, rd, dither]) => {
  const ro = roIn.mul(1e-5);
  const col = vec4(0).toVar();
  const avgCol = vec4(0).toVar();

  Loop(5, ({ i }) => {
    const im = float(i).mul(10); // i * mt
    const of = dither.mul(0.006).mul(smoothstep(0, 15, im));
    const pt = pow(im, 1.2).mul(0.001).add(0.8).sub(rd.y).div(rd.y.mul(2).add(0.4)).sub(of);
    const bpos = ro.add(rd.mul(pt));
    const rzt = triNoise2d(bpos.zx, float(0.1)).toVar();
    const col2 = vec4(sin(vec3(-1.15, 1.5, -0.2).add(im.mul(0.053))).mul(5).mul(rzt), rzt);
    avgCol.assign(mix(avgCol, col2, 0.5));
    col.addAssign(avgCol.mul(exp2(im.mul(-0.04).sub(2.5))).mul(smoothstep(0, 5, im)));
  });

  col.mulAssign(clamp(rd.y.mul(15).add(0.4), 0, 1.2));
  return col.mul(2.8);
}, { roIn: 'vec3', rd: 'vec3', dither: 'float', return: 'vec4' });

// --- mainImage ---

export function createSkyNode() {
  return Fn(() => {
    const D = normalize(positionWorldDirection).toVar(); // kijkrichting van de camera
    const viewY = D.y.toVar(); // bewaren: D wordt hieronder gespiegeld voor de reflectie
    const O = vec3(0, CAMERA_HEIGHT, 0).toVar();

    const att = float(1).toVar();
    const star = vec3(0).toVar();
    const aur = vec4(0).toVar();

    const fade = smoothstep(0, 0.01, abs(D.y)).mul(0.5).add(0.9);
    const staratt = float(1).sub(min(1, uSunHeight.mul(2)));
    const scatatt = float(1).sub(min(1, uSunHeight.mul(2.2)));
    const dither = hash21(screenCoordinate.xy);
    const isNight = uSunHeight.lessThan(0.5);

    If(D.y.lessThan(-TS), () => {
      // Onder de horizon: spiegeling, alsof er water ligt
      O.assign(O.add(D.mul(O.y.negate().div(D.y))));
      const ripple = sin(time.add(noise2D(O.xz.add(vec2(0, time.mul(-1e3)))).mul(6.2831))).mul(0.003);
      D.assign(normalize(vec3(D.x, D.y.negate().add(ripple), D.z)));
      att.assign(0.6);
      star.assign(stars(D));
      If(isNight, () => {
        aur.assign(smoothstep(0, 2.5, aurora(O, D, dither)));
      });
    }).Else(() => {
      const O1 = O.add(D.mul(O.y.div(D.y)));
      const twinkle = sin(time.add(noise2D(O1.xz.add(vec2(0, time.mul(0.8)))).mul(6.2831))).mul(0.0009);
      star.assign(stars(normalize(D.add(vec3(1, twinkle, 0)))));
      If(isNight, () => {
        aur.assign(smoothstep(0, 1.5, aurora(O, D, dither)).mul(fade));
      });
    });

    star.mulAssign(att.mul(staratt));

    const scattered = scatter(O, D).toVar();
    const color = scattered.xyz.mul(att).toVar();
    const scat = bM.mul(scattered.w).mul(0.1).mul(att).mul(scatatt);

    color.addAssign(scat.mul(0.1));
    color.addAssign(star);
    color.addAssign(aur.rgb.mul(scatatt));

    // Aanpassing voor de wei: onder de horizon geen waterspiegeling maar de nevelkleur,
    // exact dezelfde als de nevel over de grond (App.js). Vlak boven de horizon loopt
    // de lucht er geleidelijk naartoe (±3°), als waas: zo is er nergens een naad.
    const haze = float(1).sub(smoothstep(-0.005, 0.05, viewY));
    return mix(color, uHorizonColor, haze);
  })();
}
