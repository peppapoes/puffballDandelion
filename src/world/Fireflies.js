import * as THREE from 'three/webgpu';
import {
  Fn, If, float, vec2, vec3, uniform, instancedArray, instanceIndex, positionGeometry, positionView, uv, varyingProperty,
  time, sin, cos, fract, dot, mod, exp, length, mix, smoothstep, select, clamp, normalize,
} from 'three/tsl';
import { uTimeOfDay } from '../state/worldState.js';
import { heightAt } from './terrain.js';

const COUNT = 300; // aantal vuurvliegjes (origineel: 35 op één scherm)
const AREA_RADIUS = 30; // ze zweven boven de wei (m)
const HEIGHT_MIN = 0.3; // hoogte boven de grond (m): tussen de bloemen ...
const HEIGHT_MAX = 1.8; // ... tot net erboven
const DRIFT_SCALE = 8; // zweefbeweging van het origineel (scherm-eenheden) → meters
const HALO = 0.7; // straal van het vierkantje met de gloed (m)
const QUAD_TO_UV = 0.3; // rand van het vierkantje = 0.3 scherm-eenheden in het origineel: daar is de gloed uitgedoofd
const BRIGHTNESS = 3; // feller dan het origineel: de witte pluizenbollen en de tone mapping overstralen ze anders

// Opschrikken door muis en hand (physics, compute shader): zacht omhoog en een beetje opzij,
// daarna langzaam terug naar de gewone zweefhoogte
const SCARE_RADIUS = 2.5; // binnen deze afstand tot de aanwijzer (m)
const RISE = 6; // duw omhoog (m/s²) vlak bij de aanwijzer
const SIDEWAYS = 1.5; // kleine duw opzij, weg van de aanwijzer (m/s²)
const SPRING = 1.2; // veer terug naar de gewone plek (lager = trager terug)
const DAMPING = 2 * Math.sqrt(SPRING); // "kritisch gedempt": terugkomen zonder op en neer te stuiteren
const MAX_LIFT = 1.5; // niet hoger dan dit boven de gewone hoogte (m)
const MAX_SIDEWAYS = 0.8; // niet verder opzij dan dit (m)

/**
 * Tweede Shadertoy-shader: "Fireflies at Dusk" door OneHung (CC0),
 * https://www.shadertoy.com/view/wcKczt — origineel in shaders/original/fireflies.glsl.
 *
 * Uit het origineel overgenomen en naar TSL geport: hash, het knipperritme
 * (fireflyBlink: snel aan, traag uit, soms een dubbele flits), het zweven in een
 * achtvorm (drift), de kern + zachte gloed (core, glow) en de geelgroene kleur.
 * Lucht, bomen en gras van het origineel niet: die heeft de wei al.
 *
 * Aangepast voor 3D: elk vuurvliegje is een vierkantje dat naar de camera kijkt
 * (billboard, één InstancedMesh = één draw call). De gloed wordt per pixel berekend
 * zoals in het origineel, met de afstand tot het midden van het vierkantje.
 * Ze verschijnen bij schemering en 's nachts.
 *
 * Physics: passeer je er een met de muis of de hand, dan vliegt het zacht omhoog
 * (en een beetje opzij) en daalt het daarna langzaam terug. Een compute shader houdt
 * per vuurvliegje een verplaatsing + snelheid bij (gedempte veer, zoals FlowerPhysics).
 */
export class Fireflies {
  /** pointerUniforms: de stralen van muis en hand, gedeeld met FlowerPhysics */
  constructor(renderer, pointerUniforms) {
    this.renderer = renderer;
    this.pointerUniforms = pointerUniforms;

    // Per vuurvliegje: plek boven de wei (x, y, z) + seed voor ritme, grootte en kleur
    const data = new Float32Array(COUNT * 4);
    for (let i = 0; i < COUNT; i++) {
      const r = AREA_RADIUS * Math.sqrt(Math.random()); // gelijkmatig over de cirkel
      const angle = Math.random() * Math.PI * 2;
      const x = Math.cos(angle) * r;
      const z = Math.sin(angle) * r;
      const y = heightAt(x, z) + HEIGHT_MIN + Math.random() * (HEIGHT_MAX - HEIGHT_MIN);
      // Seed zoals 'i * 127.1' in het origineel, maar begrensd: sin() van grote getallen is onnauwkeurig op de GPU
      data.set([x, y, z, (i % 97) * 127.1 + 0.37 * i], i * 4);
    }
    this.fireflyData = instancedArray(data, 'vec4');

    // Physics per vuurvliegje: verplaatsing door het opschrikken (x, y, z) en snelheid
    this.offsetBuffer = instancedArray(COUNT, 'vec3');
    this.velocityBuffer = instancedArray(COUNT, 'vec3');
    this.uDelta = uniform(0);
    this.computeNode = this.createCompute().compute(COUNT);

    this.cameraRight = uniform(new THREE.Vector3(1, 0, 0));
    this.cameraUp = uniform(new THREE.Vector3(0, 1, 0));
    // 0 = overdag (onzichtbaar), 1 = schemering en nacht ("at dusk")
    this.uNight = smoothstep(0.5, 0.15, uTimeOfDay);

    this.mesh = this.createMesh();
  }

  /**
   * Compute shader (één thread per vuurvliegje): opschrikken en terugkeren.
   * Dicht bij een aanwijzer: duw omhoog en een beetje opzij. Altijd: een veer die
   * terugtrekt naar de gewone plek, kritisch gedempt, dus rustig neerdalen zonder stuiteren.
   */
  createCompute() {
    const { fireflyData, offsetBuffer, velocityBuffer, uDelta } = this;

    return Fn(() => {
      const firefly = fireflyData.element(instanceIndex);
      const offset = offsetBuffer.element(instanceIndex);
      const velocity = velocityBuffer.element(instanceIndex);

      // Waar is het vuurvliegje nu? (zelfde berekening als in de vertex-shader)
      const position = firefly.xyz.add(driftAt(firefly.w, time)).add(offset).toVar();
      const force = vec3(0).toVar();

      for (const pointer of this.pointerUniforms) {
        // Dichtste punt op de straal van de aanwijzer
        const depth = dot(position.sub(pointer.origin), pointer.direction);
        const closest = pointer.origin.add(pointer.direction.mul(depth));
        const away = position.sub(closest).toVar();
        // 1 vlak bij de aanwijzer, 0 vanaf SCARE_RADIUS; alleen vóór de camera
        const strength = clamp(float(1).sub(length(away).div(SCARE_RADIUS)), 0, 1).pow(2)
          .mul(pointer.active).mul(select(depth.greaterThan(0), float(1), float(0)));

        // Omhoog, en een beetje opzij (horizontaal weg van de aanwijzer)
        const side = normalize(vec3(away.x, 0, away.z).add(vec3(1e-4, 0, 0)));
        force.addAssign(vec3(0, RISE, 0).add(side.mul(SIDEWAYS)).mul(strength));
      }

      // Gedempte veer: a = -k·x - c·v + F
      const acceleration = offset.mul(-SPRING).sub(velocity.mul(DAMPING)).add(force);

      // Semi-impliciete Euler: eerst snelheid, dan positie
      velocity.addAssign(acceleration.mul(uDelta));
      const next = offset.add(velocity.mul(uDelta)).toVar();

      // Grenzen: niet te hoog, niet onder de gewone hoogte, niet te ver opzij
      next.y.assign(clamp(next.y, 0, MAX_LIFT));
      const sideways = length(next.xz);
      If(sideways.greaterThan(MAX_SIDEWAYS), () => {
        next.xz.assign(next.xz.mul(float(MAX_SIDEWAYS).div(sideways)));
      });
      offset.assign(next);
    })();
  }

  createMesh() {
    const material = new THREE.MeshBasicNodeMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending, // licht telt op, zoals 'col +=' in het origineel
      fog: false, // nevel zou de vierkantjes zichtbaar maken; zelf vervagen in de verte
    });

    // Per vuurvliegje berekend in de vertex-shader, doorgegeven aan de fragment-shader
    const blink = varyingProperty('float', 'vFireflyBlink');
    const depthLook = varyingProperty('float', 'vFireflyDepth'); // 'depth' uit het origineel: grootte en gloed
    const colorMix = varyingProperty('float', 'vFireflyColor');

    material.positionNode = Fn(() => {
      const firefly = this.fireflyData.element(instanceIndex);
      const seed = firefly.w;

      // Gewone plek + zweven + verplaatsing door het opschrikken (uit de compute shader)
      const position = firefly.xyz.add(driftAt(seed, time)).add(this.offsetBuffer.element(instanceIndex));

      // Knipperen in hun eigen ritme (fireflyBlink); opschrikken verandert het licht niet
      blink.assign(fireflyBlink(time, seed));
      depthLook.assign(float(0.3).add(hash(vec2(seed, 2)).mul(0.7)));
      colorMix.assign(hash(vec2(seed, 3)));

      // Billboard: vierkantje rond het vuurvliegje, altijd naar de camera
      const corner = this.cameraRight.mul(positionGeometry.x).add(this.cameraUp.mul(positionGeometry.y));
      return position.add(corner.mul(HALO));
    })();

    material.colorNode = Fn(() => {
      // Afstand tot het midden, in de eenheden van het origineel (scherm-hoogte = 1)
      const q = length(uv().sub(0.5)).mul(2); // 0 in het midden, 1 aan de rand
      const d = q.mul(QUAD_TO_UV);

      const size = float(0.008).div(depthLook);
      const core = smoothstep(size, 0, d).mul(blink);
      const glow = exp(d.negate().mul(40).mul(depthLook)).mul(blink).mul(0.5);

      // Kleur: warm geelgroen, een beetje verschillend per vuurvliegje
      const fireflyCol = mix(vec3(0.7, 0.9, 0.3), vec3(0.9, 0.8, 0.2), colorMix.mul(0.3));
      const light = fireflyCol.mul(core.mul(2)).add(fireflyCol.mul(glow).mul(0.8));

      const edge = smoothstep(1, 0.7, q); // geen harde rand aan het vierkantje
      const distanceFade = smoothstep(70, 35, length(positionView)); // vervagen in de verte, zoals de nevel
      return light.mul(edge).mul(distanceFade).mul(this.uNight).mul(BRIGHTNESS);
    })();

    const mesh = new THREE.InstancedMesh(new THREE.PlaneGeometry(2, 2), material, COUNT);
    mesh.frustumCulled = false; // de buffer bepaalt waar ze zijn, niet de bounding box
    return mesh;
  }

  /** Elke frame: physics draaien en billboards naar de camera draaien; overdag niets doen */
  update(delta, camera) {
    this.mesh.visible = uTimeOfDay.value < 0.5;
    if (!this.mesh.visible) return;

    // Grote sprongen (tab was even weg) zouden de veer laten ontploffen
    this.uDelta.value = Math.min(delta, 1 / 30);
    if (this.uDelta.value > 0) this.renderer.compute(this.computeNode);

    this.cameraRight.value.setFromMatrixColumn(camera.matrixWorld, 0);
    this.cameraUp.value.setFromMatrixColumn(camera.matrixWorld, 1);
  }
}

// --- Geport uit het origineel ---

/** Zweven in een achtvorm: 'drift' uit het origineel (x en y), plus z met een verschoven seed */
const driftAt = Fn(([seed, t]) => vec3(
  sin(t.mul(0.3).add(seed)).mul(0.1).add(sin(t.mul(0.7).add(seed.mul(2))).mul(0.05)),
  cos(t.mul(0.4).add(seed)).mul(0.06).add(sin(t.mul(0.2).add(seed)).mul(0.03)),
  sin(t.mul(0.3).add(seed).add(1.7)).mul(0.1).add(sin(t.mul(0.7).add(seed.mul(2)).add(3.1)).mul(0.05)),
).mul(DRIFT_SCALE), { seed: 'float', t: 'float', return: 'vec3' });

/** hash(vec2 p) */
const hash = Fn(([p]) => fract(sin(dot(p, vec2(127.1, 311.7))).mul(43758.5453)), { p: 'vec2', return: 'float' });

/** fireflyBlink(time, seed): elk vuurvliegje een eigen ritme van 2–5 s; snel aan, traag uit */
const fireflyBlink = Fn(([t, seed]) => {
  const period = float(2).add(hash(vec2(seed, 0)).mul(3));
  const phase = hash(vec2(seed, 0.5)).mul(6.28);

  const p = mod(t.add(phase), period).div(period);
  const blink = smoothstep(0, 0.05, p).mul(smoothstep(0.3, 0.1, p));

  // Soms een dubbele flits ('if' uit het origineel als select)
  const p2 = mod(t.add(phase).add(0.3), period).div(period);
  const second = smoothstep(0, 0.05, p2).mul(smoothstep(0.2, 0.1, p2)).mul(0.7);
  return blink.add(select(hash(vec2(seed, 0.7)).greaterThan(0.6), second, float(0)));
}, { t: 'float', seed: 'float', return: 'float' });
