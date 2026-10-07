import { Fn, color, mix, smoothstep, positionWorldDirection, max } from 'three/tsl';
import { uTimeOfDay } from '../state/worldState.js';

/**
 * PLACEHOLDER-lucht: verloop van horizon naar zenit, dag → schemering → nacht.
 * Wordt vervangen door de geporte Shadertoy-shader "Circadian" (GLSL → TSL).
 */
export function createSkyNode() {
  return Fn(() => {
    const dir = positionWorldDirection; // kijkrichting van de camera
    const height = max(dir.y, 0); // 0 = horizon, 1 = recht omhoog

    const dayHorizon = color('#b7d8f0');
    const dayZenith = color('#3a78c9');
    const duskHorizon = color('#f2a46b');
    const duskZenith = color('#5a4a8a');
    const nightHorizon = color('#141a33');
    const nightZenith = color('#03040b');

    const horizonToZenith = smoothstep(0.0, 0.35, height);
    const day = mix(dayHorizon, dayZenith, horizonToZenith);
    const dusk = mix(duskHorizon, duskZenith, horizonToZenith);
    const night = mix(nightHorizon, nightZenith, horizonToZenith);

    // timeOfDay 0 → 0.5 → 1 = nacht → schemering → dag
    const nightToDusk = mix(night, dusk, smoothstep(0.0, 0.5, uTimeOfDay));
    return mix(nightToDusk, day, smoothstep(0.5, 1.0, uTimeOfDay));
  })();
}
