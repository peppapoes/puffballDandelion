import * as THREE from 'three/webgpu';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

/**
 * Overzichtscamera op de wei. OrbitControls is tijdelijk, om tijdens het bouwen
 * rond te kijken; later vervangen door de vloeiende inzoom-overgang naar één bloem.
 */
export function createCamera(canvas) {
  const camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.1, 500);
  camera.position.set(0, 6, 22);

  const controls = new OrbitControls(camera, canvas);
  controls.target.set(0, 1.5, 0);
  controls.enableDamping = true;
  controls.maxPolarAngle = Math.PI * 0.49; // niet onder de grond kijken
  controls.update();

  return { camera, controls };
}
