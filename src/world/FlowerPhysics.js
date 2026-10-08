import * as THREE from 'three/webgpu';

// Veer: hoe stijf de steel is en hoe snel hij uitdeint
const STIFFNESS = 30; // terugtrekkende kracht (hoger = sneller en strakker terug)
const STIFFNESS_VARIATION = 0.25; // ±25% per bloem, zodat ze niet in hetzelfde ritme wiegen
const DAMPING = 2.5; // afremming (laag = lang natrillen, hoog = meteen stil)
const MAX_OFFSET = 1.6; // maximale uitwijking van de top (wereld-units)

// Cursor
const TOUCH_MARGIN = 0.3; // hoe ver naast de bol de cursor nog effect heeft
const DRAG = 8; // meesleuren in de bewegingsrichting van de cursor
const PUSH = 12; // zacht wegduwen van de cursor, ook als die stilstaat
const MAX_CURSOR_SPEED = 30; // te snelle rukken afvlakken (wereld-units per seconde)

/**
 * Veer-physics voor de stelen: elke bloem is een gedempte veer.
 * De cursor duwt; de veer trekt terug en schiet een beetje door,
 * zodat de bloem natrilt in plaats van terug te springen.
 *
 * Uitkomst: uitwijking per bloem in meadow.pushAttribute → shader (Meadow.js).
 */
export class FlowerPhysics {
  constructor(meadow) {
    this.flowers = meadow.flowers;
    this.pushAttribute = meadow.pushAttribute;

    const count = this.flowers.length;
    this.offset = this.pushAttribute.array; // x/z per bloem, rechtstreeks in de GPU-buffer
    this.velocity = new Float32Array(count * 2);
    this.stiffness = new Float32Array(count);
    this.headHeight = new Float32Array(count);
    this.touchRadius = new Float32Array(count);

    this.flowers.forEach((flower, i) => {
      this.stiffness[i] = STIFFNESS * (1 + (Math.random() * 2 - 1) * STIFFNESS_VARIATION);
      this.headHeight[i] = meadow.stemHeight * flower.scale;
      this.touchRadius[i] = meadow.headRadius * flower.scale + TOUCH_MARGIN;
    });

    // Hulpvectoren, één keer aangemaakt (niet elke frame opnieuw)
    this.head = new THREE.Vector3();
    this.toHead = new THREE.Vector3();
    this.closest = new THREE.Vector3();
    this.previousClosest = new THREE.Vector3();
  }

  update(delta, pointer) {
    // Grote sprongen (tab was even weg) zouden de veer laten ontploffen
    const dt = Math.min(delta, 1 / 30);
    if (dt <= 0) return;

    for (let i = 0; i < this.flowers.length; i++) {
      const ix = i * 2;
      const iz = i * 2 + 1;
      let forceX = 0;
      let forceZ = 0;

      if (pointer.active) {
        const force = this.cursorForce(i, pointer, dt);
        forceX = force.x;
        forceZ = force.y;
      }

      // Veer: a = -k·x - c·v + F
      const k = this.stiffness[i];
      const accelX = -k * this.offset[ix] - DAMPING * this.velocity[ix] + forceX;
      const accelZ = -k * this.offset[iz] - DAMPING * this.velocity[iz] + forceZ;

      // Semi-impliciete Euler: eerst snelheid, dan positie (stabiel voor veren)
      this.velocity[ix] += accelX * dt;
      this.velocity[iz] += accelZ * dt;
      this.offset[ix] += this.velocity[ix] * dt;
      this.offset[iz] += this.velocity[iz] * dt;

      // Steel kan niet oneindig ver buigen
      const length = Math.hypot(this.offset[ix], this.offset[iz]);
      if (length > MAX_OFFSET) {
        this.offset[ix] *= MAX_OFFSET / length;
        this.offset[iz] *= MAX_OFFSET / length;
      }
    }

    this.pushAttribute.needsUpdate = true;
  }

  /** Kracht van de cursor op bloem i (x/z), of nul als de cursor de bol niet raakt */
  cursorForce(i, pointer, dt) {
    const result = { x: 0, y: 0 };
    const flower = this.flowers[i];

    // Huidige positie van de pluizenbol (rustpositie + uitwijking)
    this.head.set(
      flower.position.x + this.offset[i * 2],
      flower.position.y + this.headHeight[i],
      flower.position.z + this.offset[i * 2 + 1]
    );

    // Punt op de cursorstraal dat het dichtst bij de bol ligt
    const depth = this.toHead.subVectors(this.head, pointer.ray.origin).dot(pointer.ray.direction);
    if (depth <= 0) return result; // bol ligt achter de camera
    pointer.ray.at(depth, this.closest);

    const distance = this.head.distanceTo(this.closest);
    const radius = this.touchRadius[i];
    if (distance >= radius) return result;

    // 1 in het midden van de bol, 0 aan de rand: zachte overgang
    const strength = (1 - distance / radius) ** 2;

    // Meesleuren: hoe beweegt de cursor op deze diepte? (vorige straal, zelfde diepte)
    pointer.previousRay.at(depth, this.previousClosest);
    let speedX = (this.closest.x - this.previousClosest.x) / dt;
    let speedZ = (this.closest.z - this.previousClosest.z) / dt;
    const speed = Math.hypot(speedX, speedZ);
    if (speed > MAX_CURSOR_SPEED) {
      speedX *= MAX_CURSOR_SPEED / speed;
      speedZ *= MAX_CURSOR_SPEED / speed;
    }
    result.x += speedX * DRAG * strength;
    result.y += speedZ * DRAG * strength;

    // Wegduwen: van de cursor af, horizontaal
    const awayX = this.head.x - this.closest.x;
    const awayZ = this.head.z - this.closest.z;
    const awayLength = Math.hypot(awayX, awayZ);
    if (awayLength > 1e-4) {
      result.x += (awayX / awayLength) * PUSH * strength;
      result.y += (awayZ / awayLength) * PUSH * strength;
    }

    return result;
  }
}
