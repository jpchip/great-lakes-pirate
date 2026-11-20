import { z } from 'zod';
import { idOf } from './common';

/**
 * The voluntary endings (plan 12 §4.2, §9; plan 11 §18.4 piece B; `endings.json`). There's
 * no win, but a run can end on your terms: **Retire** (money enough and no region hunting
 * you) to one of three places, or **Turn Lawman** (famous, wanted nowhere to speak of, and
 * in good standing) with a deputy marshal's badge. Each is offered by a letter at the
 * harbor masters' (a sandbox event in `events.json` with `draw: false`), whose choices
 * name the ending; the run ends with its front page and epilogue.
 *
 * The pages fill `{placeholders}`: `{name}` (your nickname, or Captain and your name),
 * `{called}` (your name with the nickname set in), `{captain}`, `{ship}`, `{weeks}`,
 * `{earned}` (money earned, all run), `{wealth}` (money left, aboard and stashed) and
 * `{nick}`. A capital first letter capitalizes the value (`{Name}`).
 */

const pageSchema = z.object({
  headline: z.string().min(1),
  deck: z.string().min(1),
  body: z.array(z.string().min(1)).min(1),
  /** What became of the captain, under the run summary. */
  epilogue: z.array(z.string().min(1)).min(1),
  /** The Hall of Captains' line, before the date. */
  epitaph: z.string().min(1),
  /** The run summary's "How it ended". */
  ending: z.string().min(1),
});
export type EndingPage = z.infer<typeof pageSchema>;

const retirementSchema = z.object({
  id: z.string().regex(/^[a-z_]+$/),
  /** The offer letter's choice that takes it. */
  choice: z.string().regex(/^[a-z0-9_]+$/),
  place: z.string().min(1),
  /** Which paper prints it: the Duluth daily, the Bayfield weekly, or by your Fame. */
  paper: z.enum(['duluth', 'bayfield', 'fame']).default('fame'),
  page: pageSchema,
});
export type RetirementDef = z.infer<typeof retirementSchema>;

export const endingsFileSchema = z.object({
  /** Game hours between looks at whether an offer is due. */
  checkHours: z.number().positive(),
  retire: z.object({
    /** Cash aboard and stashed in your hideouts, cents. */
    wealthCents: z.number().int().positive(),
    /** No region may be above this Wanted tier. */
    maxWantedTier: z.number().int().min(0),
    /** The offer's event. */
    event: idOf('event'),
    retirements: z.array(retirementSchema).min(1),
  }),
  lawman: z.object({
    minFameTier: z.number().int().min(0),
    /** Every region at this Wanted tier or below. */
    maxWantedTier: z.number().int().min(0),
    /** Standing at least `min` in at least `ports` ports. */
    standing: z.object({
      min: z.number().min(0).max(100),
      ports: z.number().int().positive(),
    }),
    event: idOf('event'),
    /** The letter's choice that takes the badge. */
    choice: z.string().regex(/^[a-z0-9_]+$/),
    paper: z.enum(['duluth', 'bayfield', 'fame']).default('fame'),
    page: pageSchema,
  }),
});
export type EndingsFile = z.infer<typeof endingsFileSchema>;
