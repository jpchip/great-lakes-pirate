import { DEFAULT_COMPRESSION, zoneToChart, type Chart, type ZoneFrame } from '../../core/coords';
import { distance, isWater, type ChartGeography, type Ring } from '../chart/geography';

/**
 * Land in and around an arena (plan 03 §6.3). An arena has no terrain tiles, but the
 * encounter can still happen within sight of a shore, so the chart's land mask is
 * sampled once into a small grid: the ships steer clear of it and the player is held off
 * it, like the zone's edge. Most arenas are all water and the grid is never consulted.
 */

/** Grid spacing, zone meters (200 m on the chart at C = 8). */
export const LAND_CELL_M = 25;

export interface ArenaLand {
  /** Half the gridded square's side, zone meters, centered on the frame origin. */
  readonly halfM: number;
  /** True when no cell is land, so lookups can be skipped. */
  readonly allWater: boolean;
  isLand(x: number, z: number): boolean;
  /**
   * Shoal water a deep-draft ship (the *Morrill*) won't enter (Phase 5 piece C): inside the
   * chart's shallowest depth contour in an arena, under her draft in a zone.
   */
  isShoal?(x: number, z: number): boolean;
  /** True when no cell is shoal, so the shoal lookups can be skipped. */
  readonly allDeep?: boolean;
}

/** The depth contour, fathoms, inside which the *Morrill* won't go: the chart's shallowest. */
export const SHOAL_FATHOMS = 3;

/** Even-odd fill of `rings` on the arena grid: 1 where a cell's centre is inside an odd count. */
function fillRings(
  rings: readonly Ring[],
  frame: ZoneFrame,
  halfM: number,
  n: number,
  inside: (crossings: number) => boolean,
): { cells: Uint8Array; any: boolean } {
  const cells = new Uint8Array(n * n);
  let any = false;
  // Scanlines on the chart: every ring's crossings of the row, then parity along it. One
  // pass over the rings per row instead of a point-in-polygon test per cell.
  const xs: number[] = [];
  for (let j = 0; j < n; j++) {
    const z = -halfM + (j + 0.5) * LAND_CELL_M;
    const y = zoneToChart({ x: 0, z }, frame).y;
    xs.length = 0;
    for (const ring of rings) {
      if (y < ring.bounds.min.y || y > ring.bounds.max.y) continue;
      const pts = ring.points;
      for (let a = 0, b = pts.length - 1; a < pts.length; b = a++) {
        const p = pts[a] as Chart;
        const q = pts[b] as Chart;
        if (p.y > y !== q.y > y) xs.push(p.x + ((y - p.y) * (q.x - p.x)) / (q.y - p.y));
      }
    }
    xs.sort((u, v) => u - v);
    let k = 0;
    for (let i = 0; i < n; i++) {
      const x = zoneToChart({ x: -halfM + (i + 0.5) * LAND_CELL_M, z }, frame).x;
      while (k < xs.length && (xs[k] as number) < x) k++;
      if (inside(k)) {
        cells[j * n + i] = 1;
        any = true;
      }
    }
  }
  return { cells, any };
}

export function sampleArenaLand(geo: ChartGeography, frame: ZoneFrame, halfM: number): ArenaLand {
  const n = Math.ceil((halfM * 2) / LAND_CELL_M);
  // The lake ring and the islands inside it share one parity, so odd is water.
  const land = fillRings([geo.water, ...geo.islands], frame, halfM, n, (k) => k % 2 === 0);
  // The rings bound the deep side (the shallow side runs out to the grid's edge), so even is
  // shoal (or land).
  const contour = geo.depths.find((d) => d.fathoms >= SHOAL_FATHOMS);
  const shoal = contour
    ? fillRings(contour.rings, frame, halfM, n, (k) => k % 2 === 0)
    : { cells: new Uint8Array(0), any: false };
  const cell = (x: number, z: number): number => {
    const i = Math.floor((x + halfM) / LAND_CELL_M);
    const j = Math.floor((z + halfM) / LAND_CELL_M);
    // Beyond the grid counts as open water: the arena's edge ends play before then.
    if (i < 0 || j < 0 || i >= n || j >= n) return -1;
    return j * n + i;
  };
  return {
    halfM,
    allWater: !land.any,
    allDeep: !shoal.any,
    isLand(x, z) {
      if (!land.any) return false;
      const c = cell(x, z);
      return c >= 0 && land.cells[c] === 1;
    },
    isShoal(x, z) {
      if (!shoal.any) return false;
      const c = cell(x, z);
      return c >= 0 && shoal.cells[c] === 1 && land.cells[c] !== 1;
    },
  };
}

/** An arena with no land at all, for tests and for when the chart isn't to hand. */
export const OPEN_LAKE: ArenaLand = { halfM: Infinity, allWater: true, isLand: () => false };

/**
 * Where to centre an arena met at `at` (chart meters): `at` itself when the water is
 * clear for `clearM` zone meters around it, otherwise the nearest clear point within a
 * few kilometres, so the encounter isn't played against a beach. Falls back to `at`.
 */
export function clearArenaCentre(
  geo: ChartGeography,
  at: Chart,
  clearM: number,
  compression = DEFAULT_COMPRESSION,
): Chart {
  const r = clearM * compression;
  // The square the arena plays in, sampled on a 7 × 7 grid.
  const clear = (c: Chart): boolean => {
    for (let j = -3; j <= 3; j++) {
      for (let i = -3; i <= 3; i++) {
        if (!isWater(geo, { x: c.x + (i / 3) * r, y: c.y + (j / 3) * r })) return false;
      }
    }
    return true;
  };
  if (clear(at)) return { ...at };
  let best: Chart | undefined;
  for (let step = 1; step <= 8 && !best; step++) {
    const d = step * r * 0.25;
    for (let k = 0; k < 24; k++) {
      const a = (k / 24) * Math.PI * 2;
      const c = { x: at.x + Math.sin(a) * d, y: at.y + Math.cos(a) * d };
      if (clear(c) && (!best || distance(c, at) < distance(best, at))) best = c;
    }
  }
  return best ?? { ...at };
}
