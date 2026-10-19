# Puffball Meadow

## Opstarten

**Nodig:**
- [Node.js](https://nodejs.org/) versie 20.19 of nieuwer (of 22.12+), met npm
- Een browser met WebGPU
- Optioneel: een webcam (handen, kamerlicht) en een microfoon (blazen)

**Packages** (`npm install`):
- `three`: Three.js met de WebGPU-renderer en TSL
- `tsl-textures`: procedurele texturen (de grond)
- `@mediapipe/tasks-vision`: handtracking
- `vite`: ontwikkelserver en build

**Stappen** (in de terminal):

```bash
npm install      # packages installeren (eenmalig)
npm run dev      # ontwikkelserver starten
```

Live versie te vinden op https://delatterfemke.be/puffballDandelion/


## 1. Concept & werking

Een rustige wei vol paardenbloemen in pluizenbolfase, in de browser. Je kijkt rond, de wind trekt in golven over de bloemen, en de wereld gaat mee van dag naar nacht. Het idee: met kleine, natuurlijke gebaren (je hand, je adem, het licht in je kamer) een stukje natuur beïnvloeden.

**Wat je kan doen:**
- **Rondkijken:** slepen om te draaien, scrollen om te zoomen.
- **Door de wei bewegen** met je muis of je hand (webcam): de bloemen buigen weg en veren terug. Zwaai je snel door de bollen, dan vliegen er een paar pluisjes weg.
- **De wind sturen:** met de windroos kies je de richting; blazen in je microfoon maakt de wind harder.
- **Inzoomen op één bloem:** klik op de bloem, de rest van de wei wordt wazig. Wrijf over de bol of blaas, en de pluisjes komen los, openen hun parachuutje en dwarrelen weg. De bol wordt kaal en blijft kaal.
- **Dag en nacht:** met ↑ ↓, of automatisch volgens het licht in je kamer (webcam). 's Nachts zweven er vuurvliegjes.
- **Muziek** die mee overvloeit van dag naar nacht.

Na het starten verschijnen kleine tips om te dien, één voor één, met een knop om het meteen te proberen.

## 2. Opdracht-eisen

| Eis | Voldaan | Hoe |
| --- | --- | --- |
| Shadertoy-shader porten naar WebGPU | ✅ | [Circadian](https://www.shadertoy.com/view/stdBWN) (Kiri) is de lucht, geport naar TSL met `WebGPURenderer` (`src/world/Sky.js`) |
| De shader reageert op interactie | ✅ | De zonnestand volgt de pijltjes en het kamerlicht; de kijkrichting volgt de camera |
| Werkende URL | ✅ | GitHub Pages; elke push naar `main` wordt automatisch gebouwd en gepubliceerd |
| Broncode zonder `node_modules` | ✅ | `node_modules/` en `dist/` staan in `.gitignore` |
| README met de shader-URL | ✅ | `README.md` bevat de URL's van beide Shadertoy-shaders (zie ook Bronnen hieronder) |

## 3. Extra's

| Extra | Voldaan | Kort |
| --- | --- | --- |
| Interactie, meer dan rondkijken | ✅ | Muis, handtracking (webcam), blazen (microfoon), windroos, klikken om in te zoomen, pijltjes, kamerlicht |
| Physics | ✅ | Drie compute shaders op de GPU: verende stelen, vliegende pluisjes (wind, luchtweerstand), opschrikkende vuurvliegjes |
| Meerdere shaders | ✅ | Tweede Shadertoy-port: [Fireflies at Dusk](https://www.shadertoy.com/view/wcKczt) (OneHung). Eigen TSL: wind, buigen, impostors, scherptediepte, schaduwen, lichtmeter |
| Extra WebGPU-library | ✅ | tsl-textures (procedurele grond); daarnaast MediaPipe voor de handtracking |
| Eigen Blender-model + baking | ✅ | Steel, bol en pluisje in Blender; ambient occlusion gebakken. De grond wordt bij het opstarten in code gebakken |
| Animaties uit Blender vanuit de code | ✅ | Drie shape keys, live gestuurd: **Buigen** (steel, door wind en physics), **Open** (parachuutje tijdens de vlucht), **Kaal** (bol, naargelang hoeveel pluisjes weg zijn) |
| Audio (geprobeerd, deels) | 🟡 | Muziek die van dag naar nacht overvloeit; windgeruis bewust weggelaten |

## 4. Handleiding: waar vind je wat?

```
index.html            startscherm, knoppen, tips
src/
  main.js             startpunt: maakt de app, startknop, zwevende pluisjes
  App.js              verbindt alles en draait de render-loop (elke frame)
  style.css           de UI (kleuren volgen dag en nacht)
  core/               technische basis
    renderer.js         WebGPU-renderer (resolutie, anti-aliasing)
    camera.js           camera en cameragrenzen
    postprocessing.js   wazige achtergrond bij inzoomen
    PerfMonitor.js      prestatiepaneel (?debug achter de URL)
  state/
    worldState.js       gedeelde toestand: tijd van de dag, zon, wind, lichtmeter
  world/              alles wat je ziet
    Sky.js              lucht (Shadertoy Circadian)
    Ground.js           grond (tsl-textures, gebakken)
    terrain.js          hoogte van de glooiende wei
    Meadow.js           de bloemen: stelen, bollen, pluisjes, verre bollen (LOD)
    models.js           laadt het Blender-model en zijn shape keys
    wind.js             windveld (golven over de wei)
    FlowerPhysics.js    veer-physics van de stelen (compute shader)
    FlowerShadows.js    schaduwen op de grond (compute shader)
    Seeds.js            pluisjes loskrijgen en laten vliegen (compute shaders)
    Fireflies.js        vuurvliegjes (Shadertoy Fireflies at Dusk)
  interaction/        alles wat je doet
    Pointer.js          muis en hand als straal in de wei
    CameraVision.js     webcam: handtracking en lichtmeter
    handWorker.js       handherkenning (MediaPipe) in een aparte thread
    FlowerFocus.js      klikken om in te zoomen, Escape om terug te gaan
    Microphone.js       blazen herkennen
    WindRose.js         windroos
    Hints.js            tips na het starten
  audio/
    AmbientMusic.js     dag- en nachtmuziek
    audioContext.js     gedeelde audio voor muziek en microfoon
public/
  models/             Blender-export (puffballSimple.glb)
  audio/              muziek (day.mp3, night.mp3)
blender/              Blender-werkbestand en gebakken AO-texturen
shaders/original/     de originele GLSL van beide Shadertoy-shaders
```

## 5. Bronnen

Deze bronnen moeten vermeld worden volgens hun licentie.

**Shaders**
- Circadian door Kiri: https://www.shadertoy.com/view/stdBWN (de lucht). Bouwt voort op shaders van StillTravelling, László Matuska, David Hoskins, dmytro rubalskyi en nimitz.
- Fireflies at Dusk door OneHung (CC0): https://www.shadertoy.com/view/wcKczt (de vuurvliegjes)
- De originele GLSL van beide staat in `shaders/original/`.

**Muziek** (Pixabay Content License)
- Dag: "Calm Ambient Dreamscape" door morgan-ambient: https://pixabay.com/music/ambient-calm-ambient-dreamscape-529861/
- Nacht: "Ambient - Ambient Music" door leberch: https://pixabay.com/music/ambient-ambient-music-604092/

**Lettertype en icoontjes**
- Quicksand via Google Fonts (SIL Open Font License)
- Knop-icoontjes naar Lucide (ISC-licentie)
