// Step 2 of plan 03 §8.2: one elevation surface, land positive and lake bottom negative,
// relative to the mean lake level.

import { raster, type Raster } from './raster.ts';

export interface MergeOptions {
  /** Mean lake level, NAVD88 meters (becomes 0). */
  lakeLevelM: number;
  /** The bathymetry's datum (Low Water Datum), IGLD85 meters. */
  bathyDatumM: number;
  /** DEM samples at least this far above lake level are land. */
  landThresholdM: number;
  /** The shallowest a water sample may be, so the shoreline stays a clean zero crossing. */
  minDepthM?: number;
  /** How land heights map into the game (water depth always stays 1:1). Default 1:1. */
  landCurve?: LandCurve;
}

/**
 * Compression makes slopes C times steeper when heights stay 1:1, so hills turn into walls
 * on foot. A curve trades height for walkability:
 * - `linear`: h × scale.
 * - `soft-knee`: k·ln(1 + h/k). Nearly 1:1 for low ground (beaches, shore cliffs, sea
 *   caves), then flattening, so high ground loses the most. Slopes shrink by 1 / (1 + h/k).
 */
export type LandCurve = { kind: 'linear'; scale: number } | { kind: 'soft-knee'; kneeM: number };

export function applyLandCurve(h: number, curve: LandCurve | undefined): number {
  if (!curve || h <= 0) return h;
  if (curve.kind === 'linear') return h * curve.scale;
  return curve.kneeM * Math.log1p(h / curve.kneeM);
}

const NODATA = -9999;

/**
 * Land comes from the DEM (10 m), which hydroflattens the lake to its surface, so a DEM
 * sample within `landThresholdM` of lake level is water. Water depth comes from the
 * bathymetry (≈90 m). Where the coarse bathymetry still reads as land near a shore, the
 * sample is clamped to `minDepthM` below the surface, which reads as a shallow shelf.
 * NAVD88 and IGLD85 differ by a few centimeters here, which is ignored.
 */
export function mergeElevation(dem: Raster, bathy: Raster, opts: MergeOptions): Raster {
  const minDepth = opts.minDepthM ?? 0.3;
  const bathyOffset = opts.bathyDatumM - opts.lakeLevelM;
  const out = raster(dem.width, dem.height);
  for (let k = 0; k < out.data.length; k++) {
    const d = dem.data[k] ?? 0;
    if (d !== NODATA && d - opts.lakeLevelM >= opts.landThresholdM) {
      out.data[k] = applyLandCurve(d - opts.lakeLevelM, opts.landCurve);
      continue;
    }
    const b = bathy.data[k] ?? 0;
    const depth = b === NODATA ? -minDepth : b + bathyOffset;
    out.data[k] = Math.min(depth, -minDepth);
  }
  return out;
}
