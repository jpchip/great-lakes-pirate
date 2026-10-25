import { SECONDS_PER_GAME_DAY, dayAndHour } from './core/time';
import { EventBus } from './core/events';
import { InputMapper } from './core/input';
import { createLoop } from './core/loop';
import { Rng } from './core/rng';
import { openSaveDb } from './core/save/db';
import { createWorkerEncoder } from './core/save/encoder';
import { loadRun } from './core/save/load';
import { RunSaver } from './core/save/run-saver';
import { AssetLoader, EMPTY_MANIFEST } from './core/assets';
import { createBuoyancy } from './gameplay/buoyancy';
import { cloneTransform, createGameWorld } from './gameplay/ecs';
import type { SaveControls } from './debug/overlay';
import type { GameContext, GameEvents } from './modes/context';
import { ModeMachine } from './modes/machine';
import { createSailingMode, type SailingView } from './modes/sailing';
import { loadAssets } from './render/assets';
import { browserStorage, initialQuality } from './render/quality';
import { GameRenderer } from './render/renderer';
import { createTestScene } from './render/test-scene';
import { createSailingState } from './sim/sailing/controller';
import { defaultHandling } from './sim/sailing/handling';
import { compileSailingClass } from './sim/sailing/ship-class';
import { sailShipRecord, T1_SCHOONER_ID } from './sim/sailing/ships';
import { httpBytes, loadZoneTerrain, type LoadedZone } from './sim/terrain/load';
import { TEST_BAY } from './sim/terrain/test-bay';
import {
  WEATHER_PRESETS,
  createLocalWeather,
  type WeatherPresetId,
} from './sim/weather/local-weather';
import { TEST_BAY_ISLANDS, stubIslandShelter } from './sim/weather/shelter';
import { createSea } from './sim/weather/waves';
import { createWorldState, parseWorldState, type WorldState } from './sim/world-state';

/** Periodic autosave while safe (plan 16 §4.1). */
const AUTOSAVE_INTERVAL_MS = 2 * 60_000;

type SaveStatus = 'created' | 'loaded' | 'recovered' | 'unavailable' | 'error';

interface OpenedRun {
  state: WorldState;
  saver: RunSaver | undefined;
  status: SaveStatus;
}

/** Continue the run in IndexedDB, or start a new one (plan 16 §3, §6.3). */
async function openRun(): Promise<OpenedRun> {
  let db;
  try {
    db = await openSaveDb();
  } catch (err) {
    // Session-only play when IndexedDB is unavailable (plan 16 §8).
    console.warn('IndexedDB unavailable; this run will not be saved', err);
    return {
      state: createWorldState(crypto.randomUUID()),
      saver: undefined,
      status: 'unavailable',
    };
  }

  const encoder = createWorkerEncoder();
  try {
    const loaded = await loadRun(db, parseWorldState);
    if (loaded) {
      const { runId, seed, createdAt, playTimeMs } = loaded.envelope;
      const run = { runId, seed, createdAt, gameVersion: __GAME_VERSION__ };
      return {
        state: loaded.state,
        saver: new RunSaver(db, encoder, run, playTimeMs),
        status: loaded.recovered ? 'recovered' : 'loaded',
      };
    }
  } catch (err) {
    // Never silently delete an unreadable run (plan 16 §6.3); play this session unsaved.
    console.warn('Could not load the saved run', err);
    return { state: createWorldState(crypto.randomUUID()), saver: undefined, status: 'error' };
  }

  const seed = crypto.randomUUID();
  const run = {
    runId: crypto.randomUUID(),
    seed,
    createdAt: new Date().toISOString(),
    gameVersion: __GAME_VERSION__,
  };
  const state = createWorldState(seed);
  const saver = new RunSaver(db, encoder, run);
  await saver.save(state);
  return { state, saver, status: 'created' };
}

/**
 * Dev and playtest URL switches for the weather (plan 02 §14.2): `?weather=gale` picks a
 * preset, `?gale` starts the scripted gale, `?wind=45` sets where it comes from,
 * `?knots=30` its speed, and `?day=1&hour=19.5` the game day and time of day.
 */
function applyWeatherParams(params: URLSearchParams, ctx: GameContext): void {
  const preset = params.get('weather');
  if (preset && preset in WEATHER_PRESETS) ctx.weather.applyPreset(preset as WeatherPresetId);
  const from = Number(params.get('wind'));
  if (params.has('wind') && Number.isFinite(from)) ctx.weather.settings.fromDeg = from;
  const knots = Number(params.get('knots'));
  if (params.has('knots') && Number.isFinite(knots)) ctx.weather.settings.speedKn = knots;
  const clock = ctx.state.environment.clock;
  const now = dayAndHour(clock.gameSeconds);
  const day = params.has('day') ? Number(params.get('day')) : now.day;
  const hour = params.has('hour') ? Number(params.get('hour')) : now.hour;
  if ((params.has('day') || params.has('hour')) && Number.isFinite(day + hour)) {
    clock.gameSeconds = day * SECONDS_PER_GAME_DAY + hour * 3600;
  }
  if (params.has('gale')) ctx.weather.startGale(clock.gameSeconds);
}

async function boot(): Promise<void> {
  const container = document.getElementById('app');
  if (!container) throw new Error('Missing #app container');

  // `?renderer=null` boots without WebGL. CI has no GPU, so its smoke test uses this
  // (plan 01 §9); rendering is checked locally.
  const params = new URLSearchParams(window.location.search);
  const rendererKind = params.get('renderer');
  document.body.dataset['renderer'] = rendererKind === 'null' ? 'null' : 'webgl';

  const machine = new ModeMachine();
  machine.onTransition((_, to) => (document.body.dataset['mode'] = to));
  machine.register({ id: 'boot' }).transition('boot');

  const { state, saver, status } = await openRun();
  document.body.dataset['save'] = status;
  if (saver) document.body.dataset['runId'] = saver.run.runId;

  // The Phase 1 test bay: a slice of the real Apostles bake (plan 02 §14.1). Gameplay
  // needs it with or without a renderer; without it the bay is open water.
  const zone: LoadedZone | undefined = await loadZoneTerrain(
    httpBytes(new URL(TEST_BAY.path, document.baseURI)),
    TEST_BAY.tiles,
  ).catch((err: unknown) => {
    console.warn('Test bay terrain unavailable; sailing on open water', err);
    return undefined;
  });
  document.body.dataset['terrain'] = zone ? 'loaded' : 'unavailable';

  const input = new InputMapper();
  input.attach(window);
  const ctx: GameContext = {
    state,
    world: createGameWorld(),
    rng: Rng.fromState(state.environment.rng),
    input,
    events: new EventBus<GameEvents>(),
    sea: createSea(),
    terrain: zone?.terrain,
    // The baked shelter, fetch and funneling maps of the test bay, or the stub island's
    // lee when the terrain didn't load.
    weather: createLocalWeather(undefined, zone?.terrain ?? stubIslandShelter(TEST_BAY_ISLANDS)),
  };
  applyWeatherParams(params, ctx);

  // The player's T1 schooner on the plan 02 sailing model at the test bay's spawn, in
  // the weather's wind.
  const shipRecord = sailShipRecord(T1_SCHOONER_ID);
  const handling = defaultHandling();
  const { spawn } = TEST_BAY;
  const shipTransform = { position: { x: spawn.x, y: 0, z: spawn.z }, heading: spawn.heading };
  const sailing = {
    cls: compileSailingClass(shipRecord, handling),
    state: createSailingState(spawn.x, spawn.z, spawn.heading),
  };
  ctx.world.add({
    id: 'ship.player',
    transform: shipTransform,
    previousTransform: cloneTransform(shipTransform),
    buoyancy: createBuoyancy(shipRecord.buoyancy),
    sailing,
    model: 'schooner',
    playerControlled: true,
  });

  const saveControls: SaveControls = {
    status,
    lastSavedAt: undefined,
    lastError: undefined,
    async saveNow(): Promise<void> {
      if (!saver) return;
      state.environment.rng = ctx.rng.getState();
      try {
        await saver.save(state);
        saveControls.lastSavedAt = new Date();
        saveControls.lastError = undefined;
      } catch (err) {
        saveControls.lastError = String(err);
        console.error('Autosave failed', err);
      }
    },
  };
  const saveNow = (): void => void saveControls.saveNow();

  let view: SailingView | undefined;
  if (rendererKind !== 'null') {
    const assets = await loadAssets().catch((err: unknown) => {
      console.warn('Asset manifest unavailable; using placeholders', err);
      return new AssetLoader({ manifest: EMPTY_MANIFEST, baseUrl: document.baseURI, decoders: {} });
    });
    const renderer = new GameRenderer(
      container,
      initialQuality(window.location.search, browserStorage()),
    );
    const scene = await createTestScene(
      renderer,
      ctx.world,
      ctx.sea,
      assets,
      ctx.weather,
      state.environment.clock,
      zone,
      TEST_BAY_ISLANDS,
    );
    view = scene;

    // Dev overlay: dev builds, or `?debug` / `?bench=water` on a production build.
    const bench = params.get('bench') === 'water';
    if (import.meta.env.DEV || params.has('debug') || bench) {
      const { createDevOverlay } = await import('./debug/overlay');
      const overlay = createDevOverlay({
        renderer,
        scene,
        weather: ctx.weather,
        clock: state.environment.clock,
        save: saveControls,
        autoBench: bench,
        probe: () => shipTransform.position,
      });
      const { createSailingPanel } = await import('./debug/sailing-panel');
      const panel = createSailingPanel({
        gui: overlay.gui,
        ship: sailing,
        record: shipRecord,
        handling,
      });
      view = {
        render(alpha, seaTime, frameSeconds) {
          scene.render(alpha, seaTime, frameSeconds);
          overlay.update(frameSeconds);
          panel.update();
        },
      };
    }
  }

  machine.register({ id: 'mainMenu', enter: () => (input.context = 'menu') }).register(
    createSailingMode(ctx, {
      view,
      wind: (x, z) => ctx.weather.windAt({ x, z }, state.environment.clock.gameSeconds),
    }),
  );
  // Phase 0 has no danger states yet, so every moment is safe to save (plan 16 §4.2).
  window.setInterval(saveNow, AUTOSAVE_INTERVAL_MS);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') saveNow();
  });
  window.addEventListener('pagehide', saveNow);

  const loop = createLoop({
    tick(dt) {
      machine.update(dt);
      input.endTick();
    },
    frame(alpha, frameSeconds) {
      machine.render(alpha, frameSeconds);
    },
  });

  // No menu UI yet: go straight through the main menu into the saved run.
  machine.transition('mainMenu');
  machine.transition('sailing');
  loop.start();
}

boot().catch((err: unknown) => {
  console.error(err);
  document.body.dataset['boot'] = 'failed';
});
