import type { TerrainBounds } from './zone-terrain';

/**
 * Soft zone edges (plan 03 §4): fog closes in over the last stretch before the edge of
 * the baked terrain, a "Zone edge" chip shows on the HUD, and at the very edge the ship
 * is held, the one invisible wall. Chart travel takes over at the edge in Phase 3.
 */

export interface ZoneEdge {
  /** Fog starts closing in this far inside the edge, meters. */
  fogFadeM: number;
  /** Visibility at the edge itself, meters. */
  edgeVisibilityM: number;
  /** How far inside the edge the chart is offered; the outer half of the fade without it. */
  chartFromM?: number | undefined;
}

/** Edge factor past which the chart is offered when the zone doesn't set `chartFromM`. */
export const CHART_EDGE_FACTOR = 0.5;

/** True where the ship can take to the chart (Phase 3 piece D): near enough the edge. */
export function offersChart(b: TerrainBounds, edge: ZoneEdge, x: number, z: number): boolean {
  if (edge.chartFromM !== undefined) return edgeDistance(b, x, z) <= edge.chartFromM;
  return edgeFactor(b, edge, x, z) > CHART_EDGE_FACTOR;
}

/** How far inside the wall the ship's center stops, so the hull stays on the terrain. */
export const EDGE_HOLD_M = 20;

/** Distance from (x, z) to the nearest edge of `b`: positive inside, negative outside. */
export function edgeDistance(b: TerrainBounds, x: number, z: number): number {
  return Math.min(x - b.minX, b.maxX - x, z - b.minZ, b.maxZ - z);
}

/** 0 well inside, rising to 1 at the edge over the fog fade. */
export function edgeFactor(b: TerrainBounds, edge: ZoneEdge, x: number, z: number): number {
  const d = edgeDistance(b, x, z);
  return Math.min(1, Math.max(0, 1 - d / edge.fogFadeM));
}

/**
 * The visibility the edge allows at (x, z), meters: unlimited until the fade starts,
 * then falling geometrically to `edgeVisibilityM` at the edge, so the fog thickens
 * evenly to the eye as the ship sails out.
 */
export function edgeVisibility(
  b: TerrainBounds,
  edge: ZoneEdge,
  x: number,
  z: number,
  clearM: number,
): number {
  const t = edgeFactor(b, edge, x, z);
  if (t <= 0) return Number.POSITIVE_INFINITY;
  return clearM * Math.pow(edge.edgeVisibilityM / clearM, t);
}

/** Clamps a point to the held area; true when it had to move. */
export function holdInside(b: TerrainBounds, p: { x: number; z: number }): boolean {
  const x = Math.min(Math.max(p.x, b.minX + EDGE_HOLD_M), b.maxX - EDGE_HOLD_M);
  const z = Math.min(Math.max(p.z, b.minZ + EDGE_HOLD_M), b.maxZ - EDGE_HOLD_M);
  const moved = x !== p.x || z !== p.z;
  p.x = x;
  p.z = z;
  return moved;
}
