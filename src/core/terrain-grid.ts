/**
 * Decoder for the grids baked by tools/geo/build.ts (heightmap tiles, shoreline SDF, wind
 * maps; plan 03 §8.2). Each file is row-major samples, zlib-compressed, no header. The zone
 * manifest gives the size and the value mapping: value = raw × scale + offset.
 */

import { unzlibSync } from 'fflate';

export type SampleType = 'u8' | 'u16' | 'i16';

/**
 * - `deflate`: the samples (little-endian), compressed.
 * - `delta-deflate`: each row as wrapping differences from the previous sample, stored as
 *   all the low bytes then all the high bytes, compressed. 16-bit types only.
 */
export type GridEncoding = 'deflate' | 'delta-deflate';

export interface GridFormat {
  type: SampleType;
  scale: number;
  offset: number;
  encoding: GridEncoding;
}

/** Decodes `count` samples (`width` per row) into values. */
export function decodeGrid(
  bytes: Uint8Array,
  count: number,
  width: number,
  format: GridFormat,
): Float32Array {
  const raw = unzlibSync(bytes);
  const size = format.type === 'u8' ? 1 : 2;
  if (raw.byteLength !== count * size) {
    throw new Error(`terrain grid: expected ${count * size} bytes, got ${raw.byteLength}`);
  }
  const out = new Float32Array(count);
  const { scale, offset } = format;
  if (format.type === 'u8') {
    for (let k = 0; k < count; k++) out[k] = (raw[k] ?? 0) * scale + offset;
    return out;
  }
  const signed = format.type === 'i16';
  if (format.encoding === 'delta-deflate') {
    let prev = 0;
    for (let k = 0; k < count; k++) {
      if (k % width === 0) prev = 0;
      prev = (prev + ((raw[k] ?? 0) | ((raw[count + k] ?? 0) << 8))) & 0xffff;
      out[k] = (signed && prev > 0x7fff ? prev - 0x10000 : prev) * scale + offset;
    }
    return out;
  }
  for (let k = 0; k < count; k++) {
    const v = (raw[2 * k] ?? 0) | ((raw[2 * k + 1] ?? 0) << 8);
    out[k] = (signed && v > 0x7fff ? v - 0x10000 : v) * scale + offset;
  }
  return out;
}
