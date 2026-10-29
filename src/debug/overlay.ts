import { GUI } from 'three/examples/jsm/libs/lil-gui.module.min.js';
import { dayAndHour, SECONDS_PER_GAME_DAY, type ClockState } from '../core/time';
import {
  WEATHER_PRESETS,
  type LocalWeather,
  type WeatherPresetId,
} from '../sim/weather/local-weather';
import type { GameRenderer } from '../render/renderer';
import { browserStorage, QUALITY_IDS, storeQuality, type QualityId } from '../render/quality';
import type { TestScene } from '../render/test-scene';
import { createTerrainOverlay, type TerrainOverlay } from './terrain-overlay';
import { formatWaterBench, runWaterBench } from './water-bench';

/**
 * The dev overlay (plan 01 §5, §11.1 task 4): a stats readout plus lil-gui panels for
 * quality, wind and sea (plan 02 §14.2), time of day, terrain, saving and the S2 water
 * benchmark. Loaded only in dev builds or with `?debug` / `?bench=water`, as a separate
 * chunk. `?overlay=shelter` (or `fetch`, `funnel`) and `?windfrom=<degrees>` open the
 * terrain overlay straight away.
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
  weather: LocalWeather;
  clock: ClockState;
  save: SaveControls;
  /** Run the water benchmark straight away (`?bench=water`). */
  autoBench: boolean;
  /** Where to read the wind, sea and terrain for the stats (the player ship). */
  probe: () => { x: number; z: number };
  /** Save a preset pick through the settings store; it applies it to the renderer. */
  setQuality?: (id: QualityId) => void;
}

const STYLE = `
  position: fixed; top: 52px; left: 16px; z-index: 10; margin: 0; padding: 6px 8px;
  font: 11px/1.4 ui-monospace, monospace; color: #e8eef0; background: rgba(15, 25, 32, 0.78);
  border-radius: 4px; pointer-events: none; white-space: pre;
`;

export interface DevOverlay {
  /** The root panel, for other dev panels to add folders to. */
  gui: GUI;
  update(frameSeconds: number): void;
}

/** The zone streaming line: tiles drawn by stride, waiting tiles and the slowest frames. */
function streamText(scene: TestScene): string {
  const t = scene.terrain?.stats;
  if (!t) return '';
  const strides = Object.entries(t.strides)
    .map(([stride, n]) => `${n}×${Number(stride) * 4}m`)
    .join(' ');
  return (
    `tiles ${strides || 'none'}  wait ${t.pending}  built ${t.builds}` +
    `  ${t.worker ? 'worker' : 'main'} ${t.maxBuildMs.toFixed(1)} ms  update ≤${t.maxUpdateMs.toFixed(1)} ms`
  );
}

export function createDevOverlay(options: OverlayOptions): DevOverlay {
  const { renderer, scene, weather, clock, probe, save } = options;

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
      if (options.setQuality) {
        options.setQuality(id);
        return;
      }
      storeQuality(id, browserStorage());
      if (renderer.setQuality(id)) {
        console.info('Antialiasing changes on reload for this preset.');
      }
    });
  qualityFolder
    .add(quality, 'dynamic')
    .name('Dynamic resolution')
    .onChange((on: boolean) => (renderer.dynamicResolution.enabled = on));

  const settings = weather.settings;
  const windFolder = gui.addFolder('Wind and sea');
  const preset: { id: string } = { id: 'moderate' };
  windFolder
    .add(preset, 'id', Object.keys(WEATHER_PRESETS))
    .name('Preset')
    .onChange((id: string) => weather.applyPreset(id as WeatherPresetId));
  windFolder
    .add({ gale: () => weather.startGale(clock.gameSeconds) }, 'gale')
    .name('Start scripted gale');
  windFolder.add(settings, 'fromDeg', 0, 359, 1).name('From (°)');
  windFolder.add(settings, 'speedKn', 0, 50, 0.5).name('Speed (kn)');
  windFolder.add(settings, 'driftDeg', 0, 40, 1).name('Drift (°)');
  windFolder.add(settings, 'surge', 0, 0.4, 0.01).name('Surge');
  windFolder.add(settings, 'gustiness', 0, 1, 0.01).name('Gustiness');
  windFolder.add(settings, 'seaGain', 0, 2.5, 0.05).name('Sea × wind');
  windFolder.add(settings, 'seaLagMin', 0, 180, 5).name('Sea lag (game min)');
  windFolder.add(settings, 'visibilityM', 100, 25_000, 100).name('Visibility (m)');
  windFolder.add(settings, 'cloud01', 0, 1, 0.01).name('Cloud');
  windFolder.controllers.forEach((c) => c.listen());

  const time = {
    get hour(): number {
      return dayAndHour(clock.gameSeconds).hour;
    },
    set hour(h: number) {
      const { day } = dayAndHour(clock.gameSeconds);
      clock.gameSeconds = day * SECONDS_PER_GAME_DAY + h * 3600;
    },
  };
  const timeFolder = gui.addFolder('Time');
  timeFolder.add(time, 'hour', 0, 23.99, 0.05).name('Hour').listen();

  const seaParams = { foam: renderer.preset.crestFoam };
  const uniforms = scene.water.material.uniforms;
  const seaFolder = gui.addFolder('Water');
  seaFolder.add(uniforms.uWaveCount, 'value', 1, 8, 1).name('Shader waves').listen();
  seaFolder
    .add(seaParams, 'foam')
    .name('Crest foam')
    .onChange((on: boolean) => (uniforms.uCrestFoam.value = on ? 1 : 0));
  // Driven by the wind each frame (render/environment.ts); shown for reference.
  seaFolder.add(uniforms.uFoamThreshold, 'value', 0.1, 0.9, 0.01).name('Foam threshold').disable();
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
      const at = probe();
      const wind = weather.windAt(at, clock.gameSeconds);
      const waves = weather.waveParams(at);
      const { hour } = dayAndHour(clock.gameSeconds);
      const hh = Math.floor(hour);
      const mm = Math.floor((hour - hh) * 60);
      const clockText = `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
      readout.textContent = [
        `${fps.toFixed(0)} fps  worst ${worstShown.toFixed(1)} ms`,
        `GPU ${s.gpuMs === undefined ? 'n/a' : `${s.gpuMs.toFixed(2)} ms`}`,
        `${s.drawCalls} calls  ${(s.triangles / 1000).toFixed(1)}k tris`,
        `${renderer.preset.label}  scale ${s.scale.toFixed(2)}  ${s.width}×${s.height}`,
        heap ? `heap ${(heap.usedJSHeapSize / 1048576).toFixed(0)} MB` : '',
        `wind ${((wind.fromRad * 180) / Math.PI).toFixed(0)}° ${wind.speedKn.toFixed(1)} kn  gust ${wind.gust01.toFixed(2)}  lee ${wind.shelter01.toFixed(2)}${weather.galeActive ? '  GALE' : ''}`,
        `sea Hs ${waves.hsM.toFixed(2)} m  ×${waves.scale.toFixed(2)}  λ ${weather.seaShape.peakWavelengthM.toFixed(0)} m`,
        `${clockText}  sun ${scene.environment.sunElevationDeg.toFixed(0)}°  vis ${(weather.visibilityAt(at, clock.gameSeconds) / 1000).toFixed(1)} km`,
        `save ${save.status}  last ${saved}${save.lastError ? `  ERROR ${save.lastError}` : ''}`,
        terrain ? terrain.describe(at.x, at.z) : '',
        streamText(scene),
        benchText,
      ]
        .filter(Boolean)
        .join('\n');
    },
  };
}
