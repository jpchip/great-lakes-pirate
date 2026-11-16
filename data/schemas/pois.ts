import { z } from 'zod';
import { idOf } from './common';

/**
 * Points of interest (plan 11 §3.1, §16 `pois.json`; plan 08 §20.4 piece H): prefabs built
 * from a kit and set down on an island by `islands.json`. A prefab's pieces are in its own
 * frame: `right` meters to the right and `out` meters forward of its origin, where forward
 * is the bearing it's placed facing (a quarry faces out of its cut, toward the water).
 * Heights are meters above `baseY`, the ground drawn at the origin, so a piece sits the same
 * wherever the prefab goes.
 */

export const poiPieceKindSchema = z.enum([
  /** A cut brownstone face with a flat bench on top: solid from below the ground. */
  'ledge',
  /** A dressed block, or a stack of them: vault onto it. */
  'block',
  /** A timber mast with a boom and guy ropes: a post you can't walk through. */
  'derrick',
  /** A board shack: solid, roofed. */
  'shack',
  /** Loose stones heaped over a hiding place: a cache spot. */
  'cairn',
  /**
   * A run of stone treads, from the ground at its foot to the top of the ledge standing in
   * front of it (`out` ahead, along its own bearing): however high that turns out to be, no
   * tread rises more than 0.3 m. `heightM` is ignored; the rise comes from the ground.
   */
  'steps',
  /**
   * Phase 8, the Siskiwit logging camp: a deck of peeled logs, lying along the piece's
   * depth and stacked to its height. Solid: vault a low one, climb a high one.
   */
  'logs',
  /** Sawn lumber in stickered piles, boards along the depth. Solid, like logs. */
  'lumber',
  /** A log wall standing without its roof (the bunkhouse ruins): solid, unroofed. */
  'wall',
]);

export const poiPieceSchema = z.object({
  kind: poiPieceKindSchema,
  right: z.number(),
  out: z.number(),
  /** Across, along the frame's right; meters. */
  widthM: z.number().positive(),
  /** Along the frame's forward; meters. */
  depthM: z.number().positive(),
  heightM: z.number().positive(),
  /** Its foot above `baseY`. Ledges ignore it: they stand on whatever is under them. */
  yM: z.number().default(0),
  /** Turned from the frame, degrees clockwise. */
  yawDeg: z.number().default(0),
  /**
   * A ledge cut into a hill: its top stays at least this far above the highest ground
   * under it, so the bench is drawn over the hill rather than under it. Without it the
   * top is `heightM` above `baseY` wherever the ground is (a spoil wharf on the shallows).
   */
  clearM: z.number().nonnegative().optional(),
});

export const poiSchema = z.object({
  id: idOf('poi'),
  name: z.string().min(1),
  /** Keeps trees and shore rocks off it: a rectangle this far around the origin, meters. */
  clear: z.object({
    rightM: z.tuple([z.number(), z.number()]),
    outM: z.tuple([z.number(), z.number()]),
  }),
  pieces: z.array(poiPieceSchema).min(1),
});

export const poisFileSchema = z.array(poiSchema);
export type PoiDef = z.infer<typeof poiSchema>;
export type PoiPiece = z.infer<typeof poiPieceSchema>;
export type PoiPieceKind = z.infer<typeof poiPieceKindSchema>;
