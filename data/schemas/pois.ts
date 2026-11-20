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
  // Phase 9 piece P: the fish camp, the farmstead, the trapper's cabin, the viewpoint,
  // beach wreckage, cairns and dig spots, and the cave mouth.
  /**
   * A timber dock on rock-filled cribs, out over the shallows: a platform like a ledge
   * (placed first, stood on, a ladder down its far end where that's water). Its top is
   * `heightM` above `baseY`.
   */
  'dock',
  /** A fisherman's board shanty: a shed roof, a stovepipe, a door. Solid, roofed. */
  'shanty',
  /** The fish house: a gabled board shed on low posts, a wide door for the boxes. */
  'fish_house',
  /** A gill-net reel: a slatted drum on two trestles with the net wound on. Vault it. */
  'net_reel',
  /** Posts and rails with nets hung to dry: solid, but you see through it. */
  'drying_rack',
  /** Fish barrels and half-barrels in a huddle: vault them. */
  'barrels',
  /** A Mackinaw boat hauled out and turned over on blocks: vault it. */
  'boat',
  /** A settler's log cabin: notched courses, a gable roof, a fieldstone chimney. */
  'cabin',
  /** A board-and-batten barn with its big doors and a hay hood. Solid, roofed. */
  'barn',
  /** A plowed or planted strip: drawn on the ground, walked over, never solid. */
  'field',
  /** A split-rail fence zigzagging along its width: vault it, see through it. */
  'fence',
  /** Cordwood stacked between end posts: vault a low one. */
  'woodpile',
  /** Stumps left in a clearing, scattered over the piece's rectangle: each a small post. */
  'stumps',
  /** A pelt-stretching rack: a pole frame with hides laced in. See through it. */
  'hide_rack',
  /**
   * A Lake Survey triangulation signal: a timber tripod with a target at its head, the
   * kind the survey put on high ground. A post you can't walk through.
   */
  'signal',
  /** A wreck's keel and frames standing out of the sand like ribs. Solid, see through. */
  'ribs',
  /** A broken spar washed up, with its rigging still on it. Vault it. */
  'spar',
  /** Planks and wreck timber strewn on the beach: low, walked over. */
  'planks',
  /** A dig spot: a hump of turned earth with a blazed stake. Walked over. */
  'dig',
  /** A blazed post or a marker stake: a thin post. */
  'blaze',
  /** A tumbled boulder: vault a small one, climb a big one. */
  'boulder',
  /**
   * The mouth of a sea or land cave: an arch in a bedded sandstone face, black inside.
   * The face and its sides are solid; the mouth itself is closed by a back wall until
   * piece S opens the cave behind it.
   */
  'cave_mouth',
]);

/**
 * What a prefab is placed on (Phase 9 piece P): a guide for laying POIs out on an island
 * (pieces Q and R) and the ground the showcase page raises under it. Every prefab faces
 * `out` toward the open side: the water for a shore camp or a wreck, the view for a
 * viewpoint, away from the face for a cave mouth.
 */
export const poiSiteSchema = z.enum([
  /** On the shore, `out` toward the water: a dock or a wharf reaches into it. */
  'shore',
  /** On a beach, just above the waterline, `out` toward the lake. */
  'beach',
  /** A clearing on level ground inland. */
  'clearing',
  /** High ground or a cliff top, `out` toward the view. */
  'hilltop',
  /** At the foot of a cliff or bank, `out` away from its face. */
  'cliff',
]);

/**
 * A named point in a prefab (Phase 9 piece P): where later pieces hang their behavior, so
 * a POI carries its own hooks wherever it's placed. Positions are the prefab's frame, like
 * its pieces'; `yM` is above the floor there (a ledge's or a dock's top, or the ground).
 */
export const poiMarkKindSchema = z.enum([
  /** A stove, a hearth or a fire ring: where you warm (piece M). */
  'fire',
  /** Where a resident stands or works by day (fishermen and farmers, piece Q). */
  'resident',
  /** Where a cache can be dug for (piece T's hold-to-dig). */
  'dig',
  /** Where a cache can be hidden and searched for (a cairn, a loose board). */
  'cache',
  /** Where you stand to look out (a viewpoint's lookout), facing its view. */
  'view',
  /** The way into a cave (piece S). */
  'cave',
  /** Where a rowboat comes in: a dock's end or a beach. */
  'landing',
  /** Something to go through: wreck timber, a shed's shelves (piece U, T). */
  'search',
]);

export const poiMarkSchema = z.object({
  id: z.string().regex(/^[a-z0-9_]+$/),
  kind: poiMarkKindSchema,
  right: z.number(),
  out: z.number(),
  yM: z.number().default(0),
  /** The way it faces, degrees clockwise from the frame's forward. */
  facingDeg: z.number().default(0),
});

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
   * Phase 9 piece P: which look of its kind. A field: 0 plowed, 1 oats, 2 potatoes, 3 hay.
   * A cabin: 0 a settler's (a stone chimney), 1 a trapper's (a stovepipe, a lean-to). A
   * shanty: 0 tarpaper roof, 1 board roof. Others ignore it.
   */
  variant: z.number().int().nonnegative().default(0),
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
  /** What it's placed on (Phase 9 piece P); a clearing unless it says. */
  site: poiSiteSchema.default('clearing'),
  /** Its named points (Phase 9 piece P). */
  marks: z.array(poiMarkSchema).default([]),
});

export const poisFileSchema = z.array(poiSchema);
export type PoiDef = z.infer<typeof poiSchema>;
export type PoiPiece = z.infer<typeof poiPieceSchema>;
export type PoiPieceKind = z.infer<typeof poiPieceKindSchema>;
export type PoiSite = z.infer<typeof poiSiteSchema>;
export type PoiMark = z.infer<typeof poiMarkSchema>;
export type PoiMarkKind = z.infer<typeof poiMarkKindSchema>;
