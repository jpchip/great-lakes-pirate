import { GridField } from '../../sim/terrain/grid-field';
import { forestDensity, upnessAt } from '../../sim/terrain/vegetation';

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
  /** Forest density 0–1 per vertex (sim/terrain/vegetation), for the terrain shader. */
  forest: Float32Array;
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

/** A terrain patch with positions, normals and forest density, in zone meters. */
export function buildTileArrays(field: GridField, o: GridMeshOptions): TileArrays {
  const s = o.stride;
  const cols = (o.i1 - o.i0) / s + 1;
  const rows = (o.j1 - o.j0) / s + 1;
  const ring = o.skirts ? 2 * (cols + rows) - 4 : 0;
  const count = cols * rows + ring;
  const positions = new Float32Array(count * 3);
  const normals = new Float32Array(count * 3);
  const forest = new Float32Array(count);
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
      const x = positions[k3] ?? 0;
      const z = positions[k3 + 2] ?? 0;
      forest[r * cols + c] = forestDensity(h, upnessAt(field, x, z), x, z);
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
      forest[base + q] = forest[loop[q] ?? 0] ?? 0;
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

  return { positions, normals, forest, indices: indices.slice(0, n), minY, maxY };
}
