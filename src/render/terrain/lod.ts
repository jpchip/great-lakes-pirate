import { BACKDROP_STRIDE } from '../../sim/terrain/load';
import type { TerrainBounds } from '../../sim/terrain/zone-terrain';

/**
 * Which sailing tiles get their own mesh, and at what detail (plan 03 §8.3): geomipmapped
 * tiles, each drawn at one stride picked by its distance from the camera, with skirts
 * hiding the cracks between neighbors. The stride doubles every `lodM` meters out, and a
 * tile past `streamM`, or whose stride would reach the backdrop's, is left to the
 * whole-zone backdrop. Pure functions, so tests can check the draw-call budget.
 */

export interface TerrainLod {
  /** Heightmap samples per vertex for the nearest tiles (4 m each). */
  stride: number;
  /** The stride doubles every this many meters from the camera. */
  lodM: number;
  /** Tiles farther than this are drawn by the backdrop. */
  streamM: number;
}

/** A tile keeps its stride until the camera is this far past a boundary, so LODs don't flicker. */
export const LOD_HYSTERESIS_M = 64;

/** The stride for a tile `d` meters away, or 0 when the backdrop draws it. */
export function strideAt(d: number, lod: TerrainLod): number {
  if (d > lod.streamM) return 0;
  const stride = lod.stride * 2 ** Math.floor(d / lod.lodM);
  return stride < BACKDROP_STRIDE ? stride : 0;
}

/** Coarseness for comparing strides: the backdrop (0) is the coarsest. */
const rank = (stride: number): number => (stride === 0 ? Number.POSITIVE_INFINITY : stride);

/** The stride to draw a tile at, keeping `current` while it's within the hysteresis. */
export function nextStride(d: number, lod: TerrainLod, current: number): number {
  const finer = rank(strideAt(Math.max(0, d - LOD_HYSTERESIS_M), lod));
  const coarser = rank(strideAt(d + LOD_HYSTERESIS_M, lod));
  const r = rank(current);
  return r >= finer && r <= coarser ? current : strideAt(d, lod);
}

/** Distance from a camera at (x, y, z) to a tile on the water plane, meters. */
export function tileDistance(b: TerrainBounds, x: number, y: number, z: number): number {
  const dx = Math.max(b.minX - x, 0, x - b.maxX);
  const dz = Math.max(b.minZ - z, 0, z - b.maxZ);
  return Math.hypot(dx, dz, Math.max(y, 0));
}
