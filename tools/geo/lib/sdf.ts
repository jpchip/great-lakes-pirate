// Shoreline signed distance field: exact Euclidean distance transform (Felzenszwalb &
// Huttenlocher 2012) run once for water and once for land.

import { raster, type Raster } from './raster.ts';

const INF = 1e20;

/** 1D squared distance transform of f, in place via the scratch arrays. */
function edt1d(f: Float64Array, n: number, d: Float64Array, v: Int32Array, z: Float64Array): void {
  let k = 0;
  v[0] = 0;
  z[0] = -INF;
  z[1] = INF;
  for (let q = 1; q < n; q++) {
    let s: number;
    for (;;) {
      const p = v[k] ?? 0;
      s = ((f[q] ?? 0) + q * q - ((f[p] ?? 0) + p * p)) / (2 * q - 2 * p);
      if (s > (z[k] ?? 0) || k === 0) break;
      k--;
    }
    if (s <= (z[k] ?? 0)) {
      // k === 0 and the new parabola wins everywhere.
      v[0] = q;
      z[0] = -INF;
      z[1] = INF;
      k = 0;
      continue;
    }
    k++;
    v[k] = q;
    z[k] = s;
    z[k + 1] = INF;
  }
  k = 0;
  for (let q = 0; q < n; q++) {
    while ((z[k + 1] ?? 0) < q) k++;
    const p = v[k] ?? 0;
    d[q] = (q - p) * (q - p) + (f[p] ?? 0);
  }
}

/** Distance (in samples) from each sample to the nearest sample where `inside` is true. */
export function distanceTransform(width: number, height: number, inside: Uint8Array): Float64Array {
  const n = Math.max(width, height);
  const f = new Float64Array(n);
  const d = new Float64Array(n);
  const v = new Int32Array(n);
  const z = new Float64Array(n + 1);
  const grid = new Float64Array(width * height);
  for (let k = 0; k < grid.length; k++) grid[k] = inside[k] ? 0 : INF;
  for (let x = 0; x < width; x++) {
    for (let y = 0; y < height; y++) f[y] = grid[y * width + x] ?? 0;
    edt1d(f, height, d, v, z);
    for (let y = 0; y < height; y++) grid[y * width + x] = d[y] ?? 0;
  }
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) f[x] = grid[y * width + x] ?? 0;
    edt1d(f, width, d, v, z);
    for (let x = 0; x < width; x++) grid[y * width + x] = Math.sqrt(d[x] ?? 0);
  }
  return grid;
}

/**
 * Signed distance to the shoreline in game meters: positive over water, negative over land.
 * Each side measures to the nearest sample of the other side, minus half a step, so the
 * zero crossing sits between the last land and the first water sample.
 */
export function shorelineSdf(height: Raster, step: number): Raster {
  const { width, height: h } = height;
  const land = new Uint8Array(width * h);
  const water = new Uint8Array(width * h);
  for (let k = 0; k < land.length; k++) {
    if ((height.data[k] ?? 0) > 0) land[k] = 1;
    else water[k] = 1;
  }
  const toLand = distanceTransform(width, h, land);
  const toWater = distanceTransform(width, h, water);
  const out = raster(width, h);
  for (let k = 0; k < out.data.length; k++) {
    out.data[k] = land[k] ? -((toWater[k] ?? 0) - 0.5) * step : ((toLand[k] ?? 0) - 0.5) * step;
  }
  return out;
}
