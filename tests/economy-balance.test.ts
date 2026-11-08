import { describe, expect, it } from 'vitest';
import { SECONDS_PER_GAME_DAY } from '../src/core/time';
import { balanceHarnessEconomy, cargoCapacity, gameEconomy } from '../src/sim/economy/defs';
import {
  cycleInPort,
  dumpHold,
  EconomySim,
  holdForSeason,
  marketViolations,
  passageTable,
  PROFIT_CEILING_CENTS_PER_GAME_DAY,
  PROFIT_CEILING_CENTS_PER_REAL_HOUR,
  RED_CLIFF_PROFIT_CEILING_CENTS_PER_REAL_HOUR,
  RED_CLIFF_T2_MIN_REAL_HOURS,
  runTrader,
} from '../src/sim/economy/harness';
import { buy, sell, type Trader } from '../src/sim/economy/trade';
import { Rng } from '../src/core/rng';
import { gameContracts } from '../src/sim/economy/contracts';

/**
 * The balance harness, short (plan 17 §3; plan 05 §16.3 criteria 2–4). The long runs are
 * `npm run bench:economy`.
 */

const defs = balanceHarnessEconomy();
const legs = passageTable();
const T1 = cargoCapacity();
const DAWN = 6 * 3600;

function must<T>(value: T | undefined | null): T {
  if (value === undefined || value === null) throw new Error('missing value');
  return value;
}

/** The four Phase 4 starting ports (plan 12 §2.2) and a Deckhand-sized start. */
const STARTS = ['port.bayfield', 'port.washburn', 'port.duluth', 'port.two_harbors'];

describe('the legit bot (criterion 2)', () => {
  it.each(STARTS)('is ahead within the first 30 real minutes from %s', (start) => {
    const sim = new EconomySim(defs, DAWN);
    const run = runTrader(sim, legs, {
      start,
      purse: 15_000,
      cargo: [{ good: 'good.rope_canvas', qty: 5 }],
      capacity: T1,
      realMinutes: 30,
    });
    // The first call, at most a few passages in, already shows the profit.
    const at30 = must(run.timeline.filter((t) => t.realMinutes <= 30).at(-1));
    expect(at30.netWorth).toBeGreaterThan(run.startNetWorth);
  });

  it('makes plan 05 §5.1 money on its first runs: about $20–60 a passage', () => {
    const sim = new EconomySim(defs, DAWN);
    const run = runTrader(sim, legs, {
      start: 'port.bayfield',
      purse: 15_000,
      capacity: T1,
      realMinutes: 30,
    });
    const gains = run.timeline.slice(1).map((t, i) => t.netWorth - must(run.timeline[i]).netWorth);
    const mean = gains.reduce((a, b) => a + b, 0) / gains.length;
    expect(mean).toBeGreaterThan(2_000);
    expect(mean).toBeLessThan(6_000);
  });
});

describe('the contracts bot (plan 05 §5.3)', () => {
  /** A T2 at ~$1,600 less a T1 trade-in of ~$250 (plan 10 §3), as the long report counts it. */
  const T2_NET_WORTH = 160_000 - 25_000;

  it.each(['port.bayfield', 'port.duluth'])(
    'affords a T2 on the legit path in 8–12 real hours from %s, sooner than trade alone',
    (start) => {
      const o = {
        start,
        purse: 15_000,
        cargo: [{ good: 'good.rope_canvas', qty: 5 }],
        capacity: T1,
        realMinutes: 13 * 60,
      };
      const run = runTrader(new EconomySim(defs, DAWN), legs, {
        ...o,
        contracts: { defs: gameContracts(), seed: `ci-${start}` },
      });
      const t2 = must(run.timeline.find((t) => t.netWorth >= T2_NET_WORTH));
      expect(t2.realMinutes / 60).toBeGreaterThanOrEqual(8);
      expect(t2.realMinutes / 60).toBeLessThanOrEqual(12);
      const c = must(run.contracts);
      expect(c.tally.delivered).toBeGreaterThan(20);
      expect(c.tally.failed + c.tally.late).toBe(0);
      // Trade alone is slower over the same hours.
      const trade = runTrader(new EconomySim(defs, DAWN), legs, o);
      expect(trade.endNetWorth).toBeLessThan(run.endNetWorth);
    },
    30_000,
  );

  it('stays under the profit ceiling with a deep purse and a 45 CU hold', () => {
    const run = runTrader(new EconomySim(defs, DAWN), legs, {
      start: 'port.bayfield',
      purse: 1_000_000,
      capacity: 45,
      realMinutes: 360,
      contracts: { defs: gameContracts(), seed: 'ci-ceiling' },
    });
    const profit = run.endNetWorth - run.startNetWorth;
    expect(profit / (run.realMinutes / 60)).toBeLessThan(PROFIT_CEILING_CENTS_PER_REAL_HOUR);
    expect(profit / (run.gameSeconds / SECONDS_PER_GAME_DAY)).toBeLessThan(
      PROFIT_CEILING_CENTS_PER_GAME_DAY,
    );
  }, 30_000);
});

describe('the dumping bot (criterion 3)', () => {
  it('crashes an importing port with a full T1 hold, and the price comes back in weeks', () => {
    const d = dumpHold(new EconomySim(defs, DAWN), 'port.bayfield', 'good.flour', T1);
    expect(d.drop).toBeGreaterThan(0.2);
    // Each game day is a calendar week on the season calendar.
    expect(d.recoveryDays).toBeGreaterThan(1);
    expect(d.recoveryDays).toBeLessThan(10);
  });

  it('crashes a tiny port hardest', () => {
    const tiny = dumpHold(new EconomySim(defs, DAWN), 'port.la_pointe', 'good.coal', T1);
    const huge = dumpHold(new EconomySim(defs, DAWN), 'port.duluth', 'good.lumber', T1);
    expect(tiny.drop).toBeGreaterThan(huge.drop);
  });
});

describe('the loop hunter (criterion 4)', () => {
  it('loses money on every buy-and-sell cycle in every port and good', () => {
    for (const [port, pm] of defs.markets) {
      for (const good of pm.goods.keys()) {
        for (const qty of [1, 5, T1]) {
          const r = cycleInPort(new EconomySim(defs, DAWN), port, good, qty, 6, T1);
          expect(r.everyCycleLost, `${port} ${good} ×${qty}`).toBe(true);
          // Every port can fill a small cycle; a full hold may outrun a tiny port's stock.
          if (qty === 1) expect(r.cycles).toBe(6);
          if (r.cycles > 0) expect(r.net).toBeLessThan(0);
        }
      }
    }
  });

  it.each([T1, 45])(
    'stays under the profit ceiling trading with a deep purse and a %i CU hold',
    (capacity) => {
      const sim = new EconomySim(defs, DAWN);
      const run = runTrader(sim, legs, {
        start: 'port.bayfield',
        purse: 1_000_000,
        capacity,
        realMinutes: 360,
      });
      const profit = run.endNetWorth - run.startNetWorth;
      expect(profit).toBeGreaterThan(0);
      expect(profit / (run.realMinutes / 60)).toBeLessThan(PROFIT_CEILING_CENTS_PER_REAL_HOUR);
      expect(profit / (run.gameSeconds / SECONDS_PER_GAME_DAY)).toBeLessThan(
        PROFIT_CEILING_CENTS_PER_GAME_DAY,
      );
    },
  );

  it('cannot get rich holding a hold of anything for its dear season', () => {
    for (const r of holdForSeason(defs, DAWN, T1, 40)) {
      expect(r.profitCents / Math.max(r.gameDays, 1), `${r.port} ${r.good}`).toBeLessThan(
        PROFIT_CEILING_CENTS_PER_GAME_DAY,
      );
    }
    // Every port and good for 40 game days: ~4 s alone, over vitest's 5 s on a busy runner.
  }, 20_000);
});

describe('Red Cliff seasonal bargain (plan 05 §26.5)', () => {
  const rich = gameEconomy();
  const T2_NET_WORTH = 160_000 - 25_000;

  it('stays under the Red Cliff profit ceiling with a deep purse', () => {
    const run = runTrader(new EconomySim(rich, DAWN), legs, {
      start: 'port.bayfield',
      purse: 1_000_000,
      capacity: T1,
      realMinutes: 360,
    });
    const profit = run.endNetWorth - run.startNetWorth;
    expect(profit / (run.realMinutes / 60)).toBeLessThan(
      RED_CLIFF_PROFIT_CEILING_CENTS_PER_REAL_HOUR,
    );
  });

  it('reaches a T2 no sooner than the Red Cliff floor from Bayfield on trade alone', () => {
    const run = runTrader(new EconomySim(rich, DAWN), legs, {
      start: 'port.bayfield',
      purse: 15_000,
      cargo: [{ good: 'good.rope_canvas', qty: 5 }],
      capacity: T1,
      realMinutes: 13 * 60,
    });
    const t2 = must(run.timeline.find((t) => t.netWorth >= T2_NET_WORTH));
    expect(t2.realMinutes / 60).toBeGreaterThanOrEqual(RED_CLIFF_T2_MIN_REAL_HOURS);
  }, 30_000);
});

describe('the economy soak (criterion 4, short)', () => {
  it('keeps every price in its clamp and every stock sane through two seasons of random trade', () => {
    const sim = new EconomySim(defs, DAWN);
    const rng = Rng.fromSeed('soak');
    const ports = sim.ports();
    const trader: Trader = { purse: 10_000_000, cargo: [] };
    for (let day = 0; day < 30; day++) {
      for (let i = 0; i < 20; i++) {
        const port = must(ports[rng.int(0, ports.length - 1)]);
        const goods = [...must(defs.markets.get(port)).goods.keys()];
        const good = must(goods[rng.int(0, goods.length - 1)]);
        const qty = rng.int(1, 20);
        if (rng.next() < 0.5)
          buy(defs, sim.markets, trader, 1_000, port, good, qty, sim.gameSeconds);
        else {
          trader.cargo.push({ good, qty });
          sell(defs, sim.markets, trader, port, good, qty, sim.gameSeconds);
        }
      }
      sim.advance(SECONDS_PER_GAME_DAY);
      expect(marketViolations(sim)).toEqual([]);
    }
  });
});
