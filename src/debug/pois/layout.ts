import type { PoiDef, PoiSite } from '../../../data/schemas/pois';
import {
  POIS,
  placePoi,
  poiDef,
  type PlacedIsland,
  type PlacedPoiMark,
} from '../../sim/islands/on-foot';

/**
 * The POI kits' showcase (Phase 9 piece P, `/pois.html`): every prefab set down by the
 * game's own `placePoi` on a stretch of made-up ground shaped like its `site` (a shore
 * with water off it, a beach, a clearing, a hilltop, a cliff foot), side by side, facing
 * north. Also each tier's set for `bench.island`'s POI share.
 */

/** Each prefab's cell, meters along x; the ground blends back to a meadow between them. */
export const CELL_M = 80;
const MEADOW_Y = 2;

export interface ShowcaseCell {
  poi: PoiDef;
  x: number;
  z: number;
}

/** One cell's ground, by its site, around its origin (ox, oz); out (north) is -z. */
function siteGround(site: PoiSite, dx: number, dz: number): number {
  switch (site) {
    case 'shore':
      // A gentle bank down into the water about 8 m out.
      return Math.min(4, 0.8 + dz * 0.1);
    case 'beach':
      return Math.min(3, 0.5 + dz * 0.05);
    case 'hilltop':
      return Math.max(MEADOW_Y, 14 - Math.hypot(dx, dz) * 0.25);
    case 'cliff':
      // Level in front, a steep bank rising behind the face.
      return dz < 1.5 ? MEADOW_Y : Math.min(18, MEADOW_Y + (dz - 1.5) * 2.2);
    case 'clearing':
      return MEADOW_Y + Math.sin(dx * 0.08) * 0.4 + Math.cos(dz * 0.11) * 0.3;
  }
}

const smooth = (a: number, b: number, x: number): number => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/** The made-up ground under a row of cells. */
export function showcaseGround(cells: readonly ShowcaseCell[]): (x: number, z: number) => number {
  return (x, z) => {
    const k = Math.round(x / CELL_M);
    const c = cells.find((q) => Math.round(q.x / CELL_M) === k);
    if (!c) return MEADOW_Y;
    const local = siteGround(c.poi.site, x - c.x, z - c.z);
    // Back to meadow toward the cell's sides, so neighbours don't meet in a step.
    const w = smooth(CELL_M * 0.32, CELL_M * 0.46, Math.abs(x - c.x));
    // Keep the water and the beach running the whole way along the north edge.
    const meadow =
      c.poi.site === 'shore' || c.poi.site === 'beach' ? Math.min(MEADOW_Y, local) : MEADOW_Y;
    return local * (1 - w) + meadow * w;
  };
}

export const TIER_SETS: Readonly<Record<'hero' | 'standard' | 'minor', readonly string[]>> = {
  hero: [
    'poi.quarry',
    'poi.fish_camp',
    'poi.farmstead',
    'poi.trapper_cabin',
    'poi.viewpoint',
    'poi.beach_wreck',
    'poi.cave_mouth',
    'poi.cairn',
    'poi.dig_spot',
  ],
  standard: ['poi.fish_camp', 'poi.viewpoint', 'poi.beach_wreck'],
  minor: ['poi.cairn'],
};

/** The cells for every prefab (`ids` absent) or the ones named, in a row along x. */
export function showcaseCells(ids?: readonly string[]): ShowcaseCell[] {
  const defs = ids ? ids.flatMap((id) => poiDef(id) ?? []) : [...POIS];
  return defs.map((poi, k) => ({ poi, x: k * CELL_M, z: 0 }));
}

/** The cells placed as one walkable island would be, for the game's own POI view. */
export function showcaseIsland(cells: readonly ShowcaseCell[]): {
  island: PlacedIsland;
  marks: PlacedPoiMark[];
  ground: (x: number, z: number) => number;
} {
  const ground = showcaseGround(cells);
  const island: PlacedIsland = {
    id: 'island.showcase',
    name: 'Showcase',
    pieces: [],
    ladders: [],
    caches: [],
    clearings: [],
    marks: [],
  };
  for (const c of cells) {
    const one = placePoi(
      c.poi,
      { id: c.poi.id.slice(4), x: c.x, z: c.z, facingDeg: 0 },
      { x0: 0, z0: 0 },
      ground,
    );
    island.pieces.push(...one.pieces);
    island.ladders.push(...one.ladders);
    island.marks.push(...one.marks);
    island.clearings.push(one.clearing);
  }
  return { island, marks: island.marks, ground };
}
