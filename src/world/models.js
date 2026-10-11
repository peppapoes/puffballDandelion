import * as THREE from 'three/webgpu';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

const MODEL_URL = './models/puffballSimple.glb'; // export van blender/puffballSimple.blend

/**
 * Laadt het Blender-model van de paardenbloem en zet de onderdelen klaar voor de wei:
 * - Stem: verschoven zodat de onderkant van de steel op (0, 0, 0) staat, met de shape key
 *   "Buigen" als eigen attributen (bendPosition, bendNormal) en gebakken AO (aoMap)
 * - Puffball: de bol (receptacle), midden op (0, 0, 0), met de shape key "Kaal"
 *   (barePosition, bareNormal): de bol zonder pluisjes
 * - Seed: het pluisje, gesplitst in pappus (parachuutje) en achene (zaadje);
 *   oorsprong onderaan het zaadje, wijst omhoog (+Y), met de shape key "Open"
 *   (openPosition, openNormal): het parachuutje volledig open, zoals in de vlucht
 * Shape keys worden eigen attributen, zodat de vertex-shaders ze per bloem of per pluisje
 * zelf aansturen (Three.js zou ze anders voor alle instances tegelijk toepassen).
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
  // Shape key "Buigen" uit Blender (morph target): per punt de verschuiving bij volle buiging naar +X.
  // Eerst eruit halen: anders telt computeBoundingBox de gebogen vorm mee en vindt hij de voet niet.
  const bend = takeShapeKey(stemGeometry, stem, 'Buigen', 'bend', { required: true });
  const base = lowestRingCenter(stemGeometry);
  stemGeometry.translate(-base.x, -base.y, -base.z);

  // Midden van de bol t.o.v. de voet, zoals in de Blender-scène
  const headCenter = head.getWorldPosition(new THREE.Vector3()).sub(base);
  const receptacleGeometry = head.geometry.clone();
  const bare = takeShapeKey(receptacleGeometry, head, 'Kaal', 'bare'); // eerst eruit: anders telt de kale vorm mee
  receptacleGeometry.computeBoundingSphere();
  const receptacleRadius = receptacleGeometry.boundingSphere.radius;

  // Pluisje: eigen geometrie, zonder de verschuiving van het object in de scène
  const pappusGeometry = pappus.geometry.clone();
  const open = takeShapeKey(pappusGeometry, pappus, 'Open', 'open');
  const acheneGeometry = achene?.geometry.clone();
  pappusGeometry.computeBoundingBox();
  const seedLength = pappusGeometry.boundingBox.max.y;

  for (const geometry of [stemGeometry, receptacleGeometry, pappusGeometry, acheneGeometry]) {
    geometry?.scale(scale, scale, scale);
  }
  // scale() verschaalt alleen de vaste attributen (position, normal), de vormen van de shape keys zelf doen
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

/**
 * Shape key uit Blender (glTF morph target) → eigen attributen `${prefix}Position` en `${prefix}Normal`:
 * per punt de verschuiving bij waarde 1 (glTF bewaart een shape key als verschuiving t.o.v. de basisvorm).
 * Daarna verwijderd uit de geometrie: Three.js zou hem anders zelf toepassen, voor alle instances
 * tegelijk en in dezelfde richting. Ontbreekt hij (oudere export), dan worden het nullen: geen vervorming.
 */
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

/** Verschuiving van het hoogste punt (de top van de steel, waar de bol op komt) */
function topOffset(geometry, offsets) {
  const points = geometry.attributes.position;
  let top = 0;
  for (let i = 1; i < points.count; i++) if (points.getY(i) > points.getY(top)) top = i;
  return new THREE.Vector3().fromBufferAttribute(offsets, top);
}

/** Blender-materiaal → node-materiaal (nodig om er TSL-shaders aan te hangen) */
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
