import { defineConfig } from 'vite';

export default defineConfig({
  // Relative base keeps the build path-agnostic: domain root on the droplet
  // and inside itch.io's iframe (plan 01 §10).
  base: './',
  build: {
    target: 'es2022',
    sourcemap: true,
    // three.js alone is ~700 kB; code splitting comes with zone streaming (plan 03).
    chunkSizeWarningLimit: 1000,
  },
});
