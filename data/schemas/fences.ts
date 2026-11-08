import { z } from 'zod';
import { idOf } from './common';

/**
 * Fences in the ports (plan 05 §6.2; Phase 6 piece E, decision 1 of plan 07 §14.6): a man
 * in a saloon's back room after dark who buys hot goods and contraband with no detection
 * risk, at 40–70% of their value by your Fame, his trust in you and the lot's heat, out of
 * a week's cash. The shady shipwright keeps the same hours in the same room. Until the
 * docks districts (Phase 7) it's a tab on the port screen; the walkable room keeps this data.
 * One game day is a calendar week (plan 04 §3.3), so his cash comes back every night.
 */
export const fenceSchema = z.object({
  id: idOf('fence'),
  /** The port whose screen shows his back room (ports.json). */
  port: idOf('port'),
  /** His name, fictional (plan 05 §10). */
  name: z.string().min(1),
  /** "the back room of the Pier Saloon": where he sits, for the tab's first line. */
  where: z.string().min(1),
  /** A line on who he is. */
  blurb: z.string().min(1),
  /** The Fame tier you need before he'll see you (plan 05 §6.2: Bayfield 0, Duluth Known). */
  fameTier: z.number().int().min(0),
  /** He's there once the sun is this far below the horizon (−6° ends civil twilight). */
  darkSunDeg: z.number().max(0),
  /** His cash for buying from you, a night (a calendar week), integer cents. */
  weeklyCashCents: z.number().int().positive(),
  /**
   * The goods he wants (Bayfield: fish and furs); absent, he takes anything. Other goods
   * he takes at `offLine` of his rate.
   */
  prefers: z.array(idOf('good')).optional(),
  offLine: z.number().min(0).max(1),
  /**
   * His rate as a share of a good's base value: `min`, plus `perFameTier` a Fame tier, plus
   * up to `trust` as your dealings add up to `trustAtCents`, plus up to `cool` as a lot's
   * heat cools (contraband has none), never above `max`.
   */
  rate: z.object({
    min: z.number().min(0).max(1),
    perFameTier: z.number().min(0).max(1),
    trust: z.number().min(0).max(1),
    cool: z.number().min(0).max(1),
    max: z.number().min(0).max(1),
    trustAtCents: z.number().int().positive(),
  }),
  /** The shady shipwright works out of the same room (plan 10 §6). */
  shipwright: z.boolean(),
});

export type Fence = z.infer<typeof fenceSchema>;

export const fencesFileSchema = z.array(fenceSchema).min(1);
