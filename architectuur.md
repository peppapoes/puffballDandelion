# Architectuur van Puffball Dandelion

Hoe de app in elkaar zit: welke bestanden er zijn, waar de gedeelde toestand staat, wat er elke frame gebeurt en hoe de data loopt van een invoer (muis, hand, adem, kamerlicht) tot wat je op het scherm ziet.

## 1. De lagen

```
index.html            startscherm, knoppen, tips (HTML) + style.css
  └─ src/main.js      maakt de App, zwevende pluisjes op het startscherm, startknop
       └─ src/App.js  maakt alle onderdelen aan en draait de render-loop (update elke frame)
            ├─ core/         technische basis: renderer, camera, post-processing, prestatiemeter
            ├─ state/        gedeelde toestand: worldState.js (tijd van de dag, zon, wind, lichtmeter)
            ├─ world/        alles wat je ZIET: lucht, grond, wei, schaduwen, pluisjes, vuurvliegjes
            ├─ interaction/  alles wat je DOET: muis, hand, klikken, microfoon, windroos, tips
            └─ audio/        muziek + de gedeelde AudioContext
```

**Regel:** onderdelen praten niet rechtstreeks met elkaar. `App.js` maakt ze aan en geeft door wat ze nodig hebben (bv. de muis-aanwijzer aan de physics). Gedeelde toestand staat op één plek: `worldState.js`.

## 2. Wat je ziet → welk bestand

| Op het scherm | Bestand | Hoe |
| --- | --- | --- |
| Lucht (dag, schemering, nacht, sterren, noorderlicht) | `world/Sky.js` | Shadertoy "Circadian" in TSL; het dure deel op 1/16 van de pixels in een render target |
| Grond | `world/Ground.js` | Camouflage (tsl-textures) één keer gebakken in een textuur; nachtkleur en schaduwen live |
| Schaduwen op de grond | `world/FlowerShadows.js` | Compute shader: schaduwkaart van 512×512 vakjes, om de 2 frames |
| Stelen | `world/Meadow.js` (`createStems`) | InstancedMesh; vertex-shader buigt met shape key "Buigen" |
| Verre pluizenbollen | `world/Meadow.js` (`createFarPuffs`) | Billboards met een gebakken foto van een echte bol (impostor) |
| Dichte pluizenbollen | `world/Meadow.js` (`createNearHeads`) | 160 dichtste bollen: echte bol + 90 pluisjes elk (LOD) |
| Het Blender-model | `world/models.js` | Laadt de GLB, haalt de shape keys eruit als eigen attributen |
| Vliegende pluisjes | `world/Seeds.js` | Twee compute shaders: loskomen en vliegen |
| Vuurvliegjes | `world/Fireflies.js` | Shadertoy "Fireflies at Dusk" + compute shader (opschrikken) |
| Wazige achtergrond bij inzoomen | `core/postprocessing.js` | Render-pipeline: scherp en wazig mengen volgens de diepte |
| Startscherm, knoppen, tips | `index.html`, `style.css`, `main.js`, `interaction/Hints.js` | HTML/CSS; kleuren volgen dag en nacht via de klasse `.night` |
| Windroos | `interaction/WindRose.js` | SVG; draait mee met de camera |
| Cirkel rond je hand | `interaction/CameraVision.js` | HTML-element, verplaatst met een veer |
| Prestatiepaneel (`?debug`) | `core/PerfMonitor.js` | Tijd per onderdeel, detecties per seconde |

## 3. Gedeelde toestand: `state/worldState.js`

De "store" van de app. Alles wat meerdere onderdelen moeten weten, staat hier één keer.

| Waarde | Wie schrijft | Wie leest |
| --- | --- | --- |
| `uTimeOfDay` (0 = nacht, 1 = dag) | `updateWorldState` (pijltjes, kamerlicht) | lucht, licht (`App.js`), grond, pluisjes, vuurvliegjes, schaduwen, muziek, UI-kleuren |
| `uSunDirection`, `uSunHeight`, `uHorizonColor` | `updateWorldState` (volgt uit de tijd) | lucht, zonlicht, nevel, schaduwen |
| `uWindStrength`, `uWindDirection`, `uWindOffset` | `updateWind` (windroos + blazen) | `world/wind.js` → stelen en vliegende pluisjes |
| lichtmeter | `setDaylightFromRoom` (webcam) | `updateWorldState` |

De `u…`-waarden zijn **uniforms**: dezelfde waarde gaat rechtstreeks naar de GPU-shaders. JavaScript leest of schrijft `.value`, de shaders lezen ze elke frame.

## 4. Eén frame (`App.update`)

De volgorde is belangrijk: elke stap gebruikt wat de vorige net berekend heeft.

| # | Stap | Waarom op deze plek |
| --- | --- | --- |
| 0 | Camera aan? Elke 2de frame overslaan | Geeft de grafische kaart tijd voor de handherkenning |
| 1 | Lichtmeter → `setDaylightFromRoom`, dan `updateWorldState` | Eerst de tijd van de dag vastleggen: bijna alles hangt ervan af |
| 2 | `updateLights`, `music.update`, `updateNightClass` | Licht, muziek en UI-kleuren volgen de nieuwe tijd |
| 3 | `hints.update` | Volgende tip tonen of de huidige laten verdwijnen |
| 4 | `flowerFocus.update`, `keepCameraAboveGround` | Camera eerst op haar plek zetten … |
| 5 | `cameraVision.update` | … zodat de hand juist op het scherm komt; lichtmeting (GPU) |
| 6 | `pointer.update` (muis + hand) | Stralen vanuit de camera die nu klaarstaat |
| 7 | `flowerPhysics.update` | Compute: stelen duwen met de stralen, veer en demping |
| 8 | `meadow.update` | Plek van de bollen (compute) + LOD: welke 160 bollen krijgen echte pluisjes |
| 9 | `flowerShadows.update` | Na stap 8: de bollen staan dan op hun plek van deze frame |
| 10 | `fireflies.update` | Compute: opschrikken van muis en hand |
| 11 | `microphone.update` → `updateWind` → `windRose.update` | Blazen wordt windkracht; de roos toont het |
| 12 | `seeds.update` | Ingezoomd: pluisjes loskrijgen (wrijven, blazen) en laten vliegen |
| 13 | `renderFrame` | Eerst de lucht (render target), dan de scène, ingezoomd via de scherptediepte |

## 5. Van invoer tot beeld: vier voorbeelden

**Muis door de wei → steel buigt**
1. `Pointer.js`: muisbeweging → plek op het scherm (NDC) → straal vanuit de camera, plus de straal van de vorige frame (voor de snelheid).
2. `App.js` geeft de stralen aan `FlowerPhysics.update`, die ze als uniforms naar de GPU stuurt.
3. Compute shader in `FlowerPhysics.js`: per bloem de duw van de straal + veer + demping → `meadow.offsetBuffer`.
4. Vertex-shader van de stelen (`Meadow.bendOf`): wind (`windAt`) + `offsetBuffer` → hoeveel en welke kant → shape key "Buigen" gedraaid naar die kant.
5. De bollen en pluisjes staan op de top van die gebogen steel (`headPosition`), dus ze bewegen mee.

De uitwijking komt nooit terug naar JavaScript: ze blijft op de GPU, van compute shader naar vertex-shader.

**Blazen → wind en wegvliegende pluisjes**
1. `Microphone.js`: volume (RMS) × ruisachtigheid (spectrale vlakheid met bas-correctie) → `level` (0..1).
2. `updateWind` (`worldState.js`): `level` → `uWindStrength`; de golven schuiven sneller (`uWindOffset`).
3. `wind.js` (`windAt`) leest die uniforms → stelen buigen harder (zie hierboven).
4. Ingezoomd: `Seeds.update` krijgt ook `level` → compute shader geeft elk pluisje een kans om los te komen → tweede compute shader laat het vliegen met dezelfde `windAt`.

**Kamerlicht → dag of nacht**
1. `CameraVision.js`: webcambeeld als textuur → compute shaders meten helderheid en contrast.
2. `App.js` → `setDaylightFromRoom` → doel voor de dagcyclus (behalve als de pijltjes net gebruikt zijn).
3. `updateWorldState` laat `uTimeOfDay` vloeiend naar dat doel glijden.
4. Iedereen die `uTimeOfDay` leest, volgt: lucht, licht, grond, pluisjes, vuurvliegjes, muziek, UI-kleuren.

**Hand voor de webcam → cirkel en aanwijzer**
1. `CameraVision.js`: camerabeeld verkleind → `handWorker.js` (aparte thread) → MediaPipe zoekt de hand.
2. Terug: midden van de handpalm → snelheid → voorspelling waar de hand nu is.
3. Een kritisch gedempte veer (exacte formule) laat de cirkel daarnaartoe glijden; dezelfde plek stuurt `handPointer`.
4. Vanaf daar zoals de muis: straal → physics → gebogen stelen (met een groter aanraakgebied).

## 6. CPU of GPU?

| Op de CPU (JavaScript) | Op de GPU (shaders, buffers) |
| --- | --- |
| Invoer lezen: muis, toetsen, microfoon, hand-worker | Physics van stelen, pluisjes en vuurvliegjes (compute) |
| `worldState`: tijd, zon, wind berekenen | Schaduwkaart, lichtmeter (compute) |
| LOD: de 160 dichtste bollen kiezen (om de 0,1 s) | Alles tekenen: buigen, draaien, kleuren (vertex en fragment) |
| Klik → welke bloem (`FlowerFocus.pick`) | Toestand van de pluisjes (`seedState`: vast of los) |

Zo weinig mogelijk heen en weer: JavaScript stuurt kleine waarden (uniforms) naar de GPU; de grote hoeveelheden data (duizenden bloemen, tienduizenden pluisjes) blijven op de GPU.

## 7. Opstarten

1. `main.js` roept `app.init()` aan zodra de pagina laadt: renderer, lucht, Blender-model (`Meadow.create`), impostor- en grond-bake, alle onderdelen. Het startscherm staat ondertussen al.
2. Klik op "Step into the meadow" → `app.start()`: muziek start (browsers laten pas geluid toe na een klik), de knoppen en de windroos verschijnen, de tips beginnen.
3. Vanaf dan draait `App.update` elke frame (`setAnimationLoop`).
