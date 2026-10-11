# Puffball Dandelion

### Wat is het?

Een interactieve sfeerinstallatie in de browser: een wei vol paardenbloemen in pluizenbolfase, waar de wind in golven overheen trekt. Je kan de wind zelf aansturen, op één bloem inzoomen en die aanraken, wrijven of wegblazen. Alles reageert zo realistisch mogelijk: stelen deinen na, pluisjes dwarrelen traag weg.

Geen game, maar een volledige sfeerzetting: een lucht die meegaat van dag naar nacht, ambient muziek en windgeruis, en een wei die 's nachts verandert in een neon-veld vol lichtjes.

### Wat het tot een geheel maakt

De installatie heeft twee niveaus die op elkaar inwerken:

- **De wei (overzicht):** tientallen bloemen die samen windpatronen tonen. Hier voel je de sfeer.
- **Eén bloem (detail):** klik op een bloem en je zoomt in. Hier raak je de bloem aan en zie je elk pluisje.

Wat je in het detail doet, zie je terug in het overzicht: weggeblazen pluisjes waaien over de wei en een kale bol blijft kaal staan tussen de andere bloemen. Dag en nacht, muziek en wind verbinden beide niveaus tot één wereld.

---

### Opdracht en requirements

| Eis uit de opdracht | Invulling in Wensbloem |
| --- | --- |
| Fragment shader van Shadertoy | Circadian als lucht op de achtergrond (dag, schemering, nacht). Reserve: Non-accurate atmosphere. |
| Geport naar WebGPU | Van GLSL naar TSL via de Three.js Transpiler, daarna handmatig opkuisen |
| Three.js met WebGPURenderer | `three/webgpu` en `three/tsl`; valt automatisch terug op WebGL2 |
| Shader reageert op interactie | `uTimeOfDay` via de pijltjes en de dark-mode-instelling; windsterkte kleurt de wolken en de schemering mee |
| Werkende URL | Deploy via GitHub Pages of Vercel, vanaf de eerste week |
| Broncode apart ingediend | GitHub-repository, zonder `node_modules` |
| README.md met originele shader-URL | README in de root met links en makers van alle gebruikte Shadertoy-shaders, plus bronvermelding van de muziek |

---

### Features

#### 1. De wei en de wind

- Tientallen paardenbloemen op een glooiende wei
- Windvlagen trekken als golven over het veld: de bloemen buigen na elkaar mee, niet allemaal tegelijk
- Beweeg je muis over de wei en de bloemen buigen weg en veren terug
- Draai aan een windroos om de wind uit een bepaald punt te laten komen
- Blaas in de microfoon: hoe harder je blaast, hoe harder de wind (ingezoomd op één bloem vliegen dan ook de pluisjes weg)

#### 2. Inzoomen op één bloem

- Klik op een bloem: de camera zoomt vloeiend in
- Escape of een klik naast de bloem brengt je terug naar de wei
- De rest van de wei blijft op de achtergrond bewegen

#### 3. De bloem voelt

- Hover met de muis of beweeg je hand voor de webcam: de steel buigt weg en de pluisjes in de buurt wiegen mee
- Realistisch: de steel deint na als een veer in plaats van terug te springen
- 's Nachts lichten de pluisjes in de buurt van je cursor of hand feller op

#### 4. Pluisjes wegwrijven of wegblazen

- Wrijf over de bol: hoe sneller, hoe meer pluisjes loskomen
- Of blaas in de microfoon: hoe harder, hoe meer pluisjes
- Losse pluisjes openen hun parachuutje en dwarrelen traag weg over de wei
- De bol wordt zichtbaar kaler; na een tijdje groeien er nieuwe pluisjes aan

#### 5. Dag & nacht

- Bij het openen volgt de wei de systeeminstelling: light mode = dag, dark mode = nacht
- Pijltje omhoog = richting dag, pijltje omlaag = richting nacht, met een vloeiende overgang
- Overdag: pluisjes zacht wit in het zonlicht, de gele bloemen in de wei staan open
- 's Nachts: neon-randen, pluisjes die knipperen als vuurvliegjes, gele bloemen gesloten

#### 6. Ambient geluid

- Rustige ambient muziek, met een dag- en een nachtsfeer die in elkaar overvloeien
- Windgeruis dat luider wordt bij elke windvlaag
- Startscherm met "Klik om te beginnen", omdat browsers pas geluid toelaten na een klik

---

### Inhoud in één oogopslag

| Onderdeel | Aantal | Wat exact |
| --- | --- | --- |
| Geporte Shadertoy-shaders | 2 | **Lucht:** Circadian, achtergrond die van dag naar nacht gaat. **Vuurvliegjes:** Fireflies at Dusk(CC0), knipperpatroon en gloed hergebruikt voor de pluisjes 's nachts. |
| Eigen shaders (TSL) | 3 | **Windveld:** golvende wind over de wei, gedeeld door gras en bloemen. **Pluisjes-materiaal:** dag wit en doorschijnend, nacht neon. **Hover-gloed:** pluisjes lichten op bij cursor of hand. |
| Extra WebGPU-libraries | 2 | three-particles: GPU-simulatie van de losse pluisjes via compute shaders, met je eigen Blender-pluisje als mesh. tsl-textures: procedurele texturen voor grond en blaadjes. |
| Extra library (niet WebGPU) | 1 | MediaPipe Hand Landmarker: handtracking via de webcam |
| Physics | 2 | **Veer-physics** voor de stelen (natrillen en uitdeinen). **Pluisjes-vlucht** met zwaartekracht, luchtweerstand, wind en turbulentie. |
| Eigen Blender-modellen | 5 | Pluisje, steel, pluizenbol, bladrozet, gele bloem. Losse onderdelen die de code combineert en honderden keren hergebruikt. |
| Morph targets (shape keys) | 4 | **Steel buigen:** gestuurd door wind en hover. **Gele bloem open/dicht:** gestuurd door dag en nacht. **Bol kaal:** gestuurd door hoeveel pluisjes weg zijn. **Parachuutje open:** gestuurd door de vlucht. |
| Baking | 2 | Ambient occlusion en detailtextuur gebakken op de bloemonderdelen; dag- en nacht-lightmap voor de grond van de wei. |
| Procedureel in code | 2 | Pluisjes op de bol geplaatst volgens de gulden hoek (Fibonacci-spiraal, zoals de pitten van een zonnebloem); bloemen verspreid over de wei. |
| Interactie | 7 | Muis over de wei, klikken om in te zoomen, hover, wrijven, handtracking, blazen, pijltjes; daarnaast de dark-mode-instelling |
| Audio | 2 | Ambient muziek (dag en nacht) en windgeruis, rechtenvrij met bronvermelding |

### Techniek per feature

| Feature | Shader | Library / techniek | Blender |
| --- | --- | --- | --- |
| De wei en de wind | Windveld (eigen TSL) | Noise uit `three/tsl` als bewegend windveld; muispositie op de wei via raycasting voegt een lokale vlaag toe | Steel buigen (morph target) |
| Inzoomen | — | Raycasting om de bloem te kiezen; vloeiende camera-overgang | — |
| De bloem voelt je | Hover-gloed (eigen TSL) | Veer-physics op de buig-waarde; MediaPipe voor de hand | Steel buigen (morph target) |
| Wegwrijven of wegblazen | Pluisjes-materiaal | three-particles (GPU compute); snelheid van cursor of hand, of microfoonvolume via de Web Audio API, als kracht | Pluisje als mesh; bol kaal en parachuutje open (morph targets) |
| Dag & nacht | Circadian, Fireflies at Dusk | `uTimeOfDay` via pijltjes; startwaarde uit `prefers-color-scheme`; bloom-postprocessing voor de neon-gloed | Gele bloem open/dicht (morph target); dag- en nacht-lightmap |
| Ambient geluid | — | Web Audio API: crossfade tussen dag- en nachtmuziek, windgeruis volgt de windsterkte | — |
| Pluizenbol opbouwen | — | Gulden-hoekverdeling in code, instancing van het pluisje | Pluisje, pluizenbol |
| Grond en blaadjes | — | tsl-textures | Bladrozet |
| Basis | — | Vite, `three/webgpu`, GLTFLoader, GitHub + GitHub Pages of Vercel | Export als GLB met morph targets |

---

### Waarom dit meer is dan het minimum

- Eén samenhangende wereld: de dag/nacht-stand stuurt tegelijk de lucht, de lightmaps, de pluisjes, de bloemen en de muziek
- Twee niveaus die op elkaar inwerken: wat je in het detail doet, zie je terug in de wei
- Realisme als ontwerpkeuze: veer-physics, trage luchtweerstand en morph targets in plaats van harde animaties
- Blender waar het zinvol is: geen groot decor, maar onderdelen met morph targets die live door de bezoeker worden aangestuurd; de wiskundige verdeling gebeurt in code
- Elk risicovol onderdeel heeft een terugvaloptie: geen webcam = muis, geen microfoon = wrijven of muis over de wei, geen WebGPU = automatisch WebGL2

---

## Stand van zaken (11 oktober 2026)

✅ klaar · 🟡 deels klaar · ❌ nog niet begonnen · ➖ bewust weggelaten

Bij ✅ staat hoe het werkt, bij 🟡 en ❌ wat er nog moet gebeuren.

### 1. De wei en de wind

| Onderdeel | Status | Hoe het werkt / wat er nog moet |
| --- | --- | --- |
| Bloemen op een glooiende wei | ✅ | ±4000 bloemen met `InstancedMesh` (één draw call per onderdeel), verspreid met een "jittered grid": een rooster met per vakje één bloem op een willekeurige plek, naar de rand toe ijler. De grond golft volgens `heightAt` (`terrain.js`). Code: `src/world/Meadow.js`. |
| Grond | ✅ | Procedurele graskleur uit tsl-textures (`camouflage`) in twee lagen: plekken van ±10 m en plukjes van ±1 m, 's nachts blauwgroen. Code: `src/world/Ground.js`. |
| Windvlagen als golven | ✅ | `windAt` (`src/world/wind.js`) is ruis (noise) die in de windrichting over de wei schuift. Elke steel leest de wind op zijn eigen plek, dus de bloemen buigen na elkaar mee, niet allemaal tegelijk. |
| Muis over de wei | ✅ | Bewust zo gelaten: de muis duwt de bloemen waar hij overkomt weg, en ze veren terug (veer-physics). De wind stuur je met de windroos en de microfoon. |
| Windroos: wind uit een bepaald punt | ✅ | Linksonder staat een windroos: sleep het bolletje rond de ring en de wind komt uit die hoek (de pijl toont waar hij naartoe waait). De roos draait mee met de camera zoals een kompas, dus "boven" op de roos is altijd recht voor je in de wei. De wind draait vloeiend naar de nieuwe richting, en de golven verspringen niet: ze schuiven op met een opgetelde verplaatsing (`uWindOffset`). Code: `src/interaction/WindRose.js`, `updateWind` in `src/state/worldState.js`, `src/world/wind.js`. |
| Blazen = wind: hoe harder, hoe harder de wind | ✅ | De blaaskracht van de microfoon (0..1, alleen echt blazen telt) wordt windkracht: basis 0,6 + tot 1,4 extra. Een windstoot steekt snel op en gaat traag liggen; sterkere wind laat de golven ook sneller over de wei trekken. Ingezoomd op een bloem vliegen de pluisjes ook weg, en de sterkere wind neemt ze verder mee. De roos toont de windkracht in %. |

### 2. Inzoomen op één bloem

| Onderdeel | Status | Hoe het werkt / wat er nog moet |
| --- | --- | --- |
| Klik op een bloem: vloeiend inzoomen | ✅ | Een klik is indrukken en loslaten zonder te slepen (< 5 px). `pick()` zoekt de bol die het dichtst bij de klikstraal ligt; dat gebeurt op de CPU, want de gewone raycaster ziet de GPU-instances niet. Camera en draaipunt glijden in 1,2 s naar de bol met een zachte start en landing (easing). Code: `src/interaction/FlowerFocus.js`. |
| Escape of klik ernaast: terug | ✅ | De plek in de wei wordt bewaard bij het inzoomen; terug glijdt de camera daar weer naartoe. Ingezoomd gelden andere cameragrenzen (`FOCUS_LIMITS` in `src/core/camera.js`). |
| De rest van de wei blijft bewegen | ✅ | Alleen de camera verandert. De gekozen bloem beweegt nog maar zachtjes (15%), alsof je ze vasthoudt. |
| Extra: scherptediepte | ✅ | Ingezoomd wordt alles wat niet op de afstand van de bol staat wazig, plus een zacht vignet. Post-processing met `RenderPipeline`: per pixel mengen tussen scherp en een wazige versie volgens de diepte. Code: `src/core/postprocessing.js`. |

### 3. De bloem voelt

| Onderdeel | Status | Hoe het werkt / wat er nog moet |
| --- | --- | --- |
| Muis of hand: de steel buigt weg | ✅ | Muis en hand zijn elk een straal (ray) vanaf de camera. Een compute shader (`src/world/FlowerPhysics.js`) berekent voor elke bloem de duw van die stralen. De steel buigt met de shape key "Buigen" uit Blender, per bloem gedraaid naar de duwrichting. |
| Hand via de webcam | ✅ | MediaPipe Hand Landmarker in een Web Worker (`handWorker.js`). Het midden van de handpalm stuurt de hand-aanwijzer; tussen twee detecties voorspelt de app waar de hand nu is, uit haar snelheid. Code: `src/interaction/CameraVision.js`. |
| De steel deint na als een veer | ✅ | Per bloem een gedempte veer (a = −k·x − c·v + F) in de compute shader, met per bloem een iets andere stijfheid, zodat ze niet in hetzelfde ritme wiegen. |
| Pluisjes in de buurt wiegen mee | 🟡 | De pluisjes bewegen mee met de bol, maar niet elk apart. Nog te doen: pluisjes dicht bij de muis of hand een kleine eigen beweging geven. |
| 's Nachts lichten pluisjes bij je cursor of hand op | ❌ | Nog te doen: de "hover-gloed", een TSL-shader die de gloed van de pluisjes verhoogt naargelang hun afstand tot de straal van de muis of hand. |

### 4. Pluisjes wegwrijven of wegblazen

| Onderdeel | Status | Hoe het werkt / wat er nog moet |
| --- | --- | --- |
| Wrijf over de bol: hoe sneller, hoe meer | ✅ | Een compute shader (`src/world/Seeds.js`) geeft elk pluisje van de gekozen bloem per seconde een kans om los te komen. Die kans groeit met de snelheid van de muis of hand ter hoogte van het pluisje (vanaf 0,6 m/s). |
| Blaas in de microfoon: hoe harder, hoe meer | ✅ | Web Audio API (`src/interaction/Microphone.js`): alleen geluid dat luid én ruisachtig is, telt als blazen (spectrale vlakheid uit de FFT), dus praten of muziek blaast niets weg. De pluisjes aan jouw kant gaan eerst. Een blaasmeter onder de microfoonknop toont of hij je hoort. |
| Parachuutje opent, traag wegdwarrelen | ✅ | Een tweede compute shader doet de vlucht: meedrijven met dezelfde wind als de wei, traag dalen met luchtweerstand, fladderen, op de grond blijven liggen, na 20 s verdwijnen. Een los pluisje draait rechtop en de pluis waaiert open (in code, niet met een shape key). |
| De bol wordt kaler | ✅ | Per pluisje een toestand (vast of los) in een GPU-buffer. Tot 64 kale bloemen worden onthouden, dus een kale bol blijft kaal tussen de andere, ook na het uitzoomen; van ver wordt de foto van die bol doorzichtiger. |
| Nieuwe pluisjes groeien aan | ➖ | Bewust weggelaten. |

### 5. Dag & nacht

| Onderdeel | Status | Hoe het werkt / wat er nog moet |
| --- | --- | --- |
| Start volgt light of dark mode | ✅ | `prefers-color-scheme` bepaalt de startwaarde van de dagcyclus (`src/state/worldState.js`). |
| Pijltjes ↑ ↓ met vloeiende overgang | ✅ | Tikken is één stap, ingedrukt houden laat de tijd doorlopen. De wereld glijdt exponentieel naar het doel. `uTimeOfDay` (0 = nacht, 1 = dag) stuurt de lucht, het licht, de grond, de pluisjes en de vuurvliegjes. |
| Extra: licht in de kamer stuurt dag en nacht | ✅ | Lichtmeter op de GPU (compute shaders): helderheid én contrast van het webcambeeld. Donker of vlak (bedekte camera) = nacht; het contrast is nodig omdat de webcam een donker beeld zelf weer oplicht. Een pijltje heeft 20 s voorrang. Nog af te stellen op je eigen camera. |
| Lucht van dag naar nacht | ✅ | Circadian (Shadertoy) geport naar TSL (`src/world/Sky.js`). Het dure deel rekent op 1/16 van de pixels in een render target. |
| Overdag: zachtwitte pluisjes | ✅ | Pluisjeskleur mengt van blauwig ('s nachts) naar wit (overdag) via `uTimeOfDay`. |
| Overdag: gele bloemen open | ❌ | Nog te doen: een gele bloem modelleren in Blender met een shape key "open/dicht", in de wei zetten met instancing, en de shape key laten sturen door `uTimeOfDay`. |
| 's Nachts: neon-randen | 🟡 | De pluisjes hebben 's nachts een cyaan gloed (emissive). Nog te doen: bloom (post-processing) voor de echte neon-gloed. |
| 's Nachts: pluisjes knipperen als vuurvliegjes | 🟡 | "Fireflies at Dusk" (Shadertoy) is geport als 300 aparte vuurvliegjes boven de wei: knipperritme, gloed en zweven uit het origineel, en ze schrikken op van muis en hand (physics). Nog te doen (optioneel): de pluisjes zelf ook laten knipperen met hetzelfde ritme. |

### 6. Ambient geluid

| Onderdeel | Status | Hoe het werkt / wat er nog moet |
| --- | --- | --- |
| Ambient muziek, dag en nacht | ❌ | Nog te doen: rechtenvrije muziek kiezen (dag en nacht), in `public/audio/` zetten, en met de Web Audio API laten overvloeien volgens `uTimeOfDay`. Credits in de README. |
| Windgeruis dat luider wordt bij vlagen | ❌ | Nog te doen: een windgeruis-loop waarvan het volume de windsterkte volgt. |
| Startscherm "Klik om te beginnen" | ✅ | Bestaat al; de klik geeft de browser toestemming voor geluid. |

### Opdracht-eisen

| Eis | Status | Hoe het werkt / wat er nog moet |
| --- | --- | --- |
| Shadertoy-shader geport naar WebGPU | ✅ | Circadian in TSL met `WebGPURenderer`, valt terug op WebGL2. Origineel in `shaders/original/circadian.glsl`. |
| Shader reageert op interactie | ✅ | De zonnestand volgt de pijltjes en het kamerlicht; de kijkrichting volgt de camera. Nog niet: "windsterkte kleurt de wolken". |
| Werkende URL | 🟡 | Online via GitHub Pages, maar alleen wat gepusht is. Nog te doen: het laatste werk committen en pushen. |
| Broncode zonder `node_modules` | ✅ | `node_modules/` staat in `.gitignore`. Bij het indienen zelf een zip maken zonder die map. |
| README met de shader-URL's | 🟡 | Shaders, makers en libraries staan erin. Nog te doen: de muziekcredits (TODO). |

### Extra punten (inhoud in één oogopslag)

| Onderdeel | Gepland | Status | Hoe het werkt / wat er nog moet |
| --- | --- | --- | --- |
| Interactie, meer dan rondkijken | 7 | ✅ | Muis, klikken, hover, wrijven, handtracking, blazen, pijltjes, dark mode, en extra: het kamerlicht. Nog: de muis-windvlaag. |
| Physics | 2 | ✅ 3 | Veer-physics van de stelen, de vlucht van de pluisjes en het opschrikken van de vuurvliegjes: alle drie compute shaders op de GPU. |
| Meerdere shaders | 2 + 3 eigen | ✅ | 2 Shadertoy-ports. Eigen TSL: windveld, pluisjes-materiaal, impostor, scherptediepte, lichtmeter. Nog: hover-gloed. |
| Extra WebGPU-libraries | 2 | 🟡 1 | tsl-textures voor de grond. three-particles is niet gebruikt: de pluisjesvlucht is zelf geschreven met compute shaders. |
| Extra library (niet WebGPU) | 1 | ✅ | MediaPipe Hand Landmarker. |
| Eigen Blender-modellen | 5 | 🟡 3 | Steel, pluizenbol en pluisje (`blender/puffballSimple.blend` → `public/models/puffballSimple.glb`). Nog te doen: bladrozet en gele bloem. |
| Shape keys vanuit de code | 4 | 🟡 1 | "Buigen" op de steel, gestuurd door wind en physics. "Bol kaal" en "parachuutje open" werken, maar in code in plaats van met een shape key. Nog te doen: gele bloem open/dicht, en eventueel "Open" op het pluisje. |
| Baking | 2 | 🟡 1 | Ambient occlusion gebakken in Blender voor de steel en de bol (`aoMap`). Nog te doen: detailtextuur, en de dag- en nacht-lightmap voor de grond. |
| Procedureel in code | 2 | ✅ | Pluisjes op de bol volgens de gulden hoek (Fibonacci-spiraal); bloemen verspreid met een jittered grid. |
| Audio | 2 | ❌ | Muziek en windgeruis, zie deel 6. |