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
import { npcParade } from './gameplay/npc-ships';
import { attachEconomy } from './gameplay/economy';
import { attachPorts, type PortControl } from './gameplay/port';
import { attachStash, type StashControl } from './gameplay/stash';
import { siteDef } from './sim/hideouts/stash';
import { attachTraffic, HAIL_RANGE_M, LOOK_RANGE_M, type TrafficZone } from './gameplay/traffic';
import { createContacts, type Contact } from './sim/chart/traffic';
import { portInfo } from './sim/economy/defs';
import { pierSideKey, sideOfBerth } from './sim/traffic/berths';
import { clearArena, materializeArena, type ArenaPlay } from './gameplay/arena';
import {
  ARENA_BOUNDS,
  ARENA_HALF_M,
  arenaStatus,
  FOG_WALL_AHEAD_M,
  metWeatherFrame,
  layoutArena,
  type ArenaExit,
  type ArenaResult,
} from './sim/arena/arena';
import { coastRuns } from './sim/arena/coast';
import {
  DEV_ARENA_AT_GEO,
  arenaFromChartEncounter,
  devEncounter,
  isDevEncounter,
  type ArenaEncounter,
} from './sim/arena/encounter';
import { clearArenaCentre, sampleArenaLand } from './sim/arena/land';
import { westernSuperiorChart } from './sim/chart/chart-data';
import { bearing, distance, toWorldChart } from './sim/chart/geography';
import { OPEN_WATER } from './sim/weather/shelter';
import { FULL_SAIL, updateTargetSpeed } from './sim/sailing/controller';
import type { SaveControls } from './debug/overlay';
import type { GameContext, GameEvents } from './modes/context';
import { ModeMachine } from './modes/machine';
import { createSailingMode, type SailingModeOptions, type SailingView } from './modes/sailing';
import { createChartTravel, type ChartTravel } from './modes/chart-travel';
import { loadAssets } from './render/assets';
import { browserStorage, isQualityId } from './render/quality';
import { GameRenderer } from './render/renderer';
import { createTestScene } from './render/test-scene';
import { createSailingState } from './sim/sailing/controller';
import type { ZoneFrame } from './core/coords';
import { createHazardState, mooringBerths, type MooringBerth } from './sim/sailing/hazards';
import { PLAYER_SHIP_IDS } from './sim/sailing/ships';
import { httpBytes, loadZoneTerrain, type LoadedZone } from './sim/terrain/load';
import { TEST_BAY, type Dock, type Pose } from './sim/terrain/test-bay';
import { findHarbor, harborZoneId, layoutHarbors } from './sim/harbors';
import { lightsIn, placeLights, viewingSpot } from './sim/lighthouses';
import { ZoneManager } from './sim/terrain/zone-manager';
import {
  defFrame,
  entryPose,
  findEntry,
  findZoneDef,
  manifestFrame,
  setPieceAt,
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
import { offersChart } from './sim/terrain/zone-edge';
import { arenaLoadingScreen, loadingScreen, type Arrival } from './ui/loading/model';
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
  // `?harbor=duluth` (below) starts in the zone that harbor is in.
  const harborParam = findHarbor((params.get('harbor') ?? '').split(',')[0] ?? '');
  if (!paramDef && params.get('harbor') && harborParam) {
    const id = harborZoneId(harborParam);
    if (id !== start.zoneId) start = { zoneId: id, pose: spawnPose(zoneDef(id)), from: 'spawn' };
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
  // `?harbor=bayfield` (or `ashland`, `washburn`, `la_pointe`, `duluth`, `superior`,
  // `two_harbors`, with `,2` for a pier by its order in data/harbors.json) starts the ship
  // 120 m off that pier's outer end, bow toward it, to try docking. `duluth_canal` and
  // `superior_entry` start off a canal pier's lake end, to sail in between the piers.
  let harborLayouts = zone
    ? layoutHarbors(manifestFrame(zone.manifest), zone.terrain, zone.manifest.zone)
    : [];
  const [harborKey, pierIndex] = (params.get('harbor') ?? '').split(',');
  const harborId = harborKey ? findHarbor(harborKey)?.id : undefined;
  const harbor = harborLayouts.find((l) => l.def.id === harborId);
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
    const found = placeLights(
      lightsIn(zone.manifest.zone),
      manifestFrame(zone.manifest),
      zone.terrain,
    ).find((p) => p.def.id.includes(lightKey));
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
  // `?ship=t2` sails the T2 schooner instead of the T1 (Phase 4 piece G) until the
  // shipyard sells one.
  const shipClass = PLAYER_SHIP_IDS[params.get('ship') ?? ''];
  const schooner = createSchooner(spawn.x, spawn.z, spawn.heading, shipClass);
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

  // Markets drift on the world tick; the hold's load sets the draft (plan 05, piece A).
  const economy = attachEconomy(ctx, hazards);
  // For the console and the e2e tests: `__glpEconomy.prices('port.bayfield')`,
  // `__glpEconomy.buy('port.bayfield', 'good.lumber', 5)`. Players trade on the port screen.
  if (import.meta.env.DEV || params.has('debug')) {
    const hook = {
      ...economy,
      purse: () => ctx.state.player.purse,
      cargo: () => ctx.state.player.cargo,
      load: () => hazards.state.cargo01,
    };
    (window as unknown as { __glpEconomy: typeof hook }).__glpEconomy = hook;
  }

  // The lake's traffic (plan 05 §8, Phase 4 piece D): one set of ships for the chart, the
  // zones and the markets. A stable per-run number from the save (the RNG state moves on
  // as the run plays), so the timetables and manifests are the same after a reload.
  const trafficSeed = `run-${state.environment.weather.noiseSeed}`;
  const traffic = attachTraffic(
    ctx,
    createContacts(
      westernSuperiorChart().projection,
      `${trafficSeed}-traffic`,
      state.environment.clock.gameSeconds,
    ),
  );
  const trafficZone = (z: LoadedZone | undefined): TrafficZone | undefined =>
    z
      ? {
          frame: manifestFrame(z.manifest),
          toWorld: (p) => toWorldChart(westernSuperiorChart(), p),
          terrain: z.terrain,
          harbors: harborLayouts,
        }
      : undefined;
  traffic.setZone(trafficZone(zone));

  // `?npcs` puts one of each NPC class in a line abreast ahead, steaming on (`?npcs=stop`
  // lays them to, `?npcs=meet` heads them toward you), to look at the Phase 3 ships.
  if (params.has('npcs')) {
    const depthAt = (x: number, z: number): number =>
      zone && zone.terrain.contains(x, z) ? zone.terrain.depthAt(x, z) : 100;
    const mode = params.get('npcs');
    const parade = npcParade(spawn, depthAt, mode === 'stop' || mode === 'meet' ? mode : 'ahead');
    for (const e of parade) ctx.world.add(e);
  }

  // Sailing and world audio (plan 15 §11). It loads alongside everything else and starts
  // on the first key or click; without Web Audio the game just runs silent. The lights'
  // fog signals sound from the tops of their towers; gulls gather at the harbors' piers.
  const signalStations = (z: LoadedZone | undefined): SignalStation[] =>
    z
      ? placeLights(lightsIn(z.manifest.zone), manifestFrame(z.manifest), z.terrain).flatMap((p) =>
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
  /** The chart's music and cues on the page, for the e2e tests; written only on a change. */
  const audioCuesToDataset = (a: GameAudio): void => {
    const d = document.body.dataset;
    const chartMusic = a.chartMusic.playing ? 'playing' : 'off';
    if (d['chartMusic'] !== chartMusic) d['chartMusic'] = chartMusic;
    const stinger = a.chartCues.last;
    if (stinger && d['stinger'] !== stinger) d['stinger'] = stinger;
    const fades = String(a.chartCues.transitions);
    if (d['audioFades'] !== fades) d['audioFades'] = fades;
  };

  let changingZone = false;
  // Chart travel (Phase 3 piece D); built once the UI is up.
  const travelRef: { current: ChartTravel | undefined } = { current: undefined };
  /** The open-water arena in play (Phase 3 piece G), if any. */
  let arena: ArenaPlay | undefined;
  /** The ship's pose is in an arena's frame: from entering one until back in a zone. */
  let inArenaSpace = false;
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
      // Where the ship is, so Continue comes back here (Phase 3 piece A): on the chart with
      // the voyage (piece D), including while an arena entered from it is in play, or in the
      // zone. Not mid-load: the location already names the zone being entered. An arena
      // entered from a zone keeps the place recorded on the way in; its frame isn't the zone's.
      if (!changingZone && !travelRef.current?.record(state) && !inArenaSpace)
        recordZonePose(state, zoneData.id, shipPose());
      try {
        await saver.save(state);
        const at = state.player.location;
        document.body.dataset['savedMode'] = at.mode;
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
    // M back off the chart follows M onto it.
    const toggle = input.bindings.sailing.ToggleChart;
    if (toggle) input.bindings.chart = { ...input.bindings.chart, ToggleChart: toggle };
    const journal = input.bindings.sailing.Journal;
    if (journal) input.bindings.chart = { ...input.bindings.chart, Journal: journal };
    sailing.state.manualTrim = s.sailing.manualTrim;
  };

  // The HUD and the settings screen (plan 13 §12). The menu pauses the tick.
  let contextBeforeMenu: InputContext = 'sailing';
  const uiRoot =
    document.getElementById('ui') ?? document.body.appendChild(document.createElement('div'));
  // The port screen and the journal (Phase 4 piece B); attached once the UI is up.
  const portsRef: { current: PortControl | undefined } = { current: undefined };
  // The Stockton stash and lying at anchor (Phase 4 piece E); attached with the ports.
  const stashRef: { current: StashControl | undefined } = { current: undefined };
  const ui = mountGameUi({
    root: uiRoot,
    settings,
    port: {
      buy: (good, qty) => portsRef.current?.actions.buy(good, qty),
      sell: (good, qty) => portsRef.current?.actions.sell(good, qty),
      quote: (good, qty, side) => portsRef.current?.actions.quote(good, qty, side) ?? 0,
      buyStores: (item, qty) => portsRef.current?.actions.buyStores(item, qty),
      close: () => portsRef.current?.close(),
      castOff: () => portsRef.current?.actions.castOff(),
      closeJournal: () => portsRef.current?.closeJournal(),
      openDocked: () => {
        if (machine.mode !== 'sailing' || machine.gameplayPaused) return;
        if (!portsRef.current?.openDocked()) stashRef.current?.openHere();
      },
    },
    stash: {
      stash: (index, qty) => stashRef.current?.actions.stash(index, qty),
      take: (index, qty) => stashRef.current?.actions.take(index, qty),
      stashCash: (cents) => stashRef.current?.actions.stashCash(cents),
      takeCash: (cents) => stashRef.current?.actions.takeCash(cents),
      lie: (until) => stashRef.current?.actions.lie(until),
      close: () => stashRef.current?.actions.close(),
      castOff: () => stashRef.current?.actions.castOff(),
    },
    chart: {
      sail: () => travelRef.current?.setSail(),
      undo: () => travelRef.current?.undo(),
      clear: () => travelRef.current?.clear(),
      heaveTo: () => travelRef.current?.heaveTo(),
      back: () => travelRef.current?.back(),
      answer: (choice) => travelRef.current?.answer(choice),
      dismissNotice: () => travelRef.current?.dismissNotice(),
      setLookout: (pref) => settings.update((s) => (s.chart.lookout = pref)),
      setForecast: (lead) => travelRef.current?.setForecast(lead),
    },
    onTakeToChart: () => {
      if (machine.mode === 'sailing' && !machine.gameplayPaused) travelRef.current?.takeToChart();
    },
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

  // Docking at a port's pier opens its screen; J opens the ledger (Phase 4 piece B). Both
  // pause the tick and take the keys, like the settings screen.
  let contextBeforeScreen: InputContext = 'sailing';
  const ports = attachPorts({
    ctx,
    economy,
    hazards,
    berthPier: (berthId) => sailingOptions.berths.find((b) => b.id === berthId)?.dockId,
    showPort: (snapshot) => ui.setPort(snapshot),
    showJournal: (snapshot) => ui.setJournal(snapshot),
    onOpen(open) {
      if (open) {
        machine.pushOverlay(ports.openPort ? 'trade' : 'journal');
        contextBeforeScreen = input.context;
        input.context = 'menu';
      } else {
        if (!machine.removeOverlay('trade')) machine.removeOverlay('journal');
        input.context = contextBeforeScreen;
        input.endTick();
      }
      if (cameraRig) cameraRig.suspended = open;
      document.body.dataset['port'] = ports.openPort ?? (ports.journalOpen ? 'journal' : 'closed');
      hudClock = HUD_INTERVAL_S;
    },
    castOff: () => input.trigger('Interact'),
  });
  portsRef.current = ports;
  // Alongside the Stockton landing or anchored off it, the stash opens; Z lies at anchor.
  let contextBeforeStash: InputContext = 'sailing';
  const stash = attachStash({
    ctx,
    economy,
    hazards,
    berthPier: (berthId) => sailingOptions.berths.find((b) => b.id === berthId)?.dockId,
    shipPose,
    speedMs: () => sailing.state.speed,
    zone: () =>
      zone && !arena ? { id: zoneData.id, frame: manifestFrame(zone.manifest) } : undefined,
    nearestUnderWayM(p) {
      if (arena) return 0;
      let best = Number.POSITIVE_INFINITY;
      for (const s of traffic.shown.values()) {
        const t = s.entity.transform;
        if (s.berthed || !t) continue;
        best = Math.min(best, Math.hypot(t.position.x - p.x, t.position.z - p.z));
      }
      return best;
    },
    showStash: (snapshot) => ui.setStash(snapshot),
    showLie: (r) => ui.setLie(r === undefined),
    onOpen(open) {
      if (open) {
        machine.pushOverlay('trade');
        contextBeforeStash = input.context;
        input.context = 'menu';
      } else {
        machine.removeOverlay('trade');
        input.context = contextBeforeStash;
        input.endTick();
      }
      if (cameraRig) cameraRig.suspended = open;
      document.body.dataset['stash'] = stash.openHideout ?? (stash.lieOpen ? 'lie' : 'closed');
      hudClock = HUD_INTERVAL_S;
    },
    castOff: () => input.trigger('Interact'),
    afterLie(text) {
      showNotice(text);
      void saveControls.saveNow();
    },
  });
  stashRef.current = stash;
  if (import.meta.env.DEV || params.has('debug')) {
    const hook = {
      /** Opens a hideout's storage wherever the ship is. */
      open: (id = 'hideout.stockton') => stash.open(id),
      close: () => stash.actions.close(),
      here: () => stash.hideoutHere,
      hideouts: () => state.hideouts,
      stash: (index: number, qty: number) => stash.actions.stash(index, qty),
      take: (index: number, qty: number) => stash.actions.take(index, qty),
      stashCash: (cents: number) => stash.actions.stashCash(cents),
      takeCash: (cents: number) => stash.actions.takeCash(cents),
      lie: (until: 'dawn' | 'dusk' | 'wind') => stash.actions.lie(until),
      refusal: () => stash.lieRefusal(),
    };
    (window as unknown as { __glpStash: typeof hook }).__glpStash = hook;
  }
  if (import.meta.env.DEV || params.has('debug')) {
    const hook = {
      /** Opens a port's screen wherever the ship is. */
      open: (port: string) => ports.open(port),
      close: () => ports.close(),
      /** Docks at the first berth of a pier whose id holds `key`, as F would. */
      dock(key: string) {
        const berth = sailingOptions.berths.find((b) => b.dockId.includes(key));
        if (!berth) return false;
        const h = hazards.state;
        h.mooring = 'docking';
        h.berthId = berth.id;
        h.mooringS = 0;
        h.from = { x: sailing.state.x, z: sailing.state.z, heading: sailing.state.heading };
        return true;
      },
      docked: () => ports.dockedPort,
      knowledge: () => state.knowledge.prices,
      stores: () => state.player.stores,
    };
    (window as unknown as { __glpPort: typeof hook }).__glpPort = hook;
  }
  const draftM = shipRecord.draftEmptyM;
  // The harbors' piers (Phase 2 piece G); the greybox pier only without the zone.
  const zoneDocks = (z: LoadedZone | undefined): readonly Dock[] =>
    z ? harborLayouts.flatMap((l) => l.piers) : TEST_BAY.docks;
  const docks = zoneDocks(zone);
  let hudClock = HUD_INTERVAL_S;

  /** Every berth in the zone; the ones on pier sides the traffic holds are withdrawn. */
  let allBerths: readonly MooringBerth[] = mooringBerths(docks, ctx.terrain);
  const freeBerths = (): readonly MooringBerth[] =>
    allBerths.filter((b) => {
      const side = sideOfBerth(b.id);
      return !side || !traffic.takenSides.has(pierSideKey(side.pierId, side.side));
    });
  const sailingOptions: SailingModeOptions & {
    docks: readonly Dock[];
    berths: readonly MooringBerth[];
  } = {
    view,
    wind: (x: number, z: number) =>
      ctx.weather.windAt({ x, z }, state.environment.clock.gameSeconds),
    docks,
    berths: allBerths,
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
  // "Look her over" and hail cards (Phase 4 piece D): up until she's out of hail or a while passes.
  let card: { shipId: string; untilS: number; near: boolean } | undefined;
  const CARD_S = 20;
  /** `near`: the ship is here, and the card goes when she's out of hail. */
  const showCard = (next: ReturnType<typeof traffic.lookOver>, near = true): void => {
    card = { shipId: next.shipId, untilS: hudSeconds + CARD_S, near };
    ui.setShipCard(next);
    document.body.dataset['shipCard'] = next.shipId;
  };
  const cardOutOfHail = (): boolean => {
    if (!card?.near) return false;
    if (machine.mode !== 'sailing') return true;
    const e = [...ctx.world.entities].find((x) => x.id === card?.shipId)?.transform;
    if (!e) return true;
    const p = shipPose();
    return Math.hypot(e.position.x - p.x, e.position.z - p.z) > HAIL_RANGE_M * 1.5;
  };
  /** HUD chips for a ship close by: F to look her over (with no berth to dock at), H to hail. */
  const trafficChips = (): string[] => {
    if (machine.mode !== 'sailing' || hazards.state.mooring !== 'free') return [];
    const near = traffic.nearest(shipPose(), HAIL_RANGE_M);
    if (!near) return [];
    if (!arena && near.distanceM <= LOOK_RANGE_M) return ['F look her over · H hail'];
    return ['H to hail'];
  };
  const hideCard = (): void => {
    card = undefined;
    ui.setShipCard(undefined);
    delete document.body.dataset['shipCard'];
  };
  // In an arena F is "look her over", not a dock order, so its refusal says nothing. In a
  // zone, F with no berth in reach looks over the nearest ship instead.
  ctx.events.on('DockRefused', (e) => {
    if (arena) return;
    const near = e.reason === 'noBerth' ? traffic.nearest(shipPose(), LOOK_RANGE_M) : undefined;
    if (near) showCard(traffic.lookOver(near.id));
    else showNotice(dockRefusedNotice(e.reason));
  });
  // For the console and the e2e tests: `__glpTraffic.shown()`, `__glpTraffic.hail(id)`.
  if (import.meta.env.DEV || params.has('debug')) {
    const hook = {
      contacts: () =>
        traffic.contacts.map((c) => ({
          id: c.id,
          name: c.name,
          classId: c.classId,
          inPort: !!c.inPort,
          underWay: !!c.underWay,
        })),
      shown: () =>
        [...traffic.shown].map(([id, s]) => ({
          id,
          berthed: s.berthed,
          x: s.entity.transform?.position.x ?? 0,
          z: s.entity.transform?.position.z ?? 0,
          heading: s.entity.transform?.heading ?? 0,
        })),
      takenSides: () => [...traffic.takenSides],
      freeBerths: () => sailingOptions.berths.map((b) => b.id),
      manifest: (id: string) => traffic.manifest(id),
      look: (id: string) => {
        const c = traffic.lookOver(id);
        showCard(c);
        return c;
      },
      hail: (id: string) => {
        const c = traffic.hail(id);
        showCard(c);
        return c;
      },
      deliveredTo: () => state.traffic?.deliveredTo,
      /** Puts the ship at (x, z) heading `deg`, e.g. beside a berthed ship. */
      place: (x: number, z: number, deg = 0) => placeShip({ x, z, heading: (deg * Math.PI) / 180 }),
    };
    (window as unknown as { __glpTraffic: typeof hook }).__glpTraffic = hook;
  }
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
    onLoaded?: () => void,
  ): Promise<void> => {
    if (changingZone) return;
    const def = zoneDef(id);
    const leaving = zoneData.id;
    await saveControls.saveNow();
    changingZone = true;
    machine.pushOverlay('loading');
    const inputBefore = input.context;
    const modeBefore = machine.mode;
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
      harborLayouts = zone
        ? layoutHarbors(manifestFrame(zone.manifest), zone.terrain, zone.manifest.zone)
        : [];
      const nextDocks = zoneDocks(zone);
      sailingOptions.docks = nextDocks;
      allBerths = mooringBerths(nextDocks, ctx.terrain);
      traffic.setZone(trafficZone(zone));
      traffic.step(undefined);
      sailingOptions.berths = freeBerths();
      audio?.setZone({
        stations: signalStations(zone),
        harbors: harborLayouts.flatMap((l) => l.piers.map((p) => p.root)),
      });
      placeShip(pose);
      scene?.setZone(zone, def.edge);
      document.body.dataset['terrain'] = zone ? 'loaded' : 'unavailable';
      document.body.dataset['zone'] = def.id;
      // Arriving from the chart: back to the helm under the fog (piece D).
      onLoaded?.();
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
    // A mode change under the fog takes that mode's keys.
    input.context =
      machine.mode === modeBefore ? inputBefore : machine.mode === 'chart' ? 'chart' : 'sailing';
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
  /**
   * Open-water arenas (plan 03 §6.3, Phase 3 piece G). `enterArena` drops the ship into a
   * ~3 × 3 km patch of water at the encounter point, behind the same fade as a zone: no
   * terrain, the sim's weather and sky there, the ships met on their headings, and the
   * coast in view. The arena ends when its rules say so; `arenaHooks.onExit` then takes
   * the ship back to the chart (piece D sets it). Without a chart it returns to the zone
   * the arena was entered from.
   */
  let arenaFrom: { zoneId: string; pose: Pose } | undefined;
  let leavingArena = false;
  const arenaHooks: {
    onExit?: ((exit: ArenaExit) => void | Promise<void>) | undefined;
  } = {};
  /** The fade to fog with a logbook line, for an arena's way in. */
  const arenaFade = async (title: string, line: string, work: () => void): Promise<void> => {
    changingZone = true;
    machine.pushOverlay('loading');
    const inputBefore = input.context;
    input.context = 'menu';
    ui.setLoading({ title, line });
    document.body.dataset['zoneLoad'] = 'loading';
    const startedAt = performance.now();
    try {
      await new Promise((resolve) => window.setTimeout(resolve, FADE_MS));
      work();
    } finally {
      changingZone = false;
      ui.setLoading(undefined);
      // work() may have left the chart for the helm; follow the mode, not the context from before.
      input.context =
        machine.mode === 'sailing' ? 'sailing' : machine.mode === 'chart' ? 'chart' : inputBefore;
      input.endTick();
      machine.removeOverlay('loading');
      document.body.dataset['zoneLoad'] = 'done';
      document.body.dataset['zoneLoadMs'] = String(Math.round(performance.now() - startedAt));
    }
  };
  let squallOverride = false;
  const enterArena = async (enc: ArenaEncounter, fromChart = false): Promise<void> => {
    if (changingZone || arena) return;
    // A zone entry (the `?encounter=` checks) returns to that zone. The chart sets its own exit.
    if (!fromChart) arenaHooks.onExit = undefined;
    // The run's last place is saved on the way in; nothing is saved inside the arena frame.
    await saveControls.saveNow();
    arenaFrom = { zoneId: zoneData.id, pose: shipPose() };
    const geo = westernSuperiorChart();
    const screen = arenaLoadingScreen(enc);
    await arenaFade(screen.title, screen.line, () => {
      ctx.events.emit('ZoneExited', { zoneId: zoneData.id });
      scene?.setZone(undefined);
      zones.leave();
      zone = undefined;
      ctx.terrain = undefined;
      harborLayouts = [];
      sailingOptions.docks = [];
      allBerths = [];
      sailingOptions.berths = [];
      traffic.setZone(undefined);
      audio?.setZone({ stations: [], harbors: [] });

      // The arena sits at the encounter point, nudged off any shore, in its own frame.
      const centre = clearArenaCentre(geo, enc.at, ARENA_HALF_M * 0.6);
      const land = sampleArenaLand(geo, { origin: centre, compression: 8 }, ARENA_HALF_M + 400);
      const layout = layoutArena(enc, centre, land);
      // The sim runs in the lake-wide chart frame, not the chart geography's.
      // A squall or fog bank met on the chart is the sim's own: read it where it stands.
      const weatherFrame = metWeatherFrame(geo, enc, layout);
      weatherSource.frame = weatherFrame;
      ctx.weather.shelter = OPEN_WATER;
      ctx.weather.invalidate();
      const now = state.environment.clock.gameSeconds;
      const wind = ctx.weather.windAt(layout.player, now);
      if (enc.kind === 'squall' && !enc.weather && ctx.weather.source === 'sim') {
        // A `?encounter=squall` check has no squall in the sim to meet: blow one up here.
        ctx.weather.override();
        Object.assign(ctx.weather.settings, {
          speedKn: Math.max(ctx.weather.settings.speedKn, 30),
          rain01: 0.9,
          storm01: 0.7,
          cloud01: 1,
          visibilityM: 1200,
        });
        squallOverride = true;
      }
      if (enc.kind === 'fogbank' && !enc.weather) {
        standFogBank(layout.player, FOG_WALL_AHEAD_M, weatherFrame);
      }

      placeShip(layout.player);
      // Arrive as she sailed the chart: everything set and making way.
      const s = sailing.state;
      s.sailLevel = s.sailSetting = FULL_SAIL;
      const sw = { fromRad: wind.fromRad, speedKn: wind.speedKn, gust01: 0 };
      s.speed = Math.max(updateTargetSpeed(s, sailing.cls, sw, 0), 0);

      inArenaSpace = true;
      arena = materializeArena(ctx.world, enc, layout, land);
      const play = arena;
      sailingOptions.arena = {
        step: (dt) =>
          play.step(dt, playerShip, {
            lookHeld: input.isDown('Interact'),
            chartPressed: input.pressed('ToggleChart'),
          }),
        holdBounds: () => play.holdBounds(),
      };
      scene?.setArena({
        coast: coastRuns(geo, layout.frame),
        bounds: ARENA_BOUNDS,
        edge: { fogFadeM: 500, edgeVisibilityM: 700 },
      });
      document.body.dataset['zone'] = 'arena';
      document.body.dataset['terrain'] = 'arena';
      document.body.dataset['arena'] = enc.kind;
      document.body.dataset['arenaShips'] = String(play.ships.length);
      delete document.body.dataset['arenaResult'];
      // Off the chart and onto the helm, under the fade (piece D).
      if (fromChart && machine.mode === 'chart') machine.transition('sailing');
    });
    const entered = arena as ArenaPlay | undefined;
    ctx.events.emit('ArenaEntered', {
      contactId: enc.contactId,
      kind: enc.kind,
      ships: entered?.ships.length ?? 0,
    });
  };

  /**
   * Stands a fog bank across the bow with its wall `wallM` ahead, for the `?encounter=fogbank`
   * check (a bank met on the chart is the sim's own, `metWeatherFrame`). The sim drifts it on
   * the wind, and a wind of 20 kn or more mixes it out, as it would any bank.
   */
  const standFogBank = (at: Pose, wallM: number, frame: ZoneFrame): void => {
    const sim = ctx.weather.sim?.state;
    if (!sim) return;
    advanceWeather(sim, state.environment.clock.gameSeconds);
    const radiusM = 24_000;
    const along = wallM + (radiusM / frame.compression) * 0.75;
    const c = { x: at.x + Math.sin(at.heading) * along, z: at.z - Math.cos(at.heading) * along };
    placeFogBank(sim, zoneToChart(c, frame), { radiusM, kind: 'advection' });
  };

  const leaveArena = (result: ArenaResult): void => {
    const play = arena;
    if (!play || leavingArena) return;
    leavingArena = true;
    const exit: ArenaExit = {
      contactId: play.encounter.contactId,
      result,
      at: play.encounter.at,
      elapsedS: play.run.elapsedS,
    };
    // Looked her over: her papers, before her entity goes.
    const looked = play.ships.find((s) => !s.entity.npc?.derelict)?.entity.id;
    if (result === 'resolved' && looked && play.encounter.kind !== 'squall') {
      showCard(traffic.lookOver(looked), false);
    }
    clearArena(ctx.world, play);
    sailingOptions.arena = undefined;
    scene?.setArena(undefined);
    if (squallOverride) {
      ctx.weather.useSim();
      squallOverride = false;
    }
    arena = undefined;
    document.body.dataset['arenaResult'] = result;
    delete document.body.dataset['arena'];
    ctx.events.emit('ArenaExited', {
      contactId: exit.contactId,
      result,
      elapsedS: exit.elapsedS,
    });
    const from = arenaFrom;
    arenaFrom = undefined;
    const back = (): void => {
      inArenaSpace = false;
      leavingArena = false;
    };
    if (arenaHooks.onExit) {
      // The chart takes over (piece D): it reloads the zone and resumes the voyage.
      // inArenaSpace stays set until that load finishes, so the arena pose isn't saved.
      void Promise.resolve(arenaHooks.onExit(exit)).finally(back);
    } else if (from) {
      // Entered from a zone (`?encounter=`, or the chart didn't claim the exit): back there.
      // The save on the way out skips the arena's pose; the zone's arrival records its own.
      void enterZone(from.zoneId, from.pose, { kind: 'return' }).finally(back);
    } else {
      back();
    }
  };
  // For checks from the console and the e2e tests: `__glpZones.enter('zone.apostles', 'north')`.
  if (import.meta.env.DEV || params.has('debug')) {
    const hook = { stats: () => zones.stats, enter: enterZoneAt };
    (window as unknown as { __glpZones: typeof hook }).__glpZones = hook;
    // `__glpArena.enter('cutter')` drops into an arena, `__glpArena.state()` reads it.
    const arenaHook = {
      enter: (id: string, hunting = false) => {
        if (!isDevEncounter(id)) throw new Error(`No dev encounter ${id}`);
        const geo = westernSuperiorChart();
        return enterArena(
          devEncounter(
            id,
            geo.projection.geoToChart(DEV_ARENA_AT_GEO),
            shipPose().heading,
            hunting,
          ),
        );
      },
      state: () =>
        arena && {
          kind: arena.encounter.kind,
          run: { ...arena.run, encounter: undefined },
          ships: arena.ships.map(({ entity, steer }) => ({
            id: entity.id,
            x: steer.x,
            z: steer.z,
            heading: steer.heading,
            speedKn: steer.helm.speedKn,
            state: steer.helm.state,
          })),
          player: shipPose(),
        },
      /** Puts the ship at (x, z) in the arena, keeping her heading, e.g. past the edge. */
      place: (x: number, z: number) => {
        if (arena) placeShip({ x, z, heading: shipPose().heading });
      },
      hooks: arenaHooks,
    };
    (window as unknown as { __glpArena: typeof arenaHook }).__glpArena = arenaHook;
  }

  // Chart travel (Phase 3 piece D, plan 03 §5): M opens the chart, and at the soft edge it
  // takes the ship onto it; a course into another zone loads that zone at its entry.
  const chartLayer = document.body.appendChild(document.createElement('div'));
  chartLayer.className = 'chart-layer';
  /** A hostile has the ship detected (piece G's arena sets this; dev hook for now). */
  let pursued = false;
  const chartTravel = createChartTravel({
    ctx,
    machine,
    layer: chartLayer,
    setHud: (snapshot) => ui.setChart(snapshot),
    lookout: () => settings.value.chart.lookout,
    zone: () => ({ def: zoneData, frame: zoneFrame(zone, zoneData) }),
    shipPose,
    placeShip,
    enterZone: (id, pose, arrival, onLoaded) => enterZone(id, pose, arrival, false, onLoaded),
    save: () => saveControls.saveNow(),
    pursued: () => pursued || !!arena?.run.pursued,
    // Engage, or a failed avoid, meets them here; leaving reloads the zone and resumes the voyage.
    enterArena: (enc, travel) => {
      const zoneId = zoneData.id;
      const pose = { ...shipPose() };
      arenaHooks.onExit = (exit) =>
        enterZone(zoneId, pose, { kind: 'return' }, false, () => {
          travel.resumeFrom(exit.contactId, exit.result);
        });
      // A hostile that forced the meeting hunts you in the arena; one you chose to close
      // with stands on. (Until Phase 5's Wanted the cutter forces nothing unless ?cutter=hunt.)
      void enterArena(
        arenaFromChartEncounter(enc, travel.session.position, travel.session.heading, {
          hunting: enc.forced && enc.contact.hostile,
          company: travel.session.contacts,
        }),
        true,
      );
    },
    // A stable per-run number from the save (the RNG state moves on as the run plays), so
    // the traffic's timetables are the same after a reload.
    seed: trafficSeed,
    contacts: traffic.contacts as Contact[],
    cutterHunts: params.get('cutter') === 'hunt',
  });
  travelRef.current = chartTravel;
  machine.register(chartTravel.mode);
  /** Is the ship inside a harbor set piece, where the chart can't be opened? */
  const inHarbor = (): boolean =>
    !!setPieceAt(zoneData, zoneFrame(zone, zoneData), {
      x: sailing.state.x,
      z: sailing.state.z,
    });
  const atEdge = (): boolean =>
    !!ctx.terrain &&
    offersChart(ctx.terrain.bounds, zoneData.edge, sailing.state.x, sailing.state.z) &&
    // Zones that offer it well inside the edge do so only clear of the harbor, with the
    // open lake ahead (the Twin Ports and Two Harbors, data/zones.json `chartFromM`).
    (zoneData.edge.chartFromM === undefined || chartTravel.openToLake(ctx.terrain.bounds));
  machine.onTransition((_, to) => {
    if (to !== 'chart') ui.setChart(undefined);
    hudClock = HUD_INTERVAL_S;
  });
  if (import.meta.env.DEV || params.has('debug')) {
    const hook = {
      travel: chartTravel,
      /** Lay a course through [lat, lon] points. */
      plot(points: [number, number][]) {
        const { session } = chartTravel;
        session.waypoints = points.map(([lat, lon]) =>
          session.geo.projection.geoToChart({ lat, lon }),
        );
        chartTravel.chart.replot();
        return session.course?.problem ?? 'ok';
      },
      setSail: () => chartTravel.setSail(),
      /** Real seconds per game hour under way, to hurry a check along. */
      secondsPerHour(s: number) {
        chartTravel.session.timeScale = 3600 / s;
      },
      setPursued(on: boolean) {
        pursued = on;
      },
      /**
       * The lookouts report the nearest contact of a kind, as if just sighted; `forced`
       * makes it a hostile closing that can't be avoided. For the arena checks.
       */
      meet(kind: string, forced = false) {
        const { session } = chartTravel;
        // Nearest on the water; one lying in port only if none of that kind is out.
        const near = session.contacts
          .filter((c) => c.kind === kind)
          .sort(
            (a, b) =>
              Number(!!a.inPort) - Number(!!b.inPort) ||
              distance(a.pos, session.position) - distance(b.pos, session.position),
          )[0];
        if (!near) return undefined;
        session.pending = {
          contact: near,
          forced,
          distanceM: distance(near.pos, session.position),
          bearing: bearing(session.position, near.pos),
          ...(near.hostile ? { hunts: forced } : {}),
        };
        ctx.events.emit('EncounterSpotted', {
          contactId: near.id,
          forced,
          kind: near.kind,
          hostile: near.hostile,
        });
        return near.id;
      },
    };
    (window as unknown as { __glpChart: typeof hook }).__glpChart = hook;
  }

  // Phase 0 has no danger states yet, so every moment is safe to save (plan 16 §4.2).
  window.setInterval(saveNow, AUTOSAVE_INTERVAL_MS);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') saveNow();
  });
  window.addEventListener('pagehide', saveNow);

  /** The stash's name for the HUD's P button while moored there (piece E). */
  const stashHereName = (): string | undefined => {
    const id = stash.hideoutHere;
    const site = id ? state.hideouts?.[id]?.siteId : undefined;
    return site ? siteDef(site)?.shortName : undefined;
  };
  const loop = createLoop({
    tick(dt) {
      // A key that just changed the mode (M off the chart) mustn't act again in the new one.
      const contextBefore = input.context;
      machine.update(dt);
      if (arena?.run.result) leaveArena(arena.run.result);
      // A key that just changed the mode (M off the chart) mustn't act again in the new one.
      // In an arena, M leaves it (the arena reads ToggleChart); it doesn't open the chart.
      const sameContext = input.context === contextBefore;
      if (sameContext && !arena && input.context === 'sailing' && input.pressed('ToggleChart')) {
        const refused = chartTravel.fromHelm({ atEdge: atEdge(), inHarbor: inHarbor() });
        if (refused) showNotice(refused);
      }
      // The traffic sails on the clock: in the zone, every tick (Phase 4 piece D).
      if (machine.mode === 'sailing' && !arena && !changingZone) {
        if (traffic.step(hazards.state.berthId)) sailingOptions.berths = freeBerths();
      }
      if (sameContext && input.context === 'sailing' && input.pressed('Hail')) {
        const near = traffic.nearest(shipPose(), HAIL_RANGE_M);
        if (near) showCard(traffic.hail(near.id));
        else showNotice('No ship within hail');
      }
      const inGame = input.context === 'sailing' || input.context === 'chart';
      if (sameContext && inGame && input.pressed('Pause')) {
        ui.openMenu();
      } else if (sameContext && inGame && input.pressed('Journal')) {
        ports.openJournal();
      } else if (sameContext && !arena && input.context === 'sailing' && input.pressed('Port')) {
        if (!ports.openDocked()) stash.openHere();
      } else if (sameContext && input.context === 'sailing' && input.pressed('LieAtAnchor')) {
        const refused = stash.openLie();
        if (refused) showNotice(refused);
      }
      input.endTick();
    },
    frame(alpha, frameSeconds) {
      machine.render(alpha, frameSeconds);
      audio?.update(frameSeconds, machine.mode, machine.hasOverlay('loading'));
      if (audio) audioCuesToDataset(audio);
      ui.setSpyglass(cameraRig?.ship.spyglass ?? false);
      hudClock += frameSeconds;
      hudSeconds += frameSeconds;
      if (notice && hudSeconds > notice.untilS) {
        notice = undefined;
        hudClock = HUD_INTERVAL_S;
      }
      if (card && (hudSeconds > card.untilS || cardOutOfHail())) {
        hideCard();
      }
      if (hudClock >= HUD_INTERVAL_S && machine.mode === 'chart') {
        hudClock = 0;
        ui.setHud(undefined);
        chartTravel.sampleHud();
      } else if (hudClock >= HUD_INTERVAL_S) {
        hudClock = 0;
        ui.setHud(
          sampleHud({
            ship: playerShip,
            terrain: ctx.terrain,
            gameSeconds: state.environment.clock.gameSeconds,
            draftM,
            barometer: ctx.weather.barometerAt(state.environment.clock.gameSeconds),
            edge: arena ? undefined : zoneData.edge,
            notice: notice?.text,
            chartLocked: pursued || !!arena?.run.pursued,
            chartOffered: arena ? false : atEdge(),
            extraStatus: [
              ...(arena ? arenaStatus(arena.run, arena.inputs(playerShip)) : []),
              ...trafficChips(),
            ],
            portName:
              ports.dockedPort && hazards.state.mooring === 'docked' && !ports.openPort
                ? portInfo(ports.dockedPort)?.name
                : stashHereName(),
          }),
        );
      }
    },
  });

  // No menu UI yet: go straight through the main menu into the saved run, on the chart if
  // it was saved there (piece D) and no `?zone=` asks for a zone.
  machine.transition('mainMenu');
  const savedAt = state.player.location;
  if (savedAt.mode === 'chart' && !paramDef) {
    chartTravel.resume(savedAt, state.voyage);
    document.body.dataset['start'] = 'chart';
  } else {
    machine.transition('sailing');
    ctx.events.emit('ZoneEntered', { zoneId: zoneData.id, from: start.from });
  }
  document.body.dataset['startPose'] = poseText(spawn);
  loop.start();

  // `?encounter=freighter` (or barge, steamer, tug, cutter, derelict, squall, fogbank,
  // convoy) drops straight into an arena for checks (§20.3 criterion 5); `?at=47.05,-91.3`
  // sets where on the lake, `?heading=250` the course sailed, `?cutter=hunt` lets the cutter
  // hunt you (dev only until Phase 5's Wanted).
  const encounterParam = params.get('encounter');
  if (isDevEncounter(encounterParam)) {
    const geo = westernSuperiorChart();
    const [lat, lon] = (params.get('at') ?? '').split(',').map(Number);
    const at =
      Number.isFinite(lat) && Number.isFinite(lon) && params.get('at')
        ? geo.projection.geoToChart({ lat: lat ?? 0, lon: lon ?? 0 })
        : geo.projection.geoToChart(DEV_ARENA_AT_GEO);
    const headingDeg = Number(params.get('heading') ?? 250);
    const heading = ((Number.isFinite(headingDeg) ? headingDeg : 250) * Math.PI) / 180;
    await enterArena(devEncounter(encounterParam, at, heading, params.get('cutter') === 'hunt'));
  }
}

boot().catch((err: unknown) => {
  console.error(err);
  document.body.dataset['boot'] = 'failed';
});
