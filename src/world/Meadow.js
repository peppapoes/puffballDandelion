import * as THREE from 'three/webgpu';
import {
  Fn, color, mix, vec2, vec3, vec4, float, cross, select, fract, uniform, uv, texture, attribute, length,
  positionLocal, positionGeometry, normalGeometry, normalLocal, instancedArray, instanceIndex, int,
  If, Loop, varyingProperty,
} from 'three/tsl';
import { uTimeOfDay } from '../state/worldState.js';
import { windAt } from './wind.js';
import { heightAt } from './terrain.js';
import { loadPuffballModel } from './models.js';

const MODEL_SCALE = 0.6; // het Blender-model verkleind voor de wei
const MEADOW_RADIUS = 36; // straal van de wei (m)
const FLOWER_SPACING = 1.3; // gemiddelde afstand tussen bloemen (m)
export const GRID_CELLS = Math.floor((2 * MEADOW_RADIUS) / FLOWER_SPACING) + 1;
export const GRID = { cells: GRID_CELLS, spacing: FLOWER_SPACING, origin: -MEADOW_RADIUS };
const EDGE_FADE = 8; // laatste meters naar de rand: steeds ijler, geen harde grens
const SCALE_MIN = 0.8; // bloemen verschillen ±20% in grootte
const SCALE_MAX = 1.2;

const NEAR_HEADS = 160; // aantal bollen met echte pluisjes
export const SEEDS_PER_HEAD = 90; // pluisjes per bol
export const PLUCK_SLOTS = 64; // zoveel (deels) kale bloemen worden onthouden
const SEED_LOWEST = -0.55; // geen pluisjes onderaan de bol, waar de steel zit (y van de richting)
const LOD_INTERVAL = 0.1; // seconden tussen het opnieuw kiezen van de dichtste bollen
const IMPOSTOR_SIZE = 512; // resolutie van de gebakken foto van een pluizenbol (verre bollen)

const FOCUS_CALM = 0.15; // ingezoomde bloem: nog 15% van de wind en physics

const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5)); // ±137,5°: zoals de pitten van een zonnebloem

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
    this.headRadius = model.receptacleRadius + model.seedLength;
    this.puffRadius = this.headRadius; // kader van de gebakken foto en grootte van de verre bollen

    this.flowers = scatterFlowers().map(({ position, cell }) => {
      const scale = SCALE_MIN + Math.random() * (SCALE_MAX - SCALE_MIN);
      const rotation = Math.random() * Math.PI * 2;
      const headOffset = model.headCenter.clone().applyAxisAngle(THREE.Object3D.DEFAULT_UP, rotation).multiplyScalar(scale);
      return { position, scale, rotation, headOffset, cell };
    });
    const count = this.flowers.length;
    this.renderer = renderer;

    this.uFocusIndex = uniform(-1);
    this.uFocusHold = uniform(0);

    this.createBuffers();
    this.createShadowData();
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

    this.offsetBuffer = instancedArray(count, 'vec2');

    this.nearSlots = instancedArray(new Float32Array(NEAR_HEADS).fill(-1), 'float'); // bloemnummer per plek
    this.nearFlags = instancedArray(count, 'float'); // 1 = deze bloem is dichtbij (verre bol verbergen)

    const directions = new Float32Array(SEEDS_PER_HEAD * 4);
    const rotations = new Float32Array(SEEDS_PER_HEAD * 4);
    const up = new THREE.Vector3(0, 1, 0);
    const direction = new THREE.Vector3();
    const quaternion = new THREE.Quaternion();
    const twist = new THREE.Quaternion();
    for (let k = 0; k < SEEDS_PER_HEAD; k++) {
      const y = 1 - ((k + 0.5) / SEEDS_PER_HEAD) * (1 - SEED_LOWEST);
      const ring = Math.sqrt(1 - y * y);
      const angle = k * GOLDEN_ANGLE;
      direction.set(Math.cos(angle) * ring, y, Math.sin(angle) * ring);
      twist.setFromAxisAngle(up, Math.random() * Math.PI * 2);
      quaternion.setFromUnitVectors(up, direction).multiply(twist);
      directions.set([direction.x, direction.y, direction.z, 0], k * 4);
      rotations.set([quaternion.x, quaternion.y, quaternion.z, quaternion.w], k * 4);
    }
    this.seedDirections = instancedArray(directions, 'vec4');
    this.seedRotations = instancedArray(rotations, 'vec4');

    const state = new Float32Array(PLUCK_SLOTS * SEEDS_PER_HEAD * 4);
    for (let n = 0; n < PLUCK_SLOTS * SEEDS_PER_HEAD; n++) state.set([1, 0, 0, -1], n * 4);
    this.seedState = instancedArray(state, 'vec4');
    this.pluckedSlot = instancedArray(new Float32Array(this.flowers.length).fill(-1), 'float');
  }

  bendOf(i) {
    const flower = this.flowerBuffer.element(i);
    const isFocused = float(i).equal(this.uFocusIndex);
    const calm = select(isFocused, mix(float(1), float(FOCUS_CALM), this.uFocusHold), float(1));
    const push = windAt(flower.xz).mul(1.2).add(this.offsetBuffer.element(i)).mul(calm);
    const pushLength = length(push);
    const reach = flower.w.mul(this.model.bendTop.x);
    return {
      amount: pushLength.div(reach).min(1),
      direction: push.div(pushLength.max(1e-4)),
    };
  }

  topDisplacement(i) {
    const { amount, direction } = this.bendOf(i);
    const top = vec3(this.model.bendTop.x, this.model.bendTop.y, this.model.bendTop.z);
    return turnTowards(top, direction).mul(amount).mul(this.flowerBuffer.element(i).w);
  }

  seedAttached(i, k) {
    const slot = this.pluckedSlot.element(i);
    const state = this.seedState.element(int(slot.max(0)).mul(SEEDS_PER_HEAD).add(int(k)));
    const own = slot.greaterThanEqual(0).and(state.w.equal(float(i)));
    return select(own, state.x, float(1));
  }

  seedFullness(i) {
    const fullness = float(1).toVar();
    If(this.pluckedSlot.element(i).greaterThanEqual(0), () => {
      const attached = float(0).toVar();
      Loop(SEEDS_PER_HEAD, ({ i: k }) => {
        attached.addAssign(this.seedAttached(i, k));
      });
      fullness.assign(attached.div(SEEDS_PER_HEAD));
    });
    return fullness;
  }

  headPosition(i) {
    return this.flowerBuffer.element(i).xyz.add(this.headBuffer.element(i).xyz).add(this.topDisplacement(i));
  }

  createShadowData() {
    const grid = new Float32Array(GRID_CELLS * GRID_CELLS).fill(-1);
    this.flowers.forEach((flower, i) => (grid[flower.cell] = i));
    this.shadowGrid = instancedArray(grid, 'float');
    this.headWorld = instancedArray(this.flowers.length, 'vec4');

    this.headCompute = Fn(() => {
      const i = instanceIndex;
      const radius = float(this.headRadius).mul(this.flowerBuffer.element(i).w);
      this.headWorld.element(i).assign(vec4(this.headPosition(i), radius));
    })().compute(this.flowers.length);
  }

  createStems() {
    const material = this.model.materials.stem;
    material.positionNode = Fn(() => {
      const { amount, direction } = this.bendOf(instanceIndex);
      const scale = this.flowerBuffer.element(instanceIndex).w;
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

    const r = this.puffRadius;
    const camera = new THREE.OrthographicCamera(-r, r, r, -r, 0.01, r * 4);
    camera.position.set(0, 0, r * 2);

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

  createFarPuffs() {
    const radius = this.puffRadius;
    const material = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false });

    this.cameraRight = uniform(new THREE.Vector3(1, 0, 0));
    this.cameraUp = uniform(new THREE.Vector3(0, 1, 0));

    const fullness = varyingProperty('float', 'vPuffFullness');

    material.positionNode = Fn(() => {
      const i = instanceIndex;
      const flower = this.flowerBuffer.element(i);

      fullness.assign(this.seedFullness(i));
      const size = float(radius).mul(flower.w).mul(float(1).sub(this.nearFlags.element(i)));
      const corner = this.cameraRight.mul(positionGeometry.x).add(this.cameraUp.mul(positionGeometry.y));
      return this.headPosition(i).add(corner.mul(size));
    })();

    const mirror = fract(this.flowerBuffer.element(instanceIndex).x.mul(12.9898)).greaterThan(0.5);
    const photo = texture(this.impostorTexture, vec2(select(mirror, uv().x.oneMinus(), uv().x), uv().y.oneMinus()));

    const tint = mix(color('#b9c4ff'), vec3(1), uTimeOfDay);
    const light = mix(float(0.35), float(0.85), uTimeOfDay);
    const glow = color('#7df9ff').mul(uTimeOfDay.oneMinus()).mul(0.6);
    material.colorNode = photo.rgb.mul(tint).mul(light).add(glow);
    material.opacityNode = photo.a.mul(fullness); // kale bol: ijler, tot alleen de bol overblijft

    this.addMesh(new THREE.InstancedMesh(new THREE.PlaneGeometry(2, 2), material, this.flowers.length));
  }

  createNearHeads() {
    const { receptacle, pappus, achene } = this.model.materials;

    receptacle.positionNode = Fn(() => {
      const slot = this.nearSlots.element(instanceIndex);
      const i = int(slot.max(0));
      const flower = this.flowerBuffer.element(i);
      const bald = float(1).sub(this.seedFullness(i));
      const shape = positionGeometry.add(attribute('barePosition', 'vec3').mul(bald));
      normalLocal.assign(normalGeometry.add(attribute('bareNormal', 'vec3').mul(bald)).normalize());
      const position = this.headPosition(i).add(shape.mul(flower.w));
      return select(slot.greaterThanEqual(0), position, vec3(0)); // lege plek: onzichtbaar
    })();
    this.addMesh(new THREE.InstancedMesh(this.model.receptacleGeometry, receptacle, NEAR_HEADS));

    const seedPosition = Fn(() => {
      const slot = this.nearSlots.element(instanceIndex.div(SEEDS_PER_HEAD));
      const k = instanceIndex.mod(SEEDS_PER_HEAD);
      const i = int(slot.max(0));
      const flower = this.flowerBuffer.element(i);
      const q = this.seedRotations.element(k);
      const direction = this.seedDirections.element(k).xyz;

      const grown = this.seedAttached(i, k);

      normalLocal.assign(rotate(normalGeometry, q));
      const rotated = rotate(positionGeometry, q).mul(flower.w).mul(grown);
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

  applyPuffColor(material, dayColor) {
    material.colorNode = mix(color('#b9c4ff'), color(dayColor), uTimeOfDay);
    material.emissiveNode = color('#7df9ff').mul(uTimeOfDay.oneMinus()).mul(0.6);
  }

  addMesh(mesh) {
    mesh.frustumCulled = false;
    this.group.add(mesh);
  }

  update(delta, camera) {
    this.renderer.compute(this.headCompute);

    this.cameraRight.value.setFromMatrixColumn(camera.matrixWorld, 0);
    this.cameraUp.value.setFromMatrixColumn(camera.matrixWorld, 1);

    this.lodTimer += delta;
    if (this.lodTimer < LOD_INTERVAL) return;
    this.lodTimer = 0;

    this.projection.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    this.frustum.setFromProjectionMatrix(this.projection);
    this.sphere.radius = this.headRadius * SCALE_MAX;

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

function turnTowards(v, direction) {
  return vec3(
    v.x.mul(direction.x).sub(v.z.mul(direction.y)),
    v.y,
    v.x.mul(direction.y).add(v.z.mul(direction.x)),
  );
}

export function rotate(v, q) {
  return v.add(cross(q.xyz, cross(q.xyz, v).add(v.mul(q.w))).mul(2));
}

function scatterFlowers() {
  const flowers = [];
  const fadeStart = MEADOW_RADIUS - EDGE_FADE;

  for (let iz = 0; iz < GRID_CELLS; iz++) {
    for (let ix = 0; ix < GRID_CELLS; ix++) {
      const gx = -MEADOW_RADIUS + ix * FLOWER_SPACING;
      const gz = -MEADOW_RADIUS + iz * FLOWER_SPACING;
      const x = gx + (Math.random() - 0.5) * FLOWER_SPACING * 0.9;
      const z = gz + (Math.random() - 0.5) * FLOWER_SPACING * 0.9;

      const r = Math.hypot(x, z);
      if (r > MEADOW_RADIUS) continue;

      const edge = (r - fadeStart) / EDGE_FADE;
      if (edge > 0 && Math.random() < edge) continue;

      flowers.push({ position: new THREE.Vector3(x, heightAt(x, z), z), cell: iz * GRID_CELLS + ix });
    }
  }

  return flowers;
}
