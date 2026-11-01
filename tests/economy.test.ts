import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { EventBus } from '../src/core/events';
import { SECONDS_PER_GAME_DAY, WORLD_TICK_GAME_SECONDS } from '../src/core/time';
import { attachEconomy } from '../src/gameplay/economy';
import type { GameContext, GameEvents } from '../src/modes/context';
import { cargoCapacity, gameEconomy, seasonAt } from '../src/sim/economy/defs';
import {
  addToHold,
  cleanQty,
  holdLoad01,
  holdUsed,
  takeCleanFromHold,
  type Hold,
} from '../src/sim/economy/hold';
import {
  createMarkets,
  midPrice,
  quote,
  shockMarket,
  tickMarkets,
  unitPrices,
} from '../src/sim/economy/market';
import { buy, maxBuyable, sell, type Trader } from '../src/sim/economy/trade';
import { createSailingState } from '../src/sim/sailing/controller';
import { defaultHazardRules } from '../src/sim/sailing/hazard-rules';
import {
  compileHazardClass,
  createHazardState,
  IDLE_MOORING,
  stepHazards,
} from '../src/sim/sailing/hazards';
import { sailShipRecord, T1_SCHOONER_ID } from '../src/sim/sailing/ships';
import { createWorldState } from '../src/sim/world-state';
import { createSchooner } from '../src/gameplay/schooner';

const defs = gameEconomy();
const T0 = 6 * 3600; // Dawn on May 7, 1900.
const SCALE = { rate: 24, compression: 8 };

function must<T>(value: T | undefined | null): T {
  if (value === undefined || value === null) throw new Error('missing value');
  return value;
}

describe('goods and markets data (plan 05 §3, §4.2)', () => {
  it('has the §3 goods in CU, and a T1 hold of 20 CU', () => {
    expect(defs.goods.size).toBe(23);
    expect(cargoCapacity()).toBe(20);
    for (const g of defs.goods.values()) {
      expect(Number.isInteger(g.basePriceCents), g.id).toBe(true);
      expect(g.weightFactor).toBeGreaterThan(0);
    }
  });

  it('has markets for the seven Phase 4 ports, and no Red Cliff or Bad River', () => {
    expect([...defs.markets.keys()].sort()).toEqual(
      [
        'port.ashland',
        'port.bayfield',
        'port.duluth',
        'port.la_pointe',
        'port.superior',
        'port.two_harbors',
        'port.washburn',
      ].sort(),
    );
  });

  it('keeps contraband off the open market', () => {
    for (const pm of defs.markets.values()) {
      expect(pm.goods.has('good.untaxed_whiskey')).toBe(false);
      expect(pm.goods.has('good.venison')).toBe(false);
    }
  });

  it("prices a port's exports below its imports", () => {
    const m = createMarkets(defs, T0);
    const fish = (port: string): number =>
      must(unitPrices(defs, m, port, 'good.salted_fish', T0)).midCents;
    expect(fish('port.bayfield')).toBeLessThan(fish('port.duluth'));
    const flour = (port: string): number =>
      must(unitPrices(defs, m, port, 'good.flour', T0)).midCents;
    expect(flour('port.duluth')).toBeLessThan(flour('port.bayfield'));
  });

  it('reads the season off the calendar', () => {
    expect(seasonAt(0)).toBe('spring');
    expect(seasonAt(4 * SECONDS_PER_GAME_DAY)).toBe('summer'); // June 4
    expect(seasonAt(18 * SECONDS_PER_GAME_DAY)).toBe('fall'); // September 10
    expect(seasonAt(31 * SECONDS_PER_GAME_DAY)).toBe('winter'); // December 10
  });
});

describe('the market model (plan 05 §4.1)', () => {
  it('raises the price as you buy and lowers it as you sell', () => {
    const m = createMarkets(defs, T0);
    const p0 = must(unitPrices(defs, m, 'port.bayfield', 'good.flour', T0));
    const t: Trader = { purse: 1_000_000, cargo: [] };
    expect(buy(defs, m, t, 20, 'port.bayfield', 'good.flour', 10, T0).ok).toBe(true);
    const p1 = must(unitPrices(defs, m, 'port.bayfield', 'good.flour', T0));
    expect(p1.buyCents).toBeGreaterThan(p0.buyCents);
    expect(sell(defs, m, t, 'port.bayfield', 'good.flour', 10, T0).ok).toBe(true);
    const p2 = must(unitPrices(defs, m, 'port.bayfield', 'good.flour', T0));
    expect(p2.midCents).toBe(p0.midCents);
  });

  it('always sells to you dearer than it buys from you', () => {
    const m = createMarkets(defs, T0);
    for (const [port, pm] of defs.markets) {
      for (const good of pm.goods.keys()) {
        const p = must(unitPrices(defs, m, port, good, T0));
        expect(p.buyCents, `${port} ${good}`).toBeGreaterThan(p.sellCents);
      }
    }
  });

  it('keeps every price inside 0.4–3 × base, however far the stock goes', () => {
    const mg = must(defs.markets.get('port.la_pointe')?.goods.get('good.coal'));
    fc.assert(
      fc.property(fc.double({ min: 0, max: 1e6, noNaN: true }), (stock) => {
        const p = midPrice(defs, mg, stock, 'spring');
        expect(p).toBeGreaterThanOrEqual(mg.basePriceCents * 0.4 - 1e-9);
        expect(p).toBeLessThanOrEqual(mg.basePriceCents * 3 + 1e-9);
      }),
    );
  });

  it('drifts a dumped stock back toward its target on the world tick', () => {
    const m = createMarkets(defs, T0);
    const before = must(unitPrices(defs, m, 'port.bayfield', 'good.flour', T0)).sellCents;
    const t: Trader = { purse: 0, cargo: [{ good: 'good.flour', qty: 20 }] };
    sell(defs, m, t, 'port.bayfield', 'good.flour', 20, T0);
    const crashed = must(unitPrices(defs, m, 'port.bayfield', 'good.flour', T0)).sellCents;
    // Criterion 3: a full T1 hold visibly crashes an importing port's price.
    expect(crashed).toBeLessThan(before * 0.8);
    let t1 = T0;
    for (let i = 0; i < (3 * SECONDS_PER_GAME_DAY) / WORLD_TICK_GAME_SECONDS; i++) {
      t1 += WORLD_TICK_GAME_SECONDS;
      tickMarkets(defs, m, t1, WORLD_TICK_GAME_SECONDS);
    }
    const later = must(unitPrices(defs, m, 'port.bayfield', 'good.flour', t1)).sellCents;
    expect(later).toBeGreaterThan(crashed);
    expect(later).toBeLessThan(before);
  });

  it('runs low out of season: fresh fish is scarce in winter', () => {
    const summer = createMarkets(defs, T0);
    const winter = createMarkets(defs, 31 * SECONDS_PER_GAME_DAY);
    expect(must(winter['port.bayfield']?.['good.fresh_fish']).stock).toBeLessThan(
      must(summer['port.bayfield']?.['good.fresh_fish']).stock,
    );
  });

  it('applies a market event and reports it', () => {
    const m = createMarkets(defs, T0);
    const e = must(shockMarket(defs, m, 'port.duluth', 'good.grain', 0.3, 'grain boat lost', T0));
    expect(e.cause).toBe('grain boat lost');
    expect(e.priceAfterCents).toBeGreaterThan(e.priceBeforeCents);
  });

  it('quotes nothing for a good the port does not trade', () => {
    const m = createMarkets(defs, T0);
    expect(quote(defs, m, 'port.la_pointe', 'good.iron_ore', 5, 'sell', T0)).toEqual({
      qty: 0,
      totalCents: 0,
    });
  });
});

describe('trading (plan 05 §2, §4.1)', () => {
  it('refuses what the purse, the hold or the stock cannot cover', () => {
    const m = createMarkets(defs, T0);
    const poor: Trader = { purse: 100, cargo: [] };
    expect(buy(defs, m, poor, 20, 'port.duluth', 'good.grain', 5, T0)).toEqual({
      ok: false,
      reason: 'noMoney',
    });
    const full: Trader = { purse: 1_000_000, cargo: [{ good: 'good.coal', qty: 20 }] };
    expect(buy(defs, m, full, 20, 'port.duluth', 'good.grain', 1, T0)).toEqual({
      ok: false,
      reason: 'noRoom',
    });
    expect(sell(defs, m, poor, 'port.duluth', 'good.grain', 1, T0)).toEqual({
      ok: false,
      reason: 'noCargo',
    });
    expect(buy(defs, m, full, 20, 'port.la_pointe', 'good.iron_ore', 1, T0)).toEqual({
      ok: false,
      reason: 'notTraded',
    });
    expect(buy(defs, m, poor, 20, 'port.duluth', 'good.grain', 1.5, T0)).toEqual({
      ok: false,
      reason: 'badQty',
    });
  });

  it('keeps money in whole cents and conserves goods', () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            port: fc.constantFrom(...defs.markets.keys()),
            good: fc.constantFrom('good.coal', 'good.flour', 'good.tobacco', 'good.salt'),
            qty: fc.integer({ min: 1, max: 20 }),
            side: fc.constantFrom('buy' as const, 'sell' as const),
          }),
          { maxLength: 30 },
        ),
        (ops) => {
          const m = createMarkets(defs, T0);
          const t: Trader = { purse: 50_000, cargo: [] };
          for (const op of ops) {
            const before = holdUsed(t.cargo);
            const r =
              op.side === 'buy'
                ? buy(defs, m, t, 20, op.port, op.good, op.qty, T0)
                : sell(defs, m, t, op.port, op.good, op.qty, T0);
            expect(Number.isInteger(t.purse)).toBe(true);
            expect(t.purse).toBeGreaterThanOrEqual(0);
            expect(holdUsed(t.cargo)).toBeLessThanOrEqual(20);
            if (r.ok)
              expect(holdUsed(t.cargo)).toBe(before + (op.side === 'buy' ? op.qty : -op.qty));
          }
        },
      ),
    );
  });

  it('finds the most it can afford', () => {
    const m = createMarkets(defs, T0);
    const t: Trader = { purse: 5_000, cargo: [] };
    const n = maxBuyable(defs, m, t, 20, 'port.duluth', 'good.hardware', T0);
    expect(n).toBeGreaterThan(0);
    expect(
      quote(defs, m, 'port.duluth', 'good.hardware', n, 'buy', T0).totalCents,
    ).toBeLessThanOrEqual(5_000);
    expect(
      quote(defs, m, 'port.duluth', 'good.hardware', n + 1, 'buy', T0).totalCents,
    ).toBeGreaterThan(5_000);
  });
});

describe('the hold (plan 05 §6.1, §11)', () => {
  it('merges clean goods and keeps hot and contract lots apart', () => {
    const hold: Hold = [];
    addToHold(hold, { good: 'good.furs', qty: 2 });
    addToHold(hold, { good: 'good.furs', qty: 3 });
    addToHold(hold, {
      good: 'good.furs',
      qty: 4,
      hot: { region: 'region.chequamegon', heat: 0.8, traceability: 0.3, since: 0 },
    });
    addToHold(hold, { good: 'good.furs', qty: 1, contract: 'contract.1' });
    expect(hold).toHaveLength(3);
    expect(cleanQty(hold, 'good.furs')).toBe(5);
    expect(takeCleanFromHold(hold, 'good.furs', 9)).toBe(5);
    expect(holdUsed(hold)).toBe(5);
  });

  it('weighs a full hold of ore heavier than one of furs', () => {
    expect(holdLoad01(defs, [{ good: 'good.iron_ore', qty: 20 }], 20)).toBe(1);
    expect(holdLoad01(defs, [{ good: 'good.furs', qty: 20 }], 20)).toBeCloseTo(0.3);
    expect(holdLoad01(defs, [], 20)).toBe(0);
  });
});

describe('the hold on the ship (plan 02 §3, §6.1)', () => {
  it('sits a loaded schooner deeper and slows her by up to a fifth', () => {
    const record = sailShipRecord(T1_SCHOONER_ID);
    const c = compileHazardClass(record, defaultHazardRules());
    const step = (cargo01: number) => {
      const s = createSailingState(0, 0, 0);
      const h = { ...createHazardState(c), cargo01 };
      const env = { terrain: undefined, docks: [], berths: [] };
      const wind = { fromRad: Math.PI / 2, speedKn: 10, gust01: 0 };
      stepHazards(s, h, c, IDLE_MOORING, env, { x: 0, z: 0, heading: 0 }, wind, SCALE, 1 / 30);
      return { s, h };
    };
    const empty = step(0);
    const full = step(1);
    expect(empty.h.draft).toBeCloseTo(record.draftEmptyM);
    expect(full.h.draft).toBeCloseTo(record.draftFullM);
    expect(full.s.loadFactor).toBeCloseTo(empty.s.loadFactor * 0.8);
  });
});

describe('the economy in the game (piece A)', () => {
  const context = (): GameContext => {
    const state = createWorldState('economy-test');
    return { state, events: new EventBus<GameEvents>() } as unknown as GameContext;
  };

  it('starts a run as a Deckhand with $150 and rope and canvas', () => {
    const { state } = context();
    expect(state.player.purse).toBe(15_000);
    expect(state.player.cargo).toEqual([{ good: 'good.rope_canvas', qty: 5 }]);
    expect(Object.keys(state.markets)).toHaveLength(7);
  });

  it('raises TradeCompleted, sets the load, and ticks markets on WorldTick', () => {
    const ctx = context();
    const { hazards } = createSchooner(0, 0, 0);
    const eco = attachEconomy(ctx, hazards);
    const seen: GameEvents['TradeCompleted'][] = [];
    ctx.events.on('TradeCompleted', (e) => seen.push(e));
    const before = hazards.state.cargo01;
    const r = eco.sell('port.bayfield', 'good.rope_canvas', 5);
    expect(r.ok).toBe(true);
    expect(seen).toHaveLength(1);
    expect(seen[0]?.side).toBe('sell');
    expect(ctx.state.player.purse).toBe(15_000 + must(seen[0]).totalCents);
    expect(hazards.state.cargo01).toBeLessThan(before);
    expect(hazards.state.cargo01).toBe(0);

    const stock = (): number =>
      must(ctx.state.markets['port.bayfield']?.['good.rope_canvas']).stock;
    const dumped = stock();
    ctx.events.emit('WorldTick', { gameSeconds: WORLD_TICK_GAME_SECONDS });
    expect(stock()).toBeLessThan(dumped);
    eco.dispose();
    const after = stock();
    ctx.events.emit('WorldTick', { gameSeconds: 2 * WORLD_TICK_GAME_SECONDS });
    expect(stock()).toBe(after);
  });

  it('raises PriceShock for a market event', () => {
    const ctx = context();
    const eco = attachEconomy(ctx, undefined);
    const seen: GameEvents['PriceShock'][] = [];
    ctx.events.on('PriceShock', (e) => seen.push(e));
    eco.shock('port.bayfield', 'good.salt', 0.2, 'dev');
    expect(seen[0]?.priceAfterCents).toBeGreaterThan(must(seen[0]).priceBeforeCents);
  });
});
