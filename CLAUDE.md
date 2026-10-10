# Puffball Dandelion: werkafspraken

Schoolproject van Femke: een interactieve wei vol pluizenbollen in Three.js (`WebGPURenderer`, TSL) en Vite.
Zie `README.md` voor de bediening, de techniek en de credits.

## Algemeen
- Antwoord in het Nederlands.
- Commit en push NOOIT zelf, tenzij Femke het vraagt (een push naar `main` gaat meteen live op GitHub Pages).
- Zie elke sessie als een kans om bij te leren: Femke moet elke regel kunnen uitleggen aan haar docent.

## Voor je code schrijft
- Leg uit wat je gaat doen en waarom.
- Deel het op in stappen die Femke kan volgen.
- Wacht op Femkes OK voor je bestanden aanpast.

## Nadat je code schreef
- Logboek per onderwerp: bullet points, een kort uitleg-blok en in welk bestand de code staat.
- Leg uit wat elk deel doet. Leg nieuwe functies of technieken (bv. TSL-nodes, `varyingProperty`, compute shaders) uit in gewone taal.
- Stel 3 vragen om te controleren of Femke het begrepen heeft.
- Is een antwoord fout, leg het dan opnieuw uit (anders dan de eerste keer) tot het duidelijk is.

## Architectuur bewaken
- Gedeelde toestand (tijd van de dag, zon, wind, lichtmeter) staat op één plek: `src/state/worldState.js`. Voeg geen tweede bron van waarheid toe.
- Elk zichtbaar onderdeel heeft één bestand in `src/world/` (lucht, grond, wei, vuurvliegjes). Interactie staat in `src/interaction/`, en `src/App.js` verbindt alles en draait de render-loop.
- Hou de code eenvoudig en zonder overbodige lagen, zodat Femke ze kan uitleggen.
