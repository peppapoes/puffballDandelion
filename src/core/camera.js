import * as THREE from 'three/webgpu';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { heightAt } from '../world/terrain.js';

// Overzicht: je draait rond het midden en kijkt altijd schuin over de bloemen.
// Zo lijkt de wei veel groter dan ze is.
export const OVERVIEW_LIMITS = {
  minDistance: 5, // dichtst bij het midden van de wei
  maxDistance: 18, // verder uitzoomen kan niet: je ziet nooit de rand van de wei
  minPolarAngle: THREE.MathUtils.degToRad(55), // nooit van bovenaf kijken
  maxPolarAngle: THREE.MathUtils.degToRad(78), // nooit vanuit het gras omhoog
  minHeight: 3.5, // altijd over de pluizenbollen heen kijken
};

// Ingezoomd op één bloem (FlowerFocus): dichtbij en rondom, alleen niet onder de grond.
// Afstanden in "bolstralen", want de bloemen verschillen in grootte.
export const FOCUS_LIMITS = {
  minDistance: 1.6, // × straal van de pluizenbol: net buiten de pluisjes
  maxDistance: 7,
  minPolarAngle: THREE.MathUtils.degToRad(15),
  maxPolarAngle: THREE.MathUtils.degToRad(100), // een beetje van onderen mag
  minHeight: 0.2,
};

/** Overzichtscamera op de wei, met grenzen (OVERVIEW_LIMITS) */
export function createCamera(canvas) {
  const camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.1, 500);
  camera.position.set(0, 6, 16);

  const controls = new OrbitControls(camera, canvas);
  controls.target.set(0, heightAt(0, 0) + 1.2, 0);
  controls.enableDamping = true;
  controls.enablePan = false;
  applyCameraLimits(controls, OVERVIEW_LIMITS);
  controls.update();

  return { camera, controls };
}

/** Grenzen van de OrbitControls instellen; scale = vermenigvuldiger voor de afstanden */
export function applyCameraLimits(controls, limits, scale = 1) {
  controls.minDistance = limits.minDistance * scale;
  controls.maxDistance = limits.maxDistance * scale;
  controls.minPolarAngle = limits.minPolarAngle;
  controls.maxPolarAngle = limits.maxPolarAngle;
}

/** Camera nooit in of onder een heuvel laten zakken */
export function keepCameraAboveGround(camera, minHeight = OVERVIEW_LIMITS.minHeight) {
  const minY = heightAt(camera.position.x, camera.position.z) + minHeight;
  if (camera.position.y < minY) camera.position.y = minY;
}
