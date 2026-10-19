import * as THREE from 'three/webgpu';

export class Pointer {
  constructor({ touchMargin = 0.3 } = {}) {
    this.touchMargin = touchMargin;
    this.ndc = new THREE.Vector2(); // -1..1 over het scherm
    this.active = false;
    this.ray = new THREE.Ray();
    this.previousRay = new THREE.Ray();

    this.raycaster = new THREE.Raycaster();
    this.hasPrevious = false;
  }

  moveTo(x, y) {
    this.ndc.set(x, y);
    this.active = true;
  }

  leave() {
    this.active = false;
    this.hasPrevious = false;
  }

  update(camera) {
    if (!this.active) return;

    this.previousRay.copy(this.ray);
    this.raycaster.setFromCamera(this.ndc, camera);
    this.ray.copy(this.raycaster.ray);

    if (!this.hasPrevious) {
      this.previousRay.copy(this.ray);
      this.hasPrevious = true;
    }
  }
}

export function attachMouse(pointer, canvas) {
  let rect = canvas.getBoundingClientRect();
  window.addEventListener('resize', () => (rect = canvas.getBoundingClientRect()));

  canvas.addEventListener('pointermove', (event) => {
    pointer.moveTo(
      ((event.clientX - rect.left) / rect.width) * 2 - 1,
      -((event.clientY - rect.top) / rect.height) * 2 + 1
    );
  });

  canvas.addEventListener('pointerleave', () => pointer.leave());
}
