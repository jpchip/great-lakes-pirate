import { z } from 'zod';
import { idOf } from './common';

/**
 * Cargo flows (plan 05 §8.1; Phase 4 piece D): what the route graph's ships carry.
 *
 * - A **fleet** names the companies that own a lane's ships; each ship keeps one owner for
 *   the run, drawn from the list.
 * - A **flow** is one direction of a lane: the goods a ship loads at `from` for `to`, by
 *   weight (times an optional monthly factor), how full she sails, and how hard a full hold
 *   moves a port's market. A `mixed` flow is package freight: several goods in one hold. A
 *   lane direction with no flow sails in ballast.
 *
 * A port's market only feels part of a cargo: most of it is consigned to a mill, an
 * elevator or the railroad. `impact` is the share of the port's target stock of a good a
 * full hold moves, up on arrival and down on departure; the market's drift takes it back.
 */

/** Twelve monthly values, January first. */
const monthly = z.array(z.number().min(0)).length(12);

export const flowFeatureSchema = z.discriminatedUnion('kind', [
  z.object({
    id: idOf('fleet'),
    kind: z.literal('fleet'),
    lane: idOf('lane'),
    owners: z.array(idOf('company')).min(1),
  }),
  z.object({
    id: idOf('flow'),
    kind: z.literal('flow'),
    name: z.string().min(1),
    lane: idOf('lane'),
    from: idOf('node'),
    to: idOf('node'),
    cargo: z
      .array(
        z.object({
          good: idOf('good'),
          weight: z.number().positive(),
          /** Scales the weight by month (grain heaviest in the fall). */
          months: monthly.optional(),
        }),
      )
      .min(1),
    /** Package freight: up to three goods share the hold. */
    mixed: z.boolean().default(false),
    /** How full she sails, 0–1 of her capacity (and her consort's). */
    load: z.number().min(0).max(1),
    /** Share of a port's target stock a full hold moves (0 for no market at either end). */
    impact: z.number().min(0).max(1),
  }),
]);

export const flowsFileSchema = z.array(flowFeatureSchema);
export type FlowFeature = z.infer<typeof flowFeatureSchema>;
export type FleetDef = Extract<FlowFeature, { kind: 'fleet' }>;
export type FlowDef = Extract<FlowFeature, { kind: 'flow' }>;
