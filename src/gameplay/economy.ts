import { WORLD_TICK_GAME_SECONDS } from '../core/time';
import { cargoCapacity, gameEconomy, type EconomyDefs } from '../sim/economy/defs';
import { holdLoad01 } from '../sim/economy/hold';
import { shockMarket, tickMarkets, unitPrices, quote, type TradeSide } from '../sim/economy/market';
import { buy, maxBuyable, sell, type TradeResult } from '../sim/economy/trade';
import type { GameContext } from '../modes/context';
import type { ShipHazards } from './hazards';

/**
 * The economy in the running game (plan 05 §4, Phase 4 piece A): markets drift on every
 * world tick, trades move the purse, the hold and the port's stock and raise
 * `TradeCompleted`, and the hold's load sets the player ship's draft and speed. The port
 * and trade screens (piece B) call these; until then the dev hook does.
 */
export interface GameEconomy {
  defs: EconomyDefs;
  /** The hold's size, CU: the ship's class with her upgrades (piece G). */
  readonly capacity: number;
  /** A new hull or a bigger hold (piece G). */
  setCapacity(cu: number): void;
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
  /** Sets the ship's load from the hold; call after anything else changes the hold. */
  syncLoad(): void;
  dispose(): void;
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
    tickMarkets(defs, markets(), gameSeconds, WORLD_TICK_GAME_SECONDS),
  );
  syncLoad();

  return {
    defs,
    get capacity() {
      return capacity;
    },
    setCapacity(cu) {
      capacity = cu;
      syncLoad();
    },
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
    syncLoad,
    dispose: offTick,
  };
}
