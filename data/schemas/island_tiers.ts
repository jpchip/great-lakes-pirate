import { z } from 'zod';

/**
 * What an island on foot may cost, by its tier (plan 11 §2.1, §13; §18.3 criterion 12;
 * Phase 9 piece P). `bench.island` checks the whole frame on foot against `drawCalls` and
 * `triangles` (Medium preset); `tests/poi-kits.test.ts` checks every prefab and every
 * island's placed prefabs against the POI shares, so pieces Q and R can't lay out an
 * island over its budget without a test failing.
 */
const tierBudgetSchema = z.object({
  /** The whole frame on foot, Medium preset. */
  drawCalls: z.number().int().positive(),
  /** The whole frame's triangles on foot, Medium preset. */
  triangles: z.number().int().positive(),
  /** The island's placed prefabs together (they draw as one merged mesh). */
  poiTriangles: z.number().int().positive(),
  /** How many prefabs it places, cache cairns not counted. */
  maxPois: z.number().int().nonnegative(),
  /** Full-AI people and wildlife ashore at once (plan 11 §13). */
  people: z.number().int().nonnegative(),
  animals: z.number().int().nonnegative(),
});

export const islandTiersFileSchema = z.object({
  /** Any one prefab from `pois.json`, all its pieces (plan 14 §8's lighthouse-station size). */
  prefabTriangles: z.number().int().positive(),
  /** Inside a cave (plan 11 §13; piece S). */
  caveDrawCalls: z.number().int().positive(),
  tiers: z.object({
    hero: tierBudgetSchema,
    standard: tierBudgetSchema,
    minor: tierBudgetSchema,
  }),
});

export type IslandTiersFile = z.infer<typeof islandTiersFileSchema>;
export type TierBudget = z.infer<typeof tierBudgetSchema>;
