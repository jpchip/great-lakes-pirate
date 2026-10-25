import { z } from 'zod';
import { curveSchema } from '../../../data/schemas/ships';

/**
 * Handling constants shared by every sailing ship (plan 02 §3–5). Per-class numbers
 * live in `data/ships.json`; these are the rules of the sailing model itself. Data
 * units, like ships.json: knots, degrees, seconds. The tuning panel edits both and
 * saves them together as a preset (plan 02 §14.8).
 */
export const handlingSchema = z.object({
  /** Speed factor per sail level: Furled, Reefed, Half, Full (plan 02 §3.2). */
  sailFactors: z.tuple([z.number(), z.number(), z.number(), z.number()]),
  /** windStrengthFactor by wind speed: `[knots, factor]` (plan 02 §3.5). */
  windStrength: curveSchema,
  /** A full gust (gust01 = 1) adds this share of the sustained wind (plan 04 §20). */
  gustGain: z.number().nonnegative(),
  /** trimFactor with auto-trim on (plan 02 §3.4). */
  autoTrimFactor: z.number().min(0).max(1),
  /** trimFactor with the sheets as far off the sweet spot as they go. */
  manualTrimMin: z.number().min(0).max(1),
  /** Half-width of the sweet-spot band, as a share of the sheet's travel. */
  trimSweetSpot: z.number().nonnegative(),
  /** Sheet travel beyond the band over which trimFactor falls to manualTrimMin. */
  trimFalloff: z.number().positive(),
  /** Sheet travel per second while Q or E is held. */
  trimRate: z.number().positive(),
  /** Seconds for the rudder to swing from center to hard over (plan 02 §2 ramp-up). */
  rudderRampS: z.number().positive(),
  /** Seconds for the rudder to return to center from hard over on release. */
  rudderCenterS: z.number().positive(),
  /** Speed time constant while in irons; slower than decelTau so a tack keeps some way. */
  ironsDecelTau: z.number().positive(),
  /** Below this speed in irons the ship stalls and drifts back (plan 02 §4). */
  stallSpeedKn: z.number().nonnegative(),
  /** Sternway while stalled in irons, at windStrengthFactor 1. */
  backDriftKn: z.number().nonnegative(),
  /** How fast a stalled ship's bow falls off the wind, degrees per second. */
  fallOffDegS: z.number().nonnegative(),
  /** Heel at Full sail on a beam reach at heelFullWindKn and above (plan 02 §5.1). */
  heelMaxDeg: z.number().nonnegative(),
  heelFullWindKn: z.number().positive(),
  /** Seconds for heel to settle to a new angle. */
  heelTau: z.number().positive(),
  /** Sideways slip close-hauled at Full sail (plan 02 §3.3; 0 turns it off, cut #1). */
  leewayMaxDeg: z.number().nonnegative(),
  /** Largest head-seas speed loss: seaStateFactor's floor is 1 − this (plan 02 §5.2). */
  headSeaPenalty: z.number().min(0).max(1),
  /** Summed wave amplitude on the bow, meters, that gives the full head-seas penalty. */
  headSeaFullM: z.number().positive(),
  /** Wind at or above this, at Half or Full sail, makes a jibe uncontrolled (plan 02 §4). */
  strongWindKn: z.number().positive(),
});

export type HandlingRecord = z.infer<typeof handlingSchema>;

/** Starting values; the Phase 1 playtest records the tuned ones in plan 02. */
export function defaultHandling(): HandlingRecord {
  return {
    sailFactors: [0, 0.45, 0.75, 1],
    windStrength: [
      [0, 0],
      [3, 0.2],
      [4, 0.4],
      [9, 0.8],
      [12, 0.95],
      [18, 1],
    ],
    gustGain: 0.4,
    autoTrimFactor: 0.92,
    manualTrimMin: 0.7,
    trimSweetSpot: 0.06,
    trimFalloff: 0.3,
    trimRate: 0.5,
    rudderRampS: 0.6,
    rudderCenterS: 0.35,
    ironsDecelTau: 14,
    stallSpeedKn: 1.5,
    backDriftKn: 0.6,
    fallOffDegS: 4,
    heelMaxDeg: 14,
    heelFullWindKn: 20,
    heelTau: 1.2,
    leewayMaxDeg: 4,
    headSeaPenalty: 0.2,
    headSeaFullM: 1.5,
    strongWindKn: 19,
  };
}
