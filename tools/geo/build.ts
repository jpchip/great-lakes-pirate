#!/usr/bin/env node
// Bakes a coastal zone's terrain from NOAA bathymetry and the USGS 3DEP DEM (plan 03 §8.2,
// spike S3). Needs GDAL ≥ 3.4, curl and tar on the PATH, plus network access to
// www.ngdc.noaa.gov and prd-tnm.s3.amazonaws.com on the first run.
//
//   node tools/geo/build.ts                 # bake zone.apostles (data/zones.json) → public/world/apostles/
//   node tools/geo/build.ts apostles --refetch    # re-download and re-warp the sources
//   node tools/geo/build.ts apostles --compare    # also print the tile format comparison
//
// Sources and warps are cached in tools/geo/.cache/<zone>/. Outputs are deterministic for a
// given cache, so re-running only changes files when the config or code changed.

import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  zoneConfigFromData,
  zoneFrame,
  zoneGrid,
  CHART_PROJ,
  CHART_REF,
  type ZoneConfig,
  type GridFrame,
} from './lib/zone.ts';
import { BATHY_URL, DEM_VRT, checkTools, fetchBathy, warpLake, warpToGrid } from './lib/gdal.ts';
import { mergeElevation } from './lib/merge.ts';
import { applyHandEdits } from './lib/edits.ts';
import { downsample, stats, type Raster } from './lib/raster.ts';
import { shorelineSdf } from './lib/sdf.ts';
import { CANOPY_M } from '../../src/sim/terrain/vegetation.ts';
import { DEFAULT_WIND, DIRECTIONS, bakeWindMaps, withCanopy } from './lib/wind.ts';
import { findIslands } from './lib/islands.ts';
import {
  encode,
  png16,
  pngRgb,
  quantize,
  tileWindow,
  type Encoding,
  type Quantization,
} from './lib/encode.ts';
import { drawFootprints, relief, windLayer } from './lib/preview.ts';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

/** Heights: 1/64 m steps from −512 m, so u16 covers −512 m … +512 m. */
export const HEIGHT_Q: Quantization = { type: 'u16', scale: 1 / 64, offset: -512 };
/** Shoreline distance: quarter-meter steps, ±8 km. */
export const SDF_Q: Quantization = { type: 'i16', scale: 0.25, offset: 0 };
const UNIT_Q: Quantization = { type: 'u8', scale: 1 / 255, offset: 0 };
/** Fetch: 10 m steps up to 655 km. */
const FETCH_Q: Quantization = { type: 'u16', scale: 10, offset: 0 };
const HEIGHT_ENCODING: Encoding = 'delta-deflate';
/** Real meters per cell of the lake-wide grid used past the zone edge for fetch and lee. */
const LAKE_CELL_M = 1024;

const args = process.argv.slice(2);
const zoneName = args.find((a) => !a.startsWith('--')) ?? 'apostles';
const refetch = args.includes('--refetch');
const compare = args.includes('--compare');
// --land-curve=none | linear:<scale> | soft-knee:<kneeM> overrides the zone config.
const curveArg = args.find((a) => a.startsWith('--land-curve='))?.split('=')[1];

const t0 = performance.now();
const lap = (label: string) =>
  console.log(`${((performance.now() - t0) / 1000).toFixed(1).padStart(6)} s  ${label}`);

const readData = (file: string): unknown =>
  JSON.parse(readFileSync(join(ROOT, 'data', file), 'utf8'));
const config: ZoneConfig = zoneConfigFromData(
  `zone.${zoneName}`,
  readData('zones.json'),
  readData('islands.json'),
);
if (curveArg) {
  const [kind, value] = curveArg.split(':');
  if (kind === 'none') delete config.landCurve;
  else if (kind === 'linear') config.landCurve = { kind, scale: Number(value) };
  else if (kind === 'soft-knee') config.landCurve = { kind, kneeM: Number(value) };
  else throw new Error(`Unknown --land-curve ${curveArg}`);
}
const curveLabel = !config.landCurve
  ? '1:1'
  : config.landCurve.kind === 'linear'
    ? `linear × ${config.landCurve.scale}`
    : `soft knee at ${config.landCurve.kneeM} m`;
const frame = zoneFrame(config);
const footGrid = zoneGrid(frame, config.onFootSampleM);
const sailGrid = zoneGrid(frame, config.sailingSampleM);
const ratio = config.sailingSampleM / config.onFootSampleM;
const cacheDir = join(ROOT, 'tools', 'geo', '.cache', zoneName);
const outDir = join(ROOT, 'public', 'world', zoneName);
const reportDir = join(ROOT, 'tools', 'geo', 'reports');
mkdirSync(cacheDir, { recursive: true });

checkTools();
const bathyTif = fetchBathy(join(ROOT, 'tools', 'geo', '.cache'), refetch);
lap('bathymetry ready');
const dem = warpToGrid(
  `/vsicurl/${DEM_VRT}`,
  join(cacheDir, 'dem-1m'),
  frame,
  footGrid,
  'bilinear',
  refetch,
);
lap(`DEM warped (${footGrid.width}×${footGrid.height})`);
const bathy = warpToGrid(
  bathyTif,
  join(cacheDir, 'bathy-1m'),
  frame,
  footGrid,
  'bilinear',
  refetch,
);
lap('bathymetry warped');
const lake = warpLake(bathyTif, join(cacheDir, `lake-${LAKE_CELL_M}`), LAKE_CELL_M, refetch);
lap(`lake context grid (${lake.width}×${lake.height})`);

const foot = mergeElevation(dem, bathy, config);
lap('merged');
const edits = applyHandEdits(foot, footGrid, frame, config.islands, config.setPieces);
lap(`hand edits (${edits.map((e) => `${e.id} ${e.samples}`).join(', ')})`);
const sail = downsample(foot, ratio);
const sdf = shorelineSdf(sail, config.sailingSampleM);
lap('sailing heightmap and shoreline SDF');

// Shelter sees the forest canopy; fetch and the land mask see bare earth.
const wind = bakeWindMaps(withCanopy(sail, sailGrid), sailGrid, frame, config.windCellM, lake, {
  ...DEFAULT_WIND,
  lakeOffsetM: config.bathyDatumM - config.lakeLevelM,
});
lap(`wind maps (${DIRECTIONS} × ${wind.width}×${wind.height})`);

const prints = findIslands(sail, sailGrid, frame, config.islands);
lap('islands found');

// ---- Write -----------------------------------------------------------------------------

rmSync(outDir, { recursive: true, force: true });
mkdirSync(outDir, { recursive: true });
let bytes = 0;
const write = (rel: string, data: Uint8Array) => {
  const p = join(outDir, rel);
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, data);
  bytes += data.byteLength;
};

/** Cuts a vertex grid into (tileSamples + 1)² tiles and writes them. */
function writeTiles(src: Raster, dir: string, size: number): { tilesX: number; tilesY: number } {
  const tilesX = Math.ceil((src.width - 1) / size);
  const tilesY = Math.ceil((src.height - 1) / size);
  for (let ty = 0; ty < tilesY; ty++) {
    for (let tx = 0; tx < tilesX; tx++) {
      const q = quantize(tileWindow(src, tx * size, ty * size, size), HEIGHT_Q);
      write(`${dir}/${tx}-${ty}.bin`, encode(q, size + 1, HEIGHT_ENCODING));
    }
  }
  return { tilesX, tilesY };
}

const gridInfo = (g: GridFrame) => ({
  step: g.step,
  x0: g.x0,
  z0: g.z0,
  width: g.width,
  height: g.height,
});
const sailStats = stats(sail);

const heightTiles = writeTiles(sail, 'height', config.tileSamples);
const heightBytes = bytes;

write('sdf.bin', encode(quantize(sdf.data, SDF_Q), sdf.width, 'delta-deflate'));
write('wind/shelter.bin', encode(quantize(wind.shelter, UNIT_Q), wind.width, 'deflate'));
write('wind/fetch.bin', encode(quantize(wind.fetch, FETCH_Q), wind.width, 'delta-deflate'));
write('wind/funnel.bin', encode(quantize(wind.funnel, UNIT_Q), wind.width, 'deflate'));
const derivedBytes = bytes - heightBytes;

const margin = Math.round(config.islandMarginM / config.onFootSampleM);
const islands = prints.map((p) => {
  const slug = p.island.id.replace(/^island\./, '');
  // The footprint in on-foot samples, grown by the margin and rounded out to whole tiles.
  const fx0 = Math.max(0, p.i0 * ratio - margin);
  const fy0 = Math.max(0, p.j0 * ratio - margin);
  const fx1 = Math.min(footGrid.width - 1, p.i1 * ratio + margin);
  const fy1 = Math.min(footGrid.height - 1, p.j1 * ratio + margin);
  const size = config.tileSamples;
  const tilesX = Math.max(1, Math.ceil((fx1 - fx0) / size));
  const tilesY = Math.max(1, Math.ceil((fy1 - fy0) / size));
  const w = tilesX * size + 1;
  const h = tilesY * size + 1;
  const sub: Raster = { width: w, height: h, data: new Float32Array(w * h) };
  for (let j = 0; j < h; j++) {
    const sy = Math.min(footGrid.height - 1, fy0 + j);
    for (let i = 0; i < w; i++) {
      const sx = Math.min(footGrid.width - 1, fx0 + i);
      sub.data[j * w + i] = foot.data[sy * footGrid.width + sx] ?? 0;
    }
  }
  writeTiles(sub, `islands/${slug}`, size);
  // Share of the tile's land too steep to walk (plan 11 §4: 42°, from spike S5).
  const walkLimit = Math.tan((42 * Math.PI) / 180) * 2 * config.onFootSampleM;
  let land = 0;
  let steep = 0;
  for (let j = 1; j < h - 1; j++) {
    for (let i = 1; i < w - 1; i++) {
      const k = j * w + i;
      if ((sub.data[k] ?? 0) <= 0) continue;
      land++;
      const dx = (sub.data[k + 1] ?? 0) - (sub.data[k - 1] ?? 0);
      const dz = (sub.data[k + w] ?? 0) - (sub.data[k - w] ?? 0);
      if (Math.hypot(dx, dz) > walkLimit) steep++;
    }
  }
  // Area from the island's own sailing samples (the tile box can hold a neighbor).
  const cellReal = config.sailingSampleM * config.compression;
  const cellGame = config.sailingSampleM;
  return {
    id: p.island.id,
    name: p.island.name,
    geo: { lat: p.island.lat, lon: p.island.lon },
    found: p.method,
    step: config.onFootSampleM,
    x0: footGrid.x0 + fx0 * config.onFootSampleM,
    z0: footGrid.z0 + fy0 * config.onFootSampleM,
    width: w,
    height: h,
    tilesX,
    tilesY,
    tiles: `islands/${slug}/{tx}-{ty}.bin`,
    landAreaKm2: {
      real: +((p.landSamples * cellReal ** 2) / 1e6).toFixed(2),
      game: +((p.landSamples * cellGame ** 2) / 1e6).toFixed(3),
    },
    maxHeightM: +p.maxHeight.toFixed(1),
    steepPercent: land ? +((100 * steep) / land).toFixed(1) : 0,
  };
});
const islandBytes = bytes - heightBytes - derivedBytes;
lap('tiles written');

const heightFormat = { ...HEIGHT_Q, encoding: HEIGHT_ENCODING, tileSamples: config.tileSamples };
const manifest = {
  version: 1,
  zone: config.id,
  name: config.name,
  projection: { chartRef: CHART_REF, proj: CHART_PROJ },
  frame,
  lakeLevelM: config.lakeLevelM,
  landCurve: config.landCurve ?? null,
  heightFormat,
  height: {
    ...gridInfo(sailGrid),
    ...heightTiles,
    tiles: 'height/{tx}-{ty}.bin',
    minM: +sailStats.min.toFixed(2),
    maxM: +sailStats.max.toFixed(2),
  },
  sdf: { ...gridInfo(sailGrid), file: 'sdf.bin', ...SDF_Q, encoding: 'delta-deflate' },
  wind: {
    directions: DIRECTIONS,
    directionNote: 'layer k is wind FROM bearing k × 22.5° (0 = north, clockwise)',
    cellM: wind.cellM,
    x0: sailGrid.x0,
    z0: sailGrid.z0,
    width: wind.width,
    height: wind.height,
    ...DEFAULT_WIND,
    canopyM: CANOPY_M,
    shelter: { file: 'wind/shelter.bin', ...UNIT_Q, encoding: 'deflate' },
    fetch: { file: 'wind/fetch.bin', ...FETCH_Q, encoding: 'delta-deflate', unit: 'real meters' },
    funnel: { file: 'wind/funnel.bin', ...UNIT_Q, encoding: 'deflate' },
  },
  islands,
  handEdits: edits,
  sources: [
    {
      name: 'NOAA NCEI Great Lakes Bathymetry, Lake Superior (3 arc-second)',
      url: BATHY_URL,
      license: 'Public domain (US Government)',
    },
    {
      name: 'USGS 3D Elevation Program, 1/3 arc-second seamless DEM',
      url: DEM_VRT,
      license: 'Public domain (US Government)',
    },
  ],
};
write('manifest.json', new TextEncoder().encode(JSON.stringify(manifest, null, 2) + '\n'));

// ---- Previews and report ---------------------------------------------------------------

mkdirSync(reportDir, { recursive: true });
const every = 2;
const img = relief(sail, config.sailingSampleM * config.compression, every);
drawFootprints(img, prints, every);
writeFileSync(join(reportDir, `${zoneName}-relief.png`), pngRgb(img.rgb, img.width, img.height));
// Shelter, fetch and funneling side by side for a north-west wind (layer 14), the classic
// Superior gale direction.
const panels = (
  [
    [wind.shelter, 1],
    [wind.fetch, 150_000],
    [wind.funnel, 1],
  ] as const
).map(([values, max]) => windLayer(values, 14, wind.width, wind.height, max));
const gap = 8;
const sheetW = panels.length * wind.width + (panels.length - 1) * gap;
const sheet = new Uint8Array(sheetW * wind.height * 3).fill(255);
panels.forEach((p, n) => {
  for (let y = 0; y < p.height; y++) {
    sheet.set(
      p.rgb.subarray(y * p.width * 3, (y + 1) * p.width * 3),
      (y * sheetW + n * (wind.width + gap)) * 3,
    );
  }
});
writeFileSync(join(reportDir, `${zoneName}-wind-nw.png`), pngRgb(sheet, sheetW, wind.height));
lap(`previews in ${reportDir}`);

const kb = (n: number) => `${(n / 1024).toFixed(0)} KB`;
const lines = [
  `# ${config.name} bake report`,
  '',
  'Written by `node tools/geo/build.ts`. Sizes are compressed bytes on disk.',
  '',
  `- Zone: ${(frame.sizeX / 1000).toFixed(2)} × ${(frame.sizeZ / 1000).toFixed(2)} km game, ${((frame.sizeX * config.compression) / 1000).toFixed(1)} × ${((frame.sizeZ * config.compression) / 1000).toFixed(1)} km real (C = ${config.compression})`,
  `- Sailing heightmap: ${sailGrid.width} × ${sailGrid.height} samples every ${config.sailingSampleM} m, ${heightTiles.tilesX * heightTiles.tilesY} tiles, ${kb(heightBytes)}; heights ${sailStats.min.toFixed(1)} m to ${sailStats.max.toFixed(1)} m`,
  `- Land heights: ${curveLabel} (water depth stays 1:1)`,
  `- SDF and wind maps: ${kb(derivedBytes)}`,
  `- Island tiles (1 m): ${kb(islandBytes)}`,
  `- Hand edits: ${edits.map((e) => `${e.id} (${e.kind}, ${e.samples.toLocaleString('en-US')} samples)`).join(', ')}`,
  `- Total: ${kb(bytes)}`,
  '',
  '| Island | Found by | Land area (real km²) | Max height (m) | Land over 42° | Tiles |',
  '| ------ | -------- | -------------------: | -------------: | ------------: | ----: |',
  ...islands.map(
    (i) =>
      `| ${i.name} | ${i.found} | ${i.landAreaKm2.real} | ${i.maxHeightM} | ${i.steepPercent}% | ${i.tilesX}×${i.tilesY} |`,
  ),
  '',
];

if (compare) {
  // Same sailing tiles, different storage. Uses the in-memory samples, not the files.
  const variants: [string, (q: Uint16Array, n: number) => number][] = [
    ['raw u16', (q) => q.byteLength],
    ['u16 + deflate', (q, n) => encode(q, n, 'deflate').byteLength],
    ['u16 + row delta + byte planes + deflate', (q, n) => encode(q, n, 'delta-deflate').byteLength],
    ['16-bit PNG (best filter per row)', (q, n) => png16(q, n, n).byteLength],
  ];
  const steps: [string, Quantization][] = [
    ['1/64 m', HEIGHT_Q],
    ['1/16 m', { ...HEIGHT_Q, scale: 1 / 16 }],
  ];
  lines.push(
    '## Sailing tile formats',
    '',
    '| Format | Step | Total |',
    '| ------ | ---- | ----: |',
  );
  for (const [sname, q] of steps) {
    const n = config.tileSamples + 1;
    const totals = variants.map(() => 0);
    for (let ty = 0; ty < heightTiles.tilesY; ty++) {
      for (let tx = 0; tx < heightTiles.tilesX; tx++) {
        const s = quantize(
          tileWindow(sail, tx * config.tileSamples, ty * config.tileSamples, config.tileSamples),
          q,
        ) as Uint16Array;
        variants.forEach(([, f], v) => (totals[v] = (totals[v] ?? 0) + f(s, n)));
      }
    }
    variants.forEach(([vname], v) => lines.push(`| ${vname} | ${sname} | ${kb(totals[v] ?? 0)} |`));
  }
  lines.push('');
  lap('format comparison');
}

writeFileSync(join(reportDir, `${zoneName}.md`), lines.join('\n'));
console.log('\n' + lines.join('\n'));
