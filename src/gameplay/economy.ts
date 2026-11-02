import { WORLD_TICK_GAME_SECONDS } from '../core/time';
import { cargoCapacity, gameEconomy, type EconomyDefs } from '../sim/economy/defs';
import { holdLoad01 } from '../sim/economy/hold';
import { shockMarket, tickMarkets, unitPrices, quote, type TradeSide } from '../sim/economy/market';
import { buy, maxBuyable, sell, type TradeResult } from '../sim/economy/trade';
import type { GameContext } from '../modes/context';
import type { ShipHazards } from './hazards';
import { makeHot, offerLot, type OfferResult } from '../sim/economy/contraband';
import { freshContrabandState } from '../sim/economy/smuggler';

/**
 * The economy in the running game (plan 05 §4, Phase 4 piece A): markets drift on every
 * world tick, trades move the purse, the hold and the port's stock and raise
 * `TradeCompleted`, and the hold's load sets the player ship's draft and speed. The port
 * and trade screens (piece B) call these; until then the dev hook does.
 */
export interface GameEconomy {
  defs: EconomyDefs;
  capacity: number;
  buy(port: string, good: string, qty: number): TradeResult;
  sell(port: string, good: string, qty: number): TradeResult;
  quote(
    port: string,
    good: string,
    qty: number,
    side: TradeSide,
  ): { qty: number; totalCents: number };
  maxBuyable(port: string, good: string): number;
  /** Every good the port trades with the next CU's price each way and the stock. */
  prices(port: string): { good: string; buyCents: number; sellCents: number; stock: number }[];
  /** A market event for testing and, later, the event system (plan 12). */
  shock(port: string, good: string, stockFactor: number, cause: string): void;
  /**
   * Offers one lot of the hold (a hot or contraband stack) to a port's merchants (piece H):
   * sold, refused or confiscated, raising `TradeCompleted`, `ContrabandSold` or
   * `HotGoodsDetected`.
   */
  offer(port: string, stackIndex: number): OfferResult;
  /** Marks clean cargo hot, as if just stolen in `region` (the dev command until Phase 6). */
  makeHot(good: string, qty: number, region: string, heat?: number): number;
  /** Sets the ship's load from the hold; call after anything else changes the hold. */
  syncLoad(): void;
  dispose(): void;
}

/** The run's stable seed for rolls that must come out the same after a reload. */
export function runSeed(ctx: GameContext): string {
  return `run-${ctx.state.environment.weather.noiseSeed}`;
}

export function attachEconomy(
  ctx: GameContext,
  hazards: ShipHazards | undefined,
  defs: EconomyDefs = gameEconomy(),
  capacity: number = cargoCapacity(),
): GameEconomy {
  const now = (): number => ctx.state.environment.clock.gameSeconds;
  const markets = (): typeof ctx.state.markets => ctx.state.markets;
  const player = (): typeof ctx.state.player => ctx.state.player;

  const syncLoad = (): void => {
    if (hazards) hazards.state.cargo01 = holdLoad01(defs, player().cargo, capacity);
  };
  const settle = (r: TradeResult): TradeResult => {
    if (r.ok) {
      syncLoad();
      ctx.events.emit('TradeCompleted', r.event);
    }
    return r;
  };

  const offTick = ctx.events.on('WorldTick', ({ gameSeconds }) =>
    tickMarkets(defs, markets(), gameSeconds, WORLD_TICK_GAME_SECONDS),
  );
  syncLoad();

  return {
    defs,
    capacity,
    buy: (port, good, qty) =>
      settle(buy(defs, markets(), player(), capacity, port, good, qty, now())),
    sell: (port, good, qty) => settle(sell(defs, markets(), player(), port, good, qty, now())),
    quote: (port, good, qty, side) => quote(defs, markets(), port, good, qty, side, now()),
    maxBuyable: (port, good) => maxBuyable(defs, markets(), player(), capacity, port, good, now()),
    prices(port) {
      const pm = defs.markets.get(port);
      if (!pm) return [];
      return [...pm.goods.keys()].map((good) => {
        const p = unitPrices(defs, markets(), port, good, now());
        return {
          good,
          buyCents: p?.buyCents ?? 0,
          sellCents: p?.sellCents ?? 0,
          stock: markets()[port]?.[good]?.stock ?? 0,
        };
      });
    },
    shock(port, good, stockFactor, cause) {
      const e = shockMarket(defs, markets(), port, good, stockFactor, cause, now());
      if (e) ctx.events.emit('PriceShock', e);
    },
    offer(port, stackIndex) {
      const contraband = (ctx.state.contraband ??= freshContrabandState(now()));
      const r = offerLot(
        defs,
        markets(),
        player(),
        contraband.refusals,
        port,
        stackIndex,
        now(),
        runSeed(ctx),
      );
      if (!r.ok) return r;
      syncLoad();
      if (r.outcome !== 'sold') {
        ctx.events.emit('HotGoodsDetected', r.event);
      } else if (r.kind === 'hot') {
        ctx.events.emit('TradeCompleted', {
          port,
          good: r.good,
          side: 'sell',
          qty: r.qty,
          totalCents: r.totalCents,
          nextUnitCents: unitPrices(defs, markets(), port, r.good, now())?.sellCents ?? 0,
        });
      } else {
        ctx.events.emit('ContrabandSold', {
          port,
          good: r.good,
          qty: r.qty,
          totalCents: r.totalCents,
        });
      }
      return r;
    },
    makeHot(good, qty, region, heat) {
      const n = makeHot(defs, player().cargo, good, qty, region, now(), heat);
      syncLoad();
      return n;
    },
    syncLoad,
    dispose: offTick,
  };
}
