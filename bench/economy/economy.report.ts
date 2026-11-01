import { performance } from 'node:perf_hooks';
import { expect, it } from 'vitest';
import { SECONDS_PER_GAME_DAY, WORLD_TICK_GAME_SECONDS } from '../../src/core/time';
import { cargoCapacity, gameEconomy } from '../../src/sim/economy/defs';
import {
  EconomySim,
  holdForSeason,
  marketViolations,
  passageTable,
  PROFIT_CEILING_CENTS_PER_GAME_DAY,
  PROFIT_CEILING_CENTS_PER_REAL_HOUR,
  runTrader,
} from '../../src/sim/economy/harness';
import { tickMarkets } from '../../src/sim/economy/market';

/**
 * The economy's long balance report (plan 17 §3): the legit bot for ten real hours from
 * each starting port, a deep-purse trader per hull size as the loop hunter, the season
 * hold, a five-year soak, and the market tick's cost. Prints one JSON report.
 */

const defs = gameEconomy();
const legs = passageTable();
const DAWN = 6 * 3600;
const dollars = (cents: number): number => Math.round(cents) / 100;

it('economy balance report', () => {
  const report: Record<string, unknown> = {};

  // Legit pacing (plan 05 §5.3): a Deckhand-sized start, ten real hours of trade alone.
  report['legit'] = ['port.bayfield', 'port.washburn', 'port.duluth', 'port.two_harbors'].map(
    (start) => {
      const run = runTrader(new EconomySim(defs, DAWN), legs, {
        start,
        purse: 15_000,
        cargo: [{ good: 'good.rope_canvas', qty: 5 }],
        capacity: cargoCapacity(),
        realMinutes: 600,
      });
      const at = (min: number): number =>
        (run.timeline.filter((t) => t.realMinutes <= min).at(-1)?.netWorth ?? run.startNetWorth) -
        run.startNetWorth;
      const t2 = run.timeline.find((t) => t.netWorth >= 160_000 - 25_000);
      return {
        start,
        profit30min: dollars(at(30)),
        profit1h: dollars(at(60)),
        profit10h: dollars(run.endNetWorth - run.startNetWorth),
        perRealHour: dollars((run.endNetWorth - run.startNetWorth) / (run.realMinutes / 60)),
        // A T2 at ~$1,600 less a T1 trade-in of ~$250 (plan 10 §3).
        realHoursToT2: t2 ? +(t2.realMinutes / 60).toFixed(1) : null,
        gameDays: +(run.gameSeconds / SECONDS_PER_GAME_DAY).toFixed(1),
      };
    },
  );

  // The loop hunter with each hull's hold and a purse that never runs dry.
  report['loopHunter'] = [20, 45, 90].map((capacity) => {
    const run = runTrader(new EconomySim(defs, DAWN), legs, {
      start: 'port.bayfield',
      purse: 10_000_000,
      capacity,
      realMinutes: 600,
    });
    const profit = run.endNetWorth - run.startNetWorth;
    const perHour = profit / (run.realMinutes / 60);
    const perDay = profit / (run.gameSeconds / SECONDS_PER_GAME_DAY);
    if (capacity === 20) {
      expect(perHour).toBeLessThan(PROFIT_CEILING_CENTS_PER_REAL_HOUR);
      expect(perDay).toBeLessThan(PROFIT_CEILING_CENTS_PER_GAME_DAY);
    }
    return { capacity, perRealHour: dollars(perHour), perGameDay: dollars(perDay) };
  });

  const holds = holdForSeason(defs, DAWN, 20, 120).sort(
    (a, b) => b.profitCents / b.gameDays - a.profitCents / a.gameDays,
  );
  report['seasonHoldTop5'] = holds.slice(0, 5).map((h) => ({
    ...h,
    profitCents: undefined,
    profit: dollars(h.profitCents),
    perGameDay: dollars(h.profitCents / h.gameDays),
  }));

  // Five years of drift with a trader working the lake throughout.
  const soak = new EconomySim(defs, DAWN);
  let violations: string[] = [];
  for (let year = 0; year < 5; year++) {
    runTrader(soak, legs, {
      start: 'port.duluth',
      purse: 1_000_000,
      capacity: 45,
      realMinutes: 60,
    });
    // A year on the season calendar is 52 game days (1 game day = 1 week).
    soak.advance(52 * SECONDS_PER_GAME_DAY);
    violations = violations.concat(marketViolations(soak));
  }
  expect(violations).toEqual([]);
  report['soak'] = { years: 5, ticks: soak.ticks, violations: violations.length };

  // The market tick against the 1 ms world tick budget (plan 01 §5, criterion 11).
  const sim = new EconomySim(defs, DAWN);
  const N = 20_000;
  const t0 = performance.now();
  for (let i = 0; i < N; i++) {
    tickMarkets(defs, sim.markets, DAWN + i * WORLD_TICK_GAME_SECONDS, WORLD_TICK_GAME_SECONDS);
  }
  report['marketTickMs'] = +((performance.now() - t0) / N).toFixed(4);

  console.log(JSON.stringify(report, null, 2));
});
