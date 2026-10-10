import * as THREE from 'three/webgpu';
import { pass, uniform, uv, length, smoothstep, mix, float, vec4 } from 'three/tsl';
import { gaussianBlur } from 'three/addons/tsl/display/GaussianBlurNode.js';

const FOCAL_LENGTH = 3; // × straal van de pluizenbol: zo ver van het scherpstelvlak is alles volledig wazig
const BLUR_SIGMA = 6; // hoe wazig (breedte van de gaussian blur)
const BLUR_RESOLUTION = 0.5; // blur op halve resolutie: 4× minder pixels, en wazig mag grof zijn
const VIGNETTE = 0.35; // hoeveel donkerder de randen worden (0 = niets)

/**
 * Scherptediepte bij het inzoomen op één bloem (FlowerFocus), zoals een fototoestel:
 * alleen wat op dezelfde afstand staat als de gekozen bol is scherp, de bloemen ervoor
 * en de wei erachter worden wazig. Plus een zacht vignet (donkere randen).
 *
 * RenderPipeline: de scène wordt eerst naar een textuur gerenderd (pass), met kleur én
 * diepte (viewZ). Daarna:
 * 1. één wazige versie van het hele beeld (gaussian blur, halve resolutie)
 * 2. per pixel mengen tussen scherp en wazig, volgens hoe ver die pixel van het
 *    scherpstelvlak ligt (circle of confusion, "CoC")
 * Bewust zelf gebouwd: het dof-effect van Three.js (DepthOfFieldNode) gaf mooiere bokeh,
 * maar kostte gemeten ±13 ms per frame, deze versie veel minder.
 * Alleen gebruikt als je ingezoomd bent (App.renderFrame).
 */
export class FocusPostProcessing {
  constructor(renderer, scene, camera) {
    this.uFocusDistance = uniform(5); // afstand camera → gekozen bol, langs de kijkrichting (m)
    this.uFocalLength = uniform(FOCAL_LENGTH);
    this.uStrength = uniform(0); // 0 = geen effect, 1 = volledig (glijdt mee met het inzoomen)

    const scenePass = pass(scene, camera);
    const sharp = scenePass.getTextureNode();
    const blurred = gaussianBlur(sharp, this.uStrength, BLUR_SIGMA, { resolutionScale: BLUR_RESOLUTION });

    // CoC: 0 op het scherpstelvlak, 1 vanaf FOCAL_LENGTH ervoor of erachter.
    // viewZ is negatief vóór de camera, dus -viewZ = afstand langs de kijkrichting.
    const distance = scenePass.getViewZNode().negate();
    const coc = smoothstep(0, this.uFocalLength, distance.sub(this.uFocusDistance).abs()).mul(this.uStrength);
    const color = mix(sharp.rgb, blurred.rgb, coc);

    // Vignet: 1 in het midden, naar de hoeken toe donkerder
    const edge = smoothstep(0.35, 0.85, length(uv().sub(0.5)).mul(1.4));
    const vignette = mix(float(1), float(1 - VIGNETTE), edge.mul(this.uStrength));

    this.pipeline = new THREE.RenderPipeline(renderer);
    this.pipeline.outputNode = vec4(color.mul(vignette), 1);
  }

  /**
   * Instellen voor deze frame.
   * strength: 0..1 (FlowerFocus.hold), focusDistance: tot de bol (m), radius: straal van de bol (m)
   */
  set(strength, focusDistance, radius) {
    this.uStrength.value = strength;
    this.uFocusDistance.value = focusDistance;
    this.uFocalLength.value = FOCAL_LENGTH * radius;
  }

  render() {
    this.pipeline.render();
  }
}
