import type { PaperStand } from '../../gameplay/papers';
import type { NewsDefs } from '../../sim/news/papers';
import type { Article, WantedNotice } from '../../sim/news/state';
import { formatCents } from '../../sim/economy/knowledge';
import { dateline } from '../../sim/run/run-end';

/**
 * The newsstand on the port screen (plan 13 §12 "newspaper reader v1"; Phase 5 piece F):
 * the papers sold at the port, each with its latest edition. Until you buy one only its
 * masthead and the lead headline show, as the paper boy holds it up.
 */

export interface EditionView {
  dateline: string;
  lead: Article;
  briefs: Article[];
  wanted: WantedNotice[];
  cutter: string[];
  weather: string;
  /** "Storm signals are flying at Duluth and Superior." or undefined. */
  signals: string | undefined;
  ad: string;
  /** Days old: 0 for today's. */
  ageDays: number;
}

export interface PaperView {
  id: string;
  name: string;
  town: string;
  state: string;
  priceCents: number;
  priceText: string;
  read: boolean;
  affordable: boolean;
  edition: EditionView | undefined;
}

export interface PapersSnapshot {
  papers: PaperView[];
}

export function signalsText(ports: readonly string[]): string | undefined {
  if (ports.length === 0) return undefined;
  if (ports.length >= 6) return 'Storm signals are flying in every port at the head of the lake.';
  const list =
    ports.length === 1
      ? ports[0]
      : `${ports.slice(0, -1).join(', ')} and ${ports[ports.length - 1]}`;
  return `Storm signals are flying at ${list}.`;
}

export function papersSnapshot(
  defs: NewsDefs,
  stand: PaperStand,
  purseCents: number,
  today: number,
): PapersSnapshot {
  return {
    papers: stand.papers.map((p) => {
      const def = defs.paperById.get(p.id);
      const e = p.edition;
      return {
        id: p.id,
        name: p.name,
        town: def?.town ?? '',
        state: def?.state ?? '',
        priceCents: p.priceCents,
        priceText: `${p.priceCents}¢`,
        read: p.read,
        affordable: purseCents >= p.priceCents,
        edition: e && {
          dateline: dateline(e.at),
          lead: e.lead,
          briefs: e.briefs,
          wanted: e.wanted,
          cutter: e.cutter,
          weather: e.weather.text,
          signals: signalsText(e.weather.signals),
          ad: e.ad,
          ageDays: Math.max(0, today - e.day),
        },
      };
    }),
  };
}

/** For the port screen's header: the price of a paper, as the masthead's ear prints it. */
export function priceEar(cents: number): string {
  return cents === 1
    ? 'Price one cent'
    : cents === 2
      ? 'Price two cents'
      : `Price ${formatCents(cents)}`;
}
