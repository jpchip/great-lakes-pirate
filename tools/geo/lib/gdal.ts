// Source downloads and GDAL warps. Everything lands in tools/geo/.cache/ (gitignored) and is
// reused on the next run unless --refetch is passed.

import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { CHART_PROJ, geoToChart, warpExtent, type GridFrame, type ZoneFrame } from './zone.ts';
import { readEnvi, type Raster } from './raster.ts';

/** NOAA NCEI Great Lakes Bathymetry, Lake Superior, 3 arc-second (public domain). */
export const BATHY_URL =
  'https://www.ngdc.noaa.gov/mgg/greatlakes/superior/data/geotiff/superior_lld.geotiff.tar.gz';
/** Bounds of the Lake Superior grid (degrees). */
export const BATHY_BOUNDS = { south: 46, north: 49.5, west: -92.2, east: -84 };

/**
 * USGS 3DEP seamless 1/3 arc-second DEM (public domain). The tiles are cloud-optimized
 * GeoTIFFs, so GDAL reads only the blocks a zone needs instead of whole 1° tiles.
 */
export const DEM_VRT =
  'https://prd-tnm.s3.amazonaws.com/StagedProducts/Elevation/13/TIFF/USGS_Seamless_DEM_13.vrt';

const GDAL_HTTP = [
  '--config',
  'GDAL_DISABLE_READDIR_ON_OPEN',
  'EMPTY_DIR',
  '--config',
  'GDAL_HTTP_MULTIRANGE',
  'YES',
  '--config',
  'GDAL_HTTP_MERGE_CONSECUTIVE_RANGES',
  'YES',
  '--config',
  'GDAL_HTTP_MAX_RETRY',
  '5',
  '--config',
  'GDAL_HTTP_RETRY_DELAY',
  '2',
  '--config',
  'VSI_CACHE',
  'TRUE',
];

export function run(cmd: string, args: string[]): void {
  const res = spawnSync(cmd, args, { stdio: 'inherit' });
  if (res.error) throw new Error(`${cmd}: ${res.error.message}`);
  if (res.status !== 0) throw new Error(`${cmd} exited with ${res.status}`);
}

export function checkTools(): void {
  for (const [cmd, arg] of [
    ['gdalwarp', '--version'],
    ['curl', '--version'],
    ['tar', '--version'],
  ] as const) {
    const res = spawnSync(cmd, [arg], { stdio: 'ignore' });
    if (res.error || res.status !== 0) {
      throw new Error(`${cmd} not found. The geo pipeline needs GDAL ≥ 3.4, curl and tar.`);
    }
  }
}

/** Downloads and unpacks the Superior bathymetry. Returns the GeoTIFF path. */
export function fetchBathy(cacheDir: string, refetch: boolean): string {
  const dir = join(cacheDir, 'sources');
  mkdirSync(dir, { recursive: true });
  const tif = join(dir, 'superior_lld', 'superior_lld.tif');
  if (existsSync(tif) && !refetch) return tif;
  const archive = join(dir, 'superior_lld.geotiff.tar.gz');
  console.log(`Downloading ${BATHY_URL}`);
  run('curl', ['-fsSL', '--retry', '4', '-o', archive, BATHY_URL]);
  run('tar', ['-xzf', archive, '-C', dir]);
  return tif;
}

// gdalwarp writes GeoTIFF (its ENVI output silently came out empty with GDAL 3.8), then
// gdal_translate turns that into a raw ENVI file Node can read without GDAL bindings.
function toEnvi(tif: string, out: string): void {
  run('gdal_translate', ['-q', '-of', 'ENVI', tif, out]);
}

/** Warps a source onto a zone grid as an ENVI Float32 raster and reads it back. */
export function warpToGrid(
  src: string,
  out: string,
  frame: ZoneFrame,
  grid: GridFrame,
  resampling: 'bilinear' | 'cubic' | 'average',
  refetch: boolean,
): Raster {
  if (!existsSync(out) || refetch) {
    const { te, tr } = warpExtent(frame, grid);
    run('gdalwarp', [
      ...GDAL_HTTP,
      '-q',
      '-overwrite',
      '-t_srs',
      CHART_PROJ,
      '-te',
      ...te.map(String),
      '-tr',
      String(tr),
      String(tr),
      '-r',
      resampling,
      '-ot',
      'Float32',
      '-dstnodata',
      '-9999',
      '-wm',
      '1024',
      '-multi',
      src,
      `${out}.tif`,
    ]);
    toEnvi(`${out}.tif`, out);
  }
  return readEnvi(out, grid.width, grid.height);
}

/** The lake-wide context grid: chart-space cells of `cellM` real meters covering Superior. */
export interface LakeGrid extends Raster {
  /** Chart coordinates of the north-west corner of cell (0, 0). */
  xmin: number;
  ymax: number;
  cellM: number;
}

/** Warps the whole Superior bathymetry (it includes nearshore land) to a coarse chart grid. */
export function warpLake(bathyTif: string, out: string, cellM: number, refetch: boolean): LakeGrid {
  const sw = geoToChart({ lat: BATHY_BOUNDS.south, lon: BATHY_BOUNDS.west });
  const ne = geoToChart({ lat: BATHY_BOUNDS.north, lon: BATHY_BOUNDS.east });
  const xmin = Math.floor(sw.x / cellM) * cellM;
  const ymin = Math.floor(sw.y / cellM) * cellM;
  const width = Math.ceil((ne.x - xmin) / cellM);
  const height = Math.ceil((ne.y - ymin) / cellM);
  const ymax = ymin + height * cellM;
  if (!existsSync(out) || refetch) {
    run('gdalwarp', [
      '-q',
      '-overwrite',
      '-t_srs',
      CHART_PROJ,
      '-te',
      String(xmin),
      String(ymin),
      String(xmin + width * cellM),
      String(ymax),
      '-tr',
      String(cellM),
      String(cellM),
      '-r',
      'average',
      '-ot',
      'Float32',
      '-dstnodata',
      '-9999',
      bathyTif,
      `${out}.tif`,
    ]);
    toEnvi(`${out}.tif`, out);
  }
  return { ...readEnvi(out, width, height), xmin, ymax, cellM };
}
