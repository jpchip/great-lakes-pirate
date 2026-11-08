import fencesJson from '../../../data/fences.json';
import { fencesFileSchema, type Fence } from '../../../data/schemas/fences';
import { sunAt } from '../weather/celestial';
import { heatNow, offerKind } from './contraband';
import type { EconomyDefs } from './defs';
import { reduceStack, type CargoStack } from './hold';
import { nightOf } from './smuggler';
import type { Trader } from './trade';

/**
 * Fences in the ports (plan 05 §6.2; Phase 6 piece E, decision 1 of plan 07 §14.6). A man
 * in a saloon's back room after dark buys hot goods and contraband with no detection risk,
 * at 40–70% of their value: more with your Fame, more as your dealings with him add up,
 * more as a lot's heat cools, and less for goods outside his line (the Bayfield fence wants
 * fish and furs; the Duluth fence takes anything). He pays out of a week's cash, and a
 * game day is a calendar week, so it comes back each night. The Bayfield fence sees anyone;
 * the Duluth fence sees you once you're Known.
 *
 * Like the smuggler he won't take clean goods (take those to a merchant) or a company's
 * contract cargo. At high Wanted he may sell you out: that's the law's roll on the deal
 * (`gameplay/law.ts`), on Phase 5's informant rules.
 */

/** His saved state (the `contraband` slice's `fences`, by fence id). */
export interface FenceState {
  /** The night his cash was last made up for (`nightOf`). */
  night: number;
  /** Cash left to buy with tonight, cents. */
  cashCents: number;
  /** Everything you've sold him, cents: his trust grows with it. */
  dealtCents: number;
}

let cached: readonly Fence[] | undefined;

/** Every fence, from `data/fences.json`. */
export function gameFences(): readonly Fence[] {
  cached ??= fencesFileSchema.parse(fencesJson);
  return cached;
}

/** The fence whose back room is at a port, if any. */
export function fenceAt(port: string, fences: readonly Fence[] = gameFences()): Fence | undefined {
  return fences.find((f) => f.port === port);
}

/** Whether his back room is open to you now, or why not. */
export type FenceAccess = 'open' | 'day' | 'fame';

export function fenceAccess(fence: Fence, fameTier: number, gameSeconds: number): FenceAccess {
  if (fameTier < fence.fameTier) return 'fame';
  const sunDeg = (sunAt(gameSeconds).elevationRad * 180) / Math.PI;
  return sunDeg < fence.darkSunDeg ? 'open' : 'day';
}

export function freshFenceState(fence: Fence, gameSeconds: number): FenceState {
  return { night: nightOf(gameSeconds), cashCents: fence.weeklyCashCents, dealtCents: 0 };
}

/** A new night: his cash is made up again; his trust stays. */
export function restockFence(fence: Fence, state: FenceState, gameSeconds: number): void {
  const night = nightOf(gameSeconds);
  if (state.night === night) return;
  state.night = night;
  state.cashCents = fence.weeklyCashCents;
}

/** His cash for tonight, whether or not he's been restocked yet. */
export function fenceCash(fence: Fence, state: FenceState, gameSeconds: number): number {
  return nightOf(gameSeconds) === state.night ? state.cashCents : fence.weeklyCashCents;
}

/** His trust, 0–1, from what you've sold him. */
export function fenceTrust01(fence: Fence, state: FenceState): number {
  return Math.min(1, state.dealtCents / fence.rate.trustAtCents);
}

/** Whether a good is in his line (he takes the rest at `offLine`). */
export function inLine(fence: Fence, good: string): boolean {
  return !fence.prefers || fence.prefers.includes(good);
}

/** His rate for a good, as a share of its base value: 0.4–0.7 with the shipped tuning. */
export function fenceRateFor(
  fence: Fence,
  state: FenceState,
  good: string,
  heat: number,
  fameTier: number,
): number {
  const { min, perFameTier, trust, cool, max } = fence.rate;
  const base =
    min +
    perFameTier * Math.max(0, fameTier) +
    trust * fenceTrust01(fence, state) +
    cool * (1 - Math.min(1, Math.max(0, heat)));
  return Math.min(max, base) * (inLine(fence, good) ? 1 : fence.offLine);
}

export type FenceLotRefusal = 'clean' | 'contract' | 'unknown';

export type FenceLotQuote =
  | { ok: true; rate: number; unitCents: number; heat: number; inLine: boolean }
  | { ok: false; reason: FenceLotRefusal };

/** What he'd pay for a CU of a lot, or why he won't. */
export function fenceLotQuote(
  defs: EconomyDefs,
  fence: Fence,
  state: FenceState,
  stack: CargoStack,
  gameSeconds: number,
  fameTier: number,
): FenceLotQuote {
  const good = defs.goods.get(stack.good);
  if (!good) return { ok: false, reason: 'unknown' };
  if (stack.contract) return { ok: false, reason: 'contract' };
  if (!offerKind(defs, stack)) return { ok: false, reason: 'clean' };
  const heat = stack.hot ? heatNow(stack.hot, gameSeconds) : 0;
  const rate = fenceRateFor(fence, state, stack.good, heat, fameTier);
  return {
    ok: true,
    rate,
    unitCents: Math.floor(good.basePriceCents * rate),
    heat,
    inLine: inLine(fence, stack.good),
  };
}

/** The most CU of a lot his cash covers tonight. */
export function maxFenceLot(
  defs: EconomyDefs,
  fence: Fence,
  state: FenceState,
  stack: CargoStack,
  gameSeconds: number,
  fameTier: number,
): number {
  const q = fenceLotQuote(defs, fence, state, stack, gameSeconds, fameTier);
  if (!q.ok || q.unitCents <= 0) return 0;
  return Math.min(stack.qty, Math.floor(fenceCash(fence, state, gameSeconds) / q.unitCents));
}

export type FenceSaleRefusal = FenceLotRefusal | FenceAccess | 'badLot' | 'badQty' | 'noCash';

/** What `FenceDealt` carries: a lot sold in a back room. */
export interface FenceDealtEvent {
  fence: string;
  port: string;
  good: string;
  qty: number;
  totalCents: number;
  hot: boolean;
}

export type FenceSaleResult =
  { ok: true; event: FenceDealtEvent } | { ok: false; reason: Exclude<FenceSaleRefusal, 'open'> };

/**
 * Sells `qty` CU of one lot (a stack of the hold) to the fence at his rate, out of his
 * cash. A hot lot keeps its flags on what's left of it.
 */
export function sellToFence(
  defs: EconomyDefs,
  fence: Fence,
  state: FenceState,
  trader: Trader,
  stackIndex: number,
  qty: number,
  gameSeconds: number,
  fameTier: number,
): FenceSaleResult {
  const access = fenceAccess(fence, fameTier, gameSeconds);
  if (access !== 'open') return { ok: false, reason: access };
  restockFence(fence, state, gameSeconds);
  const stack = trader.cargo[stackIndex];
  if (!stack) return { ok: false, reason: 'badLot' };
  if (!Number.isInteger(qty) || qty <= 0 || qty > stack.qty) return { ok: false, reason: 'badQty' };
  const q = fenceLotQuote(defs, fence, state, stack, gameSeconds, fameTier);
  if (!q.ok) return q;
  const total = q.unitCents * qty;
  if (total > state.cashCents) return { ok: false, reason: 'noCash' };
  reduceStack(stack, qty);
  if (stack.qty === 0) trader.cargo.splice(stackIndex, 1);
  trader.purse += total;
  state.cashCents -= total;
  state.dealtCents += total;
  return {
    ok: true,
    event: {
      fence: fence.id,
      port: fence.port,
      good: stack.good,
      qty,
      totalCents: total,
      hot: !!stack.hot,
    },
  };
}
