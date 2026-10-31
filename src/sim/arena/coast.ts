import { chartToZone, type Chart, type ZoneFrame } from '../../core/coords';
import type { ChartGeography, Ring } from '../chart/geography';

/**
 * The coast in view from an arena (plan 03 §6.3): low silhouettes generated from the
 * chart's land mask, since an arena has no terrain tiles. Each run of coastline within
 * view is resampled to an even spacing, with the side the land is on and a crest height
 * that varies along the shore. Cut list #1 drops them if they cost too much.
 */

/** How far the silhouettes reach, zone meters (48 km of real coast at C = 8). */
export const COAST_VIEW_M = 6000;
/** Spacing along the shore, zone meters. */
export const COAST_STEP_M = 40;

export interface CoastPoint {
  x: number;
  z: number;
  /** Unit vector pointing inland, zone frame. */
  nx: number;
  nz: number;
  /** Crest height, meters. */
  heightM: number;
}

export interface CoastRun {
  ringId: string;
  points: CoastPoint[];
}

/** Twice the signed area: positive when the ring runs counter-clockwise (chart y north). */
function signedArea2(points: readonly Chart[]): number {
  let a = 0;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const p = points[i] as Chart;
    const q = points[j] as Chart;
    a += (q.x - p.x) * (q.y + p.y);
  }
  return -a;
}

/** Smooth 0–1 noise along the shore, so crests rise and fall without a pattern. */
function along01(s: number, seed: number): number {
  const v =
    Math.sin(s * 0.0011 + seed) * 0.5 +
    Math.sin(s * 0.0037 + seed * 1.7) * 0.3 +
    Math.sin(s * 0.0093 + seed * 2.3) * 0.2;
  return v * 0.5 + 0.5;
}

/**
 * The coastline runs within `rangeM` (zone meters) of the frame's origin. The lake ring
 * is the mainland, higher (the North Shore's hills, the Wisconsin bluffs); islands are
 * lower. Heights are made up: the chart has no elevations, and at this distance only the
 * shape of the skyline reads.
 */
export function coastRuns(
  geo: ChartGeography,
  frame: ZoneFrame,
  rangeM = COAST_VIEW_M,
  stepM = COAST_STEP_M,
): CoastRun[] {
  const runs: CoastRun[] = [];
  const reach = rangeM * frame.compression;
  const o = frame.origin;
  const near = (r: Ring): boolean =>
    r.bounds.max.x >= o.x - reach &&
    r.bounds.min.x <= o.x + reach &&
    r.bounds.max.y >= o.y - reach &&
    r.bounds.min.y <= o.y + reach;
  const rings: [Ring, boolean][] = [
    [geo.water, true],
    ...geo.islands.map((r): [Ring, boolean] => [r, false]),
  ];
  for (const [ring, mainland] of rings) {
    if (!near(ring)) continue;
    const ccw = signedArea2(ring.points) > 0;
    // Counter-clockwise, the interior is on the left. The lake's interior is water.
    const landLeft = ccw !== mainland;
    const zs = ring.points.map((p) => chartToZone(p, frame));
    const seed = hash(ring.id);
    const minH = mainland ? 22 : 10;
    const spanH = mainland ? 34 : 16;
    let run: CoastPoint[] = [];
    let s = 0;
    let carry = 0;
    const flush = (): void => {
      if (run.length >= 2) runs.push({ ringId: ring.id, points: run });
      run = [];
    };
    const count = zs.length;
    for (let i = 0; i < count; i++) {
      const a = zs[i] as { x: number; z: number };
      const b = zs[(i + 1) % count] as { x: number; z: number };
      const dx = b.x - a.x;
      const dz = b.z - a.z;
      const len = Math.hypot(dx, dz);
      if (len === 0) continue;
      // Left of travel in the zone frame (x east, z south) is (dz, -dx).
      const lx = dz / len;
      const lz = -dx / len;
      const nx = landLeft ? -lx : lx;
      const nz = landLeft ? -lz : lz;
      let t = carry;
      for (; t < len; t += stepM) {
        const x = a.x + (dx * t) / len;
        const z = a.z + (dz * t) / len;
        if (Math.hypot(x, z) > rangeM) {
          flush();
          continue;
        }
        const heightM = minH + spanH * along01(s + t, seed);
        run.push({ x, z, nx, nz, heightM });
      }
      carry = t - len;
      s += len;
    }
    flush();
  }
  return runs;
}

function hash(id: string): number {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 16777619);
  return ((h >>> 0) % 1000) / 10;
}
