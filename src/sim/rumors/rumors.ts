import rumorsJson from '../../../data/rumors.json';
import { rumorsFileSchema, type RumorKind, type RumorsFile } from '../../../data/schemas/rumors';
import { dayAndHour, SECONDS_PER_GAME_DAY } from '../../core/time';
import type { ChartGeography } from '../chart/geography';
import { forecastAt } from '../chart/chart-weather';
import type { Contact } from '../chart/traffic';
import { portInfo, type EconomyDefs } from '../economy/defs';
import type { PriceKnowledge } from '../economy/knowledge';
import { unitPrices, type MarketsState } from '../economy/market';
import type { TrafficDefs } from '../traffic/cargo';
import { dayWord, goodName, portName, upcomingSailings, type HailNews } from '../traffic/news';
import type { WeatherState } from '../weather/weather';
import type { Background, Rumor } from '../world-state';

/**
 * Rumors and price news (plan 05 §4.3, §9; Phase 4 piece K). Talk in a saloon is drawn
 * from the live sim: the timetable's real sailings and manifests (shipment tips), other
 * ports' markets (price tips), the weather sim run forward (the outlook), the island
 * smuggler's anchorage (piece H), and the legends plan 11 builds in Phase 9.
 *
 * Every rumor has a reliability, the chance it's true, which the ledger shows as a word
 * with the teller ("Likely: a deckhand"). Whether it actually is true is rolled when it's
 * told and kept with it, hidden: a false shipment tip names the wrong day or cargo, a
 * false price is a quarter or more off, a false outlook has the wind and weather wrong,
 * and a false smuggler rumor names the wrong anchorage. Rumors also age: a tip for a
 * sailing that's come and gone is stale. The ledger keeps the newest `keep` of them.
 */

export type { RumorKind };

let cached: RumorsFile | undefined;

/** `data/rumors.json`, validated once. */
export function rumorDefs(): RumorsFile {
  cached ??= rumorsFileSchema.parse(rumorsJson);
  return cached;
}

/** What the saloon's talk is drawn from. Missing parts just aren't talked about. */
export interface RumorWorld {
  economy: EconomyDefs;
  markets: MarketsState;
  traffic?: { defs: TrafficDefs; contacts: readonly Contact[] } | undefined;
  weather?: { state: WeatherState; geo: ChartGeography } | undefined;
  /** The island smuggler's anchorage (piece H). */
  smugglerAnchorage?: (() => { id: string; name: string; where: string } | undefined) | undefined;
}

/** A rumor as told, with the price it carries for the ledger (price tips only). */
export interface ToldRumor {
  rumor: Rumor;
  price?: { port: string; good: string; buyCents: number; sellCents: number; seenAt: number };
}

/** Draws 0–1; the saloon passes the run's saved RNG, the tests a fixed sequence. */
export type Rand = () => number;

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));
const pick = <T>(rand: Rand, list: readonly T[]): T => {
  const v = list[Math.floor(rand() * list.length) % list.length];
  if (v === undefined) throw new Error('pick from an empty list');
  return v;
};

function fill(template: string, values: Record<string, string>): string {
  const text = template.replace(/\{(\w+)\}/g, (_, k: string) => values[k] ?? '');
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** The teller's band for a reliability: its word and a name. */
function teller(defs: RumorsFile, reliability: number): { word: string; names: string[] } {
  const band = defs.tellers.find((b) => reliability >= b.minReliability) ?? defs.tellers.at(-1);
  if (!band) throw new Error('rumors.json has no tellers');
  return band;
}

/** "Reliable", "Likely", "Doubtful" or "Tall tale". */
export function reliabilityWord(reliability: number, defs = rumorDefs()): string {
  return teller(defs, reliability).word;
}

/** Sixteen-point names, as an old hand says them. */
const COMPASS = [
  'north',
  'north-northeast',
  'northeast',
  'east-northeast',
  'east',
  'east-southeast',
  'southeast',
  'south-southeast',
  'south',
  'south-southwest',
  'southwest',
  'west-southwest',
  'west',
  'west-northwest',
  'northwest',
  'north-northwest',
];

function compass(rad: number): string {
  const i = Math.round((((rad / (2 * Math.PI)) * 16) % 16) + 16) % 16;
  return COMPASS[i] ?? 'north';
}

/** "this afternoon", "tonight", "tomorrow morning". */
export function partOfDay(at: number, now: number): string {
  const a = dayAndHour(at);
  const n = dayAndHour(now);
  const h = a.hour;
  const part =
    h >= 5 && h < 12
      ? 'morning'
      : h < 17 && h >= 12
        ? 'afternoon'
        : h >= 17 && h < 21
          ? 'evening'
          : 'night';
  if (a.day === n.day)
    return part === 'night' ? (h < 5 ? 'before dawn' : 'tonight') : `this ${part}`;
  if (a.day === n.day + 1 && h < 5) return 'tonight';
  if (a.day === n.day + 1) return part === 'night' ? 'tomorrow night' : `tomorrow ${part}`;
  return 'in a day or two';
}

// ---------------------------------------------------------------------------------
// Each kind: what's true now, a false version, and the words.

interface Draft {
  kind: RumorKind;
  /** What it's about, for the ledger and so the same talk isn't told twice. */
  subject: string;
  /** Renders the text; `truth` false gives the false version. */
  render(
    truth: boolean,
    rand: Rand,
  ): {
    text: string;
    expiresAt?: number;
    price?: ToldRumor['price'];
    subject?: string;
  };
  /** Legends are told as tall tales but are true (plan 11 builds them). */
  alwaysTrue?: boolean;
}

function shipmentDrafts(defs: RumorsFile, world: RumorWorld, port: string, now: number): Draft[] {
  const t = world.traffic;
  if (!t) return [];
  const zone = portInfo(port)?.zone;
  const sailings = upcomingSailings(
    t.defs,
    world.economy,
    t.contacts,
    now,
    defs.shipmentHorizonDays,
  ).filter((s) => s.fromPort === port || portInfo(s.fromPort)?.zone === zone);
  // From this port first, then its neighbors; soonest first in each.
  sailings.sort((a, b) => Number(b.fromPort === port) - Number(a.fromPort === port) || a.at - b.at);
  return sailings.slice(0, 5).map((s) => {
    const ship = t.contacts.find((c) => c.id === s.shipId)?.name ?? 'A boat';
    return {
      kind: 'shipment',
      subject: `${s.shipId}@${Math.round(s.at)}`,
      render(truth, rand) {
        let at = s.at;
        let good = s.good;
        if (!truth) {
          const others = [...(world.economy.markets.get(s.fromPort)?.goods.entries() ?? [])]
            .filter(([id, g]) => id !== s.good && g.role === 'export')
            .map(([id]) => id);
          // Wrong cargo, or the wrong day.
          if (others.length && rand() < 0.5) good = pick(rand, others);
          else
            at =
              s.at +
              (rand() < 0.5 && s.at - SECONDS_PER_GAME_DAY > now ? -1 : 1) * SECONDS_PER_GAME_DAY;
        }
        return {
          text: fill(pick(rand, defs.kinds.shipment.templates), {
            ship,
            good: goodName(world.economy, good),
            port: portName(s.fromPort),
            to: s.toPort ? ` for ${portName(s.toPort)}` : ' down the lake',
            when: dayWord(at, now),
          }),
          expiresAt: at + SECONDS_PER_GAME_DAY / 4,
        };
      },
    };
  });
}

function priceDraft(
  defs: RumorsFile,
  world: RumorWorld,
  port: string,
  now: number,
  rand: Rand,
): Draft[] {
  const others = [...world.economy.markets.keys()].filter((p) => p !== port);
  if (others.length === 0) return [];
  const there = pick(rand, others);
  const pm = world.economy.markets.get(there);
  if (!pm) return [];
  const dear = rand() < 0.5;
  const scored: { good: string; score: number; buy: number; sell: number }[] = [];
  for (const [good, mg] of pm.goods) {
    const p = unitPrices(world.economy, world.markets, there, good, now);
    if (!p) continue;
    const base = mg.good.basePriceCents;
    scored.push({
      good,
      score: dear ? p.sellCents / base : base / p.buyCents,
      buy: p.buyCents,
      sell: p.sellCents,
    });
  }
  scored.sort((a, b) => b.score - a.score || a.good.localeCompare(b.good));
  const top = scored.slice(0, 3);
  if (top.length === 0) return [];
  const g = pick(rand, top);
  return [
    {
      kind: 'price',
      subject: `${there}:${g.good}`,
      render(truth, r) {
        // The teller saw it up to a day and a half ago.
        const seenAt = Math.max(0, now - r() * 1.5 * SECONDS_PER_GAME_DAY);
        const k = truth ? 1 : r() < 0.5 ? 0.6 + r() * 0.15 : 1.3 + r() * 0.25;
        const buy = Math.max(1, Math.round(g.buy * k));
        const sell = Math.max(1, Math.round(g.sell * k));
        const cents = dear ? sell : buy;
        return {
          text: fill(pick(r, defs.kinds.price.templates), {
            good: goodName(world.economy, g.good),
            deal: dear ? 'fetching a good price' : 'going cheap',
            port: portName(there),
            price: `$${(cents / 100).toFixed(2)}`,
          }),
          price: { port: there, good: g.good, buyCents: buy, sellCents: sell, seenAt },
        };
      },
    },
  ];
}

/** The wind that goes with each kind of weather talk, knots: a false outlook keeps them together. */
const WEATHER_WIND_KN: Record<string, [number, number]> = {
  'fair weather': [8, 15],
  rain: [10, 18],
  squalls: [15, 25],
  fog: [3, 9],
  'a stiff blow': [22, 30],
  'a gale': [34, 45],
  'a flat calm': [0, 4],
};

const WEATHER_WORDS = [
  'fair weather',
  'rain',
  'squalls',
  'fog',
  'a stiff blow',
  'a gale',
  'a flat calm',
];

function weatherDraft(defs: RumorsFile, world: RumorWorld, port: string, now: number): Draft[] {
  const w = world.weather;
  const at = w?.geo.ports.find((p) => p.id === port)?.pos;
  if (!w || !at) return [];
  const lead = defs.weatherLeadHours;
  const f = forecastAt(w.state, w.geo, at, now, lead);
  const hi = f.windHighKn;
  const word = f.squall
    ? 'squalls'
    : hi >= 34
      ? 'a gale'
      : hi >= 22
        ? 'a stiff blow'
        : f.rain
          ? 'rain'
          : f.visibilityM < 1000
            ? 'fog'
            : hi < 6
              ? 'a flat calm'
              : 'fair weather';
  const target = now + lead * 3600;
  return [
    {
      kind: 'weather',
      subject: `${port}@${dayAndHour(target).day}`,
      render(truth, rand) {
        let from = f.windFrom;
        let lo = f.windLowKn;
        let top = f.windHighKn;
        let what = word;
        if (!truth) {
          // The wrong weather, with a wind to match it, from the wrong quarter.
          from += (Math.PI / 2 + rand() * (Math.PI / 2)) * (rand() < 0.5 ? -1 : 1);
          what = pick(
            rand,
            WEATHER_WORDS.filter((x) => x !== word),
          );
          const [bandLo, bandHi] = WEATHER_WIND_KN[what] ?? [8, 16];
          lo = bandLo + rand() * 3;
          top = Math.max(lo + 4, bandHi - rand() * 3);
        }
        const l = Math.round(lo / 5) * 5;
        const h = Math.max(l + 5, Math.round(top / 5) * 5);
        return {
          text: fill(pick(rand, defs.kinds.weather.templates), {
            weather: what,
            when: partOfDay(target, now),
            wind: h <= 5 ? 'light and variable' : `from the ${compass(from)}, ${l} to ${h} knots`,
          }),
          expiresAt: target + 6 * 3600,
        };
      },
    },
  ];
}

function smugglerDraft(defs: RumorsFile, world: RumorWorld, port: string): Draft[] {
  const region = portInfo(port)?.wantedRegion;
  const spot = world.smugglerAnchorage?.();
  if (!spot || !region || !defs.smugglerRegions.includes(region)) return [];
  return [
    {
      kind: 'smuggler',
      subject: spot.id,
      render(truth, rand) {
        const decoy = pick(rand, defs.smugglerDecoys);
        const where = truth ? spot.where : decoy.where;
        return {
          text: fill(pick(rand, defs.kinds.smuggler.templates), { where }),
          subject: truth ? spot.id : decoy.id,
        };
      },
    },
  ];
}

function legendDrafts(defs: RumorsFile, port: string): Draft[] {
  return defs.legends
    .filter((l) => l.ports.includes(port))
    .map((l) => ({
      kind: 'legend' as const,
      subject: l.id,
      alwaysTrue: true,
      render: (_truth: boolean, rand: Rand) => ({
        text: fill(pick(rand, defs.kinds.legend.templates), { line: pick(rand, l.lines) }),
      }),
    }));
}

/** True when the captain has heard this kind of talk and it was true (the smuggler's spot). */
export function knowsRumor(rumors: readonly Rumor[], kind: RumorKind, subject?: string): boolean {
  return rumors.some(
    (r) => r.kind === kind && r.truth && (subject === undefined || r.subject === subject),
  );
}

/** Has this talk been heard (true or not) and not gone stale? */
function heard(rumors: readonly Rumor[], d: Draft, now: number): boolean {
  return rumors.some((r) => {
    if (r.kind !== d.kind) return false;
    switch (d.kind) {
      case 'shipment':
      case 'weather':
        return r.draft === d.subject;
      case 'price':
        // The same port and good again the same day is no news.
        return r.draft === d.subject && dayAndHour(r.heardAt).day === dayAndHour(now).day;
      case 'smuggler':
        // Once you know the spot for true, nobody tells you twice; a false lead can be put right.
        return (
          r.truth || (r.draft === d.subject && dayAndHour(r.heardAt).day === dayAndHour(now).day)
        );
      case 'legend':
        return r.draft === d.subject;
    }
  });
}

/** Everything the saloon at `port` could tell now that hasn't been heard. */
export function rumorDrafts(
  world: RumorWorld,
  rumors: readonly Rumor[],
  port: string,
  now: number,
  rand: Rand,
  defs = rumorDefs(),
): Draft[] {
  return [
    ...shipmentDrafts(defs, world, port, now),
    ...priceDraft(defs, world, port, now, rand),
    ...weatherDraft(defs, world, port, now),
    ...smugglerDraft(defs, world, port),
    ...legendDrafts(defs, port),
  ].filter((d) => !heard(rumors, d, now));
}

/**
 * One rumor from the saloon at `port`: a kind by weight among what there's to tell, a
 * teller, its reliability, and whether it's true. Undefined when the bar has nothing new.
 */
export function tellRumor(
  world: RumorWorld,
  rumors: readonly Rumor[],
  port: string,
  now: number,
  rand: Rand,
  opts: { reliabilityBonus?: number } = {},
  defs = rumorDefs(),
): ToldRumor | undefined {
  const drafts = rumorDrafts(world, rumors, port, now, rand, defs);
  const byKind = new Map<RumorKind, Draft[]>();
  for (const d of drafts) byKind.set(d.kind, [...(byKind.get(d.kind) ?? []), d]);
  const kinds = [...byKind.keys()].filter((k) => defs.kinds[k].weight > 0);
  const total = kinds.reduce((s, k) => s + defs.kinds[k].weight, 0);
  if (total <= 0) return undefined;
  let u = rand() * total;
  let kind = kinds[kinds.length - 1];
  for (const k of kinds) {
    u -= defs.kinds[k].weight;
    if (u < 0) {
      kind = k;
      break;
    }
  }
  const options = kind ? byKind.get(kind) : undefined;
  if (!kind || !options?.length) return undefined;
  // Shipments: the soonest few are the talk of the bar.
  const draft = pick(rand, options);
  const reliability = clamp(
    defs.kinds[kind].reliability + (rand() - 0.5) * 0.3 + (opts.reliabilityBonus ?? 0),
    0.05,
    0.98,
  );
  const truth = draft.alwaysTrue ? true : rand() < reliability;
  const out = draft.render(truth, rand);
  const band = teller(defs, reliability);
  const rumor: Rumor = {
    id: `rumor.${Math.round(now)}.${Math.floor(rand() * 1e6)}`,
    kind,
    source: 'saloon',
    port,
    heardAt: now,
    text: out.text,
    teller: pick(rand, band.names),
    reliability: Math.round(reliability * 100) / 100,
    truth,
    draft: draft.subject,
    subject: out.subject ?? draft.subject,
    ...(out.expiresAt !== undefined ? { expiresAt: out.expiresAt } : {}),
  };
  return out.price ? { rumor, price: out.price } : { rumor };
}

/** The shipment tip a hailed ship gave, as a rumor for the ledger: what she's seen herself. */
export function hailRumor(
  news: HailNews,
  shipName: string,
  now: number,
  defs = rumorDefs(),
): Rumor | undefined {
  if (!news.rumor || !news.tip) return undefined;
  const tip = news.tip;
  return {
    id: `rumor.${Math.round(now)}.${news.shipId}`,
    kind: 'shipment',
    source: 'hail',
    heardAt: now,
    text: news.rumor.replace(/^"|"$/g, ''),
    teller: `the ${shipName}`,
    reliability: defs.hailReliability,
    truth: true,
    draft: `${tip.shipId}@${Math.round(tip.at)}`,
    subject: `${tip.shipId}@${Math.round(tip.at)}`,
    expiresAt: tip.at + SECONDS_PER_GAME_DAY / 4,
  };
}

/** Puts a rumor at the top of the ledger and drops the oldest past `keep`. */
export function addRumor(rumors: Rumor[], rumor: Rumor, defs = rumorDefs()): void {
  rumors.unshift(rumor);
  if (rumors.length > defs.keep) rumors.length = defs.keep;
}

/** A rumor whose time has passed: the ship's sailed, the weather's come. */
export function isStale(r: Rumor, now: number): boolean {
  return r.expiresAt !== undefined && now > r.expiresAt;
}

/**
 * Writes heard prices into the ledger where they're newer than what's there (plan 05
 * §4.3), marked as heard: a market visit writes over them with what you see yourself.
 */
export function noteHeardPrices(
  knowledge: PriceKnowledge,
  port: string,
  prices: readonly { good: string; buyCents: number; sellCents: number }[],
  seenAt: number,
  heardFrom: 'rumor' | 'hail',
): number {
  let n = 0;
  const book = (knowledge[port] ??= {});
  for (const p of prices) {
    const old = book[p.good];
    if (old && old.seenAt >= seenAt) continue;
    book[p.good] = { buyCents: p.buyCents, sellCents: p.sellCents, seenAt, heard: heardFrom };
    n++;
  }
  return n;
}

// ---------------------------------------------------------------------------------
// The saloon

export interface SaloonTerms {
  /** What a round costs here, cents; 0 when it's on the house. */
  roundCents: number;
  /** The usual price, for the screen. */
  listCents: number;
  /** Rounds left that buy talk today. */
  roundsLeft: number;
  free: boolean;
}

/** A round's price here and how much talk is left today (plan 05 §9; 12 §2.2's Saloon Keeper). */
export function saloonTerms(
  economy: EconomyDefs,
  rumors: readonly Rumor[],
  port: string,
  now: number,
  background: Background,
  defs = rumorDefs(),
): SaloonTerms {
  const size = economy.markets.get(port)?.def.size ?? 'small';
  const listCents = defs.roundCents[size];
  const today = dayAndHour(now).day;
  const rounds = rumors.filter(
    (r) => r.source === 'saloon' && r.port === port && dayAndHour(r.heardAt).day === today,
  ).length;
  const free = background === 'saloon_keeper' && rounds < defs.saloonKeeper.freeRounds;
  return {
    listCents,
    roundCents: free ? 0 : listCents,
    roundsLeft: Math.max(0, defs.roundsPerDay - rounds),
    free,
  };
}

/** The Saloon Keeper hears better talk (plan 12 §2.2). */
export function reliabilityBonus(background: Background, defs = rumorDefs()): number {
  return background === 'saloon_keeper' ? defs.saloonKeeper.reliabilityBonus : 0;
}
