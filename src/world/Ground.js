import * as THREE from 'three/webgpu';
import { color, mix, positionGeometry } from 'three/tsl';
import { camouflage } from 'tsl-textures';
import { uTimeOfDay } from '../state/worldState.js';
import { heightAt } from './terrain.js';

// Groot genoeg om tot in de nevel aan de horizon te lopen: je ziet nooit de rand
const SIZE = 600;
const SEGMENTS = 240;

// Weidekleuren overdag, dicht bij elkaar: camouflage maakt harde randen tussen de tinten,
// met weinig verschil lijken die op natuurlijke plekken in het gras
const MEADOW = {
  colorA: new THREE.Color('#71984a'), // droger, zonnig gras
  colorB: new THREE.Color('#537f37'), // schaduw en mos
  colorC: new THREE.Color('#6a9040'), // geelgroen
  colorD: new THREE.Color('#5f8f3e'), // basis (meeste oppervlak)
};
// Vlekgrootte: camouflage rekent met positie × e^scale
const PATCHES_LARGE = Math.log(1 / 10); // plekken van ±10 m
const PATCHES_SMALL = Math.log(1); // plukjes van ±1 m
const SMALL_AMOUNT = 0.35; // hoeveel de kleine plukjes doorschemeren
// 's Nachts: dezelfde vlekken, maar blauwgroen (basis #5f8f3e wordt #2f5f58, zoals voorheen)
const NIGHT_TINT = color('#2f5f58').div(color('#5f8f3e'));

/**
 * Grond van de wei: glooiend vlak met een procedurele graskleur uit tsl-textures
 * (extra WebGPU-library: texturen in TSL, per pixel berekend uit ruis, zonder afbeeldingen).
 * camouflage geeft vlekken in vier tinten; twee lagen (grote plekken en kleine plukjes)
 * door elkaar, zodat het zowel van ver als van dichtbij natuurlijk oogt.
 * Plus de schaduwen van de paardenbloemen (FlowerShadows.js).
 */
export function createGround(shadows) {
  const geometry = new THREE.PlaneGeometry(SIZE, SIZE, SEGMENTS, SEGMENTS);
  geometry.rotateX(-Math.PI / 2);

  const position = geometry.attributes.position;
  for (let i = 0; i < position.count; i++) {
    position.setY(i, heightAt(position.getX(i), position.getZ(i)));
  }
  geometry.computeVertexNormals();

  // Op de positie in de wei (geen transformatie op de grond): de vlekken liggen vast in de wereld
  const large = camouflage({ ...MEADOW, position: positionGeometry, scale: PATCHES_LARGE, seed: 0 });
  const small = camouflage({ ...MEADOW, position: positionGeometry, scale: PATCHES_SMALL, seed: 7 });
  const day = mix(large, small, SMALL_AMOUNT);
  const grass = mix(day.mul(NIGHT_TINT), day, uTimeOfDay);

  const material = new THREE.MeshStandardNodeMaterial({ roughness: 1 });
  material.colorNode = grass.mul(shadows.lightAt(positionGeometry.xz));

  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = 'ground';
  mesh.userData.colorWithoutShadows = grass; // om de kost van de schaduwen te meten (console)
  return mesh;
}
