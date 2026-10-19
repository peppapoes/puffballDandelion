import { uWindStrength, setWindDirection, getWindTarget } from '../state/worldState.js';

const SVG = 'http://www.w3.org/2000/svg';
const SIZE = 120; // px
const RADIUS = 46; // straal van de ring (px)
const STRENGTH_FULL = 2; // windkracht die als 100% getoond wordt (basis 0.6 + hard blazen 1.4)

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

  show() {
    this.root.hidden = false;
  }

  build() {
    const svg = element('svg', { viewBox: `${-SIZE / 2} ${-SIZE / 2} ${SIZE} ${SIZE}`, width: SIZE, height: SIZE });
    svg.append(element('circle', { r: RADIUS, class: 'ring' }));

    this.compass = element('g');
    this.letters = [['N', 0, -1], ['E', 1, 0], ['S', 0, 1], ['W', -1, 0]].map(([text, x, z]) => {
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

    const c = Math.cos(-this.azimuth);
    const s = Math.sin(-this.azimuth);
    const fromX = sx * c - sy * s;
    const fromZ = sx * s + sy * c;
    setWindDirection(-fromX, -fromZ);
  }

  update() {
    this.azimuth = this.controls.getAzimuthalAngle();
    const { x, y: z } = getWindTarget();
    const percent = Math.round((uWindStrength.value / STRENGTH_FULL) * 100);
    const state = `${this.azimuth.toFixed(3)} ${x.toFixed(3)} ${z.toFixed(3)} ${percent}`;
    if (state === this.lastState) return;
    this.lastState = state;

    const degrees = (this.azimuth * 180) / Math.PI;
    this.compass.setAttribute('transform', `rotate(${degrees})`);
    for (const label of this.letters) {
      label.setAttribute('transform', `rotate(${-degrees} ${label.getAttribute('x')} ${label.getAttribute('y')})`);
    }

    const strength = percent / 100;
    this.handle.setAttribute('cx', -x * RADIUS);
    this.handle.setAttribute('cy', -z * RADIUS);
    this.arrow.setAttribute('x1', -x * (RADIUS - 10));
    this.arrow.setAttribute('y1', -z * (RADIUS - 10));
    this.arrow.setAttribute('x2', x * (RADIUS - 14));
    this.arrow.setAttribute('y2', z * (RADIUS - 14));
    this.arrow.style.strokeWidth = 2 + strength * 5;
    this.label.textContent = `wind ${percent}%`;
  }
}

function element(name, attributes = {}, children = []) {
  const node = document.createElementNS(SVG, name);
  for (const [key, value] of Object.entries(attributes)) node.setAttribute(key, value);
  node.append(...children);
  return node;
}
