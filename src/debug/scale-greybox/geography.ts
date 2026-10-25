import { ChartProjection, type Chart, type Geo } from '../../core/coords';

/**
 * Hand-placed greybox geography for the Apostles zone (spike S7). Islands are
 * ellipses and the mainland is one polygon, all from approximate public coordinates,
 * so it is recognizable but not survey-grade. The S3 geo pipeline replaces it.
 *
 * Everything here works in true-scale chart meters (x east, y north) around
 * ZONE_REFERENCE. Compression by C happens later, in one place: the zone frame.
 * Heights are meters above the lake and are never compressed (plan 03 §3.1).
 */

export const ZONE_REFERENCE: Geo = { lat: 46.85, lon: -90.72 };
export const projection = new ChartProjection(ZONE_REFERENCE);

export function chartOf(lat: number, lon: number): Chart {
  return projection.geoToChart({ lat, lon });
}

interface IslandDef {
  name: string;
  lat: number;
  lon: number;
  lengthKm: number;
  widthKm: number;
  /** Compass bearing of the long axis. */
  bearingDeg: number;
  /** Highest point above the lake, meters. */
  peakM: number;
  /** Typical shore bluff height; noise turns some stretches into beaches. */
  bluffM: number;
}

// Approximate centers and sizes; peaks are rough heights above the lake (602 ft).
const ISLAND_DEFS: readonly IslandDef[] = [
  {
    name: 'Madeline',
    lat: 46.817,
    lon: -90.667,
    lengthKm: 22,
    widthKm: 4.2,
    bearingDeg: 65,
    peakM: 70,
    bluffM: 6,
  },
  {
    name: 'Long Island',
    lat: 46.7,
    lon: -90.73,
    lengthKm: 14,
    widthKm: 0.5,
    bearingDeg: 122,
    peakM: 4,
    bluffM: 1,
  },
  {
    name: 'Basswood',
    lat: 46.85,
    lon: -90.752,
    lengthKm: 4.6,
    widthKm: 1.6,
    bearingDeg: 10,
    peakM: 60,
    bluffM: 10,
  },
  {
    name: 'Hermit',
    lat: 46.883,
    lon: -90.7,
    lengthKm: 2.8,
    widthKm: 1.9,
    bearingDeg: 60,
    peakM: 55,
    bluffM: 10,
  },
  {
    name: 'Stockton',
    lat: 46.933,
    lon: -90.567,
    lengthKm: 9.5,
    widthKm: 4.5,
    bearingDeg: 80,
    peakM: 75,
    bluffM: 9,
  },
  {
    name: 'Oak',
    lat: 46.933,
    lon: -90.717,
    lengthKm: 4.8,
    widthKm: 4,
    bearingDeg: 0,
    peakM: 145,
    bluffM: 12,
  },
  {
    name: 'Manitou',
    lat: 46.967,
    lon: -90.667,
    lengthKm: 2.6,
    widthKm: 1.4,
    bearingDeg: 60,
    peakM: 40,
    bluffM: 6,
  },
  {
    name: 'Otter',
    lat: 46.988,
    lon: -90.617,
    lengthKm: 2.6,
    widthKm: 1.3,
    bearingDeg: 30,
    peakM: 40,
    bluffM: 8,
  },
  {
    name: 'Rocky',
    lat: 47.003,
    lon: -90.69,
    lengthKm: 2.4,
    widthKm: 1.4,
    bearingDeg: 20,
    peakM: 30,
    bluffM: 6,
  },
  {
    name: 'South Twin',
    lat: 47.0,
    lon: -90.648,
    lengthKm: 1.4,
    widthKm: 1,
    bearingDeg: 0,
    peakM: 20,
    bluffM: 4,
  },
  {
    name: 'Raspberry',
    lat: 46.967,
    lon: -90.8,
    lengthKm: 1.8,
    widthKm: 0.9,
    bearingDeg: 30,
    peakM: 30,
    bluffM: 9,
  },
  {
    name: 'York',
    lat: 46.983,
    lon: -90.855,
    lengthKm: 2.4,
    widthKm: 0.6,
    bearingDeg: 80,
    peakM: 15,
    bluffM: 3,
  },
  {
    name: 'Sand',
    lat: 46.988,
    lon: -90.935,
    lengthKm: 4.2,
    widthKm: 3.4,
    bearingDeg: 0,
    peakM: 40,
    bluffM: 12,
  },
  {
    name: 'Eagle',
    lat: 46.925,
    lon: -91.005,
    lengthKm: 0.8,
    widthKm: 0.5,
    bearingDeg: 0,
    peakM: 12,
    bluffM: 6,
  },
  {
    name: 'Bear',
    lat: 47.033,
    lon: -90.737,
    lengthKm: 2.9,
    widthKm: 2.1,
    bearingDeg: 10,
    peakM: 80,
    bluffM: 12,
  },
  {
    name: 'Devils',
    lat: 47.067,
    lon: -90.73,
    lengthKm: 2.4,
    widthKm: 1.2,
    bearingDeg: 0,
    peakM: 20,
    bluffM: 14,
  },
  {
    name: 'North Twin',
    lat: 47.067,
    lon: -90.633,
    lengthKm: 1.2,
    widthKm: 0.9,
    bearingDeg: 0,
    peakM: 20,
    bluffM: 5,
  },
  {
    name: 'Ironwood',
    lat: 46.983,
    lon: -90.583,
    lengthKm: 2.4,
    widthKm: 1.4,
    bearingDeg: 40,
    peakM: 35,
    bluffM: 6,
  },
  {
    name: 'Cat',
    lat: 47.017,
    lon: -90.55,
    lengthKm: 2.8,
    widthKm: 1.6,
    bearingDeg: 10,
    peakM: 40,
    bluffM: 8,
  },
  {
    name: 'Outer',
    lat: 47.033,
    lon: -90.433,
    lengthKm: 9.5,
    widthKm: 3.2,
    bearingDeg: 12,
    peakM: 50,
    bluffM: 12,
  },
  {
    name: 'Michigan',
    lat: 46.872,
    lon: -90.485,
    lengthKm: 3.4,
    widthKm: 1.4,
    bearingDeg: 60,
    peakM: 30,
    bluffM: 10,
  },
  {
    name: 'Gull',
    lat: 46.903,
    lon: -90.448,
    lengthKm: 0.5,
    widthKm: 0.3,
    bearingDeg: 0,
    peakM: 3,
    bluffM: 1,
  },
];

/**
 * The Bayfield peninsula, Chequamegon Bay and the south shore, counter-clockwise from
 * the far northwest corner, closed well outside the zone.
 */
const MAINLAND_COAST: readonly [number, number][] = [
  [47.0, -91.25],
  [46.93, -91.1],
  [46.95, -91.0],
  [46.945, -90.92],
  [46.94, -90.88],
  [46.92, -90.84],
  [46.89, -90.8],
  [46.865, -90.778],
  [46.84, -90.795],
  [46.811, -90.812],
  [46.78, -90.83],
  [46.74, -90.862],
  [46.7, -90.88],
  [46.673, -90.888],
  [46.63, -90.9],
  [46.595, -90.905],
  [46.583, -90.88],
  [46.59, -90.84],
  [46.61, -90.79],
  [46.63, -90.73],
  [46.65, -90.68],
  [46.66, -90.62],
  [46.68, -90.52],
  [46.7, -90.4],
  [46.72, -90.3],
  [46.4, -90.3],
  [46.4, -91.25],
];

export interface Landmass {
  readonly name: string;
  readonly kind: 'island' | 'mainland';
  readonly peak: number;
  readonly bluff: number;
  /** Distance inland (chart m) over which the ground rises to its peak. */
  readonly interior: number;
  /** How far noise moves the coastline, chart meters. */
  readonly coastNoise: number;
  /** Chart-space bounds, for quick rejection. */
  readonly bounds: { minX: number; maxX: number; minY: number; maxY: number };
  /** Approximate signed distance to the shore in chart meters: positive on land. */
  signedDistance(x: number, y: number): number;
}

class EllipseIsland implements Landmass {
  readonly kind = 'island';
  readonly peak: number;
  readonly bluff: number;
  readonly interior: number;
  readonly coastNoise: number;
  readonly bounds: Landmass['bounds'];
  readonly center: Chart;
  /** Semi-axes in chart meters. */
  readonly a: number;
  readonly b: number;
  private readonly ux: number;
  private readonly uy: number;

  constructor(
    readonly name: string,
    def: IslandDef,
  ) {
    this.center = chartOf(def.lat, def.lon);
    this.a = (def.lengthKm * 1000) / 2;
    this.b = (def.widthKm * 1000) / 2;
    const bearing = (def.bearingDeg * Math.PI) / 180;
    this.ux = Math.sin(bearing);
    this.uy = Math.cos(bearing);
    this.peak = def.peakM;
    this.bluff = def.bluffM;
    this.interior = Math.max(this.b * 0.9, 150);
    this.coastNoise = Math.min(this.b * 0.3, 300);
    const pad = this.a + 2000;
    this.bounds = {
      minX: this.center.x - pad,
      maxX: this.center.x + pad,
      minY: this.center.y - pad,
      maxY: this.center.y + pad,
    };
  }

  signedDistance(x: number, y: number): number {
    const dx = x - this.center.x;
    const dy = y - this.center.y;
    const u = dx * this.ux + dy * this.uy;
    const v = dx * this.uy - dy * this.ux;
    const r = Math.hypot(u / this.a, v / this.b);
    if (r < 1e-6) return this.b;
    // First-order distance: (1 − r) / |∇r|.
    const grad = Math.hypot(u / (this.a * this.a), v / (this.b * this.b)) / r;
    return (1 - r) / grad;
  }
}

class PolygonLand implements Landmass {
  readonly kind = 'mainland';
  readonly peak = 120;
  readonly bluff = 8;
  readonly interior = 4000;
  readonly coastNoise = 220;
  readonly bounds = { minX: -Infinity, maxX: Infinity, minY: -Infinity, maxY: Infinity };
  readonly points: Chart[];

  constructor(
    readonly name: string,
    coast: readonly [number, number][],
  ) {
    this.points = coast.map(([lat, lon]) => chartOf(lat, lon));
  }

  signedDistance(x: number, y: number): number {
    let inside = false;
    let best = Infinity;
    const n = this.points.length;
    for (let i = 0, j = n - 1; i < n; j = i++) {
      const p = this.points[i] as Chart;
      const q = this.points[j] as Chart;
      if (p.y > y !== q.y > y && x < ((q.x - p.x) * (y - p.y)) / (q.y - p.y) + p.x) {
        inside = !inside;
      }
      const ex = q.x - p.x;
      const ey = q.y - p.y;
      const t = Math.min(Math.max(((x - p.x) * ex + (y - p.y) * ey) / (ex * ex + ey * ey), 0), 1);
      best = Math.min(best, Math.hypot(x - (p.x + ex * t), y - (p.y + ey * t)));
    }
    return inside ? best : -best;
  }
}

export const ISLANDS: readonly EllipseIsland[] = ISLAND_DEFS.map(
  (def) => new EllipseIsland(def.name, def),
);
export const MAINLAND = new PolygonLand('Mainland', MAINLAND_COAST);
export const LANDMASSES: readonly Landmass[] = [MAINLAND, ...ISLANDS];

// ---------------------------------------------------------------------------------
// Height

/** Seabed falls this many meters per chart meter offshore. */
const SHELF_SLOPE = 0.05;
const MAX_DEPTH = -60;
/** Chart meters over which a shore bluff rises. */
const BLUFF_WIDTH = 60;

function hash(ix: number, iy: number, seed: number): number {
  let h = Math.imul(ix, 374761393) ^ Math.imul(iy, 668265263) ^ Math.imul(seed, 2147483647);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 2147483648 - 1;
}

/** Smooth value noise in [-1, 1] with three octaves. */
export function fbm(x: number, y: number, seed: number): number {
  let sum = 0;
  let amp = 0.6;
  let fx = x;
  let fy = y;
  for (let o = 0; o < 3; o++) {
    const ix = Math.floor(fx);
    const iy = Math.floor(fy);
    const tx = fx - ix;
    const ty = fy - iy;
    const sx = tx * tx * (3 - 2 * tx);
    const sy = ty * ty * (3 - 2 * ty);
    const s = seed + o * 101;
    const a = hash(ix, iy, s);
    const b = hash(ix + 1, iy, s);
    const c = hash(ix, iy + 1, s);
    const d = hash(ix + 1, iy + 1, s);
    sum += (a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy) * amp;
    amp *= 0.5;
    fx *= 2.03;
    fy *= 2.03;
  }
  return sum;
}

const smoothstep = (a: number, b: number, t: number): number => {
  const x = Math.min(Math.max((t - a) / (b - a), 0), 1);
  return x * x * (3 - 2 * x);
};

function heightOf(m: Landmass, x: number, y: number): number {
  const b = m.bounds;
  if (x < b.minX || x > b.maxX || y < b.minY || y > b.maxY) return MAX_DEPTH;
  const d = m.signedDistance(x, y) + fbm(x / 900, y / 900, 11) * m.coastNoise;
  if (d <= 0) return Math.max(d * SHELF_SLOPE, MAX_DEPTH);
  // Some stretches are beaches, some are sandstone bluffs.
  const bluff = m.bluff * Math.min(Math.max(0.45 + fbm(x / 700, y / 700, 23) * 1.4, 0), 1.2);
  const inland = smoothstep(BLUFF_WIDTH, m.interior, d);
  const hills = 1 + 0.35 * fbm(x / 1400, y / 1400, 37);
  return (
    Math.min(d * SHELF_SLOPE, 0.8) +
    bluff * smoothstep(0, BLUFF_WIDTH, d) +
    Math.max(m.peak - bluff, 0) * inland * hills
  );
}

/** Ground or seabed height at a chart point, meters relative to the lake surface. */
export function landHeight(x: number, y: number): number {
  let h = MAX_DEPTH;
  for (const m of LANDMASSES) h = Math.max(h, heightOf(m, x, y));
  return h;
}

/** The landmass under a chart point, if it is dry land. */
export function landmassAt(x: number, y: number): Landmass | undefined {
  let best: Landmass | undefined;
  let bestH = 0;
  for (const m of LANDMASSES) {
    const h = heightOf(m, x, y);
    if (h > bestH) {
      bestH = h;
      best = m;
    }
  }
  return best;
}

// ---------------------------------------------------------------------------------
// Places

export interface Place {
  id: string;
  name: string;
  kind: 'town' | 'lighthouse';
  chart: Chart;
  /** Town set-piece size: houses along the shore and rows inland. */
  houses?: { along: number; rows: number };
  /** Pier length in meters (1:1). Ashland's is an ore dock. */
  pierM?: number;
  oreDock?: boolean;
  /** Tower height in meters (1:1). */
  towerM?: number;
}

const place = (p: Omit<Place, 'chart'> & { lat: number; lon: number }): Place => {
  const { lat, lon, ...rest } = p;
  return { ...rest, chart: chartOf(lat, lon) };
};

export const PLACES: readonly Place[] = [
  place({
    id: 'bayfield',
    name: 'Bayfield',
    kind: 'town',
    lat: 46.8108,
    lon: -90.8182,
    houses: { along: 7, rows: 5 },
    pierM: 120,
  }),
  place({
    id: 'lapointe',
    name: 'La Pointe',
    kind: 'town',
    lat: 46.7797,
    lon: -90.7854,
    houses: { along: 3, rows: 2 },
    pierM: 80,
  }),
  place({
    id: 'redcliff',
    name: 'Red Cliff',
    kind: 'town',
    lat: 46.857,
    lon: -90.79,
    houses: { along: 2, rows: 2 },
    pierM: 40,
  }),
  place({
    id: 'washburn',
    name: 'Washburn',
    kind: 'town',
    lat: 46.673,
    lon: -90.895,
    houses: { along: 5, rows: 4 },
    pierM: 150,
  }),
  place({
    id: 'ashland',
    name: 'Ashland',
    kind: 'town',
    lat: 46.592,
    lon: -90.884,
    houses: { along: 10, rows: 6 },
    pierM: 560,
    oreDock: true,
  }),
  place({
    id: 'light.raspberry',
    name: 'Raspberry Island Light',
    kind: 'lighthouse',
    lat: 46.971,
    lon: -90.805,
    towerM: 12,
  }),
  place({
    id: 'light.sand',
    name: 'Sand Island Light',
    kind: 'lighthouse',
    lat: 47.003,
    lon: -90.937,
    towerM: 13,
  }),
  place({
    id: 'light.devils',
    name: 'Devils Island Light',
    kind: 'lighthouse',
    lat: 47.078,
    lon: -90.728,
    towerM: 25,
  }),
  place({
    id: 'light.outer',
    name: 'Outer Island Light',
    kind: 'lighthouse',
    lat: 47.076,
    lon: -90.417,
    towerM: 27,
  }),
  place({
    id: 'light.michigan',
    name: 'Michigan Island Light',
    kind: 'lighthouse',
    lat: 46.873,
    lon: -90.497,
    towerM: 20,
  }),
  place({
    id: 'light.chequamegon',
    name: 'Chequamegon Point Light',
    kind: 'lighthouse',
    lat: 46.728,
    lon: -90.81,
    towerM: 13,
  }),
];

export function placeById(id: string): Place {
  const p = PLACES.find((q) => q.id === id);
  if (!p) throw new Error(`Unknown place ${id}`);
  return p;
}

/** Reference legs from R1a, measured between greybox places in chart meters. */
export const REFERENCE_LEGS: readonly { name: string; from: Chart; to: Chart; r1aNm: number }[] = [
  {
    name: 'Bayfield → La Pointe',
    from: placeById('bayfield').chart,
    to: placeById('lapointe').chart,
    r1aNm: 2,
  },
  {
    name: 'Bayfield → Ashland',
    from: placeById('bayfield').chart,
    to: placeById('ashland').chart,
    r1aNm: 13,
  },
  {
    name: 'Sand Is. → Outer Is.',
    from: placeById('light.sand').chart,
    to: placeById('light.outer').chart,
    r1aNm: 22,
  },
];

// ---------------------------------------------------------------------------------
// Steamer lanes (freighters ping-pong along these)

export const FREIGHTER_ROUTES: readonly Chart[][] = [
  // Ashland ore boats: up Chequamegon Bay, the North Channel, west of Oak, out past Devils.
  [
    [46.618, -90.862],
    [46.67, -90.85],
    [46.725, -90.84],
    [46.8, -90.795],
    [46.845, -90.776],
    [46.9, -90.765],
    [46.95, -90.77],
    [47.0, -90.77],
    [47.06, -90.79],
    [47.13, -90.8],
  ].map(([lat, lon]) => chartOf(lat as number, lon as number)),
  // The outer lane, east of Outer and Michigan, into the lee of Madeline.
  [
    [47.13, -90.33],
    [47.0, -90.37],
    [46.9, -90.41],
    [46.82, -90.47],
    [46.77, -90.56],
    [46.75, -90.64],
  ].map(([lat, lon]) => chartOf(lat as number, lon as number)),
];
