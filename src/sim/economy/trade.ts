import type { EconomyDefs } from './defs';
import { addToHold, cleanQty, holdFree, takeCleanFromHold, type Hold } from './hold';
import { applyTrade, quote, unitPrices, type MarketsState, type TradeSide } from './market';

/**
 * Buying and selling at a port's market (plan 05 §4.1): the purse pays or is paid in
 * integer cents, the hold gains or loses whole CU, and the port's stock moves. Each
 * trade is all or nothing and returns the `TradeCompleted` payload for the caller to
 * emit, or why it was refused.
 */

/** Whoever is trading: the player (`player.purse`, `player.cargo`) or a harness bot. */
export interface Trader {
  /** Cash on hand, cents (plan 05 §2). */
  purse: number;
  cargo: Hold;
}

export type TradeRefusal = 'badQty' | 'notTraded' | 'noStock' | 'noMoney' | 'noRoom' | 'noCargo';

/** What `TradeCompleted` carries (plan 05 §11). */
export interface TradeCompletedEvent {
  port: string;
  good: string;
  side: TradeSide;
  qty: number;
  totalCents: number;
  /** The next CU's price the same way after the trade: how far it moved the market. */
  nextUnitCents: number;
}

export type TradeResult =
  { ok: true; event: TradeCompletedEvent } | { ok: false; reason: TradeRefusal };

function nextUnit(
  defs: EconomyDefs,
  markets: MarketsState,
  port: string,
  good: string,
  side: TradeSide,
  gameSeconds: number,
): number {
  const p = unitPrices(defs, markets, port, good, gameSeconds);
  return p ? (side === 'buy' ? p.buyCents : p.sellCents) : 0;
}

export function buy(
  defs: EconomyDefs,
  markets: MarketsState,
  trader: Trader,
  capacity: number,
  port: string,
  good: string,
  qty: number,
  gameSeconds: number,
): TradeResult {
  if (!Number.isInteger(qty) || qty <= 0) return { ok: false, reason: 'badQty' };
  if (!defs.markets.get(port)?.goods.has(good)) return { ok: false, reason: 'notTraded' };
  const q = quote(defs, markets, port, good, qty, 'buy', gameSeconds);
  if (q.qty < qty) return { ok: false, reason: 'noStock' };
  if (holdFree(trader.cargo, capacity) < qty) return { ok: false, reason: 'noRoom' };
  if (q.totalCents > trader.purse) return { ok: false, reason: 'noMoney' };
  trader.purse -= q.totalCents;
  addToHold(trader.cargo, { good, qty });
  applyTrade(markets, port, good, qty, 'buy', gameSeconds);
  return {
    ok: true,
    event: {
      port,
      good,
      side: 'buy',
      qty,
      totalCents: q.totalCents,
      nextUnitCents: nextUnit(defs, markets, port, good, 'buy', gameSeconds),
    },
  };
}

/** Sells clean goods only; hot goods (piece H) and contract cargo (piece F) are kept. */
export function sell(
  defs: EconomyDefs,
  markets: MarketsState,
  trader: Trader,
  port: string,
  good: string,
  qty: number,
  gameSeconds: number,
): TradeResult {
  if (!Number.isInteger(qty) || qty <= 0) return { ok: false, reason: 'badQty' };
  if (!defs.markets.get(port)?.goods.has(good)) return { ok: false, reason: 'notTraded' };
  if (cleanQty(trader.cargo, good) < qty) return { ok: false, reason: 'noCargo' };
  const q = quote(defs, markets, port, good, qty, 'sell', gameSeconds);
  takeCleanFromHold(trader.cargo, good, qty);
  trader.purse += q.totalCents;
  applyTrade(markets, port, good, qty, 'sell', gameSeconds);
  return {
    ok: true,
    event: {
      port,
      good,
      side: 'sell',
      qty,
      totalCents: q.totalCents,
      nextUnitCents: nextUnit(defs, markets, port, good, 'sell', gameSeconds),
    },
  };
}

/** The most CU of a good the trader can buy here now: stock, hold room and purse. */
export function maxBuyable(
  defs: EconomyDefs,
  markets: MarketsState,
  trader: Trader,
  capacity: number,
  port: string,
  good: string,
  gameSeconds: number,
): number {
  const room = holdFree(trader.cargo, capacity);
  const q = quote(defs, markets, port, good, room, 'buy', gameSeconds);
  // The total only grows with quantity, so walk down from the most the hold and stock allow.
  for (let n = q.qty; n > 0; n--) {
    if (quote(defs, markets, port, good, n, 'buy', gameSeconds).totalCents <= trader.purse) {
      return n;
    }
  }
  return 0;
}
