import * as THREE from 'three/webgpu';
import { color, mix } from 'three/tsl';
import { uTimeOfDay } from '../state/worldState.js';
import { heightAt } from './terrain.js';

// Groot genoeg om tot in de nevel aan de horizon te lopen: je ziet nooit de rand
const SIZE = 600;
const SEGMENTS = 240;

/**
 * PLACEHOLDER-grond: glooiend vlak met een effen kleur.
 * Later: procedurele textuur via tsl-textures + gebakken dag/nacht-lightmap uit Blender.
 */
export function createGround() {
  const geometry = new THREE.PlaneGeometry(SIZE, SIZE, SEGMENTS, SEGMENTS);
  geometry.rotateX(-Math.PI / 2);

  const position = geometry.attributes.position;
  for (let i = 0; i < position.count; i++) {
    position.setY(i, heightAt(position.getX(i), position.getZ(i)));
  }
  geometry.computeVertexNormals();

  const material = new THREE.MeshStandardNodeMaterial({ roughness: 1 });
  material.colorNode = mix(color('#2f5f58'), color('#5f8f3e'), uTimeOfDay);

  const mesh = new THREE.Mesh(geometry, material);
  mesh.receiveShadow = true;
  return mesh;
}
