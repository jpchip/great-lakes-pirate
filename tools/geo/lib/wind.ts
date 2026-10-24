// Shelter, fetch and funneling maps for 16 wind directions (plan 02 §11, plan 04 §9,
// plan 03 §8.2 step 6).
//
// Direction k is wind blowing FROM bearing k × 22.5° (0 = from north, clockwise). Each map is
// a grid of `cellM` game-meter cells, rows north to south. Fetch and channel width are in
// real meters, because the weather sim (plan 04) works in real geography. Lee length is in
// game meters (see WindOptions.leeFactor).

import type { LakeGrid } from './gdal.ts';
import type { Raster } from './raster.ts';
import { zoneToChart, type GridFrame, type ZoneFrame } from './zone.ts';

export const DIRECTIONS = 16;

export interface WindOptions {
  /**
   * Lee length as a multiple of obstacle height (plan 02 §11: roughly 10–20×), measured in
   * game meters. Heights aren't compressed, so this is the lee the player sees behind a
   * cliff; measured in real meters it would shrink to a ship length or two at C = 8.
   */
  leeFactor: number;
  /** Rays stop after this many real meters (fetch is capped here). */
  maxFetchM: number;
  /** Channels narrower than this (real meters, shore to shore across the wind) funnel. */
  funnelWidthM: number;
  /** Channels at or below this width get the full funneling factor. */
  funnelFullWidthM: number;
  /** The bathymetry datum relative to lake level (bathyDatumM − lakeLevelM). */
  lakeOffsetM: number;
}

export const DEFAULT_WIND: Omit<WindOptions, 'lakeOffsetM'> = {
  leeFactor: 15,
  maxFetchM: 600_000,
  funnelWidthM: 8_000,
  funnelFullWidthM: 1_500,
};

export interface WindMaps {
  width: number;
  height: number;
  cellM: number;
  /** [direction][row][col], 0 = full wind, 1 = fully blocked. */
  shelter: Float32Array;
  /** [direction][row][col], real meters of open water upwind. */
  fetch: Float32Array;
  /** [direction][row][col], 0 = none, 1 = strongest channel speed-up. */
  funnel: Float32Array;
}

interface Cells {
  width: number;
  height: number;
  /** Highest point in the cell above lake level (0 over water). */
  top: Float32Array;
  /** The cell is mostly land. */
  land: Uint8Array;
}

/** Pools the sailing heightmap into wind cells. */
function poolCells(height: Raster, grid: GridFrame, cellM: number): Cells {
  const per = cellM / grid.step;
  const width = Math.floor((grid.width - 1) / per);
  const rows = Math.floor((grid.height - 1) / per);
  const top = new Float32Array(width * rows);
  const land = new Uint8Array(width * rows);
  for (let cy = 0; cy < rows; cy++) {
    for (let cx = 0; cx < width; cx++) {
      let max = 0;
      let landCount = 0;
      for (let j = 0; j < per; j++) {
        for (let i = 0; i < per; i++) {
          const v = height.data[(cy * per + j) * grid.width + cx * per + i] ?? 0;
          if (v > max) max = v;
          if (v > 0) landCount++;
        }
      }
      top[cy * width + cx] = max;
      land[cy * width + cx] = landCount * 2 > per * per ? 1 : 0;
    }
  }
  return { width, height: rows, top, land };
}

export function bakeWindMaps(
  height: Raster,
  grid: GridFrame,
  frame: ZoneFrame,
  cellM: number,
  lake: LakeGrid,
  opts: WindOptions,
): WindMaps {
  const cells = poolCells(height, grid, cellM);
  const { width, height: rows } = cells;
  const n = width * rows;
  const shelter = new Float32Array(DIRECTIONS * n);
  const fetch = new Float32Array(DIRECTIONS * n);
  const funnel = new Float32Array(DIRECTIONS * n);
  const C = frame.compression;

  // Terrain at a zone point (game meters): the zone's cells inside it, the lake grid outside.
  // Writes into `top` and `land` rather than returning an object; this runs ~10⁸ times.
  let top = 0;
  let land = false;
  let inZone = false;
  const lookup = (x: number, z: number) => {
    const i = Math.floor((x - grid.x0) / cellM);
    const j = Math.floor((z - grid.z0) / cellM);
    if (i >= 0 && j >= 0 && i < width && j < rows) {
      const k = j * width + i;
      top = cells.top[k] ?? 0;
      land = cells.land[k] === 1;
      inZone = true;
      return;
    }
    inZone = false;
    const c = zoneToChart(frame, x, z);
    const li = Math.floor((c.x - lake.xmin) / lake.cellM);
    const lj = Math.floor((lake.ymax - c.y) / lake.cellM);
    const v =
      li < 0 || lj < 0 || li >= lake.width || lj >= lake.height
        ? -9999
        : (lake.data[lj * lake.width + li] ?? 0);
    if (v === -9999) {
      top = 0;
      land = true;
      return;
    }
    const h = v + opts.lakeOffsetM;
    top = Math.max(h, 0);
    land = h > 0;
  };

  // Game meters per step: half a cell inside the zone, one lake cell outside it.
  const zoneStep = cellM / 2;
  const lakeStep = lake.cellM / C;

  // Real meters of open water from (x, z) along a unit zone vector, up to `limit` real meters.
  const march = (x: number, z: number, ux: number, uz: number, limit: number) => {
    const limitGame = limit / C;
    let d = 0;
    let step = zoneStep;
    while (d < limitGame) {
      d += step;
      lookup(x + ux * d, z + uz * d);
      if (land) return Math.min(d * C, limit);
      step = inZone ? zoneStep : lakeStep;
    }
    return limit;
  };

  let maxTop = 0;
  for (const v of cells.top) maxTop = Math.max(maxTop, v);
  const leeReach = opts.leeFactor * maxTop;

  for (let k = 0; k < DIRECTIONS; k++) {
    const bearing = (k * 22.5 * Math.PI) / 180;
    // Upwind in zone space (x east, z south).
    const ux = Math.sin(bearing);
    const uz = -Math.cos(bearing);
    for (let j = 0; j < rows; j++) {
      for (let i = 0; i < width; i++) {
        const idx = k * n + j * width + i;
        if (cells.land[j * width + i]) continue; // all three maps stay 0 on land
        const x = grid.x0 + (i + 0.5) * cellM;
        const z = grid.z0 + (j + 0.5) * cellM;

        // Lee: the strongest shelter from any obstacle within reach, even past the first
        // shore (a low spit doesn't cancel the high island behind it). Starts a full cell
        // out so a shore cell doesn't shelter itself.
        let lee = 0;
        for (let d = cellM; d <= leeReach; d += zoneStep) {
          lookup(x + ux * d, z + uz * d);
          if (top > 0) lee = Math.max(lee, 1 - d / (opts.leeFactor * top));
        }
        const up = march(x, z, ux, uz, opts.maxFetchM);
        shelter[idx] = lee;
        fetch[idx] = up;

        // Funneling: shore-to-shore width across the wind, open water upwind, low shelter.
        const left = march(x, z, -uz, ux, opts.funnelWidthM);
        const right = march(x, z, uz, -ux, opts.funnelWidthM);
        const narrow = Math.min(
          1,
          Math.max(
            0,
            (opts.funnelWidthM - (left + right)) / (opts.funnelWidthM - opts.funnelFullWidthM),
          ),
        );
        const open = Math.min(1, up / opts.funnelWidthM);
        funnel[idx] = narrow * open * (1 - lee);
      }
    }
  }
  return { width, height: rows, cellM, shelter, fetch, funnel };
}
