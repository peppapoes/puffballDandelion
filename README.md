# Puffball Dandelion

Een interactieve sfeerinstallatie in de browser: een wei vol paardenbloemen in pluizenbolfase, waar de wind in golven overheen trekt. Stuur de wind, zoom in op één bloem en wrijf of blaas de pluisjes weg. De lucht gaat mee van dag naar nacht, en 's nachts wordt de wei een neon-veld vol lichtjes.

**Live:** https://delatterfemke.be/puffballDandelion/

## Bediening

| Actie | Effect |
| --- | --- |
| ↑ / ↓ | Richting dag / richting nacht |
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
| Circadian | _TODO_ | _TODO_ | Lucht: dag, schemering, nacht (geport naar TSL) |
| Fireflies at Dusk (CC0) | _TODO_ | _TODO_ | Knipperpatroon en gloed van de pluisjes 's nachts |
| Non-accurate atmosphere (reserve) | _TODO_ | _TODO_ | Reserve voor de lucht |

### Muziek en geluid

| Titel | Maker | Bron | Licentie |
| --- | --- | --- | --- |
| _TODO_ | | | |

### Libraries

- [three.js](https://github.com/mrdoob/three.js) (MIT)
