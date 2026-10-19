import * as THREE from 'three/webgpu';
import { color, mix, positionGeometry, texture, vec3 } from 'three/tsl';
import { camouflage } from 'tsl-textures';
import { uTimeOfDay } from '../state/worldState.js';
import { heightAt, heightAtNode } from './terrain.js';

const SIZE = 600;
const SEGMENTS = 240;

const MEADOW = {
  colorA: new THREE.Color('#71984a'), // droger, zonnig gras
  colorB: new THREE.Color('#537f37'), // schaduw en mos
  colorC: new THREE.Color('#6a9040'), // geelgroen
  colorD: new THREE.Color('#5f8f3e'), // basis (meeste oppervlak)
};
const PATCHES_LARGE = Math.log(1 / 10); // plekken van ±10 m
const PATCHES_SMALL = Math.log(1); // plukjes van ±1 m
const SMALL_AMOUNT = 0.35; // hoeveel de kleine plukjes doorschemeren
const NIGHT_TINT = color('#2f5f58').div(color('#5f8f3e'));

const BAKE_SIZE = 2048;
const BAKE_EXTENT = 160;

export function createGround(renderer, shadows) {
  const geometry = new THREE.PlaneGeometry(SIZE, SIZE, SEGMENTS, SEGMENTS);
  geometry.rotateX(-Math.PI / 2);

  const position = geometry.attributes.position;
  for (let i = 0; i < position.count; i++) {
    position.setY(i, heightAt(position.getX(i), position.getZ(i)));
  }
  geometry.computeVertexNormals();

  const day = texture(bakeGrass(renderer), positionGeometry.xz.div(BAKE_EXTENT).add(0.5)).rgb;
  const grass = mix(day.mul(NIGHT_TINT), day, uTimeOfDay);

  const material = new THREE.MeshStandardNodeMaterial({ roughness: 1 });
  material.colorNode = grass.mul(shadows.lightAt(positionGeometry.xz));

  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = 'ground';
  return mesh;
}

function bakeGrass(renderer) {
  const plane = new THREE.PlaneGeometry(BAKE_EXTENT, BAKE_EXTENT);
  plane.rotateX(-Math.PI / 2);

  const xz = positionGeometry.xz;
  const position = vec3(xz.x, heightAtNode(xz), xz.y);
  const large = camouflage({ ...MEADOW, position, scale: PATCHES_LARGE, seed: 0 });
  const small = camouflage({ ...MEADOW, position, scale: PATCHES_SMALL, seed: 7 });
  const material = new THREE.MeshBasicNodeMaterial();
  material.colorNode = mix(large, small, SMALL_AMOUNT);

  const scene = new THREE.Scene();
  scene.add(new THREE.Mesh(plane, material));

  const half = BAKE_EXTENT / 2;
  const camera = new THREE.OrthographicCamera(-half, half, half, -half, 1, 100);
  camera.position.set(0, 50, 0);
  camera.up.set(0, 0, -1);
  camera.lookAt(0, 0, 0);

  const target = new THREE.RenderTarget(BAKE_SIZE, BAKE_SIZE);
  target.texture.generateMipmaps = true;
  target.texture.minFilter = THREE.LinearMipmapLinearFilter;
  target.texture.anisotropy = 8;

  renderer.setRenderTarget(target);
  renderer.render(scene, camera);
  renderer.setRenderTarget(null);

  material.dispose();
  plane.dispose();
  return target.texture;
}
