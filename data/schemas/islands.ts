import { z } from 'zod';
import { idOf } from './common';
import { geoBoundsSchema, geoSchema } from './zones';

/**
 * Islands (plan 03 §9 `islands.json`, plan 11 §15). The bake (tools/geo/build.ts) finds
 * each island's land from its center point and cuts its 1 m on-foot tiles; the
 * footprint it found is in the zone's baked `manifest.json`. Landings and points of
 * interest come with plan 11.
 */
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
});

export const islandsFileSchema = z.array(islandSchema);
export type IslandDef = z.infer<typeof islandSchema>;
