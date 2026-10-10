import * as THREE from 'three/webgpu';
import { createRenderer } from './core/renderer.js';
import { PerfMonitor, benchmark } from './core/PerfMonitor.js';
import { fog, rangeFogFactor } from 'three/tsl';
import { createCamera, keepCameraAboveGround } from './core/camera.js';
import {
  uTimeOfDay, uSunDirection, uHorizonColor, initWorldStateInput, updateWorldState, setDaylightFromRoom,
} from './state/worldState.js';
import { Sky } from './world/Sky.js';
import { createGround } from './world/Ground.js';
import { Meadow } from './world/Meadow.js';
import { FlowerPhysics } from './world/FlowerPhysics.js';
import { Fireflies } from './world/Fireflies.js';
import { Pointer, attachMouse } from './interaction/Pointer.js';
import { CameraVision } from './interaction/CameraVision.js';
import { FlowerFocus } from './interaction/FlowerFocus.js';
import { FocusPostProcessing } from './core/postprocessing.js';

const DAY_SUN = new THREE.Color('#fff4e0');
const NIGHT_SUN = new THREE.Color('#9fb4ff');
const DAY_SKY = new THREE.Color('#cfe6f5');
const NIGHT_SKY = new THREE.Color('#7f95d8');

// Nevel: de wei vervaagt in de verte in de kleur van de horizon, zodat je nooit een rand ziet
const FOG_NEAR = 12;
const FOG_FAR = 70;

// Aanraakgebied rond een pluizenbol (m): de hand raakt een veel groter stuk van de wei
const MOUSE_TOUCH_MARGIN = 0.3;
const HAND_TOUCH_MARGIN = 1.6;

/**
 * Houdt de hele installatie samen: renderer, scène, camera en de render-loop.
 * Nieuwe systemen (audio, interactie, pluisjes, ...) worden hier aangemaakt
 * en krijgen elke frame update(delta).
 */
export class App {
  async init(canvas) {
    this.renderer = await createRenderer(canvas);
    this.perf = new PerfMonitor(this.renderer); // ?debug in de URL
    this.scene = new THREE.Scene();
    ({ camera: this.camera, controls: this.controls } = createCamera(canvas));
    this.timer = new THREE.Timer();

    this.sky = new Sky();
    this.scene.backgroundNode = this.sky.backgroundNode;
    this.resizeSky();
    this.scene.fogNode = fog(uHorizonColor, rangeFogFactor(FOG_NEAR, FOG_FAR));
    this.createLights();
    this.scene.add(createGround());
    this.meadow = await Meadow.create(this.renderer); // laadt het Blender-model (public/models/puffballSimple.glb)
    this.scene.add(this.meadow.group);

    // Klik op een bloem: vloeiend inzoomen; Escape of klik ernaast: terug naar de wei
    this.flowerFocus = new FlowerFocus(this.camera, this.controls, canvas, this.meadow);
    // Ingezoomd: scherptediepte (de rest van de wei wazig) + vignet
    this.focusPost = new FocusPostProcessing(this.renderer, this.scene, this.camera);

    // Aanwijzers: muis (klein) en hand via de webcam (groot)
    this.mousePointer = new Pointer({ touchMargin: MOUSE_TOUCH_MARGIN });
    attachMouse(this.mousePointer, canvas);
    this.handPointer = new Pointer({ touchMargin: HAND_TOUCH_MARGIN });
    this.pointers = [this.mousePointer, this.handPointer];

    // Webcam als sensor op de GPU: beweging (hand) en licht van de kamer (dag/nacht)
    this.cameraVision = new CameraVision(this.renderer, this.handPointer, this.perf);

    this.flowerPhysics = new FlowerPhysics(this.meadow, this.renderer); // compute shader op de GPU

    // Tweede Shadertoy-shader: vuurvliegjes bij schemering, schrikken van dezelfde aanwijzers
    this.fireflies = new Fireflies(this.renderer, this.flowerPhysics.pointerUniforms);
    this.scene.add(this.fireflies.mesh);

    initWorldStateInput();
    window.addEventListener('resize', () => this.onResize());
    this.renderer.setAnimationLoop((timestamp) => this.update(timestamp));
  }

  /** Wordt opgeroepen na de klik op het startscherm (gebruikersgebaar: audio mag starten). */
  start() {
    // TODO: audio starten (ambient muziek + windgeruis)
    this.cameraVision.show();
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

    const perf = this.perf;

    perf.begin('world');
    // Lichtmeter van de webcam stuurt dag/nacht (tenzij je net de pijltjes gebruikte)
    if (this.cameraVision.brightness !== null) setDaylightFromRoom(this.cameraVision.brightness);
    updateWorldState(delta);
    this.updateLights();
    this.flowerFocus.update(delta); // camera: overgang afspelen, of gewoon de OrbitControls
    keepCameraAboveGround(this.camera, this.flowerFocus.minHeight);
    perf.end('world');

    // Na de camera: webcam verwerken (GPU) en hand volgen, stralen bijwerken, bloemen laten reageren
    perf.begin('camera');
    this.cameraVision.update(delta);
    perf.end('camera');

    perf.begin('physics');
    for (const pointer of this.pointers) pointer.update(this.camera);
    this.flowerPhysics.update(delta, this.pointers);
    this.meadow.update(delta, this.camera); // LOD: dichtste bollen krijgen echte pluisjes
    this.fireflies.update(delta, this.camera); // physics: opschrikken en terugdalen
    perf.end('physics');

    perf.begin('render');
    this.renderFrame();
    perf.end('render');

    perf.frame(delta);
  }

  /**
   * Eerst de dure lucht op lage resolutie, dan de scène (met die lucht als achtergrond).
   * target = null: naar het scherm; een render target: onzichtbaar (voor de benchmark)
   */
  renderFrame(target = null) {
    this.sky.render(this.renderer, this.camera);
    this.renderer.setRenderTarget(target);

    // Ingezoomd op een bloem: via de render-pipeline met scherptediepte; in de wei rechtstreeks (goedkoper)
    const dof = this.flowerFocus.depthOfField;
    if (dof) {
      this.focusPost.set(dof.strength, dof.distance, dof.radius);
      this.focusPost.render();
    } else {
      this.renderer.render(this.scene, this.camera);
    }

    this.renderer.setRenderTarget(null);
  }

  resizeSky() {
    const size = this.renderer.getDrawingBufferSize(new THREE.Vector2());
    this.sky.setSize(size.x, size.y);
  }

  /** Echte kost per frame meten (console: await app.benchmark()) */
  benchmark(frames) {
    return benchmark(this, frames);
  }

  onResize() {
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.resizeSky();
  }
}
