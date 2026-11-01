import chartJson from '../../../data/chart.json';
import portsJson from '../../../data/ports.json';
import { chartFileSchema } from '../../../data/schemas/chart';
import { portsFileSchema } from '../../../data/schemas/ports';
import { R_SAILING, SECONDS_PER_GAME_DAY, WORLD_TICK_GAME_SECONDS } from '../../core/time';
import type { EconomyDefs } from './defs';
import type { Hold } from './hold';
import {
  applyTrade,
  createMarkets,
  quote,
  tickMarkets,
  unitPrices,
  type MarketsState,
} from './market';
import { buy, maxBuyable, sell, type Trader } from './trade';

/**
 * The economy's balance harness (plan 17 §3, plan 05 §16.3 criteria 2–4): headless bots
 * trading on the real market data against a simple model of how long each passage takes.
 * `tests/economy-balance.test.ts` runs short versions in CI; `npm run bench:economy`
 * runs the long ones and prints a report.
 *
 * - The **legit bot** is an honest trader with perfect price knowledge: at each port it
 *   sells what fetches nearly the best price anywhere, then buys whatever pays best per
 *   real minute of the next passage. Criterion 2: it's ahead in the first 30 minutes.
 * - The **dumping bot** sells a full hold in one port and watches the price come back
 *   (criterion 3).
 * - The **loop hunter** tries to print money (criterion 4): buy-and-sell cycles in one
 *   port, the legit bot with a deep purse run for a season, and holding goods to sell
 *   out of season. Its profit per real hour and per game day must stay under a ceiling.
 */

/** In a zone, 13 nm takes ~4 real minutes (plan 03 §3.3: Bayfield → Ashland). */
const ZONE_NM_PER_REAL_MIN = 13 / 4;
/** On the chart, ~2.5 real seconds per game hour (plan 03 §5.3). */
const CHART_REAL_S_PER_GAME_HOUR = 2.5;
/** A T1 averaging this through a mixed passage, game knots (plan 02 §3). */
const CRUISE_KN = 7;
/** Courses bend around points and islands: sailed distance over the straight line. */
const DETOUR = 1.2;
/** Harbor to the zone's edge, each end of a passage between zones, nm. */
const ZONE_EDGE_NM = 10;
/** Docking, trading and casting off, real minutes. */
const PORT_CALL_REAL_MIN = 2;
const EARTH_RADIUS_NM = 3440.065;

/**
 * The loop hunter's ceiling (plan 17 §3): no trading pattern may clear more than this
 * per real hour, or per game day, without risk. $150 an hour would buy a T2 (~$1,600,
 * plan 10 §2) in about eight hours from trade alone: the bottom of plan 05 §5.3's legit
 * range, which also counts contracts.
 */
export const PROFIT_CEILING_CENTS_PER_REAL_HOUR = 15_000;
export const PROFIT_CEILING_CENTS_PER_GAME_DAY = 15_000;

export interface Passage {
  realMinutes: number;
  gameSeconds: number;
}

/** How long each passage between two ports with markets takes, real and game time. */
export type PassageTable = (from: string, to: string) => Passage;

function haversineNm(a: readonly [number, number], b: readonly [number, number]): number {
  const rad = Math.PI / 180;
  const dLat = (b[1] - a[1]) * rad;
  const dLon = (b[0] - a[0]) * rad;
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(a[1] * rad) * Math.cos(b[1] * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_NM * Math.asin(Math.sqrt(h));
}

/**
 * Passages from the chart's port positions: sailed in a zone at the zone's pace, or out
 * to the zone edge, across the chart at its compression and in again.
 */
export function passageTable(): PassageTable {
  const at = new Map<string, readonly [number, number]>();
  for (const f of chartFileSchema.parse(chartJson)) if (f.kind === 'port') at.set(f.id, f.at);
  const zone = new Map(portsFileSchema.parse(portsJson).map((p) => [p.id, p.zone]));
  const cache = new Map<string, Passage>();
  return (from, to) => {
    const key = `${from}>${to}`;
    const hit = cache.get(key);
    if (hit) return hit;
    const a = at.get(from);
    const b = at.get(to);
    if (!a || !b) throw new Error(`No chart position for ${a ? to : from}`);
    const nm = haversineNm(a, b) * DETOUR;
    let p: Passage;
    if (zone.get(from) === zone.get(to)) {
      const real = nm / ZONE_NM_PER_REAL_MIN + PORT_CALL_REAL_MIN;
      p = { realMinutes: real, gameSeconds: real * 60 * R_SAILING };
    } else {
      const inZone = Math.min(nm, 2 * ZONE_EDGE_NM);
      const chartHours = (nm - inZone) / CRUISE_KN;
      const zoneReal = inZone / ZONE_NM_PER_REAL_MIN + PORT_CALL_REAL_MIN;
      p = {
        realMinutes: zoneReal + (chartHours * CHART_REAL_S_PER_GAME_HOUR) / 60,
        gameSeconds: zoneReal * 60 * R_SAILING + chartHours * 3600,
      };
    }
    cache.set(key, p);
    return p;
  };
}

/** A headless economy: markets and a clock that ticks them like the game does. */
export class EconomySim {
  readonly markets: MarketsState;
  gameSeconds: number;
  private accumulator = 0;
  ticks = 0;

  constructor(
    readonly defs: EconomyDefs,
    startSeconds = 0,
  ) {
    this.gameSeconds = startSeconds;
    this.markets = createMarkets(defs, startSeconds);
  }

  advance(gameSeconds: number): void {
    this.gameSeconds += gameSeconds;
    this.accumulator += gameSeconds;
    while (this.accumulator >= WORLD_TICK_GAME_SECONDS) {
      this.accumulator -= WORLD_TICK_GAME_SECONDS;
      tickMarkets(this.defs, this.markets, this.gameSeconds, WORLD_TICK_GAME_SECONDS);
      this.ticks++;
    }
  }

  ports(): string[] {
    return [...this.defs.markets.keys()];
  }

  sellQuote(port: string, good: string, qty: number): number {
    return quote(this.defs, this.markets, port, good, qty, 'sell', this.gameSeconds).totalCents;
  }

  /** The trader's cash plus its hold at what this port would pay now. */
  netWorth(trader: Trader, port: string): number {
    let w = trader.purse;
    for (const s of trader.cargo) w += this.sellQuote(port, s.good, s.qty);
    return w;
  }
}

export interface TraderRun {
  /** Net worth at each port call: real minutes since the start, cents. */
  timeline: { realMinutes: number; gameSeconds: number; port: string; netWorth: number }[];
  startNetWorth: number;
  endNetWorth: number;
  realMinutes: number;
  gameSeconds: number;
  trades: number;
}

export interface TraderOptions {
  start: string;
  purse: number;
  cargo?: Hold;
  capacity: number;
  /** Stop at the first port call after this much real time. */
  realMinutes: number;
  /** Sell a held good at a port paying at least this share of the best price anywhere. */
  sellShare?: number;
}

interface Plan {
  to: string;
  buys: { good: string; qty: number }[];
  profit: number;
  perMinute: number;
}

/** The best cargo to carry from `from` to `to`, filling the hold greedily good by good. */
function planLeg(
  sim: EconomySim,
  trader: Trader,
  capacity: number,
  from: string,
  to: string,
  realMinutes: number,
): Plan {
  const defs = sim.defs;
  const pmFrom = defs.markets.get(from);
  const pmTo = defs.markets.get(to);
  const plan: Plan = { to, buys: [], profit: 0, perMinute: 0 };
  if (!pmFrom || !pmTo) return plan;
  // A scratch copy so later picks see the earlier ones' room, money and price moves.
  const scratch: Trader = { purse: trader.purse, cargo: trader.cargo.map((s) => ({ ...s })) };
  const markets = structuredClone(sim.markets);
  for (;;) {
    let best: { good: string; qty: number; profit: number } | undefined;
    for (const good of pmFrom.goods.keys()) {
      if (!pmTo.goods.has(good)) continue;
      const max = maxBuyable(defs, markets, scratch, capacity, from, good, sim.gameSeconds);
      // The most profitable quantity: walk up while each extra CU still pays.
      let bestN = 0;
      let bestProfit = 0;
      for (let n = 1; n <= max; n++) {
        const cost = quote(defs, markets, from, good, n, 'buy', sim.gameSeconds).totalCents;
        const revenue = quote(defs, markets, to, good, n, 'sell', sim.gameSeconds).totalCents;
        if (revenue - cost > bestProfit) {
          bestProfit = revenue - cost;
          bestN = n;
        }
      }
      if (bestN > 0 && (!best || bestProfit > best.profit)) {
        best = { good, qty: bestN, profit: bestProfit };
      }
    }
    if (!best) break;
    buy(defs, markets, scratch, capacity, from, best.good, best.qty, sim.gameSeconds);
    // Its sale lands on the destination's stock too, so the next pick of it sees that.
    applyTrade(markets, to, best.good, best.qty, 'sell', sim.gameSeconds);
    plan.buys.push({ good: best.good, qty: best.qty });
    plan.profit += best.profit;
  }
  plan.perMinute = plan.profit / realMinutes;
  return plan;
}

/** The legit bot (plan 17 §3 "legit trader"). */
export function runTrader(sim: EconomySim, legs: PassageTable, o: TraderOptions): TraderRun {
  const defs = sim.defs;
  const trader: Trader = { purse: o.purse, cargo: (o.cargo ?? []).map((s) => ({ ...s })) };
  const sellShare = o.sellShare ?? 0.95;
  const ports = sim.ports();
  let port = o.start;
  let real = 0;
  const startGame = sim.gameSeconds;
  let trades = 0;
  const startNetWorth = sim.netWorth(trader, port);
  const timeline: TraderRun['timeline'] = [];
  const boughtFor = new Set<string>();

  for (;;) {
    // Sell what was bought for this port, and anything else that fetches close to the
    // best price on the lake here.
    for (const stack of [...trader.cargo]) {
      const here = sim.sellQuote(port, stack.good, stack.qty);
      if (here <= 0) continue;
      const best = Math.max(...ports.map((p) => sim.sellQuote(p, stack.good, stack.qty)));
      if (boughtFor.has(stack.good) || here >= best * sellShare) {
        if (sell(defs, sim.markets, trader, port, stack.good, stack.qty, sim.gameSeconds).ok)
          trades++;
      }
    }
    timeline.push({
      realMinutes: real,
      gameSeconds: sim.gameSeconds - startGame,
      port,
      netWorth: sim.netWorth(trader, port),
    });
    if (real >= o.realMinutes) break;

    // Pick the passage that pays best per real minute, counting what's already aboard.
    let best: Plan | undefined;
    for (const to of ports) {
      if (to === port) continue;
      const leg = legs(port, to);
      const plan = planLeg(sim, trader, o.capacity, port, to, leg.realMinutes);
      let carried = 0;
      for (const s of trader.cargo) {
        carried += sim.sellQuote(to, s.good, s.qty) - sim.sellQuote(port, s.good, s.qty);
      }
      plan.profit += Math.max(0, carried);
      plan.perMinute = plan.profit / leg.realMinutes;
      if (!best || plan.perMinute > best.perMinute) best = plan;
    }
    if (!best) break;
    boughtFor.clear();
    for (const b of best.buys) {
      boughtFor.add(b.good);
      if (buy(defs, sim.markets, trader, o.capacity, port, b.good, b.qty, sim.gameSeconds).ok)
        trades++;
    }
    const leg = legs(port, best.to);
    sim.advance(leg.gameSeconds);
    real += leg.realMinutes;
    port = best.to;
  }

  const last = timeline[timeline.length - 1];
  return {
    timeline,
    startNetWorth,
    endNetWorth: last?.netWorth ?? startNetWorth,
    realMinutes: real,
    gameSeconds: sim.gameSeconds - startGame,
    trades,
  };
}

export interface DumpResult {
  port: string;
  good: string;
  qty: number;
  /** The next CU's sale price before and right after the dump, cents. */
  beforeCents: number;
  afterCents: number;
  /** Share of the price the dump took off. */
  drop: number;
  /** Game days until the sale price is back within 5% of where it was; Infinity if never. */
  recoveryDays: number;
}

/** The dumping bot: a full hold of one good sold at once, then the wait for recovery. */
export function dumpHold(
  sim: EconomySim,
  port: string,
  good: string,
  qty: number,
  maxDays = 60,
): DumpResult {
  const price = (): number =>
    unitPrices(sim.defs, sim.markets, port, good, sim.gameSeconds)?.sellCents ?? 0;
  const before = price();
  const trader: Trader = { purse: 0, cargo: [{ good, qty }] };
  const r = sell(sim.defs, sim.markets, trader, port, good, qty, sim.gameSeconds);
  if (!r.ok) throw new Error(`Dump refused: ${r.reason}`);
  const after = price();
  let days = Infinity;
  for (let d = 1; d <= maxDays * 24; d++) {
    sim.advance(3600);
    if (price() >= before * 0.95) {
      days = d / 24;
      break;
    }
  }
  return {
    port,
    good,
    qty,
    beforeCents: before,
    afterCents: after,
    drop: 1 - after / before,
    recoveryDays: days,
  };
}

export interface CycleResult {
  port: string;
  good: string;
  qty: number;
  /** Cycles the port could fill. */
  cycles: number;
  /** Purse change over every cycle, cents; must be negative. */
  net: number;
  /** True when every single cycle lost money. */
  everyCycleLost: boolean;
}

/**
 * The loop hunter's first test: buy n CU and sell them straight back (and sell n then buy
 * them back), over and over in one port, with time standing still between.
 */
export function cycleInPort(
  sim: EconomySim,
  port: string,
  good: string,
  qty: number,
  cycles: number,
  capacity: number,
): CycleResult {
  const trader: Trader = { purse: 10_000_000, cargo: [] };
  const start = trader.purse;
  let everyCycleLost = true;
  let traded = 0;
  for (let i = 0; i < cycles; i++) {
    const before = trader.purse;
    const sellFirst = i % 2 === 1;
    let ok: boolean;
    if (sellFirst) {
      trader.cargo.push({ good, qty });
      ok = sell(sim.defs, sim.markets, trader, port, good, qty, sim.gameSeconds).ok;
      ok = ok && buy(sim.defs, sim.markets, trader, capacity, port, good, qty, sim.gameSeconds).ok;
      trader.cargo.length = 0;
    } else {
      ok = buy(sim.defs, sim.markets, trader, capacity, port, good, qty, sim.gameSeconds).ok;
      ok = ok && sell(sim.defs, sim.markets, trader, port, good, qty, sim.gameSeconds).ok;
    }
    // A cycle the port couldn't fill (too little stock to buy) proves nothing either way.
    if (!ok) continue;
    traded++;
    if (trader.purse >= before) everyCycleLost = false;
  }
  return { port, good, qty, cycles: traded, net: trader.purse - start, everyCycleLost };
}

export interface HoldResult {
  port: string;
  good: string;
  profitCents: number;
  gameDays: number;
}

/**
 * The loop hunter's season play: fill the hold with a good where and when it's cheapest
 * in its own season, lie at anchor (time passes, little real time) until it's dearest,
 * and sell in the same port. Tried for every port and good.
 */
export function holdForSeason(
  defs: EconomyDefs,
  startSeconds: number,
  capacity: number,
  gameDays: number,
): HoldResult[] {
  const out: HoldResult[] = [];
  for (const [port, pm] of defs.markets) {
    for (const good of pm.goods.keys()) {
      const sim = new EconomySim(defs, startSeconds);
      const trader: Trader = { purse: 10_000_000, cargo: [] };
      const n = maxBuyable(defs, sim.markets, trader, capacity, port, good, sim.gameSeconds);
      if (n <= 0) continue;
      buy(defs, sim.markets, trader, capacity, port, good, n, sim.gameSeconds);
      const spent = 10_000_000 - trader.purse;
      let best = -Infinity;
      let bestDay = 0;
      for (let d = 1; d <= gameDays; d++) {
        sim.advance(SECONDS_PER_GAME_DAY);
        const v = sim.sellQuote(port, good, n) - spent;
        if (v > best) {
          best = v;
          bestDay = d;
        }
      }
      out.push({ port, good, profitCents: best, gameDays: bestDay });
    }
  }
  return out;
}

/** Every price and stock in range (plan 05 §16.3 criterion 4): the soak's check. */
export function marketViolations(sim: EconomySim): string[] {
  const bad: string[] = [];
  const r = sim.defs.rules;
  for (const [port, pm] of sim.defs.markets) {
    for (const [good, mg] of pm.goods) {
      const s = sim.markets[port]?.[good];
      const p = unitPrices(sim.defs, sim.markets, port, good, sim.gameSeconds);
      if (!s || !p || !Number.isFinite(s.stock) || s.stock < 0) {
        bad.push(`${port} ${good}: stock ${s?.stock}`);
        continue;
      }
      // Seasonal demand scales the clamp; every demand factor in the data is at least 1.
      const demand = Math.max(1, ...Object.values(mg.good.seasonPrice ?? {}));
      const lo = mg.basePriceCents * r.clampMin * 0.99;
      const hi = mg.basePriceCents * r.clampMax * demand * 1.01;
      if (p.midCents < lo || p.midCents > hi) bad.push(`${port} ${good}: ${p.midCents}¢`);
    }
  }
  return bad;
}
