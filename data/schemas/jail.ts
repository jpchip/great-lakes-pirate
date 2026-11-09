import { z } from 'zod';
import { idOf } from './common';

/** A low–high pair, low first. */
const range = z
  .tuple([z.number().nonnegative(), z.number().nonnegative()])
  .refine(([lo, hi]) => hi >= lo, 'Expected [low, high]');

/**
 * Jail (plan 12 §8.1, plan 06 §8; Phase 5 piece D): where prisoners are held, the sentence
 * and bail by the region's tier at capture, the impound fee for the ship and "send word".
 */
export const jailFileSchema = z.object({
  /** The MVP holds every prisoner in Bayfield's lockup (plan 06 §8.2). */
  lockup: z.object({
    name: z.string().min(1),
    port: idOf('port'),
    region: idOf('region'),
    /** The pier the impounded ship is returned to. */
    pier: idOf('pier'),
  }),
  /**
   * By tier: the sentence in weeks (1 game day each) and bail in cents, from the low end at
   * the tier's least heat to the high end at the next tier's.
   */
  sentences: z
    .array(
      z.object({
        tier: z.number().int().min(0),
        weeks: range,
        bailCents: range,
      }),
    )
    .min(1),
  /** Captured at this tier or above: the rope (decided: tier 5). */
  executionFromTier: z.number().int().min(1),
  /** Heat comes down to this tier after time served (plan 06 §8.2: tier 1). */
  releaseTier: z.number().int().min(0),
  impound: z.object({
    baseCents: z.number().int().nonnegative(),
    perWeekCents: z.number().int().nonnegative(),
    /** A fee nobody can pay is worked off on the coal dock, this much a game day. */
    workOffCentsPerDay: z.number().int().positive(),
  }),
  /** Bail from a hideout's strongbox by messenger (plan 12 §8.1). */
  sendWord: z.object({
    feeCents: z.number().int().nonnegative(),
    /** Game hours until the money comes. */
    delayHours: range,
  }),
  /**
   * Abandoning your own ship when she founders (plan 07 §14.6 decision 2; Phase 6 piece F):
   * a passing vessel picks you up and lands you at the nearest port with a shipyard, where
   * the yard sells you a worn hull of `hullClass` for `wornShare` of a new one's price,
   * paid from the purse, then the strongboxes by word, and the rest worked off at the yard.
   */
  abandon: z.object({
    /** Game hours in the boat before a ship picks you up and lands you. */
    rescueHours: range,
    hullClass: idOf('ship'),
    wornShare: z.number().positive().max(1),
    wornHull01: z.number().positive().max(1),
    wornRigging01: z.number().positive().max(1),
    /** Wages at the yard toward what's still owed, cents a game day (a week). */
    workCentsPerDay: z.number().int().positive(),
  }),
});
export type JailFile = z.infer<typeof jailFileSchema>;
