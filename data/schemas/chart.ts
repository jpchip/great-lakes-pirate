import { z } from 'zod';
import { idOf } from './common';

/**
 * Chart mode data (plan 03 §5, §8.2 step 9, §9 `chart.json`). Positions are WGS84
 * `[lon, lat]` in degrees, GeoJSON order.
 *
 * Two files share this schema. `chart.json` is hand-authored: the charted area, ports,
 * lights and fallback zone bounds. `chart-coast.json` is baked by `npm run geo:chart`
 * (tools/geo/chart.ts, plan 03 §8.2 step 9) from NOAA bathymetry and the USGS DEM: the
 * lake ring, its islands, depth contours and soundings. Don't edit it by hand.
 */

const lonLat = z.tuple([z.number().min(-180).max(180), z.number().min(-90).max(90)]);
const ring = z.array(lonLat).min(3);
const bounds = z
  .object({ west: z.number(), south: z.number(), east: z.number(), north: z.number() })
  .refine(
    (b) => b.west < b.east && b.south < b.north,
    'Bounds must have west < east, south < north',
  );

export const chartFeatureSchema = z.discriminatedUnion('kind', [
  /** The area the player holds charts for; everything outside is "beyond your charts". */
  z.object({ id: idOf('chart'), kind: z.literal('charted'), name: z.string().min(1), bounds }),
  /** Open water, as one outer ring. Where it meets the chart edge it closes straight across. */
  z.object({ id: idOf('water'), kind: z.literal('water'), name: z.string().min(1), ring }),
  /** An island inside the water ring. Most baked islets have no name. */
  z.object({
    id: idOf('island'),
    kind: z.literal('land'),
    name: z.string().min(1).optional(),
    ring,
  }),
  /**
   * A depth contour: rings around everything shallower than `fathoms` (land included), so
   * filling them inside the water shades the shallows.
   */
  z.object({
    id: idOf('depth'),
    kind: z.literal('depth'),
    fathoms: z.number().positive(),
    rings: z.array(ring),
  }),
  /**
   * Soundings as `[lon, lat, fathoms, level]`. Level 0 sits on a 16 nm grid, then 8, 4, 2
   * and 1 nm, so the chart can thin them to a steady spacing at any zoom.
   */
  z.object({
    id: idOf('soundings'),
    kind: z.literal('soundings'),
    points: z.array(
      z.tuple([
        z.number().min(-180).max(180),
        z.number().min(-90).max(90),
        z.number().nonnegative(),
        z.number().int().min(0).max(4),
      ]),
    ),
  }),
  z.object({
    id: idOf('port'),
    kind: z.literal('port'),
    name: z.string().min(1),
    at: lonLat,
    zone: idOf('zone'),
  }),
  z.object({
    id: idOf('light'),
    kind: z.literal('light'),
    name: z.string().min(1),
    at: lonLat,
    /** Lit in spring 1900, or standing dark (R1a snapshot). */
    status: z.enum(['lit', 'dark']),
  }),
  /** A coastal zone's geo bounds (plan 03 §4); `zones.json` takes these over later. */
  z.object({ id: idOf('zone'), kind: z.literal('zone'), name: z.string().min(1), bounds }),
]);

export const chartFileSchema = z.array(chartFeatureSchema);
export type ChartFeature = z.infer<typeof chartFeatureSchema>;
