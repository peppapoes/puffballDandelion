# Puffball Dandelion

Een interactieve sfeerinstallatie in de browser: een wei vol paardenbloemen in pluizenbolfase, waar de wind in golven overheen trekt. Stuur de wind, zoom in op één bloem en wrijf of blaas de pluisjes weg. De lucht gaat mee van dag naar nacht, en 's nachts wordt de wei een neon-veld vol lichtjes.

**Live:** https://delatterfemke.be/puffballDandelion/

## Bediening

| Actie | Effect |
| --- | --- |
| ↓ (tikken) | Een stap verder in de dag: zonsondergang, nacht, zonsopgang, dag, ... |
| ↑ (tikken) | Een stap terug in de tijd |
| ↓ / ↑ ingedrukt houden | De tijd loopt vloeiend door (een volle dag in ±10 seconden) |
| Muis door de bloemen bewegen | De pluizenbollen worden meegeduwd en veren na |
| 📷 Camera aan (knop rechtsonder) | Hou je hand voor de webcam en wrijf door de wei: je raakt een veel groter stuk aan dan met de muis. Het licht in je kamer stuurt dag en nacht (een pijltje neemt 20 s voorrang). Geen camera? De muis en de pijltjes blijven werken. |
| Slepen / scrollen | Rond de wei draaien en zoomen (begrensd) |
| `?debug` achter de URL | Prestatiepaneel; in de console meet `await app.benchmark()` de echte kost per frame |

## Techniek

- [Three.js](https://threejs.org/) met `WebGPURenderer` (`three/webgpu`), valt automatisch terug op WebGL2
- Shaders in TSL (`three/tsl`)
- [Vite](https://vite.dev/) als build-tool
- Webcam als sensor (`src/interaction/CameraVision.js`):
  - handtracking met [MediaPipe Hand Landmarker](https://ai.google.dev/edge/mediapipe/solutions/vision/hand_landmarker) in een Web Worker (`handWorker.js`), zodat de wei vlot blijft; herkent alleen handen, geen hoofd of andere beweging
  - lichtmeter op de GPU met **compute shaders in TSL**: de gemiddelde helderheid van het camerabeeld stuurt dag en nacht
- De lucht rekent het dure deel (atmosfeer, wolken) op 1/16 van de pixels in een render target; sterren en horizon op volle resolutie
- Veer-physics van de stelen als compute shader op de GPU (`src/world/FlowerPhysics.js`)
- Eigen Blender-model (`blender/puffballSimple.blend` → `public/models/puffballSimple.glb`): steel, bol (receptacle) en pluisje. De pluisjes worden in code met de gulden hoek (Fibonacci-spiraal) over de bol verdeeld en met instancing getekend; LOD: echte pluisjes op de dichtste bollen, in de verte een billboard met een gebakken foto van een echte pluizenbol (impostor)

## Lokaal draaien

```bash
npm install
npm run dev
```

Bouwen: `npm run build` (output in `dist/`). Elke push naar `main` wordt via GitHub Actions automatisch op GitHub Pages gezet.

## Projectstructuur

```
src/
  main.js              startpunt + startscherm
  App.js               renderer, scène, camera, render-loop
  core/                renderer, camera en prestatiemeter
  state/worldState.js  gedeelde wereldtoestand (uTimeOfDay, zon, horizon, wind, lichtmeter)
  world/               lucht, grond, wei (Blender-model + LOD), windveld, terreinhoogte, veer-physics
  interaction/         aanwijzers (muis, hand) en de webcam op de GPU (beweging + licht)
blender/               Blender-werkbestanden (.blend), niet online
public/
  models/              Blender-exports (GLB): puffballSimple.glb
  audio/               muziek en windgeruis
```

## Bronnen en credits

### Shadertoy-shaders

| Shader | Maker | URL | Gebruik |
| --- | --- | --- | --- |
| Circadian | Kiri | https://www.shadertoy.com/view/stdBWN | Lucht: dag, schemering, nacht (geport naar TSL in `src/world/Sky.js`) |
| Fireflies at Dusk (CC0) | _TODO_ | _TODO_ | Knipperpatroon en gloed van de pluisjes 's nachts |

**Circadian** is een fork van, en bouwt voort op:

- The sun, the sky and the clouds by StillTravelling: https://www.shadertoy.com/view/tdSXzD
- Day and night sky cycle by László Matuska (@BitOfGold): https://www.shadertoy.com/view/ltlSWB
- Weather by David Hoskins: https://www.shadertoy.com/view/4dsXWn
- Edge of atmosphere by dmytro rubalskyi (ruba): https://www.shadertoy.com/view/XlXGzB
- Auroras by nimitz: https://www.shadertoy.com/view/XtGGRt

De originele GLSL staat ter referentie in `shaders/original/circadian.glsl`.

**Aanpassingen in de port:** de kijkrichting volgt de Three.js-camera, de zonnestand volgt dag/nacht (pijltjes ↑/↓) in plaats van een automatische klok, de ruistextuur (iChannel0) wordt in code gemaakt, de uitgeschakelde onderdelen (regen, simple sun, blur) zijn weggelaten, en onder de horizon toont de lucht een waas in de kleur van de nevel in plaats van een waterspiegeling, zodat de wei er naadloos in overloopt.

### Muziek en geluid

| Titel | Maker | Bron | Licentie |
| --- | --- | --- | --- |
| _TODO_ | | | |

### Libraries

- [three.js](https://github.com/mrdoob/three.js) (MIT)
- [@mediapipe/tasks-vision](https://www.npmjs.com/package/@mediapipe/tasks-vision) 1.1.0 (Apache 2.0); WebAssembly via https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.1.0/wasm, handmodel `hand_landmarker.task` via https://storage.googleapis.com/mediapipe-models/