import { RenderTarget, Vector2 } from 'three/webgpu';

export const DEBUG =new URLSearchParams(window.location.search).has('debug');

const SMOOTHING = 0.05; // gemiddelde over de laatste ±20 frames (rustig leesbaar)
const REFRESH_MS = 500; // paneel twee keer per seconde bijwerken

export class PerfMonitor {
  constructor(renderer) {
    this.renderer = renderer;
    this.enabled = DEBUG;
    this.averages = {}; // naam → gemiddelde ms
    this.starts = {};
    this.counts = {}; // naam → aantal sinds de vorige verversing
    this.rates = {}; // naam → aantal per seconde
    this.infos = {}; // naam → extra regel tekst
    this.lastRefresh = 0;

    if (!this.enabled) return;

    this.panel = document.createElement('pre');
    this.panel.id = 'perf-panel';
    document.body.appendChild(this.panel);
  }

  begin(name) {
    if (this.enabled) this.starts[name] = performance.now();
  }

  end(name) {
    if (this.enabled) this.record(name, performance.now() - this.starts[name]);
  }

  record(name, ms) {
    const previous = this.averages[name];
    this.averages[name] = previous === undefined ? ms : previous + (ms - previous) * SMOOTHING;
  }

  info(name, text) {
    if (this.enabled) this.infos[name] = text;
  }

  count(name) {
    if (this.enabled) this.counts[name] = (this.counts[name] ?? 0) + 1;
  }

  frame(delta) {
    if (!this.enabled) return;
    if (delta > 0) this.record('frame', delta * 1000);

    const now = performance.now();
    if (now - this.lastRefresh > REFRESH_MS) {
      for (const name in this.counts) {
        this.rates[name] = (this.counts[name] * 1000) / (now - this.lastRefresh);
        this.counts[name] = 0;
      }
      this.lastRefresh = now;
      this.draw();
    }
  }

  draw() {
    const a = this.averages;
    const ms = (name) => (a[name] === undefined ? '  –  ' : a[name].toFixed(2).padStart(5)) + ' ms';
    const info = this.renderer.info.render;

    this.panel.textContent = [
      `${(1000 / (a.frame || 16.7)).toFixed(0)} fps   frame ${ms('frame')}`,
      '',
      `CPU  wereld     ${ms('world')}`,
      `CPU  camera     ${ms('camera')}`,
      `CPU  physics    ${ms('physics')}`,
      `CPU  renderen   ${ms('render')}`,
      '',
      `hand  ${(this.rates.hand ?? 0).toFixed(1).padStart(4)} /s   ${ms('hand')} per detectie`,
      ...Object.entries(this.infos).map(([name, text]) => `${name}   ${text}`),
      '',
      `draw calls  ${info.drawCalls}`,
      `driehoeken  ${info.triangles.toLocaleString('nl-BE')}`,
      '',
      'console: await app.benchmark()',
    ].join('\n');
  }
}

export async function benchmark(app, frames = 60) {
  const { renderer } = app;
  const device = renderer.backend.device;
  if (!device) return 'Alleen met de WebGPU-backend';

  const size = renderer.getDrawingBufferSize(new Vector2());
  const target = new RenderTarget(size.x, size.y, { samples: renderer.samples });

  renderer.setAnimationLoop(null);
  const finish = async () => {
    app.renderFrame(target);
    await device.queue.onSubmittedWorkDone();
  };

  for (let i = 0; i < 5; i++) await finish(); // opwarmen
  const start = performance.now();
  for (let i = 0; i < frames; i++) await finish();
  const ms = (performance.now() - start) / frames;

  target.dispose();
  renderer.setAnimationLoop((timestamp) => app.update(timestamp));
  return `${ms.toFixed(1)} ms per frame (± ${Math.round(1000 / ms)} fps zonder plafond)`;
}
