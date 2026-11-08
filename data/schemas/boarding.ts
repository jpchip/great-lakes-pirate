import { z } from 'zod';

/**
 * Boarding, looting and the aftermath (plan 07 §6, §7; Phase 6 piece D): the numbers the
 * boarding check, the transfer screen and the four choices for a taken ship run on.
 * Shares are 0–1; times are game minutes (one game day stands for a week, plan 04 §3.3,
 * so a minute here is a short spell of work on deck).
 */

const range = z.tuple([z.number().nonnegative(), z.number().nonnegative()]);
const chance = z.object({ min: z.number().min(0).max(1), max: z.number().min(0).max(1) });

export const boardingRulesSchema = z.object({
  /** Getting alongside (§6.1): hulls this close, meters, and this slow, knots relative. */
  alongside: z.object({ gapM: z.number().positive(), relKn: z.number().positive() }),
  /** Hands that go over the rail by the player's tier: the T1 is you alone (§14.5). */
  crewByTier: z.record(z.string(), z.number().int().positive()),
  /**
   * Your arms (§6.2 `armsFactor`): small arms are 1, and each swivel trained on her deck
   * and each cannon run out adds to it. Her crew's are `crewArms` (unarmed hands with
   * belaying pins and a shotgun in the wheelhouse) or `armedCrewArms`.
   */
  arms: z.object({
    smallArms: z.number().nonnegative(),
    swivel: z.number().nonnegative(),
    cannon: z.number().nonnegative(),
    crewArms: z.number().nonnegative(),
    armedCrewArms: z.number().nonnegative(),
    /** A wounded hand fights this share as hard as a sound one. */
    woundedShare: z.number().min(0).max(1),
  }),
  /** Strength from a background's boarding perk, by perk id. */
  perkStrength: z.record(z.string(), z.number()),
  /** Strength per Fame tier, and for surprise in the dark or fog (dark01 ≥ `darkAt`). */
  fameStrength: z.number().nonnegative(),
  surpriseStrength: z.number().nonnegative(),
  darkAt: z.number().min(0).max(1),
  /** Her morale's factor on her defense: morale ÷ `neutral`, kept within min–max. */
  morale: z.object({
    neutral: z.number().positive(),
    min: z.number().positive(),
    max: z.number().positive(),
  }),
  /**
   * Intimidate (§6.2): `ratio × ratioWeight + fameTier × fameWeight + (neutral − morale) ×
   * moraleWeight`, kept within min–max. Weighted heavily by Fame and her nerve.
   */
  intimidate: chance.extend({
    ratioWeight: z.number(),
    fameWeight: z.number(),
    moraleWeight: z.number(),
  }),
  /** Fight: `ratio ÷ (ratio + bias)`, within min–max. Higher than intimidating, and bloody. */
  fight: chance.extend({ bias: z.number().positive() }),
  /**
   * A won fight: her able hands × `theirShare` (low–high) are casualties, `theirKilled` of
   * them dead; yours (T2's hands) the defense × `oursPerDefense`, none dead on a T1.
   */
  casualties: z.object({
    theirShare: range,
    theirKilled: z.number().min(0).max(1),
    oursPerDefense: z.number().nonnegative(),
  }),
  /**
   * A lost fight at bad odds may kill you (permadeath, always shown first): below
   * `badOdds` the chance is `(badOdds − fight) × perShortfall`, at most `max`.
   */
  death: z.object({
    badOdds: z.number().min(0).max(1),
    perShortfall: z.number().nonnegative(),
    max: z.number().min(0).max(1),
  }),
  /** Repelled: this share (low–high) of her hull points off yours, never below `floorShare`. */
  repelled: z.object({ hullShare: range, floorShare: z.number().min(0).max(1) }),
  loot: z.object({
    /** Game minutes to swing one CU across, by good category; the cash box in one go. */
    minutesPerCu: z.record(z.string(), z.number().nonnegative()),
    cashBoxMinutes: z.number().nonnegative(),
    /** Categories a quick grab takes (instant): valuables only. */
    quickGrab: z.array(z.string()),
    /** The order the screen lists her hold in: valuables first, then bulk. */
    order: z.array(z.string()),
    /** Stolen freight's heat (0–1) as it comes aboard. */
    heat: z.number().min(0).max(1),
  }),
  aftermath: z.object({
    /** A crew let go reports at her next port: her passage there, game hours, if unknown. */
    defaultVoyageHours: z.number().positive(),
    /** Disabled, she limps there: the passage takes this many times as long. */
    limpFactor: z.number().min(1),
    /** Set adrift, they row ashore: at least this many hours, plus the passage. */
    rowHours: z.number().nonnegative(),
    /** The weather check for the boat (§7.2): fair conditions drown nobody. */
    adrift: z.object({
      /** Wind at or over this, knots, puts the boat at risk... */
      windKn: z.number().positive(),
      windBase: z.number().min(0).max(1),
      perKnOver: z.number().nonnegative(),
      /** ...and so does cold water, in these months (0 January), and the dark. */
      coldMonths: z.array(z.number().int().min(0).max(11)),
      cold: z.number().min(0).max(1),
      dark: z.number().min(0).max(1),
      max: z.number().min(0).max(1),
      /** When it goes wrong, this share of the boat (low–high) is lost. */
      lostShare: range,
    }),
  }),
  /**
   * Freight for a ship with no timetable behind her (the `?encounter=` checks), by class:
   * what she'd typically carry, CU.
   */
  fallbackCargo: z.record(
    z.string(),
    z.array(z.object({ good: z.string(), qty: z.number().int().positive() })),
  ),
  /** A ship sunk or scuttled is off her timetable this many game days (a day is a week). */
  lostDays: z.number().positive(),
  /** A robbed ship's cash box stays empty this many game days. */
  robbedDays: z.number().positive(),
});

export type BoardingRules = z.infer<typeof boardingRulesSchema>;
