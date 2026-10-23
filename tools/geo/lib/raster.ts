// Float32 rasters and the few resampling helpers the pipeline needs.

import { readFileSync } from 'node:fs';

export interface Raster {
  width: number;
  height: number;
  data: Float32Array;
}

export function raster(width: number, height: number, fill = 0): Raster {
  const data = new Float32Array(width * height);
  if (fill !== 0) data.fill(fill);
  return { width, height, data };
}

/** Reads a GDAL ENVI Float32 raster (raw little-endian samples, row-major). */
export function readEnvi(path: string, width: number, height: number): Raster {
  const buf = readFileSync(path);
  if (buf.byteLength !== width * height * 4) {
    throw new Error(`${path}: expected ${width}×${height} Float32, got ${buf.byteLength} bytes`);
  }
  const data = new Float32Array(buf.buffer, buf.byteOffset, width * height).slice();
  return { width, height, data };
}

/**
 * Keeps every `factor`th sample with a small tent filter so coarse samples aren't aliased.
 * Both rasters are vertex grids: (w − 1) must divide by `factor`.
 */
export function downsample(src: Raster, factor: number): Raster {
  if ((src.width - 1) % factor || (src.height - 1) % factor) {
    throw new Error(`downsample: ${src.width}×${src.height} isn't a vertex grid for ×${factor}`);
  }
  const w = (src.width - 1) / factor + 1;
  const h = (src.height - 1) / factor + 1;
  const out = raster(w, h);
  // Weights 1 at the center falling to 0 at ±factor.
  const r = factor - 1;
  for (let j = 0; j < h; j++) {
    for (let i = 0; i < w; i++) {
      const cx = i * factor;
      const cy = j * factor;
      let sum = 0;
      let wsum = 0;
      for (let dy = -r; dy <= r; dy++) {
        const y = cy + dy;
        if (y < 0 || y >= src.height) continue;
        const wy = 1 - Math.abs(dy) / factor;
        for (let dx = -r; dx <= r; dx++) {
          const x = cx + dx;
          if (x < 0 || x >= src.width) continue;
          const wgt = wy * (1 - Math.abs(dx) / factor);
          sum += (src.data[y * src.width + x] ?? 0) * wgt;
          wsum += wgt;
        }
      }
      out.data[j * w + i] = sum / wsum;
    }
  }
  return out;
}

/** Copies a window; samples outside the source clamp to its edge. */
export function crop(src: Raster, x: number, y: number, width: number, height: number): Raster {
  const out = raster(width, height);
  for (let j = 0; j < height; j++) {
    const sy = Math.min(src.height - 1, Math.max(0, y + j));
    for (let i = 0; i < width; i++) {
      const sx = Math.min(src.width - 1, Math.max(0, x + i));
      out.data[j * width + i] = src.data[sy * src.width + sx] ?? 0;
    }
  }
  return out;
}

export function stats(r: Raster): { min: number; max: number } {
  let min = Infinity;
  let max = -Infinity;
  for (const v of r.data) {
    if (v < min) min = v;
    if (v > max) max = v;
  }
  return { min, max };
}
