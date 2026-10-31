import { ChartProjection, type Chart, type Geo } from '../../core/coords';

/**
 * Chart geography (plan 03 §5, §8.2 step 9): the parsed chart.json features projected
 * to chart meters, plus the land-mask queries that course plotting needs. Pure data and
 * math, so it unit-tests in Node.
 */

/** Feature shapes as they arrive from chart.json (validated by data/schemas/chart.ts). */
type LonLat = readonly [number, number];
interface GeoBounds {
  west: number;
  south: number;
  east: number;
  north: number;
}
export type ChartFeatureInput =
  | { id: string; kind: 'charted'; name: string; bounds: GeoBounds }
  | { id: string; kind: 'water'; name: string; ring: readonly LonLat[] }
  | { id: string; kind: 'land'; name?: string | undefined; ring: readonly LonLat[] }
  | { id: string; kind: 'depth'; fathoms: number; rings: readonly (readonly LonLat[])[] }
  | {
      id: string;
      kind: 'soundings';
      points: readonly (readonly [number, number, number, number])[];
    }
  | { id: string; kind: 'port'; name: string; at: LonLat; zone: string }
  | { id: string; kind: 'light'; name: string; at: LonLat; status: 'lit' | 'dark' }
  | { id: string; kind: 'zone'; name: string; bounds: GeoBounds };

export interface Rect {
  min: Chart;
  max: Chart;
}

export interface Ring {
  id: string;
  /** Unnamed for most baked islets. */
  name?: string;
  points: Chart[];
  bounds: Rect;
}

export interface ChartPort {
  id: string;
  name: string;
  pos: Chart;
  zoneId: string;
}

export interface ChartLight {
  id: string;
  name: string;
  pos: Chart;
  status: 'lit' | 'dark';
}

/** Rings around everything shallower than `fathoms`, land included (plan 03 §8.2 step 9). */
export interface DepthContour {
  fathoms: number;
  rings: Ring[];
}

export interface ChartSounding {
  pos: Chart;
  fathoms: number;
  /** 0 on the 16 nm grid, then 8, 4, 2 and 1 nm. */
  level: number;
}

export interface ChartZone extends Rect {
  id: string;
  name: string;
}

export interface ChartGeography {
  readonly projection: ChartProjection;
  readonly charted: Rect;
  readonly water: Ring;
  readonly islands: readonly Ring[];
  readonly ports: readonly ChartPort[];
  readonly lights: readonly ChartLight[];
  readonly zones: readonly ChartZone[];
  /** Shallowest first. */
  readonly depths: readonly DepthContour[];
  readonly soundings: readonly ChartSounding[];
}

/**
 * The world chart frame the zones, their entries, the weather sim and the save use:
 * core/coords' default projection, around the middle of Lake Superior.
 */
export const WORLD_PROJECTION = new ChartProjection();

/** A point on this chart in the world chart frame (zones, weather, the save). */
export function toWorldChart(geo: ChartGeography, p: Chart): Chart {
  return WORLD_PROJECTION.geoToChart(geo.projection.chartToGeo(p));
}

/** A world chart frame point on this chart. */
export function fromWorldChart(geo: ChartGeography, p: Chart): Chart {
  return geo.projection.geoToChart(WORLD_PROJECTION.chartToGeo(p));
}

/** Middle of the western Superior chart; keeps projection distortion small. */
export const WESTERN_SUPERIOR_REFERENCE: Geo = { lat: 47, lon: -91 };

export function buildGeography(
  features: readonly ChartFeatureInput[],
  projection = new ChartProjection(WESTERN_SUPERIOR_REFERENCE),
): ChartGeography {
  const at = ([lon, lat]: LonLat): Chart => projection.geoToChart({ lat, lon });
  const rect = (b: GeoBounds): Rect => ({
    min: projection.geoToChart({ lat: b.south, lon: b.west }),
    max: projection.geoToChart({ lat: b.north, lon: b.east }),
  });
  const ring = (id: string, name: string | undefined, lonLats: readonly LonLat[]): Ring => {
    const points = lonLats.map(at);
    return { id, ...(name ? { name } : {}), points, bounds: boundsOf(points) };
  };

  let charted: Rect | undefined;
  let water: Ring | undefined;
  const islands: Ring[] = [];
  const ports: ChartPort[] = [];
  const lights: ChartLight[] = [];
  const zones: ChartZone[] = [];
  const depths: DepthContour[] = [];
  const soundings: ChartSounding[] = [];
  for (const f of features) {
    switch (f.kind) {
      case 'charted':
        charted = rect(f.bounds);
        break;
      case 'water':
        water = ring(f.id, f.name, f.ring);
        break;
      case 'land':
        islands.push(ring(f.id, f.name, f.ring));
        break;
      case 'port':
        ports.push({ id: f.id, name: f.name, pos: at(f.at), zoneId: f.zone });
        break;
      case 'light':
        lights.push({ id: f.id, name: f.name, pos: at(f.at), status: f.status });
        break;
      case 'zone':
        zones.push({ id: f.id, name: f.name, ...rect(f.bounds) });
        break;
      case 'depth':
        depths.push({
          fathoms: f.fathoms,
          rings: f.rings.map((r, k) => ring(`${f.id}.${k}`, undefined, r)),
        });
        break;
      case 'soundings':
        for (const [lon, lat, fathoms, level] of f.points) {
          soundings.push({ pos: at([lon, lat]), fathoms, level });
        }
        break;
    }
  }
  if (!water) throw new Error('Chart data has no water ring');
  depths.sort((a, b) => a.fathoms - b.fathoms);
  return {
    projection,
    charted: charted ?? water.bounds,
    water,
    islands,
    ports,
    lights,
    zones,
    depths,
    soundings,
  };
}

function boundsOf(points: readonly Chart[]): Rect {
  const min = { x: Infinity, y: Infinity };
  const max = { x: -Infinity, y: -Infinity };
  for (const p of points) {
    min.x = Math.min(min.x, p.x);
    min.y = Math.min(min.y, p.y);
    max.x = Math.max(max.x, p.x);
    max.y = Math.max(max.y, p.y);
  }
  return { min, max };
}

export function inRect(p: Chart, r: Rect): boolean {
  return p.x >= r.min.x && p.x <= r.max.x && p.y >= r.min.y && p.y <= r.max.y;
}

/** Even-odd point-in-polygon test. */
export function inRing(p: Chart, ring: Ring): boolean {
  if (!inRect(p, ring.bounds)) return false;
  const pts = ring.points;
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const a = pts[i] as Chart;
    const b = pts[j] as Chart;
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) {
      inside = !inside;
    }
  }
  return inside;
}

/** Navigable on the chart: inside the lake ring and outside every island. */
export function isWater(geo: ChartGeography, p: Chart): boolean {
  return inRing(p, geo.water) && !geo.islands.some((island) => inRing(p, island));
}

/**
 * Where the straight leg a → b first touches land, as a fraction 0–1 along it, or
 * undefined if the whole leg is open water. Exact edge intersection, so thin spits
 * and narrow channels are judged at the data's own resolution.
 */
export function firstLandHit(geo: ChartGeography, a: Chart, b: Chart): number | undefined {
  if (!isWater(geo, a)) return 0;
  let best: number | undefined;
  const legBounds = boundsOf([a, b]);
  for (const ring of [geo.water, ...geo.islands]) {
    if (!rectsOverlap(legBounds, ring.bounds)) continue;
    const pts = ring.points;
    for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
      const t = segmentIntersection(a, b, pts[j] as Chart, pts[i] as Chart);
      if (t !== undefined && (best === undefined || t < best)) best = t;
    }
  }
  return best;
}

function rectsOverlap(r: Rect, s: Rect): boolean {
  return r.min.x <= s.max.x && r.max.x >= s.min.x && r.min.y <= s.max.y && r.max.y >= s.min.y;
}

/** Fraction along p → q where it crosses segment c → d, if it does. */
function segmentIntersection(p: Chart, q: Chart, c: Chart, d: Chart): number | undefined {
  const rx = q.x - p.x;
  const ry = q.y - p.y;
  const sx = d.x - c.x;
  const sy = d.y - c.y;
  const denom = rx * sy - ry * sx;
  if (denom === 0) return undefined;
  const t = ((c.x - p.x) * sy - (c.y - p.y) * sx) / denom;
  const u = ((c.x - p.x) * ry - (c.y - p.y) * rx) / denom;
  return t >= 0 && t <= 1 && u >= 0 && u <= 1 ? t : undefined;
}

/**
 * Fraction along a → b where it first enters `r` from outside (Liang–Barsky), or
 * undefined if it never does. Returns 0 if a is already inside.
 */
export function rectEntry(a: Chart, b: Chart, r: Rect): number | undefined {
  if (inRect(a, r)) return 0;
  let t0 = 0;
  let t1 = 1;
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const clips: [number, number][] = [
    [-dx, a.x - r.min.x],
    [dx, r.max.x - a.x],
    [-dy, a.y - r.min.y],
    [dy, r.max.y - a.y],
  ];
  for (const [p, q] of clips) {
    if (p === 0) {
      if (q < 0) return undefined;
    } else {
      const t = q / p;
      if (p < 0) t0 = Math.max(t0, t);
      else t1 = Math.min(t1, t);
    }
  }
  return t0 <= t1 ? t0 : undefined;
}

export function zoneAt(geo: ChartGeography, p: Chart): ChartZone | undefined {
  return geo.zones.find((z) => inRect(p, z));
}

export function zoneById(geo: ChartGeography, id: string): ChartZone | undefined {
  return geo.zones.find((z) => z.id === id);
}

export function lerpChart(a: Chart, b: Chart, t: number): Chart {
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
}

export function distance(a: Chart, b: Chart): number {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

/** Compass bearing a → b, radians clockwise from north (chart y is north). */
export function bearing(a: Chart, b: Chart): number {
  const h = Math.atan2(b.x - a.x, b.y - a.y);
  return h < 0 ? h + Math.PI * 2 : h;
}
