import { calendarDate, dayAndHour, SECONDS_PER_GAME_DAY } from '../../core/time';
import { formatCents } from '../economy/knowledge';
import { portInfo } from '../economy/defs';
import { stashedCash } from '../hideouts/stash';
import { fameTier, fameTierName, tierDef, type LawDefs } from '../law/defs';
import { calledText, fill } from '../news/papers';
import type { WorldState } from '../world-state';
import { endingPage, retirementDef } from './endings';
import { freshStats, type LogEntry } from './record';

/**
 * The run's end (plan 12 §9, plan 16 §3; Phase 5 piece D): the front page from the paper
 * that would print it, the run summary and the logbook as text. It's built before the run
 * is deleted and kept in the `lastRun` store, so the end screen shows it after the save is
 * gone, and again from the main menu until a new run starts.
 */

/** `killed`: shot down in a boarding fight lost at bad odds (Phase 6 piece D). */
/** `drowned` and `fell`: health ran out ashore, in the water or from a fall (Phase 7 piece A). */
/** `retired` and `lawman`: the voluntary endings, taken by letter (Phase 9 piece B). */
/** `froze` and `through_ice`: the cold, or the ice giving way (Phase 9 piece M). */
/** `mauled`: a bear or the wolves ashore (Phase 9 piece V). */
export type RunEndCause =
  | 'executed'
  | 'abandoned'
  | 'killed'
  | 'drowned'
  | 'fell'
  | 'retired'
  | 'lawman'
  | 'froze'
  | 'through_ice'
  | 'mauled';

/** What a death needs for the papers: the ship she died boarding; a retirement's place. */
export interface RunEndDetail {
  /** The ship whose crew repelled the boarding. */
  ship?: string;
  /** The retirement taken (`farm`, `saloon`, `cabin` in `endings.json`). */
  retirement?: string;
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
  /** The papers' name for the captain at the end, if they had one (Phase 9 piece B). */
  nickname?: string | undefined;
  /** A voluntary ending's epilogue: what became of the captain. */
  epilogue?: string[] | undefined;
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
  const nick = state.nickname?.current;
  // The papers' name for the captain heads the page once they have one (Phase 9 piece B).
  const name = (nick ?? c.name).toUpperCase();
  const titled = nick ? name : `CAPTAIN ${name}`;
  /** "Captain Ida Bergquist," or with the nickname set in, ready for an apposition. */
  const called = nick ? calledText(c.name, nick) : `Captain ${c.name},`;
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
        `${called} lately master of the schooner ${ship}, was hanged at ${lockup} at first light, taken on the lake by the revenue cutter with the whole region crying out for the capture.`,
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
      headline: nick ? `${name} SHOT DEAD` : `PIRATE ${name} SHOT DEAD`,
      deck: `Crew of the ${prize} Beat Off a Boarding; the Schooner ${ship} Found Adrift`,
      body: [
        `${called} master of the schooner ${ship}, was killed on the open lake attempting to board the ${prize}, whose crew met the attack with pistols and handspikes and drove it off.`,
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
      headline: `${titled} DROWNED`,
      deck: `Master of the Schooner ${ship} Lost in the Cold Water Ashore`,
      body: [
        `${called} master of the schooner ${ship}, went into the lake and did not come out. Superior's water is cold enough to kill a strong swimmer in minutes, and it did.`,
        `The ${ship} was found lying where the captain left her, with nobody aboard to say why.`,
        famous
          ? 'The waterfront knew the name. The lake, they say, gives up nothing it takes.'
          : 'Few on the waterfront knew the name. The lake keeps its own accounts.',
      ],
    };
  }
  if (cause === 'froze') {
    return {
      paper,
      town,
      dateline: dateline(now),
      headline: `CAPTAIN ${name} FROZEN TO DEATH`,
      deck: `Master of the Schooner ${ship} Found in the Snow`,
      body: [
        `Captain ${c.name}, master of the schooner ${ship}, was found dead of the cold, lying in the snow with no fire in reach. The winter has taken hardier men, though not many of them were out in it for honest reasons.`,
        `The ${ship} lies frozen in where she was left.`,
        famous
          ? 'The waterfront knew the name. Nobody will say what the captain was doing out there.'
          : 'Few on the waterfront knew the name. The winter keeps its own accounts.',
      ],
    };
  }
  if (cause === 'through_ice') {
    return {
      paper,
      town,
      dateline: dateline(now),
      headline: `CAPTAIN ${name} THROUGH THE ICE`,
      deck: `Master of the Schooner ${ship} Lost Off the Ice Road`,
      body: [
        `Captain ${c.name}, master of the schooner ${ship}, went through the ice and was not seen again. A hole with broken edges, and the marks of hands that could not get a grip, told the rest.`,
        `The ${ship} lies frozen in for the winter, with nobody to sail her in the spring.`,
        famous
          ? 'The waterfront knew the name. The ice, they say, does not care whose it is.'
          : 'Few on the waterfront knew the name. The lake keeps its own accounts.',
      ],
    };
  }
  if (cause === 'mauled') {
    return {
      paper,
      town,
      dateline: dateline(now),
      headline: `${titled} KILLED BY WILD BEASTS`,
      deck: `Master of the Schooner ${ship} Found Mauled on the Islands`,
      body: [
        `${called} master of the schooner ${ship}, was found dead in the woods of the islands, torn by some wild animal. A rifle lay near, and the tracks in the ground round about told of a struggle.`,
        `The ${ship} was found lying at anchor off the island with nobody aboard. What the captain was hunting there, out of season or in it, nobody would say.`,
        famous
          ? 'The waterfront knew the name. The woods, they say, keep no accounts at all.'
          : 'Few on the waterfront knew the name. The islands keep their own accounts.',
      ],
    };
  }
  if (cause === 'fell') {
    return {
      paper,
      town,
      dateline: dateline(now),
      headline: `${titled} KILLED IN A FALL`,
      deck: `Master of the Schooner ${ship} Found at the Foot of a Drop`,
      body: [
        `${called} master of the schooner ${ship}, was found dead ashore at the foot of a fall too high to walk away from. What the captain was doing up there, nobody would say.`,
        `The ${ship} lies where she was left.`,
        famous
          ? 'Some on the waterfront will not be sorry. Most will not be surprised.'
          : 'Few on the waterfront knew the name. The lake keeps its own accounts.',
      ],
    };
  }
  if (cause === 'retired' || cause === 'lawman') {
    const ending = endingPage(cause, detail.retirement);
    if (ending) {
      const p =
        ending.paper === 'duluth'
          ? PAPERS.duluth
          : ending.paper === 'bayfield'
            ? PAPERS.bayfield
            : { paper, town };
      const values = endingValues(state, now);
      return {
        ...p,
        dateline: dateline(now),
        headline: fill(ending.page.headline, values).toUpperCase(),
        deck: fill(ending.page.deck, values),
        body: ending.page.body.map((t) => fill(t, values)),
      };
    }
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
  retired: 'Retired',
  lawman: 'Turned lawman',
  froze: 'Froze to death',
  through_ice: 'Went through the ice',
  mauled: 'Mauled by a wild animal',
};

/** "How it ended", a voluntary ending's from `endings.json`. */
function endingText(cause: RunEndCause, detail: RunEndDetail): string {
  if (cause === 'retired' || cause === 'lawman') {
    return endingPage(cause, detail.retirement)?.page.ending ?? ENDINGS[cause];
  }
  return ENDINGS[cause];
}

/** "1 week", "3 weeks". */
function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? '' : 's'}`;
}

/** The values a voluntary ending's page fills (`endings.json`'s placeholders). */
function endingValues(state: WorldState, now: number): Record<string, string> {
  const c = state.player.captain;
  const nick = state.nickname?.current;
  const s = statsFor(state, now);
  return {
    name: nick ?? `Captain ${c.name}`,
    called: nick ? calledText(c.name, nick) : `Captain ${c.name},`,
    captain: c.name,
    ship: c.shipName,
    nick: nick ?? `Captain ${c.name}`,
    weeks: plural(weeksBetween(s.startedAt, now), 'week'),
    earned: formatCents(s.earnedCents, true),
    wealth: formatCents(state.player.purse + stashedCash(state.hideouts), true),
  };
}

function statsFor(state: WorldState, now: number) {
  return state.stats ?? freshStats(now);
}

function summary(
  defs: LawDefs,
  state: WorldState,
  cause: RunEndCause,
  now: number,
  detail: RunEndDetail = {},
): SummaryRow[] {
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
    ...(state.nickname?.current
      ? [{ label: 'Known to the papers as', value: state.nickname.current }]
      : []),
    { label: 'Most wanted as', value: tierDef(defs, peakTier).name },
    { label: 'Crimes', value: String(s.crimes) },
    { label: 'Contracts delivered', value: String(s.contracts) },
    { label: 'Taken by the law', value: `${s.captures} time${s.captures === 1 ? '' : 's'}` },
    {
      label: 'Lives taken',
      value: s.killed ? `${s.killed} soul${s.killed === 1 ? '' : 's'}` : 'Never killed a soul',
    },
    { label: 'How it ended', value: endingText(cause, detail) },
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

/** The Hall of Captains' line, before the date. */
function epitaphText(state: WorldState, cause: RunEndCause, detail: RunEndDetail): string {
  switch (cause) {
    case 'executed':
      return `Hanged at ${state.jail ? (portInfo(state.jail.port)?.name ?? 'Bayfield') : 'Bayfield'}`;
    case 'killed':
      return `Killed boarding the ${detail.ship ?? 'a prize'}`;
    case 'drowned':
      return 'Drowned in the cold water';
    case 'fell':
      return 'Killed in a fall ashore';
    case 'mauled':
      return 'Mauled on the islands';
    case 'retired':
      return (
        retirementDef(detail.retirement)?.page.epitaph ??
        endingPage(cause, detail.retirement)?.page.epitaph ??
        'Retired'
      );
    case 'lawman':
      return endingPage(cause, undefined)?.page.epitaph ?? 'Turned lawman';
    default:
      return 'Went ashore for good';
  }
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
  const voluntary =
    cause === 'retired' || cause === 'lawman' ? endingPage(cause, detail.retirement) : undefined;
  const values = voluntary ? endingValues(state, now) : {};
  const epilogue = voluntary?.page.epilogue.map((t) => fill(t, values));
  return {
    version: 1,
    cause,
    captain: c.name,
    shipName: c.shipName,
    portrait: c.portrait,
    endedAt: now,
    endedAtIso: realNow.toISOString(),
    frontPage: page,
    summary: summary(defs, state, cause, now, detail),
    logbook: logbookMarkdown(c.name, c.shipName, state.logbook ?? [], ending),
    epitaph: `${epitaphText(state, cause, detail)}, ${dateText(now)}`,
    ...(state.nickname?.current ? { nickname: state.nickname.current } : {}),
    ...(epilogue ? { epilogue } : {}),
  };
}
