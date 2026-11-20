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
  /** A curio found with it (plan 11 §7.1; Phase 9 piece O), kept in `curios[]`. */
  curio: idOf('curio').optional(),
});

/** A beach or a dock where a boat comes in (Phase 9 piece Q): named, for the jump menu. */
export const islandLandingSchema = islandPointSchema.extend({ name: z.string().min(1) });

/**
 * Someone who lives on the island (plan 11 §3.3; Phase 9 piece Q): a fisherman, a farmer
 * or one of La Pointe's villagers, on the keepers' perception (`npc_types.json`
 * `npc.<kind>`), who sees and reports. By day they walk their round, the `resident` marks
 * of their home's prefab and then their own points; by night they're indoors asleep, and
 * their windows are lit through the evening.
 */
export const islandResidentSchema = z.object({
  id: z.string().regex(/^[a-z0-9_]+$/),
  name: z.string().min(1),
  kind: z.enum(['fisherman', 'farmer', 'villager']),
  /** The placed prefab (an `onFoot.pois` id) they live and work at. */
  home: z
    .string()
    .regex(/^[a-z0-9_]+$/)
    .optional(),
  /** More stops on their round, on the island's tiles. */
  round: z.array(islandPointSchema).default([]),
  /** What they say to a visitor by day, a line a day in turn. */
  talk: z.array(z.string().min(1)).min(1),
});

/** A village of the zone's harbor kit standing on the island (La Pointe on Madeline). */
export const islandVillageSchema = z.object({
  harbor: idOf('harbor'),
  port: idOf('port'),
  /** The harbor building (by its name) whose counter is the trading post. */
  tradingPost: z.string().min(1),
});

/** Walking the island (plan 08 §20.4 piece H): its points of interest and its cache. */
export const islandOnFootSchema = z.object({
  pois: z.array(islandPoiSchema).default([]),
  caches: z.array(islandCacheSchema).default([]),
  landings: z.array(islandLandingSchema).default([]),
  residents: z.array(islandResidentSchema).default([]),
  /**
   * How fast the residents' word reaches the law (as a keeper's `reporting`): a light's
   * keeper carries it where there's one; otherwise a boat to town (Phase 9 piece Q).
   */
  reporting: z.enum(['fast', 'medium', 'slow']).default('slow'),
  village: islandVillageSchema.optional(),
});

export const islandSchema = z
  .object({
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
     * A walkable pad on the mainland, not an island (plan 09 §2.1, decided 2026-10-22: the
     * one exception to the mainland not being walkable). The bake cuts 1 m tiles for the
     * land inside `clip`, which it needs, and the game walks them as it walks an island's;
     * the chart doesn't name it and no island posse lands on it. Phase 8: the Siskiwit Bay
     * logging camp.
     */
    mainland: z.boolean().optional(),
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
  })
  .refine((i) => !i.mainland || !!i.clip, 'A mainland pad needs a clip box: its extent')
  .superRefine((i, ctx) => {
    const pois = new Set(i.onFoot?.pois.map((p) => p.id) ?? []);
    const ids = new Set<string>();
    for (const r of i.onFoot?.residents ?? []) {
      if (ids.has(r.id))
        ctx.addIssue({ code: 'custom', message: `${i.id}: resident ${r.id} twice` });
      ids.add(r.id);
      if (r.home && !pois.has(r.home)) {
        ctx.addIssue({ code: 'custom', message: `${i.id}: ${r.id}'s home ${r.home} isn't placed` });
      }
    }
  });

export const islandsFileSchema = z.array(islandSchema);
export type IslandDef = z.infer<typeof islandSchema>;
export type IslandOnFoot = z.infer<typeof islandOnFootSchema>;
export type IslandCache = z.infer<typeof islandCacheSchema>;
export type IslandPoi = z.infer<typeof islandPoiSchema>;
export type IslandResident = z.infer<typeof islandResidentSchema>;
export type IslandLanding = z.infer<typeof islandLandingSchema>;
