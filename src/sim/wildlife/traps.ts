import type { WildlifeFile } from '../../../data/schemas/wildlife';
import { Rng } from '../../core/rng';
import type { PlacedIsland } from '../islands/on-foot';
import { landDistanceM } from '../islands/on-foot';
import { WILDLIFE } from './defs';
import { WEEK_S } from './hunt';

/**
 * The winter traplines (plan 11 §4; §18.4 piece V): a few marked spots round each trapper's
 * cabin, where a steel trap from the lockers is set in the open season and checked weeks
 * later. What a setting holds comes from the run's seed and when it was set, so a reload
 * finds the same; a pelt left too long is spoiled.
 */

export interface TrapSpot {
  /** `<cabin poi>:<k>`, the save's key. */
  id: string;
  island: string;
  x: number;
  y: number;
  z: number;
}

/** Steepest ground a trap spot sits on: rise over a meter's run. */
const SPOT_SLOPE = 0.45;

/**
 * The spots of each trapline on an island, set out round its cabin's door on the island's
 * own dry, gentle ground. Fixed by the island and cabin, not the run: the marks stay put.
 */
export function trapSpots(
  island: PlacedIsland,
  heightAt: (x: number, z: number) => number,
  file: WildlifeFile = WILDLIFE,
): TrapSpot[] {
  const out: TrapSpot[] = [];
  const t = file.traps;
  for (const line of t.lines) {
    if (line.island !== island.id) continue;
    const marks = island.marks.filter((m) => m.poi === line.poi);
    const door = marks.find((m) => m.kind === 'resident') ?? marks[0];
    if (!door) continue;
    const rng = Rng.fromSeed(`trapline:${line.poi}`);
    const n = t.spotsPerLine;
    const turn0 = rng.range(0, Math.PI * 2);
    for (let k = 0; k < n; k++) {
      for (let tries = 0; tries < 40; tries++) {
        const a = turn0 + (k / n) * Math.PI * 2 + rng.range(-0.5, 0.5);
        const r = rng.range(t.spotM[0], t.spotM[1]);
        const x = door.x + Math.sin(a) * r;
        const z = door.z - Math.cos(a) * r;
        const y = heightAt(x, z);
        if (y < 1) continue;
        if (island.land && landDistanceM(island.land, x, z) > 0) continue;
        const slope = Math.max(
          Math.abs(heightAt(x + 1, z) - y),
          Math.abs(heightAt(x, z + 1) - y),
          Math.abs(heightAt(x - 1, z) - y),
          Math.abs(heightAt(x, z - 1) - y),
        );
        if (slope > SPOT_SLOPE) continue;
        out.push({ id: `${line.poi}:${k}`, island: island.id, x, y, z });
        break;
      }
    }
  }
  return out;
}

/** The open season for traps, by calendar month (1 January). */
export function trapSeason(month: number, file: WildlifeFile = WILDLIFE): boolean {
  return file.traps.months.includes(month);
}

export interface TrapCheck {
  /** Time enough has passed that it may hold something. */
  ready: boolean;
  /** It holds a pelt (only once ready). */
  caught: boolean;
  /** The pelt was left too long. */
  spoiled: boolean;
  /** Game seconds it's ready from. */
  readyAt: number;
}

/** What a trap set at `setAt` holds at `now`. */
export function checkTrap(
  spot: string,
  setAt: number,
  now: number,
  runSeed: number,
  woodcraft: boolean,
  file: WildlifeFile = WILDLIFE,
): TrapCheck {
  const t = file.traps;
  const rng = Rng.fromSeed(`${runSeed}:trap:${spot}:${Math.round(setAt)}`);
  const weeks = rng.range(t.fillWeeks[0], t.fillWeeks[1]);
  const readyAt = setAt + weeks * WEEK_S;
  const caught = rng.next() < (woodcraft ? t.woodcraftCatch : t.catch);
  const ready = now >= readyAt;
  return {
    ready,
    caught: ready && caught,
    spoiled: ready && caught && now > readyAt + t.spoilWeeks * WEEK_S,
    readyAt,
  };
}
