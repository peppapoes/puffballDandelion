import { uWindStrength, setWindDirection, getWindTarget } from '../state/worldState.js';

const SVG = 'http://www.w3.org/2000/svg';
const SIZE = 120; // px
const RADIUS = 46; // straal van de ring (px)
const STRENGTH_FULL = 2; // windkracht die als 100% getoond wordt (basis 0.6 + hard blazen 1.4)

/**
 * Windroos (linksonder): sleep het bolletje rond de ring om de wind uit die hoek te laten komen.
 * De pijl toont waar de wind naartoe waait; hoe dikker, hoe harder (blazen in de microfoon).
 *
 * De roos draait mee met de camera, zoals een kompas: wat op de roos "boven" staat, ligt in
 * de wei recht voor je. Intern werkt alles in wereldrichtingen (x, z):
 * noord = −z (boven op de roos), oost = +x (rechts).
 */
export class WindRose {
  constructor(controls) {
    this.controls = controls;
    this.azimuth = 0; // draaiing van de camera rond de wei (rad)
    this.root = document.getElementById('wind-rose');
    this.build();
    this.root.addEventListener('pointerdown', (event) => this.onPointer(event, true));
    this.root.addEventListener('pointermove', (event) => this.onPointer(event, false));
    this.root.addEventListener('pointerup', () => (this.dragging = false));
    this.root.addEventListener('pointercancel', () => (this.dragging = false));
  }

  /** Tonen (na het startscherm) */
  show() {
    this.root.hidden = false;
  }

  build() {
    const svg = element('svg', { viewBox: `${-SIZE / 2} ${-SIZE / 2} ${SIZE} ${SIZE}`, width: SIZE, height: SIZE });
    svg.append(element('circle', { r: RADIUS, class: 'ring' }));

    // Alles in deze groep staat in wereldrichtingen en draait mee met de camera
    this.compass = element('g');
    this.letters = [['N', 0, -1], ['O', 1, 0], ['Z', 0, 1], ['W', -1, 0]].map(([text, x, z]) => {
      const label = element('text', { x: x * (RADIUS - 11), y: z * (RADIUS - 11), class: 'letter' });
      label.textContent = text;
      this.compass.append(label);
      return label;
    });
    this.arrow = element('line', { class: 'arrow', 'marker-end': 'url(#wind-arrow-head)' });
    this.handle = element('circle', { r: 7, class: 'handle' });
    this.compass.append(this.arrow, this.handle);

    const head = element('marker', { id: 'wind-arrow-head', viewBox: '0 0 10 10', refX: 6, refY: 5, markerWidth: 4, markerHeight: 4, orient: 'auto' });
    head.append(element('path', { d: 'M0,0 L10,5 L0,10 z', class: 'arrow-head' }));
    svg.append(element('defs', {}, [head]), this.compass);

    this.label = document.createElement('p');
    this.root.append(svg, this.label);
    this.svg = svg;
  }

  /** Slepen: het bolletje komt op de plek waar je wijst, de wind komt uit die hoek */
  onPointer(event, start) {
    if (start) {
      this.dragging = true;
      this.root.setPointerCapture(event.pointerId);
    }
    if (!this.dragging) return;

    const rect = this.svg.getBoundingClientRect();
    const sx = event.clientX - (rect.left + rect.width / 2);
    const sy = event.clientY - (rect.top + rect.height / 2);
    if (Math.hypot(sx, sy) < 4) return; // in het midden: geen richting

    // Scherm → wereld: de camera-draaiing terugdraaien
    const c = Math.cos(-this.azimuth);
    const s = Math.sin(-this.azimuth);
    const fromX = sx * c - sy * s;
    const fromZ = sx * s + sy * c;
    // De wind komt uit die hoek, dus hij waait de andere kant op
    setWindDirection(-fromX, -fromZ);
  }

  /** Elke frame: meedraaien met de camera, pijl en bolletje bijwerken */
  update() {
    this.azimuth = this.controls.getAzimuthalAngle();
    const degrees = (this.azimuth * 180) / Math.PI;
    this.compass.setAttribute('transform', `rotate(${degrees})`);
    // Letters rechtop houden
    for (const label of this.letters) {
      label.setAttribute('transform', `rotate(${-degrees} ${label.getAttribute('x')} ${label.getAttribute('y')})`);
    }

    const { x, y: z } = getWindTarget();
    const strength = uWindStrength.value / STRENGTH_FULL;
    // Bolletje op de ring waar de wind vandaan komt, pijl erdoor naar de overkant
    this.handle.setAttribute('cx', -x * RADIUS);
    this.handle.setAttribute('cy', -z * RADIUS);
    this.arrow.setAttribute('x1', -x * (RADIUS - 10));
    this.arrow.setAttribute('y1', -z * (RADIUS - 10));
    this.arrow.setAttribute('x2', x * (RADIUS - 14));
    this.arrow.setAttribute('y2', z * (RADIUS - 14));
    this.arrow.style.strokeWidth = 2 + strength * 5;
    this.label.textContent = `wind ${Math.round(strength * 100)}%`;
  }
}

function element(name, attributes = {}, children = []) {
  const node = document.createElementNS(SVG, name);
  for (const [key, value] of Object.entries(attributes)) node.setAttribute(key, value);
  node.append(...children);
  return node;
}
