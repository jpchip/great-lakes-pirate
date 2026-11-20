import { z } from 'zod';
import { idOf } from './common';
import { geoSchema } from './zones';

/**
 * Sea caves (plan 11 §5, §18.4 piece S; `caves.json`): the caves the lake has cut into the
 * red sandstone at Devils Island, Sand Island and the mainland shore east of Siskiwit Bay.
 * A heightmap can't hold an overhang (plan 03 §4), so each cave is authored here as a
 * passage: a line of nodes from the open water into the cliff, each with its width, its
 * floor and its roof. The game cuts the cliff's drawn ground away inside it, draws the rock
 * round it, and walks, rows and swims it on its own floor.
 *
 * A cave's frame is a cave mouth prefab placed on its island (`mouth`, piece P's
 * `poi.cave_mouth`: its origin and the way it faces), a point on its island's 1 m tiles, or
 * a point on the chart for one on the mainland. In it, `out` is meters toward the lake (the
 * frame's facing) and `right` meters to its right.
 */

/** One point of a cave's passage, in its frame. */
export const caveNodeSchema = z.object({
  right: z.number(),
  out: z.number(),
  /** Wall to wall, m. */
  widthM: z.number().positive(),
  /** The floor (or the bottom, under the lake), m above the lake. */
  floorM: z.number(),
  /** The roof, m above the lake. Absent: open sky (the channel in, or a prefab's opening). */
  roofM: z.number().optional(),
  /**
   * A flared lip of rock where the passage comes out of the cliff, hiding the cut in the
   * drawn ground. Not where it comes out through a cave mouth prefab, which has its own.
   */
  lip: z.boolean().optional(),
});

/** A spot in a cave's frame (a cache's hiding place, a mark). */
const cavePointSchema = z.object({ right: z.number(), out: z.number() });

/**
 * A seeded cache in a cave (plan 11 §5 "smuggler caches"): candidate spots, one of which
 * holds it by the run's seed, as an island's cairns do. A winter cache is in a crack only
 * reachable standing on the ice when the cave is frozen (11 cut #1 kept in).
 */
export const caveCacheSchema = z.object({
  id: idOf('cache'),
  name: z.string().min(1),
  spots: z.array(cavePointSchema.extend({ name: z.string().min(1) })).min(1),
  cashCents: z.tuple([z.number().int().nonnegative(), z.number().int().nonnegative()]),
  found: z.string().min(1),
  curio: idOf('curio').optional(),
  winter: z.boolean().optional(),
});

/** A named place in a cave for other pieces: the Devil's Grotto's chamber (piece T). */
const caveMarkSchema = cavePointSchema.extend({
  id: z.string().regex(/^[a-z0-9_]+$/),
  kind: z.enum(['grotto', 'ledge']),
});

export const caveSchema = z
  .object({
    id: idOf('cave'),
    name: z.string().min(1),
    zone: idOf('zone'),
    /** The island it's on; absent on the mainland. */
    island: idOf('island').optional(),
    /** The wonder it belongs to on the chart (piece O's `discoveries.json`). */
    wonder: z.string().regex(/^wonder\.[a-z0-9_]+$/),
    /** A cave mouth prefab placed on its island (`onFoot.pois` id): the frame is its own. */
    mouth: z
      .string()
      .regex(/^[a-z0-9_]+$/)
      .optional(),
    /** Or a point on its island's 1 m tiles (meters east and south of their corner). */
    x: z.number().optional(),
    z: z.number().optional(),
    /** Or a point on the chart (the mainland). */
    at: geoSchema.optional(),
    /** The frame's facing out to the lake, degrees clockwise from north (not with `mouth`). */
    facingDeg: z.number().min(0).max(360).optional(),
    /** The passage, from one end to the other. */
    nodes: z.array(caveNodeSchema).min(2),
    caches: z.array(caveCacheSchema).default([]),
    marks: z.array(caveMarkSchema).default([]),
    /** What the HUD says the first time you come in. */
    entered: z.string().min(1),
  })
  .refine(
    (c) =>
      (c.mouth !== undefined ? 1 : 0) +
        (c.x !== undefined && c.z !== undefined ? 1 : 0) +
        (c.at !== undefined ? 1 : 0) ===
      1,
    'A cave sits at one of: a cave mouth prefab, a point on its island, or a point on the chart',
  )
  .refine((c) => c.mouth === undefined || c.island !== undefined, 'A prefab mouth needs its island')
  .refine((c) => c.at !== undefined || c.island !== undefined, 'A point on tiles needs its island')
  .refine(
    (c) => (c.mouth === undefined) === (c.facingDeg !== undefined),
    'A cave faces its prefab, or says which way it faces',
  )
  .refine((c) => c.nodes.some((n) => n.roofM !== undefined), 'A cave has a roof somewhere')
  .refine(
    (c) => c.nodes.every((n) => n.roofM === undefined || n.roofM > n.floorM + 1.5),
    'Every roof stands at least 1.5 m over its floor',
  );

export const caveRulesSchema = z.object({
  /** Too much sea to row in under the roof (significant wave height at the mouth), m. */
  rowMaxHsM: z.number().positive(),
  /** Swimming in a sea this big inside a cave, the surge throws you on the rock. */
  surgeHsM: z.number().positive(),
  /** Health a second the surge takes at `surgeHsM`, more as the sea builds. */
  surgeHurtPerS: z.number().positive(),
  /** A cave is an ice cave when the lake's ice at its mouth holds a walker (piece M). */
  iceCave: z.boolean(),
  /** Reach to a cache's spot, m. */
  reachM: z.number().positive(),
});

export const cavesFileSchema = z.object({
  rules: caveRulesSchema,
  caves: z.array(caveSchema),
});

export type CaveDef = z.infer<typeof caveSchema>;
export type CaveNode = z.infer<typeof caveNodeSchema>;
export type CaveCacheDef = z.infer<typeof caveCacheSchema>;
export type CaveRules = z.infer<typeof caveRulesSchema>;
