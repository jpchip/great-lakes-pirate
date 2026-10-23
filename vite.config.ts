import { defineConfig } from 'vite';
import pkg from './package.json' with { type: 'json' };

export default defineConfig({
  // Relative base keeps the build path-agnostic: domain root on the droplet
  // and inside itch.io's iframe (plan 01 §10).
  base: './',
  define: {
    // Written into every save envelope (plan 16 §5.1).
    __GAME_VERSION__: JSON.stringify(pkg.version),
  },
  build: {
    target: 'es2022',
    sourcemap: true,
    // three.js alone is ~700 kB; code splitting comes with zone streaming (plan 03).
    chunkSizeWarningLimit: 1000,
  },
  worker: {
    format: 'es',
  },
});
