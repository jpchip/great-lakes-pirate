import { GUI } from 'three/examples/jsm/libs/lil-gui.module.min.js';
import { packWaves, testBaySea, type Sea } from '../sim/weather/waves';
import type { GameRenderer } from '../render/renderer';
import { browserStorage, QUALITY_IDS, storeQuality, type QualityId } from '../render/quality';
import type { TestScene } from '../render/test-scene';
import { createTerrainOverlay, type TerrainOverlay } from './terrain-overlay';
import { formatWaterBench, runWaterBench } from './water-bench';

/**
 * The dev overlay (plan 01 §5, §11.1 task 4): a stats readout plus lil-gui panels for
 * quality, the sea, terrain, saving and the S2 water benchmark. Loaded only in dev builds
 * or with `?debug` / `?bench=water`, as a separate chunk. `?overlay=shelter` (or `fetch`,
 * `funnel`) and `?windfrom=<degrees>` open the terrain overlay straight away.
 */

export interface SaveControls {
  status: string;
  lastSavedAt: Date | undefined;
  lastError: string | undefined;
  saveNow(): Promise<void>;
}

export interface OverlayOptions {
  renderer: GameRenderer;
  scene: TestScene;
  sea: Sea;
  save: SaveControls;
  /** Run the water benchmark straight away (`?bench=water`). */
  autoBench: boolean;
  /** Where to read terrain values for the stats (the player ship). */
  probe?: () => { x: number; z: number };
}

const STYLE = `
  position: fixed; top: 8px; left: 8px; z-index: 10; margin: 0; padding: 6px 8px;
  font: 11px/1.4 ui-monospace, monospace; color: #e8eef0; background: rgba(15, 25, 32, 0.78);
  border-radius: 4px; pointer-events: none; white-space: pre;
`;

export interface DevOverlay {
  /** The root panel, for other dev panels to add folders to. */
  gui: GUI;
  update(frameSeconds: number): void;
}

export function createDevOverlay(options: OverlayOptions): DevOverlay {
  const { renderer, scene, sea, save } = options;

  const readout = document.createElement('pre');
  readout.style.cssText = STYLE;
  readout.dataset['testid'] = 'dev-stats';
  document.body.appendChild(readout);

  const gui = new GUI({ title: 'Dev' });

  const quality = {
    preset: renderer.preset.id as QualityId,
    dynamic: renderer.dynamicResolution.enabled,
  };
  const qualityFolder = gui.addFolder('Quality');
  qualityFolder
    .add(quality, 'preset', [...QUALITY_IDS])
    .name('Preset')
    .onChange((id: QualityId) => {
      storeQuality(id, browserStorage());
      if (renderer.setQuality(id)) {
        console.info('Antialiasing changes on reload for this preset.');
      }
    });
  qualityFolder
    .add(quality, 'dynamic')
    .name('Dynamic resolution')
    .onChange((on: boolean) => (renderer.dynamicResolution.enabled = on));

  const seaParams = { scale: 1, foam: renderer.preset.crestFoam };
  const uniforms = scene.water.material.uniforms;
  const seaFolder = gui.addFolder('Sea');
  seaFolder
    .add(seaParams, 'scale', 0, 2.5, 0.05)
    .name('Sea state')
    .onChange((scale: number) => {
      // Buoyancy reads ctx.sea, so swap the set on the shared object.
      sea.waves = packWaves(testBaySea(scale));
      scene.water.setWaves(sea);
    });
  seaFolder.add(uniforms.uWaveCount, 'value', 1, 8, 1).name('Shader waves').listen();
  seaFolder
    .add(seaParams, 'foam')
    .name('Crest foam')
    .onChange((on: boolean) => (uniforms.uCrestFoam.value = on ? 1 : 0));
  seaFolder.add(uniforms.uFoamThreshold, 'value', 0.1, 0.9, 0.01).name('Foam threshold');
  renderer.onPresetChange((preset) => (seaParams.foam = preset.crestFoam));
  seaFolder.controllers.forEach((c) => c.listen());

  // For scripted screenshots and poking around in the console.
  (window as unknown as { __glpScene: TestScene }).__glpScene = scene;

  let terrain: TerrainOverlay | undefined;
  if (scene.zone) {
    const params = new URLSearchParams(window.location.search);
    const map = params.get('overlay');
    const windFrom = Number(params.get('windfrom') ?? 315);
    terrain = createTerrainOverlay(scene.scene, scene.zone.terrain, gui, {
      map: map === 'shelter' || map === 'fetch' || map === 'funnel' ? map : 'off',
      windFromDeg: Number.isFinite(windFrom) ? windFrom : 315,
    });
  }

  const saveFolder = gui.addFolder('Save');
  saveFolder.add({ save: () => void save.saveNow() }, 'save').name('Save now');
  saveFolder
    .add(
      {
        reload: async () => {
          await save.saveNow();
          window.location.reload();
        },
      },
      'reload',
    )
    .name('Save and reload');

  let benchText = '';
  const bench = async (): Promise<void> => {
    document.body.dataset['bench'] = 'running';
    try {
      const result = await runWaterBench(renderer, scene, (m) => (benchText = m));
      benchText = formatWaterBench(result);
      console.info(`Water benchmark (spike S2)\n${benchText}`);
      (window as unknown as { __glpWaterBench: unknown }).__glpWaterBench = result;
      document.body.dataset['bench'] = 'done';
    } catch (err) {
      benchText = `Benchmark failed: ${String(err)}`;
      document.body.dataset['bench'] = 'failed';
    }
  };
  const benchFolder = gui.addFolder('Spike S2');
  benchFolder.add({ run: bench }, 'run').name('Measure water');
  benchFolder
    .add({ copy: () => void navigator.clipboard.writeText(benchText) }, 'copy')
    .name('Copy results');
  if (options.autoBench) {
    // Let shaders compile and the page settle first.
    window.setTimeout(() => void bench(), 3000);
  }

  let frames = 0;
  let elapsed = 0;
  let fps = 0;
  let worstMs = 0;
  let worstShown = 0;
  return {
    gui,
    update(frameSeconds) {
      frames++;
      elapsed += frameSeconds;
      worstMs = Math.max(worstMs, frameSeconds * 1000);
      if (elapsed < 0.5) return;
      fps = frames / elapsed;
      worstShown = worstMs;
      frames = 0;
      elapsed = 0;
      worstMs = 0;

      const s = renderer.stats();
      const heap = (performance as { memory?: { usedJSHeapSize: number } }).memory;
      const saved = save.lastSavedAt ? save.lastSavedAt.toLocaleTimeString() : '—';
      readout.textContent = [
        `${fps.toFixed(0)} fps  worst ${worstShown.toFixed(1)} ms`,
        `GPU ${s.gpuMs === undefined ? 'n/a' : `${s.gpuMs.toFixed(2)} ms`}`,
        `${s.drawCalls} calls  ${(s.triangles / 1000).toFixed(1)}k tris`,
        `${renderer.preset.label}  scale ${s.scale.toFixed(2)}  ${s.width}×${s.height}`,
        heap ? `heap ${(heap.usedJSHeapSize / 1048576).toFixed(0)} MB` : '',
        `save ${save.status}  last ${saved}${save.lastError ? `  ERROR ${save.lastError}` : ''}`,
        terrain && options.probe ? terrain.describe(options.probe().x, options.probe().z) : '',
        benchText,
      ]
        .filter(Boolean)
        .join('\n');
    },
  };
}
