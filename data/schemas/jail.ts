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
  /**
   * A minor arrest on foot (a guard takes you for a knife in hand, trespass, skulking...):
   * at `maxTier` or below, with one of these conduct reasons, you pay a fine from the
   * purse, by tier (the last entry for any tier past the list), and nothing else is taken.
   * With the purse short, it's `sentenceWeeks` in the lockup, with no confiscation, no
   * impound and no bail.
   */
  minorArrest: z.object({
    maxTier: z.number().int().min(0),
    conduct: z.array(z.string().min(1)),
    fineCents: z.array(z.number().int().nonnegative()).min(1),
    sentenceWeeks: z.number().int().positive(),
  }),
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
  /**
   * The jailbreak (plan 08 §9; Phase 7 piece G): the lockup's cell played on foot at night
   * with nothing in your pockets. Seconds are real seconds unless they say otherwise.
   */
  jailbreak: z.object({
    /** The attempt starts at this hour of the night, and is over at `dawnHour`. */
    startHour: z.number().min(0).max(24),
    dawnHour: z.number().min(0).max(24),
    /** The layout's door of the cell you're held in, and its lock's tier. */
    cellDoor: z.string().min(1),
    cellLock: z.number().int().min(1).max(3),
    /** Recaptured: this many weeks more. */
    recaptureWeeks: z.number().int().positive(),
    /** The jailer's round: at his desk, a look into the cells, then by the bars with his back turned. */
    jailer: z.object({
      deskWaitS: z.number().positive(),
      lookS: z.number().positive(),
      barsWaitS: z.number().positive(),
    }),
    /** His keys off his belt through the bars while he isn't looking. */
    keys: z.object({ liftS: z.number().positive(), reachM: z.number().positive() }),
    /** Banging on the bars: how far it carries, and how soon you can again. */
    bang: z.object({ radiusM: z.number().positive(), cooldownS: z.number().nonnegative() }),
    /**
     * A promise of stashed money: taken at `maxTier` or below, for `cents` by the tier you
     * were taken at, due in `dueDays` game days. What isn't paid then is `heat` in the
     * lockup's region.
     */
    promise: z.object({
      maxTier: z.number().int().min(0),
      cents: z.array(z.number().int().positive()).min(1),
      dueDays: z.number().positive(),
      heat: z.number().nonnegative(),
      talkM: z.number().positive(),
    }),
    /** Tier 5: in irons, which take this long to slip. */
    irons: z.object({ slipS: z.number().positive() }),
    /** Tier 5: more of the law in the lockup. */
    execution: z.object({
      constables: z.number().int().nonnegative(),
      marshals: z.number().int().nonnegative(),
    }),
  }),
});
export type JailbreakRules = JailFile['jailbreak'];
export type JailFile = z.infer<typeof jailFileSchema>;
