import { DEFAULT_COMPRESSION, chartToZone, type Chart, type ZoneFrame } from '../../core/coords';
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

/** HUD chips for the arena: the lock, the look, the squall and the edge. */
export function arenaStatus(
  run: ArenaRun,
  inputs: Pick<ArenaInputs, 'player' | 'ships'>,
): string[] {
  const out: string[] = [];
  if (run.pursued) out.push('Chart locked: the cutter has you');
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
