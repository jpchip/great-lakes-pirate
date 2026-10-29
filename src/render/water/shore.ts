import * as THREE from 'three';
import type { GridField } from '../../sim/terrain/grid-field';

/**
 * The water's shore texture (plan 04 §7): an RG8 texture over the whole zone at 8 m, so
 * depth bands and shore foam reach the far islands too. R holds √(depth / range), which
 * keeps the shallow bands sharp; G holds the distance to the shoreline. Texel centers
 * sit on the grid samples, so linear filtering interpolates them like GridField.sample.
 * The outermost texels are open deep water, and the texture clamps to them past the
 * zone's edge.
 */

/** Depths past this read as deep. */
export const SHORE_DEPTH_RANGE_M = 32;
/** The shore distance spans −offset … range − offset meters (negative on land). */
export const SHORE_SDF_OFFSET_M = 16;
export const SHORE_SDF_RANGE_M = 128;

export interface ShoreGrid {
  /** Zone meters of sample (0, 0) and the spacing. */
  x0: number;
  z0: number;
  step: number;
  width: number;
  height: number;
  /** RG bytes, row-major. */
  data: Uint8Array;
}

const byte = (v: number): number => Math.round(Math.min(Math.max(v, 0), 1) * 255);

export function encodeDepth(depthM: number): number {
  return byte(Math.sqrt(Math.max(depthM, 0) / SHORE_DEPTH_RANGE_M));
}

export function decodeDepth(b: number): number {
  return (b / 255) ** 2 * SHORE_DEPTH_RANGE_M;
}

export function encodeShore(distanceM: number): number {
  return byte((distanceM + SHORE_SDF_OFFSET_M) / SHORE_SDF_RANGE_M);
}

export function decodeShore(b: number): number {
  return (b / 255) * SHORE_SDF_RANGE_M - SHORE_SDF_OFFSET_M;
}

/** Bakes heights (negative under water) and the shoreline SDF on one frame. */
export function bakeShore(seabed: GridField, shoreline: GridField): ShoreGrid {
  const { width, height } = seabed;
  if (
    shoreline.width !== width ||
    shoreline.height !== height ||
    shoreline.x0 !== seabed.x0 ||
    shoreline.z0 !== seabed.z0 ||
    shoreline.step !== seabed.step
  ) {
    throw new RangeError('shore: the seabed and shoreline grids must share a frame');
  }
  const data = new Uint8Array(width * height * 2);
  for (let j = 0; j < height; j++) {
    for (let i = 0; i < width; i++) {
      const k = (j * width + i) * 2;
      const edge = i === 0 || j === 0 || i === width - 1 || j === height - 1;
      data[k] = edge ? 255 : encodeDepth(-seabed.at(i, j));
      data[k + 1] = edge ? 255 : encodeShore(shoreline.at(i, j));
    }
  }
  return { x0: seabed.x0, z0: seabed.z0, step: seabed.step, width, height, data };
}

function texture(data: Uint8Array, width: number, height: number): THREE.DataTexture {
  const t = new THREE.DataTexture(data, width, height, THREE.RGFormat, THREE.UnsignedByteType);
  t.magFilter = THREE.LinearFilter;
  t.minFilter = THREE.LinearFilter;
  t.wrapS = THREE.ClampToEdgeWrapping;
  t.wrapT = THREE.ClampToEdgeWrapping;
  // Rows of an odd width aren't 4-byte aligned.
  t.unpackAlignment = 1;
  t.needsUpdate = true;
  return t;
}

export function shoreTexture(grid: ShoreGrid): THREE.DataTexture {
  return texture(grid.data, grid.width, grid.height);
}

/** One texel of open deep water, for scenes without a zone. */
export function deepWaterTexture(): THREE.DataTexture {
  return texture(new Uint8Array([255, 255]), 1, 1);
}

/** `uShoreRect` for a grid: the texture's corner and 1 / its size in meters. */
export function shoreRect(grid: ShoreGrid, out: THREE.Vector4): THREE.Vector4 {
  return out.set(
    grid.x0 - grid.step / 2,
    grid.z0 - grid.step / 2,
    1 / (grid.width * grid.step),
    1 / (grid.height * grid.step),
  );
}
