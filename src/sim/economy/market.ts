import type { Season } from '../../../data/schemas/goods';
import { SECONDS_PER_GAME_DAY } from '../../core/time';
import { seasonAt, type EconomyDefs, type MarketGood, type PortMarket } from './defs';

/**
 * The market model (plan 05 §4.1). Each port holds a stock of every good it trades. The
 * price is the port's base price for the good × the season's demand ×
 * (target / stock)^elasticity, clamped to [0.4, 3] × base. Buying takes stock (the price
 * climbs as you buy), selling adds it (the price falls as you sell), and on every world
 * tick the stock drifts back toward its seasonal target. Money is integer cents: each CU
 * is priced at the stock it leaves or arrives at, rounded in the port's favor, so a
 * buy-then-sell in one port always loses the spread.
 */

/** One good's live state in one port (plan 05 §11 `markets[portId][goodId]`). */
export interface MarketGoodState {
  stock: number;
  /** Game seconds of the player's last trade in it, for the ledger. */
  lastPlayerTradeAt?: number | undefined;
}

export type MarketsState = Record<string, Record<string, MarketGoodState>>;

export type TradeSide = 'buy' | 'sell';

/** What `PriceShock` carries (plan 05 §11): a storm sank the grain boat, a mill burned. */
export interface PriceShockEvent {
  port: string;
  good: string;
  cause: string;
  priceBeforeCents: number;
  priceAfterCents: number;
}

function market(defs: EconomyDefs, portId: string): PortMarket {
  const m = defs.markets.get(portId);
  if (!m) throw new Error(`No market at ${portId}`);
  return m;
}

function marketGood(defs: EconomyDefs, portId: string, goodId: string): MarketGood | undefined {
  return market(defs, portId).goods.get(goodId);
}

/** The stock a good drifts toward this season: low out of its season (plan 05 §3). */
export function seasonalTarget(defs: EconomyDefs, mg: MarketGood, season: Season): number {
  const inSeason = mg.good.seasons.includes(season);
  return mg.targetStock * (inSeason ? 1 : defs.rules.offSeasonStock);
}

/** The mid price at a given stock, cents per CU (unrounded). */
export function midPrice(defs: EconomyDefs, mg: MarketGood, stock: number, season: Season): number {
  const r = defs.rules;
  const demand = mg.good.seasonPrice?.[season] ?? 1;
  const base = mg.basePriceCents * demand;
  const ratio = mg.targetStock / Math.max(stock, r.minStockCu);
  const raw = base * ratio ** r.elasticity;
  return Math.min(Math.max(raw, base * r.clampMin), base * r.clampMax);
}

function stateOf(markets: MarketsState, portId: string, goodId: string): MarketGoodState {
  const s = markets[portId]?.[goodId];
  if (!s) throw new Error(`No market state for ${goodId} at ${portId}; run syncMarkets first`);
  return s;
}

/** A CU bought when the port's stock is `stock`: priced at the stock it leaves behind. */
function buyUnit(
  defs: EconomyDefs,
  pm: PortMarket,
  mg: MarketGood,
  stock: number,
  season: Season,
): number {
  return Math.ceil(midPrice(defs, mg, stock - 0.5, season) * (1 + pm.spread));
}

/** A CU sold when the port's stock is `stock`: priced at the stock it arrives at. */
function sellUnit(
  defs: EconomyDefs,
  pm: PortMarket,
  mg: MarketGood,
  stock: number,
  season: Season,
): number {
  return Math.floor(midPrice(defs, mg, stock + 0.5, season) * (1 - pm.spread));
}

export interface Quote {
  /** Whole CU the port will trade, up to the asked quantity. */
  qty: number;
  totalCents: number;
}

/**
 * What `qty` CU would cost to buy or fetch to sell here now, CU by CU. Buying stops at
 * the port's whole stock; a good the port doesn't trade quotes nothing.
 */
export function quote(
  defs: EconomyDefs,
  markets: MarketsState,
  portId: string,
  goodId: string,
  qty: number,
  side: TradeSide,
  gameSeconds: number,
): Quote {
  const pm = market(defs, portId);
  const mg = pm.goods.get(goodId);
  if (!mg || qty <= 0) return { qty: 0, totalCents: 0 };
  const season = seasonAt(gameSeconds);
  const stock = stateOf(markets, portId, goodId).stock;
  const n = side === 'buy' ? Math.min(Math.floor(qty), Math.floor(stock)) : Math.floor(qty);
  let total = 0;
  for (let i = 0; i < n; i++) {
    total +=
      side === 'buy'
        ? buyUnit(defs, pm, mg, stock - i, season)
        : sellUnit(defs, pm, mg, stock + i, season);
  }
  return { qty: n, totalCents: total };
}

/** The price of the next CU each way, cents: what the trade screen lists. */
export function unitPrices(
  defs: EconomyDefs,
  markets: MarketsState,
  portId: string,
  goodId: string,
  gameSeconds: number,
): { buyCents: number; sellCents: number; midCents: number } | undefined {
  const pm = market(defs, portId);
  const mg = pm.goods.get(goodId);
  if (!mg) return undefined;
  const season = seasonAt(gameSeconds);
  const stock = stateOf(markets, portId, goodId).stock;
  return {
    buyCents: buyUnit(defs, pm, mg, stock, season),
    sellCents: sellUnit(defs, pm, mg, stock, season),
    midCents: Math.round(midPrice(defs, mg, stock, season)),
  };
}

/** Moves the port's stock for a trade the caller has already priced and paid. */
export function applyTrade(
  markets: MarketsState,
  portId: string,
  goodId: string,
  qty: number,
  side: TradeSide,
  gameSeconds: number,
): void {
  const s = stateOf(markets, portId, goodId);
  s.stock = side === 'buy' ? s.stock - qty : s.stock + qty;
  s.lastPlayerTradeAt = gameSeconds;
}

/**
 * Gives every port every good it trades, at its seasonal target, where the state has
 * none yet: a new run, a migrated save, or a port or good added to the data since.
 */
export function syncMarkets(defs: EconomyDefs, markets: MarketsState, gameSeconds: number): void {
  const season = seasonAt(gameSeconds);
  for (const [portId, pm] of defs.markets) {
    const port = (markets[portId] ??= {});
    for (const [goodId, mg] of pm.goods) {
      port[goodId] ??= { stock: seasonalTarget(defs, mg, season) };
    }
  }
}

export function createMarkets(defs: EconomyDefs, gameSeconds: number): MarketsState {
  const markets: MarketsState = {};
  syncMarkets(defs, markets, gameSeconds);
  return markets;
}

/**
 * One world tick of drift (plan 05 §4.1): each stock closes part of its gap to the
 * season's target, as production and consumption would. Allocation-free; 7 ports × ~20
 * goods is well under the 1 ms tick budget.
 */
export function tickMarkets(
  defs: EconomyDefs,
  markets: MarketsState,
  gameSeconds: number,
  dtSeconds: number,
): void {
  const season = seasonAt(gameSeconds);
  const k = 1 - Math.exp((-defs.rules.recoveryPerDay * dtSeconds) / SECONDS_PER_GAME_DAY);
  for (const [portId, pm] of defs.markets) {
    const port = markets[portId];
    if (!port) continue;
    for (const [goodId, mg] of pm.goods) {
      const s = port[goodId];
      if (!s) continue;
      const target = seasonalTarget(defs, mg, season);
      s.stock = Math.max(defs.rules.minStockCu, s.stock + (target - s.stock) * k);
    }
  }
}

/**
 * A market event (plan 05 §4.1): multiplies the port's stock of a good, e.g. 0.3 when the
 * grain boat sinks (dearer), 2 for a herring run (cheaper). Returns the `PriceShock`.
 */
export function shockMarket(
  defs: EconomyDefs,
  markets: MarketsState,
  portId: string,
  goodId: string,
  stockFactor: number,
  cause: string,
  gameSeconds: number,
): PriceShockEvent | undefined {
  const mg = marketGood(defs, portId, goodId);
  if (!mg) return undefined;
  const season = seasonAt(gameSeconds);
  const s = stateOf(markets, portId, goodId);
  const before = Math.round(midPrice(defs, mg, s.stock, season));
  s.stock = Math.max(defs.rules.minStockCu, s.stock * stockFactor);
  const after = Math.round(midPrice(defs, mg, s.stock, season));
  return { port: portId, good: goodId, cause, priceBeforeCents: before, priceAfterCents: after };
}
