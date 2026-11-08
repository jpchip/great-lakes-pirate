import smugglerJson from '../../../data/smuggler.json';
import { smugglersFileSchema, type Smuggler } from '../../../data/schemas/smuggler';
import { SECONDS_PER_GAME_DAY } from '../../core/time';
import { findZoneDef } from '../terrain/zones';
import { sunAt } from '../weather/celestial';
import { heatNow, offerKind, type Refusals } from './contraband';
import type { EconomyDefs } from './defs';
import { addToHold, holdFree, reduceStack, type CargoStack } from './hold';
import type { Trader } from './trade';

/**
 * The island smuggler (plan 05 §6.2–6.3; Phase 4 piece H, decision 1 of §16.6): Phase 4's
 * one fence. A boat that lies at an anchorage among the Apostles after dark. Come
 * alongside and she sells contraband (untaxed whiskey) and buys hot goods and contraband
 * with no detection risk, at 40–70% of their value: more as your dealings with her add
 * up and as a lot's heat cools. She pays out of a week's cash and has a week's stock, and
 * a game day is a calendar week, so both come back each night. She won't take clean goods
 * (take those to a merchant), contract cargo (piece F's), or what she sells herself.
 *
 * Phase 6 piece E makes `smuggler.json` hold more than one boat (plan 07 §14.6.1): the
 * island smuggler is the first, and the Siskiwit Bay boat lies in a zone that isn't built
 * yet, so she stays out of the world until it is (`smugglerInWorld`).
 */

/** Her saved state (the `contraband` slice's `smuggler`). */
export interface SmugglerState {
  /** The night her cash and stock were last made up for (`nightOf`). */
  night: number;
  /** Cash left to buy with tonight, cents. */
  cashCents: number;
  /** CU left to sell tonight, by good. */
  stock: Record<string, number>;
  /** Everything you've bought from her and sold her, cents: her trust grows with it. */
  dealtCents: number;
}

/** The `contraband` slice of the save (Phase 4 piece H; optional, filled on load). */
export interface ContrabandState {
  smuggler: SmugglerState;
  /** Ports whose merchants turned you away, and the week they did. */
  refusals: Refusals;
  /** Ports where a merchant has taken a lot from you: your receiver there. */
  receivers: string[];
  /** Where she lies is known (a background, a dev command); rumors (piece K) add their own. */
  known: boolean;
  /** Every other boat's state by smuggler id (Phase 6 piece E); filled as they're met. */
  boats?: Record<string, SmugglerState> | undefined;
  /** The other boats whose anchorage you know. */
  knownBoats?: string[] | undefined;
  /** The port fences' cash and trust, by fence id (Phase 6 piece E, `fence.ts`). */
  fences?: Record<string, { night: number; cashCents: number; dealtCents: number }> | undefined;
}

let cachedAll: readonly Smuggler[] | undefined;

/** Every smuggler's boat from `data/smuggler.json`; the island smuggler is the first. */
export function gameSmugglers(): readonly Smuggler[] {
  cachedAll ??= smugglersFileSchema.parse(smugglerJson);
  return cachedAll;
}

/** The island smuggler, the first in `data/smuggler.json`. */
export function gameSmuggler(): Smuggler {
  return gameSmugglers()[0] as Smuggler;
}

/** A smuggler by id. */
export function smugglerById(id: string): Smuggler | undefined {
  return gameSmugglers().find((s) => s.id === id);
}

/** Whether her anchorage's zone is built, so she can be met (and talked of, and charted). */
export function smugglerInWorld(sm: Smuggler): boolean {
  return !!findZoneDef(sm.anchorage.zone);
}

/** The smugglers who can be met now: those whose zone is built. */
export function smugglersInWorld(): readonly Smuggler[] {
  return gameSmugglers().filter(smugglerInWorld);
}

/** Her saved state: the island smuggler's own slot, or her boat's entry, made on first use. */
export function smugglerStateOf(
  contraband: ContrabandState,
  sm: Smuggler,
  gameSeconds: number,
): SmugglerState {
  if (sm.id === gameSmuggler().id) return contraband.smuggler;
  const boats = (contraband.boats ??= {});
  return (boats[sm.id] ??= freshSmugglerState(gameSeconds, sm));
}

/** Her anchorage for the rumors (piece K): its id, its name and how a rumor puts it. */
export function smugglerAnchorage(sm: Smuggler = gameSmuggler()): {
  id: string;
  name: string;
  where: string;
} {
  const { id, name, where } = sm.anchorage;
  return { id, name, where };
}

/** The night a moment belongs to, counted noon to noon, so a night's dealings share one week's cash. */
export function nightOf(gameSeconds: number): number {
  return Math.floor((gameSeconds - SECONDS_PER_GAME_DAY / 2) / SECONDS_PER_GAME_DAY);
}

/** Is it dark enough for her to be at her anchorage? */
export function smugglerAbout(gameSeconds: number, sm: Smuggler = gameSmuggler()): boolean {
  return (sunAt(gameSeconds).elevationRad * 180) / Math.PI < sm.darkSunDeg;
}

export function freshSmugglerState(
  gameSeconds: number,
  sm: Smuggler = gameSmuggler(),
): SmugglerState {
  return {
    night: nightOf(gameSeconds),
    cashCents: sm.weeklyCashCents,
    stock: Object.fromEntries(sm.sells.map((s) => [s.good, s.cu])),
    dealtCents: 0,
  };
}

export function freshContrabandState(gameSeconds: number): ContrabandState {
  return { smuggler: freshSmugglerState(gameSeconds), refusals: {}, receivers: [], known: false };
}

/** A new night: her cash and her stock are made up again; her trust stays. */
export function restock(
  state: SmugglerState,
  gameSeconds: number,
  sm: Smuggler = gameSmuggler(),
): void {
  const night = nightOf(gameSeconds);
  if (state.night === night) return;
  const fresh = freshSmugglerState(gameSeconds, sm);
  state.night = night;
  state.cashCents = fresh.cashCents;
  state.stock = fresh.stock;
}

/** Her trust, 0–1, from what you've dealt with her. */
export function trust01(state: SmugglerState, sm: Smuggler = gameSmuggler()): number {
  return Math.min(1, state.dealtCents / sm.rate.trustAtCents);
}

/** The share of a lot's value she pays, 0.4–0.7 with the shipped tuning. */
export function fenceRate(
  state: SmugglerState,
  heat: number,
  sm: Smuggler = gameSmuggler(),
): number {
  const { min, trust, cool } = sm.rate;
  return min + trust * trust01(state, sm) + cool * (1 - Math.min(1, Math.max(0, heat)));
}

export type FenceRefusal = 'clean' | 'contract' | 'hers' | 'unknown';

/** What she'd pay for a lot, a CU, or why she won't. */
export function fenceQuote(
  defs: EconomyDefs,
  state: SmugglerState,
  stack: CargoStack,
  gameSeconds: number,
  sm: Smuggler = gameSmuggler(),
):
  | { ok: true; rate: number; unitCents: number; heat: number }
  | { ok: false; reason: FenceRefusal } {
  const good = defs.goods.get(stack.good);
  if (!good) return { ok: false, reason: 'unknown' };
  if (stack.contract) return { ok: false, reason: 'contract' };
  if (sm.sells.some((s) => s.good === stack.good) && !stack.hot)
    return { ok: false, reason: 'hers' };
  if (!offerKind(defs, stack)) return { ok: false, reason: 'clean' };
  const heat = stack.hot ? heatNow(stack.hot, gameSeconds) : 0;
  const rate = fenceRate(state, heat, sm);
  return { ok: true, rate, unitCents: Math.floor(good.basePriceCents * rate), heat };
}

export type SmugglerRefusal =
  'gone' | 'badQty' | 'noStock' | 'noRoom' | 'noMoney' | 'noCash' | FenceRefusal | 'badLot';

/** What `SmugglerDealt` carries: a purchase from her or a lot sold to her. */
export interface SmugglerDealtEvent {
  smuggler: string;
  side: 'buy' | 'fence';
  good: string;
  qty: number;
  totalCents: number;
  hot: boolean;
}

export type SmugglerResult =
  { ok: true; event: SmugglerDealtEvent } | { ok: false; reason: SmugglerRefusal };

/** Buys contraband from her at her price; what you pay goes into her cash. */
export function buyFromSmuggler(
  defs: EconomyDefs,
  state: SmugglerState,
  trader: Trader,
  capacity: number,
  good: string,
  qty: number,
  gameSeconds: number,
  sm: Smuggler = gameSmuggler(),
): SmugglerResult {
  restock(state, gameSeconds, sm);
  if (!Number.isInteger(qty) || qty <= 0) return { ok: false, reason: 'badQty' };
  const price = defs.goods.get(good)?.smugglerPriceCents;
  if (!sm.sells.some((s) => s.good === good) || !price) return { ok: false, reason: 'unknown' };
  if ((state.stock[good] ?? 0) < qty) return { ok: false, reason: 'noStock' };
  if (holdFree(trader.cargo, capacity) < qty) return { ok: false, reason: 'noRoom' };
  const total = price * qty;
  if (total > trader.purse) return { ok: false, reason: 'noMoney' };
  trader.purse -= total;
  state.cashCents += total;
  state.stock[good] = (state.stock[good] ?? 0) - qty;
  state.dealtCents += total;
  addToHold(trader.cargo, { good, qty, paidCents: total });
  return {
    ok: true,
    event: { smuggler: sm.id, side: 'buy', good, qty, totalCents: total, hot: false },
  };
}

/**
 * Sells `qty` CU of one lot (a stack of the hold) to her at her rate, out of her cash.
 * A hot lot keeps its flags on what's left of it.
 */
export function fenceToSmuggler(
  defs: EconomyDefs,
  state: SmugglerState,
  trader: Trader,
  stackIndex: number,
  qty: number,
  gameSeconds: number,
  sm: Smuggler = gameSmuggler(),
): SmugglerResult {
  restock(state, gameSeconds, sm);
  const stack = trader.cargo[stackIndex];
  if (!stack) return { ok: false, reason: 'badLot' };
  if (!Number.isInteger(qty) || qty <= 0 || qty > stack.qty) return { ok: false, reason: 'badQty' };
  const q = fenceQuote(defs, state, stack, gameSeconds, sm);
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
      smuggler: sm.id,
      side: 'fence',
      good: stack.good,
      qty,
      totalCents: total,
      hot: !!stack.hot,
    },
  };
}

/** The most CU of a lot her cash covers tonight. */
export function maxFenceable(
  defs: EconomyDefs,
  state: SmugglerState,
  stack: CargoStack,
  gameSeconds: number,
  sm: Smuggler = gameSmuggler(),
): number {
  const q = fenceQuote(defs, state, stack, gameSeconds, sm);
  if (!q.ok || q.unitCents <= 0) return 0;
  const cash = nightOf(gameSeconds) === state.night ? state.cashCents : sm.weeklyCashCents;
  return Math.min(stack.qty, Math.floor(cash / q.unitCents));
}

/** Does the captain know where she lies? `heardOf` is the rumors' answer (piece K). */
export function knowsAnchorage(
  contraband: ContrabandState | undefined,
  background: string,
  heardOf = false,
  sm: Smuggler = gameSmuggler(),
): boolean {
  const learned =
    sm.id === gameSmuggler().id ? !!contraband?.known : !!contraband?.knownBoats?.includes(sm.id);
  return heardOf || learned || sm.knownBy.includes(background);
}

/** Marks where she lies as known; false if it already was. */
export function learnAnchorage(contraband: ContrabandState, sm: Smuggler): boolean {
  if (sm.id === gameSmuggler().id) {
    if (contraband.known) return false;
    contraband.known = true;
    return true;
  }
  const known = (contraband.knownBoats ??= []);
  if (known.includes(sm.id)) return false;
  known.push(sm.id);
  return true;
}
