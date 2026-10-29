import { GridField } from '../../sim/terrain/grid-field';

/**
 * Terrain patch geometry as plain typed arrays (plan 03 §8.3), so it can be built in the
 * tile worker (render/terrain/tile-worker) as well as on the main thread. No three.js
 * here: the worker stays small, and the arrays transfer back without a copy.
 */

/** Cells entirely deeper than this are never seen through the water, so they're skipped. */
export const CULL_DEPTH_M = 12;
/** How far the skirts hang below each tile's edge. */
export const SKIRT_M = 24;

export interface GridMeshOptions {
  /** Sample range, inclusive. (i1 − i0) and (j1 − j0) must be multiples of `stride`. */
  i0: number;
  j0: number;
  i1: number;
  j1: number;
  stride: number;
  skirts: boolean;
}

export interface TileArrays {
  positions: Float32Array;
  normals: Float32Array;
  colors: Float32Array;
  indices: Uint32Array;
  /** Height range of the patch's surface, for its bounding sphere. */
  minY: number;
  maxY: number;
}

/** A height grid as plain data, to post to the worker. */
export interface HeightGrid {
  x0: number;
  z0: number;
  step: number;
  width: number;
  height: number;
  values: Float32Array;
}

export function gridField(g: HeightGrid): GridField {
  return new GridField(g.x0, g.z0, g.step, g.width, g.height, g.values);
}

/** An sRGB hex color as linear RGB, the way three.js's color management reads it. */
function linear(hex: number): number[] {
  return [16, 8, 0].map((shift) => {
    const c = ((hex >> shift) & 255) / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
}

// Greybox palette: seabed, shoals, beach, grass to forest, rock on steep ground.
const DEEP = linear(0x2f3f3b);
const SHOAL = linear(0x9a8c64);
const BEACH = linear(0xcdbd8e);
const GRASS = linear(0x5f7c46);
const FOREST = linear(0x3f5a35);
const ROCK = linear(0x77736a);

function smoothstep(a: number, b: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

function mix(a: number[], b: number[], t: number, out: Float32Array, k: number): void {
  for (let c = 0; c < 3; c++) out[k + c] = (a[c] ?? 0) + ((b[c] ?? 0) - (a[c] ?? 0)) * t;
}

/** Greybox terrain color by height and upness (the normal's y), into `out` at `k`. */
export function terrainColor(height: number, upness: number, out: Float32Array, k: number): void {
  if (height < -8) mix(DEEP, DEEP, 0, out, k);
  else if (height < -1) mix(DEEP, SHOAL, (height + 8) / 7, out, k);
  else if (height < 1.2) mix(SHOAL, BEACH, Math.min(1, (height + 1) / 1.2), out, k);
  else if (height < 3) mix(BEACH, GRASS, (height - 1.2) / 1.8, out, k);
  else mix(GRASS, FOREST, Math.min(1, (height - 3) / 20), out, k);
  if (height > 0.5) {
    // Faces steeper than ~40° turn to rock.
    const rock = smoothstep(0, 0.15, 0.85 - upness);
    for (let c = 0; c < 3; c++) {
      const v = out[k + c] ?? 0;
      out[k + c] = v + ((ROCK[c] ?? 0) - v) * rock;
    }
  }
}

/** A terrain patch with positions, normals and colors, in zone meters. */
export function buildTileArrays(field: GridField, o: GridMeshOptions): TileArrays {
  const s = o.stride;
  const cols = (o.i1 - o.i0) / s + 1;
  const rows = (o.j1 - o.j0) / s + 1;
  const ring = o.skirts ? 2 * (cols + rows) - 4 : 0;
  const count = cols * rows + ring;
  const positions = new Float32Array(count * 3);
  const normals = new Float32Array(count * 3);
  const colors = new Float32Array(count * 3);
  const span = 2 * s * field.step;
  let minY = Number.POSITIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const i = o.i0 + c * s;
      const j = o.j0 + r * s;
      const h = field.at(i, j);
      if (h < minY) minY = h;
      if (h > maxY) maxY = h;
      const k3 = (r * cols + c) * 3;
      positions[k3] = field.x0 + i * field.step;
      positions[k3 + 1] = h;
      positions[k3 + 2] = field.z0 + j * field.step;
      // Normals from the field over the stride, so they match across tile edges.
      const nx = field.at(i - s, j) - field.at(i + s, j);
      const nz = field.at(i, j - s) - field.at(i, j + s);
      const inv = 1 / Math.hypot(nx, span, nz);
      normals[k3] = nx * inv;
      normals[k3 + 1] = span * inv;
      normals[k3 + 2] = nz * inv;
      terrainColor(h, span * inv, colors, k3);
    }
  }

  const deep = (k: number): boolean => (positions[k * 3 + 1] ?? 0) < -CULL_DEPTH_M;
  const indices = new Uint32Array((rows - 1) * (cols - 1) * 6 + ring * 6);
  let n = 0;
  for (let r = 0; r < rows - 1; r++) {
    for (let c = 0; c < cols - 1; c++) {
      const a = r * cols + c;
      const b = a + 1;
      const d = a + cols;
      const e = d + 1;
      if (deep(a) && deep(b) && deep(d) && deep(e)) continue;
      // Counter-clockwise seen from above (+y), so faces point up.
      indices[n++] = a;
      indices[n++] = d;
      indices[n++] = b;
      indices[n++] = b;
      indices[n++] = d;
      indices[n++] = e;
    }
  }

  if (o.skirts) {
    // The edge loop, clockwise seen from above: north edge east, east edge south, …
    const loop = new Uint32Array(ring);
    let m = 0;
    for (let c = 0; c < cols - 1; c++) loop[m++] = c;
    for (let r = 0; r < rows - 1; r++) loop[m++] = r * cols + cols - 1;
    for (let c = cols - 1; c > 0; c--) loop[m++] = (rows - 1) * cols + c;
    for (let r = rows - 1; r > 0; r--) loop[m++] = r * cols;
    const base = cols * rows;
    for (let q = 0; q < ring; q++) {
      const top = (loop[q] ?? 0) * 3;
      const k3 = (base + q) * 3;
      positions[k3] = positions[top] ?? 0;
      positions[k3 + 1] = (positions[top + 1] ?? 0) - SKIRT_M;
      positions[k3 + 2] = positions[top + 2] ?? 0;
      normals.copyWithin(k3, top, top + 3);
      colors.copyWithin(k3, top, top + 3);
    }
    for (let q = 0; q < ring; q++) {
      const a = loop[q] ?? 0;
      const b = loop[(q + 1) % ring] ?? 0;
      if (deep(a) && deep(b)) continue;
      const a2 = base + q;
      const b2 = base + ((q + 1) % ring);
      // Faces outward; the material is double-sided for skirts seen from inside a crack.
      indices[n++] = a;
      indices[n++] = b;
      indices[n++] = a2;
      indices[n++] = b;
      indices[n++] = b2;
      indices[n++] = a2;
    }
    minY -= SKIRT_M;
  }

  return { positions, normals, colors, indices: indices.slice(0, n), minY, maxY };
}
