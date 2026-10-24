// Quantizing, tiling and compressing baked grids, plus PNG writers for previews and for the
// format comparison in the build report.

import { deflateSync, crc32 } from 'node:zlib';
import { zlibSync } from 'fflate';
import type { Raster } from './raster.ts';

export type SampleType = 'u8' | 'u16' | 'i16';

/**
 * How a grid file is stored. Every baked grid is row-major, little-endian, no header; the
 * manifest carries the size and the value mapping (value = raw × scale + offset).
 * - `deflate`: the samples, zlib-compressed.
 * - `delta-deflate`: each row stored as differences from the previous sample (wrapping),
 *   the low bytes of the whole grid then the high bytes, zlib-compressed. Smooth terrain
 *   turns into small deltas, and splitting the bytes groups the near-constant high bytes.
 */
export type Encoding = 'deflate' | 'delta-deflate';

export interface Quantization {
  type: SampleType;
  scale: number;
  offset: number;
}

function range(type: SampleType): [number, number] {
  if (type === 'u8') return [0, 255];
  if (type === 'u16') return [0, 65535];
  return [-32768, 32767];
}

export function quantize(
  values: ArrayLike<number>,
  q: Quantization,
): Uint8Array | Uint16Array | Int16Array {
  const [lo, hi] = range(q.type);
  const out =
    q.type === 'u8'
      ? new Uint8Array(values.length)
      : q.type === 'u16'
        ? new Uint16Array(values.length)
        : new Int16Array(values.length);
  for (let k = 0; k < values.length; k++) {
    const v = Math.round(((values[k] ?? 0) - q.offset) / q.scale);
    out[k] = Math.min(hi, Math.max(lo, v));
  }
  return out;
}

function bytesOf(samples: Uint8Array | Uint16Array | Int16Array): Uint8Array {
  return new Uint8Array(samples.buffer, samples.byteOffset, samples.byteLength);
}

/** Applies the row-delta predictor and byte-plane split (see Encoding). */
export function deltaPlanes(samples: Uint16Array | Int16Array, width: number): Uint8Array {
  const n = samples.length;
  const out = new Uint8Array(n * 2);
  for (let k = 0; k < n; k++) {
    const prev = k % width === 0 ? 0 : (samples[k - 1] ?? 0);
    const d = ((samples[k] ?? 0) - prev) & 0xffff;
    out[k] = d & 0xff;
    out[n + k] = d >> 8;
  }
  return out;
}

export function encode(
  samples: Uint8Array | Uint16Array | Int16Array,
  width: number,
  encoding: Encoding,
): Uint8Array {
  if (encoding === 'delta-deflate' && !(samples instanceof Uint8Array)) {
    return zlibSync(deltaPlanes(samples, width), { level: 9 });
  }
  return zlibSync(bytesOf(samples), { level: 9 });
}

/** A (size + 1)² window starting at (x, y); the extra row and column are shared with neighbors. */
export function tileWindow(src: Raster, x: number, y: number, size: number): Float32Array {
  const n = size + 1;
  const out = new Float32Array(n * n);
  for (let j = 0; j < n; j++) {
    const sy = Math.min(src.height - 1, y + j);
    for (let i = 0; i < n; i++) {
      const sx = Math.min(src.width - 1, x + i);
      out[j * n + i] = src.data[sy * src.width + sx] ?? 0;
    }
  }
  return out;
}

function chunk(type: string, data: Uint8Array): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body) >>> 0);
  return Buffer.concat([len, body, crc]);
}

function png(
  width: number,
  height: number,
  bitDepth: 8 | 16,
  colorType: 0 | 2,
  rows: Uint8Array[],
): Buffer {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = bitDepth;
  ihdr[9] = colorType;
  const bpp = (bitDepth / 8) * (colorType === 2 ? 3 : 1);
  const rowLen = width * bpp;
  // Per row, the filter with the smallest sum of absolute bytes (the usual PNG heuristic).
  const filtered = Buffer.alloc(height * (rowLen + 1));
  const none = new Uint8Array(rowLen);
  const sub = new Uint8Array(rowLen);
  const upF = new Uint8Array(rowLen);
  const avg = new Uint8Array(rowLen);
  const paethF = new Uint8Array(rowLen);
  const cand = [none, sub, upF, avg, paethF];
  const zero = new Uint8Array(rowLen);
  for (let y = 0; y < height; y++) {
    const row = rows[y] ?? zero;
    const up = (y > 0 && rows[y - 1]) || zero;
    for (let x = 0; x < rowLen; x++) {
      const a = x >= bpp ? (row[x - bpp] ?? 0) : 0;
      const b = up[x] ?? 0;
      const c = x >= bpp ? (up[x - bpp] ?? 0) : 0;
      const p = a + b - c;
      const pa = Math.abs(p - a);
      const pb = Math.abs(p - b);
      const pc = Math.abs(p - c);
      const paeth = pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      const v = row[x] ?? 0;
      none[x] = v;
      sub[x] = v - a;
      upF[x] = v - b;
      avg[x] = v - ((a + b) >> 1);
      paethF[x] = v - paeth;
    }
    let best = 0;
    let bestSum = Infinity;
    cand.forEach((cnd, f) => {
      let sum = 0;
      for (const v of cnd) sum += v < 128 ? v : 256 - v;
      if (sum < bestSum) {
        bestSum = sum;
        best = f;
      }
    });
    const o = y * (rowLen + 1);
    filtered[o] = best;
    filtered.set(cand[best] ?? none, o + 1);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(filtered, { level: 9 })),
    chunk('IEND', new Uint8Array(0)),
  ]);
}

/** 16-bit grayscale PNG (big-endian samples), used only to compare formats. */
export function png16(samples: Uint16Array, width: number, height: number): Buffer {
  const rows: Uint8Array[] = [];
  for (let y = 0; y < height; y++) {
    const row = new Uint8Array(width * 2);
    for (let x = 0; x < width; x++) {
      const v = samples[y * width + x] ?? 0;
      row[x * 2] = v >> 8;
      row[x * 2 + 1] = v & 0xff;
    }
    rows.push(row);
  }
  return png(width, height, 16, 0, rows);
}

/** 8-bit RGB PNG for previews. `rgb` is width × height × 3 bytes. */
export function pngRgb(rgb: Uint8Array, width: number, height: number): Buffer {
  const rows: Uint8Array[] = [];
  for (let y = 0; y < height; y++) rows.push(rgb.subarray(y * width * 3, (y + 1) * width * 3));
  return png(width, height, 8, 2, rows);
}
