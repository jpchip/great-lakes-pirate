import type { MarketDef } from '../../../data/schemas/markets';
import { Rng } from '../../core/rng';
import { dayAndHour, SECONDS_PER_GAME_DAY } from '../../core/time';
import { portInfo, type EconomyDefs } from './defs';
import type { CargoStack, Hold, HotMeta } from './hold';
import { applyTrade, quote, type MarketsState } from './market';
import type { Trader } from './trade';

/**
 * Hot goods and contraband at an honest merchant's (plan 05 §6.1, §6.3; Phase 4 piece H).
 *
 * - **Heat cools.** A stolen lot's heat halves every few weeks (a game day is a calendar
 *   week), and away from the region it was taken in, goods with no marks on them are
 *   soon just goods. Company-marked crates and stamped ingots stay recognizable.
 * - **Offering a lot rolls detection.** The chance rises with the lot's heat and
 *   traceability, with how alert the port's merchants are (a big port's more than a
 *   village's) and a little with the size of the lot. Contraband is always risky.
 * - **Detected, the merchant refuses or confiscates.** Either way the port's merchants
 *   won't look at anything of the kind from you again that week, and the caller raises
 *   `HotGoodsDetected` for Phase 5 to turn into Wanted. Nothing in Phase 4 gets you
 *   caught (§16.5).
 * - **Undetected, it sells.** A hot lot sells at the market's price like clean goods; a
 *   contraband lot sells on the quiet at most of its saloon value, without touching the
 *   market (contraband isn't listed anywhere).
 *
 * The roll is a pure function of the run, the port, the good, the lot and the week, so
 * offering the same lot again in the same week gives the same answer.
 */

export type OfferKind = 'hot' | 'contraband';

export interface DetectionRules {
  /** Weeks for a lot's heat to halve. */
  heatHalfLifeWeeks: number;
  /**
   * Out of the region it was taken in, what's left of the chance for a good with no marks
   * on it (traceability 0); fully traceable goods keep all of it.
   */
  otherRegion: number;
  /** How alert the port's merchants are, by its market's size (0–1). */
  merchant: Record<MarketDef['size'], number>;
  /** A hot lot's chance at an alert merchant: `hotBase` + `hotHeat` × heat × marks. */
  hotBase: number;
  hotHeat: number;
  /** A contraband lot's chance at an alert merchant. */
  contraband: number;
  /** Each CU past the first adds this share to the chance, up to `maxLotFactor`. */
  perExtraCu: number;
  maxLotFactor: number;
  maxChance: number;
  /** Of the detected: the share the merchant keeps (contraband; hot is `confiscateHot` + `confiscateHeat` × heat). */
  confiscateContraband: number;
  confiscateHot: number;
  confiscateHeat: number;
  /** On the quiet, a merchant pays this share of contraband's base value, less the port's spread. */
  contrabandSale: number;
}

export function defaultDetectionRules(): DetectionRules {
  return {
    heatHalfLifeWeeks: 3,
    otherRegion: 0.15,
    merchant: { huge: 1, large: 0.9, medium: 0.8, small: 0.65, tiny: 0.5 },
    hotBase: 0.1,
    hotHeat: 0.8,
    contraband: 0.6,
    perExtraCu: 0.02,
    maxLotFactor: 1.4,
    maxChance: 0.95,
    confiscateContraband: 0.5,
    confiscateHot: 0.25,
    confiscateHeat: 0.5,
    contrabandSale: 0.85,
  };
}

const RULES = defaultDetectionRules();

/** The calendar week a moment falls in: one game day (plan 04 §3.3). */
export function weekOf(gameSeconds: number): number {
  return dayAndHour(Math.max(gameSeconds, 0)).day;
}

/** A lot's heat now, 0–1: it halves every `heatHalfLifeWeeks` since the theft. */
export function heatNow(hot: HotMeta, gameSeconds: number, rules = RULES): number {
  const weeks = Math.max(0, gameSeconds - hot.since) / SECONDS_PER_GAME_DAY;
  return hot.heat * 0.5 ** (weeks / rules.heatHalfLifeWeeks);
}

function lotFactor(qty: number, rules: DetectionRules): number {
  return Math.min(rules.maxLotFactor, 1 + rules.perExtraCu * Math.max(0, qty - 1));
}

/**
 * The chance that offering a lot to a port's merchant is found out, 0–1. Clean goods and
 * contract cargo never are (contract theft is piece F's).
 */
export function detectionChance(
  defs: EconomyDefs,
  stack: CargoStack,
  port: string,
  gameSeconds: number,
  rules = RULES,
): number {
  const kind = offerKind(defs, stack);
  const market = defs.markets.get(port);
  if (!kind || !market) return 0;
  const alert = rules.merchant[market.def.size];
  const lot = lotFactor(stack.qty, rules);
  let p: number;
  if (kind === 'contraband') {
    p = rules.contraband * alert * lot;
  } else {
    const hot = stack.hot as HotMeta;
    const marks = 0.4 + 0.6 * hot.traceability;
    const here = portInfo(port)?.wantedRegion === hot.region;
    const region = here ? 1 : rules.otherRegion + (1 - rules.otherRegion) * hot.traceability;
    p =
      (rules.hotBase + rules.hotHeat * heatNow(hot, gameSeconds, rules) * marks) *
      region *
      alert *
      lot;
  }
  return Math.min(rules.maxChance, Math.max(0, p));
}

/** Hot (stolen) or contraband (illegal to sell openly), or neither. Hot wins. */
export function offerKind(defs: EconomyDefs, stack: CargoStack): OfferKind | undefined {
  if (stack.contract) return undefined;
  if (stack.hot) return 'hot';
  return defs.goods.get(stack.good)?.legal === 'contraband' ? 'contraband' : undefined;
}

/** A plain word for a chance, for the screen: the number stays hidden. */
export function riskWord(chance: number): string {
  if (chance < 0.15) return 'little risk';
  if (chance < 0.35) return 'some risk';
  if (chance < 0.6) return 'risky';
  return 'very risky';
}

/** What an undetected contraband lot fetches on the quiet here, cents. */
export function quietSaleCents(
  defs: EconomyDefs,
  port: string,
  good: string,
  qty: number,
  rules = RULES,
): number {
  const g = defs.goods.get(good);
  const market = defs.markets.get(port);
  if (!g || !market) return 0;
  return Math.floor(g.basePriceCents * rules.contrabandSale * (1 - market.spread)) * qty;
}

/** Ports whose merchants turned you away, by port: the week they did. */
export type Refusals = Record<string, number>;

export type OfferOutcome = 'sold' | 'refused' | 'confiscated';

export type OfferRefusal = 'badLot' | 'notTraded' | 'turnedAway';

/** What `HotGoodsDetected` carries (plan 05 §6.1; Phase 5 turns it into Wanted). */
export interface HotGoodsDetectedEvent {
  port: string;
  /** The port's Wanted region. */
  region: string | undefined;
  good: string;
  qty: number;
  kind: OfferKind;
  outcome: 'refused' | 'confiscated';
  /** The lot's heat when offered (0 for contraband). */
  heat: number;
}

export type OfferResult =
  | {
      ok: true;
      outcome: 'sold';
      kind: OfferKind;
      good: string;
      qty: number;
      totalCents: number;
    }
  | {
      ok: true;
      outcome: 'refused' | 'confiscated';
      kind: OfferKind;
      good: string;
      qty: number;
      event: HotGoodsDetectedEvent;
    }
  | { ok: false; reason: OfferRefusal };

/** The two rolls for an offer, 0–1: found out, then kept. Same lot, same week, same rolls. */
export function offerRolls(
  runSeed: string,
  port: string,
  stack: CargoStack,
  gameSeconds: number,
): [number, number] {
  const rng = Rng.fromSeed(
    `${runSeed}|offer|${port}|${stack.good}|${stack.hot?.since ?? 'contraband'}|${weekOf(gameSeconds)}`,
  );
  return [rng.next(), rng.next()];
}

/**
 * Offers a whole lot (one stack of the hold) to the port's merchants. Sold: the purse is
 * paid and a hot lot moves the market like any sale. Refused: the lot stays aboard.
 * Confiscated: it's gone. Either detection marks the port as having turned you away for
 * the week.
 */
export function offerLot(
  defs: EconomyDefs,
  markets: MarketsState,
  trader: Trader,
  refusals: Refusals,
  port: string,
  stackIndex: number,
  gameSeconds: number,
  runSeed: string,
  rules = RULES,
): OfferResult {
  const stack = trader.cargo[stackIndex];
  const kind = stack ? offerKind(defs, stack) : undefined;
  if (!stack || !kind) return { ok: false, reason: 'badLot' };
  const market = defs.markets.get(port);
  if (!market) return { ok: false, reason: 'notTraded' };
  if (kind === 'hot' && !market.goods.has(stack.good)) return { ok: false, reason: 'notTraded' };
  if (refusals[port] === weekOf(gameSeconds)) return { ok: false, reason: 'turnedAway' };

  const chance = detectionChance(defs, stack, port, gameSeconds, rules);
  const [found, kept] = offerRolls(runSeed, port, stack, gameSeconds);
  const { good, qty } = stack;
  if (found >= chance) {
    let totalCents: number;
    if (kind === 'hot') {
      totalCents = quote(defs, markets, port, good, qty, 'sell', gameSeconds).totalCents;
      applyTrade(markets, port, good, qty, 'sell', gameSeconds);
    } else {
      totalCents = quietSaleCents(defs, port, good, qty, rules);
    }
    trader.cargo.splice(stackIndex, 1);
    trader.purse += totalCents;
    return { ok: true, outcome: 'sold', kind, good, qty, totalCents };
  }
  const heat = stack.hot ? heatNow(stack.hot, gameSeconds, rules) : 0;
  const keepShare =
    kind === 'contraband'
      ? rules.confiscateContraband
      : rules.confiscateHot + rules.confiscateHeat * heat;
  const outcome = kept < keepShare ? 'confiscated' : 'refused';
  if (outcome === 'confiscated') trader.cargo.splice(stackIndex, 1);
  refusals[port] = weekOf(gameSeconds);
  return {
    ok: true,
    outcome,
    kind,
    good,
    qty,
    event: {
      port,
      region: portInfo(port)?.wantedRegion,
      good,
      qty,
      kind,
      outcome,
      heat,
    },
  };
}

/**
 * Marks clean goods in the hold hot (the dev command, until Phase 6's theft does it): up
 * to `qty` CU of a good, as if taken now in `region`. Returns how many CU it marked.
 */
export function makeHot(
  defs: EconomyDefs,
  hold: Hold,
  good: string,
  qty: number,
  region: string,
  gameSeconds: number,
  heat = 1,
): number {
  const g = defs.goods.get(good);
  if (!g) return 0;
  let left = Math.max(0, Math.floor(qty));
  let marked = 0;
  for (let i = hold.length - 1; i >= 0 && left > 0; i--) {
    const s = hold[i] as CargoStack;
    if (s.good !== good || s.hot || s.contract) continue;
    const take = Math.min(s.qty, left);
    s.qty -= take;
    left -= take;
    marked += take;
    if (s.qty === 0) hold.splice(i, 1);
  }
  if (marked > 0) {
    hold.push({
      good,
      qty: marked,
      hot: {
        region,
        heat: Math.min(1, Math.max(0, heat)),
        traceability: g.traceability,
        since: gameSeconds,
      },
    });
  }
  return marked;
}
