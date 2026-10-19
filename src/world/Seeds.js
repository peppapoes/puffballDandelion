import * as THREE from 'three/webgpu';
import {
  Fn, If, float, vec2, vec3, vec4, int, uniform, instancedArray, instanceIndex,
  positionGeometry, normalGeometry, normalLocal, time, attribute,
  sin, cos, fract, dot, length, clamp, smoothstep, select, normalize, mix, max, min, exp, mod,
} from 'three/tsl';
import { SEEDS_PER_HEAD, PLUCK_SLOTS, rotate } from './Meadow.js';
import { windAt } from './wind.js';
import { heightAtNode } from './terrain.js';

// Loskomen door wrijven (muis, hand)
const RUB_MIN_SPEED = 0.6; // m/s: trager wrijven doet niets
const RUB_RATE = 1.2; // kans per seconde per m/s boven RUB_MIN_SPEED: hoe sneller, hoe meer
const RUB_REACH = 0.6; // × aanraakgebied van de aanwijzer (de hand raakt veel meer pluisjes dan de muis)
const RUB_REACH_MIN = 0.15; // m
// Zwaaien door de wei (niet ingezoomd): een paar pluisjes van de bollen die je raakt
const WAVE_RATE = 0.06; // × RUB_RATE: veel minder dan ingezoomd wrijven, "een paar" per bloem
const WAVE_FLOWERS = 3; // hoogstens zoveel bloemen per frame (de snelst geraakte eerst)
// Loskomen door blazen (microfoon)
const BLOW_RATE = 4; // kans per seconde bij hard blazen
const BLOW_PUSH = 1.5; // m/s weg van de camera
// Vliegen
const GENERATIONS = 6; // vliegplekken per pluisje-nummer: zo vaak kan het tegelijk onderweg zijn (ook van verschillende bloemen)
const POOL = SEEDS_PER_HEAD * GENERATIONS;
const LIFETIME = 20; // seconden in de lucht, daarna weg
const SHRINK_TIME = 2; // laatste seconden: krimpen tot niets (zacht verdwijnen)
const OPEN_TIME = 0.8; // seconden om rechtop te draaien en het parachuutje te openen (shape key "Open" 0 → 1)
const SPIN = 0.6; // rad/s: traag ronddraaien
const FALL_SPEED = 0.12; // m/s: heel traag dalen (parachute)
const WIND_CARRY = 2.5; // m/s per eenheid windkracht: meedrijven met dezelfde wind als de wei
const DRAG = 1.5; // hoe snel de snelheid naar wind + dalen gaat (luchtweerstand)
const FLUTTER = 0.15; // m/s: zacht fladderen
const MAX_PUSH = 3; // m/s: beginsnelheid begrenzen

/**
 * Pluisjes wegwrijven of wegblazen.
 * - Ingezoomd op een bloem: wrijven (muis, hand) en blazen (microfoon), de bol wordt kaal.
 * - In de wei: zwaai je met de cursor of hand snel door de bollen, dan komen er bij de bollen
 *   die je raakt een paar pluisjes los (WAVE_RATE). Alleen de dichtste bollen (met echte pluisjes).
 *
 * Twee compute shaders op de GPU:
 * 1. detach (90 threads, één per pluisje van de gekozen bloem): wrijven en blazen geven
 *    elk pluisje een kans om los te komen (hoe sneller/harder, hoe groter). Losgekomen:
 *    op de bol onzichtbaar (meadow.seedState), dus de bol wordt kaler, en een vliegend
 *    pluisje erbij. Kale bloemen blijven kaal, ook na het uitzoomen (tot PLUCK_SLOTS bloemen).
 * 2. flight (POOL threads): vliegende pluisjes drijven met de wind, dalen heel traag
 *    (parachute), fladderen en verdwijnen na LIFETIME seconden.
 *
 * Een vliegend pluisje begint precies zoals het op de bol stond, en draait dan rechtop
 * terwijl het parachuutje opengaat: de shape key "Open" uit Blender, van 0 naar 1.
 */
export class Seeds {
  constructor(renderer, meadow, pointerUniforms) {
    this.renderer = renderer;
    this.meadow = meadow;
    this.pointerUniforms = pointerUniforms;

    this.uDelta = uniform(0);
    this.uBlow = uniform(0); // 0..1, van de microfoon
    this.uCameraPosition = uniform(new THREE.Vector3());
    this.uSlot = uniform(0); // plek in meadow.seedState van de bloem
    this.uFlower = uniform(-1); // welke bloem: de ingezoomde, of in de wei een bloem die je raakt
    this.uRubRate = uniform(RUB_RATE); // ingezoomd RUB_RATE, in de wei RUB_RATE × WAVE_RATE

    // Kale bloemen onthouden: welke bloem op welke plek (JavaScript beslist, de GPU leest meadow.pluckedSlot)
    this.slotOfFlower = new Map(); // bloemnummer → plek
    this.flowerOfSlot = new Array(PLUCK_SLOTS).fill(-1); // plek → bloemnummer
    this.nextSlot = 0; // vol? dan de oudste plek hergebruiken (om de beurt)
    // Bloemen waarop je ingezoomd hebt: hun plek wordt niet hergebruikt door het zwaaien in de wei
    // (anders wordt een kaal gewreven bloem weer vol als je even door de wei zwaait)
    this.protectedFlowers = new Set();

    // Vliegende pluisjes: positie + leeftijd (w < 0 = niet in gebruik), snelheid + grootte, draaiing op de bol
    const positions = new Float32Array(POOL * 4);
    for (let n = 0; n < POOL; n++) positions[n * 4 + 3] = -1;
    this.flyPosition = instancedArray(positions, 'vec4');
    this.flyVelocity = instancedArray(POOL, 'vec4');
    this.flyRotation = instancedArray(POOL, 'vec4');

    this.detachCompute = this.createDetachCompute().compute(SEEDS_PER_HEAD);
    this.flightCompute = this.createFlightCompute().compute(POOL);

    this.group = new THREE.Group();
    this.createMeshes();
  }

  // --- Plekken voor kale bloemen ---

  /**
   * Plek in meadow.seedState voor bloem i. Al eens aangeraakt: dezelfde plek (ze blijft kaal).
   * Anders een nieuwe plek; zijn ze allemaal bezet, dan de oudste (die bloem is dan weer vol),
   * maar nooit die van een bloem waarop je ingezoomd hebt (tenzij alle plekken zo'n bloem hebben).
   */
  slotFor(i) {
    if (this.slotOfFlower.has(i)) return this.slotOfFlower.get(i);

    let slot = this.nextSlot;
    for (let tries = 0; tries < PLUCK_SLOTS; tries++) {
      const candidate = (this.nextSlot + tries) % PLUCK_SLOTS;
      if (!this.protectedFlowers.has(this.flowerOfSlot[candidate])) {
        slot = candidate;
        break;
      }
    }
    this.nextSlot = (slot + 1) % PLUCK_SLOTS;
    const previous = this.flowerOfSlot[slot];
    const lookup = this.meadow.pluckedSlot.value;
    if (previous >= 0) {
      this.slotOfFlower.delete(previous);
      lookup.array[previous] = -1;
    }
    this.flowerOfSlot[slot] = i;
    this.slotOfFlower.set(i, slot);
    lookup.array[i] = slot;
    lookup.needsUpdate = true;
    // De pluisjes van de plek zelf worden op de GPU weer vol gezet (detach: w is van een andere bloem)
    return slot;
  }

  // --- 1. Loskomen ---

  createDetachCompute() {
    const { meadow, uDelta, uBlow, uCameraPosition } = this;
    const { receptacleRadius, seedLength } = meadow.model;

    return Fn(() => {
      const k = instanceIndex;
      const state = meadow.seedState.element(int(this.uSlot).mul(SEEDS_PER_HEAD).add(int(k)));
      const focus = this.uFlower;
      const i = int(focus);

      // Deze plek was van een andere bloem: voor deze bloem begint ze vol
      If(state.w.notEqual(focus), () => {
        state.assign(vec4(1, 0, state.z, focus));
      });

      const scale = meadow.flowerBuffer.element(i).w;
      // Richting van het pluisje = "omhoog" gedraaid met zijn draaiing. Niet uit seedDirections lezen:
      // WebGPU laat standaard maar 8 opslagbuffers per compute shader toe, en dit zou de 9e zijn.
      const rotation = meadow.seedRotations.element(k);
      const direction = rotate(vec3(0, 1, 0), rotation).toVar();
      const head = meadow.headPosition(i).toVar();
      const attach = head.add(direction.mul(receptacleRadius).mul(scale)).toVar(); // voet van het pluisje
      const tuft = attach.add(direction.mul(seedLength * 0.6).mul(scale)).toVar(); // midden van de pluis

      // Kans per seconde om los te komen, en de beginsnelheid
      const rate = float(0).toVar();
      const push = vec3(0).toVar();

      // Wrijven: hoe snel beweegt de aanwijzer ter hoogte van dit pluisje?
      for (const pointer of this.pointerUniforms) {
        If(pointer.active.greaterThan(0.5), () => {
          const depth = dot(tuft.sub(pointer.origin), pointer.direction).toVar();
          const closest = pointer.origin.add(pointer.direction.mul(depth));
          const reach = max(pointer.margin.mul(RUB_REACH), RUB_REACH_MIN);
          const distance = length(tuft.sub(closest));
          If(depth.greaterThan(0).and(distance.lessThan(reach)), () => {
            const previous = pointer.previousOrigin.add(pointer.previousDirection.mul(depth));
            const motion = closest.sub(previous).div(max(uDelta, 1e-4)).toVar();
            const near = float(1).sub(distance.div(reach));
            rate.addAssign(max(length(motion).sub(RUB_MIN_SPEED), 0).mul(this.uRubRate).mul(near));
            push.addAssign(motion.mul(0.3)); // meegesleurd in de wrijfrichting
          });
        });
      }

      // Blazen: de pluisjes aan de kant van de camera eerst, weggeblazen van de camera
      const toCamera = normalize(uCameraPosition.sub(head));
      const facing = clamp(dot(direction, toCamera), 0, 1);
      rate.addAssign(uBlow.mul(uBlow).mul(BLOW_RATE).mul(facing.add(0.2)));
      push.addAssign(toCamera.mul(uBlow.mul(-BLOW_PUSH)));

      // Kans in deze frame (onafhankelijk van de framerate); alleen pluisjes die nog vast zitten
      const chance = float(1).sub(exp(rate.negate().mul(uDelta)));
      If(state.x.greaterThan(0.5).and(random(float(k), fract(time.mul(0.731)).mul(100)).lessThan(chance)), () => {
        // Vliegplek: elk pluisje heeft er GENERATIONS, om de beurt (geen botsingen tussen pluisjes)
        const slot = int(k).mul(GENERATIONS).add(int(mod(state.z, GENERATIONS)));
        const pushLength = max(length(push), 1e-4);
        const start = direction.mul(0.4).add(vec3(0, 0.4, 0)).add(push.mul(min(float(1), float(MAX_PUSH).div(pushLength))));
        this.flyPosition.element(slot).assign(vec4(attach, 0));
        this.flyVelocity.element(slot).assign(vec4(start, scale));
        this.flyRotation.element(slot).assign(rotation);
        state.assign(vec4(0, 0, state.z.add(1), focus));
      });
    })();
  }

  // --- 2. Vliegen ---

  createFlightCompute() {
    const { uDelta } = this;

    return Fn(() => {
      const position = this.flyPosition.element(instanceIndex);
      const velocity = this.flyVelocity.element(instanceIndex);

      If(position.w.greaterThanEqual(0), () => {
        const age = position.w.add(uDelta);
        const seed = float(instanceIndex).mul(1.37);

        // Doelsnelheid: meedrijven met de wind van de wei, heel traag dalen, zacht fladderen
        const wind = windAt(position.xz);
        const flutter = vec3(sin(age.mul(1.3).add(seed)), sin(age.mul(0.9).add(seed.mul(2))).mul(0.5), cos(age.mul(1.1).add(seed)));
        const goal = vec3(wind.x, 0, wind.y).mul(WIND_CARRY).add(vec3(0, -FALL_SPEED, 0)).add(flutter.mul(FLUTTER));

        // Luchtweerstand: de snelheid gaat geleidelijk naar het doel (de parachute remt af)
        velocity.xyz.assign(mix(velocity.xyz, goal, float(1).sub(exp(uDelta.mul(-DRAG)))));
        const next = position.xyz.add(velocity.xyz.mul(uDelta)).toVar();

        // Niet door de grond: blijven liggen
        next.y.assign(max(next.y, heightAtNode(next.xz).add(0.02)));
        position.assign(vec4(next, select(age.greaterThan(LIFETIME), float(-1), age)));
      });
    })();
  }

  // --- Tekenen: dezelfde geometrie en kleur als de pluisjes op de bol ---

  createMeshes() {
    const { model } = this.meadow;
    const parts = [
      [model.pappusGeometry, model.materials.pappus, true],
      [model.acheneGeometry, model.materials.achene, false],
    ].filter(([geometry, material]) => geometry && material);

    for (const [geometry, source, isPappus] of parts) {
      const material = source.clone();
      if (isPappus) this.meadow.applyPuffColor(material, source.color);
      material.positionNode = this.flyingPosition(isPappus);
      const mesh = new THREE.InstancedMesh(geometry, material, POOL);
      mesh.frustumCulled = false; // de buffer bepaalt waar ze zijn
      this.group.add(mesh);
    }
  }

  /** Vertex-shader van een vliegend pluisje */
  flyingPosition(isPappus) {
    return Fn(() => {
      const position = this.flyPosition.element(instanceIndex);
      const size = this.flyVelocity.element(instanceIndex).w;
      const alive = position.w.greaterThanEqual(0);
      const age = max(position.w, 0);
      const open = smoothstep(0, OPEN_TIME, age);

      // Rechtop draaien: van de stand op de bol naar rechtop (genormaliseerd mengen van quaternions)
      const onHead = this.flyRotation.element(instanceIndex).toVar();
      If(onHead.w.lessThan(0), () => {
        onHead.assign(onHead.negate()); // zelfde draaiing, maar zo mengt ze langs de kortste weg
      });
      const q = normalize(mix(onHead, vec4(0, 0, 0, 1), open));

      // Parachuutje opent met de shape key "Open" uit Blender (alleen de pluis), en draait traag rond
      const opened = isPappus ? positionGeometry.add(attribute('openPosition', 'vec3').mul(open)) : positionGeometry;
      const openedNormal = isPappus ? normalGeometry.add(attribute('openNormal', 'vec3').mul(open)).normalize() : normalGeometry;
      const angle = age.mul(SPIN);
      const local = turnY(opened, angle);
      normalLocal.assign(rotate(turnY(openedNormal, angle), q));

      // Zacht verdwijnen aan het einde; niet in gebruik = grootte 0 (onzichtbaar)
      const shrink = smoothstep(LIFETIME, LIFETIME - SHRINK_TIME, age);
      const scale = select(alive, size.mul(shrink), float(0));
      return position.xyz.add(rotate(local, q).mul(scale));
    })();
  }

  /**
   * Elke frame. flower = bloem waarop ingezoomd is (of null), blow = blaaskracht van de microfoon (0..1),
   * pointers = muis en hand (Pointer.js)
   */
  update(delta, camera, flower, blow, pointers) {
    this.uDelta.value = Math.min(delta, 1 / 30);
    if (this.uDelta.value <= 0) return;
    this.uCameraPosition.value.copy(camera.position);

    if (flower !== null) {
      // Ingezoomd: wrijven en blazen op deze ene bloem
      this.protectedFlowers.add(flower);
      this.detach(flower, RUB_RATE, blow);
    } else {
      // In de wei: een paar pluisjes van de bollen waar je snel langs zwaait
      for (const i of this.wavedFlowers(pointers)) this.detach(i, RUB_RATE * WAVE_RATE, 0);
    }
    this.renderer.compute(this.flightCompute);
  }

  /** De compute shader "loskomen" voor één bloem (90 threads, één per pluisje) */
  detach(i, rubRate, blow) {
    this.uFlower.value = i;
    this.uSlot.value = this.slotFor(i);
    this.uRubRate.value = rubRate;
    this.uBlow.value = blow;
    this.renderer.compute(this.detachCompute);
  }

  /**
   * Welke bollen raak je nu snel genoeg met de muis of de hand? Op de CPU, ruw: de bol in rust
   * (zonder wind), en alleen de dichtste bollen met echte pluisjes (meadow.nearSlots). De shader
   * kijkt daarna per pluisje precies na of de aanwijzer er snel genoeg langs gaat.
   * Hoogstens WAVE_FLOWERS bloemen, de snelst geraakte eerst.
   */
  wavedFlowers(pointers) {
    const { meadow } = this;
    const hits = [];
    const head = this.head ?? (this.head = new THREE.Vector3());
    const closest = this.closest ?? (this.closest = new THREE.Vector3());
    const previous = this.previous ?? (this.previous = new THREE.Vector3());

    for (const pointer of pointers) {
      if (!pointer.active) continue;
      const { ray, previousRay } = pointer;
      for (const i of meadow.nearSlots.value.array) {
        if (i < 0) continue;
        const flower = meadow.flowers[i];
        head.copy(flower.position).add(flower.headOffset);
        const depth = head.dot(ray.direction) - ray.origin.dot(ray.direction); // (bol − oorsprong) · richting
        if (depth <= 0) continue;
        closest.copy(ray.direction).multiplyScalar(depth).add(ray.origin);
        if (closest.distanceTo(head) > meadow.headRadius * flower.scale + pointer.touchMargin) continue;
        // Snelheid van de aanwijzer op die diepte (zelfde als in de shader)
        previous.copy(previousRay.direction).multiplyScalar(depth).add(previousRay.origin);
        const speed = closest.distanceTo(previous) / this.uDelta.value;
        if (speed > RUB_MIN_SPEED) hits.push({ i, speed });
      }
    }
    hits.sort((a, b) => b.speed - a.speed);
    return hits.slice(0, WAVE_FLOWERS).map((hit) => hit.i);
  }
}

/** Pseudo-willekeurig getal 0..1 uit twee getallen (zelfde invoer = zelfde uitkomst) */
function random(a, b) {
  return fract(sin(dot(vec2(a, b), vec2(12.9898, 78.233))).mul(43758.5453));
}

/** Vector v draaien om de verticale as (y) */
function turnY(v, angle) {
  const c = cos(angle);
  const s = sin(angle);
  return vec3(v.x.mul(c).add(v.z.mul(s)), v.y, v.z.mul(c).sub(v.x.mul(s)));
}
