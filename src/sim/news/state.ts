import { z } from 'zod';
import { IDENTIFICATIONS } from '../../../data/schemas/law';
import { STORY_KINDS } from '../../../data/schemas/newspapers';

/**
 * The papers' saved slice (plan 12 §10 `newspapers {editions: last N per paper}`; Phase 5
 * piece F). Optional in the save like `stats`: a run without it starts with no news, so
 * no version bump.
 *
 * A **story** is something with news value that happened (a crime the law heard of, a
 * seizure, the cutter outrun, an honest feat). Each paper prints it once, in its first
 * edition after the news reaches it, and the printing is when Fame moves. An **edition**
 * is what a paper printed that day, already in words, so reading it later shows the news
 * as it stood then.
 */

export const storySchema = z.object({
  id: z.string(),
  kind: z.enum(STORY_KINDS),
  /** The same news twice (two reports on one crime) is one story. */
  key: z.string(),
  at: z.number(),
  region: z.string(),
  port: z.string().optional(),
  /** How well the paper can name you: as the best witness did. */
  ident: z.enum(IDENTIFICATIONS),
  crime: z.string().optional(),
  goods: z.array(z.object({ good: z.string(), qty: z.number().positive() })).optional(),
  tier: z.number().int().optional(),
  /** Heat the law added for it: the first printing adds the papers' share on top. */
  heat: z.number().nonnegative().default(0),
  printedIn: z.array(z.string()).default([]),
  /** The papers' extra heat has been added. */
  heated: z.boolean().default(false),
});
export type Story = z.infer<typeof storySchema>;

export const articleSchema = z.object({
  headline: z.string(),
  deck: z.string(),
  body: z.string(),
  story: z.string().optional(),
  /** It's about you, by name or by your ship's. */
  aboutYou: z.boolean(),
});
export type Article = z.infer<typeof articleSchema>;

export const wantedNoticeSchema = z.object({
  region: z.string(),
  tier: z.number().int(),
  headline: z.string(),
  subject: z.string(),
  detail: z.string(),
  charge: z.string(),
  reward: z.string().optional(),
});
export type WantedNotice = z.infer<typeof wantedNoticeSchema>;

export const editionSchema = z.object({
  paper: z.string(),
  /** The game day it was printed. */
  day: z.number().int(),
  at: z.number(),
  lead: articleSchema,
  briefs: z.array(articleSchema),
  wanted: z.array(wantedNoticeSchema),
  /** The cutter sightings column. */
  cutter: z.array(z.string()),
  weather: z.object({
    text: z.string(),
    /** Ports flying the storm signal when it went to press. */
    signals: z.array(z.string()),
  }),
  ad: z.string(),
});
export type Edition = z.infer<typeof editionSchema>;

export const newsSchema = z.object({
  nextId: z.number().int().positive(),
  stories: z.array(storySchema),
  editions: z.record(z.string(), z.array(editionSchema)),
  /** The last game day the papers went to press. */
  printedDay: z.number().int(),
  /** The day of the newest edition of each paper you've bought. */
  read: z.record(z.string(), z.number().int()).default({}),
  /** Regions whose Most Wanted front page has been shown (plan 13 §12: once per region). */
  mostWantedShown: z.array(z.string()).default([]),
  /** The year the first boat in after the ice was you (one a season). */
  firstBoatYear: z.number().int().optional(),
});
export type NewsState = z.infer<typeof newsSchema>;

export function freshNews(printedDay: number): NewsState {
  return {
    nextId: 1,
    stories: [],
    editions: {},
    printedDay,
    read: {},
    mostWantedShown: [],
  };
}
