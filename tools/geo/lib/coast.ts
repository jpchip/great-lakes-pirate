// Chart data for the whole western lake (plan 03 §8.2 step 9): the land/water field, the
// main lake picked out by flood fill, coastlines and depth contours traced as rings, and
// ring simplification that keeps the rings from crossing. Pure array code, so it unit-tests
// without GDAL (tests/chart-bake.test.ts).

import { simplifyRing } from '../../../src/core/simplify.ts';

export { simplifyRing };

/**
 * A grid of cells in chart space. Cell (i, j) covers x ∈ [x0 + i·cellM, x0 + (i+1)·cellM)
 * and y ∈ (y1 − (j+1)·cellM, y1 − j·cellM]; rows run north to south, like GDAL's.
 */
export interface CellGrid {
  width: number;
  height: number;
  cellM: number;
  /** Chart x of the west edge. */
  x0: number;
  /** Chart y of the north edge. */
  y1: number;
}

export interface Pt {
  x: number;
  y: number;
}

export const cellCenter = (g: CellGrid, i: number, j: number): Pt => ({
  x: g.x0 + (i + 0.5) * g.cellM,
  y: g.y1 - (j + 0.5) * g.cellM,
});

export const cellAt = (g: CellGrid, p: Pt): { i: number; j: number } => ({
  i: Math.floor((p.x - g.x0) / g.cellM),
  j: Math.floor((g.y1 - p.y) / g.cellM),
});

// ---- Land and water --------------------------------------------------------------------

/**
 * Keeps only the lake: water cells 4-connected to `seed` stay water and every other water
 * cell (inland lakes, ponds, rivers cut off by the data) becomes land. Then land
 * components (8-connected) smaller than `minIslandCells` that don't touch the grid edge
 * sink, so breakwaters and specks don't become islands. Returns the land mask (1 = land).
 */
export function lakeMask(
  g: CellGrid,
  water: (k: number) => boolean,
  seed: { i: number; j: number },
  minIslandCells: number,
): Uint8Array {
  const n = g.width * g.height;
  const land = new Uint8Array(n).fill(1);
  const start = seed.j * g.width + seed.i;
  if (!water(start)) throw new Error('The lake seed is not on water');
  const stack = new Int32Array(n);
  let top = 0;
  stack[top++] = start;
  land[start] = 0;
  while (top > 0) {
    const k = stack[--top] as number;
    const i = k % g.width;
    const j = (k - i) / g.width;
    const visit = (nk: number) => {
      if (land[nk] === 1 && water(nk)) {
        land[nk] = 0;
        stack[top++] = nk;
      }
    };
    if (i > 0) visit(k - 1);
    if (i < g.width - 1) visit(k + 1);
    if (j > 0) visit(k - g.width);
    if (j < g.height - 1) visit(k + g.width);
  }

  // Sink small islands.
  const seen = new Uint8Array(n);
  const members: number[] = [];
  for (let s = 0; s < n; s++) {
    if (land[s] !== 1 || seen[s]) continue;
    members.length = 0;
    let edge = false;
    top = 0;
    stack[top++] = s;
    seen[s] = 1;
    while (top > 0) {
      const k = stack[--top] as number;
      members.push(k);
      const i = k % g.width;
      const j = (k - i) / g.width;
      if (i === 0 || j === 0 || i === g.width - 1 || j === g.height - 1) edge = true;
      for (let dj = -1; dj <= 1; dj++) {
        for (let di = -1; di <= 1; di++) {
          const ni = i + di;
          const nj = j + dj;
          if (ni < 0 || nj < 0 || ni >= g.width || nj >= g.height) continue;
          const nk = nj * g.width + ni;
          if (land[nk] === 1 && !seen[nk]) {
            seen[nk] = 1;
            stack[top++] = nk;
          }
        }
      }
    }
    if (!edge && members.length < minIslandCells) for (const k of members) land[k] = 0;
  }
  return land;
}

// ---- Contours --------------------------------------------------------------------------

/**
 * Traces the zero level of `field` (sampled at cell centers) into closed rings, with the
 * positive side ("inside") on the left. The grid is padded with `outside`'s sign, so rings
 * close along the grid edge. Where two inside cells touch only at a corner they stay apart
 * (the negative side connects), which matches lakeMask's 4-connected water.
 *
 * With the inside on the left, a ring around an inside region runs counter-clockwise
 * (positive area, y north) and a ring around an outside region runs clockwise.
 */
export function traceRings(g: CellGrid, field: Float32Array, outsideValue: number): Pt[][] {
  const W = g.width + 2;
  const H = g.height + 2;
  const v = (i: number, j: number): number => {
    const ci = i - 1;
    const cj = j - 1;
    if (ci < 0 || cj < 0 || ci >= g.width || cj >= g.height) return outsideValue;
    return field[cj * g.width + ci] as number;
  };
  const pos = (i: number, j: number): Pt => cellCenter(g, i - 1, j - 1);
  const inside = (i: number, j: number) => v(i, j) > 0;

  // Edge ids: horizontal edge between (i, j) and (i+1, j) is 2·(j·W + i); vertical edge
  // between (i, j) and (i, j+1) is 2·(j·W + i) + 1.
  const hEdge = (i: number, j: number) => 2 * (j * W + i);
  const vEdge = (i: number, j: number) => 2 * (j * W + i) + 1;
  const crossing = (i0: number, j0: number, i1: number, j1: number): Pt => {
    const a = v(i0, j0);
    const b = v(i1, j1);
    const t = a / (a - b);
    const p = pos(i0, j0);
    const q = pos(i1, j1);
    return { x: p.x + (q.x - p.x) * t, y: p.y + (q.y - p.y) * t };
  };

  const next = new Map<number, number>();
  const point = new Map<number, Pt>();
  const addSegment = (from: number, fromPt: Pt, to: number, toPt: Pt) => {
    next.set(from, to);
    point.set(from, fromPt);
    point.set(to, toPt);
  };

  for (let j = 0; j < H - 1; j++) {
    for (let i = 0; i < W - 1; i++) {
      // Corners: a = NW (i, j), b = NE (i+1, j), c = SE (i+1, j+1), d = SW (i, j+1).
      const a = inside(i, j);
      const b = inside(i + 1, j);
      const c = inside(i + 1, j + 1);
      const d = inside(i, j + 1);
      if (a === b && b === c && c === d) continue;
      // Edges around the square, clockwise from the north: N (a–b), E (b–c), S (d–c), W (a–d).
      const N = { id: hEdge(i, j), p: () => crossing(i, j, i + 1, j) };
      const E = { id: vEdge(i + 1, j), p: () => crossing(i + 1, j, i + 1, j + 1) };
      const S = { id: hEdge(i, j + 1), p: () => crossing(i, j + 1, i + 1, j + 1) };
      const Wd = { id: vEdge(i, j), p: () => crossing(i, j, i, j + 1) };
      type Edge = typeof N;
      const seg = (from: Edge, to: Edge) => addSegment(from.id, from.p(), to.id, to.p());
      // Segments run with the inside corners on their left. A lone inside corner is cut
      // off on its own (so diagonal inside corners stay apart); a lone outside corner is
      // cut off the same way, reversed.
      const key = (a ? 8 : 0) | (b ? 4 : 0) | (c ? 2 : 0) | (d ? 1 : 0);
      switch (key) {
        case 8:
          seg(Wd, N);
          break; // a
        case 4:
          seg(N, E);
          break; // b
        case 2:
          seg(E, S);
          break; // c
        case 1:
          seg(S, Wd);
          break; // d
        case 12:
          seg(Wd, E);
          break; // a b
        case 6:
          seg(N, S);
          break; // b c
        case 3:
          seg(E, Wd);
          break; // c d
        case 9:
          seg(S, N);
          break; // a d
        case 7:
          seg(N, Wd);
          break; // b c d: outside a
        case 11:
          seg(E, N);
          break; // a c d: outside b
        case 13:
          seg(S, E);
          break; // a b d: outside c
        case 14:
          seg(Wd, S);
          break; // a b c: outside d
        case 10:
          seg(Wd, N);
          seg(E, S);
          break; // a, c apart
        case 5:
          seg(N, E);
          seg(S, Wd);
          break; // b, d apart
      }
    }
  }

  const rings: Pt[][] = [];
  const done = new Set<number>();
  for (const startId of next.keys()) {
    if (done.has(startId)) continue;
    const ring: Pt[] = [];
    let id = startId;
    while (!done.has(id)) {
      done.add(id);
      ring.push(point.get(id) as Pt);
      const n = next.get(id);
      if (n === undefined) throw new Error('Open contour: the field has a gap');
      id = n;
    }
    if (id !== startId) throw new Error('Contour rejoined itself midway');
    rings.push(ring);
  }
  return rings;
}

/** Shoelace area, positive counter-clockwise (y north). */
export function signedArea(ring: readonly Pt[]): number {
  let s = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[j] as Pt;
    const b = ring[i] as Pt;
    s += a.x * b.y - b.x * a.y;
  }
  return s / 2;
}

// ---- Simplification --------------------------------------------------------------------

/**
 * Simplifies every ring at `tolerance`, then halves the tolerance on any ring that now
 * crosses itself or another ring, until none do (at zero they are the traced contours,
 * which never cross). Returns the rings and the tolerance each ended at.
 */
export function simplifyRings(
  rings: readonly Pt[][],
  tolerance: number,
  minTolerance = tolerance / 16,
): { rings: Pt[][]; tolerances: number[] } {
  const tol = rings.map(() => tolerance);
  const out = rings.map((r) => simplifyRing(r, tolerance));
  for (let pass = 0; pass < 12; pass++) {
    const bad = crossingRings(out);
    if (bad.size === 0) break;
    for (const k of bad) {
      const t = (tol[k] as number) / 2;
      tol[k] = t < minTolerance ? 0 : t;
      out[k] = simplifyRing(rings[k] as Pt[], tol[k] as number);
    }
  }
  return { rings: out, tolerances: tol };
}

/** Indexes of rings with an edge that properly crosses another edge (theirs or another ring's). */
export function crossingRings(rings: readonly Pt[][]): Set<number> {
  // Bucket edges on a coarse grid sized to the average edge length.
  interface E {
    r: number;
    k: number;
    a: Pt;
    b: Pt;
  }
  const edges: E[] = [];
  let total = 0;
  rings.forEach((ring, r) => {
    for (let k = 0; k < ring.length; k++) {
      const a = ring[k] as Pt;
      const b = ring[(k + 1) % ring.length] as Pt;
      edges.push({ r, k, a, b });
      total += Math.hypot(b.x - a.x, b.y - a.y);
    }
  });
  const cell = Math.max((total / Math.max(edges.length, 1)) * 4, 1);
  const buckets = new Map<string, E[]>();
  for (const e of edges) {
    const i0 = Math.floor(Math.min(e.a.x, e.b.x) / cell);
    const i1 = Math.floor(Math.max(e.a.x, e.b.x) / cell);
    const j0 = Math.floor(Math.min(e.a.y, e.b.y) / cell);
    const j1 = Math.floor(Math.max(e.a.y, e.b.y) / cell);
    for (let i = i0; i <= i1; i++) {
      for (let j = j0; j <= j1; j++) {
        const key = `${i},${j}`;
        let list = buckets.get(key);
        if (!list) buckets.set(key, (list = []));
        list.push(e);
      }
    }
  }
  const bad = new Set<number>();
  for (const list of buckets.values()) {
    for (let x = 0; x < list.length; x++) {
      const e = list[x] as E;
      for (let y = x + 1; y < list.length; y++) {
        const f = list[y] as E;
        if (e.r === f.r) {
          const n = (rings[e.r] as Pt[]).length;
          const d = Math.abs(e.k - f.k);
          if (d <= 1 || d === n - 1) continue; // neighbours share a vertex
        }
        if (properCross(e.a, e.b, f.a, f.b)) {
          bad.add(e.r);
          bad.add(f.r);
        }
      }
    }
  }
  return bad;
}

function orient(a: Pt, b: Pt, c: Pt): number {
  return (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
}

/** True when segments ab and cd touch anywhere (shared vertices of neighbours are excluded by the caller). */
function properCross(a: Pt, b: Pt, c: Pt, d: Pt): boolean {
  const d1 = orient(c, d, a);
  const d2 = orient(c, d, b);
  const d3 = orient(a, b, c);
  const d4 = orient(a, b, d);
  if (((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))) {
    return true;
  }
  const on = (p: Pt, q: Pt, r: Pt) =>
    Math.min(p.x, q.x) <= r.x &&
    r.x <= Math.max(p.x, q.x) &&
    Math.min(p.y, q.y) <= r.y &&
    r.y <= Math.max(p.y, q.y);
  return (
    (d1 === 0 && on(c, d, a)) ||
    (d2 === 0 && on(c, d, b)) ||
    (d3 === 0 && on(a, b, c)) ||
    (d4 === 0 && on(a, b, d))
  );
}

/** Even-odd point in ring. */
export function pointInRing(p: Pt, ring: readonly Pt[]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i] as Pt;
    const b = ring[j] as Pt;
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) {
      inside = !inside;
    }
  }
  return inside;
}

/** Averages k × k blocks (a coarser grid for depth contours). */
export function blockAverage(
  g: CellGrid,
  data: Float32Array,
  k: number,
): { grid: CellGrid; data: Float32Array } {
  const width = Math.floor(g.width / k);
  const height = Math.floor(g.height / k);
  const out = new Float32Array(width * height);
  for (let j = 0; j < height; j++) {
    for (let i = 0; i < width; i++) {
      let s = 0;
      for (let dj = 0; dj < k; dj++) {
        for (let di = 0; di < k; di++) s += data[(j * k + dj) * g.width + i * k + di] as number;
      }
      out[j * width + i] = s / (k * k);
    }
  }
  return { grid: { width, height, cellM: g.cellM * k, x0: g.x0, y1: g.y1 }, data: out };
}
