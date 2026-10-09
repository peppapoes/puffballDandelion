import * as THREE from 'three/webgpu';
import {
  Fn, If, float, vec2, vec3, uniform, instancedArray, instanceIndex, dot, length, pow,
} from 'three/tsl';

// Veer: hoe stijf de steel is en hoe snel hij uitdeint
const STIFFNESS = 30; // terugtrekkende kracht (hoger = sneller en strakker terug)
const STIFFNESS_VARIATION = 0.25; // ±25% per bloem, zodat ze niet in hetzelfde ritme wiegen
const DAMPING = 2.5; // afremming (laag = lang natrillen, hoog = meteen stil)
const MAX_OFFSET = 1.6; // maximale uitwijking van de top (wereld-units)

// Aanwijzers (muis, hand). Hoe groot hun aanraakgebied is, staat op de Pointer zelf.
const DRAG = 8; // meesleuren in de bewegingsrichting van de cursor
const PUSH = 12; // zacht wegduwen van de cursor, ook als die stilstaat
const MAX_CURSOR_SPEED = 30; // te snelle rukken afvlakken (wereld-units per seconde)
const MAX_POINTERS = 2; // muis + hand

/**
 * Veer-physics voor de stelen, als compute shader op de GPU: elke bloem is een
 * gedempte veer, en alle bloemen worden tegelijk berekend (één thread per bloem).
 * Muis en hand duwen; de veer trekt terug en schiet een beetje door,
 * zodat de bloem natrilt in plaats van terug te springen.
 *
 * Uitkomst: uitwijking per bloem in meadow.offsetBuffer, die de vertex-shader
 * van de bloemen rechtstreeks leest (Meadow.js). JavaScript stuurt alleen de
 * stralen van de aanwijzers door.
 */
export class FlowerPhysics {
  constructor(meadow, renderer) {
    this.renderer = renderer;
    this.offsetBuffer = meadow.offsetBuffer;
    const count = meadow.flowers.length;

    // Vaste gegevens per bloem, één keer naar de GPU:
    // flowerData = midden van de bol in rust (x, y, z); flowerParams = bolgrootte + stijfheid
    const data = new Float32Array(count * 4);
    const params = new Float32Array(count * 4);
    meadow.flowers.forEach((flower, i) => {
      const head = flower.position.clone().add(flower.headOffset);
      data.set([head.x, head.y, head.z, 0], i * 4);
      params[i * 4] = meadow.headRadius * flower.scale;
      params[i * 4 + 1] = STIFFNESS * (1 + (Math.random() * 2 - 1) * STIFFNESS_VARIATION);
    });
    this.flowerData = instancedArray(data, 'vec4');
    this.flowerParams = instancedArray(params, 'vec4');
    this.velocityBuffer = instancedArray(count, 'vec2');

    // Per frame vanuit JavaScript: tijdstap en de stralen van de aanwijzers (nu + vorige frame)
    this.uDelta = uniform(0);
    this.pointerUniforms = Array.from({ length: MAX_POINTERS }, () => ({
      active: uniform(0),
      margin: uniform(0),
      origin: uniform(new THREE.Vector3()),
      direction: uniform(new THREE.Vector3(0, 0, -1)),
      previousOrigin: uniform(new THREE.Vector3()),
      previousDirection: uniform(new THREE.Vector3(0, 0, -1)),
    }));

    this.computeNode = this.createCompute().compute(count);
  }

  createCompute() {
    const { flowerData, flowerParams, offsetBuffer, velocityBuffer, uDelta } = this;

    return Fn(() => {
      const i = instanceIndex;
      const data = flowerData.element(i);
      const params = flowerParams.element(i);
      const offset = offsetBuffer.element(i);
      const velocity = velocityBuffer.element(i);

      // Huidige positie van de pluizenbol (rustpositie + uitwijking)
      const head = data.xyz.add(vec3(offset.x, 0, offset.y)).toVar();
      const force = vec2(0).toVar();

      // Kracht van elke aanwijzer (JavaScript-lus: wordt uitgeschreven in de shader)
      for (const pointer of this.pointerUniforms) {
        If(pointer.active.greaterThan(0.5), () => {
          // Punt op de straal dat het dichtst bij de bol ligt
          const depth = dot(head.sub(pointer.origin), pointer.direction).toVar();
          const closest = pointer.origin.add(pointer.direction.mul(depth)).toVar();
          const distance = length(head.sub(closest));
          const radius = params.x.add(pointer.margin);

          If(depth.greaterThan(0).and(distance.lessThan(radius)), () => {
            // 1 in het midden van de bol, 0 aan de rand: zachte overgang
            const strength = pow(float(1).sub(distance.div(radius)), 2).toVar();

            // Meesleuren: hoe beweegt de aanwijzer op deze diepte? (vorige straal, zelfde diepte)
            const previousClosest = pointer.previousOrigin.add(pointer.previousDirection.mul(depth));
            const speed = closest.xz.sub(previousClosest.xz).div(uDelta).toVar();
            const speedLength = length(speed);
            If(speedLength.greaterThan(MAX_CURSOR_SPEED), () => {
              speed.mulAssign(float(MAX_CURSOR_SPEED).div(speedLength));
            });
            force.addAssign(speed.mul(DRAG).mul(strength));

            // Wegduwen: van de aanwijzer af, horizontaal
            const away = head.xz.sub(closest.xz).toVar();
            const awayLength = length(away);
            If(awayLength.greaterThan(1e-4), () => {
              force.addAssign(away.div(awayLength).mul(PUSH).mul(strength));
            });
          });
        });
      }

      // Veer: a = -k·x - c·v + F
      const acceleration = offset.mul(params.y).negate().sub(velocity.mul(DAMPING)).add(force);

      // Semi-impliciete Euler: eerst snelheid, dan positie (stabiel voor veren)
      velocity.addAssign(acceleration.mul(uDelta));
      const newOffset = offset.add(velocity.mul(uDelta)).toVar();

      // Steel kan niet oneindig ver buigen
      const offsetLength = length(newOffset);
      If(offsetLength.greaterThan(MAX_OFFSET), () => {
        newOffset.mulAssign(float(MAX_OFFSET).div(offsetLength));
      });
      offset.assign(newOffset);
    })();
  }

  /** Elke frame: aanwijzers doorgeven en de compute shader draaien */
  update(delta, pointers) {
    // Grote sprongen (tab was even weg) zouden de veer laten ontploffen
    const dt = Math.min(delta, 1 / 30);
    if (dt <= 0) return;
    this.uDelta.value = dt;

    this.pointerUniforms.forEach((u, i) => {
      const pointer = pointers[i];
      u.active.value = pointer?.active ? 1 : 0;
      if (!pointer?.active) return;
      u.margin.value = pointer.touchMargin;
      u.origin.value.copy(pointer.ray.origin);
      u.direction.value.copy(pointer.ray.direction);
      u.previousOrigin.value.copy(pointer.previousRay.origin);
      u.previousDirection.value.copy(pointer.previousRay.direction);
    });

    this.renderer.compute(this.computeNode);
  }

  /** Uitwijkingen teruglezen (alleen om te testen/debuggen: await app.flowerPhysics.readOffsets()) */
  async readOffsets() {
    return new Float32Array(await this.renderer.getArrayBufferAsync(this.offsetBuffer.value));
  }
}
