import { chartToZone, zoneToChart, type Chart, type ZoneFrame } from '../../core/coords';
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
/** The silhouette's crest stands this many crest-heights inland of the shore. */
export const CREST_INLAND = 8;
/** And its back slope runs down to this many crest-heights inland. */
export const BACK_INLAND = 40;
/**
 * A ring edge longer than this (chart meters) is where the chart's data was cut off, not
 * a shore: the lake ring's straight eastern edge out in open water. No silhouette there.
 */
const CUT_EDGE_M = 10_000;

export interface CoastPoint {
  x: number;
  z: number;
  /** Unit vector pointing inland, zone frame. */
  nx: number;
  nz: number;
  /** Crest height, meters. */
  heightM: number;
  /**
   * How far the silhouette may run inland, zone meters: its full profile
   * (BACK_INLAND crest-heights), or less where the land is narrower than that, so a
   * spit, a point or a small island never throws its back slope out over the water
   * beyond it. Half the land's width along the normal, so the two shores meet mid-way.
   */
  inlandM: number;
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
      if (len * frame.compression > CUT_EDGE_M) {
        flush();
        carry = 0;
        s += len;
        continue;
      }
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
        const full = heightM * BACK_INLAND;
        const inlandM = Math.min(full, landWidthM(geo, frame, x, z, nx, nz, 2 * full) / 2);
        run.push({ x, z, nx, nz, heightM, inlandM });
      }
      carry = t - len;
      s += len;
    }
    flush();
  }
  return runs;
}

/**
 * How far the land runs from the shore point (x, z) along the inland normal before the
 * water comes back, zone meters, up to `maxM`: where that ray first crosses a shore. It
 * starts a little inland so the shore it stands on doesn't count.
 */
function landWidthM(
  geo: ChartGeography,
  frame: ZoneFrame,
  x: number,
  z: number,
  nx: number,
  nz: number,
  maxM: number,
): number {
  const start = 1;
  const a = zoneToChart({ x: x + nx * start, z: z + nz * start }, frame);
  const b = zoneToChart({ x: x + nx * maxM, z: z + nz * maxM }, frame);
  const minX = Math.min(a.x, b.x);
  const maxX = Math.max(a.x, b.x);
  const minY = Math.min(a.y, b.y);
  const maxY = Math.max(a.y, b.y);
  let best = 1;
  for (const ring of [geo.water, ...geo.islands]) {
    const r = ring.bounds;
    if (r.min.x > maxX || r.max.x < minX || r.min.y > maxY || r.max.y < minY) continue;
    const pts = ring.points;
    for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
      const c = pts[j] as Chart;
      const d = pts[i] as Chart;
      if (Math.max(c.x, d.x) < minX || Math.min(c.x, d.x) > maxX) continue;
      if (Math.max(c.y, d.y) < minY || Math.min(c.y, d.y) > maxY) continue;
      const t = crossing(a, b, c, d);
      if (t !== undefined && t < best) best = t;
    }
  }
  return start + best * (maxM - start);
}

/** Fraction along a → b where it crosses segment c → d, if it does. */
function crossing(a: Chart, b: Chart, c: Chart, d: Chart): number | undefined {
  const rx = b.x - a.x;
  const ry = b.y - a.y;
  const sx = d.x - c.x;
  const sy = d.y - c.y;
  const denom = rx * sy - ry * sx;
  if (denom === 0) return undefined;
  const t = ((c.x - a.x) * sy - (c.y - a.y) * sx) / denom;
  const u = ((c.x - a.x) * ry - (c.y - a.y) * rx) / denom;
  return t >= 0 && t <= 1 && u >= 0 && u <= 1 ? t : undefined;
}

function hash(id: string): number {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 16777619);
  return ((h >>> 0) % 1000) / 10;
}
