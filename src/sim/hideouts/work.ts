import { calendarDate } from '../../core/time';
import { reduceStack, type Hold } from '../economy/hold';
import { addGoods, pieceCost, type Goods } from './edit';
import { BuildGrid, type BuildSite } from './grid';
import { structure } from './structures';
import { stands } from './validity';

/**
 * The build queue and the work session (plan 09 §6.3; Phase 8 piece A). Ghosts wait for
 * Build; a work session builds every one the materials on hand allow, in the order they
 * were placed, and takes game time: each piece's hours, faster with a bigger crew, slower
 * in late autumn and winter. What can't be built yet stays a ghost (a partial build).
 *
 * Materials come from `sources` in order: the hideout's storage first, then the hold of a
 * ship moored there (plan 09 §9). Contract cargo is never used; stolen goods are.
 */

/** How the crew's tier speeds the work (plan 09 §6.3: solo T1 is slowest). */
export const CREW_FACTOR: Readonly<Record<number, number>> = { 1: 1, 2: 0.7, 3: 0.5 };

/** The season's drag on the work, by the calendar's month (0 = January). */
export function seasonFactor(gameSeconds: number): number {
  const m = calendarDate(gameSeconds).getUTCMonth();
  if (m === 9) return 1.25; // October
  if (m >= 10 || m <= 3) return 1.5; // November through April
  return 1;
}

/** Goods usable as materials across the sources, by good id. */
export function materialsOnHand(sources: readonly Hold[]): Goods {
  const out: Goods = {};
  for (const hold of sources) {
    for (const s of hold) if (!s.contract) out[s.good] = (out[s.good] ?? 0) + s.qty;
  }
  return out;
}

function hasAll(have: Goods, need: Goods): boolean {
  return Object.entries(need).every(([g, n]) => (have[g] ?? 0) >= n);
}

/** Takes `qty` of a good from the sources, clean stacks before hot ones. */
function take(sources: Hold[], good: string, qty: number): void {
  let left = qty;
  for (const hold of sources) {
    const order = hold
      .map((s, i) => ({ s, i }))
      .filter(({ s }) => s.good === good && !s.contract)
      .sort((a, b) => Number(!!a.s.hot) - Number(!!b.s.hot));
    for (const { s } of order) {
      if (left <= 0) break;
      const n = Math.min(left, s.qty);
      reduceStack(s, n);
      left -= n;
    }
    for (let i = hold.length - 1; i >= 0; i--) if ((hold[i]?.qty ?? 0) <= 0) hold.splice(i, 1);
    if (left <= 0) return;
  }
}

export interface WorkOptions {
  /** The crew's tier (1–3); shipless or solo is 1. */
  crewTier: number;
  /** When the work starts, for the season. */
  gameSeconds: number;
}

/** Game seconds a set of pieces takes to build. */
export function buildSeconds(hours: number, opts: WorkOptions): number {
  const crew = CREW_FACTOR[opts.crewTier] ?? 1;
  return Math.round(hours * 3600 * crew * seasonFactor(opts.gameSeconds));
}

export interface QueueSummary {
  /** Ghosts waiting. */
  pieces: number;
  /** Everything they need, and what's on hand of it. */
  needs: Goods;
  have: Goods;
  /** Game seconds to build them all. */
  seconds: number;
}

/** The build queue's summary for the palette (plan 09 §9). */
export function queueSummary(
  grid: BuildGrid,
  sources: readonly Hold[],
  opts: WorkOptions,
): QueueSummary {
  const planned = grid.planned();
  const needs: Goods = {};
  let hours = 0;
  for (const p of planned) {
    addGoods(needs, pieceCost(p.piece));
    hours += structure(p.piece.id).buildHours;
  }
  const onHand = materialsOnHand(sources);
  const have: Goods = {};
  for (const g of Object.keys(needs)) have[g] = onHand[g] ?? 0;
  return { pieces: planned.length, needs, have, seconds: buildSeconds(hours, opts) };
}

export interface WorkResult {
  /** Uids of the pieces built, in order. */
  built: number[];
  /** Materials used. */
  used: Goods;
  /** Game seconds the session took: advance the clock by this. */
  seconds: number;
  /** Ghosts left waiting (no materials, or nothing yet to stand on). */
  left: number;
}

/**
 * Runs a work session: builds every ghost it can, taking materials from `sources`.
 * A ghost builds only once what holds it up is built, so the session goes round until
 * nothing more can be built.
 */
export function runWorkSession(
  grid: BuildGrid,
  site: BuildSite,
  sources: Hold[],
  opts: WorkOptions,
): WorkResult {
  const have = materialsOnHand(sources);
  const used: Goods = {};
  const built: number[] = [];
  let hours = 0;
  // Support is checked against built pieces only: a grid of what stands.
  const standing = new BuildGrid();
  for (const p of grid.built()) standing.add(p.piece, true);
  for (let progress = true; progress;) {
    progress = false;
    for (const p of grid.planned()) {
      const cost = pieceCost(p.piece);
      if (!hasAll(have, cost)) continue;
      if (!stands(standing, site, p.piece).ok) continue;
      for (const [g, n] of Object.entries(cost)) {
        have[g] = (have[g] ?? 0) - n;
        take(sources, g, n);
      }
      addGoods(used, cost);
      grid.setBuilt(p.uid, true);
      standing.add(p.piece, true);
      built.push(p.uid);
      hours += structure(p.piece.id).buildHours;
      progress = true;
    }
  }
  return {
    built,
    used,
    seconds: built.length ? buildSeconds(hours, opts) : 0,
    left: grid.planned().length,
  };
}
