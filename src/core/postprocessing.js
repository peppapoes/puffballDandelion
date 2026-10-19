import * as THREE from 'three/webgpu';
import { pass, uniform, uv, length, smoothstep, mix, float, vec4 } from 'three/tsl';
import { gaussianBlur } from 'three/addons/tsl/display/GaussianBlurNode.js';

const FOCAL_LENGTH = 3; // × straal van de pluizenbol: zo ver van het scherpstelvlak is alles volledig wazig
const BLUR_SIGMA = 6; // hoe wazig (breedte van de gaussian blur)
const BLUR_RESOLUTION = 0.5; // blur op halve resolutie: 4× minder pixels, en wazig mag grof zijn
const VIGNETTE = 0.35; // hoeveel donkerder de randen worden (0 = niets)

export class FocusPostProcessing {
  constructor(renderer, scene, camera) {
    this.uFocusDistance = uniform(5); // afstand camera → gekozen bol, langs de kijkrichting (m)
    this.uFocalLength = uniform(FOCAL_LENGTH);
    this.uStrength = uniform(0); // 0 = geen effect, 1 = volledig (glijdt mee met het inzoomen)

    const scenePass = pass(scene, camera);
    const sharp = scenePass.getTextureNode();
    const blurred = gaussianBlur(sharp, this.uStrength, BLUR_SIGMA, { resolutionScale: BLUR_RESOLUTION });

    const distance = scenePass.getViewZNode().negate();
    const coc = smoothstep(0, this.uFocalLength, distance.sub(this.uFocusDistance).abs()).mul(this.uStrength);
    const color = mix(sharp.rgb, blurred.rgb, coc);

    const edge = smoothstep(0.35, 0.85, length(uv().sub(0.5)).mul(1.4));
    const vignette = mix(float(1), float(1 - VIGNETTE), edge.mul(this.uStrength));

    this.pipeline = new THREE.RenderPipeline(renderer);
    this.pipeline.outputNode = vec4(color.mul(vignette), 1);
  }

  set(strength, focusDistance, radius) {
    this.uStrength.value = strength;
    this.uFocusDistance.value = focusDistance;
    this.uFocalLength.value = FOCAL_LENGTH * radius;
  }

  render() {
    this.pipeline.render();
  }
}
