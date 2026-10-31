import { Vector3 } from 'three';
import { zoneToChart } from './core/coords';
import { SECONDS_PER_GAME_DAY, dayAndHour, parseTimeWarp } from './core/time';
import { EventBus } from './core/events';
import { DEFAULT_BINDINGS, InputMapper, type InputContext } from './core/input';
import { createLoop } from './core/loop';
import { Rng } from './core/rng';
import { openSaveDb } from './core/save/db';
import {
  SettingsStore,
  applyBindingOverrides,
  databaseBackend,
  storageBackend,
  withFallback,
  type Settings,
} from './core/settings';
import { createWorkerEncoder } from './core/save/encoder';
import { loadRun } from './core/save/load';
import { RunSaver } from './core/save/run-saver';
import { AssetLoader, EMPTY_MANIFEST } from './core/assets';
import { createGameAudio, type GameAudio } from './audio/game-audio';
import type { SignalStation } from './audio/world-audio';
import { cloneTransform, createGameWorld } from './gameplay/ecs';
import { createSchooner } from './gameplay/schooner';
import type { SaveControls } from './debug/overlay';
import type { GameContext, GameEvents } from './modes/context';
import { ModeMachine } from './modes/machine';
import { createSailingMode, type SailingView } from './modes/sailing';
import { loadAssets } from './render/assets';
import { browserStorage, isQualityId } from './render/quality';
import { GameRenderer } from './render/renderer';
import { createTestScene } from './render/test-scene';
import { createSailingState } from './sim/sailing/controller';
import { createHazardState, mooringBerths } from './sim/sailing/hazards';
import { httpBytes, loadZoneTerrain, type LoadedZone } from './sim/terrain/load';
import { TEST_BAY, type Dock, type Pose } from './sim/terrain/test-bay';
import { layoutHarbors } from './sim/harbors';
import { LIGHTHOUSES, placeLights, viewingSpot } from './sim/lighthouses';
import { ZoneManager } from './sim/terrain/zone-manager';
import {
  defFrame,
  entryPose,
  findEntry,
  findZoneDef,
  manifestFrame,
  ZONE_DEFS,
  spawnPose,
  zoneDef,
} from './sim/terrain/zones';
import { recordZonePose, resolveStart, type StartPlace } from './sim/location';
import {
  WEATHER_PRESETS,
  createLocalWeather,
  type WeatherPresetId,
} from './sim/weather/local-weather';
import { TEST_BAY_ISLANDS, stubIslandShelter } from './sim/weather/shelter';
import { advanceWeather, placeFogBank } from './sim/weather/weather';
import { createSea } from './sim/weather/waves';
import { createWorldState, parseWorldState, type WorldState } from './sim/world-state';
import type { ZoneDef } from '../data/schemas/zones';
import { anchorRefusedNotice, dockRefusedNotice, NOTICE_S, sampleHud } from './ui/hud/model';
import { loadingScreen, type Arrival } from './ui/loading/model';
import { mountGameUi } from './ui/mount';

/** Periodic autosave while safe (plan 16 §4.1). */
const AUTOSAVE_INTERVAL_MS = 2 * 60_000;

/** The fog fade's length (ui/theme.css `.loading`), so a zone swaps out of sight. */
const FADE_MS = 650;

/** HUD numbers update at most this often (plan 13 §10). */
const HUD_INTERVAL_S = 0.1;

/** A pose for the page's data attributes, which the e2e tests read. */
function poseText(p: Pose): string {
  return `${p.x.toFixed(2)},${p.z.toFixed(2)},${p.heading.toFixed(4)}`;
}

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

  // `?seed=abc` starts a new run from that seed, so the same weather can be revisited.
  const seed = new URLSearchParams(window.location.search).get('seed') ?? crypto.randomUUID();
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
 * Settings live in the `settings` store (plan 16 §2), with localStorage as the fallback
 * and the source of the Phase 0 quality pick until the first save.
 */
async function loadSettings(): Promise<SettingsStore> {
  const local = storageBackend(browserStorage());
  try {
    const db = await openSaveDb();
    return await SettingsStore.load(withFallback(databaseBackend(db), local));
  } catch {
    return SettingsStore.load(local);
  }
}

/**
 * Dev and playtest URL switches for the weather (plan 02 §14.2): `?weather=gale` picks a
 * panel preset over the sim, `?gale` starts the scripted gale, `?wind=45` sets where it
 * comes from, `?knots=30` its speed, `?rain=0.8` the rain, `?storm=1` a thunderstorm (with
 * rain), `?fog=800` the visibility in meters, `?cloud=0.9` the cover, and `?day=1&hour=19.5`
 * the game day and time of day. Any of the wind and sky switches takes the weather off the
 * sim (plan 04 §24).
 */
function applyWeatherParams(params: URLSearchParams, ctx: GameContext): void {
  const preset = params.get('weather');
  if (preset && preset in WEATHER_PRESETS) ctx.weather.applyPreset(preset as WeatherPresetId);
  const from = Number(params.get('wind'));
  if (params.has('wind') && Number.isFinite(from)) {
    ctx.weather.override();
    ctx.weather.settings.fromDeg = from;
  }
  const knots = Number(params.get('knots'));
  if (params.has('knots') && Number.isFinite(knots)) {
    ctx.weather.override();
    ctx.weather.settings.speedKn = knots;
  }
  const sky: [string, 'rain01' | 'storm01' | 'visibilityM' | 'cloud01'][] = [
    ['rain', 'rain01'],
    ['storm', 'storm01'],
    ['fog', 'visibilityM'],
    ['cloud', 'cloud01'],
  ];
  for (const [name, key] of sky) {
    const value = Number(params.get(name));
    if (!params.has(name) || !Number.isFinite(value)) continue;
    ctx.weather.override();
    ctx.weather.settings[key] = value;
    // A storm without rain isn't one: give it a downpour and a dark sky unless told otherwise.
    if (key === 'storm01' && value > 0) {
      if (!params.has('rain'))
        ctx.weather.settings.rain01 = Math.max(ctx.weather.settings.rain01, 0.7);
      if (!params.has('cloud'))
        ctx.weather.settings.cloud01 = Math.max(ctx.weather.settings.cloud01, 0.9);
    }
  }
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
  // `?timewarp=60` runs the clock and weather 60× for the playtest (a game day a minute).
  const timeWarp = { factor: parseTimeWarp(params.get('timewarp')) };

  const machine = new ModeMachine();
  machine.onTransition((_, to) => (document.body.dataset['mode'] = to));
  machine.register({ id: 'boot' }).transition('boot');

  const [{ state, saver, status }, settings] = await Promise.all([openRun(), loadSettings()]);
  document.body.dataset['save'] = status;
  if (saver) document.body.dataset['runId'] = saver.run.runId;

  // Zones load by id (Phase 3 piece A; data/zones.json), one resident at a time, the last
  // one cached for a minute. Gameplay needs the zone with or without a renderer; without
  // its files the zone is open water.
  const zones = new ZoneManager({
    load: (id) => loadZoneTerrain(httpBytes(new URL(zoneDef(id).world, document.baseURI))),
    onFree: (id) => console.info(`Zone ${id} freed`),
  });
  window.setInterval(() => zones.sweep(), 1000);
  const loadZone = (id: string): Promise<LoadedZone | undefined> =>
    zones.enter(id).catch((err: unknown) => {
      console.warn(`Zone ${id} terrain unavailable; sailing on open water`, err);
      return undefined;
    });

  // Continue puts the ship back where the run was saved. `?zone=zone.apostles` starts in
  // that zone instead and `?entry=west` at one of its entry points, for checks.
  let start: StartPlace = resolveStart(state.player.location);
  const zoneParam = params.get('zone');
  const paramDef = zoneParam ? findZoneDef(zoneParam) : undefined;
  if (paramDef && paramDef.id !== start.zoneId) {
    start = { zoneId: paramDef.id, pose: spawnPose(paramDef), from: 'spawn' };
  }
  const entryParam = params.get('entry');
  const paramEntry = entryParam ? findEntry(zoneDef(start.zoneId), entryParam) : undefined;
  if (paramEntry) start = { ...start, pose: entryPose(paramEntry), from: 'entry' };
  let zoneData: ZoneDef = zoneDef(start.zoneId);
  let zone: LoadedZone | undefined = await loadZone(zoneData.id);
  document.body.dataset['terrain'] = zone ? 'loaded' : 'unavailable';
  document.body.dataset['zone'] = zoneData.id;
  document.body.dataset['start'] = start.from;

  // The sim samples the weather in the zone's frame; a zone change moves it.
  const zoneFrame = (z: LoadedZone | undefined, def: ZoneDef) =>
    z ? manifestFrame(z.manifest) : defFrame(def);
  const weatherSource = { state: state.environment.weather, frame: zoneFrame(zone, zoneData) };
  const input = new InputMapper(applyBindingOverrides(DEFAULT_BINDINGS, settings.value.bindings));
  input.attach(window);
  const ctx: GameContext = {
    state,
    world: createGameWorld(),
    rng: Rng.fromState(state.environment.rng),
    input,
    events: new EventBus<GameEvents>(),
    sea: createSea(),
    terrain: zone?.terrain,
    // The S9 sim's wind over the baked shelter, fetch and funneling maps of the test bay,
    // or the stub island's lee when the terrain didn't load.
    weather: createLocalWeather(
      undefined,
      zone?.terrain ?? stubIslandShelter(TEST_BAY_ISLANDS),
      undefined,
      weatherSource,
    ),
  };
  applyWeatherParams(params, ctx);

  // The player's T1 schooner on the plan 02 sailing model where the run left it (or at
  // the zone's spawn), in the weather's wind.
  // `?spawn=x,z,heading` (zone meters, degrees) starts elsewhere in the zone, for checks.
  const spawn: Pose = { ...start.pose };
  const [sx, sz, sh] = (params.get('spawn') ?? '').split(',').map(Number);
  if (Number.isFinite(sx) && Number.isFinite(sz) && params.get('spawn')) {
    spawn.heading = spawnPose(zoneData).heading;
    spawn.x = sx ?? spawn.x;
    spawn.z = sz ?? spawn.z;
    if (Number.isFinite(sh)) spawn.heading = ((sh ?? 0) * Math.PI) / 180;
  }
  // `?harbor=bayfield` (or `ashland`, with `,2` for a pier by its order in data/harbors.json)
  // starts the ship 120 m off that pier's outer end, bow toward it, to try docking.
  let harborLayouts = zone ? layoutHarbors(manifestFrame(zone.manifest), zone.terrain) : [];
  const [harborKey, pierIndex] = (params.get('harbor') ?? '').split(',');
  const harbor = harborKey ? harborLayouts.find((l) => l.def.id.includes(harborKey)) : undefined;
  const pier = harbor?.piers[Number(pierIndex) || 0];
  if (pier) {
    const out = pier.lengthM + 120;
    spawn.x = pier.root.x + Math.sin(pier.bearing) * out;
    spawn.z = pier.root.z - Math.cos(pier.bearing) * out;
    spawn.heading = pier.bearing + Math.PI;
  }
  // `?light=raspberry` (an id fragment, `light.raspberry` or just `raspberry`) spawns the ship
  // in open water with a clear line to that light, looking at it; `?light=outer,1500` sets the distance in
  // meters (default 500), for checking a lighthouse by day and by night.
  const [lightKey, lightDistance] = (params.get('light') ?? '').split(',');
  if (lightKey && zone) {
    const found = placeLights(LIGHTHOUSES, manifestFrame(zone.manifest), zone.terrain).find((p) =>
      p.def.id.includes(lightKey),
    );
    const at = found && viewingSpot(found, zone.terrain, Number(lightDistance) || 500);
    if (at) {
      spawn.x = at.x;
      spawn.z = at.z;
      spawn.heading = at.heading;
    }
  }
  // `?fogbank=2000` stands a fog bank upwind with its wall that many meters away, and turns
  // the ship to face it, so the wind carries it across the water to you (`?fogkind=radiation`
  // for the shallow kind, which barely drifts). A wind of 20 kn or more mixes it out.
  const fogAhead = Number(params.get('fogbank'));
  if (params.has('fogbank') && Number.isFinite(fogAhead) && zone) {
    const frame = manifestFrame(zone.manifest);
    const radiusM = params.get('fogkind') === 'radiation' ? 6_000 : 24_000;
    const wall = (radiusM / frame.compression) * 0.75;
    const state = ctx.weather.sim?.state;
    if (state) {
      // Catch the sim up to now first, or its first tick would age the bank by days (and
      // wind would lift it) before it was ever seen.
      const now = ctx.state.environment.clock.gameSeconds;
      advanceWeather(state, now);
      spawn.heading = ctx.weather.windAt(spawn, now).fromRad;
      const along = fogAhead + wall;
      const centre = {
        x: spawn.x + Math.sin(spawn.heading) * along,
        z: spawn.z - Math.cos(spawn.heading) * along,
      };
      placeFogBank(state, zoneToChart(centre, frame), {
        radiusM,
        kind: params.get('fogkind') === 'radiation' ? 'radiation' : 'advection',
      });
    }
  }
  const schooner = createSchooner(spawn.x, spawn.z, spawn.heading);
  const { record: shipRecord, handling, hazardRules, sailing, hazards } = schooner;
  const shipTransform = { position: { x: spawn.x, y: 0, z: spawn.z }, heading: spawn.heading };
  sailing.state.manualTrim = settings.value.sailing.manualTrim;
  const playerShip = ctx.world.add({
    id: 'ship.player',
    transform: shipTransform,
    previousTransform: cloneTransform(shipTransform),
    buoyancy: schooner.buoyancy,
    sailing,
    hazards,
    model: 'schooner',
    playerControlled: true,
  });

  // Sailing and world audio (plan 15 §11). It loads alongside everything else and starts
  // on the first key or click; without Web Audio the game just runs silent. The lights'
  // fog signals sound from the tops of their towers; gulls gather at the harbors' piers.
  const signalStations = (z: LoadedZone | undefined): SignalStation[] =>
    z
      ? placeLights(LIGHTHOUSES, manifestFrame(z.manifest), z.terrain).flatMap((p) =>
          p.def.fogSignal
            ? [
                {
                  id: p.def.id,
                  name: p.def.name,
                  signal: p.def.fogSignal,
                  at: { x: p.x, y: p.groundM + p.def.tower.heightM, z: p.z },
                },
              ]
            : [],
        )
      : [];
  const stations = signalStations(zone);
  const audio: GameAudio | undefined = await createGameAudio({
    game: ctx,
    target: window,
    storage: browserStorage(),
    stations,
    harbors: harborLayouts.flatMap((l) => l.piers.map((p) => p.root)),
    onState: (s) => (document.body.dataset['audio'] = s),
  }).catch((err: unknown) => {
    console.warn('Audio unavailable; running silent', err);
    document.body.dataset['audio'] = 'unavailable';
    return undefined;
  });
  if (audio) document.body.dataset['audioBank'] = String(audio.bank.size);

  let changingZone = false;
  const shipPose = (): Pose => ({
    x: sailing.state.x,
    z: sailing.state.z,
    heading: sailing.state.heading,
  });
  const saveControls: SaveControls = {
    status,
    lastSavedAt: undefined,
    lastError: undefined,
    async saveNow(): Promise<void> {
      if (!saver) return;
      state.environment.rng = ctx.rng.getState();
      // Where the ship is, so Continue comes back here (Phase 3 piece A). Not mid-load:
      // the location already names the zone being entered.
      if (!changingZone) recordZonePose(state, zoneData.id, shipPose());
      try {
        await saver.save(state);
        const at = state.player.location;
        if (at.mode === 'zone' && at.pose) {
          document.body.dataset['savedPose'] = poseText(at.pose);
        }
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
  let renderer: GameRenderer | undefined;
  let scene: Awaited<ReturnType<typeof createTestScene>> | undefined;
  if (rendererKind !== 'null') {
    const assets = await loadAssets().catch((err: unknown) => {
      console.warn('Asset manifest unavailable; using placeholders', err);
      return new AssetLoader({ manifest: EMPTY_MANIFEST, baseUrl: document.baseURI, decoders: {} });
    });
    // `?quality=low` wins over the saved preset for this session.
    const fromUrl = params.get('quality');
    renderer = new GameRenderer(
      container,
      isQualityId(fromUrl) ? fromUrl : settings.value.graphics.quality,
    );
    renderer.setResolution(settings.value.graphics.resolution);
    scene = await createTestScene(
      renderer,
      ctx.world,
      ctx.sea,
      assets,
      ctx.weather,
      state.environment.clock,
      zone,
      TEST_BAY_ISLANDS,
      zoneData.edge,
    );
    view = scene;

    // Hear from the camera, and thunder after the lightning the sky draws.
    if (audio) {
      const camera = scene.camera;
      const forward = new Vector3();
      audio.setListener(() => {
        camera.getWorldDirection(forward);
        return { at: camera.position, forward };
      });
      scene.atmosphere.lightning.onStrike((s) =>
        audio.world.thunder(s.bearingRad, s.distanceM, s.toWater),
      );
    }

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
        setQuality: (id) => settings.update((s) => (s.graphics.quality = id)),
        timeWarp,
        zones: {
          ids: ZONE_DEFS.map((d) => d.id),
          entries: (id) => zoneDef(id).entries.map((e) => e.id.slice(e.id.lastIndexOf('_') + 1)),
          current: () => zoneData.id,
          enter: (id, entry, fresh) =>
            enterZoneAt(id, entry === 'spawn' ? undefined : entry, fresh),
          stats: () => zones.stats,
          free: () => zones.free(),
        },
      });
      const { createSailingPanel } = await import('./debug/sailing-panel');
      const panel = createSailingPanel({
        gui: overlay.gui,
        ship: sailing,
        record: shipRecord,
        handling,
      });
      const { createAudioPanel } = await import('./debug/audio-panel');
      const audioPanel = audio
        ? createAudioPanel({
            gui: overlay.gui,
            audio,
            depthM: () =>
              zone?.terrain.depthAt(shipTransform.position.x, shipTransform.position.z) ?? 10,
          })
        : undefined;
      const drawn = scene;
      const { createHazardsPanel } = await import('./debug/hazards-panel');
      const hazardsPanel = createHazardsPanel({
        gui: overlay.gui,
        hazards,
        record: shipRecord,
        rules: hazardRules,
        events: ctx.events,
      });
      view = {
        render(alpha, seaTime, frameSeconds) {
          drawn.render(alpha, seaTime, frameSeconds);
          overlay.update(frameSeconds);
          panel.update();
          audioPanel?.update();
          hazardsPanel.update();
        },
      };
    }
  }

  // Settings apply live (plan 13 §11): the renderer, the camera, the keys and the helm.
  const cameraRig = scene?.cameraRig;
  if (cameraRig) cameraRig.spyglassDown = () => input.isDown('Spyglass');
  const applySettings = (s: Settings, previous: Settings | undefined): void => {
    if (renderer && previous && s.graphics.quality !== previous.graphics.quality) {
      if (renderer.setQuality(s.graphics.quality)) ui.setReloadNote(true);
    }
    if (renderer && s.graphics.resolution !== renderer.resolution) {
      renderer.setResolution(s.graphics.resolution);
    }
    if (cameraRig) {
      const { autoRecenter, rollWithShip, sensitivity, spyglassToggle } = s.camera;
      cameraRig.ship.options = { autoRecenter, rollWithShip, sensitivity };
      cameraRig.spyglassToggle = spyglassToggle;
    }
    input.bindings = applyBindingOverrides(DEFAULT_BINDINGS, s.bindings);
    sailing.state.manualTrim = s.sailing.manualTrim;
  };

  // The HUD and the settings screen (plan 13 §12). The menu pauses the tick.
  let contextBeforeMenu: InputContext = 'sailing';
  const uiRoot =
    document.getElementById('ui') ?? document.body.appendChild(document.createElement('div'));
  const ui = mountGameUi({
    root: uiRoot,
    settings,
    audio: audio && {
      settings: audio.mixer.settings,
      setVolume: (id, volume) => audio.setVolume(id, volume),
      setMuted: (muted) => audio.setMuted(muted),
    },
    onMenu(open) {
      if (open) {
        machine.pushOverlay('pause');
        contextBeforeMenu = input.context;
        input.context = 'menu';
      } else {
        machine.popOverlay();
        input.context = contextBeforeMenu;
        // The Esc that closed the menu mustn't reopen it on the next tick.
        input.endTick();
      }
      if (cameraRig) cameraRig.suspended = open;
      document.body.dataset['menu'] = open ? 'open' : 'closed';
    },
  });
  applySettings(settings.value, undefined);
  settings.subscribe(applySettings);
  const draftM = shipRecord.draftEmptyM;
  // The harbors' piers (Phase 2 piece G); the greybox pier only without the zone.
  const zoneDocks = (z: LoadedZone | undefined): readonly Dock[] =>
    z ? harborLayouts.flatMap((l) => l.piers) : TEST_BAY.docks;
  const docks = zoneDocks(zone);
  let hudClock = HUD_INTERVAL_S;

  const sailingOptions = {
    view,
    wind: (x: number, z: number) =>
      ctx.weather.windAt({ x, z }, state.environment.clock.gameSeconds),
    docks,
    berths: mooringBerths(docks, ctx.terrain),
    timeWarp,
  };
  machine
    .register({ id: 'mainMenu', enter: () => (input.context = 'menu') })
    .register(createSailingMode(ctx, sailingOptions));
  // A refused F or anchor order says why on the HUD for a few seconds.
  let notice: { text: string; untilS: number } | undefined;
  let hudSeconds = 0;
  const showNotice = (text: string): void => {
    notice = { text, untilS: hudSeconds + NOTICE_S };
    hudClock = HUD_INTERVAL_S;
  };
  ctx.events.on('DockRefused', (e) => showNotice(dockRefusedNotice(e.reason)));
  ctx.events.on('AnchorRefused', (e) => showNotice(anchorRefusedNotice(e.reason)));
  /**
   * Leaves the zone and enters `id` with the ship at `pose`, behind the fade to fog
   * (Phase 3 piece A, plan 03 §7). Saves on the way out and on arrival (plan 16 §4.1).
   * The chart (piece D) calls this on arrival; for now the dev panel and the console do.
   */
  const enterZone = async (
    id: string,
    pose: Pose,
    arrival: Arrival,
    fresh = false,
  ): Promise<void> => {
    if (changingZone) return;
    const def = zoneDef(id);
    const leaving = zoneData.id;
    await saveControls.saveNow();
    changingZone = true;
    machine.pushOverlay('loading');
    const inputBefore = input.context;
    input.context = 'menu';
    ui.setLoading(loadingScreen(def.name, arrival));
    document.body.dataset['zoneLoad'] = 'loading';
    const startedAt = performance.now();
    try {
      await new Promise((resolve) => window.setTimeout(resolve, FADE_MS));
      ctx.events.emit('ZoneExited', { zoneId: leaving });
      // The old zone's meshes go first, then its data to the cache.
      scene?.setZone(undefined);
      zones.leave();
      // `fresh` skips the cache, for the dev panel's heap round trip.
      if (fresh) zones.free();
      zone = await loadZone(id);
      zoneData = def;

      // Everything that reads the zone follows it: terrain, weather, docks, audio, HUD.
      ctx.terrain = zone?.terrain;
      ctx.weather.shelter = zone?.terrain ?? stubIslandShelter(TEST_BAY_ISLANDS);
      ctx.weather.invalidate();
      weatherSource.frame = zoneFrame(zone, def);
      harborLayouts = zone ? layoutHarbors(manifestFrame(zone.manifest), zone.terrain) : [];
      const nextDocks = zoneDocks(zone);
      sailingOptions.docks = nextDocks;
      sailingOptions.berths = mooringBerths(nextDocks, ctx.terrain);
      audio?.setZone({
        stations: signalStations(zone),
        harbors: harborLayouts.flatMap((l) => l.piers.map((p) => p.root)),
      });
      placeShip(pose);
      scene?.setZone(zone, def.edge);
      document.body.dataset['terrain'] = zone ? 'loaded' : 'unavailable';
      document.body.dataset['zone'] = def.id;
    } finally {
      changingZone = false;
    }
    recordZonePose(state, def.id, pose);
    await saveControls.saveNow();
    ctx.events.emit('ZoneEntered', {
      zoneId: def.id,
      from: arrival.kind === 'entry' ? 'entry' : 'dev',
    });
    const loadMs = performance.now() - startedAt;
    console.info(`Zone ${def.id} entered in ${(loadMs / 1000).toFixed(1)} s`, zones.stats);
    document.body.dataset['zoneLoad'] = 'done';
    document.body.dataset['zoneLoadMs'] = String(Math.round(loadMs));
    ui.setLoading(undefined);
    input.context = inputBefore;
    input.endTick();
    machine.removeOverlay('loading');
  };

  /** Puts the ship at a pose with way off, sails as they were, anchor up and free. */
  const placeShip = (pose: Pose): void => {
    const { manualTrim, sailSetting, sailLevel, trim } = sailing.state;
    Object.assign(sailing.state, createSailingState(pose.x, pose.z, pose.heading), {
      manualTrim,
      sailSetting,
      sailLevel,
      trim,
    });
    // Damage and cargo come along; the mooring, the anchor and any grounding don't.
    const { hull, rigging, cargo01 } = hazards.state;
    Object.assign(hazards.state, createHazardState(hazards.cls), { hull, rigging, cargo01 });
    shipTransform.position.x = pose.x;
    shipTransform.position.z = pose.z;
    shipTransform.heading = pose.heading;
    playerShip.previousTransform = cloneTransform(shipTransform);
  };

  /** Enters a zone at one of its entry points, or at its spawn without one. */
  const enterZoneAt = (id: string, entry?: string, fresh = false): Promise<void> => {
    const def = zoneDef(id);
    const at = entry ? findEntry(def, entry) : undefined;
    if (entry && !at) throw new Error(`No entry ${entry} in ${id}`);
    return enterZone(
      id,
      at ? entryPose(at) : spawnPose(def),
      at ? { kind: 'entry', entryName: at.name } : { kind: 'return' },
      fresh,
    );
  };
  // For checks from the console and the e2e tests: `__glpZones.enter('zone.apostles', 'north')`.
  if (import.meta.env.DEV || params.has('debug')) {
    const hook = { stats: () => zones.stats, enter: enterZoneAt };
    (window as unknown as { __glpZones: typeof hook }).__glpZones = hook;
  }

  // Phase 0 has no danger states yet, so every moment is safe to save (plan 16 §4.2).
  window.setInterval(saveNow, AUTOSAVE_INTERVAL_MS);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') saveNow();
  });
  window.addEventListener('pagehide', saveNow);

  const loop = createLoop({
    tick(dt) {
      machine.update(dt);
      if (input.context === 'sailing' && input.pressed('Pause')) ui.openMenu();
      input.endTick();
    },
    frame(alpha, frameSeconds) {
      machine.render(alpha, frameSeconds);
      audio?.update(frameSeconds, machine.mode);
      ui.setSpyglass(cameraRig?.ship.spyglass ?? false);
      hudClock += frameSeconds;
      hudSeconds += frameSeconds;
      if (notice && hudSeconds > notice.untilS) {
        notice = undefined;
        hudClock = HUD_INTERVAL_S;
      }
      if (hudClock >= HUD_INTERVAL_S) {
        hudClock = 0;
        ui.setHud(
          sampleHud({
            ship: playerShip,
            terrain: ctx.terrain,
            gameSeconds: state.environment.clock.gameSeconds,
            draftM,
            barometer: ctx.weather.barometerAt(state.environment.clock.gameSeconds),
            edge: zoneData.edge,
            notice: notice?.text,
          }),
        );
      }
    },
  });

  // No menu UI yet: go straight through the main menu into the saved run.
  machine.transition('mainMenu');
  machine.transition('sailing');
  document.body.dataset['startPose'] = poseText(spawn);
  ctx.events.emit('ZoneEntered', { zoneId: zoneData.id, from: start.from });
  loop.start();
}

boot().catch((err: unknown) => {
  console.error(err);
  document.body.dataset['boot'] = 'failed';
});
