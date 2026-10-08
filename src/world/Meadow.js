import * as THREE from 'three/webgpu';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import {
  color, mix, smoothstep, vec3, dot, positionLocal, positionGeometry, instancedDynamicBufferAttribute,
} from 'three/tsl';
import { uTimeOfDay } from '../state/worldState.js';
import { windAt } from './wind.js';
import { heightAt } from './terrain.js';

const MEADOW_RADIUS = 36; // straal van de wei (m)
const FLOWER_SPACING = 0.9; // gemiddelde afstand tussen bloemen (m)
const EDGE_FADE = 8; // laatste meters naar de rand: steeds ijler, geen harde grens
const STEM_HEIGHT = 2.4;
const HEAD_RADIUS = 0.35;

/**
 * PLACEHOLDER-wei: simpele bloemen (cilinder + bol) als één InstancedMesh.
 * Later: steel, pluizenbol, bladrozet en gele bloem uit Blender (GLB),
 * pluisjes via gulden-hoekverdeling, steel-buigen als morph target.
 */
export function createMeadow() {
  const positions = scatterFlowers();
  const flowers = positions.map((position) => ({
    position, // voet van de bloem
    scale: 0.8 + Math.random() * 0.4,
  }));

  // Uitwijking per bloem door de physics (x/z in wereld-units, aan de top van de steel).
  // FlowerPhysics schrijft hierin, de shader leest het.
  const pushAttribute = new THREE.InstancedBufferAttribute(new Float32Array(flowers.length * 2), 2);
  pushAttribute.setUsage(THREE.DynamicDrawUsage);

  const geometry = createPlaceholderFlowerGeometry();
  const material = createFlowerMaterial(pushAttribute);

  const mesh = new THREE.InstancedMesh(geometry, material, flowers.length);
  mesh.castShadow = true;
  // Bounding sphere van één bloem klopt niet voor de hele wei: niet wegknippen
  mesh.frustumCulled = false;

  const matrix = new THREE.Matrix4();
  const scale = new THREE.Vector3();
  flowers.forEach((flower, i) => {
    scale.setScalar(flower.scale);
    // Enkel verplaatsen + schalen (geen rotatie), zodat lokale x/z = wereld-x/z voor de wind
    matrix.compose(flower.position, new THREE.Quaternion(), scale);
    mesh.setMatrixAt(i, matrix);
  });

  return { mesh, flowers, pushAttribute, stemHeight: STEM_HEIGHT, headRadius: HEAD_RADIUS };
}

function createPlaceholderFlowerGeometry() {
  // Weinig hoekjes: er staan duizenden van deze bloemen
  const stem = new THREE.CylinderGeometry(0.03, 0.045, STEM_HEIGHT, 5, 8);
  stem.translate(0, STEM_HEIGHT / 2, 0);

  const head = new THREE.SphereGeometry(HEAD_RADIUS, 14, 10);
  head.translate(0, STEM_HEIGHT, 0);

  return mergeGeometries([stem, head]);
}

function createFlowerMaterial(pushAttribute) {
  const material = new THREE.MeshStandardNodeMaterial({ roughness: 0.8 });

  // positionGeometry = originele vertexpositie (vóór instancing), dus hoogte in de bloem zelf
  const heightInFlower = positionGeometry.y;
  const isHead = smoothstep(STEM_HEIGHT - HEAD_RADIUS - 0.05, STEM_HEIGHT - HEAD_RADIUS + 0.05, heightInFlower);

  // Buigen: voet staat vast, top buigt het meest (kwadratisch)
  const bend = heightInFlower.div(STEM_HEIGHT).clamp(0, 1).pow(2);

  // Totale uitwijking aan de top = wind (golven over de wei) + physics (cursor, veer)
  const wind = windAt(positionLocal.xz).mul(1.2);
  const push = instancedDynamicBufferAttribute(pushAttribute, 'vec2');
  const offset = wind.add(push);

  // Een gebogen steel wordt niet langer: de top zakt een beetje (≈ uitwijking² / 2·lengte)
  const drop = dot(offset, offset).div(2 * STEM_HEIGHT);
  material.positionNode = positionLocal.add(vec3(offset.x, drop.negate(), offset.y).mul(bend));

  // Kleuren: groene steel, witte bol; 's nachts een zachte neon-gloed op de bol
  const stemColor = mix(color('#2f5a4a'), color('#5e8a3a'), uTimeOfDay);
  const headColor = mix(color('#b9c4ff'), color('#f4f1ea'), uTimeOfDay);
  material.colorNode = mix(stemColor, headColor, isHead);
  material.emissiveNode = color('#7df9ff').mul(isHead).mul(uTimeOfDay.oneMinus()).mul(0.6);

  return material;
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
