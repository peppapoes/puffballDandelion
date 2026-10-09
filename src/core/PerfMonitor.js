/**
 * Prestatiemeter: zet ?debug achter de URL om het paneel te tonen.
 * Paneel: fps, frametijd, CPU-tijd per onderdeel, draw calls en driehoeken.
 *
 * Voor de echte kost per frame (JavaScript + GPU): typ in de browserconsole
 *   await app.benchmark()
 * Dat rendert zelf frames en wacht telkens tot de GPU klaar is. Betrouwbaarder dan
 * GPU-timestamps, die op een Mac sterk schommelen.
 *
 * Zonder ?debug doen begin/end niets en kost hij niets.
 */

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

  /** Eén keer per frame, na het renderen */
  frame(delta) {
    if (!this.enabled) return;
    if (delta > 0) this.record('frame', delta * 1000);

    const now = performance.now();
    if (now - this.lastRefresh > REFRESH_MS) {
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
      `draw calls  ${info.drawCalls}`,
      `driehoeken  ${info.triangles.toLocaleString('nl-BE')}`,
      '',
      'console: await app.benchmark()',
    ].join('\n');
  }
}

/**
 * Echte kost per frame: render-loop pauzeren, zelf frames renderen en na elke frame
 * wachten tot de GPU klaar is. Er wordt naar een onzichtbare render target van
 * schermgrootte gerenderd: naar het canvas zou elke frame op het scherm wachten
 * (60 Hz), en dan zie je nooit minder dan 16,7 ms.
 */
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
