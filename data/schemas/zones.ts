import { z } from 'zod';
import { idOf } from './common';

/**
 * Coastal zones (plan 03 §4, §9 `zones.json`). Authored in data units: degrees and
 * meters. Geo points are WGS84; lengths are game meters, already compressed by C, except
 * where a field says real meters.
 *
 * `bake` is what tools/geo/build.ts reads to build the zone's terrain into
 * `public/<world>`; the runtime reads the rest. Set-piece footprints are also part of
 * the bake's hand-edit layer (plan 03 §8.2 step 7): the land inside each one is
 * flattened to its ground height.
 */

export const geoSchema = z.object({
  lat: z.number().min(-90).max(90),
  lon: z.number().min(-180).max(180),
});

export const geoBoundsSchema = z
  .object({ south: z.number(), north: z.number(), west: z.number(), east: z.number() })
  .refine(
    (b) => b.west < b.east && b.south < b.north,
    'Bounds must have west < east, south < north',
  );

/** The land height curve (tools/geo/lib/merge.ts); water depth always stays 1:1. */
const landCurveSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('linear'), scale: z.number().positive() }),
  z.object({ kind: z.literal('soft-knee'), kneeM: z.number().positive() }),
]);

const bakeSchema = z.object({
  tilesX: z.number().int().positive(),
  tilesY: z.number().int().positive(),
  /** Samples per tile edge, excluding the shared edge sample. */
  tileSamples: z.number().int().positive(),
  /** Game meters between sailing heightmap samples. */
  sailingSampleM: z.number().positive(),
  /** Game meters between on-foot island samples. */
  onFootSampleM: z.number().positive(),
  /** Game meters per shelter, fetch and funneling cell. */
  windCellM: z.number().positive(),
  /** Mean lake level in NAVD88 meters; becomes height 0. */
  lakeLevelM: z.number(),
  /** The NCEI bathymetry's vertical datum (Low Water Datum, IGLD85 meters). */
  bathyDatumM: z.number(),
  /** DEM cells this far above lake level are land; lower ones are hydroflattened water. */
  landThresholdM: z.number().nonnegative(),
  landCurve: landCurveSchema.optional(),
  /** Game meters of water kept around each island's on-foot footprint. */
  islandMarginM: z.number().nonnegative(),
});

/**
 * A dredged cut (plan 03 §3.4): a channel along the segment `from`–`to`, `widthM` wide,
 * lowered to at least `depthM` below mean lake level, with banks that blend back to the
 * real terrain over `blendM`. It only ever lowers the ground, so it opens 1:1 entries
 * (the Duluth Ship Canal, Superior Entry) through compressed land and clears the
 * compressed modern piers the DEM carries.
 */
export const cutSchema = z.object({
  from: geoSchema,
  to: geoSchema,
  widthM: z.number().positive(),
  depthM: z.number().positive(),
  blendM: z.number().nonnegative(),
});

/**
 * A harbor set piece's footprint (plan 03 §3.4): a rectangle on the zone's water plane,
 * anchored on the shoreline at `at` and facing `bearingDeg` (clockwise from north, from
 * the shore out over the water). It reaches `inlandM` behind the anchor, `seawardM` out
 * in front and `alongM` along the shore. The bake flattens the land inside it to
 * `groundM` above mean lake level, blending back to the real terrain over `blendM`; the
 * water inside is left as it is.
 */
export const setPieceSchema = z.object({
  id: idOf('setpiece'),
  name: z.string().min(1),
  port: idOf('port'),
  at: geoSchema,
  bearingDeg: z.number().min(0).max(360),
  alongM: z.number().positive(),
  inlandM: z.number().positive(),
  seawardM: z.number().positive(),
  groundM: z.number().positive(),
  blendM: z.number().nonnegative(),
  /** Channels dredged after the land is flattened. */
  cuts: z.array(cutSchema).optional(),
});

export const zoneSchema = z.object({
  id: idOf('zone'),
  name: z.string().min(1),
  /** The baked zone's folder under the site root, with a trailing slash. */
  world: z.string().regex(/^world\/[a-z0-9_]+\/$/),
  /** Horizontal compression C (plan 03 §3.2). */
  compression: z.number().positive(),
  /** The zone's middle; the bake rounds it to whole chart meters as the zone origin. */
  center: geoSchema,
  bake: bakeSchema,
  /**
   * Soft zone edges (plan 03 §4): fog closes in over the last `fogFadeM` before the edge
   * of the baked terrain, down to `edgeVisibilityM` at the edge, where the ship is held.
   */
  edge: z.object({
    fogFadeM: z.number().positive(),
    edgeVisibilityM: z.number().positive(),
  }),
  /** Where a new run starts, in zone meters, and the heading in degrees from north. */
  spawn: z.object({ x: z.number(), z: z.number(), headingDeg: z.number() }),
  setPieces: z.array(setPieceSchema),
});

export const zonesFileSchema = z.array(zoneSchema);
export type ZoneDef = z.infer<typeof zoneSchema>;
export type SetPieceDef = z.infer<typeof setPieceSchema>;
export type CutDef = z.infer<typeof cutSchema>;
