import { Vector3 } from 'three';
import { zoneToChart } from './core/coords';
import { SECONDS_PER_GAME_DAY, dayAndHour, parseTimeWarp } from './core/time';
import { EventBus } from './core/events';
import { DEFAULT_BINDINGS, InputMapper, type InputContext } from './core/input';
import { createLoop } from './core/loop';
import { Rng } from './core/rng';
import {
  clearDanger,
  clearLastRun,
  deleteRun,
  endRun,
  openSaveDb,
  readLastRun,
  type GlpDatabase,
} from './core/save/db';
import { acquireTabLock } from './core/tab-lock';
import {
  SettingsStore,
  applyBindingOverrides,
  databaseBackend,
  storageBackend,
  withFallback,
  type Settings,
} from './core/settings';
import { createWorkerEncoder } from './core/save/encoder';
import { loadRun, type LoadedRun } from './core/save/load';
import { RunSaver } from './core/save/run-saver';
import { AssetLoader, EMPTY_MANIFEST } from './core/assets';
import { createGameAudio, type GameAudio } from './audio/game-audio';
import type { SignalStation } from './audio/world-audio';
import { cloneTransform, createGameWorld, type Entity } from './gameplay/ecs';
import { createSchooner } from './gameplay/schooner';
import { npcParade } from './gameplay/npc-ships';
import { attachEconomy } from './gameplay/economy';
import { attachPorts, type PortControl } from './gameplay/port';
import { attachRumors } from './gameplay/rumors';
import { knowsRumor } from './sim/rumors/rumors';
import { smugglerAnchorage } from './sim/economy/smuggler';
import { attachContracts, contractsOf } from './gameplay/contracts';
import { attachSmuggler, type SmugglerControl } from './gameplay/smuggler';
import { attachStash, type StashControl } from './gameplay/stash';
import { siteDef } from './sim/hideouts/stash';
import { LIE_REFUSALS, type LieUntil } from './sim/hideouts/lie-at-anchor';
import { attachShipyard } from './gameplay/shipyard';
import { BASE_INSTRUMENTS, type Instruments } from './sim/shipyard/fit';
import { defaultShipState } from './sim/shipyard/shipyard';
import { DEFAULT_SHIP_CAMERA } from './gameplay/camera/ship-camera';
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
import { FULL_SAIL, speedKn, updateTargetSpeed } from './sim/sailing/controller';
import type { SaveControls } from './debug/overlay';
import type { GameContext, GameEvents } from './modes/context';
import { ModeMachine } from './modes/machine';
import { createSailingMode, type SailingModeOptions, type SailingView } from './modes/sailing';
import { createChartTravel, type ChartTravel } from './modes/chart-travel';
import { allContacts } from './modes/chart';
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
import { findHarbor, harborZoneId, layoutHarbors, type HarborLayout } from './sim/harbors';
import { workSites } from './audio/harbor-mix';
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
import { BACKGROUNDS, createWorldState, parseWorldState, type WorldState } from './sim/world-state';
import type { ZoneDef } from '../data/schemas/zones';
import { anchorRefusedNotice, dockRefusedNotice, NOTICE_S, sampleHud } from './ui/hud/model';
import { offersChart } from './sim/terrain/zone-edge';
import { arenaLoadingScreen, loadingScreen, type Arrival } from './ui/loading/model';
import { mountGameUi } from './ui/mount';
import { showMainMenu } from './ui/menu/mount-menu';
import type { MenuChoice } from './ui/menu/MainMenu';
import { randomSeed, savedRunSummary } from './ui/menu/model';
import { allPortraits, backgroundDef, type BackgroundKey } from './sim/character/backgrounds';
import { createNewRun, startingPort } from './sim/character/new-run';
import { withSailingPerks } from './sim/character/perks';
import { attachCaptain } from './gameplay/captain';
import { attachLaw, devWitness } from './gameplay/law';
import { attachPortLaw } from './gameplay/port-law';
import { attachPapers } from './gameplay/papers';
import { pierPort } from './sim/harbors';
import { attachLawShips } from './gameplay/law-ships';
import { attachTargets } from './gameplay/targets';
import { attachCollisions } from './gameplay/collisions';
import { fameTier } from './sim/law/defs';
import { ambientSightM, daylight01 } from './sim/law/perception';
import { aimSightM, barrelTilt, type AimWeapon } from './sim/combat/aim';
import { attachAim } from './gameplay/aim';
import { attachLawAtSea, isLawShip, PURSUES_FROM_TIER } from './gameplay/law-at-sea';
import { attachCombat, PLAYER_ID } from './gameplay/combat';
import { fitRefusal } from './sim/combat/armament';
import { addToHold } from './sim/economy/hold';
import { regionAtChart, regionAtZone } from './sim/law/regions';
import type { Identification, WitnessKind } from './sim/law/witness';
import { attachLantern, DARK_WARNING_M } from './gameplay/lantern';
import { attachDetection, awarenessChip } from './gameplay/detection';
import type { PlacedLight } from './sim/lighthouses';
import { attachRecord } from './gameplay/record';
import { attachCapture } from './gameplay/capture';
import { gameJail } from './sim/law/jail';
import { buildLastRun, type LastRun, type RunEndCause } from './sim/run/run-end';
import { showTabLocked } from './ui/menu/tab-locked';

/** Periodic autosave while safe (plan 16 §4.1). */
const AUTOSAVE_INTERVAL_MS = 2 * 60_000;

/** The fog fade's length (ui/theme.css `.loading`), so a zone swaps out of sight. */
const FADE_MS = 650;

/** HUD numbers update at most this often (plan 13 §10). */
const HUD_INTERVAL_S = 0.1;
/** The aim HUD and target card refresh this often: the barrel's tilt has to read live. */
const AIM_HUD_INTERVAL_S = 0.066;
/** Seconds the tier-5 harbor's "F again to dock" stands (plan 06 §3.2). */
const TOP_TIER_CONFIRM_S = 6;

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

/** The save database and the run in it, read before the main menu (Phase 4 piece C). */
interface PreparedRun {
  db: GlpDatabase | undefined;
  loaded: LoadedRun<WorldState> | undefined;
  /** `unavailable`: no IndexedDB; `error`: a run is there but no slot reads. */
  problem: 'unavailable' | 'error' | undefined;
}

async function prepareRun(): Promise<PreparedRun> {
  let db;
  try {
    db = await openSaveDb();
  } catch (err) {
    // Session-only play when IndexedDB is unavailable (plan 16 §8).
    console.warn('IndexedDB unavailable; this run will not be saved', err);
    return { db: undefined, loaded: undefined, problem: 'unavailable' };
  }
  try {
    return { db, loaded: await loadRun(db, parseWorldState), problem: undefined };
  } catch (err) {
    // Never silently delete an unreadable run (plan 16 §6.3); play this session unsaved.
    console.warn('Could not load the saved run', err);
    return { db: undefined, loaded: undefined, problem: 'error' };
  }
}

/**
 * Continue the run in IndexedDB, or start a new one (plan 16 §3, §6.3). `choice` is the
 * main menu's; without one (a check that skips the menu) a saved run continues and a
 * missing one starts as the default Deckhand. A new captain replaces the saved run.
 */
async function openRun(
  pre: PreparedRun,
  choice: MenuChoice | undefined,
  params: URLSearchParams,
): Promise<OpenedRun> {
  const setup = choice?.kind === 'new' ? choice.setup : undefined;
  const fresh = (seed: string): WorldState =>
    setup ? createNewRun(setup) : createWorldState(seed);
  if (pre.problem || !pre.db) {
    const status = pre.problem ?? 'unavailable';
    return { state: fresh(setup?.seed ?? crypto.randomUUID()), saver: undefined, status };
  }
  const { db, loaded } = pre;
  const encoder = createWorkerEncoder();
  if (loaded && !setup) {
    const { runId, seed, createdAt, playTimeMs } = loaded.envelope;
    const run = { runId, seed, createdAt, gameVersion: __GAME_VERSION__ };
    return {
      state: loaded.state,
      saver: new RunSaver(db, encoder, run, playTimeMs),
      status: loaded.recovered ? 'recovered' : 'loaded',
    };
  }
  // One run at a time (plan 16 §3): a new captain clears every slot of the old one, and
  // the last run's end screen goes with it.
  if (loaded) await deleteRun(db);
  await clearLastRun(db).catch(() => undefined);
  // `?seed=abc` starts a new run from that seed, so the same weather can be revisited.
  const seed = setup?.seed ?? params.get('seed') ?? crypto.randomUUID();
  const run = {
    runId: crypto.randomUUID(),
    seed,
    createdAt: new Date().toISOString(),
    gameVersion: __GAME_VERSION__,
  };
  const state = fresh(seed);
  const saver = new RunSaver(db, encoder, run);
  await saver.save(state);
  return { state, saver, status: 'created' };
}

/**
 * URL switches that start the game straight in a place for a check; with any of them, or
 * `?play`, the main menu is skipped (Phase 4 piece C) and the run continues or starts as
 * before. `?newrun=fisherman` skips it too, with a new captain of that background.
 */
const START_SWITCHES = [
  'play',
  'newrun',
  'zone',
  'entry',
  'harbor',
  'spawn',
  'light',
  'fogbank',
  'encounter',
  'npcs',
  'bench',
  'ship',
] as const;

function devNewRun(params: URLSearchParams): MenuChoice | undefined {
  const key = params.get('newrun');
  if (!key) return undefined;
  const background = (BACKGROUNDS as readonly string[]).includes(key)
    ? (key as BackgroundKey)
    : 'deckhand';
  return {
    kind: 'new',
    setup: {
      name: 'Ole Haugen',
      shipName: 'Lizzie Bell',
      background,
      portrait: allPortraits()[0]?.id ?? 'portrait.weathered',
      seed: params.get('seed') ?? randomSeed(),
    },
  };
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

  // One tab at a time (plan 16 §4.4): a second tab says so and goes no further.
  const uiRootEarly =
    document.getElementById('ui') ?? document.body.appendChild(document.createElement('div'));
  if (!(await acquireTabLock())) {
    document.body.dataset['tabLock'] = 'blocked';
    showTabLocked(uiRootEarly);
    return;
  }
  document.body.dataset['tabLock'] = 'held';

  const machine = new ModeMachine();
  machine.onTransition((_, to) => (document.body.dataset['mode'] = to));
  machine
    .register({ id: 'boot' })
    .register({ id: 'mainMenu' })
    .register({ id: 'characterCreation' })
    .transition('boot');

  const [prepared, settings] = await Promise.all([prepareRun(), loadSettings()]);
  // The last run's end screen stays on the menu until a new run starts (plan 16 §2).
  const lastRun = prepared.db
    ? ((await readLastRun(prepared.db).catch(() => undefined)) as LastRun | undefined)
    : undefined;
  // The main menu (Phase 4 piece C) comes up before the game boots into a run, unless a
  // check asks to start somewhere (START_SWITCHES).
  let choice: MenuChoice | undefined = devNewRun(params);
  if (!START_SWITCHES.some((k) => params.has(k))) {
    machine.transition('mainMenu');
    const menuRoot =
      document.getElementById('ui') ?? document.body.appendChild(document.createElement('div'));
    choice = await showMainMenu({
      root: menuRoot,
      settings,
      storage: browserStorage(),
      saved: prepared.loaded ? savedRunSummary(prepared.loaded.state) : undefined,
      lastRun: prepared.loaded ? undefined : lastRun,
      savedProblem:
        prepared.problem === 'error'
          ? "The saved run couldn't be read. It's kept, but this session won't be saved."
          : prepared.problem === 'unavailable'
            ? "This browser can't keep a save, so this run won't be saved."
            : undefined,
      onCreating: (creating) => machine.transition(creating ? 'characterCreation' : 'mainMenu'),
      loading: (c) =>
        c.kind === 'new'
          ? { title: startingPort(c.setup.background).portName, line: 'May 7, 1900, at dawn' }
          : {
              title: prepared.loaded ? savedRunSummary(prepared.loaded.state).shipName : 'the lake',
              line: 'Back aboard',
            },
    });
  }
  const { state, saver, status } = await openRun(prepared, choice, params);
  /** A new captain opens the run docked at the background's starting pier (plan 12 §3). */
  const startPier =
    choice?.kind === 'new' ? backgroundDef(choice.setup.background).startPier : undefined;
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
  // The ship the run sails (Phase 4 piece G: the shipyard sells and fits her). `?ship=t2`
  // puts the run in a sound, bare T2 (or `t1`), for checks.
  state.player.ship ??= defaultShipState();
  const askedClass = PLAYER_SHIP_IDS[params.get('ship') ?? ''];
  if (askedClass && askedClass !== state.player.ship.classId) {
    state.player.ship = defaultShipState(askedClass);
  }
  const schooner = createSchooner(spawn.x, spawn.z, spawn.heading, state.player.ship.classId);
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
  // The lantern (Phase 5 piece B): L lights or douses her running lights, burning lamp oil.
  // `?lantern=on` (or `off`) sets it for checks, with no oil used.
  const lantern = attachLantern(ctx, playerShip);
  if (params.get('lantern') === 'on' || params.get('lantern') === 'off') {
    lantern.set(params.get('lantern') === 'on');
  }

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

  // The shipyard (Phase 4 piece G): the ship's class, upgrades and condition. A new hull
  // rebuilds her model (the view draws a ship from her class as she's added); instruments
  // set the spyglass, the look-her-over range and the chart's forecast.
  let instruments: Instruments = { ...BASE_INSTRUMENTS };
  const baseSpyglassFov = DEFAULT_SHIP_CAMERA.spyglassFovDeg;
  /** The ship camera, once the view is up. */
  const shipCamera: { current?: { params: { spyglassFovDeg: number } } | undefined } = {};
  const applyInstruments = (): void => {
    const cam = shipCamera.current;
    if (cam) cam.params.spyglassFovDeg = baseSpyglassFov * instruments.spyglassFovMul;
  };
  const lookRangeM = (): number => LOOK_RANGE_M * instruments.lookRangeMul;
  const shipyard = attachShipyard({
    ctx,
    economy,
    sailing,
    hazards,
    buoyancy: schooner.buoyancy,
    handling,
    rules: hazardRules,
    // The captain's sailing perks (plan 12 §2.2, piece C). refit() rebuilds the class at
    // the start and on every hull or upgrade, so the Deckhand's hands survive a new ship.
    adjustClass: (cls) => withSailingPerks(cls, state.player.captain),
    onHullChanged: () => {
      ctx.world.remove(playerShip);
      ctx.world.add(playerShip);
    },
    onInstruments: (next) => {
      instruments = next;
      applyInstruments();
    },
  });
  if (import.meta.env.DEV || params.has('debug')) {
    const hook = {
      ship: () => {
        shipyard.sync();
        return shipyard.ship;
      },
      fit: () => shipyard.fit,
      buy: (port: string, classId: string) => shipyard.buyHull(port, classId),
      install: (port: string, id: string, source: 'shipyard' | 'chandlery' = 'shipyard') =>
        shipyard.install(port, id, source),
      remove: (port: string, id: string, source: 'shipyard' | 'chandlery' = 'shipyard') =>
        shipyard.remove(port, id, source),
      repair: (port: string, place: 'shipyard' | 'chandlery' = 'shipyard') =>
        shipyard.repair(port, place),
      kit: () => shipyard.useKit(),
      /** Adds cash to the purse, for trying the yard. */
      grant(cents: number) {
        state.player.purse += Math.max(0, Math.round(cents));
      },
      /** The class the helm sails now. */
      sailing: () => sailing.cls.id,
      /** Knocks the pools down to these shares, for trying repairs. */
      damage(hull01: number, rigging01: number) {
        hazards.state.hull = hull01 * hazards.cls.hullHP;
        hazards.state.rigging = rigging01 * hazards.cls.riggingHP;
        shipyard.sync();
      },
    };
    (window as unknown as { __glpShipyard: typeof hook }).__glpShipyard = hook;
  }

  // The lake's traffic (plan 05 §8, Phase 4 piece D): one set of ships for the chart, the
  // zones and the markets. A stable per-run number from the save (the RNG state moves on
  // as the run plays), so the timetables and manifests are the same after a reload.
  const trafficSeed = `run-${state.environment.weather.noiseSeed}`;
  // Freight contracts (plan 05 §5.2, Phase 4 piece F): the boards follow from the same seed.
  const contracts = attachContracts(ctx, economy, trafficSeed);
  if (import.meta.env.DEV || params.has('debug')) {
    const hook = {
      board: (port: string) => contracts.board(port),
      accept: (port: string, offerId: string) => contracts.accept(port, offerId),
      arrive: (port: string) => contracts.arrive(port),
      steal: (contractId: string, port: string) => contracts.steal(contractId, port),
      abandon: (contractId: string, port: string) => contracts.abandon(contractId, port),
      state: () => contractsOf(state).contracts,
      standing: () => contractsOf(state).captain.standing,
      /** Sets Standing with a port or company, for trying what it opens. */
      setStanding: (id: string, value: number) => {
        contractsOf(state).captain.standing[id] = Math.max(0, Math.min(100, value));
      },
    };
    (window as unknown as { __glpContracts: typeof hook }).__glpContracts = hook;
  }
  // The law (plan 06, Phase 5 piece A): Phase 4's crimes become heat in their regions.
  const law = attachLaw(ctx, trafficSeed);
  // Port law (piece E): the harbor master, the search on docking, informants, the HUD's law.
  const portLaw = attachPortLaw(ctx, law, economy);
  // The run's record for the end screen: its counters and the logbook (piece D).
  attachRecord(ctx, law.defs);
  if (import.meta.env.DEV || params.has('debug')) {
    // `__glpLaw.commit('crime.smuggler_deal', 'region.apostles', 'keeper', 'ship')` commits
    // a crime with one witness; `fileAll()` lands every report now.
    const hook = {
      commit: (
        crime: string,
        region = law.region() ?? 'region.chequamegon',
        kind: WitnessKind | 'none' = 'keeper',
        identification: Identification = 'ship',
      ) =>
        law.commit({
          crime,
          region,
          witnesses: kind === 'none' ? [] : [devWitness(kind, identification)],
        }),
      fileAll: () => law.fileAll(),
      harbor: (port: string) => portLaw.harbor(port),
      pay: (port: string, kind: 'fine' | 'bribe') => portLaw.pay(port, kind),
      dockCheck: (port: string) => portLaw.dockCheck(port),
      intercept: (reportId: string) => law.intercept(reportId),
      setTier: (region: string, tier: number) => law.setTier(region, tier),
      setHeat: (region: string, heat: number) => law.setHeat(region, heat),
      region: () => law.region(),
      state: () => ({
        wanted: state.wanted,
        fame: state.fame,
        profiles: state.profiles,
        reports: state.reports,
        jail: state.jail,
      }),
    };
    (window as unknown as { __glpLaw: typeof hook }).__glpLaw = hook;
  }
  // The law's ships (Phase 5 piece C): the Morrill's sorties by Wanted, and at tier 5 the
  // chartered tug. They're chart contacts with the traffic, sailed by their planner.
  const lawShips = attachLawShips(ctx, westernSuperiorChart(), trafficSeed, law.defs);
  const traffic = attachTraffic(ctx, [
    ...createContacts(
      westernSuperiorChart().projection,
      `${trafficSeed}-traffic`,
      state.environment.clock.gameSeconds,
    ),
    ...lawShips.contacts,
  ]);
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
  // Where the harbors are heard at work: mills, yards and docks (Phase 4 piece J).
  const harborSites = (layouts: readonly HarborLayout[]) =>
    workSites(layouts.map((l) => ({ id: l.def.id, buildings: l.buildings, piers: l.piers })));
  const audio: GameAudio | undefined = await createGameAudio({
    game: ctx,
    target: window,
    storage: browserStorage(),
    stations,
    harbors: harborLayouts.flatMap((l) => l.piers.map((p) => p.root)),
    sites: harborSites(harborLayouts),
    captions: settings.value.ui.captions,
    region: () => law.region(),
    onState: (s) => (document.body.dataset['audio'] = s),
  }).catch((err: unknown) => {
    console.warn('Audio unavailable; running silent', err);
    document.body.dataset['audio'] = 'unavailable';
    return undefined;
  });
  if (audio) document.body.dataset['audioBank'] = String(audio.bank.size);
  // `?debug`: sound the nearest fog signal now, for the captions' e2e test (piece J).
  if (audio && params.has('debug')) {
    const hook = { fogSignal: () => audio.world.signalNow() };
    (window as unknown as { __glpAudio: typeof hook }).__glpAudio = hook;
  }
  /** The chart's music and cues on the page, for the e2e tests; written only on a change. */
  const audioCuesToDataset = (a: GameAudio): void => {
    const d = document.body.dataset;
    const chartMusic = a.chartMusic.playing ? 'playing' : 'off';
    if (d['chartMusic'] !== chartMusic) d['chartMusic'] = chartMusic;
    const stinger = a.chartCues.last;
    if (stinger && d['stinger'] !== stinger) d['stinger'] = stinger;
    const fades = String(a.chartCues.transitions);
    if (d['audioFades'] !== fades) d['audioFades'] = fades;
    const trade = a.trade.last;
    if (trade && d['tradeCue'] !== trade) d['tradeCue'] = trade;
    const sites = String(a.harbor.siteCount);
    if (d['harborSites'] !== sites) d['harborSites'] = sites;
    // The law's sounds (piece H).
    const wanted = a.law.lastStinger;
    if (wanted && d['wantedStinger'] !== wanted) d['wantedStinger'] = wanted;
    const lawCue = a.law.lastCue;
    if (lawCue && d['lawCue'] !== lawCue) d['lawCue'] = lawCue;
    const engines = String(a.law.levels.engines);
    if (d['lawEngines'] !== engines) d['lawEngines'] = engines;
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
  /**
   * The run is over (piece D): its slots are deleted and nothing may save it again.
   * In danger (plan 16 §4.2), regular saves wait: the danger snapshot stands for the run.
   */
  const run = { over: false, inDanger: false };
  /** Readies the state for a save: the RNG, where the ship is, her damage. */
  const prepareSave = (): void => {
    state.environment.rng = ctx.rng.getState();
    if (!changingZone && !travelRef.current?.record(state) && !inArenaSpace)
      recordZonePose(state, zoneData.id, shipPose());
    shipyard.sync();
  };
  const saveControls: SaveControls = {
    status,
    lastSavedAt: undefined,
    lastError: undefined,
    async saveNow(): Promise<void> {
      if (!saver || run.over || run.inDanger) return;
      state.environment.rng = ctx.rng.getState();
      // Where the ship is, so Continue comes back here (Phase 3 piece A): on the chart with
      // the voyage (piece D), including while an arena entered from it is in play, or in the
      // zone. Not mid-load: the location already names the zone being entered. An arena
      // entered from a zone keeps the place recorded on the way in; its frame isn't the zone's.
      if (!changingZone && !travelRef.current?.record(state) && !inArenaSpace)
        recordZonePose(state, zoneData.id, shipPose());
      // Her damage as it stands (piece G).
      shipyard.sync();
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
  /** The dev overlay's GUI, for folders whose systems are attached after it (combat). */
  let devGui: import('three/examples/jsm/libs/lil-gui.module.min.js').GUI | undefined;
  const lateDevPanels: { update(): void }[] = [];
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
      const { createLawPanel } = await import('./debug/law-panel');
      const lawPanel = createLawPanel({
        gui: overlay.gui,
        law,
        state: ctx.state,
        events: ctx.events,
      });
      const { createJumpPanel } = await import('./debug/jump-panel');
      createJumpPanel({ gui: overlay.gui, save: saveControls });
      devGui = overlay.gui;
      view = {
        render(alpha, seaTime, frameSeconds) {
          drawn.render(alpha, seaTime, frameSeconds);
          overlay.update(frameSeconds);
          panel.update();
          audioPanel?.update();
          hazardsPanel.update();
          lawPanel.update();
          for (const p of lateDevPanels) p.update();
        },
      };
    }
  }

  // Settings apply live (plan 13 §11): the renderer, the camera, the keys and the helm.
  const cameraRig = scene?.cameraRig;
  shipCamera.current = cameraRig?.ship;
  applyInstruments();
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
    if (audio) audio.captions.enabled = s.ui.captions;
  };

  // The HUD and the settings screen (plan 13 §12). The menu pauses the tick.
  let contextBeforeMenu: InputContext = 'sailing';
  const uiRoot =
    document.getElementById('ui') ?? document.body.appendChild(document.createElement('div'));
  // The port screen and the journal (Phase 4 piece B); attached once the UI is up.
  const portsRef: { current: PortControl | undefined } = { current: undefined };
  const smugglerRef: { current: SmugglerControl | undefined } = { current: undefined };
  // The Stockton stash and lying at anchor (Phase 4 piece E); attached with the ports.
  const stashRef: { current: StashControl | undefined } = { current: undefined };
  const captainRef: { current: ReturnType<typeof attachCaptain> | undefined } = {
    current: undefined,
  };
  // Jail and the run's end (piece D); attached once the ports are up.
  const captureRef: { current: ReturnType<typeof attachCapture> | undefined } = {
    current: undefined,
  };
  const endRef: { current: ((cause: RunEndCause) => Promise<void>) | undefined } = {
    current: undefined,
  };
  /** Puts the tier-5 front page away (piece F); set once the papers are attached. */
  const frontPageRef: { current: (() => void) | undefined } = { current: undefined };
  const ui = mountGameUi({
    root: uiRoot,
    settings,
    port: {
      buy: (good, qty) => portsRef.current?.actions.buy(good, qty),
      sell: (good, qty) => portsRef.current?.actions.sell(good, qty),
      quote: (good, qty, side) => portsRef.current?.actions.quote(good, qty, side) ?? 0,
      buyStores: (item, qty) => portsRef.current?.actions.buyStores(item, qty),
      buyRound: () => portsRef.current?.actions.buyRound(),
      offer: (index) => portsRef.current?.actions.offer(index),
      acceptContract: (id) => portsRef.current?.actions.acceptContract(id),
      abandonContract: (id) => portsRef.current?.actions.abandonContract(id),
      stealContract: (id) => portsRef.current?.actions.stealContract(id),
      buyHull: (classId) => portsRef.current?.actions.buyHull(classId),
      fit: (upgrade, place) => portsRef.current?.actions.fit(upgrade, place),
      unfit: (upgrade, place) => portsRef.current?.actions.unfit(upgrade, place),
      repair: (place) => portsRef.current?.actions.repair(place),
      // Piece E's harbor master tab offered Pay but nothing carried it to the game.
      payHarbor: (kind) => portsRef.current?.actions.payHarbor?.(kind),
      buyPaper: (paper) => portsRef.current?.actions.buyPaper?.(paper),
      close: () => portsRef.current?.close(),
      castOff: () => portsRef.current?.actions.castOff(),
      wait: (until) => portsRef.current?.actions.wait?.(until),
      closeJournal: () => portsRef.current?.closeJournal(),
      openDocked: () => {
        if (machine.mode !== 'sailing' || machine.overlayOpen) return;
        if (!portsRef.current?.openDocked()) stashRef.current?.openHere();
      },
    },
    smuggler: {
      buy: (good, qty) => smugglerRef.current?.actions.buy(good, qty),
      fence: (index, qty) => smugglerRef.current?.actions.fence(index, qty),
      close: () => smugglerRef.current?.close(),
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
    setFirstWeekHidden: (hidden) => captainRef.current?.setHidden(hidden),
    jail: {
      serve: () => captureRef.current?.actions.serve(),
      sendWord: (hideout) => captureRef.current?.actions.sendWord(hideout),
      jailbreak: () => captureRef.current?.actions.jailbreak(),
      hang: () => captureRef.current?.actions.hang(),
      leave: () => captureRef.current?.actions.leave(),
    },
    onAbandon: () => void endRef.current?.('abandoned'),
    onFrontPageClosed: () => frontPageRef.current?.(),
    onTakeToChart: () => {
      if (machine.mode === 'sailing' && !machine.overlayOpen) travelRef.current?.takeToChart();
    },
    onWait: () => {
      if (machine.mode !== 'sailing' || machine.overlayOpen) return;
      const refused = stashRef.current?.openLie();
      if (refused) showNotice(refused);
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
  // take the keys, like the settings screen. The port screen pauses the tick; the journal
  // lets the ship sail on behind it when the player's setting says so (never in an arena).
  let contextBeforeScreen: InputContext = 'sailing';
  let modeAtScreen = machine.mode;
  const sailOnOffered = (): boolean => !arena && !inArenaSpace;
  const sailOnAllowed = (): boolean =>
    settings.value.sailing.sailOnWhileReading && sailOnOffered() && !changingZone;
  // Saloon talk and hailed news for the ledger (Phase 4 piece K).
  const rumors = attachRumors({
    ctx,
    economy: economy.defs,
    traffic,
    smugglerAnchorage: () => smugglerAnchorage(),
  });
  // The papers (Phase 5 piece F): headlines from the bus's news, Fame from the printing, the
  // newsstand in port, storm signals, and the tier-5 front page once per region.
  let contextBeforeFrontPage: InputContext = 'sailing';
  let frontPageUp = false;
  const showFrontPage = (): void => {
    if (frontPageUp || captureRef.current?.open || captureRef.current?.pending || ctx.state.jail)
      return;
    const page = papers.takeFrontPage();
    if (!page) return;
    frontPageUp = true;
    machine.pushOverlay('dialog');
    contextBeforeFrontPage = input.context;
    input.context = 'menu';
    if (cameraRig) cameraRig.suspended = true;
    ui.setFrontPage(page);
    document.body.dataset['frontPage'] = page.region;
  };
  frontPageRef.current = () => {
    if (!frontPageUp) return;
    frontPageUp = false;
    machine.removeOverlay('dialog');
    input.context = contextBeforeFrontPage;
    input.endTick();
    if (cameraRig) cameraRig.suspended = machine.overlayOpen;
    document.body.dataset['frontPage'] = 'closed';
  };
  const papers = attachPapers({
    ctx,
    law,
    seed: trafficSeed,
    goodName: (good) => economy.defs.goods.get(good)?.name ?? good,
    lawShips,
    // A region gone Most Wanted: its paper's front page fills the screen.
    onFrontPage: () => queueMicrotask(showFrontPage),
  });
  // One held back behind the lockup shows on release.
  ctx.events.on('Released', () => queueMicrotask(showFrontPage));
  // Out of the lockup, you don't find the *Morrill* alongside: she's off on a sortie.
  ctx.events.on('Released', () => lawShips.awayFromPort(gameJail().lockup.port));
  if (import.meta.env.DEV || params.has('debug')) {
    // `__glpPapers.press()` prints today's editions now (`press(1)` tomorrow's); `.state()` shows the stories.
    const hook = {
      press: (daysAhead = 0) => papers.pressNow(daysAhead),
      state: () => papers.state,
      signals: () => papers.signals(),
      stand: (port: string) => papers.stand(port),
    };
    (window as unknown as { __glpPapers: typeof hook }).__glpPapers = hook;
  }
  const ports = attachPorts({
    ctx,
    economy,
    law: portLaw,
    papers,
    contracts,
    hazards,
    rumors,
    shipyard,
    berthPier: (berthId) => sailingOptions.berths.find((b) => b.id === berthId)?.dockId,
    showPort: (snapshot) => ui.setPort(snapshot),
    showJournal: (snapshot) => ui.setJournal(snapshot),
    onOpen(open) {
      if (open) {
        const journal = !ports.openPort;
        machine.pushOverlay(journal ? 'journal' : 'trade', !(journal && sailOnAllowed()));
        ui.setJournalSailing(journal && sailOnOffered() ? sailOnAllowed() : undefined);
        modeAtScreen = machine.mode;
        contextBeforeScreen = input.context;
        input.context = 'menu';
      } else {
        if (!machine.removeOverlay('trade')) machine.removeOverlay('journal');
        ui.setJournalSailing(undefined);
        // A journal left open across an arrival closes in the new mode, which has set its keys.
        if (machine.mode === modeAtScreen) input.context = contextBeforeScreen;
        input.endTick();
      }
      if (cameraRig) cameraRig.suspended = open;
      audio?.portScreen(open);
      document.body.dataset['port'] = ports.openPort ?? (ports.journalOpen ? 'journal' : 'closed');
      hudClock = HUD_INTERVAL_S;
    },
    castOff: () => input.trigger('Interact'),
    // Waiting alongside runs the stash's lie-at-anchor clock (attached below).
    wait: {
      refusal: () => {
        const r = stashRef.current?.lieRefusal();
        return r && LIE_REFUSALS[r];
      },
      lie: (until) =>
        stashRef.current ? stashRef.current.actions.lie(until) : "You can't wait here.",
      lastText: () => stashRef.current?.lastLieText,
    },
  });
  portsRef.current = ports;
  // P or the setting flips sailing on behind an open journal at once.
  settings.subscribe(() => {
    if (!ports.journalOpen) return;
    machine.setOverlayPauses('journal', !sailOnAllowed());
    ui.setJournalSailing(sailOnOffered() ? sailOnAllowed() : undefined);
  });
  // The island smuggler (Phase 4 piece H): her boat after dark in Oak Island's lee, and her
  // screen, which pauses the game like the port screen.
  let contextBeforeSmuggler: InputContext = 'sailing';
  const smuggler = attachSmuggler({
    ctx,
    economy,
    // The informant's risk on her screen, from the Wanted tier in her waters (piece E).
    show: (snapshot) =>
      ui.setSmuggler(
        snapshot && {
          ...snapshot,
          informRisk: portLaw.informRisk(smuggler.def.anchorage.region),
        },
      ),
    // Saloon talk of where she lies puts her on the chart (piece K).
    heardOf: () => knowsRumor(ctx.state.knowledge.rumors, 'smuggler'),
    onOpen(open) {
      if (open) {
        machine.pushOverlay('trade');
        contextBeforeSmuggler = input.context;
        input.context = 'menu';
      } else {
        machine.removeOverlay('trade');
        input.context = contextBeforeSmuggler;
        input.endTick();
      }
      if (cameraRig) cameraRig.suspended = open;
      document.body.dataset['smuggler'] = open ? 'open' : 'closed';
      hudClock = HUD_INTERVAL_S;
    },
  });
  smugglerRef.current = smuggler;
  const smugglerZone = (z: LoadedZone | undefined) =>
    z ? { id: z.manifest.zone, frame: manifestFrame(z.manifest) } : undefined;

  // Detection at sea (Phase 5 piece B): the keepers, the crews about and the cutter's
  // lookout watch for the ship, and whoever has her in sight is a witness (piece A asks).
  let placedLights: { zone: LoadedZone | undefined; lights: PlacedLight[] } = {
    zone: undefined,
    lights: [],
  };
  const zoneLights = (): readonly PlacedLight[] => {
    if (placedLights.zone !== zone) {
      placedLights = {
        zone,
        lights: zone
          ? placeLights(lightsIn(zone.manifest.zone), manifestFrame(zone.manifest), zone.terrain)
          : [],
      };
    }
    return placedLights.lights;
  };
  const detection = attachDetection({
    ctx,
    player: playerShip,
    zoneId: () => (zone ? zone.manifest.zone : undefined),
    lights: zoneLights,
    shipName: (id) =>
      traffic.contacts.find((c) => c.id === id)?.name ??
      arena?.encounter.ships.find((s) => s.id === id)?.name,
    ignore: (id) => smuggler.isSmuggler(id),
    beamClock: () => scene?.beamSeconds ?? 0,
  });
  // The law asks piece B's watchers who saw a crime at sea (plan 06 §2.1, §7.1).
  law.witnesses = detection;
  // For the console and the e2e tests: who's watching, the witnesses, and the lantern.
  if (import.meta.env.DEV || params.has('debug')) {
    const hook = {
      witnesses: () => detection.witnesses(),
      watchers: () =>
        detection.watchers.map((w) => ({
          id: w.observer.id,
          kind: w.observer.kind,
          name: w.observer.name,
          meter: Math.round(w.meter.value * 100) / 100,
          awareness: w.awareness,
          by: w.sight.by,
          backdrop: w.backdrop,
          vigilance: Math.round(w.observer.vigilance * 100) / 100,
          distanceM: Math.round(w.distanceM),
          hullM: Math.round(w.sight.hullM),
          lanternM: Math.round(w.sight.lanternM),
        })),
      conditions: () => detection.conditions,
      lantern: () => ({ ...lantern.state, nights: lantern.nights() }),
      toggleLantern: () => lantern.toggle(),
      setLantern: (lit: boolean) => lantern.set(lit),
    };
    (window as unknown as { __glpDetection: typeof hook }).__glpDetection = hook;
  }
  ctx.events.on('ZoneEntered', () => detection.reset());
  ctx.events.on('ArenaEntered', () => detection.reset());

  // The law at close quarters (Phase 5 piece C): the cutter's captain in a zone or arena.
  const devHunt = params.get('cutter') === 'hunt';
  const lawAtSea = attachLawAtSea({
    ctx,
    law,
    detection,
    player: playerShip,
    hazards,
    economy: economy.defs,
    playerKn: () => speedKn(sailing.state),
    region: () => {
      const p = shipPose();
      if (arena || inArenaSpace) {
        const at = arena?.encounter.at;
        return at
          ? regionAtChart(law.defs, toWorldChart(westernSuperiorChart(), at))
          : law.region();
      }
      return regionAtZone(law.defs, zoneData.id, { x: p.x, z: p.z }) ?? law.region();
    },
    chartAt: () => {
      const at = arena?.encounter.at;
      if (at) return toWorldChart(westernSuperiorChart(), at);
      const p = shipPose();
      return zoneToChart({ x: p.x, z: p.z }, zoneFrame(zone, zoneData));
    },
    arena: () =>
      arena && {
        ships: arena.ships,
        land: arena.land,
        hunting: arena.encounter.hunting,
      },
    zoneShips: () => [...traffic.shown.values()].map((s) => s.entity),
    hold: (id) => traffic.hold(id),
    zoneLand: () => {
      const t = ctx.terrain;
      if (!t) return undefined;
      const draft = 2.9 + 0.6;
      return {
        halfM: Infinity,
        allWater: false,
        allDeep: false,
        isLand: (x, z) => t.contains(x, z) && t.heightAt(x, z) > 0,
        isShoal: (x, z) => t.contains(x, z) && t.depthAt(x, z) < draft,
      };
    },
    searchMul: () => instruments.searchMul,
    notice: (text) => showNotice(text),
    splash: (x, z) => scene?.spray.burst(x, z),
    ...(devHunt ? { devTier: () => PURSUES_FROM_TIER } : {}),
  });
  ctx.events.on('ZoneEntered', () => lawAtSea.reset());
  ctx.events.on('ArenaEntered', () => lawAtSea.reset());

  // Targets at close quarters (Phase 6 piece C): every robbable ship's captain and his
  // nerve, in a zone or an arena; her towline; then hulls that don't pass through each other.
  // `?guns=N` sets the guns the captains see you carry until piece A arms the ship.
  const devGuns = Number(params.get('guns') ?? NaN);
  const zoneLandFor = (draftM: number) => {
    const t = ctx.terrain;
    if (!t) return undefined;
    const draft = draftM + 0.6;
    return {
      halfM: Infinity,
      allWater: false,
      allDeep: false,
      isLand: (x: number, z: number) => t.contains(x, z) && t.heightAt(x, z) > 0,
      isShoal: (x: number, z: number) => t.contains(x, z) && t.depthAt(x, z) < draft,
    };
  };
  const shipNameOf = (id: string): string => {
    const met = arena?.encounter.ships.find((s) => s.id === id);
    if (met) return met.name;
    const base = id.replace(/\.consort_\d+$/, '');
    const c = traffic.contacts.find((k) => k.id === base);
    if (!c) return 'The ship';
    return base === id ? c.name : (c.consorts?.[0]?.name ?? `${c.name}'s consort`);
  };
  const targets = attachTargets({
    ctx,
    player: playerShip,
    playerKn: () => speedKn(sailing.state),
    arena: () => arena && { ships: arena.ships, land: arena.land },
    // A ship lying alongside a pier isn't anyone's prize at sea.
    zoneShips: () => [...traffic.shown.values()].filter((s) => !s.berthed).map((s) => s.entity),
    hold: (id) => traffic.hold(id),
    zoneLand: zoneLandFor,
    windAt: (x, z) => sailingOptions.wind(x, z),
    dark01: () => {
      const c = detection.conditions;
      if (!c) return 0;
      const night = 1 - daylight01(c.sky.sunElevationRad);
      const fog = Math.min(1, Math.max(0, (2000 - c.fogM) / 1400));
      return Math.max(night, fog);
    },
    fameTier: () => fameTier(law.defs, ctx.state.fame.value),
    playerGuns: () => (Number.isFinite(devGuns) ? devGuns : 1),
    refuges: () => (arena || inArenaSpace ? [] : harborLayouts.map((l) => l.footprint.anchor)),
    nameOf: shipNameOf,
    notice: (text) => showNotice(text),
  });
  // Piece A's guns tell the captains what they did: a ball that struck a ship, and the
  // hands killed aboard her. The damage is already taken off her record when these arrive,
  // so the captain reads each pool's share from it (plan 07 §5.1).
  const shareOf = (shipId: string, pool: 'hull' | 'rigging' | 'engine', points: number): number => {
    const e = [...ctx.world.entities].find((k) => k.id === shipId);
    const d = e?.damage;
    if (!d) return 0;
    const max = pool === 'hull' ? d.hullMax : pool === 'rigging' ? d.riggingMax : d.engineMax;
    return max > 0 ? points / max : 0;
  };
  ctx.events.on('ShipHit', (e) => {
    if (e.pool === 'hull' || e.pool === 'rigging' || e.pool === 'engine')
      targets.hit(e.shipId, e.pool, shareOf(e.shipId, e.pool, e.damage));
  });
  ctx.events.on('CrewCasualties', (e) => {
    targets.casualties(e.shipId, e.killed, e.wounded);
  });
  ctx.events.on('ShotLanded', (e) => {
    if (e.on === 'water') return;
    targets.shotLanded({ x: e.at.x, z: e.at.z }, e.shipId);
  });
  const collisions = attachCollisions({
    ctx,
    movable: (e) => !!arena || (!!e.id && traffic.isHeld(e.id)),
    helmOf: (e) => arena?.ships.find((s) => s.entity === e)?.steer.helm ?? targets.helmOf(e),
  });
  ctx.events.on('ZoneEntered', () => targets.reset());
  ctx.events.on('ArenaEntered', () => targets.reset());
  if (import.meta.env.DEV || params.has('debug')) {
    // `__glpTargets.captains()` reads every target's captain and his meter; `warn(id)` drops
    // a shot across her bow, `hit`/`casualties` stand in for piece A's guns until they land.
    const ahead = (id: string, m: number): { x: number; z: number } | undefined => {
      const e = (
        arena ? arena.ships.map((s) => s.entity) : [...traffic.shown.values()].map((s) => s.entity)
      ).find((k) => k.id === id);
      const t = e?.transform;
      return t
        ? { x: t.position.x + Math.sin(t.heading) * m, z: t.position.z - Math.cos(t.heading) * m }
        : undefined;
    };
    const hook = {
      captains: () => targets.captains(),
      towLines: () => targets.towLines(),
      warn: (id?: string) => {
        const target = id ?? targets.captains()[0]?.id;
        const at = target ? ahead(target, 80) : undefined;
        return at ? targets.shotLanded(at) : {};
      },
      shot: (x: number, z: number, hitId?: string) => targets.shotLanded({ x, z }, hitId),
      hit: (id: string, pool: 'hull' | 'rigging' | 'engine', share: number) =>
        targets.hit(id, pool, share),
      casualties: (id: string, killed: number, wounded = 0) =>
        targets.casualties(id, killed, wounded),
      cutTow: (consortId?: string) => {
        const id = consortId ?? targets.towLines()[0]?.consortId;
        return id ? targets.cutTow(id) : false;
      },
    };
    (window as unknown as { __glpTargets: typeof hook }).__glpTargets = hook;
  }
  if (import.meta.env.DEV || params.has('debug')) {
    // `__glpCutter.brains()` reads her captain; `ships()` her sortie and the tug's.
    const hook = {
      brains: () => lawAtSea.brains(),
      locked: () => lawAtSea.locked,
      ships: () => lawShips.debug(),
      morrill: () => ({ ...lawShips.morrill.pos, inPort: lawShips.morrill.inPort }),
      charter: (region: string) => lawShips.charter(region),
    };
    (window as unknown as { __glpCutter: typeof hook }).__glpCutter = hook;
  }
  // The combat core (Phase 6 piece A): guns, shot in flight, and the damage it does.
  const combat = attachCombat({
    ctx,
    player: playerShip,
    hazards,
    arena: () => arena && { ships: arena.ships, land: arena.land },
    zoneShips: () => [...traffic.shown.values()].map((s) => s.entity),
    hold: (id) => traffic.hold(id),
    zoneLand: () => {
      const t = ctx.terrain;
      if (!t) return undefined;
      return {
        halfM: Infinity,
        allWater: false,
        allDeep: false,
        isLand: (x, z) => t.contains(x, z) && t.heightAt(x, z) > 0,
      };
    },
    isLawShip,
    splash: (x, z) => scene?.spray.burst(x, z),
    notice: (text) => showNotice(text),
    // The sea's roll throws the barrel off its sight (piece B); her steady heel is laid out.
    barrelTilt: (mount) => {
      const t = playerShip.transform;
      return t
        ? barrelTilt(mount, { roll: t.roll ?? 0, pitch: t.pitch ?? 0, heel: sailing.state.heel })
        : 0;
    },
  });
  if (scene) scene.shots.source = () => combat.shots();
  // Aim mode (Phase 6 piece B): Tab, the arc and splash ring, 1/2/3, C and the left mouse.
  const shipsOnWater = (): Entity[] =>
    arena ? arena.ships.map((s) => s.entity) : [...traffic.shown.values()].map((s) => s.entity);
  const aim = attachAim({
    ctx,
    player: playerShip,
    combat,
    sightM: () => {
      const c = detection.conditions;
      return c ? aimSightM({ ambientM: ambientSightM(c.sky), fogM: c.fogM }) : 2000;
    },
    refusal: () =>
      machine.mode !== 'sailing'
        ? 'Not at sea'
        : hazards.state.mooring === 'docked'
          ? 'Cast off before you work the guns'
          : undefined,
    heel: () => sailing.state.heel,
    ships: shipsOnWater,
    captains: () => targets.captains(),
    nameOf: shipNameOf,
    notice: (text) => showNotice(text),
  });
  // The fire button counts only when it went down on the sea, not on a HUD button.
  let fireOnSea = false;
  window.addEventListener(
    'mousedown',
    (e) => (fireOnSea = !!scene && e.target === renderer?.renderer.domElement),
    { capture: true },
  );
  // Tab is the aim key at the helm: the browser mustn't move focus with it.
  window.addEventListener('keydown', (e) => {
    if (input.context !== 'sailing') return;
    if ((input.bindings.sailing.AimMode ?? []).includes(e.code)) e.preventDefault();
  });
  if (scene) {
    scene.aimSource = () =>
      aim.active ? { preview: aim.preview(), ready: aim.hud()?.status === 'ready' } : undefined;
    let lastHit = '';
    ctx.events.on('WeaponFired', (e) => {
      scene.combatFx.muzzle({ x: e.at.x, y: e.y ?? 3, z: e.at.z }, e.bearing, e.rounds);
    });
    ctx.events.on('ShipHit', (e) => {
      if (e.weapon === 'dev' || e.weapon === 'boiler' || e.damage <= 0) return;
      // One ball can take points off two pools: one burst of splinters for it.
      const key = `${e.at.x.toFixed(2)},${e.at.z.toFixed(2)}`;
      if (key === lastHit) return;
      lastHit = key;
      scene.combatFx.hit(e.at, e.location === 'rigging');
    });
  }
  ctx.events.on('ZoneEntered', () => combat.reset());
  ctx.events.on('ArenaEntered', () => combat.reset());
  if (import.meta.env.DEV || params.has('debug')) {
    // `__glpCombat.arm('weapon.swivel', 'bow')` mounts a gun, `powder(3)` stows kegs,
    // `fireAt('npc.fish_tug', 'ammo.round')` lays on a ship, `fire(90, 200, 'ammo.chain')`
    // fires at a bearing (degrees) and range, `ships()` reads the damage.
    const DEG = Math.PI / 180;
    const hook = {
      arm: (weapon: string, mount: 'bow' | 'port' | 'starboard' | 'hand') => {
        const ship = state.player.ship;
        if (!ship) return 'noShip';
        const why = fitRefusal(combat.defs, ship.classId, ship.weapons, weapon, mount);
        if (why) return why;
        ship.weapons.push({ weapon, mount });
        return 'ok';
      },
      /** Every gun her class carries: the swivel, and cannon on a T2's sides. */
      armFully: () => {
        const ship = state.player.ship;
        if (!ship) return [];
        const mounts = combat.defs.mounts[ship.classId];
        ship.weapons = ship.weapons.filter((w) => w.mount === 'hand');
        for (let i = 0; i < (mounts?.bow ?? 0); i++)
          ship.weapons.push({ weapon: 'weapon.swivel', mount: 'bow' });
        for (let i = 0; i < (mounts?.broadside ?? 0); i++) {
          ship.weapons.push({ weapon: 'weapon.light_cannon', mount: 'port' });
          ship.weapons.push({ weapon: 'weapon.light_cannon', mount: 'starboard' });
        }
        return ship.weapons;
      },
      disarm: () => {
        const ship = state.player.ship;
        if (ship) ship.weapons = ship.weapons.filter((w) => w.mount === 'hand');
      },
      weapons: () => state.player.ship?.weapons ?? [],
      powder: (kegs: number) => {
        addToHold(state.player.cargo, { good: combat.defs.powder.good, qty: kegs });
        return combat.charges();
      },
      charges: () => combat.charges(),
      reloads: () => combat.reloads(),
      fire: (bearingDeg: number, rangeM: number, ammo = 'ammo.round') =>
        combat.fire({ ammo, bearing: bearingDeg * DEG, rangeM }),
      fireAt: (shipId: string, ammo = 'ammo.round') => combat.fire({ ammo, target: shipId }),
      /** Aim mode: `aim('swivel')` enters it, `aimAt(x, z)` lays on the water, `aimFire()`. */
      aim: (weapon?: AimWeapon) => (weapon ? aim.select(weapon) : aim.enter()),
      standDown: () => aim.exit(),
      aimAt: (x: number, z: number) => aim.aimAt(x, z),
      aimAtShip: (shipId: string) => {
        const p = shipsOnWater().find((e) => e.id === shipId)?.transform?.position;
        if (p) aim.aimAt(p.x, p.z);
        return !!p;
      },
      aimFire: () => aim.fire(),
      /** Smoke, splinters and canvas in the air now. */
      fx: () => scene?.combatFx.live() ?? 0,
      /** Puts a ship `rangeM` off on a bearing `relDeg` off the bow, lying across it. */
      place: (shipId: string, relDeg: number, rangeM: number) => {
        const t = playerShip.transform;
        const met = arena?.ships.find((s) => s.entity.id === shipId);
        const e = met?.entity ?? shipsOnWater().find((k) => k.id === shipId);
        if (!t || !e?.transform) return false;
        const b = t.heading + relDeg * DEG;
        const x = t.position.x + Math.sin(b) * rangeM;
        const z = t.position.z - Math.cos(b) * rangeM;
        e.transform.position.x = x;
        e.transform.position.z = z;
        if (met) {
          met.steer.x = x;
          met.steer.z = z;
        }
        return true;
      },
      /** Where a ship is on the screen, CSS pixels (to put the cursor on her in a test). */
      screenOf: (shipId: string) => {
        const p = shipsOnWater().find((e) => e.id === shipId)?.transform?.position;
        const cam = scene?.camera;
        const el = renderer?.renderer.domElement;
        if (!p || !cam || !el) return undefined;
        const v = new Vector3(p.x, p.y + 2, p.z).project(cam);
        const r = el.getBoundingClientRect();
        return { x: r.left + ((v.x + 1) / 2) * r.width, y: r.top + ((1 - v.y) / 2) * r.height };
      },
      cycleAmmo: () => aim.cycleAmmo(),
      aimState: () => ({
        active: aim.active,
        weapon: aim.weapon,
        side: aim.side,
        ammo: aim.ammo,
        hud: aim.hud(),
        card: aim.targetCard(),
        preview: aim.preview(),
        steeringLocked: aim.steeringLocked(),
      }),
      damage: (shipId: string, pool: 'hull' | 'rigging' | 'crew' | 'engine', points: number) =>
        combat.damage(shipId, pool, points),
      explode: (shipId: string) => combat.explode(shipId),
      ships: () => combat.ships(),
      shots: () => combat.shots().length,
      player: () => PLAYER_ID,
    };
    (window as unknown as { __glpCombat: typeof hook }).__glpCombat = hook;
  }
  if (devGui) {
    const { createCombatPanel } = await import('./debug/combat-panel');
    lateDevPanels.push(
      createCombatPanel({
        gui: devGui,
        combat,
        state,
        events: ctx.events,
        player: playerShip,
        ships: () =>
          arena
            ? arena.ships.map((s) => s.entity)
            : [...traffic.shown.values()].map((s) => s.entity),
      }),
    );
  }
  ctx.events.on('LanternChanged', (e) => {
    if (e.reason === 'outOfOil') showNotice('The lamps burned dry: out of lamp oil');
  });
  smuggler.setZone(smugglerZone(zone));
  if (import.meta.env.DEV || params.has('debug')) {
    // `__glpContraband.makeHot('good.rope_canvas', 5)` marks cargo hot until Phase 6's theft
    // can; `alongside()` puts the ship beside the smuggler; `learn()` marks her anchorage.
    const hook = {
      makeHot: (good: string, qty = 99, region = 'region.chequamegon', heat = 1) =>
        economy.makeHot(good, qty, region, heat),
      offer: (port: string, index: number) => economy.offer(port, index),
      state: () => state.contraband,
      present: () => smuggler.present,
      known: () => smuggler.known(),
      learn: () => smuggler.learn('dev'),
      anchorage: () => smuggler.anchorage,
      /** Lays the ship alongside her, stopped, heading her way. */
      alongside() {
        const a = smuggler.anchorage;
        if (!a) return false;
        const heading = (smuggler.def.anchorage.headingDeg * Math.PI) / 180;
        // Abeam to starboard of her, 40 m off.
        placeShip({
          x: a.x + Math.cos(heading) * 40,
          z: a.z + Math.sin(heading) * 40,
          heading,
        });
        return true;
      },
      open: () => smuggler.comeAlongside(shipPose(), speedKn(sailing.state)),
      close: () => smuggler.close(),
    };
    (window as unknown as { __glpContraband: typeof hook }).__glpContraband = hook;
  }

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
    showLie: (r) => ui.setLie(r === undefined, stash.moored === 'docked'),
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
      lie: (until: LieUntil) => stash.actions.lie(until),
      refusal: () => stash.lieRefusal(),
    };
    (window as unknown as { __glpStash: typeof hook }).__glpStash = hook;
  }
  // The Fisherman's fish prices and the First Week checklist (piece C).
  captainRef.current = attachCaptain(ctx, economy.defs, (week) => ui.setFirstWeek(week));
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
  // Capture, jail and the run's end (Phase 5 piece D). Piece C's cutter raises
  // PlayerCaptured; once any arena has ended the captain is jailed (or bound for the rope),
  // with the jail screen over the game.
  const lockup = gameJail().lockup;
  /** Back alongside the lockup's pier, out of the impound: docked, so the port screen opens. */
  const backAboard = async (): Promise<void> => {
    if (machine.mode === 'chart') travelRef.current?.towed();
    const zoneId = portInfo(lockup.port)?.zone;
    const dock = (): void => {
      const berth =
        freeBerths().find((b) => b.dockId === lockup.pier) ??
        sailingOptions.berths.find((b) => b.dockId === lockup.pier);
      if (!berth) return;
      placeShip(berth.pose);
      const h = hazards.state;
      h.mooring = 'docking';
      h.berthId = berth.id;
      h.mooringS = Number.MAX_SAFE_INTEGER;
      h.from = { ...berth.pose };
    };
    if (zoneId && zoneId !== zoneData.id) {
      const def = zoneDef(zoneId);
      await enterZone(zoneId, spawnPose(def), { kind: 'return' }, false, dock);
    } else {
      dock();
      await saveControls.saveNow();
    }
  };
  /**
   * Ends the run (plan 16 §3, plan 12 §9): the summary and logbook go to `lastRun` and
   * every run slot is deleted before the end screen shows. Nothing saves the run again.
   */
  const endTheRun = async (cause: RunEndCause): Promise<void> => {
    if (run.over) return;
    run.over = true;
    const now = state.environment.clock.gameSeconds;
    const last = buildLastRun(law.defs, state, cause, now, new Date());
    ctx.events.emit('RunEnded', { cause });
    if (prepared.db) {
      try {
        await endRun(prepared.db, last, {
          captain: last.captain,
          shipName: last.shipName,
          portrait: last.portrait,
          cause,
          epitaph: last.epitaph,
          headline: last.frontPage.headline,
          summary: last.summary,
          endedAtIso: last.endedAtIso,
          runId: saver?.run.runId,
        });
      } catch (err) {
        console.error('Could not end the run in the save', err);
      }
    }
    machine.pushOverlay('ended');
    input.context = 'menu';
    if (cameraRig) cameraRig.suspended = true;
    ui.setJail(undefined);
    ui.setEnd(last);
    document.body.dataset['run'] = 'ended';
    document.body.dataset['runEnd'] = cause;
  };
  const capture = attachCapture({
    ctx,
    law,
    economy,
    seed: trafficSeed,
    show: (snapshot) => {
      ui.setJail(snapshot);
      document.body.dataset['jail'] = snapshot?.kind ?? 'closed';
    },
    onOpen(open) {
      if (open) {
        machine.pushOverlay('jail');
        input.context = 'menu';
      } else {
        machine.removeOverlay('jail');
        input.context = machine.mode === 'chart' ? 'chart' : 'sailing';
        input.endTick();
      }
      if (cameraRig) cameraRig.suspended = open;
      hudClock = HUD_INTERVAL_S;
    },
    afterSkip: () => ctx.weather.tick(state.environment.clock.gameSeconds, shipPose(), ctx.sea),
    cutterAt: () => lawShips.morrill.pos,
    backAboard,
    endRun: (cause) => endTheRun(cause),
    save: () => saveControls.saveNow(),
  });
  captureRef.current = capture;
  endRef.current = endTheRun;
  /** Jails a capture once the arena it happened in has ended (piece C raises it inside). */
  const takeCapture = (): void => {
    if (machine.mode === 'chart') travelRef.current?.towed();
    // Out of any screen the capture happened behind.
    if (ports.openPort) ports.close();
    if (ports.journalOpen) ports.closeJournal();
    capture.takeNow();
  };
  if (import.meta.env.DEV || params.has('debug')) {
    // `__glpCapture.capture('region.apostles')` is taken as the Morrill would take you.
    const hook = {
      capture(region?: string, how: 'surrender' | 'boarded' = 'surrender') {
        const at = zoneToChart(shipPose(), zoneFrame(zone, zoneData));
        ctx.events.emit('PlayerCaptured', {
          by: 'law.morrill',
          region: region ?? law.region() ?? lockup.region,
          how,
          at,
        });
      },
      pending: () => capture.pending,
      state: () => state.jail,
      serve: () => capture.actions.serve(),
      sendWord: (hideout = 'hideout.stockton') => capture.actions.sendWord(hideout),
      hang: () => capture.actions.hang(),
      leave: () => capture.actions.leave(),
      abandon: () => endTheRun('abandoned'),
      record: () => ({ stats: state.stats, logbook: state.logbook }),
      danger: () => ({ inDanger: run.inDanger, danger: state.danger }),
    };
    (window as unknown as { __glpCapture: typeof hook }).__glpCapture = hook;
  }
  const draftM = shipRecord.draftEmptyM;
  // The harbors' piers (Phase 2 piece G); the greybox pier only without the zone.
  const zoneDocks = (z: LoadedZone | undefined): readonly Dock[] =>
    z ? harborLayouts.flatMap((l) => l.piers) : TEST_BAY.docks;
  const docks = zoneDocks(zone);
  let hudClock = HUD_INTERVAL_S;
  let aimHudClock = 0;
  let aimHudShown = false;

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
  // A Most Wanted harbor asks first (plan 06 §3.2): the first F at its berth only warns.
  let topTierAsked: { berthId: string; untilS: number } | undefined;
  sailingOptions.dockGate = (berthId) => {
    const pier = sailingOptions.berths.find((b) => b.id === berthId)?.dockId;
    const port = pier ? pierPort(pier) : undefined;
    if (!port || !portLaw.topTierAt(port)) return true;
    if (topTierAsked?.berthId === berthId && hudSeconds <= topTierAsked.untilS) {
      topTierAsked = undefined;
      return true;
    }
    topTierAsked = { berthId, untilS: hudSeconds + TOP_TIER_CONFIRM_S };
    notice = {
      text: `Most Wanted here: capture means the rope. F again to dock at ${portInfo(port)?.name ?? 'the pier'}`,
      untilS: hudSeconds + TOP_TIER_CONFIRM_S,
    };
    hudClock = HUD_INTERVAL_S;
    return false;
  };
  // The cutter's captain runs inside the sailing tick, after the arena's helms.
  sailingOptions.law = { step: (dt) => lawAtSea.step(dt) };
  sailingOptions.targets = targets;
  sailingOptions.collisions = collisions;
  sailingOptions.combat = { step: (dt) => combat.step(dt) };
  sailingOptions.helmHeld = () => aim.steeringLocked();
  const sailingMode = createSailingMode(ctx, sailingOptions);
  machine.register({ id: 'mainMenu', enter: () => (input.context = 'menu') }).register(sailingMode);
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
  /** Running dark with a ship close aboard: she can't see you to keep clear (§14.5). */
  const darkChips = (): string[] => {
    if (machine.mode !== 'sailing' || !lantern.runningDark()) return [];
    const near = traffic.nearest(shipPose(), DARK_WARNING_M);
    if (!near || smuggler.isSmuggler(near.id)) return [];
    return [`Running dark: ${near.contact?.name ?? 'a ship'} can't see you`];
  };
  const trafficChips = (): string[] => {
    if (machine.mode !== 'sailing' || hazards.state.mooring !== 'free') return [];
    const near = traffic.nearest(shipPose(), HAIL_RANGE_M);
    if (!near) return [];
    if (smuggler.isSmuggler(near.id)) {
      const chip = smuggler.chip(shipPose(), speedKn(sailing.state));
      return chip ? [chip] : [];
    }
    if (!arena && near.distanceM <= lookRangeM()) return ['F look her over · H hail'];
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
    const near = e.reason === 'noBerth' ? traffic.nearest(shipPose(), lookRangeM()) : undefined;
    if (near && smuggler.isSmuggler(near.id)) {
      const refused = smuggler.comeAlongside(shipPose(), speedKn(sailing.state));
      if (refused) showNotice(refused);
    } else if (near) showCard(traffic.lookOver(near.id));
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
      smuggler.setZone(smugglerZone(zone));
      sailingOptions.berths = freeBerths();
      audio?.setZone({
        stations: signalStations(zone),
        harbors: harborLayouts.flatMap((l) => l.piers.map((p) => p.root)),
        sites: harborSites(harborLayouts),
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
      smuggler.setZone(undefined);
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
            law: { locked: lawAtSea.locked, captured: lawAtSea.captured },
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
    const hook = {
      stats: () => zones.stats,
      enter: enterZoneAt,
      /** Where the ship is and the game clock, to see her sail on behind the journal. */
      pose: () => ({ ...shipPose() }),
      clock: () => state.environment.clock.gameSeconds,
    };
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
      /** Puts the ship at (x, z) in the arena, keeping her heading or turning to `headingDeg`. */
      place: (x: number, z: number, headingDeg?: number) => {
        const heading =
          headingDeg === undefined ? shipPose().heading : (headingDeg * Math.PI) / 180;
        if (arena) placeShip({ x, z, heading });
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
  /** The chart card's law lines (piece E): Wanted where the ship is, the report eye. */
  const chartLawLines = (): { text: string; danger: boolean }[] => {
    const out: { text: string; danger: boolean }[] = [];
    const w = portLaw.wanted(law.region());
    if (w && w.tier > 0) {
      out.push({
        text: w.top
          ? `MOST WANTED in ${w.regionName}: capture means the rope`
          : `${w.tierName} in ${w.regionName}`,
        danger: w.top,
      });
    }
    const r = portLaw.report();
    if (r) {
      out.push({
        text: `Report on its way: ${r.by} to ${r.regionName}, ${r.etaText}${r.more ? ` (+${r.more})` : ''}`,
        danger: false,
      });
    }
    return out;
  };
  const chartTravel = createChartTravel({
    ctx,
    machine,
    layer: chartLayer,
    setHud: (snapshot) => ui.setChart(snapshot && { ...snapshot, law: chartLawLines() }),
    lookout: () => settings.value.chart.lookout,
    zone: () => ({ def: zoneData, frame: zoneFrame(zone, zoneData) }),
    shipPose,
    placeShip,
    enterZone: (id, pose, arrival, onLoaded) => enterZone(id, pose, arrival, false, onLoaded),
    save: () => saveControls.saveNow(),
    pursued: () => pursued || !!arena?.run.pursued || lawAtSea.locked,
    // A look at the chart from the helm can let the ship sail on in the zone behind it.
    sailOn: () => sailOnAllowed(),
    sailTick: (dt) => sailingMode.update?.(dt),
    forecastHours: () => instruments.forecastHours,
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
    // The Morrill and the tug hunt by Wanted and her lookout's real detection (piece C).
    hunter: (c, at, visibilityM) =>
      lawShips.hunter(c, at, state.environment.clock.gameSeconds, visibilityM),
    marks: () => [
      ...(smuggler.known()
        ? [
            {
              at: smuggler.def.anchorage.at,
              label: `${smuggler.def.anchorage.name} (after dark)`,
              kind: 'smuggler' as const,
            },
          ]
        : []),
      // Where the law wants you (piece E), at each region's middle.
      ...portLaw.marks().flatMap((m) => {
        const at = law.defs.regionById.get(m.region)?.anchor;
        return at
          ? [
              {
                at,
                label: m.label,
                kind: m.tier >= 5 ? ('mostWanted' as const) : ('wanted' as const),
              },
            ]
          : [];
      }),
    ],
  });
  travelRef.current = chartTravel;
  // The law reads the ship's live place, not the last save's (decay, crimes, the HUD).
  // In an arena the ship is in the arena's own space: the saved place stands.
  // In an arena the law reads where the encounter is on the chart, so a capture at sea is
  // taken in the region the ship is really in, not the place the voyage was last saved.
  law.locate = () =>
    machine.mode === 'chart'
      ? regionAtChart(law.defs, chartTravel.session.position)
      : arena
        ? regionAtChart(law.defs, arena.encounter.at)
        : inArenaSpace
          ? undefined
          : regionAtZone(law.defs, zoneData.id, shipPose());
  // Trouble ends a passage read through: the journal closes and a look at the chart goes
  // back to the helm, so the player sees what happened (only ever while sailing on).
  const lookUp = (): void => {
    if (ports.journalOpen && !machine.gameplayPaused) ports.closeJournal();
    if (machine.mode === 'chart' && chartTravel.trip === 'look' && sailOnAllowed()) {
      chartTravel.back();
    }
  };
  const ifPlayer = (e: { shipId: string | undefined }): void => {
    if (e.shipId === playerShip.id) lookUp();
  };
  ctx.events.on('ShipGrounded', ifPlayer);
  ctx.events.on('ShipStruck', ifPlayer);
  ctx.events.on('ShipKnockedDown', ifPlayer);
  ctx.events.on('ShipFoundering', ifPlayer);
  ctx.events.on('AnchorDragging', (e) => e.dragging && ifPlayer(e));
  ctx.events.on('EncounterSpotted', lookUp);
  ctx.events.on('VoyageArrived', lookUp);
  // A journal open across an arrival or a change of mode closes with it.
  machine.onTransition(() => {
    if (ports.journalOpen) ports.closeJournal();
  });
  machine.register(chartTravel.mode);
  /** Is the ship inside a harbor set piece, where the chart opens only as a look? */
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
      meet: (kind: string, forced = false) => meetContact(kind, forced),
    };
    (window as unknown as { __glpChart: typeof hook }).__glpChart = hook;
  }
  /**
   * The lookouts report the nearest contact of a kind, as if just sighted; `forced` makes
   * it a hostile closing that can't be avoided. For the arena checks and the danger resume.
   */
  function meetContact(kind: string, forced = false): string | undefined {
    const { session } = chartTravel;
    // Nearest on the water; one lying in port only if none of that kind is out.
    // Traffic, and the sky's squalls and fog banks (`storm`, `fog`).
    const near = allContacts(session)
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
  }

  // Autosaves every couple of minutes and when the tab goes; saveNow skips them in danger.
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
  /** Hunts piece C reports (PursuitChanged), by hunter. */
  const pursuitOn = new Set<string>();
  ctx.events.on('PursuitChanged', (e) => {
    if (e.pursued) pursuitOn.add(e.by);
    else pursuitOn.delete(e.by);
  });
  /**
   * The danger snapshot (plan 16 §4.3): when a hunt begins, the run is written to the
   * `danger` slot with the threat noted, and regular saves wait. A reload while it stands
   * resumes from it with the hunter back on your tail. When the hunt ends the slot is
   * cleared and a normal save follows.
   */
  const setDanger = (on: boolean): void => {
    run.inDanger = on;
    document.body.dataset['danger'] = on ? 'on' : 'off';
    if (on) {
      state.danger = {
        kind: 'pursuit',
        by: [...pursuitOn][0] ?? 'law.morrill',
        since: state.environment.clock.gameSeconds,
        ...(arena ? { at: { ...arena.encounter.at } } : {}),
        heading: shipPose().heading,
      };
      if (!saver) return;
      prepareSave();
      saver
        .save(state, 'danger')
        .then(() => (document.body.dataset['dangerSaved'] = String(state.danger?.since ?? '')))
        .catch((err: unknown) => console.error('Danger snapshot failed', err));
      return;
    }
    delete state.danger;
    if (!saver || run.over || !prepared.db) return;
    const db = prepared.db;
    prepareSave();
    // After any snapshot still being written, so the clear can't land before it.
    void saver
      .save(state)
      .then(() => clearDanger(db))
      .then(() => delete document.body.dataset['dangerSaved'])
      .catch((err: unknown) => console.error('Clearing the danger snapshot failed', err));
  };

  const loop = createLoop({
    tick(dt) {
      // A key that just changed the mode (M off the chart) mustn't act again in the new one.
      const contextBefore = input.context;
      machine.update(dt);
      if (arena?.run.result) leaveArena(arena.run.result);
      // Danger (plan 16 §4.2–4.3): a hunt on snapshots the run; its end clears it.
      const hunted = (pursued || !!arena?.run.pursued || pursuitOn.size > 0) && !run.over;
      if (hunted !== run.inDanger) setDanger(hunted);
      // A capture is taken once the arena it happened in is gone (piece C raises it there).
      if (capture.pending && !arena && !inArenaSpace && !changingZone && !run.over) {
        takeCapture();
      }
      // A key that just changed the mode (M off the chart) mustn't act again in the new one.
      // In an arena, M leaves it (the arena reads ToggleChart); it doesn't open the chart.
      // `arena` is already cleared by the time that press is seen here, so ask whether the
      // ship is still in the arena's space (until the chart or zone takes her back), or the
      // same press opens the chart as a look from the departure zone and the voyage stalls.
      const sameContext = input.context === contextBefore;
      const chartFree = !arena && !inArenaSpace && !changingZone;
      if (sameContext && chartFree && input.context === 'sailing' && input.pressed('ToggleChart')) {
        const refused = chartTravel.fromHelm({ atEdge: atEdge(), inHarbor: inHarbor() });
        if (refused) showNotice(refused);
      }
      // The traffic sails on the clock: in the zone, every tick (Phase 4 piece D), and
      // behind a look at the chart while the ship sails on.
      const inZone = machine.mode === 'sailing' || chartTravel.trip === 'look';
      if (inZone && !arena && !changingZone) {
        if (traffic.step(hazards.state.berthId)) sailingOptions.berths = freeBerths();
        smuggler.step(shipPose());
      }
      lantern.step();
      if (sameContext && input.context === 'sailing' && input.pressed('Lantern')) {
        showNotice(lantern.toggle());
        hudClock = HUD_INTERVAL_S;
      }
      if (machine.mode === 'sailing' && !machine.gameplayPaused && !changingZone) {
        detection.step(dt);
      }
      if (sameContext && input.context === 'sailing' && input.pressed('Hail')) {
        const near = traffic.nearest(shipPose(), HAIL_RANGE_M);
        if (near && smuggler.isSmuggler(near.id)) showNotice('She shows a lantern: come alongside');
        else if (near) showCard(traffic.hail(near.id));
        else showNotice('No ship within hail');
      }
      // A patch or mend kit from the lockers (piece G): not while the port screen is up.
      if (sameContext && !arena && input.context === 'sailing' && input.pressed('Repair')) {
        showNotice(shipyard.useKit());
      }
      // A hostile on the ship's track (or the Morrill after you): put the book down.
      if (hunted && ports.journalOpen && !machine.gameplayPaused) {
        ports.closeJournal();
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
      if (sameContext && machine.mode === 'sailing' && !machine.gameplayPaused && !changingZone) {
        aim.step(input, fireOnSea);
      } else if (aim.active && (machine.mode !== 'sailing' || input.context !== 'sailing')) {
        aim.exit();
      }
      input.endTick();
    },
    frame(alpha, frameSeconds) {
      machine.render(alpha, frameSeconds);
      audio?.update(frameSeconds, machine.mode, machine.hasOverlay('loading'));
      if (audio) audioCuesToDataset(audio);
      ui.setSpyglass(cameraRig?.ship.spyglass ?? false);
      if (cameraRig) {
        cameraRig.ship.setAim(aim.camera());
        cameraRig.setAimCursor(aim.active);
        if (aim.active) aim.setCursor(cameraRig.cursorRay(), frameSeconds);
      }
      if (scene) {
        const w = sailingOptions.wind(
          playerShip.transform?.position.x ?? 0,
          playerShip.transform?.position.z ?? 0,
        );
        // Powder smoke drifts downwind, a little slower than the wind itself.
        const v = w.speedKn * 0.514 * 0.6;
        scene.fxWind.x = Math.sin(w.fromRad + Math.PI) * v;
        scene.fxWind.z = -Math.cos(w.fromRad + Math.PI) * v;
      }
      aimHudClock += frameSeconds;
      if (aimHudClock >= AIM_HUD_INTERVAL_S || (!aim.active && aimHudShown)) {
        aimHudClock = 0;
        aimHudShown = aim.active;
        ui.setAim(aim.hud(), aim.targetCard());
      }
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
        ui.setCaptions([]);
        chartTravel.sampleHud();
      } else if (hudClock >= HUD_INTERVAL_S) {
        hudClock = 0;
        ui.setCaptions(audio?.captionsNow() ?? []);
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
              ...darkChips(),
            ],
            lantern: {
              lit: lantern.state.lit,
              nights: Math.floor(lantern.nights()),
              dark: lantern.runningDark(),
            },
            eye: awarenessChip(detection.keenest),
            wanted: portLaw.wanted(law.region()),
            report: portLaw.report(),
            portName:
              ports.dockedPort && hazards.state.mooring === 'docked' && !ports.openPort
                ? portInfo(ports.dockedPort)?.name
                : stashHereName(),
          }),
        );
      }
    },
  });

  // A new captain lies alongside the starting pier at dawn: the berth is taken as if just
  // docked, so the first tick raises ShipDocked and the port screen opens (piece C).
  if (startPier) {
    const berth =
      freeBerths().find((b) => b.dockId === startPier) ??
      sailingOptions.berths.find((b) => b.dockId === startPier);
    if (berth) {
      placeShip(berth.pose);
      const h = hazards.state;
      h.mooring = 'docking';
      h.berthId = berth.id;
      h.mooringS = Number.MAX_SAFE_INTEGER;
      h.from = { ...berth.pose };
      spawn.x = berth.pose.x;
      spawn.z = berth.pose.z;
      spawn.heading = berth.pose.heading;
      // So a reload before the first autosave comes back to the pier, not the zone's spawn.
      saveNow();
    } else {
      console.warn(`No free berth at ${startPier}; starting at the zone's spawn`);
    }
  }

  // Into the run from the main menu, on the chart if it was saved there (piece D) and no
  // `?zone=` asks for a zone.
  if (machine.mode === 'boot') machine.transition('mainMenu');
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

  // A run saved in the lockup or awaiting the rope opens on the jail screen (piece D).
  if (state.jail) capture.resume();
  // Loaded from the danger snapshot (plan 16 §4.3): the hunter is back on your tail. On the
  // chart she closes and can't be avoided; in a zone, the arena opens around you.
  const danger = state.danger;
  if (danger && !state.jail) {
    document.body.dataset['dangerResumed'] = danger.by;
    if (machine.mode === 'chart') {
      meetContact(danger.by === 'law.chartered_tug' ? 'tug' : 'cutter', true);
    } else {
      await enterArena(
        devEncounter(
          'cutter',
          danger.at ?? zoneToChart(shipPose(), zoneFrame(zone, zoneData)),
          danger.heading ?? shipPose().heading,
          true,
        ),
      );
    }
  }

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
