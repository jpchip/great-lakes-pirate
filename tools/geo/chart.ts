#!/usr/bin/env node
// Bakes the chart's coastline, islands, depth contours and soundings for the whole western
// lake from the same NOAA bathymetry and USGS 3DEP DEM the zones use (plan 03 §8.2 step 9,
// §20 piece B). Needs GDAL ≥ 3.4, curl and tar, and network on the first run.
//
//   node tools/geo/chart.ts              # → data/chart-coast.json, tools/geo/reports/chart.md
//   node tools/geo/chart.ts --refetch    # re-download and re-warp the sources
//
// The DEM warp reads about 4 minutes of cloud-optimized blocks the first time; the cached
// rebuild takes under a minute.

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEM_VRT, checkTools, fetchBathy, warpCells } from './lib/gdal.ts';
import { chartToGeo, geoToChart } from './lib/zone.ts';
import {
  blockAverage,
  cellAt,
  cellCenter,
  lakeMask,
  pointInRing,
  signedArea,
  simplifyRing,
  simplifyRings,
  traceRings,
  type CellGrid,
  type Pt,
} from './lib/coast.ts';
import { pngRgb } from './lib/encode.ts';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const refetch = process.argv.includes('--refetch');

/** What the bake covers: the charted area (chart.json) with a margin, so the lake ring closes off-chart. */
const BAKE_BOUNDS = { west: -92.35, south: 46.4, east: -89.9, north: 47.85 };
/** Real meters per cell. Minnesota Point (~300 m wide) is six cells; the Duluth canal ~2. */
const CELL_M = 50;
/** Same levels as the zones (data/zones.json bake settings). */
const LAKE_LEVEL_M = 183.5;
const BATHY_DATUM_M = 183.2;
const LAND_THRESHOLD_M = 0.5;
/** Open water off the Apostles, where the flood fill of the lake starts. */
const LAKE_SEED = { lat: 47.2, lon: -90.9 };
/** Land smaller than this (0.75 ha) sinks: breakwaters, piers and specks. */
const MIN_ISLAND_CELLS = 3;
/** Coastline simplification, real meters. About a schooner's length at the full-lake zoom. */
const COAST_TOLERANCE_M = 40;
/** Depth contours, in fathoms, and their simplification. */
const DEPTH_FATHOMS = [3, 10, 30];
const DEPTH_TOLERANCE_M = 120;
/** Contour rings smaller than this (km²) are dropped as noise. */
const MIN_DEPTH_RING_KM2 = 0.4;
/** Soundings on a 1 nm grid, kept clear of the shore. */
const SOUNDING_SPACING_M = 1852;
const SOUNDING_CLEAR_M = 450;
const FATHOM_M = 1.8288;
/**
 * Land the chart names beyond the Apostles' islands.json. Minnesota Point has been an
 * island since the Duluth Ship Canal cut it in 1871, and the bake sees the canal.
 */
const CHART_ONLY_ISLANDS = [
  { id: 'island.minnesota_point', name: 'Minnesota Point', at: { lat: 46.73, lon: -92.0515 } },
];

const t0 = performance.now();
const lap = (label: string) =>
  console.log(`${((performance.now() - t0) / 1000).toFixed(1).padStart(6)} s  ${label}`);

// ---- Grid and sources ------------------------------------------------------------------

const sw = geoToChart({ lat: BAKE_BOUNDS.south, lon: BAKE_BOUNDS.west });
const ne = geoToChart({ lat: BAKE_BOUNDS.north, lon: BAKE_BOUNDS.east });
const x0 = Math.floor(sw.x / CELL_M) * CELL_M;
const y0 = Math.floor(sw.y / CELL_M) * CELL_M;
const x1 = Math.ceil(ne.x / CELL_M) * CELL_M;
const y1 = Math.ceil(ne.y / CELL_M) * CELL_M;
const grid: CellGrid = {
  width: (x1 - x0) / CELL_M,
  height: (y1 - y0) / CELL_M,
  cellM: CELL_M,
  x0,
  y1,
};

checkTools();
const cache = join(ROOT, 'tools', 'geo', '.cache');
const chartCache = join(cache, 'chart');
mkdirSync(chartCache, { recursive: true });
const bathyTif = fetchBathy(cache, refetch);
lap('bathymetry ready');
const dem = warpCells(
  `/vsicurl/${DEM_VRT}`,
  join(chartCache, `dem-${CELL_M}`),
  grid,
  'average',
  refetch,
);
lap(`DEM warped (${grid.width}×${grid.height} cells of ${CELL_M} m)`);
const bathy = warpCells(bathyTif, join(chartCache, `bathy-${CELL_M}`), grid, 'bilinear', refetch);
lap('bathymetry warped');

// ---- Land and water --------------------------------------------------------------------

const NODATA = -9999;
const n = grid.width * grid.height;
/** Height above lake level: land from the DEM, depth (negative) from the bathymetry. */
const elev = new Float32Array(n);
const bathyOffset = BATHY_DATUM_M - LAKE_LEVEL_M;
for (let k = 0; k < n; k++) {
  const d = dem.data[k] as number;
  const b = bathy.data[k] as number;
  if (d !== NODATA && d - LAKE_LEVEL_M >= LAND_THRESHOLD_M) elev[k] = d - LAKE_LEVEL_M;
  else if (d !== NODATA) elev[k] = Math.min(b === NODATA ? -0.3 : b + bathyOffset, -0.3);
  else elev[k] = b === NODATA ? 1 : b + bathyOffset;
}
const seedCell = cellAt(grid, geoToChart(LAKE_SEED));
const land = lakeMask(grid, (k) => (elev[k] as number) < 0, seedCell, MIN_ISLAND_CELLS);
lap('lake picked out');

// The coast field: the clamped elevation, with its sign forced to the mask's, so the
// interpolated shoreline sits between cells but the topology is the mask's.
const coastField = new Float32Array(n);
for (let k = 0; k < n; k++) {
  const e = Math.max(-2, Math.min(2, elev[k] as number));
  coastField[k] = land[k] ? Math.max(e, 0.05) : Math.min(e, -0.05);
}
const traced = traceRings(grid, coastField, 1);
const lakeRings = traced.filter((r) => signedArea(r) < 0);
if (lakeRings.length !== 1) throw new Error(`Expected one lake ring, found ${lakeRings.length}`);
const tracedIslands = traced.filter((r) => signedArea(r) > 0);
lap(`coast traced (${traced.reduce((s, r) => s + r.length, 0)} points)`);

const simplified = simplifyRings([lakeRings[0] as Pt[], ...tracedIslands], COAST_TOLERANCE_M);
const [lake, ...islandRings] = simplified.rings as [Pt[], ...Pt[][]];
const tightened = simplified.tolerances.filter((t) => t < COAST_TOLERANCE_M).length;
lap(
  `coast simplified (${simplified.rings.reduce((s, r) => s + r.length, 0)} points, ${tightened} rings tightened)`,
);

// Name islands from data/islands.json; the rest stay unnamed.
const islandData = [
  ...(JSON.parse(readFileSync(join(ROOT, 'data', 'islands.json'), 'utf8')) as {
    id: string;
    name: string;
    at: { lat: number; lon: number };
  }[]),
  ...CHART_ONLY_ISLANDS,
];
interface BakedIsland {
  id: string;
  name?: string;
  ring: Pt[];
  areaKm2: number;
}
const islands: BakedIsland[] = islandRings
  .map((ring) => ({ ring, areaKm2: signedArea(ring) / 1e6 }))
  .sort((a, b) => b.areaKm2 - a.areaKm2)
  .map(({ ring, areaKm2 }) => {
    const named = islandData.filter((i) => pointInRing(geoToChart(i.at), ring));
    return {
      id: '',
      name: named.map((i) => i.name).join(' and ') || undefined,
      ring,
      areaKm2,
      named,
    };
  })
  .map((isl, k) => ({
    ...isl,
    id: isl.named[0] ? isl.named[0].id : `island.unnamed_${String(k).padStart(3, '0')}`,
  }))
  .map(({ id, name, ring, areaKm2 }) => ({ id, ...(name ? { name } : {}), ring, areaKm2 }));
const namedIds = new Set(islands.map((i) => i.id));
const missing = islandData.filter((i) => !namedIds.has(i.id)).map((i) => i.name);
lap(
  `${islands.length} islands (${islands.filter((i) => i.name).length} named; not found: ${missing.join(', ') || 'none'})`,
);

// ---- Depth contours --------------------------------------------------------------------

// On 100 m blocks, land counted as 0 depth so the shallow side includes the shore.
const depthField = new Float32Array(n);
for (let k = 0; k < n; k++) depthField[k] = land[k] ? 0 : (elev[k] as number);
const coarse = blockAverage(grid, depthField, 2);
const depths = DEPTH_FATHOMS.map((fathoms) => {
  const level = -fathoms * FATHOM_M;
  const field = coarse.data.map((v) => v - level);
  const rings = traceRings(coarse.grid, field, 1)
    .filter((r) => Math.abs(signedArea(r)) / 1e6 >= MIN_DEPTH_RING_KM2)
    .map((r) => simplifyRing(r, DEPTH_TOLERANCE_M))
    .filter((r) => r.length >= 4);
  return { fathoms, rings };
});
lap(
  `depth contours (${depths.map((d) => `${d.fathoms} fm: ${d.rings.reduce((s, r) => s + r.length, 0)} pts`).join(', ')})`,
);

// ---- Soundings -------------------------------------------------------------------------

const clearCells = Math.ceil(SOUNDING_CLEAR_M / CELL_M);
const soundings: [number, number, number, number][] = [];
const gi0 = Math.ceil(x0 / SOUNDING_SPACING_M);
const gj0 = Math.ceil(y0 / SOUNDING_SPACING_M);
for (let gj = gj0; gj * SOUNDING_SPACING_M <= y1; gj++) {
  for (let gi = gi0; gi * SOUNDING_SPACING_M <= x1; gi++) {
    const p = { x: gi * SOUNDING_SPACING_M, y: gj * SOUNDING_SPACING_M };
    const { i, j } = cellAt(grid, p);
    if (
      i < clearCells ||
      j < clearCells ||
      i >= grid.width - clearCells ||
      j >= grid.height - clearCells
    )
      continue;
    let clear = true;
    for (let dj = -clearCells; dj <= clearCells && clear; dj++) {
      for (let di = -clearCells; di <= clearCells; di++) {
        if (land[(j + dj) * grid.width + i + di]) {
          clear = false;
          break;
        }
      }
    }
    if (!clear) continue;
    const depthM = -(elev[j * grid.width + i] as number);
    const fathoms = Math.max(1, Math.round(depthM / FATHOM_M));
    // Thinning level: 0 on the 16 nm grid, then 8, 4, 2 and 1 nm, so the chart can keep a
    // steady spacing on screen at any zoom.
    let level = 4;
    for (let L = 0; L < 4; L++) {
      const m = 2 ** (4 - L);
      if (gi % m === 0 && gj % m === 0) {
        level = L;
        break;
      }
    }
    const g = chartToGeo(cellCenter(grid, i, j));
    soundings.push([round(g.lon, 4), round(g.lat, 4), fathoms, level]);
  }
}
lap(`${soundings.length} soundings`);

// ---- Write -----------------------------------------------------------------------------

function round(v: number, d: number): number {
  const f = 10 ** d;
  return Math.round(v * f) / f;
}
/** Chart points → [lon, lat] at 5 decimals (about 1 m). */
const lonLats = (ring: readonly Pt[]): [number, number][] =>
  ring.map((p) => {
    const g = chartToGeo(p);
    return [round(g.lon, 5), round(g.lat, 5)];
  });

const features = [
  { id: 'water.western_superior', kind: 'water', name: 'Lake Superior', ring: lonLats(lake) },
  ...islands.map((i) => ({
    id: i.id,
    kind: 'land',
    ...(i.name ? { name: i.name } : {}),
    ring: lonLats(i.ring),
  })),
  ...depths.map((d) => ({
    id: `depth.f${d.fathoms}`,
    kind: 'depth',
    fathoms: d.fathoms,
    rings: d.rings.map(lonLats),
  })),
  { id: 'soundings.western_superior', kind: 'soundings', points: soundings },
];
// One feature per line keeps diffs readable without a multi-megabyte pretty-print.
const json = `[\n${features.map((f) => JSON.stringify(f)).join(',\n')}\n]\n`;
const outPath = join(ROOT, 'data', 'chart-coast.json');
writeFileSync(outPath, json);
lap(`wrote data/chart-coast.json (${(json.length / 1024).toFixed(0)} KB)`);

// ---- Report and preview ----------------------------------------------------------------

const reportDir = join(ROOT, 'tools', 'geo', 'reports');
mkdirSync(reportDir, { recursive: true });
{
  // Preview at 200 m: land, depth bands, coast.
  const k = 4;
  const w = Math.floor(grid.width / k);
  const h = Math.floor(grid.height / k);
  const rgb = new Uint8Array(w * h * 3);
  for (let j = 0; j < h; j++) {
    for (let i = 0; i < w; i++) {
      const c = (j * k + 2) * grid.width + i * k + 2;
      const o = (j * w + i) * 3;
      if (land[c]) {
        const e = Math.min((elev[c] as number) / 400, 1);
        rgb.set([217 - 60 * e, 195 - 60 * e, 147 - 50 * e], o);
      } else {
        const d = Math.min(-(elev[c] as number) / 250, 1);
        rgb.set([239 - 170 * d, 231 - 120 * d, 207 - 80 * d], o);
      }
    }
  }
  writeFileSync(join(reportDir, 'chart-relief.png'), pngRgb(rgb, w, h));
}
const largest = islands
  .filter((i) => i.name)
  .map((i) => `| ${i.name} | ${i.areaKm2.toFixed(2)} | ${i.ring.length} |`)
  .join('\n');
const report = `# Chart bake report

Generated by \`npm run geo:chart\` (\`tools/geo/chart.ts\`). Sources: NOAA NCEI Lake Superior
bathymetry (3″) and USGS 3DEP 1/3″ DEM, warped to ${CELL_M} m cells of the chart projection.

| | |
|---|---|
| Bake bounds | ${BAKE_BOUNDS.west}° to ${BAKE_BOUNDS.east}°, ${BAKE_BOUNDS.south}° to ${BAKE_BOUNDS.north}° |
| Grid | ${grid.width} × ${grid.height} cells of ${CELL_M} m |
| Lake ring | ${lake.length} points (simplified at ${COAST_TOLERANCE_M} m) |
| Islands | ${islands.length} (${islands.filter((i) => i.name).length} named), ${islandRings.reduce((s, r) => s + r.length, 0)} points |
| Rings tightened to stay apart | ${tightened} |
| Depth contours | ${depths.map((d) => `${d.fathoms} fm: ${d.rings.length} rings, ${d.rings.reduce((s, r) => s + r.length, 0)} points`).join('; ')} |
| Soundings | ${soundings.length} on a ${SOUNDING_SPACING_M} m grid, ≥ ${SOUNDING_CLEAR_M} m from shore |
| File | \`data/chart-coast.json\`, ${(json.length / 1024).toFixed(0)} KB |
| Not found | ${missing.join(', ') || 'none'} |

## Named islands

| Island | Area (km²) | Points |
|---|---|---|
${largest}

Preview: [chart-relief.png](chart-relief.png).
`;
writeFileSync(join(reportDir, 'chart.md'), report);
lap('report written');
