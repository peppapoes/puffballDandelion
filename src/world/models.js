import * as THREE from 'three/webgpu';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

const MODEL_URL = './models/puffballSimple.glb'; // export van blender/puffballSimple.blend

export async function loadPuffballModel(scale) {
  const gltf = await new GLTFLoader().loadAsync(MODEL_URL);
  gltf.scene.updateMatrixWorld(true);

  const stem = findMesh(gltf.scene, 'Stem');
  const head = findMesh(gltf.scene, 'Puffball');
  const seed = gltf.scene.getObjectByName('Seed');
  const seedParts = seed.isMesh ? [seed] : seed.children.filter((child) => child.isMesh);
  const pappus = seedParts.find((mesh) => /pappus/i.test(mesh.material.name)) ?? seedParts[0];
  const achene = seedParts.find((mesh) => mesh !== pappus);

  const stemGeometry = worldGeometry(stem);
  const bend = takeShapeKey(stemGeometry, stem, 'Buigen', 'bend', { required: true });
  const base = lowestRingCenter(stemGeometry);
  stemGeometry.translate(-base.x, -base.y, -base.z);

  const headCenter = head.getWorldPosition(new THREE.Vector3()).sub(base);
  const receptacleGeometry = head.geometry.clone();
  const bare = takeShapeKey(receptacleGeometry, head, 'Kaal', 'bare'); // eerst eruit: anders telt de kale vorm mee
  receptacleGeometry.computeBoundingSphere();
  const receptacleRadius = receptacleGeometry.boundingSphere.radius;

  const pappusGeometry = pappus.geometry.clone();
  const open = takeShapeKey(pappusGeometry, pappus, 'Open', 'open');
  const acheneGeometry = achene?.geometry.clone();
  pappusGeometry.computeBoundingBox();
  const seedLength = pappusGeometry.boundingBox.max.y;

  for (const geometry of [stemGeometry, receptacleGeometry, pappusGeometry, acheneGeometry]) {
    geometry?.scale(scale, scale, scale);
  }
  const scaling = new THREE.Matrix4().makeScale(scale, scale, scale);
  for (const shape of [bend, bare, open]) shape.position.applyMatrix4(scaling);
  const bendTop = topOffset(stemGeometry, bend.position);

  return {
    stemGeometry,
    receptacleGeometry,
    pappusGeometry,
    acheneGeometry,
    materials: {
      stem: toNodeMaterial(stem.material),
      receptacle: toNodeMaterial(head.material),
      pappus: toNodeMaterial(pappus.material),
      achene: achene ? toNodeMaterial(achene.material) : null,
    },
    bendTop, // verschuiving van de top bij volle buiging (x opzij, y omlaag)
    headCenter: headCenter.multiplyScalar(scale),
    receptacleRadius: receptacleRadius * scale,
    seedLength: seedLength * scale,
  };
}

function findMesh(root, name) {
  const object = root.getObjectByName(name);
  if (!object) throw new Error(`Object "${name}" niet gevonden in ${MODEL_URL}`);
  if (object.isMesh) return object;
  const mesh = object.children.find((child) => child.isMesh);
  if (!mesh) throw new Error(`Object "${name}" heeft geen mesh`);
  return mesh;
}

function worldGeometry(mesh) {
  return mesh.geometry.clone().applyMatrix4(mesh.matrixWorld);
}

function lowestRingCenter(geometry) {
  geometry.computeBoundingBox();
  const { min, max } = geometry.boundingBox;
  const limit = min.y + (max.y - min.y) * 0.02;
  const position = geometry.attributes.position;
  const center = new THREE.Vector3();
  const point = new THREE.Vector3();
  let count = 0;
  for (let i = 0; i < position.count; i++) {
    point.fromBufferAttribute(position, i);
    if (point.y <= limit) {
      center.add(point);
      count++;
    }
  }
  return center.divideScalar(count);
}

function takeShapeKey(geometry, mesh, name, prefix, { required = false } = {}) {
  const index = mesh.morphTargetDictionary?.[name]; // naam → nummer, uit extras.targetNames van de glTF
  let position = geometry.morphAttributes.position?.[index]?.clone();
  let normal = geometry.morphAttributes.normal?.[index]?.clone();
  if (!position && required) throw new Error(`Shape key "${name}" niet gevonden op ${mesh.name} in ${MODEL_URL}`);
  const count = geometry.attributes.position.count;
  position ??= new THREE.BufferAttribute(new Float32Array(count * 3), 3);
  normal ??= new THREE.BufferAttribute(new Float32Array(count * 3), 3);
  geometry.setAttribute(`${prefix}Position`, position);
  geometry.setAttribute(`${prefix}Normal`, normal);
  geometry.morphAttributes = {};
  return { position };
}

function topOffset(geometry, offsets) {
  const points = geometry.attributes.position;
  let top = 0;
  for (let i = 1; i < points.count; i++) if (points.getY(i) > points.getY(top)) top = i;
  return new THREE.Vector3().fromBufferAttribute(offsets, top);
}

function toNodeMaterial(source) {
  const material = new THREE.MeshStandardNodeMaterial({
    color: source.color,
    roughness: source.roughness,
    metalness: source.metalness,
    map: source.map,
    aoMap: source.aoMap, // gebakken Ambient Occlusion uit Blender (occlusionTexture in de glTF)
    side: source.side,
  });
  material.name = source.name;
  return material;
}
