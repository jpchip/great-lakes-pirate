import { z } from 'zod';
import { idOf } from './common';
import { geoBoundsSchema, geoSchema } from './zones';

/**
 * Islands (plan 03 §9 `islands.json`, plan 11 §15). The bake (tools/geo/build.ts) finds
 * each island's land from its center point and cuts its 1 m on-foot tiles; the
 * footprint it found is in the zone's baked `manifest.json`. Landings and points of
 * interest come with plan 11.
 */
/** A point on the island's 1 m tiles: meters east and south of the baked footprint's corner. */
const islandPointSchema = z.object({ x: z.number(), z: z.number() });

/** A prefab from `pois.json` set down on the island (plan 11 §16). */
export const islandPoiSchema = islandPointSchema.extend({
  id: z.string().regex(/^[a-z0-9_]+$/),
  poi: idOf('poi'),
  /** The bearing it faces, degrees clockwise from north. */
  facingDeg: z.number().min(0).max(360),
});

/**
 * A seeded cache (plan 11 §11): a few candidate spots, each a cairn you can search, and
 * the run's seed picks which one holds it. What's inside is rolled from the same seed.
 */
export const islandCacheSchema = z.object({
  id: idOf('cache'),
  name: z.string().min(1),
  spots: z.array(islandPointSchema.extend({ name: z.string().min(1) })).min(1),
  /** Cash inside, cents: rolled between the two. */
  cashCents: z.tuple([z.number().int().nonnegative(), z.number().int().nonnegative()]),
  /** The line when you find it; `{cash}` is the money. */
  found: z.string().min(1),
});

/** Walking the island (plan 08 §20.4 piece H): its points of interest and its cache. */
export const islandOnFootSchema = z.object({
  pois: z.array(islandPoiSchema).default([]),
  caches: z.array(islandCacheSchema).default([]),
});

export const islandSchema = z.object({
  id: idOf('island'),
  name: z.string().min(1),
  zone: idOf('zone'),
  /** A point on the island (OpenStreetMap via Nominatim, looked up once). */
  at: geoSchema,
  /**
   * Hand-edit layer: a clip box for an island the elevation data joins to the mainland
   * (Long Island). The island is the land inside the box.
   */
  clip: geoBoundsSchema.optional(),
  /**
   * Hand-edit layer: an island too small for the elevation data (Gull Island), raised
   * by the bake as a rounded rock centered on `at`. Sizes in game meters.
   */
  rock: z
    .object({
      lengthM: z.number().positive(),
      widthM: z.number().positive(),
      /** Direction of the long axis, degrees clockwise from north. */
      bearingDeg: z.number().min(0).max(360),
      heightM: z.number().positive(),
    })
    .optional(),
  /** Plan 11 §2's tier: hero islands are walked end to end. */
  tier: z.enum(['hero', 'standard', 'minor']).optional(),
  /** What there is to find on foot, where the island is walkable (Phase 7: Stockton). */
  onFoot: islandOnFootSchema.optional(),
});

export const islandsFileSchema = z.array(islandSchema);
export type IslandDef = z.infer<typeof islandSchema>;
export type IslandOnFoot = z.infer<typeof islandOnFootSchema>;
export type IslandCache = z.infer<typeof islandCacheSchema>;
export type IslandPoi = z.infer<typeof islandPoiSchema>;
