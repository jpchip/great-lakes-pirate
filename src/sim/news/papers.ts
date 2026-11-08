import newspapersJson from '../../../data/newspapers.json';
import {
  newspapersFileSchema,
  type NewspapersFile,
  type NewsTemplate,
  type PaperDef,
  type StoryDef,
  type StoryKind,
} from '../../../data/schemas/newspapers';
import { Rng } from '../../core/rng';
import { SECONDS_PER_GAME_DAY } from '../../core/time';
import { formatCents } from '../economy/knowledge';
import { portInfo } from '../economy/defs';
import { fameTier, topWantedTier, type LawDefs } from '../law/defs';
import { addHeat, gainFame, type LawEvent, type LawWorld } from '../law/law';
import { posterFor } from '../law/port-law';
import { dateline } from '../run/run-end';
import type { Identification } from '../law/witness';
import type { Article, Edition, NewsState, Story, WantedNotice } from './state';

/**
 * Newspapers v1 (plan 12 §6, plan 06 §9; Phase 5 piece F).
 *
 * - **Stories** come from events with news value (`addStory`): the crimes the law hears
 *   of, seizures, the cutter outrun, capture and release, fines, and honest feats.
 * - **Editions:** each of the four papers goes to press once a game day (a calendar week),
 *   at `pressHour`. News from a paper's own region reaches it after `delayHours.home`,
 *   from elsewhere after `delayHours.away`, so a story is printed a few days late, in the
 *   first edition after it arrives, and each paper prints it once.
 * - **Yellow journalism** (plan 06 §4.1): the more Fame you have the louder the headline
 *   (lurid templates from `luridFromFameTier`, an epithet, quantities inflated), and each
 *   printing about you by name adds Fame: the story's own, times the paper's factor (the
 *   Duluth daily the most), times the exaggeration. The first printing of a crime adds
 *   `extraHeat` of its heat in its region.
 * - **Respectable Captain** (plan 06 §4.3): honest feats are stories too, but their Fame
 *   stops at `feats.fameCap` (the top of tier 2).
 * - Every edition also carries the WANTED column (the posters of the regions it covers),
 *   cutter sightings, the weather outlook with the ports flying the storm signal, and an ad.
 */

export interface NewsDefs {
  file: NewspapersFile;
  papers: readonly PaperDef[];
  paperById: ReadonlyMap<string, PaperDef>;
}

export function compileNews(file: NewspapersFile): NewsDefs {
  return { file, papers: file.papers, paperById: new Map(file.papers.map((p) => [p.id, p])) };
}

let cached: NewsDefs | undefined;
export function gameNews(): NewsDefs {
  cached ??= compileNews(newspapersFileSchema.parse(newspapersJson));
  return cached;
}

/** What the press needs from the rest of the run. */
export interface PressWorld {
  law: LawDefs;
  lawWorld: LawWorld;
  captain: string;
  ship: string;
  seed: string;
  goodName(good: string): string;
  /** The cutter sightings column as it stands at press time. */
  cutter(): string[];
  /** The outlook for the paper's town and the ports flying the storm signal. */
  weather(paper: PaperDef): { text: string; signals: string[] };
}

export interface StoryInput {
  kind: StoryKind;
  key: string;
  at: number;
  region: string;
  port?: string | undefined;
  ident: Identification;
  crime?: string | undefined;
  goods?: { good: string; qty: number }[] | undefined;
  tier?: number | undefined;
  heat?: number | undefined;
}

const IDENT_ORDER: readonly Identification[] = ['unknown', 'schooner', 'ship', 'person'];

export function named(ident: Identification): boolean {
  return ident === 'ship' || ident === 'person';
}

/** The story's template set, or undefined for a crime the papers have no lines for. */
export function storyDef(defs: NewsDefs, s: Pick<Story, 'kind' | 'crime'>): StoryDef | undefined {
  const st = defs.file.stories;
  if (s.kind === 'crime') return s.crime ? st.crime[s.crime] : undefined;
  return st[s.kind];
}

/**
 * Adds a story, or folds it into the same news already waiting (a second report on one
 * crime names you better, adds its heat). Returns the story, or undefined when the papers
 * have nothing to say about it.
 */
export function addStory(defs: NewsDefs, news: NewsState, input: StoryInput): Story | undefined {
  if (!storyDef(defs, input)) return undefined;
  const same = news.stories.find((s) => s.key === input.key);
  if (same) {
    if (IDENT_ORDER.indexOf(input.ident) > IDENT_ORDER.indexOf(same.ident)) {
      same.ident = input.ident;
    }
    same.heat += input.heat ?? 0;
    if (input.goods) same.goods = [...(same.goods ?? []), ...input.goods];
    return same;
  }
  const story: Story = {
    id: `story-${news.nextId++}`,
    kind: input.kind,
    key: input.key,
    at: input.at,
    region: input.region,
    ...(input.port ? { port: input.port } : {}),
    ident: input.ident,
    ...(input.crime ? { crime: input.crime } : {}),
    ...(input.goods ? { goods: input.goods } : {}),
    ...(input.tier !== undefined ? { tier: input.tier } : {}),
    heat: input.heat ?? 0,
    printedIn: [],
    heated: false,
  };
  news.stories.push(story);
  return story;
}

/** When the paper's editions go to press on a game day. */
export function pressTime(defs: NewsDefs, day: number): number {
  return day * SECONDS_PER_GAME_DAY + defs.file.pressHour * 3600;
}

/** The first game day whose edition is still to print at `now`. */
export function pressDayAt(defs: NewsDefs, now: number): number {
  const day = Math.floor(now / SECONDS_PER_GAME_DAY);
  return now >= pressTime(defs, day) ? day : day - 1;
}

/** When news of a story reaches a paper. */
export function arrivesAt(defs: NewsDefs, paper: PaperDef, story: Story): number {
  const d = defs.file.delayHours;
  return story.at + (story.region === paper.region ? d.home : d.away) * 3600;
}

/** Does the paper print news from this region (and of this story)? */
export function covers(paper: PaperDef, story: Story, fame: number): boolean {
  if (paper.covers.includes(story.region)) return true;
  return (
    paper.coversAllFromFameTier !== undefined &&
    fame >= paper.coversAllFromFameTier &&
    named(story.ident)
  );
}

/** The stories a paper prints in the edition that goes to press at `at`, best first. */
export function storiesFor(
  defs: NewsDefs,
  news: NewsState,
  paper: PaperDef,
  at: number,
  fame: number,
): Story[] {
  const stale = defs.file.staleDays * SECONDS_PER_GAME_DAY;
  const score = (s: Story): number => (storyDef(defs, s)?.weight ?? 0) * (named(s.ident) ? 1.5 : 1);
  return news.stories
    .filter((s) => {
      if (s.printedIn.includes(paper.id) || !covers(paper, s, fame)) return false;
      const arrives = arrivesAt(defs, paper, s);
      return arrives <= at && at - arrives <= stale;
    })
    .sort((a, b) => score(b) - score(a) || b.at - a.at);
}

// ---------------------------------------------------------------------------------
// Words

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** Fills `{key}`; an upper-case key gives the value with a capital first letter. */
export function fill(template: string, values: Record<string, string>): string {
  const text = template.replace(/\{(\w+)\}/g, (_, k: string) => {
    const v = values[k] ?? values[k.toLowerCase()] ?? '';
    return k === k.toUpperCase() ? capitalize(v) : v;
  });
  return capitalize(
    text
      .replace(/\s{2,}/g, ' ')
      .replace(/\s+([,.;!?])/g, '$1')
      .trim(),
  );
}

/** How the paper names you, by how well you were seen. */
export function whoText(ident: Identification, captain: string, ship: string): string {
  switch (ident) {
    case 'person':
      return `Captain ${captain} of the schooner ${ship}`;
    case 'ship':
      return `the schooner ${ship}`;
    case 'schooner':
      return 'a schooner';
    default:
      return 'persons unknown';
  }
}

/** "120 cases of untaxed whiskey": the quantities, exaggerated by Fame. */
export function goodsText(
  defs: NewsDefs,
  goods: readonly { good: string; qty: number }[] | undefined,
  name: (good: string) => string,
  fame: number,
): string {
  if (!goods?.length) return 'a cargo';
  const totals = new Map<string, number>();
  for (const g of goods) totals.set(g.good, (totals.get(g.good) ?? 0) + g.qty);
  const k = 1 + defs.file.exaggeration.quantityPerTier * fame;
  const parts = [...totals].map(([good, qty]) => {
    const n = Math.max(1, Math.round(qty * k));
    return `${n} ${defs.file.units[good] ?? 'barrels'} of ${name(good).toLowerCase()}`;
  });
  return parts.length > 1
    ? `${parts.slice(0, -1).join(', ')} and ${parts.at(-1) ?? ''}`
    : (parts[0] ?? 'a cargo');
}

function pick<T>(rng: Rng, items: readonly T[]): T {
  return items[Math.floor(rng.next() * items.length)] ?? (items[0] as T);
}

function regionName(law: LawDefs, region: string): string {
  return law.regionById.get(region)?.name ?? region;
}

function portName(port: string | undefined, fallback: string): string {
  return (port && portInfo(port)?.name) || fallback;
}

/** The story as a paper prints it. */
export function renderStory(
  defs: NewsDefs,
  world: PressWorld,
  story: Story,
  paper: PaperDef,
  fame: number,
): Article {
  const def = storyDef(defs, story);
  if (!def) throw new Error(`No lines for ${story.kind} ${story.crime ?? ''}`);
  const ex = defs.file.exaggeration;
  const isNamed = named(story.ident);
  const set: readonly NewsTemplate[] =
    !isNamed && def.unnamed
      ? def.unnamed
      : fame >= ex.luridFromFameTier && def.lurid
        ? def.lurid
        : def.plain;
  const rng = Rng.fromSeed(`${world.seed}|news|${story.id}|${paper.id}`);
  const t = pick(rng, set);
  const region = regionName(world.law, story.region);
  const seat = world.law.regionById.get(story.region)?.seat;
  const poster = posterFor(world.law, world.lawWorld.law, story.region);
  const values: Record<string, string> = {
    who: whoText(story.ident, world.captain, world.ship),
    captain: world.captain,
    ship: world.ship,
    region,
    port: portName(story.port ?? seat, region),
    goods: goodsText(defs, story.goods, world.goodName, fame),
    reward: poster?.rewardCents
      ? `${formatCents(poster.rewardCents, true)} Reward`
      : 'Reward Offered',
    epithet: isNamed ? (ex.epithets[Math.min(fame, ex.epithets.length - 1)] ?? '') : '',
    town: paper.town,
  };
  return {
    headline: fill(t.headline, values).toUpperCase(),
    deck: fill(t.deck, values),
    body: fill(t.body, values),
    story: story.id,
    aboutYou: isNamed,
  };
}

/** The paper's WANTED column: a notice for each region it covers with a poster up. */
export function wantedColumn(world: PressWorld, paper: PaperDef, fame: number): WantedNotice[] {
  const { law } = world;
  const all = paper.coversAllFromFameTier !== undefined && fame >= paper.coversAllFromFameTier;
  const regions = all ? law.regions.map((r) => r.id) : paper.covers;
  const out: WantedNotice[] = [];
  for (const region of regions) {
    const p = posterFor(law, world.lawWorld.law, region);
    if (!p) continue;
    const ship = `The schooner ${world.ship}`;
    const captain = `Captain ${world.captain}`;
    out.push({
      region,
      tier: p.tier,
      headline: p.headline,
      subject: p.subject === 'ship' ? ship : captain,
      detail: p.subject === 'ship' ? `Master: ${captain}` : `Of the schooner ${world.ship}`,
      charge: `For crimes against the law in ${regionName(law, region)}`,
      ...(p.rewardCents > 0 ? { reward: `${formatCents(p.rewardCents, true)} reward` } : {}),
    });
  }
  return out.sort((a, b) => b.tier - a.tier);
}

/** A week with none of your news: a local lead, chosen by the day. */
function localLead(world: PressWorld, paper: PaperDef, day: number): Article {
  const rng = Rng.fromSeed(`${world.seed}|local|${paper.id}|${day}`);
  const t = pick(rng, paper.local);
  return { headline: t.headline, deck: t.deck, body: t.body, aboutYou: false };
}

/** Fame for a printing: the story's, the paper's factor and the exaggeration; half for a brief. */
export function printingFame(
  defs: NewsDefs,
  def: StoryDef,
  paper: PaperDef,
  fame: number,
  lead: boolean,
): number {
  const k = 1 + defs.file.exaggeration.famePerTier * fame;
  return def.fame * paper.fameFactor * k * (lead ? 1 : 0.5);
}

/**
 * Prints the day's editions of every paper (plan 12 §6.1). Stories printed about you by
 * name bring Fame; a crime's first printing adds the papers' extra heat. The editions
 * replace the oldest kept.
 */
export function pressDay(
  defs: NewsDefs,
  world: PressWorld,
  news: NewsState,
  day: number,
): { editions: Edition[]; events: LawEvent[] } {
  const at = pressTime(defs, day);
  const law = world.lawWorld.law;
  const fame = fameTier(world.law, law.fame.value);
  const events: LawEvent[] = [];
  const editions: Edition[] = [];
  const cutter = world.cutter();
  for (const paper of defs.papers) {
    const stories = storiesFor(defs, news, paper, at, fame).slice(0, 1 + defs.file.briefs);
    const articles = stories.map((s) => renderStory(defs, world, s, paper, fame));
    stories.forEach((s, i) => {
      s.printedIn.push(paper.id);
      const def = storyDef(defs, s);
      if (!def) return;
      if (named(s.ident)) {
        let gain = printingFame(defs, def, paper, fame, i === 0);
        if (def.feat) gain = Math.min(gain, Math.max(0, defs.file.feats.fameCap - law.fame.value));
        const e = gainFame(world.law, law, gain, at);
        if (e) events.push(e);
      }
      if (!s.heated && s.heat > 0) {
        s.heated = true;
        events.push(
          ...addHeat(world.law, law, s.region, s.heat * defs.file.exaggeration.extraHeat, at),
        );
      }
    });
    const rng = Rng.fromSeed(`${world.seed}|ad|${paper.id}|${day}`);
    const edition: Edition = {
      paper: paper.id,
      day,
      at,
      lead: articles[0] ?? localLead(world, paper, day),
      briefs: articles.slice(1),
      wanted: wantedColumn(world, paper, fame),
      cutter,
      weather: world.weather(paper),
      ad: pick(rng, paper.ads),
    };
    const kept = (news.editions[paper.id] ??= []);
    kept.unshift(edition);
    kept.splice(defs.file.keepEditions);
    editions.push(edition);
  }
  news.printedDay = day;
  // Stories past every paper's window go.
  const gone = at - (defs.file.staleDays + 2) * SECONDS_PER_GAME_DAY;
  news.stories = news.stories.filter((s) => s.at >= gone);
  return { editions, events };
}

// ---------------------------------------------------------------------------------
// Where papers are read

export function papersSoldAt(defs: NewsDefs, port: string): PaperDef[] {
  return defs.papers.filter((p) => p.sold.includes(port));
}

/** The paper the paper boy cries in a port: the town's own, else the first sold there. */
export function homePaper(defs: NewsDefs, port: string): PaperDef | undefined {
  const sold = papersSoldAt(defs, port);
  const region = portInfo(port)?.wantedRegion;
  return sold.find((p) => p.region === region) ?? sold[0];
}

/** A region's paper: its own, else the nearest one covering it (its first-listed regions). */
export function paperOfRegion(defs: NewsDefs, region: string): PaperDef {
  const home = defs.papers.find((p) => p.region === region);
  if (home) return home;
  const covering = defs.papers
    .filter((p) => p.covers.includes(region))
    .sort(
      (a, b) => a.covers.indexOf(region) - b.covers.indexOf(region) || b.fameFactor - a.fameFactor,
    );
  return covering[0] ?? (defs.papers[0] as PaperDef);
}

export function latestEdition(news: NewsState, paper: string): Edition | undefined {
  return news.editions[paper]?.[0];
}

// ---------------------------------------------------------------------------------
// The tier-5 front page (plan 13 §12: a full-screen "WANTED: DEAD OR ALIVE" page)

export interface MostWantedPage {
  paper: string;
  town: string;
  state: string;
  dateline: string;
  headline: string;
  deck: string;
  body: string[];
  region: string;
  reward: string | undefined;
}

export function mostWantedPage(
  defs: NewsDefs,
  world: PressWorld,
  region: string,
  now: number,
): MostWantedPage {
  const paper = paperOfRegion(defs, region);
  const name = regionName(world.law, region);
  const poster = posterFor(world.law, world.lawWorld.law, region);
  const reward = poster?.rewardCents
    ? `${formatCents(poster.rewardCents, true)} reward`
    : undefined;
  return {
    paper: paper.name,
    town: paper.town,
    state: paper.state,
    dateline: dateline(now),
    headline: 'WANTED: DEAD OR ALIVE',
    deck: `Captain ${world.captain} of the Schooner ${world.ship}${reward ? `; ${capitalize(reward)}` : ''}`,
    body: [
      `The authorities in ${name} have declared Captain ${world.captain}, master of the schooner ${world.ship}, an outlaw. Any officer of the law may take the captain dead or alive, and the revenue cutter Morrill and a chartered tug with deputies aboard are out after the vessel.`,
      `Taken in ${name} now, the captain will not see a courtroom: capture means the rope. The harbor masters have orders to take no fine and no money for the matter.`,
      `Citizens with knowledge of the schooner's whereabouts are asked to come forward. The waterfront has not seen such a hue and cry in a generation.`,
    ],
    region,
    reward,
  };
}

/** Is the region at the top tier? (Most Wanted.) */
export function isMostWanted(law: LawDefs, tier: number): boolean {
  return tier >= topWantedTier(law);
}
