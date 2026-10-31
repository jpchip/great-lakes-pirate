import { DEFAULT_COMPRESSION, zoneToChart, type Chart, type ZoneFrame } from '../../core/coords';
import { distance, isWater, type ChartGeography } from '../chart/geography';

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
}

export function sampleArenaLand(geo: ChartGeography, frame: ZoneFrame, halfM: number): ArenaLand {
  const n = Math.ceil((halfM * 2) / LAND_CELL_M);
  const cells = new Uint8Array(n * n);
  let any = false;
  // Scanlines on the chart: every ring's crossings of the row, then even-odd along it. The
  // lake ring and the islands inside it share one parity, so odd is water. One pass over
  // the rings per row instead of a point-in-polygon test per cell.
  const rings = [geo.water, ...geo.islands];
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
      if (k % 2 === 0) {
        cells[j * n + i] = 1;
        any = true;
      }
    }
  }
  return {
    halfM,
    allWater: !any,
    isLand(x, z) {
      if (!any) return false;
      const i = Math.floor((x + halfM) / LAND_CELL_M);
      const j = Math.floor((z + halfM) / LAND_CELL_M);
      // Beyond the grid counts as water: the arena's edge ends play before then.
      if (i < 0 || j < 0 || i >= n || j >= n) return false;
      return cells[j * n + i] === 1;
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
