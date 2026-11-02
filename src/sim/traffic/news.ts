import portsJson from '../../../data/ports.json';
import { portsFileSchema } from '../../../data/schemas/ports';
import { calendarDate, SECONDS_PER_GAME_DAY } from '../../core/time';
import { cycleS, cycleStartS, hash01, sailsInCycle } from '../chart/routes';
import { daylight, type Contact } from '../chart/traffic';
import type { EconomyDefs } from '../economy/defs';
import { unitPrices, type MarketsState } from '../economy/market';
import { currentManifest, manifestFor, type Manifest, type TrafficDefs } from './cargo';

/**
 * "Look her over" and hailing (plan 05 §8.1, §9; Phase 4 piece D). Looking a ship over
 * reads her manifest and owner. Hailing her in daylight trades news: what her last port
 * was paying, with the day she left it, and a rumor from the live sim: another ship's
 * sailing (a shipment tip, the seed of piece K's rumors).
 */

/** Daylight 0–1 above which a hail is answered. */
export const HAIL_DAYLIGHT = 0.5;

export interface PriceNews {
  port: string;
  /** When she left it: the prices are as of then, for the ledger (piece B). */
  seenAt: number;
  prices: { good: string; buyCents: number; sellCents: number }[];
}

export interface HailNews {
  shipId: string;
  prices: PriceNews | undefined;
  /** One line of talk; undefined when she has nothing to say. */
  rumor: string | undefined;
  /** For the ledger: what the rumor is about. */
  tip:
    | { shipId: string; good: string; fromPort: string; toPort: string | undefined; at: number }
    | undefined;
}

/** When she last left `manifest.from`: the start of the passage she's on or loading for. */
function leftAt(c: Contact, m: Manifest): number {
  const s = c.schedule;
  if (!s) return 0;
  const start = cycleStartS(s, m.cycle);
  return m.outbound ? start : start + s.lengthM / s.speedMs + s.dwellAwayS;
}

/**
 * Her last port's prices: the goods she carries first, then what the port makes, up to
 * five. Undefined when she's come from no port (the grounds, the lower lakes).
 */
export function lastPortPrices(
  defs: TrafficDefs,
  economy: EconomyDefs,
  markets: MarketsState,
  c: Contact,
  m: Manifest,
  gameSeconds: number,
): PriceNews | undefined {
  // Lying at the far end she's in port there: the port she's at is the news.
  const port = m.fromPort;
  if (!port) return undefined;
  const pm = economy.markets.get(port);
  if (!pm) return undefined;
  const goods: string[] = [];
  for (const l of m.cargo) if (pm.goods.has(l.good)) goods.push(l.good);
  for (const [id, mg] of pm.goods) {
    if (goods.length >= 5) break;
    if (mg.role === 'export' && !goods.includes(id)) goods.push(id);
  }
  for (const [id, mg] of pm.goods) {
    if (goods.length >= 5) break;
    if (mg.role === 'import' && !goods.includes(id)) goods.push(id);
  }
  const seenAt = Math.min(leftAt(c, m), gameSeconds);
  return {
    port,
    seenAt,
    prices: goods.flatMap((good) => {
      const p = unitPrices(economy, markets, port, good, gameSeconds);
      return p ? [{ good, buyCents: p.buyCents, sellCents: p.sellCents }] : [];
    }),
  };
}

const PORT_NAMES: ReadonlyMap<string, string> = new Map(
  portsFileSchema.parse(portsJson).map((p) => [p.id, p.name]),
);

/** A port's name ("Two Harbors"); `fallback` without one. */
export function portName(id: string | undefined, fallback = 'port'): string {
  return (id && PORT_NAMES.get(id)) ?? fallback;
}

export function goodName(economy: EconomyDefs, id: string): string {
  // Talk drops the trade screen's qualifiers: "brownstone", not "brownstone (salvaged)".
  return (economy.goods.get(id)?.name ?? id).replace(/\s*\(.*\)$/, '').toLowerCase();
}

/** "today", "tomorrow", "the week of Jun 4": when a sailing is, as talk has it. */
export function dayWord(at: number, now: number): string {
  const days = (at - now) / SECONDS_PER_GAME_DAY;
  if (days < 0.5) return 'today';
  if (days < 1.5) return 'tomorrow';
  const d = calendarDate(at);
  return `the week of ${d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })}`;
}

/** A loaded sailing on the timetable: a ship, her first cargo, where from and to, and when. */
export interface Sailing {
  shipId: string;
  good: string;
  fromPort: string;
  toPort: string | undefined;
  at: number;
}

/**
 * Every trade ship (but `exceptId`) that sails loaded from a port after `gameSeconds` and
 * within `horizonDays` game days, soonest first. The names, cargo and times are the sim's
 * own: the source of shipment tips at sea and in the saloons (piece K).
 */
export function upcomingSailings(
  defs: TrafficDefs,
  economy: EconomyDefs,
  contacts: readonly Contact[],
  gameSeconds: number,
  horizonDays: number,
  exceptId?: string,
): Sailing[] {
  const horizon = gameSeconds + horizonDays * SECONDS_PER_GAME_DAY;
  const options: Sailing[] = [];
  for (const c of contacts) {
    const s = c.schedule;
    if (!s || c.id === exceptId || !c.prize) continue;
    const k0 = Math.floor((gameSeconds + s.phaseS) / cycleS(s));
    const cycles = Math.ceil((horizonDays * SECONDS_PER_GAME_DAY) / cycleS(s)) + 1;
    for (let k = k0; k <= k0 + cycles; k++) {
      if (!sailsInCycle(s, k)) continue;
      const start = cycleStartS(s, k);
      const transit = s.lengthM / s.speedMs;
      for (const outbound of [true, false]) {
        const at = outbound ? start : start + transit + s.dwellAwayS;
        if (at <= gameSeconds || at > horizon) continue;
        const m = manifestFor(defs, economy, c, k, outbound);
        const line = m?.cargo[0];
        if (!m || !line || !m.fromPort) continue;
        options.push({ shipId: c.id, good: line.good, fromPort: m.fromPort, toPort: m.toPort, at });
      }
    }
  }
  options.sort((a, b) => a.at - b.at || a.shipId.localeCompare(b.shipId));
  return options;
}

/**
 * A shipment tip: the next trade ship (not this one) to sail loaded from a port within
 * three game days, chosen by the hail's draw. The name and cargo are the sim's own.
 */
export function shipmentTip(
  defs: TrafficDefs,
  economy: EconomyDefs,
  contacts: readonly Contact[],
  self: Contact,
  gameSeconds: number,
): HailNews['tip'] {
  const options = upcomingSailings(defs, economy, contacts, gameSeconds, 3, self.id);
  if (options.length === 0) return undefined;
  const u = hash01(`${self.id}:${Math.floor(gameSeconds / 3600)}:tip`);
  return options[Math.floor(u * Math.min(options.length, 4))];
}

/** What a hail brings: undefined when it's too dark for her to answer. */
export function hail(
  defs: TrafficDefs,
  economy: EconomyDefs,
  markets: MarketsState,
  contacts: readonly Contact[],
  c: Contact,
  gameSeconds: number,
  hour: number,
): HailNews | undefined {
  if (daylight(hour) < HAIL_DAYLIGHT) return undefined;
  const m = currentManifest(defs, economy, c, gameSeconds);
  const prices = m ? lastPortPrices(defs, economy, markets, c, m, gameSeconds) : undefined;
  const tip = c.hostile ? undefined : shipmentTip(defs, economy, contacts, c, gameSeconds);
  let rumor: string | undefined;
  if (tip) {
    const ship = contacts.find((x) => x.id === tip.shipId)?.name ?? 'A boat';
    const bound = tip.toPort ? ` for ${portName(tip.toPort)}` : ' down the lake';
    rumor =
      `"${ship} is loading ${goodName(economy, tip.good)} at ` +
      `${portName(tip.fromPort)}${bound}, sailing ${dayWord(tip.at, gameSeconds)}."`;
  } else if (c.hostile) {
    rumor = '"Mind how you go. We keep an eye on these waters."';
  }
  return { shipId: c.id, prices, rumor, tip };
}
