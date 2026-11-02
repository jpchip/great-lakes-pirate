import { dayAndHour } from '../../core/time';
import type { EconomyDefs } from './defs';
import { unitPrices, type MarketsState } from './market';

/**
 * What the captain knows of prices (plan 05 §4.3, §11 `knowledge.prices`; Phase 4 piece
 * B). You only see current prices in the port you're in; every other port is what you saw
 * there last, with the date. Each visit to a market writes down all its prices. Rumors
 * and hails (pieces D and K) write here too.
 */

/** One good's prices at one port when last seen, cents per CU. */
export interface SeenPrice {
  /** What the port asked for a CU: your buying price. */
  buyCents: number;
  /** What the port paid for a CU: your selling price. */
  sellCents: number;
  /** Game seconds when seen. */
  seenAt: number;
  /** Heard, not seen with your own eyes (piece K): a rumor's or a hailed ship's. */
  heard?: 'rumor' | 'hail' | undefined;
}

export type PriceKnowledge = Record<string, Record<string, SeenPrice>>;

/** Writes down every price at the port's market as of now. */
export function recordPrices(
  knowledge: PriceKnowledge,
  defs: EconomyDefs,
  markets: MarketsState,
  portId: string,
  gameSeconds: number,
): void {
  const pm = defs.markets.get(portId);
  if (!pm) return;
  const book = (knowledge[portId] = {} as Record<string, SeenPrice>);
  for (const goodId of pm.goods.keys()) {
    const p = unitPrices(defs, markets, portId, goodId, gameSeconds);
    if (p) book[goodId] = { buyCents: p.buyCents, sellCents: p.sellCents, seenAt: gameSeconds };
  }
}

/** Whole game days (calendar weeks) since a price was seen. */
export function weeksSince(seenAt: number, gameSeconds: number): number {
  return Math.max(0, dayAndHour(gameSeconds).day - dayAndHour(seenAt).day);
}

/** Prices this many weeks old or more are stale: shown in fog gray (plan 13 §2.2). */
export const STALE_WEEKS = 4;

/** "this week", "last week", "3 weeks ago". */
export function ageText(seenAt: number, gameSeconds: number): string {
  const w = weeksSince(seenAt, gameSeconds);
  if (w === 0) return 'this week';
  if (w === 1) return 'last week';
  return `${w} weeks ago`;
}

export interface ElsewherePrice extends SeenPrice {
  port: string;
}

/**
 * The best price you know of for selling a good anywhere but here: what the trade screen
 * compares against. Newer wins a tie.
 */
export function bestKnownSale(
  knowledge: PriceKnowledge,
  goodId: string,
  exceptPort: string,
): ElsewherePrice | undefined {
  let best: ElsewherePrice | undefined;
  for (const [port, book] of Object.entries(knowledge)) {
    if (port === exceptPort) continue;
    const seen = book[goodId];
    if (!seen) continue;
    if (
      !best ||
      seen.sellCents > best.sellCents ||
      (seen.sellCents === best.sellCents && seen.seenAt > best.seenAt)
    ) {
      best = { ...seen, port };
    }
  }
  return best;
}

/** The cheapest place you know of to buy a good, other than here. */
export function bestKnownPurchase(
  knowledge: PriceKnowledge,
  goodId: string,
  exceptPort: string,
): ElsewherePrice | undefined {
  let best: ElsewherePrice | undefined;
  for (const [port, book] of Object.entries(knowledge)) {
    if (port === exceptPort) continue;
    const seen = book[goodId];
    if (!seen) continue;
    if (
      !best ||
      seen.buyCents < best.buyCents ||
      (seen.buyCents === best.buyCents && seen.seenAt > best.seenAt)
    ) {
      best = { ...seen, port };
    }
  }
  return best;
}

/** "$12.40", or "$12" for whole dollars when `short`. */
export function formatCents(cents: number, short = false): string {
  const sign = cents < 0 ? '-' : '';
  const abs = Math.abs(Math.round(cents));
  const dollars = Math.floor(abs / 100);
  const rest = abs % 100;
  const whole = dollars.toLocaleString('en-US');
  if (short && rest === 0) return `${sign}$${whole}`;
  return `${sign}$${whole}.${String(rest).padStart(2, '0')}`;
}
