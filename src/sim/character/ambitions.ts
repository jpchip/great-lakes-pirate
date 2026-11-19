import { z } from 'zod';
import ambitionsJson from '../../../data/ambitions.json';
import {
  ambitionsFileSchema,
  type AmbitionCounter,
  type AmbitionDef,
  type AmbitionsFile,
} from '../../../data/schemas/ambitions';
import { calendarDate, CALENDAR_DAYS_PER_GAME_DAY, SECONDS_PER_GAME_DAY } from '../../core/time';
import { formatCents } from '../economy/knowledge';

/**
 * Ambitions (plan 12 §4.1; Phase 8 piece H, plan 09 §16.4): a catalog of optional goals.
 * The captain pins up to three to follow on the HUD and in the journal; any of them,
 * pinned or not, is done the moment it's met, and leaves a themed mark in the ledger
 * that can be cleared (the deed stays in the logbook).
 *
 * Goals read the run's state (cash in the hideouts, Fame, Standing, the hideouts held and
 * their pieces) or a counter kept here from the bus's events, matched by name and payload
 * as the First Week's steps are, so the pieces that raise them needn't know about this.
 *
 * Pure functions on plain data; the save keeps `ambitions` (world-state.ts), optional, so
 * a run from before it starts with none pinned and no version bump.
 */

export const AMBITIONS: AmbitionsFile = ambitionsFileSchema.parse(ambitionsJson);

export function ambitionDef(id: string): AmbitionDef | undefined {
  return AMBITIONS.ambitions.find((a) => a.id === id);
}

export const ambitionsStateSchema = z.object({
  /** Pinned, in the order they were pinned (at most `maxPinned`). */
  pinned: z.array(z.string()),
  /** Done, in the order they were done, with when. */
  done: z.array(z.object({ id: z.string(), at: z.number() })),
  /** Marks cleared from the ledger; the deed stays in `done` and the logbook. */
  cleared: z.array(z.string()),
  /** The bus's counters (`AmbitionCounter`). */
  counters: z.record(z.string(), z.number().int().nonnegative()),
  /** Regions where you're Most Wanted now, with since when (game seconds). */
  mostWantedSince: z.record(z.string(), z.number()),
  /** The HUD's list folded to its heading (plan 13 §4.1 "collapsible"). */
  folded: z.boolean().optional(),
});
export type AmbitionsState = z.infer<typeof ambitionsStateSchema>;

export function createAmbitions(): AmbitionsState {
  return { pinned: [], done: [], cleared: [], counters: {}, mostWantedSince: {} };
}

/** What the goals measure, read from the run by the caller. */
export interface AmbitionWorld {
  now: number;
  /** Cash in every hideout's strongbox, cents. */
  hideoutCashCents: number;
  fameTier: number;
  /** Fame tier names, for the progress line. */
  fameTierName(tier: number): string;
  /** Standing with each port (0–100). */
  portStanding: readonly number[];
  hideouts: number;
  /** The most pieces standing at any one hideout. */
  maxHideoutPieces: number;
}

export interface AmbitionProgress {
  /** 0–1. */
  fraction: number;
  /** "$420 of $1,000". */
  text: string;
}

const clamp01 = (v: number): number => Math.max(0, Math.min(1, v));
const ofN = (have: number, need: number, unit = ''): AmbitionProgress => ({
  fraction: clamp01(have / need),
  text: `${Math.min(have, need)} of ${need}${unit}`,
});

/** How far along a goal is. */
export function ambitionProgress(
  def: AmbitionDef,
  state: AmbitionsState,
  world: AmbitionWorld,
): AmbitionProgress {
  const g = def.goal;
  switch (g.kind) {
    case 'hideoutCash':
      return {
        fraction: clamp01(world.hideoutCashCents / g.cents),
        text: `${formatCents(Math.min(world.hideoutCashCents, g.cents), true)} of ${formatCents(g.cents, true)}`,
      };
    case 'fameTier':
      return {
        fraction: clamp01(world.fameTier / g.tier),
        text: `${world.fameTierName(Math.min(world.fameTier, g.tier))}, of ${world.fameTierName(g.tier)}`,
      };
    case 'mostWantedDays': {
      const since = Object.values(state.mostWantedSince);
      const longest = since.length ? Math.max(...since.map((s) => world.now - s)) : 0;
      const needDays = g.days * CALENDAR_DAYS_PER_GAME_DAY;
      const haveDays = Math.floor((longest / SECONDS_PER_GAME_DAY) * CALENDAR_DAYS_PER_GAME_DAY);
      if (!since.length) return { fraction: 0, text: 'Not Most Wanted anywhere' };
      return {
        fraction: clamp01(longest / (g.days * SECONDS_PER_GAME_DAY)),
        text: `${Math.min(haveDays, needDays)} of ${needDays} days at large`,
      };
    }
    case 'portStanding':
      return ofN(world.portStanding.filter((v) => v >= g.min).length, g.ports, ' ports');
    case 'hideouts':
      return ofN(world.hideouts, g.count);
    case 'hideoutPieces':
      return ofN(world.maxHideoutPieces, g.count, ' pieces');
    case 'counter':
      return ofN(state.counters[g.counter] ?? 0, g.target);
  }
}

export function isDone(state: AmbitionsState, id: string): boolean {
  return state.done.some((d) => d.id === id);
}

/** Pins an ambition: why not, or undefined. */
export function pinAmbition(
  state: AmbitionsState,
  id: string,
  file: AmbitionsFile = AMBITIONS,
): string | undefined {
  if (!file.ambitions.some((a) => a.id === id)) return 'No such ambition.';
  if (isDone(state, id)) return 'Already done.';
  if (state.pinned.includes(id)) return undefined;
  if (state.pinned.length >= file.maxPinned) {
    return `You can follow ${file.maxPinned} at a time. Unpin one first.`;
  }
  state.pinned.push(id);
  return undefined;
}

export function unpinAmbition(state: AmbitionsState, id: string): boolean {
  const i = state.pinned.indexOf(id);
  if (i < 0) return false;
  state.pinned.splice(i, 1);
  return true;
}

/** Clears a done ambition's mark from the ledger. */
export function clearMark(state: AmbitionsState, id: string): boolean {
  if (!isDone(state, id) || state.cleared.includes(id)) return false;
  state.cleared.push(id);
  return true;
}

const record = (v: unknown): Record<string, unknown> =>
  typeof v === 'object' && v !== null ? (v as Record<string, unknown>) : {};

/**
 * The counter an event moves, if any. Events are matched by name and payload:
 * - `ContractCompleted` not late: a contract on time;
 * - `FeatAccomplished` (the papers' feats): an escape from the *Morrill*, a record run, and
 *   making port through a gale, counted in November only, and a ship put on a shoal by
 *   your light (Phase 9 piece I);
 * - `ShipLaunched` from a slipway (Phase 8 piece G).
 */
export function counterForEvent(
  type: string,
  payload: unknown,
  now: number,
): AmbitionCounter | undefined {
  const p = record(payload);
  switch (type) {
    case 'ContractCompleted':
      return p['late'] === false ? 'contractsOnTime' : undefined;
    case 'FeatAccomplished':
      if (p['kind'] === 'escape') return p['by'] === 'law.morrill' ? 'morrillEscapes' : undefined;
      if (p['kind'] === 'recordRun') return 'recordRuns';
      if (p['kind'] === 'moonCussing') return 'moonCussings';
      if (p['kind'] === 'galeRun') {
        return calendarDate(now).getUTCMonth() === 10 ? 'novemberGales' : undefined;
      }
      return undefined;
    case 'ShipLaunched':
      return p['from'] === 'slipway' ? 'slipwayLaunches' : undefined;
    default:
      return undefined;
  }
}

export function bumpCounter(state: AmbitionsState, counter: AmbitionCounter): void {
  state.counters[counter] = (state.counters[counter] ?? 0) + 1;
}

/**
 * Keeps the Most Wanted clocks: a region at the top tier starts one, a region below it
 * stops its own. `regionsMostWanted` are the regions at the top tier now.
 */
export function trackMostWanted(
  state: AmbitionsState,
  regionsMostWanted: readonly string[],
  now: number,
): void {
  const since: Record<string, number> = {};
  for (const r of regionsMostWanted) since[r] = state.mostWantedSince[r] ?? now;
  state.mostWantedSince = since;
}

/** Taken by the law: you weren't at large after all. */
export function stopMostWanted(state: AmbitionsState): void {
  state.mostWantedSince = {};
}

/**
 * Marks every goal now met as done (and unpins it); returns the newly done, in catalog
 * order. The caller pays the rewards.
 */
export function checkAmbitions(
  state: AmbitionsState,
  world: AmbitionWorld,
  file: AmbitionsFile = AMBITIONS,
): AmbitionDef[] {
  const out: AmbitionDef[] = [];
  for (const def of file.ambitions) {
    if (isDone(state, def.id)) continue;
    if (ambitionProgress(def, state, world).fraction < 1) continue;
    state.done.push({ id: def.id, at: world.now });
    unpinAmbition(state, def.id);
    out.push(def);
  }
  return out;
}

/** "$25" or "$50 and Fame". */
export function rewardText(def: AmbitionDef): string {
  const parts: string[] = [];
  if (def.reward.cents > 0) parts.push(formatCents(def.reward.cents, true));
  if (def.reward.fame > 0) parts.push('Fame');
  return parts.join(' and ');
}

/** The number of pieces at a hideout (Phase 8 piece A's `pieces`), read loosely. */
export function piecesAt(hideout: unknown): number {
  const pieces = record(hideout)['pieces'];
  return Array.isArray(pieces) ? pieces.length : 0;
}
