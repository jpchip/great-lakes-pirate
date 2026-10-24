// Zone config and grid geometry for the geo pipeline (plan 03 §8.2).
//
// The pipeline works in the game's chart projection (src/core/coords.ts): a local
// equirectangular projection around 47.5°N 88°W, x east, y north, in real meters. GDAL
// gets the same projection as a PROJ string, so every baked sample lines up with
// geoToChart() → chartToZone() at runtime. Plan 03 named UTM 15N; see the S3 write-up
// (plan 03 §14) for why the chart projection won.

import type { LandCurve } from './merge.ts';

// Mirrors src/core/coords.ts. tests/geo.test.ts checks they agree. (Node's type stripping
// can't load coords.ts directly because it uses constructor parameter properties.)
export const EARTH_RADIUS_M = 6_371_008.8;
export const CHART_REF = { lat: 47.5, lon: -88 };

const DEG = Math.PI / 180;

export const CHART_PROJ = [
  '+proj=eqc',
  `+lat_ts=${CHART_REF.lat}`,
  `+lat_0=${CHART_REF.lat}`,
  `+lon_0=${CHART_REF.lon}`,
  '+x_0=0',
  '+y_0=0',
  `+R=${EARTH_RADIUS_M}`,
  '+units=m',
  '+no_defs',
].join(' ');

export interface Geo {
  lat: number;
  lon: number;
}

export interface GeoBounds {
  south: number;
  north: number;
  west: number;
  east: number;
}

export interface IslandConfig extends Geo {
  id: string;
  name: string;
  /** Clip box for an island that the data joins to the mainland (Long Island). */
  bounds?: GeoBounds;
}

export interface ZoneConfig {
  id: string;
  name: string;
  /** Horizontal compression C (plan 03 §3.2). */
  compression: number;
  center: Geo;
  tilesX: number;
  tilesY: number;
  /** Samples per tile edge, excluding the shared edge sample. */
  tileSamples: number;
  /** Game meters between sailing heightmap samples. */
  sailingSampleM: number;
  /** Game meters between on-foot island samples. */
  onFootSampleM: number;
  /** Game meters per shelter, fetch and funneling cell. */
  windCellM: number;
  /** Mean lake level in NAVD88 meters; becomes height 0. */
  lakeLevelM: number;
  /** The NCEI bathymetry's vertical datum (Low Water Datum, IGLD85 meters). */
  bathyDatumM: number;
  /** DEM cells this far above lake level are land. Lower ones are hydroflattened water. */
  landThresholdM: number;
  /** Land height curve (see merge.ts). Omit to keep heights 1:1. */
  landCurve?: LandCurve;
  /** Game meters of water kept around each island's on-foot footprint. */
  islandMarginM: number;
  islands: IslandConfig[];
}

export function geoToChart(geo: Geo): { x: number; y: number } {
  return {
    x: (geo.lon - CHART_REF.lon) * DEG * EARTH_RADIUS_M * Math.cos(CHART_REF.lat * DEG),
    y: (geo.lat - CHART_REF.lat) * DEG * EARTH_RADIUS_M,
  };
}

/**
 * A grid of samples in zone space. Samples sit on vertices (pixel-is-point): sample (0, 0)
 * is the north-west corner and sample (i, j) is at zone x = x0 + i·step, z = z0 + j·step.
 * Rows run north to south (z grows southward, three.js convention).
 */
export interface GridFrame {
  width: number;
  height: number;
  /** Game meters between samples. */
  step: number;
  /** Zone coordinates of sample (0, 0). */
  x0: number;
  z0: number;
}

export interface ZoneFrame {
  /** Chart coordinates of the zone origin (real meters, whole numbers). */
  origin: { x: number; y: number };
  compression: number;
  /** Zone extent in game meters; the origin is the middle. */
  sizeX: number;
  sizeZ: number;
}

export function zoneFrame(config: ZoneConfig): ZoneFrame {
  const c = geoToChart(config.center);
  return {
    origin: { x: Math.round(c.x), y: Math.round(c.y) },
    compression: config.compression,
    sizeX: config.tilesX * config.tileSamples * config.sailingSampleM,
    sizeZ: config.tilesY * config.tileSamples * config.sailingSampleM,
  };
}

/** The whole zone sampled every `step` game meters, edges included. */
export function zoneGrid(frame: ZoneFrame, step: number): GridFrame {
  return {
    width: Math.round(frame.sizeX / step) + 1,
    height: Math.round(frame.sizeZ / step) + 1,
    step,
    x0: -frame.sizeX / 2,
    z0: -frame.sizeZ / 2,
  };
}

export function zoneToChart(frame: ZoneFrame, x: number, z: number): { x: number; y: number } {
  return {
    x: frame.origin.x + x * frame.compression,
    y: frame.origin.y - z * frame.compression,
  };
}

export function chartToZone(frame: ZoneFrame, cx: number, cy: number): { x: number; z: number } {
  return {
    x: (cx - frame.origin.x) / frame.compression,
    z: -(cy - frame.origin.y) / frame.compression,
  };
}

/**
 * gdalwarp -te/-tr arguments (real chart meters) that put pixel centers on the grid's
 * samples, since GDAL rasters are pixel-is-area.
 */
export function warpExtent(frame: ZoneFrame, grid: GridFrame): { te: number[]; tr: number } {
  const tr = grid.step * frame.compression;
  const nw = zoneToChart(frame, grid.x0, grid.z0);
  const xmin = nw.x - tr / 2;
  const ymax = nw.y + tr / 2;
  return { te: [xmin, ymax - grid.height * tr, xmin + grid.width * tr, ymax], tr };
}
