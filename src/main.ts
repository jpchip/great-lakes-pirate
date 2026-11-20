import { Raycaster, Vector2, Vector3 } from 'three';
import { zoneToChart } from './core/coords';
import { SECONDS_PER_GAME_DAY, dayAndHour, parseTimeWarp } from './core/time';
import { EventBus } from './core/events';
import { codeLabel, DEFAULT_BINDINGS, InputMapper, type InputContext } from './core/input';
import { createLoop } from './core/loop';
import { Rng } from './core/rng';
import {
  clearDanger,
  clearLastRun,
  deleteRun,
  endRun,
  openSaveDb,
  readLastRun,
  readHall,
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
import { sunAt } from './sim/weather/celestial';
import type { SignalStation } from './audio/world-audio';
import { cloneTransform, createGameWorld, type Entity } from './gameplay/ecs';
import { createSchooner } from './gameplay/schooner';
import { npcParade } from './gameplay/npc-ships';
import { attachEconomy } from './gameplay/economy';
import { attachPorts, type PortControl } from './gameplay/port';
import { attachBackRoom } from './gameplay/back-room';
import { attachPoker } from './gameplay/poker';
import { fameTier, gameLaw, wantedTier } from './sim/law/defs';
import { identifyInFlightReports } from './sim/law/law';
import { attachRumors } from './gameplay/rumors';
import { knowsRumor, rumorDefs } from './sim/rumors/rumors';
import { smugglerAnchorage } from './sim/economy/smuggler';
import { attachContracts, contractsOf } from './gameplay/contracts';
import { attachSmugglers, type SmugglerControl } from './gameplay/smuggler';
import { attachStash, type StashControl } from './gameplay/stash';
import { withWorkshop } from './sim/hideouts/crafting';
import { siteAnchorage, siteDef, siteGeo, SITES } from './sim/hideouts/stash';
import { slipwayHead, withSlipway } from './sim/hideouts/slipway';
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
import {
  bearing,
  distance,
  fromWorldChart,
  toWorldChart,
  WORLD_PROJECTION,
} from './sim/chart/geography';
import { OPEN_WATER } from './sim/weather/shelter';
import { FULL_SAIL, speedKn, updateTargetSpeed } from './sim/sailing/controller';
import { jumpPlacesShip } from './debug/jump-panel';
import type { SaveControls } from './debug/overlay';
import type { GameContext, GameEvents } from './modes/context';
import { ModeMachine } from './modes/machine';
import {
  createSailingMode,
  emitHazard,
  type SailingModeOptions,
  type SailingView,
} from './modes/sailing';
import { createChartTravel, type ChartTravel } from './modes/chart-travel';
import { allContacts } from './modes/chart';
import { loadAssets } from './render/assets';
import { browserStorage, isQualityId } from './render/quality';
import { GameRenderer } from './render/renderer';
import { createTestScene } from './render/test-scene';
import { createSailingState } from './sim/sailing/controller';
import type { ZoneFrame } from './core/coords';
import { createHazardState, mooringBerths, type MooringBerth } from './sim/sailing/hazards';
import { PLAYER_SHIP_IDS, sailShipRecord } from './sim/sailing/ships';
import { httpBytes, loadIslandGround, loadZoneTerrain, type LoadedZone } from './sim/terrain/load';
import type { GridField } from './sim/terrain/grid-field';
import {
  ISLANDS,
  placeZoneIslands,
  walkableIslands,
  type PlacedIsland,
} from './sim/islands/on-foot';
import { zoneClearings } from './sim/terrain/clearings';
import { plantTile, TREE_CELL_M } from './sim/terrain/vegetation';
import { attachBuildMode } from './gameplay/build-mode';
import { attachHideouts } from './gameplay/hideouts';
import { attachHideoutLife, type HideoutLife } from './gameplay/hideout-life';
import { siteToZone } from './sim/hideouts/site-frame';
import { mountBuildPanel, type BuildPanelUi } from './ui/build/BuildPanel';
import { attachIslandAshore } from './gameplay/island-ashore';
import { createIslandPosse } from './gameplay/island-posse';
import { recentlySpotted } from './sim/hideouts/life';
import { TEST_BAY, type Dock, type Pose } from './sim/terrain/test-bay';
import { findHarbor, harborZoneId, layoutHarbors, type HarborLayout } from './sim/harbors';
import { workSites } from './audio/harbor-mix';
import { lightsIn, placeLights, viewingSpot } from './sim/lighthouses';
import { ZoneManager } from './sim/terrain/zone-manager';
import {
  APOSTLES_ID,
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
import { hallRecords } from './sim/run/hall';
import type { MenuChoice } from './ui/menu/MainMenu';
import { randomSeed, savedRunSummary } from './ui/menu/model';
import {
  allPortraits,
  backgroundDef,
  hasPerk,
  type BackgroundKey,
} from './sim/character/backgrounds';
import { createNewRun, startingPort } from './sim/character/new-run';
import { withSailingPerks } from './sim/character/perks';
import { attachCaptain } from './gameplay/captain';
import { attachAmbitions } from './gameplay/ambitions';
import { attachDiscovery, placeTalk } from './gameplay/discovery';
import {
  CHARTED_SHOAL_WARN_DRAFTS,
  discoveriesFile,
  worldGeo,
  type Lookout,
} from './sim/discovery/discovery';
import { attachEvents, type GameEvents as SandboxEvents } from './gameplay/events';
import { aboutDate, attachIce, ICE_BOW_UPGRADE } from './gameplay/ice';
import { iceSailingSystem } from './gameplay/ice-sailing';
import { calendarMs, gameSecondsAt } from './sim/ice/season';
import { crewsIdle } from './sim/events/events';
import { attachFeuds } from './gameplay/feuds';
import { attachRivals, createRivalContacts, type GameRivals } from './gameplay/rivals';
import { FEUDS, feudOpen } from './sim/events/feuds';
import { attachLaw, devWitness } from './gameplay/law';
import { attachPortLaw } from './gameplay/port-law';
import { attachPapers } from './gameplay/papers';
import { attachWrecking } from './gameplay/wrecking';
import { createFalseLights, type FalseLightView } from './render/wrecking/false-lights';
import { MARKS } from './sim/wrecking';
import { pierPort } from './sim/harbors';
import { attachLawShips } from './gameplay/law-ships';
import { attachTargets } from './gameplay/targets';
import { attachCollisions } from './gameplay/collisions';
import { attachLandSeparation, type LandSteered } from './gameplay/land-separation';
import { ambientSightM, daylight01 } from './sim/law/perception';
import { aimSightM, barrelTilt, type AimWeapon } from './sim/combat/aim';
import { attachAim } from './gameplay/aim';
import { attachLawAtSea, isLawShip, PURSUES_FROM_TIER } from './gameplay/law-at-sea';
import { attachCombat, PLAYER_ID, type GameCombat } from './gameplay/combat';
import { attachSeaLaw, type SeaLaw } from './gameplay/sea-law';
import { attachAbandon, type Abandon } from './gameplay/abandon';
import { attachEndings } from './gameplay/endings';
import { attachNickname } from './gameplay/nickname';
import { noteDeed, notePlace } from './sim/news/nickname';
import { attachBoarding, type GameBoarding } from './gameplay/boarding';
import { holdCu } from './sim/traffic/cargo';
import { SHIP_RECORDS, serviceSpeedKn } from './sim/sailing/ships';
import { CUTTER_CLASS_ID } from './sim/law/observers';
import { advanceGameTime, WORLD_TICK_GAME_SECONDS } from './core/time';
import { knotsToMs } from './core/coords';
import { fitRefusal } from './sim/combat/armament';
import { addToHold, holdFree } from './sim/economy/hold';
import type { Crate } from './gameplay/onfoot/heist';
import { regionAtChart, regionAtZone } from './sim/law/regions';
import type { Identification, WitnessKind } from './sim/law/witness';
import { attachLantern, DARK_WARNING_M } from './gameplay/lantern';
import { attachDetection, awarenessChip } from './gameplay/detection';
import type { PlacedLight } from './sim/lighthouses';
import { attachRecord } from './gameplay/record';
import { attachCapture } from './gameplay/capture';
import { gameJail } from './sim/law/jail';
import { buildLastRun, type LastRun, type RunEndCause, type RunEndDetail } from './sim/run/run-end';
import { showTabLocked } from './ui/menu/tab-locked';
import { attachAshore, type GameAshore } from './gameplay/ashore';
import { DISTRICTS, districtFootprint, districtFrame } from './gameplay/district/ground';
import { createWatch } from './gameplay/onfoot/watch';
import { createStationWatch, keeperWeather } from './gameplay/onfoot/station-watch';
import { attachKeeperFound } from './gameplay/keeper-found';
import {
  emptyStation,
  keepersOnDuty,
  lampOut,
  placeStation,
  settleStation,
  type PlacedStation,
} from './sim/light-stations';
import type { LightStationState } from './sim/world-state';
import { shopPrompt } from './gameplay/onfoot/shops';
import { gameTools } from './gameplay/onfoot/tools';
import { stealthHud } from './ui/hud/stealth-model';
import { PointerLook } from './core/pointer-look';
import { calendarDate } from './core/time';
import { weekLabel, clockLabel } from './ui/hud/model';

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
  // The Hall of Captains (Phase 9 piece B): its own store, outside the run.
  const hall = prepared.db ? hallRecords(await readHall(prepared.db).catch(() => [])) : [];
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
      hall,
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
    load: async (id) => {
      const read = httpBytes(new URL(zoneDef(id).world, document.baseURI));
      const loaded = await loadZoneTerrain(read);
      // The walkable islands' 1 m ground comes with the zone, so a save ashore on one
      // resumes on it (Phase 7 piece H). A missing island only costs its fine ground.
      const grounds = new Map<string, GridField>();
      await Promise.all(
        walkableIslands(id).map(async (def) => {
          const g = await loadIslandGround(read, loaded.manifest, def.id).catch((err: unknown) => {
            console.warn(`Island ${def.id}: no 1 m ground`, err);
            return undefined;
          });
          if (g) grounds.set(def.id, g);
        }),
      );
      loaded.islandGrounds = grounds;
      return loaded;
    },
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
    // The shady shipwright's guns are gated on Fame (Phase 6 piece E).
    fameTier: () => fameTier(gameLaw(), state.fame.value),
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
  // Discovery and the journal (Phase 9 piece O): what's on the chart, leads and curios. The
  // lookout is wired below, once the camera, the chart and the captain ashore are up.
  const lookoutRef: { current: (() => Lookout | undefined) | undefined } = { current: undefined };
  const noticeRef: { current: ((text: string) => void) | undefined } = { current: undefined };
  const discovery = attachDiscovery({
    ctx,
    law: law.defs,
    notice: (text) => noticeRef.current?.(text),
    lookout: () => lookoutRef.current?.(),
  });
  if (import.meta.env.DEV || params.has('debug')) {
    // `__glpLaw.commit('crime.smuggler_deal', 'region.apostles', 'keeper', 'ship')` commits
    // a crime with one witness; `fileAll()` lands every report now.
    const hook = {
      commit: (
        crime: string,
        region = law.region() ?? 'region.chequamegon',
        kind: WitnessKind | 'none' = 'keeper',
        identification: Identification = 'ship',
        company?: string,
      ) =>
        law.commit({
          crime,
          region,
          witnesses: kind === 'none' ? [] : [devWitness(kind, identification)],
          ...(company ? { company } : {}),
        }),
      fileAll: () => law.fileAll(),
      harbor: (port: string) => portLaw.harbor(port),
      pay: (port: string, kind: 'fine' | 'bribe') => portLaw.pay(port, kind),
      dockCheck: (port: string) => portLaw.dockCheck(port),
      intercept: (reportId: string) => law.intercept(reportId),
      setTier: (region: string, tier: number) => law.setTier(region, tier),
      setHeat: (region: string, heat: number) => law.setHeat(region, heat),
      /** Sets Fame outright (Phase 9 piece B's checks: the nickname, Turn Lawman). */
      setFame: (value: number) => {
        state.fame.value = value;
      },
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
    // Copycat rivals' ships (Phase 9 piece E), off the water until one takes to the lake.
    ...createRivalContacts(),
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
    // Combat (piece G).
    const combatCue = a.combat.lastCue;
    if (combatCue && d['combatCue'] !== combatCue) d['combatCue'] = combatCue;
    const chase = String(a.combat.chase);
    if (d['chase'] !== chase) d['chase'] = chase;
    // Ashore (Phase 7 piece I).
    const steps = String(a.foot.levels.steps);
    if (d['footSteps'] !== steps) d['footSteps'] = steps;
    const step = a.foot.levels.lastStep;
    if (step && d['footStep'] !== step) d['footStep'] = step;
    const footCue = a.foot.levels.last;
    if (footCue && d['footCue'] !== footCue) d['footCue'] = footCue;
    const hideoutCue = a.hideout.levels.last;
    if (hideoutCue && d['hideoutCue'] !== hideoutCue) d['hideoutCue'] = hideoutCue;
    const still = a.hideout.levels.still.toFixed(2);
    if (d['hideoutStill'] !== still) d['hideoutStill'] = still;
    if (a.ui.last && d['uiCue'] !== a.ui.last) d['uiCue'] = a.ui.last;
    const beds = Object.entries(a.foot.levels.beds)
      .filter(([, g]) => g > 0.01)
      .map(([id]) => id)
      .join(' ');
    if (d['footBeds'] !== beds) d['footBeds'] = beds;
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
  /** Going ashore (Phase 7 piece A); attached once the berths and the fade are. */
  const ashoreRef: { current: GameAshore | undefined } = { current: undefined };
  const goAshoreRef: { current: (() => void) | undefined } = { current: undefined };
  const ashoreOfferedRef: { current: () => boolean } = { current: () => false };
  /** Readies the state for a save: the RNG, where the ship is, her damage. */
  const prepareSave = (): void => {
    state.environment.rng = ctx.rng.getState();
    if (!changingZone && !travelRef.current?.record(state) && !inArenaSpace)
      recordZonePose(state, zoneData.id, shipPose());
    ashoreRef.current?.record(state);
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
      // Ashore (Phase 7 piece A): where you stand, the boat and your health.
      ashoreRef.current?.record(state);
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
  // Hideout life (Phase 8 piece F): sleep, refuge, spotting and salvage; attached with the
  // hideouts below, read earlier by the law at sea and the saloons.
  const lifeRef: { current: HideoutLife | undefined } = { current: undefined };
  const captainRef: { current: ReturnType<typeof attachCaptain> | undefined } = {
    current: undefined,
  };
  // Ambitions (Phase 8 piece H); attached with the captain.
  const ambitionsRef: { current: ReturnType<typeof attachAmbitions> | undefined } = {
    current: undefined,
  };
  // Jail and the run's end (piece D); attached once the ports are up.
  const captureRef: { current: ReturnType<typeof attachCapture> | undefined } = {
    current: undefined,
  };
  const endRef: {
    current: ((cause: RunEndCause, detail?: RunEndDetail) => Promise<void>) | undefined;
  } = {
    current: undefined,
  };
  /** Boarding a prize (Phase 6 piece D); attached once the guns and the captains are. */
  const boardingRef: { current: GameBoarding | undefined } = { current: undefined };
  const abandonRef: { current: Abandon | undefined } = { current: undefined };
  /** Sandbox events and letters (Phase 9 piece A); attached once the papers are. */
  const eventsRef: { current: SandboxEvents | undefined } = { current: undefined };
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
      fence: (index, qty) => portsRef.current?.actions.fence?.(index, qty),
      buyGun: (gunId) => portsRef.current?.actions.buyGun?.(gunId),
      pokerDeal: (stake) => portsRef.current?.actions.pokerDeal?.(stake),
      pokerBet: (action) => portsRef.current?.actions.pokerBet?.(action),
      pokerDraw: (discards, palm) => portsRef.current?.actions.pokerDraw?.(discards, palm),
      pokerCaught: (how) => portsRef.current?.actions.pokerCaught?.(how),
      // Piece E's harbor master tab offered Pay but nothing carried it to the game.
      payHarbor: (kind) => portsRef.current?.actions.payHarbor?.(kind),
      layUp: () => portsRef.current?.actions.layUp?.(),
      buyPaper: (paper) => portsRef.current?.actions.buyPaper?.(paper),
      readLetter: (key) => portsRef.current?.actions.readLetter?.(key),
      answerLetter: (key, choice) => portsRef.current?.actions.answerLetter?.(key, choice),
      close: () => portsRef.current?.close(),
      castOff: () => portsRef.current?.actions.castOff(),
      goAshore: () => goAshoreRef.current?.(),
      wait: (until) => portsRef.current?.actions.wait?.(until),
      closeJournal: () => portsRef.current?.closeJournal(),
      openDocked: () => {
        if (machine.mode !== 'sailing' || machine.overlayOpen) return;
        if (!portsRef.current?.openDocked()) stashRef.current?.openHere();
      },
    },
    boarding: {
      intimidate: () => boardingRef.current?.actions.intimidate(),
      fight: () => boardingRef.current?.actions.fight(),
      withdraw: () => boardingRef.current?.actions.withdraw(),
      take: (key, qty) => boardingRef.current?.actions.take(key, qty),
      quickGrab: () => boardingRef.current?.actions.quickGrab(),
      doneLooting: () => boardingRef.current?.actions.doneLooting(),
      choose: (choice) => boardingRef.current?.actions.choose(choice),
      close: () => boardingRef.current?.actions.close(),
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
      craft: (recipe, batches, stackIndex) =>
        stashRef.current?.actions.craft(recipe, batches, stackIndex),
      takeThing: (id, qty) => stashRef.current?.actions.takeThing(id, qty),
      stashThing: (id, qty) => stashRef.current?.actions.stashThing(id, qty),
      slipwayRepair: () => stashRef.current?.actions.slipwayRepair(),
      slipwayInstall: (id) => stashRef.current?.actions.slipwayInstall(id),
      buildShip: () => stashRef.current?.actions.buildShip(),
      toYard: () => stashRef.current?.actions.toYard(),
      close: () => stashRef.current?.actions.close(),
      castOff: () => stashRef.current?.actions.castOff(),
      goAshore: () => stashRef.current?.actions.goAshore(),
      setCurio: (id, show) => stashRef.current?.actions.setCurio(id, show),
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
    clearFirstWeek: () => captainRef.current?.clearFirstWeek(),
    ambitions: {
      pin: (id) => void ambitionsRef.current?.pin(id),
      unpin: (id) => ambitionsRef.current?.unpin(id),
      clearMark: (id) => ambitionsRef.current?.clearMark(id),
      setFolded: (folded) => ambitionsRef.current?.setFolded(folded),
    },
    jail: {
      serve: () => captureRef.current?.actions.serve(),
      sendWord: (hideout) => captureRef.current?.actions.sendWord(hideout),
      jailbreak: () => captureRef.current?.actions.jailbreak(),
      hang: () => captureRef.current?.actions.hang(),
      leave: () =>
        abandonRef.current?.open ? abandonRef.current.leave() : captureRef.current?.actions.leave(),
      leaveAlt: () => abandonRef.current?.leaveAlt(),
    },
    onAbandon: () => void endRef.current?.('abandoned'),
    onFrontPageClosed: () => frontPageRef.current?.(),
    eventScene: {
      choose: (choice) => eventsRef.current?.choose(choice),
      close: () => eventsRef.current?.closeScene(),
    },
    onTakeToChart: () => {
      if (machine.mode === 'sailing' && !machine.overlayOpen) travelRef.current?.takeToChart();
    },
    onGoAshore: () => {
      if (machine.mode === 'sailing' && !machine.overlayOpen) goAshoreRef.current?.();
    },
    onFootPrompt: () => {
      if (machine.mode === 'onFoot' && !machine.overlayOpen) input.trigger('Interact');
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
      if (cameraRig) cameraRig.suspended = open || machine.mode === 'onFoot';
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
    spotted: () => lifeRef.current?.spottedTalk() ?? [],
    eventTalk: () => eventsRef.current?.talk() ?? [],
    placeTalk: () => placeTalk(state.discovery),
  });
  // The papers (Phase 5 piece F): headlines from the bus's news, Fame from the printing, the
  // newsstand in port, storm signals, and the tier-5 front page once per region.
  let contextBeforeFrontPage: InputContext = 'sailing';
  let frontPageUp = false;
  const showFrontPage = (): void => {
    // In a fight the page waits for the arena to end (Phase 6 playtest: it used to cover the
    // fight that fired it); `ArenaExited` below shows it then.
    if (
      frontPageUp ||
      arena ||
      captureRef.current?.open ||
      captureRef.current?.pending ||
      ctx.state.jail
    )
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
  // Copycat rivals (Phase 9 piece E), attached once the events are: the papers name them.
  let rivals: GameRivals | undefined = undefined;
  const papers = attachPapers({
    ctx,
    law,
    seed: trafficSeed,
    goodName: (good) => economy.defs.goods.get(good)?.name ?? good,
    lawShips,
    ownerName: (id) => traffic.defs.factions.get(id)?.name,
    rivalWho: (id) => rivals?.who(id),
    // A region gone Most Wanted: its paper's front page fills the screen.
    onFrontPage: () => queueMicrotask(showFrontPage),
  });
  // One held back behind the lockup shows on release.
  ctx.events.on('Released', () => queueMicrotask(showFrontPage));
  // A front page held back for a fight shows once the arena is left.
  ctx.events.on('ArenaExited', () => queueMicrotask(showFrontPage));
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
  // Wrecking (Phase 9 piece I): false lights at the marks, ships judged as they pass on the
  // world tick, the stranded lying on their shoals to be boarded, and the law's inquiry.
  const wrecking = attachWrecking({
    ctx,
    law,
    seed: trafficSeed,
    geo: westernSuperiorChart(),
    traffic,
    economy: economy.defs,
    papers,
    playerAt: () =>
      machine.mode === 'sailing' && !arena
        ? { zoneId: zoneData.id, ...shipPose(), lit: !lantern.runningDark() }
        : undefined,
  });
  /** The loaded zone's frame when it's the Apostles (the wrecking marks are all there). */
  const marksFrame = () =>
    zone && zoneData.id === APOSTLES_ID ? manifestFrame(zone.manifest) : undefined;
  traffic.setStranded(() => {
    const frame = marksFrame();
    if (!frame) return [];
    return wrecking.stranded().map((s) => ({
      shipId: s.shipId,
      pose: wrecking.shoalPose(s.mark, frame),
      manifest: wrecking.manifestOf(s),
    }));
  });
  if (import.meta.env.DEV || params.has('debug')) {
    // `__glpWrecking.state()` reads the slice; `.rig(mark)` puts you at a mark's rig spot
    // with a rig in the lockers; `.set()` presses F there; `.step()` judges the passing ships
    // now; `.conditions(mark)` reads the night there; `.night()` the moon-cussing check.
    const hook = {
      state: () => wrecking.state,
      marks: () => MARKS.map((m) => m.id),
      spots: () => {
        const f = marksFrame();
        return f ? Object.fromEntries(wrecking.rigSpots(f)) : {};
      },
      shoal: (mark: string) => {
        const f = marksFrame();
        return f && wrecking.shoalPose(mark, f);
      },
      set: () => {
        const f = marksFrame();
        const msg = f ? wrecking.setRig(shipPose(), f) : 'Not in the Apostles';
        showNotice(msg);
        return msg;
      },
      step: () => wrecking.step(),
      /** A rig (or `n`) in the lockers. */
      give: (n = 1) => {
        state.player.stores['store.false_light'] =
          (state.player.stores['store.false_light'] ?? 0) + n;
      },
      /** Lays the ship off a mark, seaward of its shoal, stopped, within reach of the rig spot. */
      goto: (mark: string) => {
        const f = marksFrame();
        const r = f && wrecking.rigSpots(f).get(mark);
        if (!f || !r) return false;
        const sh = wrecking.shoalPose(mark, f);
        const dx = sh.x - r.x;
        const dz = sh.z - r.z;
        const d = Math.hypot(dx, dz) || 1;
        const off = Math.min(60, d + 30);
        placeShip({
          x: r.x + (dx / d) * off,
          z: r.z + (dz / d) * off,
          heading: sh.heading + Math.PI / 2,
        });
        sailing.state.speed = 0;
        sailing.state.sailLevel = sailing.state.sailSetting = 0;
        return true;
      },
      strand: (mark: string, witnessed = false) => wrecking.devStrand(mark, witnessed),
      lit: () => wrecking.lit(),
      stranded: () => wrecking.stranded(),
      conditions: (mark: string) => wrecking.conditions(mark),
      night: () => wrecking.wreckingNight(),
    };
    (window as unknown as { __glpWrecking: typeof hook }).__glpWrecking = hook;
  }
  // Sandbox events and letters (Phase 9 piece A): drawn on the world tick, met on a voyage
  // or on docking as a scene on paper, and letters at the harbor master's.
  let contextBeforeScene: InputContext = 'sailing';
  let sceneUp = false;
  const sandboxEvents = attachEvents({
    ctx,
    law: law.defs,
    economy: economy.defs,
    papers,
    traffic,
    gale: (port) => papers.signal(port) !== undefined,
    wreckingNight: () => wrecking.wreckingNight(),
    onVoyage: () => {
      const travel = travelRef.current;
      return (
        machine.mode === 'chart' &&
        !machine.overlayOpen &&
        travel?.trip === 'sea' &&
        !!travel.session.voyage &&
        !travel.session.pending
      );
    },
    showScene: (scene) => ui.setEventScene(scene),
    onSceneOpen(open) {
      if (open === sceneUp) return;
      sceneUp = open;
      if (open) {
        if (document.pointerLockElement) document.exitPointerLock();
        machine.pushOverlay('dialog');
        contextBeforeScene = input.context;
        input.context = 'menu';
        if (cameraRig) cameraRig.suspended = true;
      } else {
        machine.removeOverlay('dialog');
        input.context = contextBeforeScene;
        input.endTick();
        if (cameraRig) cameraRig.suspended = machine.overlayOpen || machine.mode === 'onFoot';
      }
      document.body.dataset['eventScene'] = open ? 'open' : 'closed';
    },
  });
  eventsRef.current = sandboxEvents;
  // The year turning (Phase 9 piece K): the run's ice, freeze-up and ice-out, the first boat
  // into Duluth after the ice, and the Mataafa storm.
  const gameIce = attachIce({
    ctx,
    seed: trafficSeed,
    contacts: () => traffic.contacts,
    economy: economy.defs,
    fire: (id, port) => {
      sandboxEvents.fire(id, port);
    },
  });
  /** Runs the clock on by world ticks, as sleeping does (the dev hook and laying up). */
  const passWorldTime = (seconds: number): void => {
    const clock = state.environment.clock;
    const ticks = Math.max(1, Math.ceil(seconds / WORLD_TICK_GAME_SECONDS));
    for (let k = 0; k < ticks; k++) {
      const n = advanceGameTime(clock, WORLD_TICK_GAME_SECONDS);
      for (let i = 0; i < n; i++) ctx.events.emit('WorldTick', { gameSeconds: clock.gameSeconds });
    }
  };
  if (import.meta.env.DEV || params.has('debug')) {
    const geoIce = westernSuperiorChart();
    const hook = {
      /** The ice at a lon/lat now. */
      at: (lon: number, lat: number) => gameIce.at(geoIce.projection.geoToChart({ lat, lon })),
      /** A port's harbor: frozen in now, and its freeze-up and ice-out this winter (ISO dates). */
      harbor: (port: string) => {
        const t = state.environment.clock.gameSeconds;
        const season = gameIce.ice.harborSeason(port, t);
        const iso = (x?: number) =>
          x === undefined ? undefined : new Date(calendarMs(x)).toISOString().slice(0, 10);
        return {
          closed: gameIce.harborClosed(port),
          freezeUp: iso(season.closeAt),
          iceOut: iso(season.openAt),
        };
      },
      /** This winter's roll. */
      winter: () => {
        const w = gameIce.ice.winter(state.environment.clock.gameSeconds);
        return { year: w.year, severity: w.severity, fallStorms: w.fallStorms };
      },
      state: () => gameIce.state,
      /** Runs the clock on to a calendar date (`'1900-12-20'`), world tick by world tick. */
      skipTo: (iso: string) => {
        const target = gameSecondsAt(Date.parse(`${iso}T00:00:00Z`));
        const t = state.environment.clock.gameSeconds;
        if (target > t) passWorldTime(target - t);
        ctx.weather.tick(state.environment.clock.gameSeconds, shipPose(), ctx.sea);
        return new Date(calendarMs(state.environment.clock.gameSeconds)).toISOString();
      },
      /** Fits (or takes off) the ice bow without a yard. */
      iceBow: (on = true) => {
        const ship = state.player.ship;
        if (!ship) return;
        ship.upgrades = ship.upgrades.filter((u) => u !== ICE_BOW_UPGRADE);
        if (on) ship.upgrades.push(ICE_BOW_UPGRADE);
      },
    };
    (window as unknown as { __glpIce: typeof hook }).__glpIce = hook;
  }
  if (import.meta.env.DEV || params.has('debug')) {
    // `__glpEvents.fire('event.herring_run')` fires one now (`fire(id, 'port.bayfield')` at a
    // port); `.check()` runs a draw; `.state()` and `.letters()` read them back.
    const hook = {
      fire: (id: string, port?: string) => sandboxEvents.fire(id, port),
      check: () => sandboxEvents.check(),
      state: () => sandboxEvents.state,
      letters: () => sandboxEvents.letters(),
      scene: () => sandboxEvents.scene(),
      choose: (choice: string) => sandboxEvents.choose(choice),
      close: () => sandboxEvents.closeScene(),
      talk: () => sandboxEvents.talk(),
      docked: (port: string) => sandboxEvents.docked(port),
    };
    (window as unknown as { __glpEvents: typeof hook }).__glpEvents = hook;
  }
  // The Hollister feud (Phase 9 piece D): sales, crimes and the clock move it on; its buyers
  // set what you're paid for fish at Bayfield.
  const feuds = attachFeuds({
    ctx,
    events: sandboxEvents,
    companyName: (id) => traffic.defs.factions.get(id)?.short ?? 'The company',
  });
  economy.sellFactor = (port, good) => feuds.sellTerms(port, good)?.factor ?? 1;
  // Copycat rivals (Phase 9 piece E): from Fame 2 they take to your lanes, copy your methods
  // and share your blame; a parley comes by letter; beaten, they leave a lead to their stash.
  rivals = attachRivals({
    ctx,
    law,
    events: sandboxEvents,
    traffic,
    projection: westernSuperiorChart().projection,
    seed: `${trafficSeed}-traffic`,
    gale: (port) => papers.signal(port) !== undefined,
    lead: (input) => {
      discovery.lead(input);
    },
    notice: (text) => noticeRef.current?.(text),
  });
  const gameRivals = rivals;
  if (import.meta.env.DEV || params.has('debug')) {
    // `__glpRivals.list()` reads the rivals; `.emerge()` brings one now; `.raid(id)` has them
    // rob now; `.parley(id)` has them write; `.defeat(id)` beats them; `.state()` is the slice.
    const hook = {
      state: () => gameRivals.state,
      list: () => gameRivals.list(),
      check: () => gameRivals.check(),
      emerge: () => gameRivals.emerge()?.id,
      raid: (id: string, method?: Parameters<GameRivals['raid']>[1]) => gameRivals.raid(id, method),
      parley: (id: string) => gameRivals.parley(id),
      defeat: (id: string, how?: 'taken' | 'sunk') => gameRivals.defeat(id, how),
      leave: (id: string, how: 'caught' | 'lost' | 'retired') => gameRivals.leave(id, how),
      contact: (id: string) => {
        const r = gameRivals.state.list.find((x) => x.id === id);
        return r ? traffic.contacts.find((c) => c.id === `ship.rival_${r.slot}`) : undefined;
      },
    };
    (window as unknown as { __glpRivals: typeof hook }).__glpRivals = hook;
  }
  if (import.meta.env.DEV || params.has('debug')) {
    // `__glpFeud.state()` reads the Hollister feud; `.check()` moves it on if a beat is due;
    // `.pressure()` is the pressure by method.
    const hook = {
      state: () => feuds.state(),
      pressure: () => feuds.pressure(),
      check: () => feuds.check(),
      sellTerms: (port: string, good: string) => feuds.sellTerms(port, good),
      shunned: () => feuds.shunned(),
    };
    (window as unknown as { __glpFeud: typeof hook }).__glpFeud = hook;
  }
  // Your nickname (Phase 9 piece B): coined by the papers at Fame tier 1 from your record,
  // changing with it, rerolled once by a letter to the editor.
  const nickname = attachNickname({
    ctx,
    law: law.defs,
    news: papers.defs,
    events: sandboxEvents,
    story: (input) => papers.story(input),
    seed: trafficSeed,
    notice: (text) => noticeRef.current?.(text),
  });
  if (import.meta.env.DEV || params.has('debug')) {
    // `__glpNickname.state()` reads the record and the name; `.deed('crime.killing', 3)`
    // counts deeds the papers named you for; `.place('site.stockton', 8)` makes a haunt;
    // `.check()` reads the record again; `.reroll()` is the letter to the editor.
    const hook = {
      state: () => nickname.state,
      current: () => nickname.current(),
      check: () => nickname.check(),
      reroll: () => nickname.reroll(),
      deed: (crime: string, n = 1) => {
        for (let i = 0; i < n; i++) noteDeed(nickname.state, crime);
      },
      place: (place: string, weight = 1) => notePlace(nickname.state, place, weight),
    };
    (window as unknown as { __glpNickname: typeof hook }).__glpNickname = hook;
  }
  // The back room after dark (Phase 6 piece E): the fence and the shady shipwright.
  const backRoom = attachBackRoom({
    ctx,
    economy,
    shipyard,
    informRisk: (port) => {
      const region = portLaw.regionOf(port);
      return region ? portLaw.informRisk(region) : undefined;
    },
  });
  // Poker night (Phase 9 piece C): a card table in every saloon after supper.
  const poker = attachPoker({
    ctx,
    economy,
    contracts,
    seed: trafficSeed,
    runSeed: () => state.environment.weather.noiseSeed,
    commit: (input) => law.commit(input),
    regionOf: (port) => portLaw.regionOf(port),
  });
  if (import.meta.env.DEV || params.has('debug')) {
    // `__glpPoker.table('port.bayfield')` reads tonight's table; `.state()` the save's slice;
    // `.give(cents)` and `.cheats(port, n)` set up a test.
    const hook = {
      table: (port: string) => poker.table(port),
      state: () => poker.state,
      open: (port: string) => poker.isOpen(port),
      /** Puts cash in your purse, to sit a big game. */
      give: (cents: number) => (ctx.state.player.purse += cents),
      /** Sets the palmed cards already tried at a port's table tonight (the odds of being seen). */
      cheats: (port: string, n: number) => {
        const t = poker.table(port);
        if (t) t.cheats = n;
      },
    };
    (window as unknown as { __glpPoker: typeof hook }).__glpPoker = hook;
  }
  const ports = attachPorts({
    ctx,
    economy,
    journal: () => discovery.journal(),
    poker,
    law: portLaw,
    papers,
    events: sandboxEvents,
    // Frozen in (piece K): the harbor master lays her up until the ice goes out.
    winter: {
      frozenUntil: (port) =>
        gameIce.harborClosed(port) ? aboutDate(gameIce.openAgainAt(port)) : undefined,
      layUp: (port) => {
        const at = gameIce.openAgainAt(port);
        const t = state.environment.clock.gameSeconds;
        if (at === undefined || at <= t) return "The harbor's open.";
        passWorldTime(at - t);
        ctx.weather.tick(state.environment.clock.gameSeconds, shipPose(), ctx.sea);
        void saveControls.saveNow();
        return 'The winter passes ashore. The ice is going out of the harbor, and she lies ready at the dock.';
      },
    },
    feuds,
    backRoom,
    contracts,
    hazards,
    rumors,
    shipyard,
    // A port with a built district (Bayfield): the back room is walked into, through the saloon.
    walkInBackRoom: (port) => DISTRICTS.some((d) => d.port === port),
    berthPier: (berthId) => sailingOptions.berths.find((b) => b.id === berthId)?.dockId,
    showPort: (snapshot) => ui.setPort(snapshot),
    showJournal: (snapshot) => ui.setJournal(snapshot),
    onOpen(open) {
      if (open) {
        // Looking about on foot holds the pointer: a counter's screen or the journal needs it
        // back at once, not after an Esc (a click on the scene takes it again after).
        if (document.pointerLockElement) document.exitPointerLock();
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
    ashore: { offered: () => ashoreOfferedRef.current() },
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
  // Phase 6 piece E: every boat in `smuggler.json` whose zone is built (the Siskiwit Bay
  // smuggler comes with her zone).
  const smuggler = attachSmugglers({
    ctx,
    economy,
    // The informant's risk on her screen, from the Wanted tier in her waters (piece E).
    show: (snapshot, def) =>
      ui.setSmuggler(
        snapshot && {
          ...snapshot,
          informRisk: portLaw.informRisk(def.anchorage.region),
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
  // The lighthouse stations you can land at (plan 11 §18.4 piece H), placed with the lights.
  let placedStations: { lights: readonly PlacedLight[]; stations: PlacedStation[] } = {
    lights: [],
    stations: [],
  };
  const zoneStations = (): readonly PlacedStation[] => {
    const lights = zoneLights();
    if (placedStations.lights !== lights) {
      const terrain = zone?.terrain;
      placedStations = {
        lights,
        stations: terrain
          ? lights.flatMap((p) => placeStation(p, (x, z) => terrain.heightAt(x, z)) ?? [])
          : [],
      };
    }
    return placedStations.stations;
  };
  const stationRecord = (lightId: string): LightStationState =>
    ((state.lightStations ??= {})[lightId] ??= emptyStation());
  /**
   * The zone's lights as the sea sees them now: a doused lamp dark (no glow, no beam), and
   * only the keepers at their posts watching. Time passes at each station first.
   */
  const stationLights = (): readonly PlacedLight[] => {
    const t = state.environment.clock.gameSeconds;
    return zoneLights().map((p) => {
      const st = state.lightStations?.[p.def.id];
      if (!st) {
        scene?.lighthouses?.setDark(p.def.id, false);
        return p;
      }
      settleStation(p.def, st, t);
      const dark = lampOut(st);
      scene?.lighthouses?.setDark(p.def.id, dark);
      return {
        ...p,
        def: { ...p.def, lit: p.def.lit && !dark, keepers: keepersOnDuty(p.def, st, t) },
      };
    });
  };
  const detection = attachDetection({
    ctx,
    player: playerShip,
    zoneId: () => (zone ? zone.manifest.zone : undefined),
    lights: stationLights,
    shipName: (id) =>
      traffic.contacts.find((c) => c.id === id)?.name ??
      arena?.encounter.ships.find((s) => s.id === id)?.name,
    ignore: (id) => smuggler.isSmuggler(id),
    beamClock: () => scene?.beamSeconds ?? 0,
  });
  // The law asks piece B's watchers who saw a crime at sea (plan 06 §2.1, §7.1).
  law.witnesses = detection;
  // The keepers' log, and a lone keeper found dead a week or two after (plan 06 §6.2).
  const keeperFound = attachKeeperFound({ ctx, law, notice: (text) => showNotice(text) });
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
  /** The combat core, attached below: the Morrill's bow gun fires on its ballistics. */
  const late: { combat?: GameCombat } = {};
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
    refuge: () => lifeRef.current?.refuge(),
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
    combat: () => late.combat,
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
  // Every round, in the sea or in a ship: one in the water across her bow is a warning shot,
  // and any within earshot puts her captain on the alert (piece C's `shotLanded`).
  ctx.events.on('ShotLanded', (e) => {
    targets.shotLanded({ x: e.at.x, z: e.at.z }, e.on === 'ship' ? e.shipId : undefined);
  });
  const collisions = attachCollisions({
    ctx,
    movable: (e) => !!arena || (!!e.id && traffic.isHeld(e.id)),
    helmOf: (e) => arena?.ships.find((s) => s.entity === e)?.steer.helm ?? targets.helmOf(e),
  });
  const landSeparation = attachLandSeparation({
    ctx,
    steered: () => {
      const play = arena;
      if (play) {
        return play.ships.map(({ entity, steer }) => ({
          entity,
          steer,
          land: play.land,
        }));
      }
      const out: LandSteered[] = [];
      for (const p of targets.steeredLand()) {
        const land = zoneLandFor(p.draftM);
        if (land) out.push({ entity: p.entity, steer: p.steer, land });
      }
      for (const p of lawAtSea.steeredLand()) {
        const land = zoneLandFor(p.draftM);
        if (land) out.push({ entity: p.entity, steer: p.steer, land });
      }
      return out;
    },
  });
  ctx.events.on('ZoneEntered', () => targets.reset());
  // Wrecking in the zone (Phase 9 piece I): a ship stranded at a mark has struck where she
  // lies, to be boarded from the deep side; the rigs burning are drawn on their headlands.
  let falseLights: FalseLightView | undefined;
  if (scene) {
    falseLights = createFalseLights();
    scene.scene.add(falseLights.group);
  }
  const syncWrecking = (): void => {
    for (const s of wrecking.stranded()) {
      if (traffic.shown.has(s.shipId) && !targets.isStruck(s.shipId)) {
        targets.strike(s.shipId, 'aground on the shoal');
      }
    }
    if (!falseLights) return;
    const frame = marksFrame();
    const z = zone;
    if (!frame || !z) {
      falseLights.sync([]);
      return;
    }
    const spots = wrecking.rigSpots(frame);
    falseLights.sync(
      wrecking.lit().flatMap((r) => {
        const p = spots.get(r.mark);
        if (!p) return [];
        const groundM = z.terrain.contains(p.x, p.z)
          ? Math.max(0, z.terrain.heightAt(p.x, p.z))
          : 0;
        return [{ id: r.mark, x: p.x, z: p.z, groundM }];
      }),
    );
  };
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
  /** Every NPC ship on the water now, the law's among them (arena or zone). */
  const shipsOnWaterAll = (): Entity[] =>
    arena ? arena.ships.map((s) => s.entity) : [...traffic.shown.values()].map((s) => s.entity);
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
    // The law's rounds never sink you unless you fired on her (Phase 6 piece F, §14.3 #10).
    playerHullFloor: (shooter) => {
      const e = shipsOnWaterAll().find((k) => k.id === shooter);
      if (!e || !isLawShip(e) || lawAtSea.hostile(shooter)) return 0;
      return hazards.cls.hullHP * 0.2;
    },
    // The sea's roll throws the barrel off its sight (piece B); her steady heel is laid out.
    barrelTilt: (mount) => {
      const t = playerShip.transform;
      return t
        ? barrelTilt(mount, { roll: t.roll ?? 0, pitch: t.pitch ?? 0, heel: sailing.state.heel })
        : 0;
    },
  });
  late.combat = combat;
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
  // The fire button counts unless it went down on a control (a button, a field, the dev
  // panel): the HUD layer covers the whole screen, so the click is rarely on the canvas.
  let fireOnSea = false;
  window.addEventListener(
    'mousedown',
    (e) => {
      const target = e.target instanceof Element ? e.target : undefined;
      fireOnSea =
        !!scene && !target?.closest('button, a, input, select, textarea, label, .lil-gui');
    },
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
  // Combat audio (piece G) hears the shots in the air and how the captains stand.
  audio?.setCombatSource({ shots: () => combat.shots(), captains: () => targets.captains() });
  // Boarding, looting and the aftermath (Phase 6 piece D): F alongside a target under 2 kn.
  // Its screens pause the game like the port screen's; looting runs the clock.
  let contextBeforeBoarding: InputContext = 'sailing';
  /** Runs the clock on, every world tick with it (looting, the boat, the yard). */
  const passGameTime = (gameSeconds: number): void => {
    const clock = state.environment.clock;
    const before = dayAndHour(clock.gameSeconds).day;
    const n = advanceGameTime(clock, gameSeconds);
    for (let i = 0; i < n; i++) ctx.events.emit('WorldTick', { gameSeconds: clock.gameSeconds });
    const after = dayAndHour(clock.gameSeconds).day;
    if (after !== before) ctx.events.emit('DayChanged', { day: after });
    ctx.weather.tick(clock.gameSeconds, shipPose(), ctx.sea);
  };
  const boarding = attachBoarding({
    ctx,
    player: playerShip,
    hazards,
    economy,
    targets,
    combat,
    ships: () =>
      arena
        ? arena.ships.map((s) => s.entity)
        : [...traffic.shown.values()].filter((s) => !s.berthed).map((s) => s.entity),
    nameOf: shipNameOf,
    manifest: (id) => traffic.manifest(id),
    holdCu: (id) => {
      const c = traffic.contacts.find((k) => k.id === id);
      return c ? holdCu(c) : undefined;
    },
    region: () => law.region() ?? 'region.chequamegon',
    fameTier: () => fameTier(law.defs, ctx.state.fame.value),
    dark01: () => {
      const c = detection.conditions;
      if (!c) return 0;
      const night = 1 - daylight01(c.sky.sunElevationRad);
      const fog = Math.min(1, Math.max(0, (2000 - c.fogM) / 1400));
      return Math.max(night, fog);
    },
    windKn: (x, z) => sailingOptions.wind(x, z).speedKn,
    voyageS: (e) => {
      // Her run to the nearest harbor in the zone at her service speed; unknown at sea.
      const p = e.transform?.position;
      const r = SHIP_RECORDS.find((k) => k.id === e.npc?.classId);
      if (arena || inArenaSpace || !p || !r || harborLayouts.length === 0) return undefined;
      let best = Infinity;
      for (const l of harborLayouts) {
        const a = l.footprint.anchor;
        best = Math.min(best, Math.hypot(a.x - p.x, a.z - p.z));
      }
      const kn = Math.max(2, serviceSpeedKn(r));
      return (best * zoneFrame(zone, zoneData).compression) / knotsToMs(kn);
    },
    playerKn: () => speedKn(sailing.state),
    passTime: (gameSeconds) => passGameTime(gameSeconds),
    show: (snapshot) => {
      ui.setBoarding(snapshot);
      document.body.dataset['boarding'] = snapshot?.stage ?? 'closed';
    },
    onOpen(open) {
      if (open) {
        machine.pushOverlay('trade');
        contextBeforeBoarding = input.context;
        input.context = 'menu';
      } else {
        machine.removeOverlay('trade');
        input.context = contextBeforeBoarding;
        input.endTick();
      }
      if (cameraRig) cameraRig.suspended = open;
      hudClock = HUD_INTERVAL_S;
    },
    notice: (text) => showNotice(text),
    endRun: (ship) => void endRef.current?.('killed', { ship }),
    syncLost: () => traffic.syncLost(),
    ownerName: (id) => traffic.defs.factions.get(id)?.name,
  });
  boardingRef.current = boarding;
  // The law and the world answer (Phase 6 piece F): crimes at sea, the robbed crew's report,
  // gunfire heard, firing on the law, and wrecks.
  const contactOf = (id: string): string => id.replace(/\.consort_\d+$/, '');
  /** Where a point on the water lies in lat/lon (an arena's: where she was met). */
  const geoAt = (x: number, z: number): { lat: number; lon: number } | undefined => {
    if (arena) return westernSuperiorChart().projection.chartToGeo(arena.encounter.at);
    if (inArenaSpace) return undefined;
    return WORLD_PROJECTION.chartToGeo(zoneToChart({ x, z }, zoneFrame(zone, zoneData)));
  };
  const seaLaw: SeaLaw = attachSeaLaw({
    ctx,
    law,
    detection,
    lawAtSea,
    ships: shipsOnWaterAll,
    isLawShip,
    nameOf: shipNameOf,
    ownerOf: (id) => traffic.manifest(contactOf(id))?.owner,
    ownerName: (id) => traffic.defs.factions.get(id)?.name,
    isRival: (id) => gameRivals.isRival(contactOf(id)),
    cargoOf: (id) => traffic.manifest(contactOf(id))?.cargo ?? [],
    zoneId: () => (arena || inArenaSpace ? undefined : zoneData.id),
    geoAt,
    dark01: () => {
      const c = detection.conditions;
      if (!c) return 0;
      const night = 1 - daylight01(c.sky.sunElevationRad);
      const fog = Math.min(1, Math.max(0, (2000 - c.fogM) / 1400));
      return Math.max(night, fog);
    },
    windKn: (x, z) => sailingOptions.wind(x, z).speedKn,
    notice: (text) => showNotice(text),
    goodName: (good) => economy.defs.goods.get(good)?.name.toLowerCase() ?? good,
  });
  if (import.meta.env.DEV || params.has('debug')) {
    // `__glpSeaLaw.incidents()` reads the encounters whose crews are yet to report;
    // `wrecks()` the wreck sites; `closeAll()` lets every crew go.
    const hook = {
      incidents: () => seaLaw.incidents(),
      wrecks: () => state.wrecks?.list ?? [],
      closeAll: () => seaLaw.closeAll(),
      crimes: () => state.reports.crimes,
      reports: () => state.reports.inProgress,
      grudges: () => state.player.grudges ?? {},
    };
    (window as unknown as { __glpSeaLaw: typeof hook }).__glpSeaLaw = hook;
  }
  if (import.meta.env.DEV || params.has('debug')) {
    // `__glpBoarding.near()` reads the target alongside; `board()` presses F; `odds(id)` the
    // panel's numbers; `lay(id)` puts the ship alongside her, stopped; `ships()` the record.
    const hook = {
      near: () => {
        const n = boarding.near();
        return n && { id: n.entity.id, gapM: n.gapM, relKn: n.relKn };
      },
      board: () => boarding.board(),
      odds: (id: string) => boarding.oddsAgainst(id),
      actions: boarding.actions,
      open: () => boarding.open,
      lay: (id: string, side = 1) => {
        const e = [...ctx.world.entities].find((k) => k.id === id);
        const t = e?.transform;
        const r = SHIP_RECORDS.find((k) => k.id === e?.npc?.classId);
        if (!t || !r) return false;
        // Abeam of her, rail to rail, heading her way.
        const off = r.buoyancy.beam / 2 + 6;
        placeShip({
          x: t.position.x + Math.cos(t.heading) * off * side,
          z: t.position.z + Math.sin(t.heading) * off * side,
          heading: t.heading,
        });
        // Sails struck and stopped, as a captain lying alongside would be.
        sailing.state.speed = 0;
        sailing.state.sailLevel = sailing.state.sailSetting = 0;
        if (e?.npc) e.npc.speedKn = 0;
        const helm = e && targets.helmOf(e);
        if (helm) helm.speedKn = 0;
        return true;
      },
      /** Puts the ship `m` meters astern of her on her heading: her bow swivel bears. */
      astern: (id: string, m = 150): number | undefined => {
        const t = [...ctx.world.entities].find((k) => k.id === id)?.transform;
        if (!t) return undefined;
        placeShip({
          x: t.position.x - Math.sin(t.heading) * m,
          z: t.position.z + Math.cos(t.heading) * m,
          heading: t.heading,
        });
        // Her heading, degrees: lay a shot across her bow from it.
        return (t.heading * 180) / Math.PI;
      },
      record: () => state.traffic?.ships,
      kn: () => ({ player: speedKn(sailing.state), near: boarding.near()?.entity.npc?.speedKn }),
    };
    (window as unknown as { __glpBoarding: typeof hook }).__glpBoarding = hook;
  }
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
      /** A ship on the water fires the cutter's gun at the player (the four-ship fight check). */
      fireFrom: (shipId: string, elevationDeg = 2, ammo = 'ammo.round') => {
        const e = shipsOnWater().find((k) => k.id === shipId);
        const from = e?.transform?.position;
        const to = playerShip.transform?.position;
        if (!e || !from || !to) return { ok: false as const, reason: 'noTarget' as const };
        const bearing = Math.atan2(to.x - from.x, -(to.z - from.z));
        return combat.fireFrom(e, 'weapon.cutter_gun', ammo, bearing, elevationDeg * DEG);
      },
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
    curios: {
      view: (hideout) => discovery.hideoutCurios(hideout),
      set: (id, hideout) => discovery.setCurio(id, hideout),
    },
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
        // The stash's screen needs the mouse at once, as the journal's does (see above).
        if (document.pointerLockElement) document.exitPointerLock();
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
    onProduced: (text) => showNotice(text),
    shipyard,
    launched: (id) => launchedAt(id),
    toYard: (id) => abandon.toYardFrom(id),
    ashore: { offered: () => ashoreOfferedRef.current(), go: () => goAshoreRef.current?.() },
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
    // Crafting (Phase 8 piece E): `__glpCraft.workshop()` raises the four stations and a
    // well beside a hideout's shack, `give('good.lumber', 10)` stores materials there,
    // `craft('recipe.patch_kits', 2)` works at the open hideout, `skip(hours)` runs the clock.
    const craftHook = {
      workshop: (id = 'hideout.stockton') => {
        const h = state.hideouts?.[id];
        if (h) h.layout = withWorkshop(h.layout);
        if (stash.openHideout === id) stash.open(id);
        return !!h;
      },
      give: (good: string, qty: number, id = 'hideout.stockton', hot = false) => {
        const h = state.hideouts?.[id];
        if (!h) return false;
        const at = state.environment.clock.gameSeconds;
        addToHold(h.storage.goods, {
          good,
          qty,
          ...(hot
            ? {
                hot: {
                  region: 'region.apostles',
                  heat: 1,
                  traceability: 0.8,
                  since: at,
                  owner: 'company.northern_range',
                },
              }
            : {}),
        });
        if (stash.openHideout === id) stash.open(id);
        return true;
      },
      craft: (recipe: string, batches = 1, stackIndex?: number) =>
        stash.actions.craft(recipe, batches, stackIndex),
      take: (thing: string, qty: number) => stash.actions.takeThing(thing, qty),
      skip: (hours: number) => {
        const clock = state.environment.clock;
        const ticks = Math.max(1, Math.round((hours * 3600) / WORLD_TICK_GAME_SECONDS));
        for (let k = 0; k < ticks; k++) {
          const n = advanceGameTime(clock, WORLD_TICK_GAME_SECONDS);
          for (let i = 0; i < n; i++)
            ctx.events.emit('WorldTick', { gameSeconds: clock.gameSeconds });
        }
      },
      hideout: (id = 'hideout.stockton') => state.hideouts?.[id],
    };
    (window as unknown as { __glpCraft: typeof craftHook }).__glpCraft = craftHook;
  }
  // The Fisherman's fish prices and the First Week checklist (piece C).
  captainRef.current = attachCaptain(ctx, economy.defs, (week) => ui.setFirstWeek(week));
  // Ambitions (Phase 8 piece H): pinned on the HUD, marks in the ledger, a line in the papers.
  ambitionsRef.current = attachAmbitions(ctx, law.defs, (snapshot) => ui.setAmbitions(snapshot));
  if (import.meta.env.DEV || params.has('debug')) {
    const amb = ambitionsRef.current;
    const hook = {
      /** The snapshot the HUD and the ledger show. */
      snapshot: () => amb.snapshot(),
      pin: (id: string) => amb.pin(id),
      unpin: (id: string) => amb.unpin(id),
      /** Moves a counter (`morrillEscapes`, `contractsOnTime`...) and checks. */
      count(counter: string, by = 1) {
        amb.state.counters[counter] = (amb.state.counters[counter] ?? 0) + by;
        return amb.check().map((d) => d.id);
      },
      /** Puts cash in the first hideout's strongbox and checks. */
      stash(cents: number) {
        const h = Object.values(ctx.state.hideouts ?? {})[0];
        if (h) h.storage.cash += cents;
        return amb.check().map((d) => d.id);
      },
      check: () => amb.check().map((d) => d.id),
      state: () => amb.state,
    };
    (window as unknown as { __glpAmbitions: typeof hook }).__glpAmbitions = hook;
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
  // Capture, jail and the run's end (Phase 5 piece D). Piece C's cutter raises
  // PlayerCaptured; once any arena has ended the captain is jailed (or bound for the rope),
  // with the jail screen over the game.
  const lockup = gameJail().lockup;
  /** Back alongside the lockup's pier, out of the impound: docked, so the port screen opens. */
  const backAboard = (): Promise<void> => dockAt(lockup.port, lockup.pier);
  /** Alongside a port's pier, the zone loaded if it must be: docked, so the port screen opens. */
  const dockAt = async (port: string, pier: string): Promise<void> => {
    if (machine.mode === 'chart') travelRef.current?.towed();
    const zoneId = portInfo(port)?.zone;
    const dock = (): void => {
      const berth =
        freeBerths().find((b) => b.dockId === pier) ??
        sailingOptions.berths.find((b) => b.dockId === pier);
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
  const endTheRun = async (cause: RunEndCause, detail?: RunEndDetail): Promise<void> => {
    if (run.over) return;
    run.over = true;
    const now = state.environment.clock.gameSeconds;
    const last = buildLastRun(law.defs, state, cause, now, new Date(), detail);
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
          ...(last.nickname ? { nickname: last.nickname } : {}),
        });
      } catch (err) {
        console.error('Could not end the run in the save', err);
      }
    }
    // A voluntary ending is taken from a letter on the harbor master's tab.
    if (ports.openPort) ports.close();
    if (ports.journalOpen) ports.closeJournal();
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
        // Out of the jail screen into the cell (a jailbreak), or back to the helm.
        input.context =
          machine.mode === 'chart' ? 'chart' : machine.mode === 'onFoot' ? 'onFoot' : 'sailing';
        input.endTick();
      }
      if (cameraRig) cameraRig.suspended = open || machine.mode === 'onFoot';
      hudClock = HUD_INTERVAL_S;
    },
    afterSkip: () => ctx.weather.tick(state.environment.clock.gameSeconds, shipPose(), ctx.sea),
    cutterAt: () => lawShips.morrill.pos,
    backAboard,
    endRun: (cause) => endTheRun(cause),
    save: () => saveControls.saveNow(),
    // The jailbreak (Phase 7 piece G): the ship lies impounded at the lockup's pier, tied
    // up with nobody aboard, and you're put in the cell on foot.
    breakOut: async (start) => {
      const a = ashoreRef.current;
      if (!a) return 'Not now';
      await dockAt(lockup.port, lockup.pier);
      const h = hazards.state;
      if (!h.berthId) return 'Your ship is not at the city dock';
      h.mooring = 'docked';
      h.mooringS = 0;
      Object.assign(sailing.state, { speed: 0, sailLevel: 0, sailSetting: 0 });
      ports.markDocked(h.berthId);
      return a.breakOut(start);
    },
    offFeet: (title, line) =>
      ashoreRef.current?.active
        ? ashoreFade(title, line, () => ashoreRef.current?.leave())
        : Promise.resolve(),
    notice: (text) => showNotice(text),
  });
  captureRef.current = capture;
  endRef.current = endTheRun;
  // The voluntary endings (Phase 9 piece B): Retire and Turn Lawman, each offered by letter.
  const endings = attachEndings({
    ctx,
    law: law.defs,
    events: sandboxEvents,
    end: (cause, detail) => void endTheRun(cause, detail),
  });
  if (import.meta.env.DEV || params.has('debug')) {
    // `__glpEndings.eligibility('retire')` says what's missing; `.offer('lawman', true)`
    // sends the letter now; `.end('retired', 'cabin')` ends the run with that page.
    const hook = {
      eligibility: (kind: 'retire' | 'lawman') => endings.eligibility(kind),
      offer: (kind: 'retire' | 'lawman', force = false) => endings.offer(kind, force),
      check: () => endings.check(),
      end: (cause: 'retired' | 'lawman', retirement?: string) =>
        endTheRun(cause, retirement ? { retirement } : {}),
    };
    (window as unknown as { __glpEndings: typeof hook }).__glpEndings = hook;
  }
  // Abandon ship (Phase 6 piece F, decision 2): F while she founders, or she goes down with
  // you in the boat. You're landed at the nearest yard with a worn hull; the jail's release
  // screen tells it.
  /** A port the boat's rescuer is bound for, waiting for the arena to end. */
  let landingPort: string | undefined;
  const landAt = async (port: string): Promise<void> => {
    if (arena) {
      landingPort = port;
      leaveArena('caught');
      return;
    }
    // Cast away and walked to the yard: off your feet and aboard the new hull.
    if (ashoreRef.current?.active) ashoreRef.current.leave();
    await dockAt(port, `pier.${port.replace(/^port\./, '')}_city`);
  };
  /**
   * Shipless (Phase 8 piece G): set ashore at a hideout with a slipway, her zone loaded if
   * it must be. The ship's hull lies hidden at the site's anchorage, and you stand at the
   * head of the ways, facing down them.
   */
  let landingHideout: string | undefined;
  const landAtHideout = async (hideoutId: string): Promise<void> => {
    const h = state.hideouts?.[hideoutId];
    const site = h && siteDef(h.siteId);
    if (!site) return;
    if (arena) {
      landingHideout = hideoutId;
      leaveArena('caught');
      return;
    }
    if (ashoreRef.current?.active) ashoreRef.current.leave();
    if (machine.mode === 'chart') travelRef.current?.towed();
    let hull: Pose | undefined;
    const moor = (): void => {
      if (!zone) return;
      const a = siteAnchorage(site, manifestFrame(zone.manifest));
      if (!a) return;
      hull = { x: a.x, z: a.z, heading: 0 };
      placeShip(hull);
      Object.assign(sailing.state, { speed: 0, sailLevel: 0, sailSetting: 0 });
      const hz = hazards.state;
      hz.anchor = 'down';
      hz.anchorX = a.x;
      hz.anchorZ = a.z;
    };
    if (site.zone !== zoneData.id) {
      await enterZone(site.zone, spawnPose(zoneDef(site.zone)), { kind: 'return' }, false, moor);
    } else moor();
    const s = hideouts.site(hideoutId);
    const head = s && slipwayHead(s.grid, s.build);
    const box = hideouts.strongbox();
    let at: { x: number; z: number; heading: number } | undefined;
    if (s && head) {
      const p = siteToZone(s.frame, head.x, head.z);
      const sea = siteToZone(s.frame, head.seaward.x, head.seaward.z);
      // A couple of meters up the beach from the head, looking down the ways.
      const len = Math.hypot(sea.x - p.x, sea.z - p.z) || 1;
      at = {
        x: p.x - ((sea.x - p.x) / len) * 2,
        z: p.z - ((sea.z - p.z) / len) * 2,
        heading: Math.atan2(sea.x - p.x, -(sea.z - p.z)),
      };
    } else if (box) at = { x: box.x + 2, z: box.z + 2, heading: 0 };
    if (!at) return;
    ashore.landShipless(at, hull && { x: hull.x, z: hull.z });
    document.body.dataset['shipless'] = hideoutId;
    await saveControls.saveNow();
  };
  /** Off the ways: aboard the new schooner at the hideout's anchorage (piece G). */
  const launchedAt = (hideoutId: string): void => {
    const h = state.hideouts?.[hideoutId];
    const site = h && siteDef(h.siteId);
    const a = site && zone ? siteAnchorage(site, manifestFrame(zone.manifest)) : undefined;
    if (ashoreRef.current?.active) ashoreRef.current.leave();
    if (a) {
      const heading = shipPose().heading;
      placeShip({ x: a.x, z: a.z, heading });
      Object.assign(sailing.state, { speed: 0, sailLevel: 0, sailSetting: 0 });
      // Her anchor out ahead of her, as when she's anchored by hand.
      const hz = hazards.state;
      hz.anchor = 'down';
      hz.anchorX = a.x + Math.sin(heading) * shipRecord.lengthM * 0.45;
      hz.anchorZ = a.z - Math.cos(heading) * shipRecord.lengthM * 0.45;
    }
    shipyard.refit();
    economy.syncLoad();
    document.body.dataset['shipless'] = 'no';
    hudClock = HUD_INTERVAL_S;
  };
  const abandon: Abandon = attachAbandon({
    ctx,
    law,
    seaLaw,
    hazards,
    shipyard,
    economy,
    seed: trafficSeed,
    where: () => {
      const geo = westernSuperiorChart();
      if (arena) {
        const at = arena.encounter.at;
        return { chart: at, geo: geo.projection.chartToGeo(at) };
      }
      if (machine.mode === 'chart' || inArenaSpace) return undefined;
      const p = shipPose();
      const world = zoneToChart({ x: p.x, z: p.z }, zoneFrame(zone, zoneData));
      return {
        chart: fromWorldChart(geo, world),
        geo: WORLD_PROJECTION.chartToGeo(world),
        zone: { id: zoneData.id, x: p.x, z: p.z },
      };
    },
    portAt: (port) => westernSuperiorChart().ports.find((p) => p.id === port)?.pos,
    passTime: (s) => passGameTime(s),
    show: (snapshot) => {
      ui.setJail(snapshot);
      document.body.dataset['abandon'] = snapshot ? 'open' : 'closed';
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
    landAt: (port) => landAt(port),
    notice: (text) => showNotice(text),
    // Near land in a sea she can live in, the boat takes you off to row for it (decision 2).
    castAway: () => !arena && !inArenaSpace && (ashoreRef.current?.castAway() ?? false),
    landAtHideout: (id) => landAtHideout(id),
    hideoutChart: (id) => {
      const h = state.hideouts?.[id];
      const site = h && siteDef(h.siteId);
      const geo = site && siteGeo(site);
      return geo ? westernSuperiorChart().projection.geoToChart(geo) : undefined;
    },
  });
  abandonRef.current = abandon;
  if (import.meta.env.DEV || params.has('debug')) {
    // The slipway (Phase 8 piece G): `__glpSlipway.lay()` builds one at a hideout's spot on
    // the shore, `shipless()` sets you ashore there without a ship as the abandon screen's
    // choice does, and `repair()`, `fit(id)`, `build()` and `toYard()` work the open screen.
    const slipHook = {
      lay: (id = 'hideout.stockton') => {
        const h = state.hideouts?.[id];
        if (!h) return false;
        h.layout = withSlipway(h.layout, h.siteId);
        hideouts.invalidate();
        if (stash.openHideout === id) stash.open(id);
        return true;
      },
      shipless: async (id = 'hideout.stockton') => {
        if (!state.hideouts?.[id]) return false;
        state.player.shipless = { hideout: id, since: state.environment.clock.gameSeconds };
        await landAtHideout(id);
        return true;
      },
      open: (id = 'hideout.stockton') => stash.open(id, 'slipway'),
      repair: () => stash.actions.slipwayRepair(),
      fit: (upgrade: string) => stash.actions.slipwayInstall(upgrade),
      build: () => stash.actions.buildShip(),
      toYard: () => stash.actions.toYard(),
      state: () => ({
        shipless: state.player.shipless,
        ship: state.player.ship,
        profile: state.profiles.ship,
        ashore: ashoreRef.current?.active ?? false,
        from: ashoreRef.current?.from,
        mode: machine.mode,
      }),
    };
    (window as unknown as { __glpSlipway: typeof slipHook }).__glpSlipway = slipHook;
  }
  if (import.meta.env.DEV || params.has('debug')) {
    // `__glpAbandon.founder()` holes her to nothing; `abandon()` presses F; `leave()` goes aboard.
    const hook = {
      founder: () => {
        hazards.state.hull = 0;
        hazards.state.foundering = true;
        return true;
      },
      abandon: () => abandon.abandon(),
      leave: () => abandon.leave(),
      leftS: () => abandon.leftS,
      open: () => abandon.open,
      landed: () => abandon.landed,
      adrift: () => abandon.adrift,
      docked: () => ports.dockedPort,
    };
    (window as unknown as { __glpAbandon: typeof hook }).__glpAbandon = hook;
  }
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
      breakOut: () => capture.actions.jailbreak(),
      breakingOut: () => capture.breakingOut,
      debt: () => state.jailDebt,
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
  /** The port a berth belongs to, if any. */
  const berthPort = (berthId: string): string | undefined => {
    const pier = sailingOptions.berths.find((b) => b.id === berthId)?.dockId;
    return pier ? pierPort(pier) : undefined;
  };
  // A harbor frozen in (piece K) keeps a ship from its berths, and one at a berth on it.
  sailingOptions.castOffGate = (berthId) => {
    const port = berthPort(berthId);
    if (!port || !gameIce.harborClosed(port)) return true;
    showNotice(
      `Frozen in at ${portInfo(port)?.name ?? 'the pier'} until the ice goes out, ${aboutDate(gameIce.openAgainAt(port))}`,
    );
    return false;
  };
  // Ice under the hull (piece K): drag, damage and an edge she can't pass, in a zone.
  sailingOptions.ice = {
    step: (dt) => {
      if (arena) return;
      const frame = zoneFrame(zone, zoneData);
      const geoIce = westernSuperiorChart();
      iceSailingSystem(
        ctx.world,
        {
          sample: (x, z) => gameIce.at(fromWorldChart(geoIce, zoneToChart({ x, z }, frame))),
          iceBow: (e) => !!e.playerControlled && gameIce.iceBow(),
          onEvent: (e, ev) => {
            if (ev.kind === 'hazard') emitHazard(ctx.events, e.id, ev.event);
            else if (ev.kind === 'stopped') {
              ctx.events.emit('IceStopped', { shipId: e.id, thicknessCm: ev.thicknessCm });
              if (e.playerControlled) {
                const cm = Math.round(ev.thicknessCm);
                showNotice(
                  gameIce.iceBow()
                    ? `Ice ahead, ${cm} cm: too thick even for the ice bow. Bear away.`
                    : `Ice ahead, ${cm} cm: too thick for her bow. Bear away, or fit an ice bow.`,
                );
              }
            }
          },
        },
        dt,
        hudSeconds,
      );
    },
  };
  sailingOptions.dockGate = (berthId) => {
    const port = berthPort(berthId);
    if (port && gameIce.harborClosed(port)) {
      showNotice(
        `${portInfo(port)?.name ?? 'The harbor'} is frozen in until the ice goes out, ${aboutDate(gameIce.openAgainAt(port))}`,
      );
      return false;
    }
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
  sailingOptions.landSeparation = landSeparation;
  sailingOptions.combat = { step: (dt) => combat.step(dt) };
  sailingOptions.helmHeld = () => aim.steeringLocked();
  // A charted shoal under her (piece O): the readout warns earlier, as the sounding machine.
  sailingOptions.chartedWarnDrafts = () => {
    if (arena || inArenaSpace) return undefined;
    const at = worldGeo(zoneToChart(shipPose(), zoneFrame(zone, zoneData)));
    return discovery.overChartedShoal(at) ? CHARTED_SHOAL_WARN_DRAFTS : undefined;
  };
  const sailingMode = createSailingMode(ctx, sailingOptions);
  machine.register({ id: 'mainMenu', enter: () => (input.context = 'menu') }).register(sailingMode);
  // A refused F or anchor order says why on the HUD for a few seconds.
  let notice: { text: string; untilS: number } | undefined;
  let hudSeconds = 0;
  let discoveryClock = 0;
  const DISCOVERY_LOOK_S = 1;
  noticeRef.current = (text) => showNotice(text);
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
    const sinking = machine.mode === 'sailing' ? abandonRef.current?.chip() : undefined;
    if (sinking) return [sinking];
    if (machine.mode !== 'sailing' || hazards.state.mooring !== 'free') return [];
    const board = boardingRef.current?.chip();
    if (board) return [board];
    const rig = rigChip();
    if (rig) return [rig];
    const near = traffic.nearest(shipPose(), HAIL_RANGE_M);
    if (!near) return [];
    if (smuggler.isSmuggler(near.id)) {
      const chip = smuggler.chip(shipPose(), speedKn(sailing.state));
      return chip ? [chip] : [];
    }
    if (!arena && near.distanceM <= lookRangeM()) return ['F look her over · H hail'];
    return ['H to hail'];
  };
  /**
   * At a wrecking mark with a false-light rig in the lockers (Phase 9 piece I): F hangs it,
   * after dark. Without a rig aboard the mark says nothing.
   */
  const rigOffer = () => {
    const frame = marksFrame();
    if (!frame || (state.player.stores['store.false_light'] ?? 0) <= 0) return undefined;
    const o = wrecking.offer(shipPose(), frame);
    return o && { ...o, frame };
  };
  const rigChip = (): string | undefined => {
    const o = rigOffer();
    if (!o) return undefined;
    if (!o.refusal) return `F hang a false light · ${o.mark.name}`;
    return wrecking.lit().some((r) => r.mark === o.mark.id)
      ? `Your false light burns at ${o.mark.name}`
      : `${o.mark.name}: a false light wants the dark`;
  };
  const hideCard = (): void => {
    card = undefined;
    ui.setShipCard(undefined);
    delete document.body.dataset['shipCard'];
  };
  // In an arena F is "look her over", not a dock order, so its refusal says nothing. In a
  // zone, F with no berth in reach looks over the nearest ship instead.
  ctx.events.on('DockRefused', (e) => {
    // Going down: F takes to the boat (Phase 6 piece F).
    if (abandonRef.current?.abandon()) return;
    // Alongside a target, F grapples (Phase 6 piece D), in a zone or an arena.
    if (e.reason === 'noBerth' || e.reason === 'anchored' || arena) {
      const b = boardingRef.current?.board();
      if (b?.opened) return;
      if (b) {
        showNotice(b.why);
        return;
      }
    }
    if (arena) return;
    // At a wrecking mark with a rig aboard, F hangs the false light (Phase 9 piece I).
    if (e.reason === 'noBerth' || e.reason === 'anchored') {
      const o = rigOffer();
      if (o) {
        showNotice(wrecking.setRig(shipPose(), o.frame));
        return;
      }
    }
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

  // Going ashore (Phase 7 piece A, plan 08 §20): G at a berth puts you on the pier, G at
  // anchor puts you in the boat; F on foot goes back aboard. The world runs on at R = 6.
  /** The fade to fog for going ashore and coming back aboard. */
  const ashoreFade = async (title: string, line: string, work: () => void): Promise<void> => {
    changingZone = true;
    machine.pushOverlay('loading');
    input.context = 'menu';
    ui.setLoading({ title, line });
    document.body.dataset['zoneLoad'] = 'loading';
    try {
      await new Promise((resolve) => window.setTimeout(resolve, FADE_MS));
      work();
    } finally {
      changingZone = false;
      ui.setLoading(undefined);
      // Recaptured on a jailbreak, the jail screen is already up behind the fade.
      input.context =
        machine.mode === 'onFoot' ? 'onFoot' : captureRef.current?.open ? 'menu' : 'sailing';
      input.endTick();
      machine.removeOverlay('loading');
      document.body.dataset['zoneLoad'] = 'done';
    }
  };
  // The walkable islands (Phase 7 piece H, plan 08 §20.4): Stockton's quarry and cache
  // placed on the zone's drawn ground, its 1 m tiles from the zone load, and the trees the
  // renderer plants (same hash, same clearings) as trunks on any landing.
  const islandCache = new WeakMap<
    LoadedZone,
    { placed: PlacedIsland[]; clearings: ReturnType<typeof zoneClearings> }
  >();
  const zoneIslands = (): {
    placed: PlacedIsland[];
    clearings: ReturnType<typeof zoneClearings>;
  } => {
    if (!zone || arena) return { placed: [], clearings: [] };
    let hit = islandCache.get(zone);
    if (!hit) {
      const z = zone;
      const placed = placeZoneIslands(z.manifest.zone, z.manifest.islands ?? [], (x, zz) =>
        z.terrain.heightAt(x, zz),
      );
      hit = { placed, clearings: zoneClearings(z, harborLayouts, placed) };
      islandCache.set(zone, hit);
    }
    return hit;
  };
  // The run's hideouts on this zone (Phase 8 piece C): drawn where they're built, solid on
  // foot, their storage opened at their shelves and strongbox, and edited in build mode.
  const hideouts = attachHideouts({
    state,
    zone: () =>
      zone && !arena ? { id: zoneData.id, frame: manifestFrame(zone.manifest) } : undefined,
    heightAt: (x, z) => ctx.terrain?.heightAt(x, z) ?? -100,
    openStash: (id, tab) => {
      stash.open(id, tab);
      return stash.openHideout === id;
    },
    sleep: (id) => lifeRef.current?.openSleep(id),
    carrying: () => lifeRef.current?.carrying(),
    notice: (text) => showNotice(text),
  });
  const islandAshore = attachIslandAshore({
    state,
    heightAt: (x, z) => ctx.terrain?.heightAt(x, z) ?? -100,
    grid: () => {
      const h = ctx.terrain?.height;
      return h && { x0: h.x0, z0: h.z0, step: h.step };
    },
    islands: () => zoneIslands().placed,
    ground: (id) => zone?.islandGrounds?.get(id),
    hideouts,
    salvage: {
      prompt: (at) => lifeRef.current?.salvagePrompt(at),
      boatPrompt: () => lifeRef.current?.boatPrompt(),
      params: (base) => lifeRef.current?.params(base) ?? base,
      get load() {
        return lifeRef.current?.load;
      },
    },
    stations: zoneStations,
    runSeed: () => state.environment.weather.noiseSeed,
    notice: (text) => showNotice(text),
    // A cache's curio kept, and a lead to it run down (piece O).
    found: (cacheId) => {
      const isl = ISLANDS.find((i) => i.onFoot?.caches.some((c) => c.id === cacheId));
      const cache = isl?.onFoot?.caches.find((c) => c.id === cacheId);
      if (!isl || !cache) return;
      discovery.cacheOpened(cacheId, `${cache.name.toLowerCase()} on ${isl.name}`, cache.curio);
    },
  });
  // Hideout life (Phase 8 piece F): the bunk, the refuge at the anchorage, being spotted
  // and the ruins' salvage.
  let contextBeforeSleep: InputContext = 'onFoot';
  const life = attachHideoutLife({
    ctx,
    law,
    hideouts,
    zone: () =>
      zone && !arena && !inArenaSpace
        ? { id: zoneData.id, frame: manifestFrame(zone.manifest) }
        : undefined,
    shipPose: () => (zone && !arena && !inArenaSpace ? shipPose() : undefined),
    mooredAt: () => stash.hideoutHere,
    *shipsUnderWay() {
      for (const [id, s] of traffic.shown) {
        const t = s.entity.transform;
        if (s.berthed || !t) continue;
        const contact = traffic.contacts.find((c) => c.id === id);
        const cls = SHIP_RECORDS.find((r) => r.id === s.entity.npc?.classId);
        const name =
          s.entity.npc?.classId === CUTTER_CLASS_ID
            ? 'the Morrill'
            : `the ${(cls?.name ?? 'ship').toLowerCase()} ${contact?.name ?? ''}`.trim();
        yield { id, x: t.position.x, z: t.position.z, name };
      }
    },
    standing: () => {
      const a = ashoreRef.current;
      if (!a?.active || a.inBoat) return undefined;
      const p = a.zoneAt();
      return { x: p.x, y: p.y, z: p.z };
    },
    islandPieces: () => zoneIslands().placed.flatMap((i) => i.pieces),
    // The winter at a hideout (piece K): frozen in, the bunk sleeps it through to ice-out.
    iceOutAt: (id) => {
      const site = siteDef(state.hideouts?.[id]?.siteId ?? '');
      const at = site ? siteGeo(site) : undefined;
      if (!at) return undefined;
      return gameIce.openAgainAtPoint(westernSuperiorChart().projection.geoToChart(at));
    },
    blocked: () => {
      if (run.inDanger || ashoreRef.current?.pursued || pursuitOn.size > 0)
        return 'Not with the law on your tail';
      return undefined;
    },
    hold: () => ({ cargo: state.player.cargo, capacity: economy.capacity }),
    showSleep: (view) => ui.setSleep(view),
    onOpen(open) {
      if (open) {
        if (document.pointerLockElement) document.exitPointerLock();
        machine.pushOverlay('trade');
        contextBeforeSleep = input.context;
        input.context = 'menu';
      } else {
        machine.removeOverlay('trade');
        input.context = contextBeforeSleep;
        input.endTick();
      }
      document.body.dataset['sleep'] = open ? 'open' : 'closed';
      hudClock = HUD_INTERVAL_S;
    },
    notice: (text) => showNotice(text),
    save: () => void saveControls.saveNow(),
    changed: () => {
      economy.syncLoad();
      hudClock = HUD_INTERVAL_S;
    },
  });
  lifeRef.current = life;
  ui.attachSleep(life.actions);
  if (import.meta.env.DEV || params.has('debug')) {
    (window as unknown as Record<string, unknown>)['__glpLife'] = {
      /** Opens the bunk's choice at a hideout, wherever you are. */
      openSleep: (id = 'hideout.stockton') => life.openSleep(id),
      sleep: (until: 'dawn' | 'noon' | 'dusk' | 'eight' = 'dawn') => life.actions.sleep(until),
      sleepOpen: () => life.sleepOpen,
      refuge: () => life.refuge(),
      concealment: (id = 'hideout.stockton') => life.concealment(id),
      spotted: (id = 'hideout.stockton') => life.spotted(id),
      talk: () => life.spottedTalk(),
      /** Marks a hideout seen, as a passing ship would. */
      spot: (id = 'hideout.stockton', by = 'the tug Sophia') =>
        ctx.events.emit('HideoutSpotted', { hideout: id, by }),
      load: () => life.load,
      hold: () => state.player.cargo.map((c) => ({ good: c.good, qty: c.qty })),
      bunk: () => hideouts.bunk(),
      /** The salvage piles in the zone: where to stand to lift a load. */
      piles: () =>
        zoneIslands()
          .placed.flatMap((i) => i.pieces)
          .filter((p) =>
            SITES.some((s) => s.salvage?.poi === p.poi && s.salvage.kinds.includes(p.kind)),
          )
          .map((p) => ({
            x: p.x,
            z: p.z,
            y: p.minY,
            kind: p.kind,
            widthM: p.widthM,
            depthM: p.depthM,
            bearing: p.bearing,
          })),
      heat: (region: string) => state.wanted[region]?.heat ?? 0,
    };
  }
  const plantsIn = (b: {
    minX: number;
    minZ: number;
    maxX: number;
    maxZ: number;
  }): { trees: Float32Array; rocks: Float32Array; density: number } | undefined => {
    if (!zone || arena) return undefined;
    // plantTile takes a square on the planting lattice: the rectangle's, rounded out.
    const minX = Math.floor(b.minX / TREE_CELL_M) * TREE_CELL_M;
    const minZ = Math.floor(b.minZ / TREE_CELL_M) * TREE_CELL_M;
    const side = Math.max(b.maxX - minX, b.maxZ - minZ);
    const size = Math.ceil(side / (TREE_CELL_M * 3)) * TREE_CELL_M * 3;
    const plants = plantTile(zone.terrain.height, minX, minZ, size, zoneIslands().clearings);
    return { ...plants, density: renderer?.preset.vegetationDensity ?? 0.5 };
  };
  const footLook = new PointerLook(renderer?.renderer.domElement ?? container);
  /**
   * A crate carried up the gangway (Phase 7 piece E): into the hold, hot with its owner's
   * marks, one stack a good, owner and night.
   */
  const stowCrate = (crate: Crate, region: string): string | undefined => {
    const cargo = state.player.cargo;
    if (holdFree(cargo, economy.capacity) < 1) return 'The hold is full';
    const same = cargo.find(
      (s) =>
        s.good === crate.good &&
        !s.contract &&
        s.hot?.owner === crate.owner &&
        s.hot?.region === region &&
        Math.abs((s.hot?.since ?? -Infinity) - crate.since) < 6 * 3600,
    );
    if (same) same.qty += 1;
    else {
      cargo.push({
        good: crate.good,
        qty: 1,
        hot: {
          region,
          heat: 1,
          traceability: economy.defs.goods.get(crate.good)?.traceability ?? 0.5,
          since: crate.since,
          ...(crate.owner ? { owner: crate.owner } : {}),
        },
      });
    }
    economy.syncLoad();
    return undefined;
  };
  /** Dev hook: forces `suspect` on foot (see `__glpFoot.suspect`). */
  const suspectOverride: { value: boolean | undefined } = { value: undefined };
  const ashore = attachAshore({
    ctx,
    ship: playerShip,
    hull: {
      lengthM: shipRecord.buoyancy.length,
      beamM: shipRecord.buoyancy.beam,
      deckM: 1.2,
    },
    terrain: () => ctx.terrain,
    harbors: () => harborLayouts,
    berths: () => allBerths,
    inTown: (x, z) => !!setPieceAt(zoneData, zoneFrame(zone, zoneData), { x, z }),
    hsAt: (x, z) => ctx.weather.waveParams({ x, z }).hsM,
    blocked: () => {
      if (arena || inArenaSpace) return 'Not out here';
      if (run.inDanger || pursued || pursuitOn.size > 0) return 'Not with the law on your tail';
      if (machine.mode !== 'sailing' && machine.mode !== 'onFoot') return 'Not now';
      if (abandon.open || capture.pending || state.jail) return 'Not now';
      return undefined;
    },
    fade: ashoreFade,
    transition: (to) => {
      machine.transition(to);
      if (cameraRig) cameraRig.suspended = to === 'onFoot';
      hudClock = HUD_INTERVAL_S;
    },
    notice: (text) => showNotice(text),
    save: () => saveControls.saveNow(),
    died: (cause) => {
      footLook.detachListeners();
      void endTheRun(cause);
    },
    // Rowed ashore from the wreck: on to the nearest yard (Phase 7 piece A, decision 2).
    castawayLanded: () => abandon.cameAshore(),
    look: footLook,
    // Counters ashore (piece F): a shop's tab by day, the bar, and the back room after dark.
    shop: ({ def, model }, mark) => {
      const found = shopPrompt(model.layout.buildings, mark, gameTools().file, {
        hour: dayAndHour(state.environment.clock.gameSeconds).hour,
        backRoomOpen: backRoom.isOpen(def.port),
        fenceName: backRoom.fenceAt(def.port)?.name,
        cardsOpen: poker.isOpen(def.port),
      });
      if (!found) return undefined;
      return {
        text: found.text,
        act: () => {
          const refused = ports.openShop(def.port, found.tab, found.title);
          if (refused) showNotice(refused);
          else ui.setPortTab(found.tab);
        },
      };
    },
    island: islandAshore,
    plants: plantsIn,
    // The marshal posse on a walkable island at Wanted tier 4 and up (plan 08 §20.4 piece H):
    // they land by your boat, sweep out from it and break off at a hideout's bounds (Phase 9
    // piece F). None lands on the mainland's logging camp pad (Phase 8 piece D).
    posse: (island, scene, boat) => {
      const placed = zoneIslands().placed.find((p) => p.id === island);
      if (!placed || placed.mainland) return undefined;
      const region = (): string => law.region() ?? '';
      const fameTiers = Math.max(1, law.defs.fame.tiers.length - 1);
      const posse = createIslandPosse({
        scene,
        placed,
        seed: trafficSeed,
        boat,
        // The island scene is in zone meters, as the hideouts are.
        sanctuary: (at) => hideouts.siteAt(at)?.hideoutId,
        conditions: () => {
          const t = state.environment.clock.gameSeconds;
          return {
            gameSeconds: t,
            cloud01: ctx.weather.cloudAt(t),
            fogM: ctx.weather.fogVisibilityAt(t),
            rain01: ctx.weather.rainAt(t),
            wantedTier: wantedTier(law.defs, state.wanted[region()]?.heat ?? 0),
            fame01: fameTier(law.defs, state.fame.value) / fameTiers,
          };
        },
      });
      // The marshals' voices (piece I).
      posse?.on((e) => audio?.foot.stealth(e));
      posse?.onPosse((e) => {
        switch (e.type) {
          case 'PosseLanded':
            showNotice(
              e.count > 1
                ? 'Marshals have put in by your boat. They are searching the island.'
                : 'A marshal has put in by your boat. He is searching the island.',
            );
            return;
          case 'PosseBrokeOff': {
            showNotice("The marshals break off: you're home.");
            ctx.events.emit('PursuitEndedAtHideout', { hideout: e.hideout, by: 'npc.marshal' });
            // They watched you go in: the place is known (06 §5.4, 09 §8).
            const h = state.hideouts?.[e.hideout];
            if (e.sawIt && h && !recentlySpotted(h, state.environment.clock.gameSeconds)) {
              ctx.events.emit('HideoutSpotted', { hideout: e.hideout, by: 'npc.marshal' });
            }
            return;
          }
          case 'PosseGaveUp':
            showNotice('The marshals give up the search and head back to their boat.');
            return;
          case 'PosseLeft':
            showNotice("The marshals' boat puts off.");
            return;
        }
      });
      return posse;
    },
    // A lighthouse station's keepers (plan 11 §18.4 piece H): the watch's machinery on the
    // station's pad, its doings remembered in the save for the light at sea.
    stationWatch: (station, scene) => {
      const region = (): string => law.region() ?? '';
      const tierNow = (): number => wantedTier(law.defs, state.wanted[region()]?.heat ?? 0);
      const fameTiers = Math.max(1, law.defs.fame.tiers.length - 1);
      const port = station.def.light === 'light.chequamegon' ? 'port.ashland' : 'port.bayfield';
      const watch = createStationWatch({
        station,
        scene,
        record: () => stationRecord(station.def.light),
        tier: tierNow(),
        seed: trafficSeed,
        runSeed: () => state.environment.weather.noiseSeed,
        conditions: () => {
          const t = state.environment.clock.gameSeconds;
          return {
            gameSeconds: t,
            cloud01: ctx.weather.cloudAt(t),
            fogM: ctx.weather.fogVisibilityAt(t),
            rain01: ctx.weather.rainAt(t),
            wantedTier: tierNow(),
            fame01: fameTier(law.defs, state.fame.value) / fameTiers,
          };
        },
        suspect: () => suspectOverride.value,
        pockets: state.player,
        hasWeapon: (id) => !!state.player.ship?.weapons.some((w) => w.weapon === id),
        law: {
          commit: (input) => law.commit(input),
          addWitness: (id, w) => law.addWitness(id, w),
          detail: (id, details) => {
            const open = state.reports.crimes.find((c) => c.id === id);
            if (open) open.details = details;
          },
          identifyWitness: (witnessId, identification) =>
            identifyInFlightReports(state, witnessId, identification),
          region,
        },
        hooks: {
          stow: (crate) => stowCrate(crate, region()),
          schedule: () => rumors.readSchedule(port)?.text,
          weather: () =>
            keeperWeather(ctx.weather.barometerAt(state.environment.clock.gameSeconds)?.trend),
          notice: (text) => showNotice(text),
          changed: () => void stationLights(),
          // The keepers note the shoals and wrecks near the light (piece O).
          logbook: () => {
            const n = discovery.logbookRead(station.def.light).length;
            return n ? `${n === 1 ? 'One mark' : `${n} marks`} copied onto your chart.` : undefined;
          },
        },
      });
      if (audio) {
        watch.on((e) => audio.foot.stealth(e));
        watch.onTool((e) => {
          if (e.type !== 'StoneThrown') return audio.foot.tool(e);
          audio.foot.tool(e, { x: e.x, y: e.y, z: e.z });
        });
      }
      return watch;
    },
    // Your own footsteps and landings, heard (piece I).
    ...(audio
      ? {
          sounds: {
            step: (surface, gait, radiusM) => audio.foot.step(surface, gait, radiusM),
            landed: (speed, inWater) => audio.foot.landed(speed, inWater),
          },
        }
      : {}),
    // Bayfield's district (Phase 7): only for a harbor in the zone you're in.
    districtFrame: (def) => {
      const h = findHarbor(def.harbor);
      if (!zone || !h || harborZoneId(h) !== zoneData.id) return undefined;
      return districtFrame(def, districtFootprint(def, manifestFrame(zone.manifest)));
    },
    // The night watch on its navmesh (piece D's guards), sized by the region's Wanted tier.
    watch: (landing, onCaptured, jailbreak) => {
      if (!landing.nav) return undefined;
      const region = (): string => law.region() ?? '';
      const tierNow = (): number => wantedTier(law.defs, state.wanted[region()]?.heat ?? 0);
      const fameTiers = Math.max(1, law.defs.fame.tiers.length - 1);
      const districtWorld = ((state.districts ??= {})[landing.def.id] ??= {
        containers: {},
        doors: {},
      });
      const watch = createWatch({
        model: landing.model,
        nav: landing.nav,
        tier: tierNow(),
        seed: trafficSeed,
        conditions: () => {
          const t = state.environment.clock.gameSeconds;
          return {
            gameSeconds: t,
            cloud01: ctx.weather.cloudAt(t),
            fogM: ctx.weather.fogVisibilityAt(t),
            rain01: ctx.weather.rainAt(t),
            wantedTier: tierNow(),
            fame01: fameTier(law.defs, state.fame.value) / fameTiers,
          };
        },
        onCaptured,
        suspect: () => suspectOverride.value,
        // Piece E: the tool belt spends your purse and stores; its crimes go to the law.
        // Out of a cell you've nothing on you: your stores are aboard the impounded ship.
        pockets: jailbreak ? { purse: 0, stores: {} } : state.player,
        // Piece G: the lockup's night, and what comes of it to the jail.
        ...(jailbreak
          ? {
              jailbreak: {
                rules: gameJail().jailbreak,
                execution: jailbreak.execution,
                promiseCents: jailbreak.promiseCents,
                dawnAt: jailbreak.dawnAt,
                on: (e) => {
                  audio?.foot.jail(e);
                  capture.jailbreakEvent(e);
                },
              },
            }
          : {}),
        hasWeapon: (id) => !!state.player.ship?.weapons.some((w) => w.weapon === id),
        law: {
          commit: (input) => law.commit(input),
          addWitness: (id, w) => law.addWitness(id, w),
          detail: (id, details) => {
            const open = state.reports.crimes.find((c) => c.id === id);
            if (open) open.details = details;
          },
          identifyWitness: (witnessId, identification) =>
            identifyInFlightReports(state, witnessId, identification),
          region,
          port: landing.def.port,
        },
        // Piece F: the traffic's ships lying at the district's piers, each with a deck watch.
        moored: {
          ships: traffic.berthed().map((s) => {
            const at = landing.frame.toLocal(s.pose);
            return {
              id: s.id,
              name: s.name,
              className: s.className,
              owner: s.owner,
              crew: s.crew,
              cargo: s.cargo,
              x: at.x,
              z: at.z,
              heading: landing.frame.headingToLocal(s.pose.heading),
              lengthM: s.lengthM,
              beamM: s.beamM,
            };
          }),
          present: (id) => traffic.shown.get(id)?.berthed ?? false,
          crews: (districtWorld.crews ??= {}),
          // Phase 9 piece A: a storm-bound fleet's crews, or a round stood, drink easy.
          easy: () =>
            crewsIdle(state.events, landing.def.port, state.environment.clock.gameSeconds),
        },
        // Part two: the district's locks and loot, remembered in the save.
        heist: {
          targets: landing.def.targets,
          world: districtWorld,
          hooks: {
            stowPoints: () => ashoreRef.current?.stowPoints() ?? [],
            stow: (crate) => stowCrate(crate, region()),
            takeStock: (good, qty) => {
              const s = state.markets[landing.def.port]?.[good];
              if (s) s.stock = Math.max(0, s.stock - qty);
            },
            readPapers: () => rumors.readSchedule(landing.def.port)?.text,
            perk: (id) => hasPerk(state.player.captain, id),
            // Phase 9 piece D: Hollister's brine, while the feud is on.
            canSabotage: (owner) =>
              !!owner && FEUDS.some((f) => f.company === owner && feudOpen(state.feuds?.[f.id])),
            notice: (text) => showNotice(text),
          },
        },
      });
      // The watch's voices, the kit and the loot, heard (piece I).
      if (audio) {
        watch.on((e) => audio.foot.stealth(e));
        watch.onHeist((e) => audio.foot.heist(e));
        watch.onTool((e) => {
          if (e.type !== 'StoneThrown') return audio.foot.tool(e);
          const at = landing.frame.toZone(e.x, e.z);
          audio.foot.tool(e, { x: at.x, y: e.y, z: at.z });
        });
      }
      return watch;
    },
    // Taken on foot: to the lockup as the Morrill would take you at sea (Phase 5's jail).
    captured: (by, conduct) => {
      // Taken again on a jailbreak: back to the cell, or the rope.
      if (capture.breakingOut) {
        capture.recaptured();
        return;
      }
      ctx.events.emit('PlayerCaptured', {
        by: by === 'npc.watchman' || by === 'npc.marshal' ? by : 'npc.constable',
        region: law.region() ?? '',
        how: 'subdued',
        at: zoneToChart(shipPose(), zoneFrame(zone, zoneData)),
        ...(conduct ? { conduct } : {}),
      });
    },
    jailbroke: () => capture.jailbroke(),
    view: scene && {
      render: (alpha, seaTime, frameSeconds) => view?.render(alpha, seaTime, frameSeconds),
      get foot() {
        return scene?.foot;
      },
      set foot(next) {
        if (scene) scene.foot = next;
      },
    },
  });
  // The lookout for discovery (Phase 9 piece O): from the deck at the helm (through the
  // glass when it's up), from your feet ashore, or the lookouts on a chart voyage; nobody
  // looks from an arena or behind a screen that holds the world.
  lookoutRef.current = () => {
    if (arena || inArenaSpace || changingZone || machine.gameplayPaused) return undefined;
    const t = state.environment.clock.gameSeconds;
    const base = {
      daylight: daylight01(sunAt(t).elevationRad),
      visibilityM: ctx.weather.fogVisibilityAt(t),
      glassMul: 1 / instruments.spyglassFovMul,
    };
    const frame = zoneFrame(zone, zoneData);
    if (machine.mode === 'chart') {
      const travel = travelRef.current;
      if (!travel) return undefined;
      const at = travel.session.geo.projection.chartToGeo(travel.session.position);
      return { ...base, at, spyglass: false, onFoot: false };
    }
    if (machine.mode === 'onFoot' && ashore.active) {
      const p = ashore.zoneAt();
      const at = worldGeo(zoneToChart({ x: p.x, z: p.z }, frame));
      // In the boat you look from the water: a cove rowed into is sounded too.
      return { ...base, at, spyglass: false, onFoot: !ashore.inBoat };
    }
    if (machine.mode !== 'sailing') return undefined;
    const at = worldGeo(zoneToChart(shipPose(), frame));
    return { ...base, at, spyglass: cameraRig?.ship.spyglass ?? false, onFoot: false };
  };
  if (import.meta.env.DEV || params.has('debug')) {
    // `__glpDiscovery.state()` reads what's charted; `.look()` looks round now; `.chart(id)`
    // charts a place; `.curio(id)` gives a curio; `.lead(legendId)` opens a legend's lead
    // and `.clue(legendId, text)` adds a clue; `.journal()` reads the journal's pages.
    const hook = {
      state: () => discovery.state,
      leads: () => discovery.leads,
      curios: () => discovery.curios,
      look: () => discovery.look(),
      lookout: () => lookoutRef.current?.(),
      chart: (id: string, how?: Parameters<typeof discovery.chart>[1]) => discovery.chart(id, how),
      curio: (id: string, from = 'a dev hook') => discovery.giveCurio(id, from),
      setCurio: (id: string, hideout?: string) => discovery.setCurio(id, hideout),
      marks: () => discovery.marks(),
      journal: () => discovery.journal(),
      logbook: (lightId: string) => discovery.logbookRead(lightId),
      lead: (id: string, text = 'A dev hook told you.') => {
        const area = discoveriesFile().legends.find((l) => l.id === id);
        if (!area) return undefined;
        return discovery.lead({
          id,
          kind: 'legend',
          title: rumorDefs().legends.find((l) => l.id === id)?.name ?? id,
          where: area.where,
          center: area.at,
          radiusM: area.radiusM,
          clue: { text, from: 'a dev hook' },
        });
      },
      clue: (id: string, text: string) => {
        const area = discoveriesFile().legends.find((l) => l.id === id);
        const lead = discovery.leads.find((l) => l.id === id);
        if (!lead) return undefined;
        return discovery.lead({ ...lead, clue: { text, from: 'a dev hook' } }, area?.at);
      },
    };
    (window as unknown as { __glpDiscovery: typeof hook }).__glpDiscovery = hook;
  }
  // What the sounds ashore read each frame (piece I): where you stand, and the sky over it.
  audio?.setFootSource(() => {
    const at = ashore.sound();
    if (!at) return undefined;
    const t = state.environment.clock.gameSeconds;
    return {
      ...at,
      sunElevationDeg: (sunAt(t).elevationRad * 180) / Math.PI,
      month0: calendarDate(t).getUTCMonth(),
      windKn: ctx.weather.windAt(at.player, t).speedKn,
      rain01: ctx.weather.rainAt(t),
      stills: hideouts.runningStills(),
    };
  });
  ashoreRef.current = ashore;
  goAshoreRef.current = () => goAshore();
  ashoreOfferedRef.current = () => ashore.landingHere();
  machine.register(ashore.mode);
  // Build mode (Phase 8 piece C): B on foot in a hideout's bounds. Its panel has its own
  // root over the canvas; the ray for the cursor comes from the camera last drawn.
  const buildRoot = uiRoot.appendChild(document.createElement('div'));
  buildRoot.className = 'build-root';
  const rayCaster = new Raycaster();
  const rayNdc = new Vector2();
  // eslint-disable-next-line prefer-const -- the panel and the mode need each other
  let buildPanel: BuildPanelUi | undefined;
  const buildMode = attachBuildMode({
    ctx,
    hideouts,
    ashore,
    canvas: () => renderer?.renderer.domElement,
    ray: (x, y) => {
      const canvas = renderer?.renderer.domElement;
      if (!scene || !canvas) return undefined;
      const r = canvas.getBoundingClientRect();
      rayNdc.set(((x - r.left) / r.width) * 2 - 1, -((y - r.top) / r.height) * 2 + 1);
      rayCaster.setFromCamera(rayNdc, scene.camera);
      const { origin, direction } = rayCaster.ray;
      return {
        origin: { x: origin.x, y: origin.y, z: origin.z },
        dir: { x: direction.x, y: direction.y, z: direction.z },
      };
    },
    view: () => scene?.hideouts,
    ...(audio ? { sounds: audio.hideout } : {}),
    transition: (to) => machine.transition(to),
    shipHold: (id) => (stash.hideoutHere === id ? state.player.cargo : undefined),
    crewTier: () =>
      sailShipRecord(state.player.ship?.classId ?? defaultShipState().classId).tier ?? 1,
    goodName: (good) => economy.defs.goods.get(good)?.name ?? good,
    blocked: () => {
      if (ashore.pursued || run.inDanger) return 'Not with the law on your tail';
      if (machine.overlayOpen) return 'Not now';
      return undefined;
    },
    save: () => saveControls.saveNow(),
    notice: (text) => showNotice(text),
    panel: (snapshot) => buildPanel?.set(snapshot),
    concealmentNow: (id) => {
      const t = state.environment.clock.gameSeconds;
      const seen = life.spotted(id);
      // A game day is a calendar week: say it in the calendar's days.
      const days = seen ? Math.floor(((t - seen.at) / SECONDS_PER_GAME_DAY) * 7) : 0;
      return {
        night: sunAt(t).elevationRad < 0,
        shipHere: stash.hideoutHere === id || life.refuge() === id,
        spotted: seen
          ? `${seen.by}, ${days <= 0 ? 'today' : days === 1 ? 'yesterday' : `${days} days ago`}`
          : undefined,
      };
    },
    changed: () => {
      economy.syncLoad();
      hudClock = HUD_INTERVAL_S;
    },
  });
  buildPanel = mountBuildPanel(buildRoot, buildMode.actions);
  machine.register(buildMode.mode);
  // A hideout's pieces built or taken down change what you walk on.
  hideouts.onChange(() => {
    if (!buildMode.active) ashore.refreshScene();
  });
  let hideoutHinted: string | undefined;
  /** The hideouts drawn as the save has them, re-synced when they or the zone change. */
  let hideoutsDrawn = '';
  const syncHideoutsView = (): void => {
    if (!scene) return;
    const cut = buildMode.cut();
    const key = `${hideouts.version}|${zone ? zoneData.id : '-'}|${arena ? 'a' : ''}|${JSON.stringify(cut ?? '')}`;
    if (key === hideoutsDrawn) return;
    hideoutsDrawn = key;
    scene.hideouts.sync(hideouts.draw(cut));
  };
  if (import.meta.env.DEV || params.has('debug')) {
    /**
     * Build mode's dev hooks (Phase 8 piece C): `open()` as B would, `aim(x, z)` puts the
     * cursor at site meters on the level edited, `press()`/`release()` are the left mouse,
     * `key('KeyX')` a key, `select(id, variant)` the palette, `give({...})` materials into
     * the hideout's storage, `build()` the Build button, and `site()` where it all is.
     */
    const hook = {
      open: () => buildMode.open(),
      close: () => buildMode.close(),
      state: () => {
        const st = buildMode.dev.state();
        const id = buildMode.hideoutId;
        return (
          st && {
            ...st,
            storage: id ? (state.hideouts?.[id]?.storage.goods ?? []).map((g) => ({ ...g })) : [],
            gameSeconds: state.environment.clock.gameSeconds,
          }
        );
      },
      aim: (x: number, z: number) => buildMode.dev.aim(x, z),
      press: () => buildMode.dev.press(),
      release: () => buildMode.dev.release(),
      click: (x: number, z: number) => {
        buildMode.dev.aim(x, z);
        buildMode.dev.press();
        buildMode.dev.release();
      },
      drag: (from: [number, number], to: [number, number]) => {
        buildMode.dev.aim(from[0], from[1]);
        buildMode.dev.press();
        buildMode.dev.aim(to[0], to[1]);
        buildMode.dev.release();
      },
      key: (code: string, mods?: { ctrl?: boolean; shift?: boolean }) =>
        buildMode.dev.key(code, mods),
      select: (id: string, variant = 0) => buildMode.actions.piece(id, variant),
      tool: (t: 'place' | 'remove') => buildMode.actions.tool(t),
      build: () => buildMode.actions.build(),
      give: (goods: Record<string, number>, hideoutId?: string) => {
        const id = hideoutId ?? buildMode.hideoutId ?? hideouts.sites()[0]?.hideoutId;
        const h = id ? state.hideouts?.[id] : undefined;
        if (!h) return false;
        for (const [good, qty] of Object.entries(goods)) addToHold(h.storage.goods, { good, qty });
        return true;
      },
      /** The claimed sites in this zone: bounds, frame and what's built there. */
      sites: () =>
        hideouts.sites().map((x) => ({
          hideout: x.hideoutId,
          cols: x.frame.cols,
          rows: x.frame.rows,
          baseM: x.frame.baseM,
          origin: x.frame.origin,
          along: x.frame.along,
          inland: x.frame.inland,
          built: x.grid.built().length,
          planned: x.grid.planned().length,
          ids: [...new Set(x.grid.built().map((p) => p.piece.id))],
        })),
      /** A site point (meters from the bounds' corner) in zone meters. */
      toZone: (hideoutId: string, x: number, z: number) => {
        const x0 = hideouts.site(hideoutId);
        return x0 && siteToZone(x0.frame, x, z);
      },
      colliders: () => hideouts.colliders().length,
      drawn: () => scene?.hideouts.counts(),
    };
    (window as unknown as { __glpBuild: typeof hook }).__glpBuild = hook;
  }
  if (import.meta.env.DEV || params.has('debug')) {
    /**
     * `__glpFoot.dock('bayfield_city')` ties up at a pier as F would, `anchor()` lets go
     * where she is, `land()` goes ashore (G), `aboard()` comes back, `teleport(x, z)`
     * puts you there, `hour(21)` sets the clock, `state()` reads it all.
     */
    const hook = {
      land: () => ashore.goAshore(),
      aboard: () => ashore.goAboard(),
      stepAshore: () => ashore.stepAshore(),
      refusal: () => ashore.refusal(),
      castawayRefusal: () => ashore.castawayRefusal(),
      anchor() {
        const h = hazards.state;
        const p = shipPose();
        Object.assign(sailing.state, { speed: 0, sailLevel: 0, sailSetting: 0 });
        h.anchor = 'down';
        h.anchorX = p.x + Math.sin(p.heading) * shipRecord.lengthM * 0.45;
        h.anchorZ = p.z - Math.cos(p.heading) * shipRecord.lengthM * 0.45;
      },
      dock(key: string) {
        // A free side first: one the traffic holds isn't among the sailing berths, so the
        // next frame would cast her off it again (as `dockAt` does).
        const mine = (b: MooringBerth): boolean => b.dockId.includes(key);
        const berth = freeBerths().find(mine) ?? allBerths.find(mine);
        if (!berth) return false;
        placeShip(berth.pose);
        const h = hazards.state;
        h.mooring = 'docked';
        h.berthId = berth.id;
        h.from = { ...berth.pose };
        ports.markDocked(berth.id);
        return true;
      },
      /** Puts the ship at (x, z) heading `deg`, way off, e.g. off a beach to anchor. */
      place: (x: number, z: number, deg = 0) => placeShip({ x, z, heading: (deg * Math.PI) / 180 }),
      teleport: (x: number, z: number, y?: number) => ashore.teleport(x, z, y),
      hour(h: number) {
        const clock = state.environment.clock;
        const { day } = dayAndHour(clock.gameSeconds);
        clock.gameSeconds = day * SECONDS_PER_GAME_DAY + h * 3600;
      },
      setHealth: (h: number) => (state.player.health = Math.max(0, Math.min(100, h))),
      waterC: () => ashore.hud().cold?.waterC,
      month: () => calendarDate(state.environment.clock.gameSeconds).getUTCMonth(),
      state: () => {
        const c = ashore.character;
        return {
          active: ashore.active,
          from: ashore.from,
          inBoat: ashore.inBoat,
          boatState: ashore.boatState,
          boat: ashore.boat && { ...ashore.boat },
          at: { ...c.position },
          heading: c.heading,
          gait: c.gait,
          surface: c.surface,
          swimming: c.swimming,
          grounded: c.grounded,
          ladder: c.ladder,
          health: state.player.health,
          prompt: ashore.prompt(),
          ladders: ashore.scene?.ladders ?? [],
          bounds: ashore.scene?.bounds,
          ship: shipPose(),
          mooring: hazards.state.mooring,
          anchor: hazards.state.anchor,
        };
      },
      saved: () => ({ ashore: state.player.ashore, rowboat: state.player.rowboat }),
      /**
       * The walkable island you're on (Phase 7 piece H): its prefabs' pieces (zone meters,
       * tops), the cache's cairns and which holds it, and the stash's strongbox.
       */
      island: () => ({
        island: ashore.island,
        colliders: ashore.scene?.colliders.size ?? 0,
        pieces: zoneIslands().placed.flatMap((i) =>
          i.pieces.map((p) => ({ kind: p.kind, poi: p.poi, x: p.x, z: p.z, top: p.maxY })),
        ),
        cache: islandAshore.cache('cache.stockton_quarry'),
        strongbox: islandAshore.strongbox(),
      }),
      /**
       * The marshal posse on the island you're on (piece H; Phase 9 piece F): how many the
       * tier sends, where it's got to, where they landed, and the marshals ashore.
       */
      posse: () => {
        const p = ashore.posse;
        return (
          p && {
            count: p.count,
            phase: p.phase,
            landing: p.landing,
            clockS: p.clockS,
            captured: p.captured,
            pursued: p.pursued,
            guards: p.stealth.guards.map((g) => ({
              id: g.id,
              type: g.type.id,
              state: g.state,
              x: g.body.position.x,
              y: g.body.position.y,
              z: g.body.position.z,
              heading: g.body.heading,
            })),
          }
        );
      },
      /** The posse lands now instead of when its time's up; false if none would. */
      posseLand: () => ashore.posse?.land() ?? false,
      /** The posse gives up now and walks back to its boat. */
      posseGiveUp: () => ashore.posse?.giveUp(),
      /** The frame's draw calls and triangles, for bench.island (plan 17). */
      renderStats: () => {
        const r = renderer?.stats();
        return r && { drawCalls: r.drawCalls, triangles: r.triangles, scale: r.scale };
      },
      /** Presses F for a tick: whatever the prompt offers. */
      interact: () => input.trigger('Interact'),
      /** Faces a zone bearing in degrees, the camera behind you, `pitch` radians down. */
      face: (deg: number, pitch?: number) => ashore.face((deg * Math.PI) / 180, pitch),
      /** Where you stand in zone meters (`state().at` is the scene's own frame). */
      zoneAt: () => ashore.zoneAt(),
      /** The district and its watch (Phase 7): guards in the district's local meters. */
      watch: () => {
        const w = ashore.watch;
        return {
          district: ashore.district?.def.id,
          tier: w?.tier,
          pursued: ashore.pursued,
          captured: w?.stealth.captured ?? false,
          lastStepMs: w?.stealth.lastStepMs,
          guards: w?.readout().guards.map((g) => ({ ...g })) ?? [],
          gem: document.body.dataset['gem'],
        };
      },
      /** The jailbreak under way (piece G): the cell, the door and the jailer, local meters. */
      jailbreak: () => {
        const j = ashore.watch?.jailbreak;
        const g = ashore.watch?.stealth.guard('constable.jailer');
        return (
          j && {
            inCell: j.inCell,
            doorOpen: j.doorOpen,
            hasKeys: j.hasKeys,
            inIrons: j.inIrons,
            left: j.left,
            cell: { ...j.cell.spawn, door: { x: j.cell.door.x, z: j.cell.door.z } },
            jailer: g && {
              state: g.state,
              x: g.body.position.x,
              z: g.body.position.z,
              waitS: g.waitS,
            },
            banner: ashore.hud().banner,
          }
        );
      },
      /** The ships moored in the district (piece F): gangway, hold and cabin, local meters. */
      moored: () =>
        (ashore.watch?.moored ?? []).map((s) => ({
          id: s.id,
          key: s.key,
          name: s.name,
          crew: s.crew,
          cargo: s.cargo,
          at: { x: s.x, z: s.z, heading: s.heading },
          gangway: s.gangway,
          hold: s.hold,
          cabin: s.cabin,
          watch: s.watch,
          alongside: ashore.watch?.alongside(s) ?? false,
        })),
      /** The crews in the saloon now, with their table (local meters) and their price. */
      crews: () =>
        (ashore.watch?.crews() ?? []).map((c) => ({
          ship: c.ship.key,
          x: c.mark.x,
          z: c.mark.z,
          bottles: c.bottles,
          stood: c.stood,
        })),
      /** Puts you at district-local (x, z), on the floor there, facing a local heading (deg). */
      teleportLocal: (x: number, z: number, headingDeg?: number, pitch?: number) => {
        const d = ashore.district;
        if (!d) return false;
        const p = d.frame.toZone(x, z);
        ashore.teleport(p.x, p.z);
        if (headingDeg !== undefined) {
          ashore.face(d.frame.headingToZone((headingDeg * Math.PI) / 180), pitch);
        }
        return true;
      },
      /**
       * Piece E: stands you `distM` behind a guard (held at his post), facing his way, as a
       * cosh would want. False if there's no such guard.
       */
      behindGuard: (id: string, distM = 1.5) => {
        const d = ashore.district;
        const g = ashore.watch?.stealth.guard(id);
        if (!g) return false;
        g.waitS = 1e6;
        g.path = undefined;
        const wp = g.route.points[g.waypoint];
        if (wp) wp.face = g.body.heading;
        const h = g.body.heading;
        const x = g.body.position.x - Math.sin(h) * distM;
        const z = g.body.position.z + Math.cos(h) * distM;
        // A district's guards walk its local frame; a station's keepers walk the zone's.
        const p = d ? d.frame.toZone(x, z) : { x, z };
        ashore.teleport(p.x, p.z, g.body.position.y);
        ashore.face(d ? d.frame.headingToZone(h) : h);
        return true;
      },
      /** Piece E: a cosh, two lengths of rope and three bottles, as if from the chandlery. */
      restock: () => {
        state.player.stores['store.cosh'] = 1;
        state.player.stores['store.rope'] = 2;
        state.player.stores['store.whiskey'] = 3;
      },
      /** The district's lamps, local meters: lit, or put out (plan 08 §6). */
      lamps: () =>
        (ashore.watch?.lamps ?? []).map((l, k) => ({
          k,
          piece: ashore.district?.model.lamps[k]?.piece,
          x: l.x,
          y: l.y,
          z: l.z,
          lit: l.lit,
          doused: l.doused ?? false,
        })),
      /** Puts out lamp `k` as F would (the noise, and the watch grows wary if it saw). */
      douse: (k: number) => {
        const w = ashore.watch;
        if (!w?.lamps[k]?.lit) return false;
        w.douseLamp(k, ashore.character);
        return true;
      },
      /** Leaning (Q/E): how far (−1 left … 1 right) and the head's offset, local meters. */
      lean: () => ({ ...ashore.lean }),
      /** Part two: picks, a crowbar and the pistol, as if from the chandlery. */
      restockBurglar: () => {
        state.player.stores['store.lockpicks'] = 4;
        state.player.stores['store.crowbar'] = 1;
        state.player.stores['store.pistol'] = 1;
      },
      /** Part two: the locks and loot, in the district's local meters. */
      heist: () => {
        const h = ashore.watch?.heist;
        const t = state.environment.clock.gameSeconds;
        return {
          carrying: h?.carrying && { ...h.carrying },
          doors:
            h?.doors.map((d) => ({ id: d.id, x: d.x, z: d.z, locked: h.locked(d.id, t) })) ?? [],
          containers:
            h?.containers.map((c) => ({
              mark: c.mark,
              x: c.x,
              z: c.z,
              ...h.contents(c.mark, t),
            })) ?? [],
          hot: state.player.cargo.filter((s) => s.hot).map((s) => ({ ...s })),
          stow: ashore.stowPoints()[0],
          prompt: ashore.toolsHud()?.prompt?.label,
        };
      },
      /** Piece E: the tool belt and conduct as the HUD has them. */
      tools: () => {
        const w = ashore.watch;
        return {
          selected: w?.tools?.selected.id,
          carrying: w?.tools?.carrying,
          conduct: w?.conduct?.reason,
          offer: ashore.toolsHud()?.prompt?.label,
          purse: state.player.purse,
        };
      },
      /**
       * Overrides whether being seen is suspicious (true: anything you do is; undefined: the
       * conduct rule), to test detection, pursuit and capture end to end.
       */
      suspect: (on: boolean | undefined) => {
        suspectOverride.value = on;
      },
      /** Ground height above the lake at a zone point (negative under water). */
      height: (x: number, z: number) => ctx.terrain?.heightAt(x, z),
      save: () => saveControls.saveNow(),
    };
    (window as unknown as { __glpFoot: typeof hook }).__glpFoot = hook;
    /**
     * Lighthouse stations on foot (plan 11 §18.4 piece H): `list()` the zone's stations,
     * `land(id)` anchors off one and lands on its beach, `goto('tower' | 'house' | 'oil' |
     * 'gallery' | 'landing')` stands you there, `here()` reads the station you're at (its
     * prompt, keepers and record), and `act()` does what F would there at once.
     */
    const stationAt = () => ashore.watch?.station;
    const stationHook = {
      list: () =>
        zoneStations().map((s) => ({
          id: s.def.light,
          name: s.light.def.name,
          island: s.island,
          tower: { x: s.light.x, y: s.light.groundM, z: s.light.z },
          doors: s.doors,
          gallery: s.gallery,
          landing: s.landing && { x: s.landing.x, z: s.landing.z },
          bluff: s.bluff,
          treads: s.stairs.length,
          record: state.lightStations?.[s.def.light],
          dark: lampOut(state.lightStations?.[s.def.light]),
          onDuty: keepersOnDuty(
            s.light.def,
            state.lightStations?.[s.def.light],
            state.environment.clock.gameSeconds,
          ),
        })),
      async land(id: string): Promise<string | undefined> {
        const st = zoneStations().find((s) => s.def.light === id);
        const terrain = zone?.terrain;
        if (!st || !terrain) return 'No such station in this zone';
        const spot = viewingSpot(st.light, terrain, 260);
        if (!spot) return 'No water off it';
        let why: string | undefined = 'Not yet';
        // A slow frame rate takes a few ticks to bring her to her anchor.
        for (let tries = 0; tries < 12 && why; tries++) {
          hook.place(spot.x, spot.z, (spot.heading * 180) / Math.PI);
          hook.anchor();
          await new Promise((done) => setTimeout(done, 800));
          why = await hook.land();
        }
        if (why) return why;
        await new Promise((done) => setTimeout(done, 1200));
        const fx = Math.sin(st.light.seaward);
        const fz = -Math.cos(st.light.seaward);
        const rx = -fz;
        const rz = fx;
        let wx = st.light.x;
        let wz = st.light.z;
        for (let d = 4; d < 160; d++) {
          wx = st.light.x + fx * d;
          wz = st.light.z + fz * d;
          if (terrain.heightAt(wx, wz) <= 0.2) break;
        }
        hook.teleport(wx + fx * 1.5 + rx * 3, wz + fz * 1.5 + rz * 3);
        await new Promise((done) => setTimeout(done, 800));
        const refused = await hook.stepAshore();
        const ladder = st.landingLadder;
        if (!refused || !ladder) return refused ?? undefined;
        // A cliff: up the landing stage's ladder instead, and onto its deck.
        hook.teleport(ladder.x + fx * 1.6, ladder.z + fz * 1.6);
        await new Promise((done) => setTimeout(done, 800));
        hook.interact();
        await new Promise((done) => setTimeout(done, 400));
        ashore.character.ladder = undefined;
        ashore.teleport(ladder.topX, ladder.topZ, ladder.topY + 0.05);
        return ashore.inBoat ? refused : undefined;
      },
      goto(part: 'tower' | 'house' | 'oil' | 'gallery' | 'landing' | 'bluff') {
        const st = stationAt()?.station;
        if (!st) return false;
        const p =
          part === 'gallery'
            ? st.gallery.stand
            : part === 'bluff'
              ? st.bluff?.foot
              : part === 'landing'
                ? st.landing && { x: st.landing.x, y: st.landing.maxY, z: st.landing.z }
                : st.doors[part];
        if (!p) return false;
        ashore.teleport(p.x, p.z, p.y + 0.05);
        const to = part === 'gallery' ? st.gallery.lamp : { x: st.light.x, z: st.light.z };
        ashore.face(Math.atan2(to.x - p.x, -(to.z - p.z)));
        return true;
      },
      here() {
        const w = stationAt();
        if (!w) return undefined;
        const o = w.offer(ashore.character);
        return {
          id: w.station.def.light,
          offer: o && { label: o.label, ok: o.ok, why: o.why },
          at: { ...ashore.character.position },
          aloft: w.aloft(ashore.character),
          carrying: w.carrying?.good,
          keepers: (ashore.watch?.stealth.guards ?? []).map((g) => ({
            id: g.id,
            name: g.name,
            state: g.state,
            x: g.body.position.x,
            y: g.body.position.y,
            z: g.body.position.z,
          })),
          record: state.lightStations?.[w.station.def.light],
          conduct: ashore.watch?.conduct?.words,
        };
      },
      act() {
        const w = stationAt();
        const o = w?.offer(ashore.character);
        if (!o?.ok) return o ? `${o.label}: ${o.why ?? 'not now'}` : undefined;
        o.act();
        stationLights();
        return o.label;
      },
      /** For screenshots: look from `from` at `to` (zone meters), or back behind you. */
      camera(from?: { x: number; y: number; z: number }, to?: { x: number; y: number; z: number }) {
        ashore.cameraOverride = from && to ? () => ({ position: from, target: to }) : undefined;
      },
      settle: () =>
        stationLights().map((p) => ({ id: p.def.id, lit: p.def.lit, keepers: p.def.keepers })),
      /** Jumps the clock `days` on and runs the finding of a keeper nobody was left to tell. */
      pass(days: number) {
        state.environment.clock.gameSeconds += days * SECONDS_PER_GAME_DAY;
        return keeperFound.step();
      },
    };
    (window as unknown as { __glpStation: typeof stationHook }).__glpStation = stationHook;
    // `?ashore=bayfield` ties up at the fish pier and goes ashore; `?ashore=stockton` anchors
    // off the quarry and lands on the island; `?ashore=siskiwit` anchors off the logging
    // camp's dock and lands on its mainland pad (Phase 8 piece D). The dev jump menu uses
    // them (plan 08 §20.8).
    const jumpTo = params.get('ashore');
    if (jumpTo === 'bayfield' || jumpTo === 'stockton' || jumpTo === 'siskiwit') {
      const wait = (ms: number) => new Promise((done) => setTimeout(done, ms));
      const campDock = () =>
        harborLayouts.flatMap((l) => l.piers).find((p) => p.id === 'pier.siskiwit_dock');
      void (async () => {
        for (let tries = 0; tries < 120; tries++) {
          await wait(500);
          if (jumpTo === 'bayfield') {
            if (!hook.dock('bayfield_fish')) continue;
          } else if (jumpTo === 'siskiwit') {
            const dock = campDock();
            if (!dock) continue;
            // Off the dock's end, broadside to it, where the site's anchorage is.
            const out = dock.lengthM + 50;
            hook.place(
              dock.root.x + Math.sin(dock.bearing) * out,
              dock.root.z - Math.cos(dock.bearing) * out,
              ((dock.bearing * 180) / Math.PI + 90) % 360,
            );
            hook.anchor();
          } else {
            const derrick = hook.island().pieces.find((p) => p.kind === 'derrick');
            if (!derrick) continue;
            hook.place(derrick.x + 60, derrick.z, 0);
            hook.anchor();
          }
          await wait(1000);
          const why = await hook.land();
          if (why) console.warn(`Going ashore: ${why}`);
          if (jumpTo === 'stockton') {
            // Landed in the boat at anchor: row her in and step onto the quarry's wharf.
            const derrick = hook.island().pieces.find((p) => p.kind === 'derrick');
            if (derrick) {
              await wait(1500);
              hook.teleport(derrick.x + 2, derrick.z);
              await wait(1000);
              hook.stepAshore();
            }
          } else if (jumpTo === 'siskiwit') {
            // Row her in beside the dock and run her up on the beach.
            const dock = campDock();
            if (dock) {
              await wait(1500);
              const rx = Math.cos(dock.bearing);
              const rz = Math.sin(dock.bearing);
              hook.teleport(
                dock.root.x + rx * 6 + Math.sin(dock.bearing) * 2,
                dock.root.z + rz * 6 - Math.cos(dock.bearing) * 2,
              );
              await wait(1000);
              hook.stepAshore();
            }
          }
          return;
        }
        console.warn(`Going ashore to ${jumpTo} timed out`);
      })();
    }
  }
  /** G at the helm or on the port screen: ashore, or why not. */
  const goAshore = (): void => {
    if (ports.openPort) ports.close();
    void ashore.goAshore().then((why) => why && showNotice(why));
  };
  machine.onTransition((_, to) => {
    document.body.dataset['ashore'] =
      to === 'onFoot' ? (ashore.inBoat ? 'boat' : 'foot') : to === 'build' ? 'foot' : 'aboard';
  });
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
      /** Heaves one or every arena ship to (for gunnery checks and the like). */
      stop: (id?: string) => {
        if (!arena) return 0;
        let n = 0;
        for (const { entity, steer } of arena.ships) {
          if (id && entity.id !== id) continue;
          steer.vx = 0;
          steer.vz = 0;
          steer.helm.speedKn = 0;
          steer.helm.state = 'stopped';
          steer.helm.orders = { mode: 'stop' };
          if (entity.velocity) {
            entity.velocity.x = 0;
            entity.velocity.z = 0;
          }
          if (entity.npc) entity.npc.speedKn = 0;
          n++;
        }
        return n;
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
    pursued: () =>
      pursued || !!arena?.run.pursued || lawAtSea.locked || !!ashoreRef.current?.pursued,
    // A look at the chart from the helm can let the ship sail on in the zone behind it.
    sailOn: () => sailOnAllowed(),
    sailTick: (dt) => sailingMode.update?.(dt),
    forecastHours: () => instruments.forecastHours,
    chartSpeedMul: () => instruments.chartSpeedMul,
    // The winter's ice (piece K): drawn on the chart, closing courses, slowing her in floes.
    ice: {
      closed: (p) => gameIce.closesHere(p),
      drag: (p) => gameIce.drag(p),
      picture: () => gameIce.picture(),
    },
    // A look at the chart from on foot (plan 08 §20.4 follow-up): where you stand ashore,
    // and the rowboat if you left it, alongside the schooner.
    ashorePositions: () => ashoreRef.current?.chartPositions(),
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
      ...smuggler.marks().map((m) => ({
        at: m.at,
        label: `${m.def.anchorage.name} (after dark)`,
        kind: 'smuggler' as const,
      })),
      // The wrecking marks (Phase 9 piece I), pencilled in once you've a rig aboard or
      // burning, and the ships your lights put aground there.
      ...((state.player.stores['store.false_light'] ?? 0) > 0 || wrecking.lit().length > 0
        ? MARKS.map((m) => ({ at: m.rig, label: m.name, kind: 'wrecking' as const }))
        : []),
      ...wrecking.stranded().flatMap((s) => {
        const m = MARKS.find((x) => x.id === s.mark);
        return m ? [{ at: m.shoal, label: `${s.name}, aground`, kind: 'wreck' as const }] : [];
      }),
      // Wrecks on the lake (Phase 6 piece F): where each lies, in the chart's sign, once
      // they're on your chart (piece O: yours always; the lake's when seen or read of).
      ...(state.wrecks?.list ?? [])
        .filter((w) => discovery.knows(w.id))
        .map((w) => ({
          at: w.at,
          label: `Wreck of the ${w.name}`,
          kind: 'wreck' as const,
        })),
      // What's been found and what's talked of (piece O), and the leads' search circles.
      ...discovery.marks(),
      ...discovery.leadMarks().map((l) => ({ ...l, kind: 'lead' as const })),
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
  /** Your ship is going down under you (Phase 6 piece F): a danger like a hunt. */
  const foundering = (): boolean => hazards.state.foundering && !abandon.open;
  const setDanger = (on: boolean): void => {
    run.inDanger = on;
    document.body.dataset['danger'] = on ? 'on' : 'off';
    if (on) {
      const hunt = [...pursuitOn][0];
      const sinking = !hunt && !arena?.run.pursued && !pursued && foundering();
      state.danger = {
        kind: sinking ? 'foundering' : 'pursuit',
        by: sinking ? 'sea' : (hunt ?? 'law.morrill'),
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
      const hunted =
        (pursued ||
          !!arena?.run.pursued ||
          pursuitOn.size > 0 ||
          foundering() ||
          !!ashoreRef.current?.pursued) &&
        !run.over;
      if (hunted !== run.inDanger) setDanger(hunted);
      // Hideout life (Phase 8 piece F): being spotted, the save on leaving, a load left.
      if (!run.over && !changingZone) life.step(dt);
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
      if (sameContext && chartFree && input.context === 'onFoot' && input.pressed('ToggleChart')) {
        const refused = chartTravel.openLookAshore();
        if (refused) showNotice(refused);
      }
      if (sameContext && input.context === 'onFoot' && input.pressed('Build')) {
        const refused = buildMode.open();
        if (refused) showNotice(refused);
      }
      syncHideoutsView();
      // The traffic sails on the clock: in the zone, every tick (Phase 4 piece D), and
      // behind a look at the chart while the ship sails on.
      const inZone =
        machine.mode === 'sailing' || machine.mode === 'onFoot' || chartTravel.trip === 'look';
      if (inZone && !arena && !changingZone) {
        if (traffic.step(hazards.state.berthId)) sailingOptions.berths = freeBerths();
        smuggler.step(shipPose());
        syncWrecking();
      }
      lantern.step();
      if (sameContext && input.context === 'sailing' && input.pressed('Lantern')) {
        showNotice(lantern.toggle());
        hudClock = HUD_INTERVAL_S;
      }
      if (machine.mode === 'sailing' && !machine.gameplayPaused && !changingZone) {
        detection.step(dt);
        abandon.step(dt);
      }
      // Landed by the ship that picked you up, once the arena you sank in is gone.
      if (landingPort && !arena && !inArenaSpace && !changingZone && !run.over) {
        const port = landingPort;
        landingPort = undefined;
        void dockAt(port, `pier.${port.replace(/^port\./, '')}_city`);
      }
      if (landingHideout && !arena && !inArenaSpace && !changingZone && !run.over) {
        const id = landingHideout;
        landingHideout = undefined;
        void landAtHideout(id);
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
      if (
        sameContext &&
        input.context === 'sailing' &&
        !machine.overlayOpen &&
        input.pressed('GoAshore')
      ) {
        goAshore();
      }
      const inGame =
        input.context === 'sailing' || input.context === 'chart' || input.context === 'onFoot';
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
      if (falseLights) {
        const sun = sunAt(state.environment.clock.gameSeconds).elevationRad;
        falseLights.update(performance.now() / 1000, Math.min(1, Math.max(0, -sun / 0.15)));
      }
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
      // The lookout's look round for discovery (piece O), about once a second.
      discoveryClock += frameSeconds;
      if (discoveryClock >= DISCOVERY_LOOK_S) {
        discoveryClock = 0;
        if (!run.over) discovery.look();
      }
      if (notice && hudSeconds > notice.untilS) {
        notice = undefined;
        hudClock = HUD_INTERVAL_S;
      }
      if (card && (hudSeconds > card.untilS || cardOutOfHail())) {
        hideCard();
      }
      if (hudClock >= HUD_INTERVAL_S && machine.mode === 'onFoot') {
        hudClock = 0;
        // Walking into your hideout's bounds, once each time: how to build there.
        const inSite =
          ashore.active && !ashore.inBoat ? hideouts.siteAt(ashore.zoneAt())?.hideoutId : undefined;
        if (inSite && inSite !== hideoutHinted) {
          const key = codeLabel(input.bindings.onFoot.Build?.[0] ?? 'KeyB');
          showNotice(`Your hideout: ${key} to build`);
        }
        hideoutHinted = inSite;
        ui.setHud(undefined);
        ui.setCaptions([]);
        const now = state.environment.clock.gameSeconds;
        const body = ashore.hud();
        ui.setFootHud({
          dateText: weekLabel(now),
          timeText: clockLabel(now),
          health: body.health,
          hurt: body.hurt,
          cold: body.cold,
          prompt: body.prompt,
          notice: notice?.text,
          inBoat: body.inBoat,
          mouseLocked: footLook.locked,
          banner: body.banner,
        });
        document.body.dataset['ashore'] = body.inBoat
          ? 'boat'
          : body.swimming
            ? 'swimming'
            : 'foot';
        document.body.dataset['footPrompt'] = body.prompt ?? '';
        document.body.dataset['health'] = String(Math.round(body.health));
        // The stealth HUD in a district (Phase 7 piece D): what the watch sees of you.
        const readout = ashore.stealthReadout();
        const cam = scene?.camera;
        const canvas = renderer?.renderer.domElement;
        if (readout) {
          const vp = { width: canvas?.clientWidth ?? 1280, height: canvas?.clientHeight ?? 720 };
          const v = new Vector3();
          const project = (q: { x: number; y: number; z: number }) => {
            if (!cam) return { x: vp.width / 2, y: vp.height / 2, behind: false };
            v.set(q.x, q.y, q.z).applyMatrix4(cam.matrixWorldInverse);
            const behind = v.z > 0;
            v.set(q.x, q.y, q.z).project(cam);
            return { x: ((v.x + 1) / 2) * vp.width, y: ((1 - v.y) / 2) * vp.height, behind };
          };
          const snap = stealthHud(readout, ashore.zoneAt(), project, vp, now);
          const tools = ashore.toolsHud();
          const report = portLaw.report();
          ui.setStealthHud({
            ...snap,
            ...(tools ? { tools } : {}),
            ...(report ? { report } : {}),
          });
          const conduct = ashore.watch?.conduct;
          document.body.dataset['conduct'] = conduct?.reason ?? 'none';
          document.body.dataset['gem'] = snap.gem.level;
          document.body.dataset['danger'] = snap.danger;
        } else {
          ui.setStealthHud(undefined);
          delete document.body.dataset['gem'];
          delete document.body.dataset['danger'];
        }
      } else if (hudClock >= HUD_INTERVAL_S && machine.mode === 'build') {
        // Build mode has its own panel (Phase 8 piece C).
        hudClock = 0;
        ui.setFootHud(undefined);
        ui.setStealthHud(undefined);
        ui.setHud(undefined);
        ui.setCaptions([]);
      } else if (hudClock >= HUD_INTERVAL_S && machine.mode === 'chart') {
        hudClock = 0;
        ui.setFootHud(undefined);
        ui.setStealthHud(undefined);
        ui.setHud(undefined);
        ui.setCaptions([]);
        chartTravel.sampleHud();
      } else if (hudClock >= HUD_INTERVAL_S) {
        hudClock = 0;
        ui.setFootHud(undefined);
        ui.setStealthHud(undefined);
        if (document.body.dataset['gem']) {
          delete document.body.dataset['gem'];
          delete document.body.dataset['danger'];
        }
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
            canGoAshore:
              machine.mode === 'sailing' && !ashore.refusal()
                ? hazards.state.mooring === 'docked'
                  ? 'gangway'
                  : 'boat'
                : undefined,
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
  // Saved ashore (Phase 7 piece A): the ship moored as she was left, and you where you stood.
  // A dev jump (the overlay's Jump to, or a place switch) puts the ship somewhere new, so
  // you start back aboard her there, the boat stowed, not in the boat at the old place.
  const jumped = jumpPlacesShip(params);
  if (jumped && state.player.ashore) {
    state.player.ashore = null;
    state.player.rowboat = { state: 'stowed' };
  }
  const savedAshore = state.player.ashore;
  // Shipless at a hideout (piece G) but not saved on foot there: set ashore there again.
  if (state.player.shipless && !savedAshore && !state.jail && !paramDef) {
    void landAtHideout(state.player.shipless.hideout);
  }
  if (savedAshore && machine.mode === 'sailing' && !state.jail && !paramDef) {
    const h = hazards.state;
    const berth = savedAshore.berthId
      ? allBerths.find((b) => b.id === savedAshore.berthId)
      : undefined;
    if (berth) {
      placeShip(berth.pose);
      h.mooring = 'docked';
      h.berthId = berth.id;
      h.from = { ...berth.pose };
      ports.markDocked(berth.id);
    } else if (savedAshore.anchor) {
      h.anchor = 'down';
      h.anchorX = savedAshore.anchor.x;
      h.anchorZ = savedAshore.anchor.z;
    }
    ashore.resume(savedAshore);
    document.body.dataset['start'] = 'ashore';
  }
  // Loaded from the danger snapshot (plan 16 §4.3): the hunter is back on your tail. On the
  // chart she closes and can't be avoided; in a zone, the arena opens around you.
  const danger = state.danger;
  // Foundering (Phase 6 piece F): she's holed to nothing again and goes on sinking.
  if (danger?.kind === 'foundering' && !state.jail) {
    hazards.state.hull = 0;
    hazards.state.foundering = true;
    document.body.dataset['dangerResumed'] = danger.by;
  }
  if (danger?.kind === 'pursuit' && !state.jail) {
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
