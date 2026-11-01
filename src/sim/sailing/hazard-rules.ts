import { z } from 'zod';

/**
 * Hazard and mooring rules shared by every sailing ship (plan 02 §6–7): grounding, rock
 * and pier hits, damage effects, overpressing strain, knockdown, anchoring and docking.
 * Per-class numbers (draft, hull and rigging HP, anchor rode, length) live in
 * `data/ships.json`. Data units, like handling: knots, degrees, seconds, meters, HP.
 * Speeds are game knots; the sim converts movement with v₃ᴅ = v × R / C.
 */
export const hazardRulesSchema = z.object({
  /** Grounding faster than this is a hard grounding: hull damage by speed (plan 02 §6.2). */
  hardGroundKn: z.number().nonnegative(),
  /** Hull HP lost per knot of a hard grounding. */
  groundDamagePerKn: z.number().nonnegative(),
  /** Hull HP lost by a soft grounding (stuck, minor damage). */
  groundMinorDamage: z.number().nonnegative(),
  /** Water needed under the keel on every probe before a grounded ship floats free. */
  refloatMarginM: z.number().nonnegative(),
  /** How fast hauling on the kedge anchor drags a grounded ship to deeper water. */
  kedgeKn: z.number().positive(),
  /**
   * Bottom slope, meters of depth per meter, at and above which touching bottom is a hit
   * on rock or a steep shore (push back, heavy damage) rather than running aground on a
   * shoal (plan 02 §6.2).
   */
  rockSlope: z.number().positive(),
  /** Shore hits slower than this (toward the shore) do no damage. */
  strikeMinKn: z.number().nonnegative(),
  /** Hull HP lost per knot of a rock or shoreline hit, head on (plan 02 §6.2). */
  rockDamagePerKn: z.number().nonnegative(),
  /** Hull HP lost per knot of hitting a pier. */
  pierDamagePerKn: z.number().nonnegative(),
  /** Share of a head-on impact speed that comes back as sternway. */
  strikeBounce: z.number().min(0).max(1),
  /** Speed lost to a full hold of water at 0 hull: loadFactor's floor is 1 − this. */
  leakSpeedLoss: z.number().min(0).max(1),
  /**
   * Speed lost to a full hold of the heaviest cargo (plan 02 §3: loadFactor 1.0 empty →
   * ~0.8 full). The hold's load is CU × weight factor over capacity (plan 05 §3).
   */
  cargoSpeedLoss: z.number().min(0).max(1),
  /** Extra draft at 0 hull, meters: a leaking ship sits lower (plan 02 §6.1). */
  leakSinkM: z.number().nonnegative(),
  /** riggingCondition at 0 rigging HP (plan 02 §3.1: 0.5–1.0). */
  riggingConditionMin: z.number().min(0).max(1),
  /** Extra sail-change time at 0 rigging HP, as a share of the normal time. */
  riggingSailSlowdown: z.number().nonnegative(),
  /**
   * The most wind each sail level carries without strain, knots: Furled, Reefed, Half,
   * Full (plan 02 §3.5: Full is overpressed from 19 kn, Half from a gale).
   */
  safeWindKn: z.tuple([z.number(), z.number(), z.number(), z.number()]),
  /** Wind over the safe limit, knots, that drives strain to 1. */
  overpressSpanKn: z.number().positive(),
  /** Seconds for strain to climb from 0 to 1 at full overpress. */
  strainRiseS: z.number().positive(),
  /** Seconds for strain to bleed from 1 to 0 once the ship is eased. */
  strainFallS: z.number().positive(),
  /** Rigging takes damage while strain is above this (plan 02 §3.5). */
  strainDamageAt: z.number().min(0).max(1),
  /** Rigging HP per second at strain 1, falling to 0 at strainDamageAt. */
  strainDamagePerS: z.number().nonnegative(),
  /** Rigging HP an uncontrolled jibe costs (plan 02 §4; cut #2 sets it to 0). */
  jibeDamage: z.number().nonnegative(),
  /** A knockdown needs at least this much wind, knots: a gale (plan 02 §6.4). */
  knockdownWindKn: z.number().positive(),
  /** …this much strain… */
  knockdownStrain: z.number().min(0).max(1),
  /** …and at least this sail level set (2 = Half). */
  knockdownMinSail: z.number().int().min(0).max(3),
  /** Share of rigging and hull HP a knockdown takes. */
  knockdownRiggingShare: z.number().min(0).max(1),
  knockdownHullShare: z.number().min(0).max(1),
  /** How far over the ship lurches, degrees, and how long until it is back up. */
  knockdownRollDeg: z.number().nonnegative(),
  knockdownS: z.number().positive(),
  /** Share of the speed the ship keeps through a knockdown. */
  knockdownSpeedKeep: z.number().min(0).max(1),
  /** Strain left after a knockdown spills the wind. */
  knockdownStrainAfter: z.number().min(0).max(1),
  /** No second knockdown within this many seconds of the last. */
  knockdownCooldownS: z.number().nonnegative(),
  /** Seconds X must be held to drop or weigh the anchor (plan 02 §2). */
  anchorHoldS: z.number().nonnegative(),
  /** Speed time constant once the anchor bites: the ship stops over a few seconds. */
  anchorStopTau: z.number().positive(),
  /** How far the ship lies downwind of its anchor, meters. */
  anchorSwingM: z.number().nonnegative(),
  /** Seconds for the ship to settle back onto that circle. */
  anchorSwingTau: z.number().positive(),
  /** How fast the bow swings head to wind at anchor, degrees per second. */
  anchorSwingDegS: z.number().nonnegative(),
  /** Seconds to weigh anchor (solo T1). */
  anchorWeighS: z.number().nonnegative(),
  /** Wind the anchor holds in good, shallow ground, knots (plan 02 §7: a gale may drag). */
  anchorHoldKn: z.number().positive(),
  /** Holding as a share of anchorHoldKn with the anchor at the end of its rode. */
  anchorDeepHold: z.number().min(0).max(1),
  /** Extra windage from set sails at anchor: load = wind × (1 + this × sail factor). */
  anchorSailWindage: z.number().nonnegative(),
  /** Drag speed when the load is double the holding. */
  anchorDragKn: z.number().nonnegative(),
  /** The fastest a ship may be going to auto-dock (plan 02 §7: under 2 kn). */
  dockMaxKn: z.number().positive(),
  /** How far outside a berth's own zone the ship may be and still dock, meters. */
  dockReachM: z.number().nonnegative(),
  /** Seconds the auto-dock takes to bring the ship alongside. */
  dockS: z.number().positive(),
  /** Speed ahead that casting off gives, and the sideways shove off the pier. */
  castOffKn: z.number().nonnegative(),
  castOffSideM: z.number().nonnegative(),
  castOffS: z.number().positive(),
});

export type HazardRules = z.infer<typeof hazardRulesSchema>;

/** Starting values; the Phase 1 playtest records the tuned ones in plan 02. */
export function defaultHazardRules(): HazardRules {
  return {
    hardGroundKn: 2,
    groundDamagePerKn: 5,
    groundMinorDamage: 2,
    refloatMarginM: 0.2,
    kedgeKn: 0.4,
    rockSlope: 0.35,
    strikeMinKn: 0.5,
    rockDamagePerKn: 10,
    pierDamagePerKn: 3,
    strikeBounce: 0.2,
    leakSpeedLoss: 0.3,
    cargoSpeedLoss: 0.2,
    leakSinkM: 0.4,
    riggingConditionMin: 0.5,
    riggingSailSlowdown: 1,
    safeWindKn: [999, 40, 27, 19],
    overpressSpanKn: 8,
    strainRiseS: 10,
    strainFallS: 6,
    strainDamageAt: 0.6,
    strainDamagePerS: 3,
    jibeDamage: 8,
    knockdownWindKn: 28,
    knockdownStrain: 0.95,
    knockdownMinSail: 2,
    knockdownRiggingShare: 0.3,
    knockdownHullShare: 0.1,
    knockdownRollDeg: 55,
    knockdownS: 6,
    knockdownSpeedKeep: 0.3,
    knockdownStrainAfter: 0.4,
    knockdownCooldownS: 30,
    anchorHoldS: 0.5,
    anchorStopTau: 3,
    anchorSwingM: 14,
    anchorSwingTau: 4,
    anchorSwingDegS: 8,
    anchorWeighS: 6,
    anchorHoldKn: 30,
    anchorDeepHold: 0.7,
    anchorSailWindage: 0.6,
    anchorDragKn: 1.2,
    dockMaxKn: 2,
    dockReachM: 12,
    dockS: 5,
    castOffKn: 1,
    castOffSideM: 3,
    castOffS: 3,
  };
}
