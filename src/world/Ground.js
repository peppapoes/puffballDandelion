import * as THREE from 'three/webgpu';
import { color, mix, positionGeometry, texture, vec3 } from 'three/tsl';
import { camouflage } from 'tsl-textures';
import { uTimeOfDay } from '../state/worldState.js';
import { heightAt, heightAtNode } from './terrain.js';

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

// Gebakken graskleur: BAKE_EXTENT × BAKE_EXTENT meter rond het midden, in BAKE_SIZE² pixels
// (±8 cm per pixel, ruim fijn genoeg voor plukjes van ±1 m). Verder weg is alles nevel
// (FOG_FAR = 70 m in App.js), daar herhaalt de textuur gewoon haar rand.
const BAKE_SIZE = 2048;
const BAKE_EXTENT = 160;

/**
 * Grond van de wei: glooiend vlak met een procedurele graskleur uit tsl-textures
 * (extra WebGPU-library: texturen in TSL, berekend uit ruis, zonder afbeeldingen).
 * camouflage geeft vlekken in vier tinten; twee lagen (grote plekken en kleine plukjes)
 * door elkaar, zodat het zowel van ver als van dichtbij natuurlijk oogt.
 *
 * Gebakken: de camouflage wordt bij het opstarten één keer in een textuur getekend (bakeGrass).
 * Live per pixel kostte ze de helft van elke frame (gemeten ±30 ms op een retina-scherm),
 * terwijl het patroon nooit verandert. Live blijven: de nachtkleur en de schaduwen van de
 * paardenbloemen (FlowerShadows.js), want die veranderen wel.
 */
export function createGround(renderer, shadows) {
  const geometry = new THREE.PlaneGeometry(SIZE, SIZE, SEGMENTS, SEGMENTS);
  geometry.rotateX(-Math.PI / 2);

  const position = geometry.attributes.position;
  for (let i = 0; i < position.count; i++) {
    position.setY(i, heightAt(position.getX(i), position.getZ(i)));
  }
  geometry.computeVertexNormals();

  // Plek in de wei (x, z) → plek in de gebakken textuur (0..1)
  const day = texture(bakeGrass(renderer), positionGeometry.xz.div(BAKE_EXTENT).add(0.5)).rgb;
  const grass = mix(day.mul(NIGHT_TINT), day, uTimeOfDay);

  const material = new THREE.MeshStandardNodeMaterial({ roughness: 1 });
  material.colorNode = grass.mul(shadows.lightAt(positionGeometry.xz));

  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = 'ground';
  mesh.userData.colorWithoutShadows = grass; // om de kost van de schaduwen te meten (console)
  return mesh;
}

/**
 * De camouflage van bovenaf fotograferen naar een textuur, zoals de impostor van de
 * pluizenbol (Meadow.bakeImpostor): een vlak met het patroon, een orthografische camera
 * (zonder perspectief) die recht naar beneden kijkt, en één keer renderen.
 */
function bakeGrass(renderer) {
  const plane = new THREE.PlaneGeometry(BAKE_EXTENT, BAKE_EXTENT);
  plane.rotateX(-Math.PI / 2);

  // Zelfde ruis als voorheen: de hoogte van het terrein telt mee (3D-ruis), dus dezelfde vlekken
  const xz = positionGeometry.xz;
  const position = vec3(xz.x, heightAtNode(xz), xz.y);
  const large = camouflage({ ...MEADOW, position, scale: PATCHES_LARGE, seed: 0 });
  const small = camouflage({ ...MEADOW, position, scale: PATCHES_SMALL, seed: 7 });
  const material = new THREE.MeshBasicNodeMaterial();
  material.colorNode = mix(large, small, SMALL_AMOUNT);

  const scene = new THREE.Scene();
  scene.add(new THREE.Mesh(plane, material));

  // Recht naar beneden; "boven" in het beeld = −z, zodat de textuur rechtstreeks met (x, z) leest
  // (in een render target ligt de bovenkant van het beeld bij v = 0)
  const half = BAKE_EXTENT / 2;
  const camera = new THREE.OrthographicCamera(-half, half, half, -half, 1, 100);
  camera.position.set(0, 50, 0);
  camera.up.set(0, 0, -1);
  camera.lookAt(0, 0, 0);

  // Mipmaps en anisotropie: in de verte (schuin bekeken) rustig, zonder flikkeren
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
