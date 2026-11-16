import { z } from 'zod';
import { idOf } from './common';
import { kitColliderSchema } from './districts';

/**
 * The hideout builder's pieces (plan 09 §4–§6, §12 `structures.json`; Phase 8 piece A).
 *
 * The grid is the district's (plan 09 §4.1): 2 m cells, 3 m levels, four rotations. Each
 * piece has one **placement**:
 * - `cell`: fills a footprint of cells on one level, either the **base** layer (foundations,
 *   floors, pier decks) or the **object** layer standing on a base (stairs, storage,
 *   stations, a bunk).
 * - `edge`: stands on a cell's edge (walls, fences, a ladder). A **fitting** (a door, a
 *   shutter, glass) goes into a frame already on that edge (`fitsIn`).
 * - `roof`: a cell's top on the level above the walls that carry it.
 * - `water`: a base over the lake within a depth range (pier sections, the slipway).
 * - `prop`: free on a 0.25 m sub-grid with 15° turns (lanterns, furniture, decor).
 *
 * How a piece stands (`stand`) is the support graph of plan 09 §4.3, not physics:
 * - `base`: on level 0 it sits on the terrain, its foundation or piling reaching down at
 *   most `reachM` to the ground (`wet` lets it reach into the lake); above level 0 it's
 *   carried by walls or posts on the level below, spanning up to two cells from them.
 * - `onFloor`: needs a base under every cell of its footprint on its own level, or on
 *   level 0 the bare ground if `groundOk` (fences, a well, path stones).
 * - `carried`: a roof, carried like an upper floor.
 * - `water`: depth under every cell within `water`; `shore` pieces need dry land at one
 *   end and `minDepthM` at the other.
 *
 * Material variants are the piece's look and cost: the first is the default. Costs are
 * existing goods in whole CU (plan 09 §16.5: tar counts as rope and canvas, glass as dry
 * goods). Paint is a tint index the renderer owns, saved per piece.
 */

export const structureMaterialSchema = z.enum([
  'timber',
  'plank',
  'log',
  'brownstone',
  'flagstone',
  'tarpaper',
  'shingle',
  'turf',
  'iron',
  'cloth',
]);
export type StructureMaterial = z.infer<typeof structureMaterialSchema>;

export const structurePlacementSchema = z.enum(['cell', 'edge', 'roof', 'water', 'prop']);
export type StructurePlacement = z.infer<typeof structurePlacementSchema>;

export const structureCategorySchema = z.enum([
  'foundation',
  'floor',
  'wall',
  'fitting',
  'roof',
  'stairs',
  'water',
  'fence',
  'storage',
  'station',
  'living',
  'light',
  'decor',
]);

export const structureFunctionsSchema = z
  .object({
    /** Storage, CU of goods (plan 09 §5.4). */
    storageCu: z.number().int().positive().optional(),
    /** A strongbox lets the hideout hold cash (one is enough). */
    strongbox: z.boolean().optional(),
    /** The crafting station this piece is (piece E's `stations.json`). */
    station: idOf('station').optional(),
    /** Added to the site's concealment, 0–1 scale (plan 09 §8): screens up, lamps down. */
    concealment: z.number().min(-1).max(1).optional(),
    /** Gives light at night (a concealment penalty, plan 09 §8). */
    light: z.boolean().optional(),
    /** Smokes when lit (the stove, the still). */
    smoke: z.boolean().optional(),
    /** Keeps the place warm in winter (plan 09 §3). */
    warmth: z.boolean().optional(),
    /** Somewhere to sleep and lay low (piece F). */
    bed: z.boolean().optional(),
    /** A ship can make fast here (plan 09 §4.3 mooring). */
    mooring: z.boolean().optional(),
    /** Ship repairs and building when shipless (piece G). */
    slipway: z.boolean().optional(),
  })
  .default({});
export type StructureFunctions = z.infer<typeof structureFunctionsSchema>;

export const structureVariantSchema = z.object({
  material: structureMaterialSchema,
  /** Goods per piece, by good id, whole CU. */
  cost: z.record(idOf('good'), z.number().int().positive()),
});

export const structureSchema = z
  .object({
    id: idOf('build'),
    name: z.string().min(1),
    category: structureCategorySchema,
    placement: structurePlacementSchema,
    /** Cell and water pieces: `base` or `object` (the cell's two slots). */
    layer: z.enum(['base', 'object']).optional(),
    stand: z.enum(['base', 'onFloor', 'carried', 'water']),
    /** Cells along x and z at rotation 0 (cell, roof and water pieces). */
    footprint: z.tuple([z.number().int().min(1), z.number().int().min(1)]).default([1, 1]),
    /** A prop's size, meters (x, z), for overlap. */
    sizeM: z.tuple([z.number().positive(), z.number().positive()]).optional(),
    heightM: z.number().nonnegative(),
    collider: kitColliderSchema,
    variants: z.array(structureVariantSchema).min(1),
    /** Hours of work to build, solo, in summer (plan 09 §6.3). */
    buildHours: z.number().positive(),
    /** Base pieces on level 0: how far down the foundation or piling reaches, meters. */
    reachM: z.number().nonnegative().optional(),
    /** A base that may stand in the lake (pilings). */
    wet: z.boolean().optional(),
    /** `onFloor` and edge pieces that may stand on bare ground on level 0. */
    groundOk: z.boolean().optional(),
    /** Edge pieces that stand on a roof's eave (gable ends). */
    onRoof: z.boolean().optional(),
    /** Walls and posts that carry floors and roofs above them. */
    carries: z.boolean().optional(),
    /** A fitting: the frames it goes into. */
    fitsIn: z.array(idOf('build')).optional(),
    /** Water pieces: the depth under them, meters. */
    water: z
      .object({
        minDepthM: z.number().nonnegative(),
        maxDepthM: z.number().positive(),
        shore: z.boolean().optional(),
      })
      .optional(),
    /** The highest level it can go on (0 for foundations, pilings and piers). */
    maxLevel: z.number().int().nonnegative().optional(),
    functions: structureFunctionsSchema,
  })
  .refine((s) => (s.placement === 'cell' || s.placement === 'water') === !!s.layer, {
    message: 'Cell and water pieces, and only they, have a layer',
  })
  .refine((s) => (s.placement === 'prop') === !!s.sizeM, {
    message: 'Props, and only props, have a size',
  })
  .refine(
    (s) =>
      (s.placement === 'water') === (s.stand === 'water') && !s.water === (s.stand !== 'water'),
    {
      message: 'Water pieces stand in water and say how deep',
    },
  )
  .refine((s) => (s.placement === 'roof') === (s.stand === 'carried'), {
    message: 'Roofs, and only roofs, are carried',
  })
  .refine((s) => s.stand !== 'base' || s.reachM !== undefined, {
    message: 'A base says how far down it reaches',
  });
export type StructureDef = z.infer<typeof structureSchema>;

export const structuresFileSchema = z.array(structureSchema);

/**
 * A hideout's pieces, packed (plan 09 §10, plan 16 §15): a palette of piece ids and flat
 * integer arrays of seven numbers per piece: palette index, col, row, level, rot,
 * variant, paint. `built` pieces stand; `planned` ones are ghosts waiting for a work
 * session (plan 09 §6.3, §12 `blueprintsPending`).
 *
 * For a cell, roof or water piece (col, row) is the footprint's corner cell and rot 0–3
 * turns it by 90°. For an edge piece rot is the side of the cell it stands on (0 the -z
 * side, 1 +x, 2 +z, 3 -x), which is also the way it faces. A prop's (col, row) count
 * 0.25 m steps from the bounds' corner and its rot 15° steps (0–23).
 */
export const packedLayoutSchema = z.object({
  palette: z.array(idOf('build')),
  built: z.array(z.number().int()).refine((a) => a.length % 7 === 0, 'Seven numbers a piece'),
  planned: z.array(z.number().int()).refine((a) => a.length % 7 === 0, 'Seven numbers a piece'),
});
export type PackedLayout = z.infer<typeof packedLayoutSchema>;

/** A pre-built hideout (plan 09 §2.2, §16.5): a layout every new claim of a site starts with. */
export const starterSchema = z.object({
  id: idOf('starter'),
  name: z.string().min(1),
  /** The cells it needs, so a site's bounds can be checked to hold it. */
  cols: z.number().int().positive(),
  rows: z.number().int().positive(),
  layout: packedLayoutSchema,
});
export type StarterDef = z.infer<typeof starterSchema>;

export const startersFileSchema = z.array(starterSchema);
