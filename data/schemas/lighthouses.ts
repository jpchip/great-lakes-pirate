import { z } from 'zod';
import { idOf } from './common';
import { geoSchema } from './zones';

/**
 * Lighthouses (plan 06 §6.1, R1 §2.1; Phase 2 piece F). One entry per light as it stood in
 * spring 1900. The characteristic is what a sailor sees at night: a fixed light is a steady
 * glow, a flashing one a beam that sweeps past once every `periodS` real seconds. `tier`
 * sets how far it shows and how strong its lamp is (strong 3rd and 3½-order lenses, medium
 * 4th, weak 5th and temporary lights); `keepers` and `reporting` are for Phase 5's
 * detection and are visual-only until then.
 */

/** Which kit tower a light is built from (src/render/lighthouses/kit.ts). */
export const towerStyleSchema = z.enum(['conical', 'dwelling', 'skeleton']);

export const lightTierSchema = z.enum(['strong', 'medium', 'weak']);

export const characteristicSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('fixed'), color: z.enum(['white', 'red']) }),
  z.object({
    kind: z.literal('flashing'),
    color: z.enum(['white', 'red']),
    /** Seconds between flashes: one turn of the lens. */
    periodS: z.number().positive(),
  }),
]);

/**
 * A station's fog signal (plan 15 §4.3, plan 04 §10), sounded while fog or thick weather
 * hides the light. Two shared sounds (plan 15 cut #4): a steam whistle and a hand-rung
 * bell. Each station keeps its own rhythm, so a sailor can tell them apart: `pattern`
 * lists the blasts or strokes as [start, length] seconds within one `periodS` cycle.
 */
export const fogSignalSchema = z
  .object({
    kind: z.enum(['whistle', 'bell']),
    pattern: z.array(z.tuple([z.number().nonnegative(), z.number().positive()])).min(1),
    periodS: z.number().positive(),
    /** How sure the record is that the station had this signal in 1900. */
    confidence: z.enum(['confirmed', 'approximate', 'unknown']),
  })
  .refine((s) => s.pattern.every(([at, length]) => at + length <= s.periodS), {
    message: 'every blast must end inside the period',
  });

export const lighthouseSchema = z.object({
  id: idOf('light'),
  name: z.string().min(1),
  zone: idOf('zone'),
  /** Where the tower stands (WGS84); the runtime snaps it onto the nearest land. */
  at: geoSchema,
  tower: z.object({
    style: towerStyleSchema,
    /** Height of the lantern's floor above the ground, real meters (1:1, plan 03 §3.4). */
    heightM: z.number().positive(),
    /** `brownstone` is Sand Island's dwelling; the others are painted white. */
    finish: z.enum(['white', 'brownstone', 'brick', 'iron']),
  }),
  tier: lightTierSchema,
  characteristic: characteristicSchema,
  /** Lens as R1 records it, for the record. */
  lens: z.string(),
  keepers: z.number().int().min(1).max(4),
  /** How fast the keeper reports what he sees: near town is fast, remote is slow. */
  reporting: z.enum(['fast', 'medium', 'slow']),
  /** No signal when absent: the station is silent in fog. */
  fogSignal: fogSignalSchema.optional(),
  /** R1's confidence in the characteristic and the site: ✅ confirmed, ⚠️ approximate, ❓ unknown. */
  confidence: z.enum(['confirmed', 'approximate', 'unknown']),
  notes: z.string(),
});

export const lighthousesFileSchema = z.array(lighthouseSchema);
export type LighthouseDef = z.infer<typeof lighthouseSchema>;
export type Characteristic = z.infer<typeof characteristicSchema>;
export type FogSignal = z.infer<typeof fogSignalSchema>;
export type LightTier = z.infer<typeof lightTierSchema>;
export type TowerStyle = z.infer<typeof towerStyleSchema>;
