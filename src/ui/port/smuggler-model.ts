import type { Smuggler } from '../../../data/schemas/smuggler';
import type { EconomyDefs } from '../../sim/economy/defs';
import { holdFree, holdUsed, type CargoStack } from '../../sim/economy/hold';
import {
  fenceQuote,
  maxFenceable,
  nightOf,
  trust01,
  type FenceRefusal,
  type SmugglerState,
} from '../../sim/economy/smuggler';
import type { Trader } from '../../sim/economy/trade';
import { weekLabel } from '../hud/model';

/**
 * What the smuggler's screen shows (plan 05 §12 "Fence screen"; Phase 4 piece H): what she
 * sells tonight, every lot in your hold with her rate for it or why she won't take it,
 * her cash left for the week, and how far she trusts you. Built when the screen opens and
 * after every deal; the game is paused under it.
 */

export interface SmugglerSale {
  good: string;
  name: string;
  priceCents: number;
  stock: number;
  maxBuy: number;
}

export interface SmugglerLot {
  /** The stack's place in the hold. */
  index: number;
  good: string;
  name: string;
  qty: number;
  hot: boolean;
  /** Her rate as a whole percent of the good's value, and a CU's price. */
  ratePct: number | undefined;
  unitCents: number | undefined;
  /** The most CU her cash covers. */
  maxQty: number;
  /** Why she won't take it. */
  refusal: string | undefined;
}

export interface SmugglerSnapshot {
  boatName: string;
  blurb: string;
  anchorageName: string;
  dateText: string;
  purseCents: number;
  cashCents: number;
  /** "She doesn't know you yet" … "She trusts you". */
  trustText: string;
  capacity: number;
  usedCu: number;
  sells: SmugglerSale[];
  lots: SmugglerLot[];
}

const FENCE_REFUSALS: Record<FenceRefusal, string> = {
  clean: 'Clean goods: take them to a merchant',
  contract: "A company's freight: she won't touch it",
  hers: 'She has barrels enough of her own',
  unknown: "She doesn't deal in it",
};

function trustText(t: number): string {
  if (t < 0.1) return "She doesn't know you yet";
  if (t < 0.4) return 'She knows your face';
  if (t < 0.8) return 'She deals with you';
  return 'She trusts you';
}

export function smugglerSnapshot(
  defs: EconomyDefs,
  sm: Smuggler,
  state: SmugglerState,
  trader: Trader,
  capacity: number,
  gameSeconds: number,
): SmugglerSnapshot {
  const tonight = nightOf(gameSeconds) === state.night;
  const cash = tonight ? state.cashCents : sm.weeklyCashCents;
  const free = holdFree(trader.cargo, capacity);
  const sells = sm.sells.map((s) => {
    const price = defs.goods.get(s.good)?.smugglerPriceCents ?? 0;
    const stock = tonight ? (state.stock[s.good] ?? 0) : s.cu;
    return {
      good: s.good,
      name: defs.goods.get(s.good)?.name ?? s.good,
      priceCents: price,
      stock,
      maxBuy: price > 0 ? Math.min(stock, free, Math.floor(trader.purse / price)) : 0,
    };
  });
  const lots = trader.cargo.map((s: CargoStack, index): SmugglerLot => {
    const q = fenceQuote(defs, state, s, gameSeconds, sm);
    return {
      index,
      good: s.good,
      name: defs.goods.get(s.good)?.name ?? s.good,
      qty: s.qty,
      hot: !!s.hot,
      ratePct: q.ok ? Math.round(q.rate * 100) : undefined,
      unitCents: q.ok ? q.unitCents : undefined,
      maxQty: maxFenceable(defs, state, s, gameSeconds, sm),
      refusal: q.ok ? undefined : FENCE_REFUSALS[q.reason],
    };
  });
  // Lots she'll take first, then the rest.
  lots.sort((a, b) => Number(!!a.refusal) - Number(!!b.refusal) || a.name.localeCompare(b.name));
  return {
    boatName: sm.boatName,
    blurb: sm.blurb,
    anchorageName: sm.anchorage.name,
    dateText: weekLabel(gameSeconds),
    purseCents: trader.purse,
    cashCents: cash,
    trustText: trustText(trust01(state, sm)),
    capacity,
    usedCu: holdUsed(trader.cargo),
    sells,
    lots,
  };
}
