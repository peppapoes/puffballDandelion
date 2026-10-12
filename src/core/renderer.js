import * as THREE from 'three/webgpu';

// Resolutie: hoogstens 1,5 pixels per CSS-pixel. Op een retina-scherm (2) kostte de volle resolutie
// ±16 ms per frame extra, en met MSAA (antialias) zie je het verschil nauwelijks.
const MAX_PIXEL_RATIO = 1.5;

/**
 * Maakt de WebGPURenderer. Als de browser geen WebGPU heeft,
 * valt Three.js automatisch terug op een WebGL2-backend.
 */
export async function createRenderer(canvas) {
  const renderer = new THREE.WebGPURenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, MAX_PIXEL_RATIO));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;

  // Wachten tot de backend (WebGPU of WebGL2) klaar is
  await renderer.init();

  const isWebGPU = renderer.backend.isWebGPUBackend === true;
  showBackendBadge(isWebGPU ? 'WebGPU' : 'WebGL2 (fallback)');

  return renderer;
}

function showBackendBadge(label) {
  const badge = document.getElementById('backend-badge');
  if (!badge) return;
  badge.textContent = label;
  badge.hidden = false;
}
