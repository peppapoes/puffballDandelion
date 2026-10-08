import * as THREE from 'three/webgpu';

/**
 * Houdt de cursor bij als straal (ray) vanaf de camera de 3D-wereld in.
 * Bewaart ook de straal van de vorige frame, zodat de physics kan afleiden
 * hoe snel en in welke richting de cursor door de wei beweegt.
 *
 * Later: de hand uit MediaPipe kan dezelfde straal aansturen.
 */
export class Pointer {
  constructor(canvas) {
    this.ndc = new THREE.Vector2(); // -1..1 over het scherm
    this.active = false; // cursor boven het canvas?
    this.ray = new THREE.Ray();
    this.previousRay = new THREE.Ray();

    this.raycaster = new THREE.Raycaster();
    this.hasPrevious = false;

    canvas.addEventListener('pointermove', (event) => {
      const rect = canvas.getBoundingClientRect();
      this.ndc.set(
        ((event.clientX - rect.left) / rect.width) * 2 - 1,
        -((event.clientY - rect.top) / rect.height) * 2 + 1
      );
      this.active = true;
    });

    canvas.addEventListener('pointerleave', () => {
      this.active = false;
      this.hasPrevious = false;
    });
  }

  /** Elke frame: straal opnieuw berekenen (ook als de camera beweegt en de muis niet) */
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
