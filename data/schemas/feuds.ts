import { z } from 'zod';
import { idOf } from './common';

/**
 * Feud chains (plan 12 §5.2; plan 11 §18.4 piece D; `feuds.json`). A feud is a company that
 * turns on you over a trade you share: the Hollister feud is the fish packer at Bayfield,
 * who notices you selling fish on their dock, undercuts your price, then turns your catch
 * away. You push back by any of three ways (the `methods`): crimes at their sheds, crimes
 * against their tugs, or out-trading them (fish sold elsewhere and Standing won in their own
 * town). It ends when one side gives: they write offering peace once your pressure is
 * enough, or you take the terms they offer by letter.
 *
 * Economic and crime only (plan 05 §8.2: companies don't arm up). Each beat is a sandbox
 * event in `events.json` (with `draw: false`), so it reaches you by the event's channels.
 */

export const FEUD_METHODS = ['sheds', 'tugs', 'trade'] as const;
export type FeudMethod = (typeof FEUD_METHODS)[number];

export const feudDefSchema = z.object({
  id: idOf('feud'),
  company: idOf('company'),
  /** Where the company buys the goods: its undercut and refusals hold here. */
  ports: z.array(idOf('port')).min(1),
  /** The goods the feud is over. */
  goods: z.array(idOf('good')).min(1),
  /** Sales of the goods at its ports this many times within these game days start it. */
  notice: z.object({ sales: z.number().int().positive(), withinDays: z.number().positive() }),
  /** What the company pays you at its ports once the feud is on: a share of the price. */
  undercut: z.number().min(0).max(1),
  /** Undercut sales, or game days of undercutting, before it turns your goods away. */
  refuse: z.object({ afterSales: z.number().int().positive(), afterDays: z.number().positive() }),
  /** Game days refusing before it offers terms by letter, and between offers. */
  terms: z.object({ afterDays: z.number().positive(), againDays: z.number().positive() }),
  pressure: z.object({
    /** The total that makes the company give. */
    gives: z.number().positive(),
    /** Crimes against the company: their method and their weight, named to you or not. */
    crimes: z.record(
      idOf('crime'),
      z.object({ method: z.enum(['sheds', 'tugs']), points: z.number().positive() }),
    ),
    /** Out-trading: per CU of the goods sold at another port while it's on. */
    perCuElsewhere: z.number().nonnegative(),
    /** And per point of Standing won at its first port since it began. */
    perStanding: z.number().nonnegative(),
    /** Crime pressure past this has the company post a reward with the law (once). */
    rewardAt: z.number().positive(),
  }),
  ends: z.object({
    /** They gave: what they pay you at their ports after (the Fame is the event's). */
    won: z.object({ factor: z.number().positive() }),
    /** You gave: their price, for good. */
    yielded: z.object({ factor: z.number().positive() }),
  }),
  /** The beats' sandbox events. */
  events: z.object({
    undercut: idOf('event'),
    refuses: idOf('event'),
    reward: idOf('event'),
    terms: idOf('event'),
    /** The terms letter's choice that gives in. */
    acceptChoice: z.string().min(1),
    yielded: idOf('event'),
    gives: z.record(z.enum(FEUD_METHODS), idOf('event')),
  }),
});
export type FeudDef = z.infer<typeof feudDefSchema>;

export const feudsFileSchema = z.array(feudDefSchema).min(1);
export type FeudsFile = z.infer<typeof feudsFileSchema>;
