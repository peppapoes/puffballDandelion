import * as THREE from 'three/webgpu';
import { createRenderer } from './core/renderer.js';
import { PerfMonitor, benchmark } from './core/PerfMonitor.js';
import { fog, rangeFogFactor } from 'three/tsl';
import { createCamera, keepCameraAboveGround } from './core/camera.js';
import {
  uTimeOfDay, uSunDirection, uHorizonColor, initWorldStateInput, updateWorldState, setDaylightFromRoom, updateWind,
} from './state/worldState.js';
import { Sky } from './world/Sky.js';
import { createGround } from './world/Ground.js';
import { FlowerShadows } from './world/FlowerShadows.js';
import { Meadow } from './world/Meadow.js';
import { FlowerPhysics } from './world/FlowerPhysics.js';
import { Fireflies } from './world/Fireflies.js';
import { Pointer, attachMouse } from './interaction/Pointer.js';
import { CameraVision } from './interaction/CameraVision.js';
import { FlowerFocus } from './interaction/FlowerFocus.js';
import { FocusPostProcessing } from './core/postprocessing.js';
import { Microphone } from './interaction/Microphone.js';
import { WindRose } from './interaction/WindRose.js';
import { Seeds } from './world/Seeds.js';
import { AmbientMusic } from './audio/AmbientMusic.js';
import { Hints } from './interaction/Hints.js';

const DAY_SUN = new THREE.Color('#fff4e0');
const NIGHT_SUN = new THREE.Color('#9fb4ff');
const DAY_SKY = new THREE.Color('#cfe6f5');
const NIGHT_SKY = new THREE.Color('#7f95d8');

const FOG_NEAR = 12;
const FOG_FAR = 70;

const MOUSE_TOUCH_MARGIN = 0.3;
const HAND_TOUCH_MARGIN = 1.6;

const CAMERA_FRAME_SKIP = 2;

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
    this.meadow = await Meadow.create(this.renderer); // laadt het Blender-model (public/models/puffballSimple.glb)
    this.flowerShadows = new FlowerShadows(this.renderer, this.meadow);
    this.scene.add(createGround(this.renderer, this.flowerShadows));
    this.scene.add(this.meadow.group);

    this.flowerFocus = new FlowerFocus(this.camera, this.controls, canvas, this.meadow);
    this.focusPost = new FocusPostProcessing(this.renderer, this.scene, this.camera);

    this.mousePointer = new Pointer({ touchMargin: MOUSE_TOUCH_MARGIN });
    attachMouse(this.mousePointer, canvas);
    this.handPointer = new Pointer({ touchMargin: HAND_TOUCH_MARGIN });
    this.pointers = [this.mousePointer, this.handPointer];

    this.cameraVision = new CameraVision(this.renderer, this.handPointer, this.perf);

    this.flowerPhysics = new FlowerPhysics(this.meadow, this.renderer); // compute shader op de GPU

    this.fireflies = new Fireflies(this.renderer, this.flowerPhysics.pointerUniforms);
    this.scene.add(this.fireflies.mesh);

    this.microphone = new Microphone(this.perf);
    this.windRose = new WindRose(this.controls); // windrichting kiezen
    this.seeds = new Seeds(this.renderer, this.meadow, this.flowerPhysics.pointerUniforms);
    this.scene.add(this.seeds.group);

    this.music = new AmbientMusic();
    this.hints = new Hints({
      cameraVision: this.cameraVision, microphone: this.microphone, flowerFocus: this.flowerFocus, controls: this.controls,
    });
    this.updateNightClass(); // het startscherm meteen in de kleuren van dag of nacht

    initWorldStateInput();
    window.addEventListener('resize', () => this.onResize());
    this.renderer.setAnimationLoop((timestamp) => this.update(timestamp));
  }

  start() {
    this.music.start();
    this.cameraVision.show();
    this.microphone.show();
    this.windRose.show();
    this.hints.start();
  }

  createLights() {
    this.sun = new THREE.DirectionalLight('#fff4e0', 2.5);
    this.sun.position.set(15, 20, 10);
    this.hemi = new THREE.HemisphereLight('#cfe6f5', '#2a3a1e', 1);
    this.scene.add(this.sun, this.hemi);
  }

  updateLights() {
    const t = uTimeOfDay.value; // 0 = nacht, 1 = dag
    this.sun.intensity = THREE.MathUtils.lerp(0.8, 2.5, t);
    this.sun.color.lerpColors(NIGHT_SUN, DAY_SUN, t);
    this.hemi.intensity = THREE.MathUtils.lerp(1.2, 1.0, t);
    this.hemi.color.lerpColors(NIGHT_SKY, DAY_SKY, t);

    const dir = uSunDirection.value;
    this.sun.position.set(dir.x, Math.max(dir.y, 0.35), dir.z).normalize().multiplyScalar(40);
  }

  update(timestamp) {
    this.frameCount = (this.frameCount ?? 0) + 1;
    if (this.cameraVision.running && this.frameCount % CAMERA_FRAME_SKIP !== 0) return;

    this.timer.update(timestamp);
    const delta = this.timer.getDelta();

    const perf = this.perf;

    perf.begin('world');
    if (this.cameraVision.brightness !== null) setDaylightFromRoom(this.cameraVision.brightness, this.cameraVision.contrast);
    updateWorldState(delta);
    this.updateLights();
    this.music.update(); // dag- en nachtmuziek volgen uTimeOfDay, net als het licht
    this.updateNightClass();
    this.hints.update(delta);
    this.flowerFocus.update(delta); // camera: overgang afspelen, of gewoon de OrbitControls
    keepCameraAboveGround(this.camera, this.flowerFocus.minHeight);
    perf.end('world');

    perf.begin('camera');
    this.cameraVision.update(delta);
    perf.end('camera');

    perf.begin('physics');
    for (const pointer of this.pointers) pointer.update(this.camera);
    this.flowerPhysics.update(delta, this.pointers);
    this.meadow.update(delta, this.camera); // LOD: dichtste bollen krijgen echte pluisjes
    this.flowerShadows.update(); // na meadow.update: de bollen staan dan op hun plek van deze frame
    this.fireflies.update(delta, this.camera); // physics: opschrikken en terugdalen
    this.microphone.update(delta);
    updateWind(delta, this.microphone.level);
    this.windRose.update();
    const focused = this.flowerFocus.flight ? null : this.flowerFocus.focused;
    this.seeds.update(delta, this.camera, focused, this.microphone.level, this.pointers);
    perf.end('physics');

    perf.begin('render');
    this.renderFrame();
    perf.end('render');

    perf.frame(delta);
  }

  renderFrame(target = null) {
    this.sky.render(this.renderer, this.camera);
    this.renderer.setRenderTarget(target);

    const dof = this.flowerFocus.depthOfField;
    if (dof) {
      this.focusPost.set(dof.strength, dof.distance, dof.radius);
      this.focusPost.render();
    } else {
      this.renderer.render(this.scene, this.camera);
    }

    this.renderer.setRenderTarget(null);
  }

  updateNightClass() {
    const night = uTimeOfDay.value < 0.4;
    if (night === this.night) return;
    this.night = night;
    document.body.classList.toggle('night', night);
  }

  resizeSky() {
    const size = this.renderer.getDrawingBufferSize(new THREE.Vector2());
    this.sky.setSize(size.x, size.y);
  }

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
