import * as THREE from 'three/webgpu';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { color, mix, smoothstep, vec3, positionLocal, positionGeometry } from 'three/tsl';
import { uTimeOfDay } from '../state/worldState.js';
import { windAt } from './wind.js';
import { heightAt } from './terrain.js';

const FLOWER_COUNT = 60;
const MEADOW_RADIUS = 18;
const STEM_HEIGHT = 2.4;
const HEAD_RADIUS = 0.35;

/**
 * PLACEHOLDER-wei: simpele bloemen (cilinder + bol) als één InstancedMesh.
 * Later: steel, pluizenbol, bladrozet en gele bloem uit Blender (GLB),
 * pluisjes via gulden-hoekverdeling, steel-buigen als morph target.
 */
export function createMeadow() {
  const geometry = createPlaceholderFlowerGeometry();
  const material = createFlowerMaterial();

  const mesh = new THREE.InstancedMesh(geometry, material, FLOWER_COUNT);
  mesh.castShadow = true;
  // Bounding sphere van één bloem klopt niet voor de hele wei: niet wegknippen
  mesh.frustumCulled = false;

  const flowerPositions = scatterFlowers(FLOWER_COUNT, MEADOW_RADIUS);
  const matrix = new THREE.Matrix4();
  const scale = new THREE.Vector3();
  flowerPositions.forEach((p, i) => {
    const s = 0.8 + Math.random() * 0.4;
    scale.set(s, s, s);
    // Enkel verplaatsen + schalen (geen rotatie), zodat lokale x/z = wereld-x/z voor de wind
    matrix.compose(p, new THREE.Quaternion(), scale);
    mesh.setMatrixAt(i, matrix);
  });

  return { mesh, flowerPositions };
}

function createPlaceholderFlowerGeometry() {
  const stem = new THREE.CylinderGeometry(0.03, 0.045, STEM_HEIGHT, 6, 16);
  stem.translate(0, STEM_HEIGHT / 2, 0);

  const head = new THREE.SphereGeometry(HEAD_RADIUS, 20, 14);
  head.translate(0, STEM_HEIGHT, 0);

  return mergeGeometries([stem, head]);
}

function createFlowerMaterial() {
  const material = new THREE.MeshStandardNodeMaterial({ roughness: 0.8 });

  // positionGeometry = originele vertexpositie (vóór instancing), dus hoogte in de bloem zelf
  const heightInFlower = positionGeometry.y;
  const isHead = smoothstep(STEM_HEIGHT - HEAD_RADIUS - 0.05, STEM_HEIGHT - HEAD_RADIUS + 0.05, heightInFlower);

  // Buigen in de wind: voet staat vast, top buigt het meest (kwadratisch)
  const bend = heightInFlower.div(STEM_HEIGHT).clamp(0, 1).pow(2);
  const wind = windAt(positionLocal.xz);
  material.positionNode = positionLocal.add(vec3(wind.x, 0, wind.y).mul(bend).mul(1.2));

  // Kleuren: groene steel, witte bol; 's nachts een zachte neon-gloed op de bol
  const stemColor = mix(color('#2f5a4a'), color('#5e8a3a'), uTimeOfDay);
  const headColor = mix(color('#b9c4ff'), color('#f4f1ea'), uTimeOfDay);
  material.colorNode = mix(stemColor, headColor, isHead);
  material.emissiveNode = color('#7df9ff').mul(isHead).mul(uTimeOfDay.oneMinus()).mul(0.6);

  return material;
}

/**
 * PLACEHOLDER-spreiding: willekeurig in een cirkel, met minimale afstand.
 * Later: procedurele verspreiding (bv. Poisson-disc) als uitgewerkte feature.
 */
function scatterFlowers(count, radius) {
  const positions = [];
  const MIN_DISTANCE = 1.4;
  let attempts = 0;

  while (positions.length < count && attempts < count * 50) {
    attempts++;
    const angle = Math.random() * Math.PI * 2;
    const r = Math.sqrt(Math.random()) * radius; // sqrt = gelijkmatig over de cirkel
    const x = Math.cos(angle) * r;
    const z = Math.sin(angle) * r;

    const tooClose = positions.some((p) => Math.hypot(p.x - x, p.z - z) < MIN_DISTANCE);
    if (!tooClose) positions.push(new THREE.Vector3(x, heightAt(x, z), z));
  }

  return positions;
}
