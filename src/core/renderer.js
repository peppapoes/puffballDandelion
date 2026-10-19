import * as THREE from 'three/webgpu';

const MAX_PIXEL_RATIO = 1.5;

export async function createRenderer(canvas) {
  const renderer = new THREE.WebGPURenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, MAX_PIXEL_RATIO));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;

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
