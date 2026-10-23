import { ChartProjection, type Chart, type Geo } from '../../core/coords';

/**
 * The weather chart: where systems spawn and travel, and a coarse outline of western
 * Lake Superior for fog. The outline is hand-placed from the 1:1 NOAA chart and stands
 * in until spike S3 bakes the real shoreline (plan 03 §8).
 */

export const WEATHER_PROJECTION = new ChartProjection();

export const toChart = (lat: number, lon: number): Chart =>
  WEATHER_PROJECTION.geoToChart({ lat, lon });

/** Systems are removed once they leave this box (chart meters). */
export const WEATHER_DOMAIN = {
  minX: -1_500_000,
  maxX: 900_000,
  minY: -900_000,
  maxY: 900_000,
} as const;

/** Western Lake Superior, clockwise from Duluth. Islands are ignored. */
export const WESTERN_SUPERIOR_GEO: readonly Geo[] = [
  { lat: 46.77, lon: -92.1 },
  { lat: 47.02, lon: -91.67 },
  { lat: 47.3, lon: -91.25 },
  { lat: 47.6, lon: -90.8 },
  { lat: 47.8, lon: -90.0 },
  { lat: 46.6, lon: -90.0 },
  { lat: 46.58, lon: -90.3 },
  { lat: 46.63, lon: -90.65 },
  { lat: 46.59, lon: -90.88 },
  { lat: 46.81, lon: -90.82 },
  { lat: 46.95, lon: -90.93 },
  { lat: 46.86, lon: -91.1 },
  { lat: 46.79, lon: -91.4 },
  { lat: 46.72, lon: -91.75 },
  { lat: 46.71, lon: -92.02 },
];

export const WESTERN_SUPERIOR: readonly Chart[] = WESTERN_SUPERIOR_GEO.map((g) =>
  WEATHER_PROJECTION.geoToChart(g),
);

/** Ray-casting point-in-polygon test. */
export function inPolygon(p: Chart, poly: readonly Chart[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i] as Chart;
    const b = poly[j] as Chart;
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) {
      inside = !inside;
    }
  }
  return inside;
}

export const LAKE_BOUNDS = (() => {
  const xs = WESTERN_SUPERIOR.map((p) => p.x);
  const ys = WESTERN_SUPERIOR.map((p) => p.y);
  return {
    minX: Math.min(...xs),
    maxX: Math.max(...xs),
    minY: Math.min(...ys),
    maxY: Math.max(...ys),
  };
})();

/** Roughly the middle of the MVP zones; storm tracks aim around it. */
export const LAKE_CENTER: Chart = toChart(46.95, -91.1);

/** Bays and channels where radiation fog pools on calm, clear nights (plan 04 §5.2). */
export const RADIATION_FOG_SITES: readonly { name: string; at: Chart }[] = [
  { name: 'Chequamegon Bay', at: toChart(46.64, -90.82) },
  { name: 'Bayfield–La Pointe channel', at: toChart(46.79, -90.78) },
  { name: 'Siskiwit Bay', at: toChart(46.88, -91.3) },
  { name: 'Duluth–Superior harbor', at: toChart(46.74, -92.08) },
  { name: 'Agate Bay', at: toChart(47.01, -91.67) },
];

/** Points the S9 report and the chart page read instruments at. */
export const PROBES: readonly { id: string; name: string; at: Chart }[] = [
  { id: 'bayfield', name: 'Bayfield', at: toChart(46.8, -90.8) },
  { id: 'apostles', name: 'Outer Apostles', at: toChart(47.02, -90.55) },
  { id: 'duluth', name: 'Duluth', at: toChart(46.77, -92.06) },
  { id: 'two_harbors', name: 'Two Harbors', at: toChart(47.0, -91.62) },
  { id: 'siskiwit', name: 'Siskiwit Bay', at: toChart(46.89, -91.3) },
];
