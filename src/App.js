import * as THREE from 'three/webgpu';
import { createRenderer } from './core/renderer.js';
import { fog, rangeFogFactor } from 'three/tsl';
import { createCamera, keepCameraAboveGround } from './core/camera.js';
import {
  uTimeOfDay, uSunDirection, uHorizonColor, initWorldStateInput, updateWorldState,
} from './state/worldState.js';
import { createSkyNode } from './world/Sky.js';
import { createGround } from './world/Ground.js';
import { createMeadow } from './world/Meadow.js';
import { FlowerPhysics } from './world/FlowerPhysics.js';
import { Pointer } from './interaction/Pointer.js';

const DAY_SUN = new THREE.Color('#fff4e0');
const NIGHT_SUN = new THREE.Color('#9fb4ff');
const DAY_SKY = new THREE.Color('#cfe6f5');
const NIGHT_SKY = new THREE.Color('#7f95d8');

// Nevel: de wei vervaagt in de verte in de kleur van de horizon, zodat je nooit een rand ziet
const FOG_NEAR = 12;
const FOG_FAR = 70;

/**
 * Houdt de hele installatie samen: renderer, scène, camera en de render-loop.
 * Nieuwe systemen (audio, interactie, pluisjes, ...) worden hier aangemaakt
 * en krijgen elke frame update(delta).
 */
export class App {
  async init(canvas) {
    this.renderer = await createRenderer(canvas);
    this.scene = new THREE.Scene();
    ({ camera: this.camera, controls: this.controls } = createCamera(canvas));
    this.timer = new THREE.Timer();

    this.scene.backgroundNode = createSkyNode();
    this.scene.fogNode = fog(uHorizonColor, rangeFogFactor(FOG_NEAR, FOG_FAR));
    this.createLights();
    this.scene.add(createGround());
    this.meadow = createMeadow();
    this.scene.add(this.meadow.mesh);

    this.pointer = new Pointer(canvas);
    this.flowerPhysics = new FlowerPhysics(this.meadow);

    initWorldStateInput();
    window.addEventListener('resize', () => this.onResize());
    this.renderer.setAnimationLoop((timestamp) => this.update(timestamp));
  }

  /** Wordt opgeroepen na de klik op het startscherm (gebruikersgebaar: audio mag starten). */
  start() {
    // TODO: audio starten (ambient muziek + windgeruis)
  }

  createLights() {
    this.sun = new THREE.DirectionalLight('#fff4e0', 2.5);
    this.sun.position.set(15, 20, 10);
    this.hemi = new THREE.HemisphereLight('#cfe6f5', '#2a3a1e', 1);
    this.scene.add(this.sun, this.hemi);
  }

  updateLights() {
    const t = uTimeOfDay.value; // 0 = nacht, 1 = dag
    // 's Nachts wordt de zon zwak blauw maanlicht
    this.sun.intensity = THREE.MathUtils.lerp(0.8, 2.5, t);
    this.sun.color.lerpColors(NIGHT_SUN, DAY_SUN, t);
    this.hemi.intensity = THREE.MathUtils.lerp(1.2, 1.0, t);
    this.hemi.color.lerpColors(NIGHT_SKY, DAY_SKY, t);

    // Zonlicht uit dezelfde richting als de zon in de lucht (Sky.js);
    // onder de horizon blijft het van boven komen, als maanlicht
    const dir = uSunDirection.value;
    this.sun.position.set(dir.x, Math.max(dir.y, 0.35), dir.z).normalize().multiplyScalar(40);
  }

  update(timestamp) {
    this.timer.update(timestamp);
    const delta = this.timer.getDelta();

    updateWorldState(delta);
    this.updateLights();
    this.controls.update();
    keepCameraAboveGround(this.camera);

    // Na de camera: cursorstraal bijwerken, dan de bloemen laten reageren
    this.pointer.update(this.camera);
    this.flowerPhysics.update(delta, this.pointer);

    this.renderer.render(this.scene, this.camera);
  }

  onResize() {
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(window.innerWidth, window.innerHeight);
  }
}
