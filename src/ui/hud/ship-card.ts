import type { Faction } from '../../../data/schemas/factions';
import type { RouteNode } from '../../../data/schemas/routes';
import { weekLabel } from './model';
import type { Manifest } from '../../sim/traffic/cargo';
import type { HailNews } from '../../sim/traffic/news';
import { portName } from '../../sim/traffic/news';

/**
 * The card "look her over" and a hail bring up (plan 13 §4, plan 05 §8.1; Phase 4 piece
 * D): who she is, who owns her, where she's bound and what's in her hold, and, after a
 * hail, her news. A plain model the HUD draws; built by `shipCard` from the sim's data.
 */
export interface ShipCard {
  shipId: string;
  title: string;
  /** "Ore freighter · Northern Range Railway & Dock Co." */
  subtitle: string;
  /** "Duluth → the lower lakes", or where she lies. */
  route: string | undefined;
  /** One line per good: "4,620 CU iron ore". "In ballast" when empty. */
  cargo: string[];
  /** "Cargo worth about $13,860", absent in ballast. */
  value: string | undefined;
  crew: string | undefined;
  /** After a hail: her last port's prices and a rumor, or why she said nothing. */
  news: ShipCardNews | undefined;
}

export interface ShipCardNews {
  /** "Bayfield prices, wk of May 14, 1900". */
  heading: string | undefined;
  prices: { good: string; buy: string; sell: string }[];
  rumor: string | undefined;
}

/** "$1,234" from cents, whole dollars past a hundred and cents below. */
export function dollars(cents: number): string {
  const d = cents / 100;
  return d >= 100 ? `$${Math.round(d).toLocaleString('en-US')}` : `$${d.toFixed(2)}`;
}

function placeName(nodes: ReadonlyMap<string, RouteNode>, node: string, port?: string): string {
  if (port) return portName(port);
  const n = nodes.get(node);
  if (!n) return node;
  // "The lower lakes" reads "the lower lakes" mid-sentence; grounds keep their names.
  return n.role === 'sink' ? n.name.charAt(0).toLowerCase() + n.name.slice(1) : n.name;
}

export interface ShipCardSource {
  shipId: string;
  name: string;
  className: string;
  manifest: Manifest | undefined;
  owner: Faction | undefined;
  nodes: ReadonlyMap<string, RouteNode>;
  goodNames: (id: string) => string;
  /** Lying in port at the passage's start (loading) rather than under way. */
  lyingAt?: string | undefined;
  news?: HailNews | 'dark' | 'told' | undefined;
}

export function shipCard(src: ShipCardSource): ShipCard {
  const m = src.manifest;
  const subtitle = src.owner ? `${src.className} · ${src.owner.name}` : src.className;
  let route: string | undefined;
  if (m) {
    const from = placeName(src.nodes, m.from, m.fromPort);
    const to = placeName(src.nodes, m.to, m.toPort);
    route = src.lyingAt ? `Loading at ${from} for ${to}` : `${from} → ${to}`;
  }
  const cargo =
    m && m.cargo.length > 0
      ? m.cargo.map((l) => `${l.qty.toLocaleString('en-US')} CU ${src.goodNames(l.good)}`)
      : m?.armed
        ? ['Government stores']
        : ['In ballast'];
  const value = m && m.valueCents > 0 ? `Cargo worth about ${dollars(m.valueCents)}` : undefined;
  const crew = m ? `${m.crew} crew${m.armed ? ', armed' : ''}` : undefined;
  let news: ShipCardNews | undefined;
  const n = src.news;
  if (n === 'dark') {
    news = { heading: undefined, prices: [], rumor: 'No answer: too dark to make out your hail.' };
  } else if (n === 'told') {
    news = { heading: undefined, prices: [], rumor: '"Nothing new since we spoke."' };
  } else if (n) {
    news = {
      heading: n.prices
        ? `${portName(n.prices.port)} prices, ${weekLabel(n.prices.seenAt).replace(/^Wk/, 'wk')}`
        : undefined,
      prices: (n.prices?.prices ?? []).map((p) => ({
        good: src.goodNames(p.good),
        buy: dollars(p.buyCents),
        sell: dollars(p.sellCents),
      })),
      rumor: n.rumor,
    };
  }
  return { shipId: src.shipId, title: src.name, subtitle, route, cargo, value, crew, news };
}
