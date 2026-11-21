import type { WildlifeFile } from '../../../data/schemas/wildlife';
import { calendarDate, SECONDS_PER_GAME_DAY } from '../../core/time';
import { Rng } from '../../core/rng';
import { islandGame, WILDLIFE } from './defs';

/**
 * The hunt's numbers (plan 11 §4; §18.4 piece V), pure: the island's deer this run and how
 * many are left, the chance a rifle ball finds its mark, and which animals are about on a
 * landing.
 */

/** A calendar week, game seconds (a game day is a calendar week). */
export const WEEK_S = SECONDS_PER_GAME_DAY;

/** What the save keeps of the hunt (`wildlife`): the deer taken, and the traps set. */
export interface WildlifeState {
  /** Game seconds each deer was taken, by island id. */
  taken: Record<string, number[]>;
  /** Traps set, by spot id: when, and what this setting will hold. */
  traps: Record<string, { setAt: number }>;
}

export function emptyWildlife(): WildlifeState {
  return { taken: {}, traps: {} };
}

/** The deer an island carries this run, before any are taken (the seed spreads it). */
export function startingDeer(
  island: string,
  runSeed: number,
  file: WildlifeFile = WILDLIFE,
): number {
  const g = islandGame(island, file);
  if (!g || g.deer <= 0) return 0;
  const rng = Rng.fromSeed(`${runSeed}:deer:${island}`);
  const k = 1 + file.population.spread * (rng.next() * 2 - 1);
  return Math.max(1, Math.round(g.deer * k));
}

/** Deer taken that haven't been made up by the herd's growth, as of `now`. */
export function deerMissing(
  taken: readonly number[],
  now: number,
  file: WildlifeFile = WILDLIFE,
): number {
  const per = file.population.regrowPerWeek;
  if (per <= 0) return taken.length;
  const backAfterS = WEEK_S / per;
  return taken.filter((t) => now - t < backAfterS).length;
}

export function deerLeft(
  island: string,
  state: WildlifeState | undefined,
  runSeed: number,
  now: number,
  file: WildlifeFile = WILDLIFE,
): number {
  const start = startingDeer(island, runSeed, file);
  return Math.max(0, start - deerMissing(state?.taken[island] ?? [], now, file));
}

/** The calendar month, 1 January. */
export function monthAt(gameSeconds: number): number {
  return calendarDate(Math.max(0, gameSeconds)).getUTCMonth() + 1;
}

export interface Visitors {
  deer: number;
  bear: boolean;
  wolves: number;
}

/**
 * Who's about on this landing: a few of the island's deer (never more than are left), and
 * by the season a bear (spring to fall) or a wolf pack (winter), within the tier's animal
 * budget. The same landing on the same day finds the same.
 */
export function visitors(
  island: string,
  opts: { deerLeft: number; month: number; day: number; runSeed: number; budget: number },
  file: WildlifeFile = WILDLIFE,
): Visitors {
  const g = islandGame(island, file);
  if (!g || opts.budget <= 0) return { deer: 0, bear: false, wolves: 0 };
  const rng = Rng.fromSeed(`${opts.runSeed}:visit:${island}:${opts.day}`);
  const deerDef = file.species.find((s) => s.id === 'animal.deer');
  const bearDef = file.species.find((s) => s.id === 'animal.bear');
  const wolfDef = file.species.find((s) => s.id === 'animal.wolf');
  let wolves = 0;
  let bear = false;
  if (wolfDef?.months.includes(opts.month) && rng.chance(g.wolves)) {
    wolves = rng.int(wolfDef.group[0], wolfDef.group[1]);
  }
  if (!wolves && bearDef?.months.includes(opts.month) && rng.chance(g.bear)) bear = true;
  let budget = opts.budget - wolves - (bear ? 1 : 0);
  if (budget < 0) {
    wolves = Math.max(0, wolves + budget);
    budget = 0;
  }
  let deer = 0;
  if (deerDef && opts.deerLeft > 0 && budget > 0) {
    const want = rng.int(deerDef.group[0], deerDef.group[1]);
    deer = Math.min(want, opts.deerLeft, budget);
  }
  return { deer, bear, wolves };
}

/** The chance a ball hits at this distance, and how you and it are moving. */
export function hitChance(
  distM: number,
  opts: { crouched: boolean; moving: boolean; targetRunning: boolean },
  file: WildlifeFile = WILDLIFE,
): number {
  const h = file.hunt;
  if (distM > h.rangeM) return 0;
  const t = Math.min(1, Math.max(0, (distM - h.hitNear.m) / (h.hitFar.m - h.hitNear.m)));
  let p = h.hitNear.p + (h.hitFar.p - h.hitNear.p) * t;
  if (opts.crouched) p *= h.crouched;
  if (opts.moving) p *= h.moving;
  if (opts.targetRunning) p *= h.runningTarget;
  return Math.min(0.98, Math.max(0, p));
}
