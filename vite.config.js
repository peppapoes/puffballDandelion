import { defineConfig } from 'vite';

export default defineConfig({
  // Relatieve paden, zodat de build werkt op GitHub Pages (subpad /puffballDandelion/)
  base: './',
  build: {
    // WebGPU + top-level await vereist een moderne target
    target: 'esnext',
    // Three.js alleen is al ~900 kB; geen waarschuwing daarvoor
    chunkSizeWarningLimit: 1500,
  },
});
