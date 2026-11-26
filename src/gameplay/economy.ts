import { WORLD_TICK_GAME_SECONDS } from '../core/time';
import { cargoCapacity, gameEconomy, type EconomyDefs } from '../sim/economy/defs';
import { holdLoad01, type Hold } from '../sim/economy/hold';
import { lakeIceFor } from '../sim/ice/ice';
import { shockMarket, tickMarkets, unitPrices, quote, type TradeSide } from '../sim/economy/market';
import { buy, maxBuyable, sell, type Trader, type TradeResult } from '../sim/economy/trade';
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
/** Something other than the hold to trade in and out of: the hand sled, on foot. */
export interface Carrier {
  cargo: Hold;
  /** CU. */
  capacity: number;
}

/** The captain's purse with a carrier's load for a hold. */
export function carried(player: Trader, carrier: Carrier): Trader {
  return {
    get purse() {
      return player.purse;
    },
    set purse(v) {
      player.purse = v;
    },
    cargo: carrier.cargo,
  };
}

export interface GameEconomy {
  defs: EconomyDefs;
  /** The hold's size, CU: the ship's class with her upgrades (piece G). */
  readonly capacity: number;
  /** A new hull or a bigger hold (piece G). */
  setCapacity(cu: number): void;
  /**
   * Buys into the hold, or into `carrier` (the hand sled, on foot at a port she isn't at:
   * its load and its capacity, CU); the purse pays either way.
   */
  buy(port: string, good: string, qty: number, carrier?: Carrier): TradeResult;
  /** Sells out of the hold, or out of `carrier`. */
  sell(port: string, good: string, qty: number, carrier?: Carrier): TradeResult;
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
  /**
   * The chance your receiver at a port turns you in (Phase 5 piece E sets it from the
   * port's Wanted tier); none by default.
   */
  informChance: (port: string) => number;
  /**
   * What the buyers pay you for a good at a port, as a share of the market's price (a feud's
   * undercut, Phase 9 piece D); 1 by default.
   */
  sellFactor: (port: string, good: string) => number;
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
  initialCapacity: number = cargoCapacity(),
): GameEconomy {
  let capacity = initialCapacity;
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
    tickMarkets(defs, markets(), gameSeconds, WORLD_TICK_GAME_SECONDS, (port) =>
      // A port frozen in for the winter gets nothing by water (piece K).
      lakeIceFor(runSeed(ctx)).harborClosed(port, gameSeconds),
    ),
  );
  syncLoad();

  const economy: GameEconomy = {
    defs,
    informChance: () => 0,
    sellFactor: () => 1,
    get capacity() {
      return capacity;
    },
    setCapacity(cu) {
      capacity = cu;
      syncLoad();
    },
    buy: (port, good, qty, carrier) =>
      settle(
        buy(
          defs,
          markets(),
          carrier ? carried(player(), carrier) : player(),
          carrier?.capacity ?? capacity,
          port,
          good,
          qty,
          now(),
        ),
      ),
    sell: (port, good, qty, carrier) =>
      settle(
        sell(
          defs,
          markets(),
          carrier ? carried(player(), carrier) : player(),
          port,
          good,
          qty,
          now(),
          economy.sellFactor(port, good),
        ),
      ),
    quote(port, good, qty, side) {
      const q = quote(defs, markets(), port, good, qty, side, now());
      if (side !== 'sell') return q;
      return { ...q, totalCents: Math.floor(q.totalCents * economy.sellFactor(port, good)) };
    },
    maxBuyable: (port, good) => maxBuyable(defs, markets(), player(), capacity, port, good, now()),
    prices(port) {
      const pm = defs.markets.get(port);
      if (!pm) return [];
      return [...pm.goods.keys()].map((good) => {
        const p = unitPrices(defs, markets(), port, good, now());
        return {
          good,
          buyCents: p?.buyCents ?? 0,
          sellCents: Math.floor((p?.sellCents ?? 0) * economy.sellFactor(port, good)),
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
        contraband,
        port,
        stackIndex,
        now(),
        runSeed(ctx),
        undefined,
        economy.informChance(port),
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
  return economy;
}
