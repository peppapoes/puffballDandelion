# Puffball Dandelion

Een interactieve sfeerinstallatie in de browser: een wei vol paardenbloemen in pluizenbolfase, waar de wind in golven overheen trekt. Stuur de wind, zoom in op één bloem en wrijf of blaas de pluisjes weg. De lucht gaat mee van dag naar nacht, en 's nachts wordt de wei een neon-veld vol lichtjes.

**Live:** https://delatterfemke.be/puffballDandelion/

## Bediening

| Actie | Effect |
| --- | --- |
| ↓ (tikken) | Een stap verder in de dag: zonsondergang, nacht, zonsopgang, dag, ... |
| ↑ (tikken) | Een stap terug in de tijd |
| ↓ / ↑ ingedrukt houden | De tijd loopt vloeiend door (een volle dag in ±10 seconden) |
| Slepen | Rondkijken (tijdelijk, tijdens de ontwikkeling) |

## Techniek

- [Three.js](https://threejs.org/) met `WebGPURenderer` (`three/webgpu`), valt automatisch terug op WebGL2
- Shaders in TSL (`three/tsl`)
- [Vite](https://vite.dev/) als build-tool

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
  core/                renderer en camera
  state/worldState.js  gedeelde wereldtoestand (uTimeOfDay, wind)
  world/               lucht, grond, wei, windveld, terreinhoogte
public/
  models/              Blender-exports (GLB)
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

**Aanpassingen in de port:** de kijkrichting volgt de Three.js-camera, de zonnestand volgt dag/nacht (pijltjes ↑/↓) in plaats van een automatische klok, de ruistextuur (iChannel0) wordt in code gemaakt, en de uitgeschakelde onderdelen (regen, simple sun, blur) zijn weggelaten.

### Muziek en geluid

| Titel | Maker | Bron | Licentie |
| --- | --- | --- | --- |
| _TODO_ | | | |

### Libraries

- [three.js](https://github.com/mrdoob/three.js) (MIT)
