import { defineConfig } from 'vite';
import pkg from './package.json' with { type: 'json' };
import { districtEditorPlugin } from './tools/district/vite-plugin';

export default defineConfig({
  // Relative base keeps the build path-agnostic: domain root on the droplet
  // and inside itch.io's iframe (plan 01 §10).
  base: './',
  // The district placement editor's save and bake endpoints (dev server only).
  plugins: [districtEditorPlugin()],
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
