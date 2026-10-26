import { msToKnots } from '../../core/coords';
import type { SailingState } from '../../sim/sailing/controller';

/**
 * What the rig shows for a sailing state (plan 02 §9, §13): how far each sail is
 * hoisted at a sail setting, where the booms sit, and which way the apparent wind
 * blows the pennant and telltales. Pure functions, so they are unit tested without
 * WebGL; render/ships/schooner.ts turns them into geometry.
 */

/** Hoist of each sail, 0 (stowed) … 1 (set), plus how much of the gaff sails' luff is up. */
export interface SailHoists {
  /** Gaff fore and main sails: the luff fraction hoisted (reefedHoist at Reefed). */
  gaff: number;
  staysail: number;
  jib: number;
  /** Gaff topsails over both gaffs. */
  topsail: number;
}

const clamp01 = (v: number): number => Math.min(Math.max(v, 0), 1);
/** Ease in and out, so a hoist starts and finishes gently like a hand on a halyard. */
const ease = (t: number): number => t * t * (3 - 2 * t);

/**
 * The sail plan per level (plan 02 §3.2), for a continuous `sailSetting` 0–3:
 * - Furled (0): everything stowed.
 * - Reefed (1): fore and main reefed down to `reefedHoist`, and the fore staysail.
 * - Half (2): reefs shaken out, so fore, main and staysail are full.
 * - Full (3): the jib and both gaff topsails as well.
 * Between levels the sails hoist or come down, so a sail change animates by itself as
 * the controller eases the setting one step per `sailChangeTimeS`.
 */
export function sailHoists(setting: number, reefedHoist: number): SailHoists {
  const s = Math.min(Math.max(setting, 0), 3);
  const toReefed = ease(clamp01(s));
  const toHalf = ease(clamp01(s - 1));
  const toFull = ease(clamp01(s - 2));
  return {
    gaff: reefedHoist * toReefed + (1 - reefedHoist) * toHalf,
    staysail: toReefed,
    jib: toFull,
    topsail: toFull,
  };
}

/**
 * Apparent wind in the ship's frame (bow -z, starboard +x), knots: the direction the
 * air moves past the ship, which the pennant and telltales stream along. True wind
 * from `windAngle` off the bow (positive to starboard), plus the headwind of the ship's
 * own speed. Before the first tick (`windAngle` NaN) it is calm.
 */
export function apparentWindFlow(
  s: Pick<SailingState, 'windAngle' | 'windKn' | 'speed'>,
  out: { x: number; z: number } = { x: 0, z: 0 },
): { x: number; z: number } {
  if (!Number.isFinite(s.windAngle)) {
    out.x = 0;
    out.z = 0;
    return out;
  }
  // The wind comes from (sin a, -cos a) and blows the other way; the ship's own way
  // through the water adds a headwind, flowing aft (+z).
  out.x = -s.windKn * Math.sin(s.windAngle);
  out.z = s.windKn * Math.cos(s.windAngle) + msToKnots(s.speed);
  return out;
}

export interface BoomTargetOptions {
  /** Boom angle off the centerline hauled in hard and eased right out, radians. */
  minAngle: number;
  maxAngle: number;
}

export const DEFAULT_BOOM_ANGLES: BoomTargetOptions = {
  minAngle: (7 * Math.PI) / 180,
  maxAngle: (78 * Math.PI) / 180,
};

/**
 * Where the booms want to be, signed radians about the mast: positive swings the boom
 * end to starboard (+x), so to leeward when the wind is on the port side. The sheet is
 * the auto-trim ideal, or the player's own trim with manual trim on (plan 02 §3.4).
 * Stowed sails sit in the crutch on the centerline; luffing sails lie head to wind.
 */
export function boomTarget(
  s: Pick<SailingState, 'windAngle' | 'manualTrim' | 'trim' | 'idealTrim' | 'inIrons'>,
  hoist: number,
  options: BoomTargetOptions = DEFAULT_BOOM_ANGLES,
): number {
  if (hoist <= 0 || !Number.isFinite(s.windAngle)) return 0;
  // Leeward is opposite the wind's side.
  const lee = s.windAngle >= 0 ? -1 : 1;
  if (s.inIrons) return lee * options.minAngle * 0.5;
  const sheet = clamp01(s.manualTrim ? s.trim : s.idealTrim);
  return lee * (options.minAngle + (options.maxAngle - options.minAngle) * sheet);
}

/**
 * Moves a boom toward its target at a limited swing rate, radians per second: a tack
 * brings it across steadily; a jibe (`fast`) slams it over.
 */
export function swingBoom(current: number, target: number, dt: number, fast: boolean): number {
  const rate = fast ? 3 : 1.1;
  const step = rate * dt;
  if (Math.abs(target - current) <= step) return target;
  return current + Math.sign(target - current) * step;
}

/**
 * The sail shape to draw: `drawing` when the wind fills it, `luffing` (the slack shape)
 * in irons or when there is almost no apparent wind across it.
 */
export function sailShape(
  s: Pick<SailingState, 'inIrons' | 'windKn' | 'windAngle'>,
): 'drawing' | 'luffing' {
  if (!Number.isFinite(s.windAngle) || s.inIrons || s.windKn < 1) return 'luffing';
  return 'drawing';
}
