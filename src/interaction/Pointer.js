import * as THREE from 'three/webgpu';

/**
 * Een "aanwijzer" als straal (ray) vanaf de camera de 3D-wereld in.
 * Bewaart ook de straal van de vorige frame, zodat de physics kan afleiden
 * hoe snel en in welke richting de aanwijzer door de wei beweegt.
 *
 * Wordt gestuurd door de muis (attachMouse) of door de hand (HandTracker).
 * touchMargin = hoe ver naast een pluizenbol de aanwijzer nog effect heeft:
 * klein voor de muis, groot voor een hand.
 */
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

  /** Positie op het scherm in NDC (-1..1, y omhoog) */
  moveTo(x, y) {
    this.ndc.set(x, y);
    this.active = true;
  }

  leave() {
    this.active = false;
    this.hasPrevious = false;
  }

  /** Elke frame: straal opnieuw berekenen (ook als de camera beweegt en de aanwijzer niet) */
  update(camera) {
    if (!this.active) return;

    this.previousRay.copy(this.ray);
    this.raycaster.setFromCamera(this.ndc, camera);
    this.ray.copy(this.raycaster.ray);

    // Eerste frame na binnenkomen: geen vorige straal, dus geen valse snelheid
    if (!this.hasPrevious) {
      this.previousRay.copy(this.ray);
      this.hasPrevious = true;
    }
  }
}

/** Muis als aanwijzer: pixels op het canvas → NDC */
export function attachMouse(pointer, canvas) {
  canvas.addEventListener('pointermove', (event) => {
    const rect = canvas.getBoundingClientRect();
    pointer.moveTo(
      ((event.clientX - rect.left) / rect.width) * 2 - 1,
      -((event.clientY - rect.top) / rect.height) * 2 + 1
    );
  });

  canvas.addEventListener('pointerleave', () => pointer.leave());
}
