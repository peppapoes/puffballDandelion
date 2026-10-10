import * as THREE from 'three/webgpu';
import {
  Fn, color, mix, vec2, vec3, float, cross, select, fract, uniform, uv, texture, attribute, length,
  positionLocal, positionGeometry, normalGeometry, normalLocal, instancedArray, instanceIndex, int,
} from 'three/tsl';
import { uTimeOfDay } from '../state/worldState.js';
import { windAt } from './wind.js';
import { heightAt } from './terrain.js';
import { loadPuffballModel } from './models.js';

const MODEL_SCALE = 0.6; // het Blender-model verkleind voor de wei
const MEADOW_RADIUS = 36; // straal van de wei (m)
const FLOWER_SPACING = 1.3; // gemiddelde afstand tussen bloemen (m)
const EDGE_FADE = 8; // laatste meters naar de rand: steeds ijler, geen harde grens
const SCALE_MIN = 0.8; // bloemen verschillen ±20% in grootte
const SCALE_MAX = 1.2;

// LOD: volledige pluisjes alleen op de dichtste bollen in beeld, verderop een eenvoudige bol
// puffballSimple: een pluisje is maar 16 driehoeken, dus veel bollen kunnen echte pluisjes krijgen
const NEAR_HEADS = 160; // aantal bollen met echte pluisjes
const SEEDS_PER_HEAD = 90; // pluisjes per bol
const SEED_LOWEST = -0.55; // geen pluisjes onderaan de bol, waar de steel zit (y van de richting)
const LOD_INTERVAL = 0.1; // seconden tussen het opnieuw kiezen van de dichtste bollen
const IMPOSTOR_SIZE = 512; // resolutie van de gebakken foto van een pluizenbol (verre bollen)

const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5)); // ±137,5°: zoals de pitten van een zonnebloem

/**
 * De wei met het Blender-model (blender/puffballSimple.blend → public/models/puffballSimple.glb).
 *
 * Vijf InstancedMeshes (elk één draw call):
 * - stelen (alle bloemen), buigen met wind + veer-physics
 * - verre bollen (alle bloemen behalve de dichtste): een eenvoudige witte bol
 * - receptacle, pappus en achene (alleen de NEAR_HEADS dichtste bollen):
 *   SEEDS_PER_HEAD pluisjes per bol, verdeeld volgens de gulden hoek
 *
 * Alle onderdelen worden in de vertex-shader op de top van de gebogen steel gezet,
 * met dezelfde wind en dezelfde physics-buffer (offsetBuffer), dus ze buigen samen.
 */
export class Meadow {
  static async create(renderer) {
    const meadow = new Meadow();
    meadow.model = await loadPuffballModel(MODEL_SCALE);
    meadow.build(renderer);
    return meadow;
  }

  build(renderer) {
    const model = this.model;
    this.group = new THREE.Group();
    // Volle pluizenbol (bol + pluisjes): voor de aanraking door muis en hand
    this.headRadius = model.receptacleRadius + model.seedLength;
    this.puffRadius = this.headRadius; // kader van de gebakken foto en grootte van de verre bollen

    // Bloemen plaatsen, elk met een eigen grootte en draaiing
    this.flowers = scatterFlowers().map((position) => {
      const scale = SCALE_MIN + Math.random() * (SCALE_MAX - SCALE_MIN);
      const rotation = Math.random() * Math.PI * 2;
      // Midden van de bol t.o.v. de voet: uit Blender, gedraaid en geschaald zoals deze bloem
      const headOffset = model.headCenter.clone().applyAxisAngle(THREE.Object3D.DEFAULT_UP, rotation).multiplyScalar(scale);
      return { position, scale, rotation, headOffset };
    });
    const count = this.flowers.length;

    this.createBuffers();
    this.createStems();
    this.impostorTexture = this.bakeImpostor(renderer);
    this.createFarPuffs();
    this.createNearHeads();

    this.lodTimer = LOD_INTERVAL; // meteen bij de eerste update kiezen
    this.projection = new THREE.Matrix4();
    this.frustum = new THREE.Frustum();
    this.sphere = new THREE.Sphere();
    this.order = Array.from({ length: count }, (_, i) => i);
    this.distances = new Float32Array(count);
  }

  // --- GPU-buffers, gedeeld door alle onderdelen en de physics ---

  createBuffers() {
    const count = this.flowers.length;
    const flowerData = new Float32Array(count * 4); // voet x, y, z + grootte
    const headData = new Float32Array(count * 4); // midden van de bol t.o.v. de voet (x, y, z)
    this.flowers.forEach((flower, i) => {
      flowerData.set([flower.position.x, flower.position.y, flower.position.z, flower.scale], i * 4);
      headData.set([flower.headOffset.x, flower.headOffset.y, flower.headOffset.z, 0], i * 4);
    });
    this.flowerBuffer = instancedArray(flowerData, 'vec4');
    this.headBuffer = instancedArray(headData, 'vec4');

    // Uitwijking per bloem (x/z aan de top): de compute shader van FlowerPhysics schrijft erin
    this.offsetBuffer = instancedArray(count, 'vec2');

    // LOD: welke bloemen hebben nu echte pluisjes? (door JavaScript bijgewerkt, 10× per seconde)
    this.nearSlots = instancedArray(new Float32Array(NEAR_HEADS).fill(-1), 'float'); // bloemnummer per plek
    this.nearFlags = instancedArray(count, 'float'); // 1 = deze bloem is dichtbij (verre bol verbergen)

    // Pluisjes op de bol: richting + draaiing per pluisje, voor alle bollen dezelfde
    const directions = new Float32Array(SEEDS_PER_HEAD * 4);
    const rotations = new Float32Array(SEEDS_PER_HEAD * 4);
    const up = new THREE.Vector3(0, 1, 0);
    const direction = new THREE.Vector3();
    const quaternion = new THREE.Quaternion();
    const twist = new THREE.Quaternion();
    for (let k = 0; k < SEEDS_PER_HEAD; k++) {
      // Fibonacci-spiraal: gelijkmatig over de bol, van boven tot net boven de steel
      const y = 1 - ((k + 0.5) / SEEDS_PER_HEAD) * (1 - SEED_LOWEST);
      const ring = Math.sqrt(1 - y * y);
      const angle = k * GOLDEN_ANGLE;
      direction.set(Math.cos(angle) * ring, y, Math.sin(angle) * ring);
      // Pluisje (wijst omhoog) naar buiten draaien, plus een willekeurige draai om zijn eigen as
      twist.setFromAxisAngle(up, Math.random() * Math.PI * 2);
      quaternion.setFromUnitVectors(up, direction).multiply(twist);
      directions.set([direction.x, direction.y, direction.z, 0], k * 4);
      rotations.set([quaternion.x, quaternion.y, quaternion.z, quaternion.w], k * 4);
    }
    this.seedDirections = instancedArray(directions, 'vec4');
    this.seedRotations = instancedArray(rotations, 'vec4');
  }

  /**
   * Buiging van bloem i, voor de shape key "Buigen" uit Blender:
   * - amount: 0 = recht, 1 = volledig gebogen zoals in Blender
   * - direction: richting (x, z) waarin wind + veer-physics de top duwen
   */
  bendOf(i) {
    const flower = this.flowerBuffer.element(i);
    const push = windAt(flower.xz).mul(1.2).add(this.offsetBuffer.element(i));
    const pushLength = length(push);
    // Hoe ver de top in Blender opzij gaat bij volle buiging, voor deze bloemgrootte
    const reach = flower.w.mul(this.model.bendTop.x);
    return {
      amount: pushLength.div(reach).min(1),
      direction: push.div(pushLength.max(1e-4)),
    };
  }

  /** Verschuiving van de top van bloem i: de top van de Blender-buiging, gedraaid naar de duwrichting */
  topDisplacement(i) {
    const { amount, direction } = this.bendOf(i);
    const top = vec3(this.model.bendTop.x, this.model.bendTop.y, this.model.bendTop.z);
    return turnTowards(top, direction).mul(amount).mul(this.flowerBuffer.element(i).w);
  }

  /** Midden van de bol van bloem i, op de top van de gebogen steel */
  headPosition(i) {
    return this.flowerBuffer.element(i).xyz.add(this.headBuffer.element(i).xyz).add(this.topDisplacement(i));
  }

  // --- Stelen ---

  createStems() {
    const material = this.model.materials.stem;
    // Shape key "Buigen" uit Blender, per bloem gedraaid naar de richting waarin wind en physics duwen.
    // Blender buigt naar +X; hier wordt +X de duwrichting, en de hoeveelheid volgt de physics.
    material.positionNode = Fn(() => {
      const { amount, direction } = this.bendOf(instanceIndex);
      const scale = this.flowerBuffer.element(instanceIndex).w;
      // Normalen mee laten buigen, voor het juiste licht op de gebogen steel
      const bentNormal = turnTowards(attribute('bendNormal', 'vec3'), direction).mul(amount);
      normalLocal.assign(normalLocal.add(bentNormal).normalize());
      const bentPosition = turnTowards(attribute('bendPosition', 'vec3'), direction).mul(amount).mul(scale);
      return positionLocal.add(bentPosition);
    })();

    const mesh = new THREE.InstancedMesh(this.model.stemGeometry, material, this.flowers.length);
    const matrix = new THREE.Matrix4();
    const quaternion = new THREE.Quaternion();
    const scale = new THREE.Vector3();
    this.flowers.forEach((flower, i) => {
      quaternion.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, flower.rotation);
      matrix.compose(flower.position, quaternion, scale.setScalar(flower.scale));
      mesh.setMatrixAt(i, matrix);
    });
    this.addMesh(mesh);
  }

  // --- Verre bollen (LOD) ---

  /**
   * Impostor baking: één echte pluizenbol van het model (receptacle + pluisjes, zelfde
   * gulden-hoekverdeling) wordt bij het opstarten van opzij gefotografeerd naar een afbeelding
   * met doorzichtige achtergrond. De verre bollen tonen die afbeelding.
   */
  bakeImpostor(renderer) {
    const { receptacleGeometry, pappusGeometry, acheneGeometry, materials, receptacleRadius } = this.model;
    const scene = new THREE.Scene();
    const flat = (c) => new THREE.MeshBasicNodeMaterial({ color: c, side: THREE.DoubleSide });
    const parts = [
      [pappusGeometry, flat(materials.pappus.color)],
      [acheneGeometry, flat((materials.achene ?? materials.receptacle).color)],
    ].filter(([geometry]) => geometry);

    scene.add(new THREE.Mesh(receptacleGeometry, flat(materials.receptacle.color)));
    const directions = this.seedDirections.value.array;
    const rotations = this.seedRotations.value.array;
    for (let k = 0; k < SEEDS_PER_HEAD; k++) {
      for (const [geometry, material] of parts) {
        const seed = new THREE.Mesh(geometry, material);
        seed.quaternion.fromArray(rotations, k * 4);
        seed.position.fromArray(directions, k * 4).multiplyScalar(receptacleRadius);
        scene.add(seed);
      }
    }

    // Orthografische camera (geen perspectief), recht van opzij, kader = volle pluizenbol
    const r = this.puffRadius;
    const camera = new THREE.OrthographicCamera(-r, r, r, -r, 0.01, r * 4);
    camera.position.set(0, 0, r * 2);

    // MSAA voor zachte lijntjes, mipmaps zodat ze ook klein (ver weg) rustig blijven
    const target = new THREE.RenderTarget(IMPOSTOR_SIZE, IMPOSTOR_SIZE, { samples: 4 });
    target.texture.generateMipmaps = true;
    target.texture.minFilter = THREE.LinearMipmapLinearFilter;

    const clearColor = renderer.getClearColor(new THREE.Color());
    const clearAlpha = renderer.getClearAlpha();
    renderer.setClearColor(0x000000, 0); // doorzichtige achtergrond
    renderer.setRenderTarget(target);
    renderer.render(scene, camera);
    renderer.setRenderTarget(null);
    renderer.setClearColor(clearColor, clearAlpha);

    scene.traverse((object) => object.material?.dispose());
    return target.texture;
  }

  /**
   * Verre bollen als billboard: een plat vierkantje dat altijd naar de camera kijkt,
   * met de gebakken foto van een echte pluizenbol (impostor). 2 driehoeken per bloem.
   */
  createFarPuffs() {
    const radius = this.puffRadius;
    const material = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false });

    // Rechts en omhoog van de camera (elke frame bijgewerkt in update)
    this.cameraRight = uniform(new THREE.Vector3(1, 0, 0));
    this.cameraUp = uniform(new THREE.Vector3(0, 1, 0));

    material.positionNode = Fn(() => {
      const i = instanceIndex;
      const flower = this.flowerBuffer.element(i);
      // Dichtbij: verbergen (samendrukken tot een punt), daar staan de echte pluisjes
      const size = float(radius).mul(flower.w).mul(float(1).sub(this.nearFlags.element(i)));
      const corner = this.cameraRight.mul(positionGeometry.x).add(this.cameraUp.mul(positionGeometry.y));
      return this.headPosition(i).add(corner.mul(size));
    })();

    // Gebakken foto; de helft van de bloemen gespiegeld, zodat niet alle bollen identiek zijn
    const mirror = fract(this.flowerBuffer.element(instanceIndex).x.mul(12.9898)).greaterThan(0.5);
    // y omgekeerd: in een render target ligt de bovenkant van de foto bij v = 0
    const photo = texture(this.impostorTexture, vec2(select(mirror, uv().x.oneMinus(), uv().x), uv().y.oneMinus()));

    // Kleur zoals de echte pluisjes (applyPuffColor): wit overdag, blauwig met neon-gloed 's nachts.
    // Onbelicht materiaal, dus zelf dimmen 's nachts.
    const tint = mix(color('#b9c4ff'), vec3(1), uTimeOfDay);
    const light = mix(float(0.35), float(0.85), uTimeOfDay);
    const glow = color('#7df9ff').mul(uTimeOfDay.oneMinus()).mul(0.6);
    material.colorNode = photo.rgb.mul(tint).mul(light).add(glow);
    material.opacityNode = photo.a;

    this.addMesh(new THREE.InstancedMesh(new THREE.PlaneGeometry(2, 2), material, this.flowers.length));
  }

  // --- Dichtbij: bol + echte pluisjes ---

  createNearHeads() {
    const { receptacle, pappus, achene } = this.model.materials;

    // Receptacle: één per plek
    receptacle.positionNode = Fn(() => {
      const slot = this.nearSlots.element(instanceIndex);
      const i = int(slot.max(0));
      const flower = this.flowerBuffer.element(i);
      const position = this.headPosition(i).add(positionGeometry.mul(flower.w));
      return select(slot.greaterThanEqual(0), position, vec3(0)); // lege plek: onzichtbaar
    })();
    this.addMesh(new THREE.InstancedMesh(this.model.receptacleGeometry, receptacle, NEAR_HEADS));

    // Pluisjes: SEEDS_PER_HEAD per plek
    const seedPosition = Fn(() => {
      const slot = this.nearSlots.element(instanceIndex.div(SEEDS_PER_HEAD));
      const k = instanceIndex.mod(SEEDS_PER_HEAD);
      const i = int(slot.max(0));
      const flower = this.flowerBuffer.element(i);
      const q = this.seedRotations.element(k);
      const direction = this.seedDirections.element(k).xyz;

      // Pluisje naar buiten draaien (ook de normalen, voor de belichting)
      normalLocal.assign(rotate(normalGeometry, q));
      const rotated = rotate(positionGeometry, q).mul(flower.w);
      // Op het oppervlak van de bol, op de top van de gebogen steel
      const attach = direction.mul(this.model.receptacleRadius).mul(flower.w);
      const position = this.headPosition(i).add(attach).add(rotated);
      return select(slot.greaterThanEqual(0), position, vec3(0));
    });

    pappus.positionNode = seedPosition();
    this.applyPuffColor(pappus, pappus.color);
    this.addMesh(new THREE.InstancedMesh(this.model.pappusGeometry, pappus, NEAR_HEADS * SEEDS_PER_HEAD));

    if (achene && this.model.acheneGeometry) {
      achene.positionNode = seedPosition();
      this.addMesh(new THREE.InstancedMesh(this.model.acheneGeometry, achene, NEAR_HEADS * SEEDS_PER_HEAD));
    }
  }

  /** Pluizenkleur: wit overdag, 's nachts blauwig met een zachte neon-gloed */
  applyPuffColor(material, dayColor) {
    material.colorNode = mix(color('#b9c4ff'), color(dayColor), uTimeOfDay);
    material.emissiveNode = color('#7df9ff').mul(uTimeOfDay.oneMinus()).mul(0.6);
  }

  addMesh(mesh) {
    // De buffers bepalen waar alles staat, niet de bounding box van één bloem: niet wegknippen
    mesh.frustumCulled = false;
    this.group.add(mesh);
  }

  // --- LOD: de dichtste bollen in beeld krijgen echte pluisjes ---

  update(delta, camera) {
    // Billboards van de verre bollen naar de camera draaien
    this.cameraRight.value.setFromMatrixColumn(camera.matrixWorld, 0);
    this.cameraUp.value.setFromMatrixColumn(camera.matrixWorld, 1);

    this.lodTimer += delta;
    if (this.lodTimer < LOD_INTERVAL) return;
    this.lodTimer = 0;

    this.projection.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    this.frustum.setFromProjectionMatrix(this.projection);
    this.sphere.radius = this.headRadius * SCALE_MAX;

    // Afstand tot de camera; bollen buiten beeld achteraan
    this.flowers.forEach((flower, i) => {
      this.sphere.center.copy(flower.position).add(flower.headOffset);
      const inView = this.frustum.intersectsSphere(this.sphere);
      this.distances[i] = this.sphere.center.distanceToSquared(camera.position) + (inView ? 0 : 1e9);
    });
    this.order.sort((a, b) => this.distances[a] - this.distances[b]);

    const slots = this.nearSlots.value.array;
    const flags = this.nearFlags.value.array;
    flags.fill(0);
    for (let s = 0; s < NEAR_HEADS; s++) {
      const i = this.order[s];
      const usable = i !== undefined && this.distances[i] < 1e9;
      slots[s] = usable ? i : -1;
      if (usable) flags[i] = 1;
    }
    this.nearSlots.value.needsUpdate = true;
    this.nearFlags.value.needsUpdate = true;
  }
}

/** Vector v (gebogen naar +X, zoals in Blender) om de verticale as draaien, zodat +X naar direction (x, z) wijst */
function turnTowards(v, direction) {
  return vec3(
    v.x.mul(direction.x).sub(v.z.mul(direction.y)),
    v.y,
    v.x.mul(direction.y).add(v.z.mul(direction.x)),
  );
}

/** Vector v draaien met quaternion q (x, y, z, w) */
function rotate(v, q) {
  return v.add(cross(q.xyz, cross(q.xyz, v).add(v.mul(q.w))).mul(2));
}

/**
 * Bloemen verspreiden met een "jittered grid": een rooster met één bloem per vakje,
 * willekeurig verschoven binnen dat vakje. Snel (ook voor duizenden bloemen),
 * gelijkmatig verdeeld en toch natuurlijk. Naar de rand toe steeds ijler.
 */
function scatterFlowers() {
  const positions = [];
  const fadeStart = MEADOW_RADIUS - EDGE_FADE;

  for (let gx = -MEADOW_RADIUS; gx <= MEADOW_RADIUS; gx += FLOWER_SPACING) {
    for (let gz = -MEADOW_RADIUS; gz <= MEADOW_RADIUS; gz += FLOWER_SPACING) {
      // Willekeurig verschuiven binnen het vakje (niet helemaal tot de rand: geen botsingen)
      const x = gx + (Math.random() - 0.5) * FLOWER_SPACING * 0.9;
      const z = gz + (Math.random() - 0.5) * FLOWER_SPACING * 0.9;

      const r = Math.hypot(x, z);
      if (r > MEADOW_RADIUS) continue;

      // Rand: hoe verder voorbij fadeStart, hoe groter de kans dat dit vakje leeg blijft
      const edge = (r - fadeStart) / EDGE_FADE;
      if (edge > 0 && Math.random() < edge) continue;

      positions.push(new THREE.Vector3(x, heightAt(x, z), z));
    }
  }

  return positions;
}
