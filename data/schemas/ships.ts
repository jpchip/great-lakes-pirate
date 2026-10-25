import { z } from 'zod';
import { idOf } from './common';

/**
 * Ship classes (plan 02 §12, plan 01 §8). Authored in data units: speeds in game knots
 * (fields end in `Kn`), angles in degrees, times in seconds, lengths in meters. The
 * sailing loader (sim/sailing/ship-class) converts them to SI for the sim.
 */

/** A curve as `[x, y]` points with strictly increasing x; sampled with a smooth spline. */
export const curveSchema = z
  .array(z.tuple([z.number(), z.number()]))
  .min(2)
  .refine(
    (pts) => pts.every((p, i) => i === 0 || p[0] > (pts[i - 1] as [number, number])[0]),
    'Curve x values must strictly increase',
  );

/** Hull sampling for cheap buoyancy (plan 02 §5.1; gameplay/buoyancy). */
const buoyancySchema = z.object({
  /** Bow-to-stern sample span, meters. */
  length: z.number().positive(),
  /** Port-to-starboard sample span, meters. */
  beam: z.number().positive(),
  heavePeriod: z.number().positive(),
  pitchPeriod: z.number().positive(),
  rollPeriod: z.number().positive(),
  damping: z.number().positive(),
});

const shipBase = {
  id: idOf('ship'),
  name: z.string().min(1),
  tier: z.number().int().min(1).max(3),
  lengthM: z.number().positive(),
  /** Render scale for this class (plan 03 §3.5); 1 for the player's schooners. */
  displayScale: z.number().positive(),
  /** Seconds to reach 63% of a higher target speed. */
  accelTau: z.number().positive(),
  /** Seconds to lose 63% of the way to a lower target speed (coasting). */
  decelTau: z.number().positive(),
  /** Turn rate by speed: `[speedKn, degrees per second]` at full rudder (plan 02 §4). */
  turnRateCurve: curveSchema,
  draftEmptyM: z.number().positive(),
  draftFullM: z.number().positive(),
  /** Hold volume, m³ (plan 05 settles the final cargo unit). */
  cargoCapacity: z.number().nonnegative(),
  hullHP: z.number().positive(),
  riggingHP: z.number().positive(),
  /** Anchor rode: the deepest water the ship can anchor in, meters (plan 02 §7). */
  anchorRodeM: z.number().positive(),
  buoyancy: buoyancySchema,
  /** How conspicuous the ship is (plan 06). */
  visibilityProfile: z.enum(['low', 'medium', 'high']),
  modelId: z.string().min(1),
  /** Lower-detail model ids, nearest first. */
  LODs: z.array(z.string().min(1)),
};

export const sailShipSchema = z.object({
  ...shipBase,
  propulsion: z.literal('sail'),
  hullMaxSpeedKn: z.number().positive(),
  /** Polar curve: `[true wind angle off the bow in degrees, speed factor]` (plan 02 §3.3). */
  polar: curveSchema,
  /** Seconds per sail-level step (plan 02 §3.2; slow for the solo T1). */
  sailChangeTimeS: z.number().positive(),
  /** Long oars for calms (plan 02 §3.6). */
  sweeps: z.boolean(),
  /** Rowing speed with the sweeps out. */
  sweepsKn: z.number().nonnegative(),
  /** Turn rate at full rudder under sweeps alone, degrees per second. */
  sweepsTurnDegS: z.number().nonnegative(),
});

export const steamShipSchema = z.object({
  ...shipBase,
  propulsion: z.literal('steam'),
  /** Constant engine speed, independent of the wind (plan 02 §10.1). */
  engineSpeedKn: z.number().positive(),
});

export const shipSchema = z
  .discriminatedUnion('propulsion', [sailShipSchema, steamShipSchema])
  .refine((s) => s.draftFullM >= s.draftEmptyM, 'draftFullM must be at least draftEmptyM');

export const shipsFileSchema = z.array(shipSchema);
export type ShipRecord = z.infer<typeof shipSchema>;
export type SailShipRecord = z.infer<typeof sailShipSchema>;
