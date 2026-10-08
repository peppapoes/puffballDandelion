import * as THREE from 'three/webgpu';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { heightAt } from '../world/terrain.js';

const MIN_DISTANCE = 5; // dichtst bij het midden van de wei
const MAX_DISTANCE = 18; // verder uitzoomen kan niet: je ziet nooit de rand van de wei
const MIN_POLAR_ANGLE = THREE.MathUtils.degToRad(55); // nooit van bovenaf kijken
const MAX_POLAR_ANGLE = THREE.MathUtils.degToRad(78); // nooit vanuit het gras omhoog
const MIN_HEIGHT_ABOVE_GROUND = 3.5; // altijd over de pluizenbollen heen kijken

/**
 * Overzichtscamera op de wei, met grenzen: je draait rond het midden en kijkt
 * altijd schuin over de bloemen. Zo lijkt de wei veel groter dan ze is.
 * Later: de vloeiende inzoom-overgang naar één bloem.
 */
export function createCamera(canvas) {
  const camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.1, 500);
  camera.position.set(0, 6, 16);

  const controls = new OrbitControls(camera, canvas);
  controls.target.set(0, heightAt(0, 0) + 1.2, 0);
  controls.enableDamping = true;
  controls.enablePan = false;
  controls.minDistance = MIN_DISTANCE;
  controls.maxDistance = MAX_DISTANCE;
  controls.minPolarAngle = MIN_POLAR_ANGLE;
  controls.maxPolarAngle = MAX_POLAR_ANGLE;
  controls.update();

  return { camera, controls };
}

/** Camera nooit in of onder een heuvel laten zakken */
export function keepCameraAboveGround(camera) {
  const minY = heightAt(camera.position.x, camera.position.z) + MIN_HEIGHT_ABOVE_GROUND;
  if (camera.position.y < minY) camera.position.y = minY;
}
