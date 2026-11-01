import {
  ChartProjection,
  DEFAULT_COMPRESSION,
  chartToZone,
  type Chart,
  type ZoneFrame,
} from '../../core/coords';
import type { ChartGeography } from '../chart/geography';
import type { TerrainBounds } from '../terrain/zone-terrain';
import type { ArenaEncounter, ArenaShip } from './encounter';
import type { ArenaLand } from './land';
import type { Pose } from '../terrain/test-bay';

/**
 * The open-water arena's layout and rules (plan 03 §6.3, Phase 3 piece G). A ~3 × 3 km
 * patch of compressed water centered near the encounter point: the sim's weather and sky
 * at that point, the ships met on their lanes' headings, and the coast in view as low
 * silhouettes. Leave by sailing off the edge (not while a hostile has you), or resolve
 * the encounter first; either way the voyage resumes where you left the chart (§20.5).
 */

/** Half the arena's side: leave by sailing past ±1.5 km (plan 03 §6.3). */
export const ARENA_HALF_M = 1500;
/** The HUD warns over the last stretch before the edge. */
export const ARENA_EDGE_WARN_M = 250;
/** A hunting hostile this close has you detected: the chart stays locked (§20.3 #7). */
export const PURSUIT_RANGE_M = 900;
/** The cutter's boarding party gets aboard inside this range. */
export const CAUGHT_RANGE_M = 45;
/** Close and look (Phase 3's "engage"): get this close and hold F. */
export const LOOK_RANGE_M = 160;
export const LOOK_HOLD_S = 1.5;
/** Riding out a squall takes this long, real seconds. */
export const SQUALL_RIDE_S = 40;
/** The player starts this far from what they met (closer when forced). */
const START_RANGE_M = 650;
const FORCED_RANGE_M = 520;

/** The arena as zone bounds, for the edge hold while pursued. */
export const ARENA_BOUNDS: TerrainBounds = {
  minX: -ARENA_HALF_M,
  maxX: ARENA_HALF_M,
  minZ: -ARENA_HALF_M,
  maxZ: ARENA_HALF_M,
};

/** The arena's frame: its centre on the chart at the zones' compression. */
export function arenaFrame(centre: Chart, compression = DEFAULT_COMPRESSION): ZoneFrame {
  return { origin: { x: Math.round(centre.x), y: Math.round(centre.y) }, compression };
}

/** The zones' and weather sim's chart projection (the lake-wide default). */
const WORLD = new ChartProjection();

/**
 * The arena's frame for the weather sim. The chart geography has its own projection
 * (centred on the western lake); the sim, zones and save use the lake-wide one, so the
 * arena's centre is carried across through latitude and longitude.
 */
export function arenaWeatherFrame(geo: ChartGeography, frame: ZoneFrame): ZoneFrame {
  const world = WORLD.geoToChart(geo.projection.chartToGeo(frame.origin));
  return {
    origin: { x: Math.round(world.x), y: Math.round(world.y) },
    compression: frame.compression,
  };
}

/** A fog bank met on the chart stands with its wall this far ahead of the player, zone meters. */
export const FOG_WALL_AHEAD_M = 700;

/**
 * The arena's weather frame when what was met is the sim's own weather (Phase 3 piece E).
 * The arena is only 3 km across at C = 8, so the squall or bank met at the chart's range
 * would stand outside it. The frame is slid so the sim is read where the meeting happens:
 * a squall's core under the player, so they ride it out in its heart, and a fog bank's
 * wall FOG_WALL_AHEAD_M ahead on the bearing it was sighted on (or as it is, if the ship
 * is already inside it). Only the weather moves; the coast and the ships stay put.
 */
export function metWeatherFrame(
  geo: ChartGeography,
  enc: ArenaEncounter,
  layout: { frame: ZoneFrame; player: Pose },
): ZoneFrame {
  const base = arenaWeatherFrame(geo, layout.frame);
  const met = enc.weather;
  if (!met || (enc.kind !== 'squall' && enc.kind !== 'fogbank')) return base;
  const C = base.compression;
  const world = (p: Chart): Chart => WORLD.geoToChart(geo.projection.chartToGeo(p));
  const centre = world(met.center);
  // Where in the arena (zone meters) the met weather's centre should stand.
  let at: { x: number; z: number };
  if (enc.kind === 'squall') {
    at = { x: layout.player.x, z: layout.player.z };
  } else {
    const inside = Math.hypot(enc.at.x - met.center.x, enc.at.y - met.center.y) < met.radiusM;
    if (inside) return base;
    const along = FOG_WALL_AHEAD_M + met.radiusM / C;
    at = {
      x: layout.player.x + Math.sin(enc.bearing) * along,
      z: layout.player.z - Math.cos(enc.bearing) * along,
    };
  }
  return {
    origin: { x: Math.round(centre.x - at.x * C), y: Math.round(centre.y + at.z * C) },
    compression: C,
  };
}

export interface PlacedShip {
  ship: ArenaShip;
  pose: Pose;
}

export interface ArenaLayout {
  frame: ZoneFrame;
  player: Pose;
  ships: PlacedShip[];
}

/**
 * Lay out an arena: what was met in the middle (or at its offsets), the player off on
 * the bearing it was sighted from, on the heading they sailed the chart with. Weather
 * kinds put the player in the middle. `centre` is where the arena sits on the chart,
 * normally `enc.at` nudged clear of land.
 */
export function layoutArena(enc: ArenaEncounter, centre: Chart, land: ArenaLand): ArenaLayout {
  const frame = arenaFrame(centre);
  // The encounter point in the arena's frame (not quite 0, 0 if the centre moved).
  const at = chartToZone(enc.at, frame);
  const atSea = enc.ships.length > 0;
  const range = !atSea ? 0 : enc.forced ? FORCED_RANGE_M : START_RANGE_M;
  // `bearing` is player → contact; the player sits on the reciprocal.
  const meet = atSea ? { x: 0, z: 0 } : { x: clampIn(at.x), z: clampIn(at.z) };
  const player: Pose = {
    x: meet.x - Math.sin(enc.bearing) * range,
    z: meet.z + Math.cos(enc.bearing) * range,
    heading: enc.playerHeading,
  };
  const ships: PlacedShip[] = [];
  for (const ship of enc.ships) {
    const x = meet.x + (ship.offset?.x ?? 0);
    const z = meet.z + (ship.offset?.z ?? 0);
    // Traffic on the chart is on water; only a nudged arena can put a ship ashore.
    if (land.isLand(x, z)) continue;
    ships.push({ ship, pose: { x, z, heading: ship.heading } });
  }
  return { frame, player, ships };
}

function clampIn(v: number): number {
  return Math.max(-ARENA_HALF_M * 0.5, Math.min(ARENA_HALF_M * 0.5, v));
}

export type ArenaResult = 'left' | 'resolved' | 'caught';

/** What the chart gets back when an arena ends: it resumes the voyage at `at` (§20.5). */
export interface ArenaExit {
  contactId: string;
  result: ArenaResult;
  /** Where the player left the chart. */
  at: Chart;
  elapsedS: number;
}

export interface ArenaRun {
  readonly encounter: ArenaEncounter;
  elapsedS: number;
  /** Close-and-look progress, seconds of F held in range. */
  lookS: number;
  resolved: boolean;
  /** A hunting hostile has you: the chart is locked and the edge holds. */
  pursued: boolean;
  result: ArenaResult | undefined;
}

export function createArenaRun(encounter: ArenaEncounter): ArenaRun {
  return {
    encounter,
    elapsedS: 0,
    lookS: 0,
    resolved: false,
    pursued: false,
    result: undefined,
  };
}

/** What the rules read each tick. Positions in arena zone meters. */
export interface ArenaInputs {
  player: { x: number; z: number };
  /** The arena's ships, with whether each hunts the player. */
  ships: readonly { id: string; x: number; z: number; hunting: boolean }[];
  /** F is held. */
  lookHeld: boolean;
  /** M was pressed: back to the chart early, when nothing has you. */
  chartPressed: boolean;
}

export function edgeDistanceM(p: { x: number; z: number }): number {
  return ARENA_HALF_M - Math.max(Math.abs(p.x), Math.abs(p.z));
}

/** The nearest ship to the player, and how far. */
export function nearestShip(
  inputs: Pick<ArenaInputs, 'player' | 'ships'>,
): { id: string; distanceM: number } | undefined {
  let best: { id: string; distanceM: number } | undefined;
  for (const s of inputs.ships) {
    const d = Math.hypot(s.x - inputs.player.x, s.z - inputs.player.z);
    if (!best || d < best.distanceM) best = { id: s.id, distanceM: d };
  }
  return best;
}

/**
 * One tick of the arena's rules, after the ships have moved. Sets `result` when the
 * arena is over. While pursued, the edge holds the player like a zone's (the sailing
 * mode clamps to `ARENA_BOUNDS`), so there's no leaving until the cutter is shaken off.
 */
export function stepArenaRun(run: ArenaRun, inputs: ArenaInputs, dt: number): void {
  if (run.result) return;
  run.elapsedS += dt;
  const { player } = inputs;
  let hunterM = Infinity;
  for (const s of inputs.ships) {
    if (s.hunting) hunterM = Math.min(hunterM, Math.hypot(s.x - player.x, s.z - player.z));
  }
  run.pursued = hunterM < PURSUIT_RANGE_M;
  if (hunterM < CAUGHT_RANGE_M) {
    run.result = 'caught';
    return;
  }

  if (!run.resolved) {
    const kind = run.encounter.kind;
    if (kind === 'squall') {
      if (run.elapsedS >= SQUALL_RIDE_S) run.resolved = true;
    } else if (kind !== 'fogbank') {
      const near = nearestShip(inputs);
      const lookable = near && near.distanceM < LOOK_RANGE_M && !run.pursued;
      if (lookable && inputs.lookHeld) {
        run.lookS += dt;
        if (run.lookS >= LOOK_HOLD_S) run.resolved = true;
      } else {
        run.lookS = 0;
      }
    }
  }

  if (run.pursued) return;
  if (edgeDistanceM(player) < 0 || inputs.chartPressed) {
    run.result = run.resolved ? 'resolved' : 'left';
  }
}

/** HUD chips for the arena: the look, the squall and the edge (the lock has its banner). */
export function arenaStatus(
  run: ArenaRun,
  inputs: Pick<ArenaInputs, 'player' | 'ships'>,
): string[] {
  const out: string[] = [];
  const kind = run.encounter.kind;
  if (!run.resolved && kind === 'squall') {
    out.push(`Squall: ride it out ${Math.ceil(SQUALL_RIDE_S - run.elapsedS)} s`);
  }
  if (!run.resolved && kind !== 'squall' && kind !== 'fogbank' && !run.pursued) {
    const near = nearestShip(inputs);
    if (near && near.distanceM < LOOK_RANGE_M) {
      out.push(run.lookS > 0 ? 'Looking her over…' : 'Hold F to look her over');
    }
  }
  if (run.resolved) out.push(kind === 'squall' ? 'Squall passed' : 'Looked her over');
  if (!run.pursued && edgeDistanceM(inputs.player) < ARENA_EDGE_WARN_M) {
    out.push('Sail on for the chart');
  }
  return out;
}
