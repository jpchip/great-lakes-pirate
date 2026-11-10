import { calendarDate, dayAndHour, SECONDS_PER_GAME_DAY } from '../../core/time';
import { formatCents } from '../economy/knowledge';
import { portInfo } from '../economy/defs';
import { stashedCash } from '../hideouts/stash';
import { fameTier, fameTierName, tierDef, type LawDefs } from '../law/defs';
import type { WorldState } from '../world-state';
import { freshStats, type LogEntry } from './record';

/**
 * The run's end (plan 12 §9, plan 16 §3; Phase 5 piece D): the front page from the paper
 * that would print it, the run summary and the logbook as text. It's built before the run
 * is deleted and kept in the `lastRun` store, so the end screen shows it after the save is
 * gone, and again from the main menu until a new run starts.
 */

/** `killed`: shot down in a boarding fight lost at bad odds (Phase 6 piece D). */
/** `drowned` and `fell`: health ran out ashore, in the water or from a fall (Phase 7 piece A). */
export type RunEndCause = 'executed' | 'abandoned' | 'killed' | 'drowned' | 'fell';

/** What a death needs for the papers: the ship she died boarding. */
export interface RunEndDetail {
  /** The ship whose crew repelled the boarding. */
  ship?: string;
}

export interface FrontPage {
  paper: string;
  town: string;
  /** "Thursday, June 21, 1900". */
  dateline: string;
  headline: string;
  deck: string;
  body: string[];
}

export interface SummaryRow {
  label: string;
  value: string;
}

export interface LastRun {
  version: 1;
  cause: RunEndCause;
  captain: string;
  shipName: string;
  portrait: string | undefined;
  /** The game time it ended, and the real time. */
  endedAt: number;
  endedAtIso: string;
  frontPage: FrontPage;
  summary: SummaryRow[];
  /** The whole logbook as Markdown, for the download. */
  logbook: string;
  /** A one-line epitaph for the Hall of Captains. */
  epitaph: string;
}

const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/** "June 21, 1900": the calendar week the game day stands for. */
export function dateText(gameSeconds: number): string {
  const d = calendarDate(dayAndHour(gameSeconds).day * SECONDS_PER_GAME_DAY);
  return `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}, ${d.getUTCFullYear()}`;
}

export function dateline(gameSeconds: number): string {
  const d = calendarDate(dayAndHour(gameSeconds).day * SECONDS_PER_GAME_DAY);
  return `${WEEKDAYS[d.getUTCDay()]}, ${dateText(gameSeconds)}`;
}

function hhmm(gameSeconds: number): string {
  const minutes = Math.floor(dayAndHour(gameSeconds).hour * 60);
  return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
}

const SEASONS = ['winter', 'spring', 'summer', 'autumn'] as const;
function seasonOf(gameSeconds: number): (typeof SEASONS)[number] {
  const m = calendarDate(gameSeconds).getUTCMonth();
  return SEASONS[Math.floor(((m + 1) % 12) / 3)] ?? 'winter';
}

/** Weeks (game days) from `from` to `to`, at least one. */
function weeksBetween(from: number, to: number): number {
  return Math.max(1, Math.round((to - from) / SECONDS_PER_GAME_DAY));
}

function seasonsBetween(from: number, to: number): number {
  const seen = new Set<string>();
  for (let t = from; t <= to; t += SECONDS_PER_GAME_DAY) seen.add(seasonOf(t));
  seen.add(seasonOf(to));
  return seen.size;
}

const PAPERS = {
  bayfield: { paper: "The Bayfield Fishermen's Weekly", town: 'Bayfield' },
  duluth: { paper: 'The Duluth Daily Lantern', town: 'Duluth' },
} as const;

function frontPage(
  defs: LawDefs,
  state: WorldState,
  cause: RunEndCause,
  now: number,
  detail: RunEndDetail = {},
): FrontPage {
  const c = state.player.captain;
  const name = c.name.toUpperCase();
  const ship = c.shipName;
  const famous = fameTier(defs, state.fame.value) >= 2;
  const lockup = state.jail ? (portInfo(state.jail.port)?.name ?? 'Bayfield') : 'Bayfield';
  // A captain the whole lake knows makes the Duluth paper; otherwise the local weekly.
  const { paper, town } = famous ? PAPERS.duluth : PAPERS.bayfield;
  if (cause === 'executed') {
    const weeks = weeksBetween(statsFor(state, now).startedAt, now);
    return {
      paper,
      town,
      dateline: dateline(now),
      headline: `${name} HANGED AT ${lockup.toUpperCase()}`,
      deck: `Master of the Schooner ${ship} Meets the Rope at Dawn; Most Wanted on the Lake`,
      body: [
        `Captain ${c.name}, lately master of the schooner ${ship}, was hanged at ${lockup} at first light, taken on the lake by the revenue cutter with the whole region crying out for the capture.`,
        `In ${weeks} week${weeks === 1 ? '' : 's'} on the lake the captain made a name in the trade the respectable call smuggling. The ${ship} lies impounded at the ${lockup} dock, her hold empty.`,
        famous
          ? 'Crowds came from as far as Ashland to see it done. Whatever else is said, the lake will tell the story a while yet.'
          : 'Few came to see it done. The lake has had its share of rogues, and will have more.',
      ],
    };
  }
  if (cause === 'killed') {
    const prize = detail.ship ?? 'a lake steamer';
    return {
      paper,
      town,
      dateline: dateline(now),
      headline: `PIRATE ${name} SHOT DEAD`,
      deck: `Crew of the ${prize} Beat Off a Boarding; the Schooner ${ship} Found Adrift`,
      body: [
        `Captain ${c.name}, master of the schooner ${ship}, was killed on the open lake attempting to board the ${prize}, whose crew met the attack with pistols and handspikes and drove it off.`,
        `The ${ship} was found drifting with her sails loose and her captain dead on the deck. The ${prize}'s master said his people only did what any crew would.`,
        famous
          ? 'The waterfront knew the name well. Some will say the lake is safer for it.'
          : 'Few on the waterfront knew the name. The lake keeps its own accounts.',
      ],
    };
  }
  if (cause === 'drowned') {
    return {
      paper,
      town,
      dateline: dateline(now),
      headline: `CAPTAIN ${name} DROWNED`,
      deck: `Master of the Schooner ${ship} Lost in the Cold Water Ashore`,
      body: [
        `Captain ${c.name}, master of the schooner ${ship}, went into the lake and did not come out. Superior's water is cold enough to kill a strong swimmer in minutes, and it did.`,
        `The ${ship} was found lying where the captain left her, with nobody aboard to say why.`,
        famous
          ? 'The waterfront knew the name. The lake, they say, gives up nothing it takes.'
          : 'Few on the waterfront knew the name. The lake keeps its own accounts.',
      ],
    };
  }
  if (cause === 'fell') {
    return {
      paper,
      town,
      dateline: dateline(now),
      headline: `CAPTAIN ${name} KILLED IN A FALL`,
      deck: `Master of the Schooner ${ship} Found at the Foot of a Drop`,
      body: [
        `Captain ${c.name}, master of the schooner ${ship}, was found dead ashore at the foot of a fall too high to walk away from. What the captain was doing up there, nobody would say.`,
        `The ${ship} lies where she was left.`,
        famous
          ? 'Some on the waterfront will not be sorry. Most will not be surprised.'
          : 'Few on the waterfront knew the name. The lake keeps its own accounts.',
      ],
    };
  }
  return {
    paper,
    town,
    dateline: dateline(now),
    headline: `THE ${ship.toUpperCase()} LAID UP`,
    deck: `Captain ${c.name} Goes Ashore for Good`,
    body: [
      `Captain ${c.name} has laid up the schooner ${ship} and quit the lake, by the captain's own word. Where the captain has gone, nobody on the waterfront would say.`,
      'His creditors and the law alike are said to have taken the news calmly.',
    ],
  };
}

const ENDINGS: Readonly<Record<RunEndCause, string>> = {
  executed: 'Hanged',
  abandoned: 'Gave up the lake',
  killed: 'Killed boarding a prize',
  drowned: 'Drowned in the cold water',
  fell: 'Killed in a fall ashore',
};

function statsFor(state: WorldState, now: number) {
  return state.stats ?? freshStats(now);
}

function summary(defs: LawDefs, state: WorldState, cause: RunEndCause, now: number): SummaryRow[] {
  const s = statsFor(state, now);
  const weeks = weeksBetween(s.startedAt, now);
  const seasons = seasonsBetween(s.startedAt, now);
  const peakFame = Math.max(s.peakFame, state.fame.value);
  const peakTier = Math.max(
    s.peakTier,
    ...Object.values(state.wanted).map((w) => {
      let t = 0;
      for (let i = defs.wanted.tiers.length - 1; i > 0; i--) {
        if (w.heat >= tierDef(defs, i).minHeat) {
          t = i;
          break;
        }
      }
      return t;
    }),
  );
  return [
    {
      label: 'Survived',
      value: `${weeks} week${weeks === 1 ? '' : 's'}, ${seasons} season${seasons === 1 ? '' : 's'} (${dateText(s.startedAt)} to ${dateText(now)})`,
    },
    { label: 'Money earned', value: formatCents(s.earnedCents, true) },
    {
      label: 'Left behind',
      value: `${formatCents(state.player.purse, true)} aboard, ${formatCents(stashedCash(state.hideouts), true)} stashed`,
    },
    { label: 'Fame at its height', value: fameTierName(defs, fameTier(defs, peakFame)) },
    { label: 'Most wanted as', value: tierDef(defs, peakTier).name },
    { label: 'Crimes', value: String(s.crimes) },
    { label: 'Contracts delivered', value: String(s.contracts) },
    { label: 'Taken by the law', value: `${s.captures} time${s.captures === 1 ? '' : 's'}` },
    { label: 'Lives taken', value: 'Never killed a soul' },
    { label: 'How it ended', value: ENDINGS[cause] },
  ];
}

/** The logbook as Markdown, a heading for each week. */
export function logbookMarkdown(
  captain: string,
  shipName: string,
  entries: readonly LogEntry[],
  ending: string,
): string {
  const lines = [`# The logbook of Captain ${captain}, master of the ${shipName}`, ''];
  let week = -1;
  for (const e of entries) {
    const day = dayAndHour(e.at).day;
    if (day !== week) {
      week = day;
      lines.push('', `## Week of ${dateText(e.at)}`, '');
    }
    lines.push(`- ${hhmm(e.at)} ${e.text}`);
  }
  lines.push('', `*${ending}*`, '');
  return lines.join('\n');
}

export function buildLastRun(
  defs: LawDefs,
  state: WorldState,
  cause: RunEndCause,
  now: number,
  realNow: Date,
  detail: RunEndDetail = {},
): LastRun {
  const c = state.player.captain;
  const page = frontPage(defs, state, cause, now, detail);
  const ending = `${page.headline} (${page.paper}, ${page.dateline})`;
  return {
    version: 1,
    cause,
    captain: c.name,
    shipName: c.shipName,
    portrait: c.portrait,
    endedAt: now,
    endedAtIso: realNow.toISOString(),
    frontPage: page,
    summary: summary(defs, state, cause, now),
    logbook: logbookMarkdown(c.name, c.shipName, state.logbook ?? [], ending),
    epitaph:
      cause === 'executed'
        ? `Hanged at Bayfield, ${dateText(now)}`
        : cause === 'killed'
          ? `Killed boarding the ${detail.ship ?? 'a prize'}, ${dateText(now)}`
          : `Went ashore for good, ${dateText(now)}`,
  };
}
