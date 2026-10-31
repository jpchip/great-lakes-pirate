import { DEFAULT_COMPRESSION, KNOT_MS, sceneSpeed, type Chart } from '../../core/coords';
import { EventBus } from '../../core/events';
import { InputMapper } from '../../core/input';
import { createLoop } from '../../core/loop';
import { Rng } from '../../core/rng';
import { advanceClock, dayAndHour, R_SAILING } from '../../core/time';
import { buoyancySystem } from '../../gameplay/buoyancy';
import { createGameWorld, snapshotTransforms } from '../../gameplay/ecs';
import { hazardSystem, onShipJibed } from '../../gameplay/hazards';
import { heelSystem, sailingSystem } from '../../gameplay/sailing';
import {
  CHART_TIME_SCALE,
  createChartMode,
  type ChartSession,
  type EncounterChoice,
} from '../../modes/chart';
import type { GameContext, GameEvents } from '../../modes/context';
import { ModeMachine, type Mode } from '../../modes/machine';
import { playerCommand, playerMooring } from '../../modes/sailing';
import { ChartView } from '../../render/chart/chart-view';
import { initialQuality, browserStorage } from '../../render/quality';
import { GameRenderer } from '../../render/renderer';
import { westernSuperiorChart } from '../../sim/chart/chart-data';
import { distance, zoneById, type ChartZone } from '../../sim/chart/geography';
import {
  avoidChance,
  createContacts,
  daylight,
  playerSeesAtM,
  spotRangeM,
  stepContacts,
  weatherFactor,
  type Encounter,
  type LookoutPref,
} from '../../sim/chart/traffic';
import { chartSpeedKn, estimateSeconds, PROTOTYPE_SCHOONER } from '../../sim/chart/voyage';
import {
  IDLE_COMMAND,
  SAIL_LEVELS,
  speedKn,
  type SailingCommand,
  type SailingWind,
} from '../../sim/sailing/controller';
import { IDLE_MOORING, type MooringCommand } from '../../sim/sailing/hazards';
import { createLocalWeather } from '../../sim/weather/local-weather';
import { createSea } from '../../sim/weather/waves';
import { createWorldState } from '../../sim/world-state';
import {
  ARENA_HALF_M,
  addArenaEntities,
  createArenaState,
  distanceToTarget,
  holdProgress,
  INTERACT_RANGE_M,
  stepArena,
  stormLeftS,
  type ArenaState,
} from './arena';
import { createArenaScene, type ArenaScene } from './arena-scene';
import {
  clockText,
  compassPoint,
  durationText,
  encounterText,
  engageLabel,
  nm,
  weekText,
} from './text';

/**
 * Prototype S8 entry (dev only: `npm run dev`, then open /chart-spike.html). Plot a
 * course on the western Superior chart, sail it with time compressed, and drop into an
 * empty arena when the lookouts call something.
 *
 * Query options: `?hour=21` starts at that game hour, `?seed=x` reseeds the traffic.
 */

const params = new URLSearchParams(window.location.search);
const seed = params.get('seed') ?? 'spike-s8';
const startHour = Number(params.get('hour') ?? 8);

const $ = <T extends HTMLElement>(id: string): T => {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Missing #${id}`);
  return el as T;
};

const geo = westernSuperiorChart();
const at = (lat: number, lon: number): Chart => geo.projection.geoToChart({ lat, lon });

/** Departure points just outside each zone's soft edge (plan 03 §5.3 step 1). */
const DEPARTURES: Record<string, Chart> = {
  duluth: at(46.8, -91.96),
  two_harbors: at(46.96, -91.62),
  siskiwit: at(46.95, -91.2),
  apostles: at(47.15, -90.75),
};

const state = createWorldState(seed);
state.environment.clock.gameSeconds = startHour * 3600;
const input = new InputMapper();
input.attach(window);
const ctx: GameContext = {
  state,
  world: createGameWorld(),
  rng: Rng.fromState(state.environment.rng),
  input,
  events: new EventBus<GameEvents>(),
  sea: createSea(),
  weather: createLocalWeather(),
};
const clock = state.environment.clock;
const hour = (): number => dayAndHour(clock.gameSeconds).hour;

const session: ChartSession = {
  geo,
  ship: PROTOTYPE_SCHOONER,
  position: DEPARTURES['duluth'] as Chart,
  heading: Math.PI / 2,
  // A northwest breeze, the test bay's prevailing wind (plan 04 §6.1).
  wind: { from: (315 * Math.PI) / 180, speedKn: 12 },
  contacts: createContacts(geo.projection, Rng.fromSeed(`${seed}-traffic`)),
  waypoints: [],
  course: undefined,
  voyage: undefined,
  lookout: 'threatsAndPrizes',
  timeScale: CHART_TIME_SCALE,
  pending: undefined,
  handled: new Set(),
  quietUntil: 0,
};

// ---------------------------------------------------------------- chart mode and view

const view = new ChartView($<HTMLCanvasElement>('chart-canvas'));
view.fit(geo.charted.min, geo.charted.max);
window.addEventListener('resize', () => view.fit(geo.charted.min, geo.charted.max));

let paused = false;
const chartMode = createChartMode(ctx, session, {
  onEncounter: showEncounter,
  onArrived: showArrival,
});
const machine = new ModeMachine();
machine.onTransition((_, to) => (document.body.dataset['mode'] = to));

// ---------------------------------------------------------------- arena (sailing) mode

let arenaScene: ArenaScene | undefined;
let arenaRenderer: GameRenderer | undefined;
let arena: ArenaState | undefined;
const arenaWorld = createGameWorld();
const ARENA_SCALE = { rate: R_SAILING, compression: DEFAULT_COMPRESSION };
const OPEN_WATER = { docks: [], berths: [] };
const helm: SailingCommand = { ...IDLE_COMMAND };
const mooring: MooringCommand = { ...IDLE_MOORING };

const arenaMode: Mode = {
  id: 'sailing',
  enter() {
    input.context = 'sailing';
  },
  update(dt) {
    if (!arena || !arenaScene) return;
    snapshotTransforms(arenaWorld);
    arenaScene.sea.time += dt;
    // The world keeps ticking at the sailing rate while you're in the arena.
    const ticks = advanceClock(clock, dt, R_SAILING);
    for (let i = 0; i < ticks; i++)
      ctx.events.emit('WorldTick', { gameSeconds: clock.gameSeconds });
    stepContacts(session.contacts, dt * R_SAILING, session.wind, geo.charted);
    const a = arena;
    const wind = (): SailingWind => a.sailingWind;
    sailingSystem(
      arenaWorld,
      (e) => (e.playerControlled ? playerCommand(input, helm) : IDLE_COMMAND),
      wind,
      arenaScene.sea,
      ARENA_SCALE,
      dt,
      (e, ev) => {
        if (ev.kind === 'jibe') onShipJibed(e, ev.uncontrolled);
      },
    );
    hazardSystem(
      arenaWorld,
      (e) => (e.playerControlled ? playerMooring(input, mooring) : IDLE_MOORING),
      OPEN_WATER,
      wind,
      ARENA_SCALE,
      dt,
    );
    stepArena(arena, input, dt);
    buoyancySystem(arenaWorld, arenaScene.sea, dt);
    heelSystem(arenaWorld);
  },
  render(alpha, frameSeconds) {
    arenaScene?.render(arenaWorld, alpha, frameSeconds);
  },
};

const wrappedChart: Mode = {
  ...chartMode,
  update(dt) {
    if (!paused) chartMode.update(dt);
  },
};
machine.register(wrappedChart).register(arenaMode).transition('chart');

function enterArena(enc: Encounter): void {
  // Show the arena container first so the renderer is sized to it.
  machine.transition('sailing');
  if (!arenaRenderer) {
    arenaRenderer = new GameRenderer(
      $('arena'),
      initialQuality(window.location.search, browserStorage()),
    );
    arenaScene = createArenaScene(arenaRenderer);
  }
  arenaScene?.resize();
  arenaWorld.clear();
  arena = createArenaState(enc, { ...session.wind });
  addArenaEntities(arenaWorld, arena);
  arenaScene?.setup(arenaWorld, enc.contact.kind, daylight(hour()));
}

function leaveArena(): void {
  if (!arena) return;
  const { contact, result } = arena;
  arena = undefined;
  arenaWorld.clear();
  machine.transition('chart');
  if (result === 'caught') {
    session.voyage = undefined;
    showNotice(
      `Boarded by the ${contact.name.replace('Revenue cutter ', '')}`,
      'The cutter ran you down. Capture and jail are plans 06 and 12; the prototype just ends the voyage here.',
    );
    log(`Caught by ${contact.name}; voyage ended`);
    return;
  }
  chartMode.resumeFrom(contact.id);
  if (result === 'resolved') {
    log(`${contact.name}: dealt with`);
    if (contact.kind === 'derelict') {
      session.contacts = session.contacts.filter((c) => c !== contact);
    }
  } else {
    log(`Left ${contact.name} behind`);
  }
  if (!session.voyage) log('Back on the chart');
}

// ---------------------------------------------------------------- encounter and arrival cards

const encCard = $('encounter');
const noticeCard = $('notice');

function showEncounter(enc: Encounter): void {
  const { kind, text } = encounterText(enc, session.heading);
  $('enc-kind').textContent = kind;
  $('enc-name').textContent = enc.contact.name;
  $('enc-text').textContent = text;
  $('enc-forced').textContent = enc.forced
    ? `She has seen you and is closing. There's no avoiding this one.`
    : '';
  $('enc-engage').textContent = engageLabel(enc);
  const avoid = $<HTMLButtonElement>('enc-avoid');
  const ignore = $<HTMLButtonElement>('enc-ignore');
  avoid.hidden = enc.forced;
  // Threats can't just be ignored: meet them or steer clear.
  ignore.hidden = enc.forced || enc.contact.threat;
  if (!enc.forced) {
    const weather = weatherFactor(session.position, session.contacts);
    const p = avoidChance(enc, hour(), session.voyage?.speedKn ?? 0, weather);
    avoid.textContent = enc.contact.hostile ? `Avoid (${Math.round(p * 100)}%)` : 'Steer clear';
  }
  encCard.hidden = false;
}

function answerEncounter(choice: EncounterChoice): void {
  const enc = session.pending;
  if (!enc) return;
  encCard.hidden = true;
  const { outcome, escaped } = chartMode.resolve(choice);
  if (escaped === false) log(`Failed to slip ${enc.contact.name}`);
  if (escaped === true) {
    log(`${enc.contact.hostile ? 'Slipped away from' : 'Steered clear of'} ${enc.contact.name}`);
  }
  if (outcome === 'arena') enterArena(enc);
}

$('enc-engage').addEventListener('click', () => answerEncounter('engage'));
$('enc-avoid').addEventListener('click', () => answerEncounter('avoid'));
$('enc-ignore').addEventListener('click', () => answerEncounter('ignore'));

function showNotice(title: string, text: string): void {
  $('notice-title').textContent = title;
  $('notice-text').textContent = text;
  noticeCard.hidden = false;
}
$('notice-ok').addEventListener('click', () => (noticeCard.hidden = true));

function showArrival(zone: ChartZone | undefined): void {
  if (zone) {
    showNotice(
      `Arrived: ${zone.name}`,
      `You've reached the edge of the ${zone.name} zone. In the game the zone loads here (under 8 s, behind a chart-unrolling transition) and you sail in. The prototype stays on the chart: plot your next leg from here.`,
    );
  } else {
    showNotice('Arrived', 'You reached your last waypoint in open water. Plot your next leg.');
  }
}

// ---------------------------------------------------------------- event log

const logList = $('log-list');
function log(text: string): void {
  const li = document.createElement('li');
  li.textContent = `${clockText(clock.gameSeconds)} · ${text}`;
  logList.prepend(li);
  while (logList.children.length > 8) logList.lastElementChild?.remove();
}
ctx.events.on('VoyageStarted', ({ lengthM, destinationZoneId }) => {
  const zone = destinationZoneId ? zoneById(geo, destinationZoneId)?.name : undefined;
  log(`Set sail, ${nm(lengthM)}${zone ? ` for ${zone}` : ''}`);
});
ctx.events.on('VoyageArrived', ({ zoneId }) =>
  log(`Arrived${zoneId ? ` off ${zoneById(geo, zoneId)?.name}` : ''}`),
);
ctx.events.on('EncounterSpotted', ({ contactId, forced }) => {
  const c = session.contacts.find((x) => x.id === contactId);
  log(`${forced ? 'Intercepted by' : 'Lookout reports'} ${c?.name ?? contactId}`);
});
ctx.events.on('DayChanged', () => log(weekText(clock.gameSeconds)));

// ---------------------------------------------------------------- plotting input

const canvas = view.canvas;
const PICK_PX = 10;
let dragWaypoint: number | undefined;
let pan: { x: number; y: number; moved: boolean } | undefined;
let hoverWaypoint: number | undefined;

const plotting = (): boolean => !session.voyage && !session.pending && machine.mode === 'chart';

function pickWaypoint(x: number, y: number): number | undefined {
  let best: number | undefined;
  let bestD = PICK_PX;
  session.waypoints.forEach((p, i) => {
    const s = view.toScreen(p);
    const d = Math.hypot(s.x - x, s.y - y);
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  });
  return best;
}

/** Snap to a port when the click lands near one. */
function snap(x: number, y: number): Chart {
  for (const port of geo.ports) {
    const s = view.toScreen(port.pos);
    if (Math.hypot(s.x - x, s.y - y) < 12) return { ...port.pos };
  }
  return view.toChart(x, y);
}

function replot(): void {
  chartMode.replot();
}

canvas.addEventListener('pointerdown', (e) => {
  if (e.button !== 0) return;
  canvas.setPointerCapture(e.pointerId);
  const hit = plotting() ? pickWaypoint(e.offsetX, e.offsetY) : undefined;
  if (hit !== undefined) dragWaypoint = hit;
  else pan = { x: e.offsetX, y: e.offsetY, moved: false };
});

canvas.addEventListener('pointermove', (e) => {
  if (dragWaypoint !== undefined) {
    session.waypoints[dragWaypoint] = snap(e.offsetX, e.offsetY);
    replot();
    return;
  }
  if (pan) {
    const dx = e.offsetX - pan.x;
    const dy = e.offsetY - pan.y;
    if (pan.moved || Math.hypot(dx, dy) > 4) {
      pan.moved = true;
      view.panBy(dx, dy);
      pan.x = e.offsetX;
      pan.y = e.offsetY;
    }
    return;
  }
  hoverWaypoint = plotting() ? pickWaypoint(e.offsetX, e.offsetY) : undefined;
  canvas.style.cursor = hoverWaypoint !== undefined ? 'grab' : 'crosshair';
});

canvas.addEventListener('pointerup', (e) => {
  if (dragWaypoint !== undefined) {
    dragWaypoint = undefined;
    return;
  }
  const click = pan && !pan.moved;
  pan = undefined;
  if (!click || !plotting()) return;
  const p = snap(e.offsetX, e.offsetY);
  if (e.shiftKey && session.waypoints.length > 0) {
    session.waypoints.splice(nearestLeg(p), 0, p);
  } else {
    session.waypoints.push(p);
  }
  replot();
});

/** Index to insert at so `p` splits the leg it is closest to. */
function nearestLeg(p: Chart): number {
  const pts = [session.position, ...session.waypoints];
  let best = 0;
  let bestD = Infinity;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1] as Chart;
    const b = pts[i] as Chart;
    const len2 = (b.x - a.x) ** 2 + (b.y - a.y) ** 2;
    const t =
      len2 > 0
        ? Math.min(Math.max(((p.x - a.x) * (b.x - a.x) + (p.y - a.y) * (b.y - a.y)) / len2, 0), 1)
        : 0;
    const d = distance(p, { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
    if (d < bestD) {
      bestD = d;
      best = i - 1;
    }
  }
  return best;
}

canvas.addEventListener('contextmenu', (e) => {
  e.preventDefault();
  if (!plotting()) return;
  const hit = pickWaypoint(e.offsetX, e.offsetY);
  if (hit === undefined) return;
  session.waypoints.splice(hit, 1);
  replot();
});

canvas.addEventListener(
  'wheel',
  (e) => {
    e.preventDefault();
    view.zoomAt(e.offsetX, e.offsetY, e.deltaY < 0 ? 1.15 : 1 / 1.15);
  },
  { passive: false },
);

// ---------------------------------------------------------------- buttons and keys

function setSail(): void {
  if (!plotting()) return;
  if (!chartMode.setSail()) return;
  paused = false;
}
function undo(): void {
  if (!plotting()) return;
  session.waypoints.pop();
  replot();
}
function clearCourse(): void {
  if (!plotting()) return;
  session.waypoints = [];
  replot();
}
function heaveTo(): void {
  if (!session.voyage || session.pending) return;
  session.voyage = undefined;
  session.waypoints = [];
  replot();
  log('Hove to');
}

$('sail').addEventListener('click', setSail);
$('undo').addEventListener('click', undo);
$('clear').addEventListener('click', clearCourse);
$('heave').addEventListener('click', heaveTo);
$('pause').addEventListener('click', () => (paused = !paused));
$<HTMLSelectElement>('lookout').addEventListener('change', (e) => {
  session.lookout = (e.target as HTMLSelectElement).value as LookoutPref;
});
$<HTMLSelectElement>('timescale').addEventListener('change', (e) => {
  session.timeScale = 3600 / Number((e.target as HTMLSelectElement).value);
});
$<HTMLSelectElement>('depart').addEventListener('change', (e) => {
  if (!plotting()) return;
  session.position = { ...(DEPARTURES[(e.target as HTMLSelectElement).value] as Chart) };
  session.waypoints = [];
  replot();
});
let revealAll = false;
$<HTMLInputElement>('reveal').addEventListener('change', (e) => {
  revealAll = (e.target as HTMLInputElement).checked;
});

window.addEventListener('keydown', (e) => {
  if (machine.mode !== 'chart' || !encCard.hidden || !noticeCard.hidden) return;
  if (e.target instanceof HTMLSelectElement) return;
  if (e.key === 'Enter') setSail();
  else if (e.key === 'Backspace') undo();
  else if (e.key === 'Escape') clearCourse();
  else if (e.key === ' ') {
    e.preventDefault();
    paused = !paused;
  }
});

// ---------------------------------------------------------------- HUD

const readout = $('readout');
const problem = $('problem');
const sailButton = $<HTMLButtonElement>('sail');
const heaveButton = $<HTMLButtonElement>('heave');
const arenaHud = $('arena-hud');
const banner = $('banner');
let hudTimer = 0;

function etaFor(seconds: number): string {
  return `ETA ${clockText(clock.gameSeconds + seconds)} (${durationText(seconds)})`;
}

function remainingSeconds(): number {
  const v = session.voyage;
  if (!v) return 0;
  let s = 0;
  for (let i = v.leg; i < v.legs.length; i++) {
    const leg = v.legs[i];
    if (!leg) continue;
    const left = i === v.leg ? leg.lengthM - v.progressM : leg.lengthM;
    s += left / (chartSpeedKn(leg.heading, session.wind, session.ship) * KNOT_MS);
  }
  return s;
}

function updateChartHud(): void {
  const wind = session.wind;
  const v = session.voyage;
  const course = session.course;
  const lines = [
    `${weekText(clock.gameSeconds)} · ${clockText(clock.gameSeconds)}`,
    `Wind ${compassPoint(wind.from)} ${wind.speedKn.toFixed(0)} kn · lookouts see ${nm(spotRangeM(hour()))}`,
  ];
  if (v) {
    lines.push(
      `Under way ${compassPoint(v.heading)} at ${v.speedKn.toFixed(1)} kn${paused ? ' · PAUSED' : ''}`,
      `${nm(remainingSeconds() > 0 ? estimateRemainingM() : 0)} to go · ${etaFor(remainingSeconds())}`,
    );
  } else if (course && course.legs.length > 0) {
    lines.push(
      `Course ${nm(course.lengthM)} in ${course.legs.length} leg${course.legs.length > 1 ? 's' : ''}` +
        (course.destinationZone ? ` to ${course.destinationZone.name}` : ''),
    );
    if (!course.problem) lines.push(etaFor(estimateSeconds(course, wind, session.ship)));
  } else {
    lines.push('Plotting: click the chart to lay a course.');
  }
  readout.textContent = lines.join('\n');
  problem.textContent =
    !v && course?.problem === 'aground'
      ? 'That course runs aground (red cross). Add a waypoint around the land.'
      : !v && course?.problem === 'insideDestination'
        ? "You're already in that zone: sail there in 3D, not on the chart."
        : '';
  sailButton.disabled = !plotting() || !course || !!course.problem || course.legs.length === 0;
  heaveButton.disabled = !v || !!session.pending;
}

function estimateRemainingM(): number {
  const v = session.voyage;
  if (!v) return 0;
  let m = -v.progressM;
  for (let i = v.leg; i < v.legs.length; i++) m += v.legs[i]?.lengthM ?? 0;
  return m;
}

function updateArenaHud(a: ArenaState): void {
  const p = a.player;
  const s = a.schooner.sailing.state;
  const h = a.schooner.hazards.state;
  const hz = a.schooner.hazards.cls;
  const c = a.contact;
  const edge = ARENA_HALF_M - Math.max(Math.abs(p.position.x), Math.abs(p.position.z));
  const lines = [
    `Open-water arena · ${clockText(clock.gameSeconds)} (R = 24)`,
    `${c.name}${a.target ? ` · ${distanceToTarget(a).toFixed(0)} m` : ''}`,
    `Heading ${compassPoint(p.heading)} · ${speedKn(s).toFixed(1)} kn (${sceneSpeed(s.speed, R_SAILING, DEFAULT_COMPRESSION).toFixed(1)} m/s on screen) · ${SAIL_LEVELS[s.sailLevel]}${s.inIrons ? ' · IN IRONS' : ''}${s.sweepsOut ? ' · sweeps out' : ''}`,
    `Wind ${compassPoint(a.wind.from)} ${a.wind.speedKn.toFixed(0)} kn · arena edge ${Math.max(edge, 0).toFixed(0)} m`,
    `Hull ${Math.round((100 * h.hull) / hz.hullHP)}% · rigging ${Math.round((100 * h.rigging) / hz.riggingHP)}%${h.strain > 0.05 ? ` · strain ${Math.round(h.strain * 100)}%: shorten sail` : ''}${h.anchor !== 'up' ? ` · anchor ${h.anchor}` : ''}`,
    '',
    'A/D steer · W/S sail · Q/E trim (manual) · R sweeps · F interact · wheel zoom',
  ];
  if (c.kind === 'storm' && !a.resolved) lines.push(`Ride it out: ${stormLeftS(a).toFixed(0)} s`);
  else if (!c.hostile && !a.resolved && a.target) {
    lines.push(
      distanceToTarget(a) < INTERACT_RANGE_M
        ? `Hold F: ${Math.round(holdProgress(a) * 100)}%`
        : `Close within ${INTERACT_RANGE_M} m and hold F`,
    );
  }
  if (c.hostile)
    lines.push(a.pursued ? 'Run! Get 900 m clear of the cutter.' : 'Clear of the cutter.');
  if (a.resolved) lines.push('Done. Sail off the edge or press M for the chart.');
  else if (!a.pursued) lines.push('Sail off the edge (or press M) to return to the chart.');
  arenaHud.textContent = lines.join('\n');
  banner.hidden = !a.pursued;
}

function visibleContacts(): Set<string> {
  const h = hour();
  const weather = weatherFactor(session.position, session.contacts);
  const seen = new Set<string>();
  for (const c of session.contacts) {
    if (revealAll || distance(session.position, c.pos) <= playerSeesAtM(c, h, weather))
      seen.add(c.id);
  }
  return seen;
}

// ---------------------------------------------------------------- loop

const loop = createLoop({
  tick(dt) {
    machine.update(dt);
    input.endTick();
    if (arena?.result) leaveArena();
  },
  frame(alpha, frameSeconds) {
    machine.render(alpha, frameSeconds);
    if (machine.mode === 'chart') {
      const course = session.course;
      const eta = session.voyage
        ? durationText(remainingSeconds())
        : course && !course.problem && course.legs.length > 0
          ? durationText(estimateSeconds(course, session.wind, session.ship))
          : undefined;
      view.draw({
        geo,
        position: session.position,
        heading: session.heading,
        course: session.voyage ? undefined : course,
        voyage: session.voyage,
        contacts: session.contacts,
        now: clock.gameSeconds,
        daylight: daylight(hour()),
        spotRangeM: spotRangeM(hour()) * weatherFactor(session.position, session.contacts),
        visible: visibleContacts(),
        hoverWaypoint,
        etaLabel: eta,
      });
    }
    hudTimer += frameSeconds;
    if (hudTimer < 0.1) return;
    hudTimer = 0;
    if (machine.mode === 'chart') {
      updateChartHud();
      banner.hidden = true;
    } else if (arena) {
      updateArenaHud(arena);
    }
  },
});
loop.start();
replot();
log(`${weekText(clock.gameSeconds)}. Off Duluth, ready to sail.`);

// For poking at the prototype from the console or a Playwright script.
Object.assign(window, {
  spike: {
    session,
    chartMode,
    machine,
    view,
    ctx,
    at,
    get arena() {
      return arena;
    },
    plot(points: [number, number][]) {
      session.waypoints = points.map(([lat, lon]) => at(lat, lon));
      replot();
    },
    setSail,
    answer: answerEncounter,
    pause(value: boolean) {
      paused = value;
    },
  },
});
