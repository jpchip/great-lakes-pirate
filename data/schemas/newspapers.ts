import { z } from 'zod';
import { idOf } from './common';

/**
 * The papers (plan 12 §6, plan 06 §9; Phase 5 piece F, `newspapers.json`): the four
 * regional papers, the regions each covers and the ports that sell it, how late news
 * reaches it, and the headline templates for each kind of story.
 *
 * Templates fill `{placeholders}` from the story: `{who}` (the captain, the ship, "a
 * schooner" or "persons unknown", as the witness saw it), `{WHO}` (the same in capitals,
 * for headlines), `{captain}`, `{ship}`, `{region}`, `{port}`, `{goods}` (quantities
 * exaggerated by Fame), `{reward}`, `{epithet}` ("the notorious") and `{town}` (the
 * paper's own).
 */

const templateSchema = z.object({
  headline: z.string().min(1),
  deck: z.string().min(1),
  body: z.string().min(1),
});
export type NewsTemplate = z.infer<typeof templateSchema>;

/** One story kind's lines: plain while Fame is low, lurid once the papers know you. */
const storySchema = z.object({
  /** Fame a printing gives, before the paper's factor and the exaggeration. */
  fame: z.number().nonnegative(),
  /** How strongly it bids for the front page. */
  weight: z.number().positive(),
  /** An honest feat (Respectable Captain, plan 06 §4.3): its Fame stops at `feats.fameCap`. */
  feat: z.boolean().default(false),
  plain: z.array(templateSchema).min(1),
  lurid: z.array(templateSchema).optional(),
  /** When the witness only saw "a schooner" or "someone": no name, no Fame. */
  unnamed: z.array(templateSchema).optional(),
});
export type StoryDef = z.infer<typeof storySchema>;

export const STORY_KINDS = [
  'crime',
  'seizure',
  'wanted',
  'mostWanted',
  'captured',
  'released',
  'escape',
  'fined',
  'recordRun',
  'firstBoat',
  'galeRun',
] as const;
export type StoryKind = (typeof STORY_KINDS)[number];

const paperSchema = z.object({
  id: idOf('paper'),
  name: z.string().min(1),
  town: z.string().min(1),
  /** "Wis." or "Minn.", for the masthead. */
  state: z.string().min(1),
  /** The paper's home region: its news comes soonest. */
  region: idOf('region'),
  /** Regions it prints news from. */
  covers: z.array(idOf('region')).min(1),
  /** From this Fame tier it prints your doings anywhere on the lake (the big-city daily). */
  coversAllFromFameTier: z.number().int().min(0).optional(),
  /** Ports that sell it. */
  sold: z.array(idOf('port')).min(1),
  /** Its Fame multiplier (yellow journalism: the Duluth daily is the biggest). */
  fameFactor: z.number().nonnegative(),
  /** Price, cents. */
  priceCents: z.number().int().nonnegative(),
  character: z.string().min(1),
  /** Front-page leads on a week with nothing of yours to print. */
  local: z.array(templateSchema).min(1),
  ads: z.array(z.string().min(1)).min(1),
});
export type PaperDef = z.infer<typeof paperSchema>;

export const newspapersFileSchema = z.object({
  papers: z.array(paperSchema).min(1),
  /** Game hour each day's editions go to press (plan 12 §6.1: a new edition each game day). */
  pressHour: z.number().min(0).max(23),
  /** Game hours before news reaches a paper: from its own region, and from elsewhere. */
  delayHours: z.object({ home: z.number().nonnegative(), away: z.number().nonnegative() }),
  /** News older than this when it could first be printed is dropped, game days. */
  staleDays: z.number().positive(),
  /** Editions each paper keeps (the save). */
  keepEditions: z.number().int().positive(),
  /** Briefs under the lead. */
  briefs: z.number().int().nonnegative(),
  /**
   * Yellow journalism (plan 06 §4.1): a headline's Fame grows by `famePerTier` for each of
   * your Fame tiers, quantities by `quantityPerTier`, and the first printing of a crime
   * adds `extraHeat` of its heat in its region.
   */
  exaggeration: z.object({
    famePerTier: z.number().nonnegative(),
    quantityPerTier: z.number().nonnegative(),
    luridFromFameTier: z.number().int().min(0),
    extraHeat: z.number().min(0).max(1),
    epithets: z.array(z.string()).min(1),
  }),
  /** Respectable Captain (plan 06 §4.3): honest feats raise Fame only so far. */
  feats: z.object({
    fameCap: z.number().nonnegative(),
    /** A delivery inside this share of the time allowed is a record run. */
    recordShare: z.number().min(0).max(1),
    /** Months (0 = January) when the first boat in after the ice is news. */
    iceOutMonths: z.array(z.number().int().min(0).max(11)).min(1),
    /** Docking with the storm signal up and the wind at least this, knots. */
    galeKn: z.number().positive(),
  }),
  /** The paper's goods word for a good, when "barrels of" won't do. */
  units: z.record(idOf('good'), z.string().min(1)),
  stories: z.object({
    crime: z.record(idOf('crime'), storySchema),
    seizure: storySchema,
    wanted: storySchema,
    mostWanted: storySchema,
    captured: storySchema,
    released: storySchema,
    escape: storySchema,
    fined: storySchema,
    recordRun: storySchema,
    firstBoat: storySchema,
    galeRun: storySchema,
  }),
  /** The cutter sightings column, by what she's about. */
  cutter: z.record(z.string(), z.string().min(1)),
  /** The tier-5 tug, out after you. */
  tug: z.string().min(1),
});
export type NewspapersFile = z.infer<typeof newspapersFileSchema>;
