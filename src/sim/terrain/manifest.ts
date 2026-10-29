import { z } from 'zod';

/**
 * The parts of a baked zone's `manifest.json` the runtime reads (written by
 * tools/geo/build.ts; format in tools/geo/README.md). Unknown keys pass through, so the
 * bake can add fields without breaking older builds.
 */

const gridFormat = z.object({
  type: z.enum(['u8', 'u16', 'i16']),
  scale: z.number(),
  offset: z.number(),
  encoding: z.enum(['deflate', 'delta-deflate']),
});

/** A grid of samples at `x0 + i·step`, `z0 + j·step` in zone meters. */
const frame = {
  step: z.number().positive(),
  x0: z.number(),
  z0: z.number(),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
};

export const zoneManifestSchema = z.looseObject({
  version: z.literal(1),
  zone: z.string(),
  name: z.string(),
  /** Where the zone's origin sits on the chart (meters) and its compression C. */
  frame: z.looseObject({
    origin: z.object({ x: z.number(), y: z.number() }),
    compression: z.number().positive(),
  }),
  heightFormat: gridFormat.extend({ tileSamples: z.number().int().positive() }),
  height: z.looseObject({
    ...frame,
    tilesX: z.number().int().positive(),
    tilesY: z.number().int().positive(),
    /** Path pattern with `{tx}` and `{ty}`. */
    tiles: z.string(),
  }),
  sdf: z.looseObject({ ...frame, ...gridFormat.shape, file: z.string() }),
  wind: z.looseObject({
    directions: z.number().int().positive(),
    /** Cell size; cell (i, j) covers x0 + i·cellM … x0 + (i + 1)·cellM. */
    cellM: z.number().positive(),
    x0: z.number(),
    z0: z.number(),
    width: z.number().int().positive(),
    height: z.number().int().positive(),
    shelter: gridFormat.extend({ file: z.string() }),
    fetch: gridFormat.extend({ file: z.string() }),
    funnel: gridFormat.extend({ file: z.string() }),
  }),
});

export type ZoneManifest = z.infer<typeof zoneManifestSchema>;
