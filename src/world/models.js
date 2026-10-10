import * as THREE from 'three/webgpu';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

const MODEL_URL = './models/puffballSimple.glb'; // export van blender/puffballSimple.blend

/**
 * Laadt het Blender-model van de paardenbloem en zet de onderdelen klaar voor de wei:
 * - Stem: verschoven zodat de onderkant van de steel op (0, 0, 0) staat
 * - Puffball: de bol (receptacle), midden op (0, 0, 0)
 * - Seed: het pluisje, gesplitst in pappus (parachuutje) en achene (zaadje);
 *   oorsprong onderaan het zaadje, wijst omhoog (+Y)
 * Alles wordt geschaald met `scale`. De afstand van de voet tot het midden van de bol
 * komt uit de Blender-scène zelf (headCenter).
 */
export async function loadPuffballModel(scale) {
  const gltf = await new GLTFLoader().loadAsync(MODEL_URL);
  gltf.scene.updateMatrixWorld(true);

  const stem = findMesh(gltf.scene, 'Stem');
  const head = findMesh(gltf.scene, 'Puffball');
  const seed = gltf.scene.getObjectByName('Seed');
  const seedParts = seed.isMesh ? [seed] : seed.children.filter((child) => child.isMesh);
  const pappus = seedParts.find((mesh) => /pappus/i.test(mesh.material.name)) ?? seedParts[0];
  const achene = seedParts.find((mesh) => mesh !== pappus);

  // Steel: voet = midden van de onderste ring punten (de oorsprong in Blender ligt in het midden)
  const stemGeometry = worldGeometry(stem);
  const base = lowestRingCenter(stemGeometry);
  stemGeometry.translate(-base.x, -base.y, -base.z);
  stemGeometry.computeBoundingBox();
  const stemHeight = stemGeometry.boundingBox.max.y;

  // Midden van de bol t.o.v. de voet, zoals in de Blender-scène
  const headCenter = head.getWorldPosition(new THREE.Vector3()).sub(base);
  const receptacleGeometry = head.geometry.clone();
  receptacleGeometry.computeBoundingSphere();
  const receptacleRadius = receptacleGeometry.boundingSphere.radius;

  // Pluisje: eigen geometrie, zonder de verschuiving van het object in de scène
  const pappusGeometry = pappus.geometry.clone();
  const acheneGeometry = achene?.geometry.clone();
  pappusGeometry.computeBoundingBox();
  const seedLength = pappusGeometry.boundingBox.max.y;

  for (const geometry of [stemGeometry, receptacleGeometry, pappusGeometry, acheneGeometry]) {
    geometry?.scale(scale, scale, scale);
  }

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
    stemHeight: stemHeight * scale,
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

/** Geometrie met de transformatie van het object erin verwerkt */
function worldGeometry(mesh) {
  return mesh.geometry.clone().applyMatrix4(mesh.matrixWorld);
}

/** Gemiddelde van de punten in de onderste 2% van de hoogte: het midden van de voet */
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

/** Blender-materiaal → node-materiaal (nodig om er TSL-shaders aan te hangen) */
function toNodeMaterial(source) {
  const material = new THREE.MeshStandardNodeMaterial({
    color: source.color,
    roughness: source.roughness,
    metalness: source.metalness,
    map: source.map,
    side: source.side,
  });
  material.name = source.name;
  return material;
}
