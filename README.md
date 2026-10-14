# Puffball Dandelion

Een interactieve sfeerinstallatie in de browser: een wei vol paardenbloemen in pluizenbolfase, waar de wind in golven overheen trekt. Stuur de wind met een windroos en je adem, zoom in op één bloem en wrijf of blaas de pluisjes weg. De lucht gaat mee van dag naar nacht, en 's nachts zweven er vuurvliegjes boven de wei.

**Live:** https://delatterfemke.be/puffballDandelion/

## Bediening

| Actie | Effect |
| --- | --- |
| ↓ (tikken) | Een stap verder in de dag: zonsondergang, nacht, zonsopgang, dag, ... |
| ↑ (tikken) | Een stap terug in de tijd |
| ↓ / ↑ ingedrukt houden | De tijd loopt vloeiend door (een volle dag in ±10 seconden) |
| Muis door de bloemen bewegen | De pluizenbollen worden meegeduwd en veren na |
| Knop **Hands** (camera, rechtsonder) | Hou je hand voor de webcam en wrijf door de wei: je raakt een veel groter stuk aan dan met de muis. Het licht in je kamer stuurt dag en nacht: doe het licht uit of bedek de camera en het wordt nacht (een pijltje neemt 20 s voorrang). Geen camera? De muis en de pijltjes blijven werken. |
| Windroos (linksonder) slepen | De wind komt uit die hoek; de roos draait mee met de camera zoals een kompas |
| Knop **Blow** (microfoon) en blazen | Hoe harder je blaast, hoe harder de wind over de hele wei (de roos toont de windkracht) |
| Slepen / scrollen | Rond de wei draaien en zoomen (begrensd) |
| Klik op een bloem | De camera zoomt vloeiend in op die pluizenbol; de bloem beweegt nog maar zachtjes, de rest van de wei waait door. Ingezoomd: slepen = rond de bloem draaien, scrollen = dichterbij of verder |
| Escape of klik naast de bloem | Vloeiend terug naar je plek in de wei |
| Ingezoomd: wrijf met muis of hand over de bol | Hoe sneller je wrijft, hoe meer pluisjes loskomen; ze openen hun parachuutje en dwarrelen traag weg met de wind. De bol wordt kaler en blijft kaal, ook als je uitzoomt |
| Knop **Blow**, ingezoomd blazen | Hoe harder je blaast, hoe meer pluisjes wegvliegen, eerst aan jouw kant van de bol. Het balkje onder de knop toont hoe hard de microfoon je hoort blazen; praten telt niet |
| Knop **Music** | De muziek start na de klik op het startscherm en vloeit mee van dag- naar nachtmuziek; de knop zet ze met een korte fade aan of uit |
| Tips onderaan | Na het starten verschijnt één voor één een tip (muis door de wei, handen, blazen, inzoomen, dag en nacht), met een knop om het meteen te proberen. Wat je al gedaan hebt, wordt overgeslagen |
| `?debug` achter de URL | Prestatiepaneel; in de console meet `await app.benchmark()` de echte kost per frame |

## Techniek

- [Three.js](https://threejs.org/) met `WebGPURenderer` (`three/webgpu`), valt automatisch terug op WebGL2
- Resolutie hoogstens 1,5 pixels per CSS-pixel (`src/core/renderer.js`): op een retina-scherm scheelt dat ±16 ms per frame, met MSAA zie je het verschil nauwelijks
- Shaders in TSL (`three/tsl`)
- [Vite](https://vite.dev/) als build-tool
- Extra WebGPU-library [tsl-textures](https://boytchev.github.io/tsl-textures/): procedurele texturen in TSL. De grond van de wei gebruikt `camouflage` in twee lagen (plekken van ±10 m en plukjes van ±1 m) met weidetinten, berekend uit ruis, zonder afbeeldingen. Bij het opstarten één keer gebakken in een textuur (2048²): live per pixel kostte dat de helft van elke frame (`src/world/Ground.js`)
- Webcam als sensor (`src/interaction/CameraVision.js`):
  - handtracking met [MediaPipe Hand Landmarker](https://ai.google.dev/edge/mediapipe/solutions/vision/hand_landmarker) in een Web Worker (`handWorker.js`), zodat de wei vlot blijft; tussen twee detecties voorspelt de app waar de hand nu is (uit haar snelheid), zodat de cirkel vlot meebeweegt; herkent alleen handen, geen hoofd of andere beweging
  - lichtmeter op de GPU met **compute shaders in TSL**: helderheid én contrast van het camerabeeld (64×48 vakjes) sturen dag en nacht. Het contrast is nodig omdat een webcam een donker beeld zelf weer oplicht (automatische belichting): een bedekte camera of donkere kamer wordt dan grijs, maar blijft vlak
- De lucht rekent het dure deel (atmosfeer, wolken) op 1/16 van de pixels in een render target; sterren en horizon op volle resolutie
- Wind (`src/world/wind.js`): ruis die in de windrichting over de wei schuift, zodat vlagen als golven over het veld trekken. Richting via de windroos (`src/interaction/WindRose.js`), kracht via blazen in de microfoon (`updateWind` in `src/state/worldState.js`)
- Veer-physics van de stelen als compute shader op de GPU (`src/world/FlowerPhysics.js`)
- Schaduwen van de bloemen op de grond, berekend in plaats van met een shadow map (die zou de hele wei een tweede keer tekenen): een compute shader maakt elke frame een schaduwkaart van de wei van bovenaf (512×512). Per vakje gaat hij na of de straal naar de zon een bol of steel in de buurt raakt (alleen de 3×3 vakjes van het plaatsingsrooster). Ze bewegen mee met wind en physics; 's nachts en bij een lage zon zwakker (`src/world/FlowerShadows.js`)
- Pluisjes wegwrijven of wegblazen (`src/world/Seeds.js`): twee compute shaders. De eerste geeft elk pluisje van de gekozen bloem een kans om los te komen (wrijfsnelheid van muis/hand, blaaskracht van de microfoon via de Web Audio API in `src/interaction/Microphone.js`: alleen luid én ruisachtig geluid telt als blazen, gemeten met de spectrale vlakheid van het spectrum (FFT), zodat praten of muziek de pluisjes niet wegblaast). De tweede is de physics van de vliegende pluisjes: meedrijven met dezelfde wind als de wei, traag dalen met luchtweerstand (parachute), fladderen, op de grond blijven liggen. Een los pluisje draait rechtop en zijn parachuutje gaat open (shape key "Open"). Tot 64 kale bloemen worden onthouden (welke pluisjes los zijn); van ver wordt de foto van een kale bol doorzichtiger
- Muziek die meegaat met dag en nacht (`src/audio/AmbientMusic.js`, Web Audio API): een dag- en een nachtnummer spelen allebei in een lus, elk via een eigen volumeknop (`GainNode`). Die volumes volgen `uTimeOfDay`, dezelfde waarde als de lucht, met een equal-power crossfade (dag = sin, nacht = cos van t·90°), zodat de schemering niet zachter klinkt. De muziek start pas na de klik op het startscherm, omdat browsers geen geluid toelaten zonder klik. Muziek en microfoon delen één `AudioContext` (`src/audio/audioContext.js`), en het volume glijdt met `setTargetAtTime` naar de nieuwe mix (niet elke frame hard zetten: dat geeft kleine sprongetjes, die je hoort als kraken). Bestanden op 128 kbps (samen ±5,6 MB) en gestreamd
- Zachte UI in "matglas" (`index.html`, `src/style.css`): half doorzichtige vlakken met een wazige achtergrond (`backdrop-filter`), het ronde lettertype Quicksand en alle kleuren als CSS-variabelen. Overdag crème en perzik, 's nachts lavendel en blauw: `App.js` zet de klasse `night` op de pagina volgens `uTimeOfDay`. Het startscherm heeft zwevende pluisjes (SVG met CSS-animatie, `src/main.js`); de tekst op de site is Engels
- Tips na het starten (`src/interaction/Hints.js`): één voor één een kaartje met een knop om het meteen te proberen; de bijhorende knop rechtsonder pulseert. Tips die je al uitgevoerd hebt, worden overgeslagen
- Inzoomen op één bloem met scherptediepte (post-processing met `RenderPipeline`, `src/core/postprocessing.js`): de scène gaat met kleur en diepte naar een textuur, daarna wordt per pixel gemengd tussen scherp en een wazige versie (gaussian blur op halve resolutie), volgens de afstand tot de gekozen bol; plus een zacht vignet. Alleen actief als je ingezoomd bent
- Tweede Shadertoy-shader: 300 vuurvliegjes als billboards (één draw call) met het knipperritme en de gloed van "Fireflies at Dusk" (`src/world/Fireflies.js`)
- Physics voor de vuurvliegjes als tweede compute shader: passeer je er een met de muis of de hand, dan vliegt het zacht omhoog en een beetje opzij, en daalt het langzaam terug (kritisch gedempte veer, dus zonder te stuiteren)
- Eigen Blender-model (`blender/puffballSimple.blend` → `public/models/puffballSimple.glb`): steel, bol (receptacle) en pluisje.
  - **Baking:** Ambient Occlusion gebakken in Blender (Cycles) voor de steel en de bol (`blender/textures/`), als occlusionTexture in de GLB en in de app als `aoMap`. Alleen AO, geen volledige lichtbake, want het licht verandert van dag naar nacht.
  - **Shape key "Buigen" vanuit de code aangestuurd:** in Blender buigt de steel in een boog naar +X. De app leest die vorm in (`src/world/models.js`) en de vertex-shader draait hem per bloem naar de richting waarin wind en veer-physics duwen; de physics bepaalt ook hoe ver (0 = recht, 1 = volledig gebogen zoals in Blender) (`src/world/Meadow.js`).
  - **Shape keys "Open" en "Kaal" vanuit de code aangestuurd:** "Open" op het pluisje gaat van 0 naar 1 in de eerste 0,8 s van de vlucht (het parachuutje gaat open, `src/world/Seeds.js`); "Kaal" op de bol volgt hoeveel pluisjes weg zijn (`src/world/Meadow.js`). Alle shape keys worden eigen attributen (`takeShapeKey` in `src/world/models.js`), zodat elke bloem en elk pluisje een eigen waarde heeft
  - De pluisjes worden in code met de gulden hoek (Fibonacci-spiraal) over de bol verdeeld en met instancing getekend; LOD: echte pluisjes op de dichtste bollen, in de verte een billboard met een gebakken foto van een echte pluizenbol (impostor)

## Lokaal draaien

```bash
npm install
npm run dev
```

Bouwen: `npm run build` (output in `dist/`). Elke push naar `main` wordt via GitHub Actions automatisch op GitHub Pages gezet.

## Projectstructuur

Hoe alles samenwerkt (lagen, gedeelde toestand, één frame, data van invoer tot beeld): zie [architectuur.md](architectuur.md).

```
src/
  main.js              startpunt + startscherm
  App.js               renderer, scène, camera, render-loop
  core/                renderer, camera, scherptediepte (post-processing) en prestatiemeter
  state/worldState.js  gedeelde wereldtoestand (uTimeOfDay, zon, horizon, wind, lichtmeter)
  world/               lucht, grond, schaduwen, wei (Blender-model + LOD), windveld, terreinhoogte, veer-physics, pluisjes, vuurvliegjes
  audio/AmbientMusic.js  muziek: dag ↔ nacht overvloeien
  interaction/         aanwijzers (muis, hand), inzoomen op een bloem, microfoon, windroos, tips en de webcam (hand + licht)
blender/               Blender-werkbestanden (.blend), niet online
public/
  models/              Blender-exports (GLB): puffballSimple.glb
  audio/               muziek: day.mp3, night.mp3
```

## Bronnen en credits

### Shadertoy-shaders

| Shader | Maker | URL | Gebruik |
| --- | --- | --- | --- |
| Circadian | Kiri | https://www.shadertoy.com/view/stdBWN | Lucht: dag, schemering, nacht (geport naar TSL in `src/world/Sky.js`) |
| Fireflies at Dusk (CC0 1.0) | OneHung | https://www.shadertoy.com/view/wcKczt | Vuurvliegjes boven de wei bij schemering en 's nachts (geport naar TSL in `src/world/Fireflies.js`) |

**Circadian** is een fork van, en bouwt voort op:

- The sun, the sky and the clouds by StillTravelling: https://www.shadertoy.com/view/tdSXzD
- Day and night sky cycle by László Matuska (@BitOfGold): https://www.shadertoy.com/view/ltlSWB
- Weather by David Hoskins: https://www.shadertoy.com/view/4dsXWn
- Edge of atmosphere by dmytro rubalskyi (ruba): https://www.shadertoy.com/view/XlXGzB
- Auroras by nimitz: https://www.shadertoy.com/view/XtGGRt

De originele GLSL staat ter referentie in `shaders/original/circadian.glsl`.

**Aanpassingen in de port:** de kijkrichting volgt de Three.js-camera, de zonnestand volgt dag/nacht (pijltjes ↑/↓) in plaats van een automatische klok, de ruistextuur (iChannel0) wordt in code gemaakt, de uitgeschakelde onderdelen (regen, simple sun, blur) zijn weggelaten, en onder de horizon toont de lucht een waas in de kleur van de nevel in plaats van een waterspiegeling, zodat de wei er naadloos in overloopt.

**Fireflies at Dusk** (CC0 1.0) is zelf geïnspireerd door de Night Field-sfeer van diatribes en de gloed-technieken van Blackle. De originele GLSL staat in `shaders/original/fireflies.glsl`.

**Aanpassingen in de port:** alleen de vuurvliegjes zijn overgenomen (`hash`, `fireflyBlink` met de dubbele flits, de zweefbeweging in een achtvorm, de kern + gloed en de geelgroene kleur). De lucht, bomen en het gras van het origineel zijn weggelaten, want die heeft de wei al. In plaats van 35 punten op een plat scherm zijn het 300 vuurvliegjes in 3D: elk is een billboard, en de gloed wordt per pixel berekend met de formules van het origineel. De zweefbeweging kreeg een derde as (diepte). Ze verschijnen alleen bij schemering en 's nachts, en schrikken op van muis en hand: ze vliegen zacht omhoog en dalen daarna weer.

### Muziek

Beide via [Pixabay](https://pixabay.com/music/), onder de [Pixabay Content License](https://pixabay.com/service/license-summary/) (gratis te gebruiken, vermelding niet verplicht). Verkleind naar 128 kbps.

| Gebruik | Titel | Maker | Bron |
| --- | --- | --- | --- |
| Dag (`public/audio/day.mp3`) | Calm Ambient Dreamscape (volgens Pixabay met AI gemaakt) | morgan-ambient | https://pixabay.com/music/ambient-calm-ambient-dreamscape-529861/ |
| Nacht (`public/audio/night.mp3`) | Ambient - Ambient Music | leberch | https://pixabay.com/music/ambient-ambient-music-604092/ |

### Lettertype en icoontjes

- [Quicksand](https://fonts.google.com/specimen/Quicksand) via Google Fonts (SIL Open Font License)
- Icoontjes van de knoppen (camera, microfoon, muziek) naar [Lucide](https://lucide.dev/) (ISC-licentie), als inline SVG

### Libraries

- [three.js](https://github.com/mrdoob/three.js) (MIT)
- [tsl-textures](https://github.com/boytchev/tsl-textures) 3.0.5 door Pavel Boytchev (MIT)
- [@mediapipe/tasks-vision](https://www.npmjs.com/package/@mediapipe/tasks-vision) 1.1.0 (Apache 2.0); WebAssembly via https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.1.0/wasm, handmodel `hand_landmarker.task` via https://storage.googleapis.com/mediapipe-models/