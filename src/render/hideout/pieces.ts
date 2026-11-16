import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { PALETTE } from '../style/palette';
import { box, frustum, part, strut } from '../style/parts';

/**
 * The hideout kit drawn (plan 09 §5, §10; plan 14 §13; Phase 8 piece B): every buildable
 * piece as procedural low-poly geometry in the docks kit's vertex-colored style, built once
 * per piece and material and drawn instanced. Each builder works in the piece's own frame:
 *
 * - x across, y up, z deep; the piece's front (an edge's outside) faces -z at rot 0.
 * - Cells, water pieces and roofs are centered on their footprint (2 m cells).
 * - Edges are centered on the cell edge: 2 m along x, the wall's thickness across z.
 * - Foundations and piers have their top (the walking surface) at y 0; floors sit 2 cm
 *   proud of it. Walls stand from y 0 to WALL_H_M, so the floor above sits on them.
 * - Roof pieces start at their eave, y 0, and rise at ROOF_PITCH toward +z.
 *
 * Lamp glass and lit windows go to `lit`: one `glow` vertex attribute marks them, so a
 * piece is one geometry, glass and all, and a hideout costs one draw call per piece type
 * and material (plan 09 §10's ≤ 80). Grid ids, footprints and rules are piece A's
 * (`data/structures.json`); this file only draws them.
 */

export const CELL_M = 2;
export const LEVEL_M = 3;
/** Walls stop under the next level's floor. */
export const WALL_H_M = 2.92;
export const WALL_T_M = 0.2;
/** Roof rise per meter of run: 1.2 m across a cell. */
export const ROOF_PITCH = 0.6;
export const ROOF_RISE_M = ROOF_PITCH * CELL_M;
/** A foundation's body below its top; `extendM` reaches further, to the ground. */
export const FOUNDATION_M = 0.6;
/** A pier deck and its stringers below its top; its posts reach `extendM` below that. */
export const PIER_DECK_M = 0.35;
const DOOR_W = 1.1;
const DOOR_H = 2.2;
const WIN_W = 1.0;
const WIN_SILL = 0.9;
const WIN_HEAD = 2.1;
const EAVE_M = 0.3;

export type HideoutMaterial =
  'timber' | 'log' | 'plank' | 'brownstone' | 'tarpaper' | 'flagstone' | 'shingle' | 'turf';

export interface Shade {
  main: number;
  dark: number;
  light: number;
}

/** Each material's three tones. Brownstone is Lake Superior's red-brown sandstone. */
export const SHADES: Record<HideoutMaterial, Shade> = {
  timber: { main: 0x6e5440, dark: 0x4b3a2c, light: 0x8d6e52 },
  log: { main: 0x76593f, dark: 0x4f3b2a, light: 0xa88a62 },
  plank: { main: 0x8c7459, dark: 0x5d4a3a, light: 0xa69071 },
  brownstone: { main: 0x84503e, dark: 0x5e392c, light: 0xa0806c },
  tarpaper: { main: 0x3a3834, dark: 0x262522, light: 0x6b5644 },
  flagstone: { main: 0x8a857c, dark: 0x67635b, light: 0xa39e93 },
  shingle: { main: 0x6b4a33, dark: 0x4c3424, light: 0x86603f },
  turf: { main: 0x5f6d3c, dark: 0x45502b, light: 0x7d8c4d },
};

const IRON = 0x2c2b2a;
const RUST = 0x5a3a2a;
const COPPER = 0xb0683a;
const BRASS = 0xb8a25a;
const LAMP = PALETTE.lampAmber;
const WINDOW = PALETTE.windowAmber;
const FIRE = 0xe0662c;
const SIGNAL = 0xd8452e;
const WOOL = 0x8f8778;
const BLANKET = 0x8a3a30;
const CRATE = 0x9b7d55;
const BARREL = 0x7b5a3a;
const SACK = 0xc8b998;
const ROPE = 0xa48a5c;
const WATER = 0x1f2f36;
const BRUSH = [0x55603a, 0x4a5530, 0x6b6a3c] as const;
const PAINT_WHITE = 0xe2dccb;
const GILT = 0xc8a24a;

export type Placement = 'cell' | 'edge' | 'roof' | 'prop' | 'water';
export type Category =
  | 'foundation'
  | 'floor'
  | 'wall'
  | 'opening'
  | 'roof'
  | 'stairs'
  | 'water'
  | 'fence'
  | 'storage'
  | 'utility'
  | 'light'
  | 'station'
  | 'decor';

export interface Sink {
  body: THREE.BufferGeometry[];
  /** Glass that glows after dusk. */
  lit: THREE.BufferGeometry[];
}

export interface LampDef {
  /** In the piece's frame. */
  x: number;
  y: number;
  z: number;
  radiusM: number;
  color: number;
}

export interface PieceDef {
  readonly id: string;
  readonly name: string;
  readonly category: Category;
  readonly placement: Placement;
  /** Cells across x and z (plan 09 §4.2). */
  readonly footprint: readonly [number, number];
  /** The first is the default. */
  readonly materials: readonly HideoutMaterial[];
  readonly lamp?: LampDef;
  /**
   * How `extendM` reaches down: a footing under the body (foundations), posts under a deck
   * (piers), or the whole piece (a piling). `top` is how far below y 0 the extension starts.
   * With `byRise`, it reaches down by the piece's `riseM` instead: the wall under a gable
   * that sits up a wide roof's slope. With `repeatM`, the extension is that tall and is
   * stacked rather than stretched (so logs and courses keep their size).
   */
  readonly extend?: {
    top: number;
    byRise?: boolean;
    repeatM?: number;
    build(s: Shade, out: Sink): void;
  };
  build(s: Shade, out: Sink): void;
  /** The distant view's stand-in; defaults to the body's bounding box (plan 09 §10). */
  proxy?(s: Shade, out: Sink): void;
}

// --- Helpers ---------------------------------------------------------------------------

function hash(n: number): number {
  const s = Math.sin(n * 12.9898) * 43758.5453;
  return s - Math.floor(s);
}

function cyl(r: number, h: number, sides: number, x: number, y: number, z: number, c: number) {
  return frustum(r, r, h, sides, x, y, z, c);
}

/** A horizontal cylinder along x, its axis at (y, z). */
function logX(r: number, len: number, sides: number, x: number, y: number, z: number, c: number) {
  const g = part(new THREE.CylinderGeometry(r, r, len, sides, 1), c);
  return g.rotateZ(Math.PI / 2).translate(x, y, z);
}

/** A prism from a polygon in the x-y plane, `depth` thick across z, centered on `z`. */
function prismXY(points: readonly [number, number][], depth: number, z: number, c: number) {
  const shape = new THREE.Shape(points.map(([x, y]) => new THREE.Vector2(x, y)));
  const g = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: false });
  return part(g, c).translate(0, 0, z - depth / 2);
}

/** A board from a to b (centers), w wide across its length's horizontal normal, t thick. */
function beam(
  a: THREE.Vector3,
  b: THREE.Vector3,
  w: number,
  t: number,
  c: number,
): THREE.BufferGeometry {
  const len = a.distanceTo(b);
  const g = part(new THREE.BoxGeometry(w, t, len), c);
  const m = new THREE.Matrix4().lookAt(b, a, new THREE.Vector3(0, 1, 0));
  g.applyMatrix4(m);
  const mid = a.clone().add(b).multiplyScalar(0.5);
  return g.translate(mid.x, mid.y, mid.z);
}

const v = (x: number, y: number, z: number): THREE.Vector3 => new THREE.Vector3(x, y, z);

/** Triangles from a flat list of corners, with face normals: for the hip roof. */
function tris(points: readonly THREE.Vector3[], c: number): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  const pos: number[] = [];
  for (const p of points) pos.push(p.x, p.y, p.z);
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.computeVertexNormals();
  return part(g, c);
}

function barrel(out: THREE.BufferGeometry[], x: number, y: number, z: number, scale = 1): void {
  const r = 0.3 * scale;
  const h = 0.9 * scale;
  out.push(frustum(r, r * 0.86, h / 2, 8, x, y, z, BARREL));
  out.push(frustum(r * 0.86, r, h / 2, 8, x, y + h / 2, z, BARREL));
  out.push(cyl(r * 1.01, 0.05, 8, x, y + h * 0.2, z, IRON));
  out.push(cyl(r * 1.01, 0.05, 8, x, y + h * 0.75, z, IRON));
}

function crate(out: THREE.BufferGeometry[], s: number, x: number, y: number, z: number, k = 0) {
  out.push(box(s, s, s, x, y, z, k % 2 ? 0x8a6c47 : CRATE));
  out.push(box(s + 0.02, 0.07, s + 0.02, x, y + s * 0.12, z, 0x5d4a3a));
  out.push(box(s + 0.02, 0.07, s + 0.02, x, y + s * 0.8, z, 0x5d4a3a));
}

// --- Walls -----------------------------------------------------------------------------

/**
 * A rectangle of wall in the material: logs, clapboard, coursed brownstone or tarpaper
 * with battens. Detail goes on the outside face (-z) only, so a wall turned 180° is the
 * same piece from the other side.
 */
function wallFill(
  mat: HideoutMaterial,
  s: Shade,
  x0: number,
  x1: number,
  y0: number,
  y1: number,
  out: THREE.BufferGeometry[],
): void {
  const w = x1 - x0;
  const h = y1 - y0;
  if (w <= 0.01 || h <= 0.01) return;
  const cx = (x0 + x1) / 2;
  const half = WALL_T_M / 2;
  switch (mat) {
    case 'log': {
      // Chinking behind, then round logs; full-width logs run past the corner, notched.
      out.push(box(w, h, WALL_T_M * 0.6, cx, y0, 0, s.light));
      const n = Math.max(1, Math.round(h / 0.32));
      const step = h / n;
      const full = w > 2.1;
      for (let k = 0; k < n; k++) {
        const len = full ? w + 0.3 : w;
        out.push(logX(0.16, len, 6, cx, y0 + step * (k + 0.5), 0, k % 2 ? s.main : s.dark));
      }
      break;
    }
    case 'plank': {
      out.push(box(w, h, WALL_T_M * 0.8, cx, y0, 0, s.main));
      for (let y = y0 + 0.24; y < y1 - 0.05; y += 0.24)
        out.push(box(w, 0.025, 0.02, cx, y, -half * 0.8 - 0.005, s.dark));
      break;
    }
    case 'brownstone': {
      out.push(box(w, h, WALL_T_M + 0.06, cx, y0, 0, s.main));
      let row = 0;
      for (let y = y0 + 0.4; y < y1 - 0.05; y += 0.4, row++) {
        out.push(box(w, 0.03, 0.02, cx, y, -half - 0.035, s.light));
        // Staggered head joints, one or two per course.
        for (let x = x0 + (row % 2 ? 0.35 : 0.75); x < x1 - 0.1; x += 0.8)
          out.push(box(0.03, 0.4, 0.02, x, y - 0.4, -half - 0.035, s.light));
      }
      break;
    }
    default: {
      // Tarpaper over sheathing, held by wood battens.
      out.push(box(w, h, WALL_T_M * 0.6, cx, y0, 0, s.main));
      for (let x = x0 + 0.3; x < x1 - 0.1; x += 0.6)
        out.push(box(0.06, h, 0.03, x, y0, -WALL_T_M * 0.3 - 0.01, s.light));
      out.push(box(w, 0.06, 0.03, cx, y1 - 0.08, -WALL_T_M * 0.3 - 0.01, s.light));
      break;
    }
  }
}

function frame(out: THREE.BufferGeometry[], x0: number, x1: number, y0: number, y1: number): void {
  const t = WALL_T_M + 0.1;
  const c = 0x5d4a3a;
  out.push(box(0.08, y1 - y0, t, x0 - 0.04, y0, 0, c));
  out.push(box(0.08, y1 - y0, t, x1 + 0.04, y0, 0, c));
  out.push(box(x1 - x0 + 0.16, 0.08, t, (x0 + x1) / 2, y1, 0, c));
}

const WALL_MATERIALS = ['plank', 'log', 'brownstone', 'tarpaper'] as const;
const ROOF_MATERIALS = ['shingle', 'plank', 'tarpaper', 'turf'] as const;
const L = CELL_M / 2 + WALL_T_M / 2;

/** Pieces that know their own material (walls need it for the fill's pattern). */
function walls(): PieceDef[] {
  const defs: PieceDef[] = [];
  const add = (
    id: string,
    name: string,
    fill: (m: HideoutMaterial, s: Shade, out: THREE.BufferGeometry[]) => void,
    gable = false,
  ): void => {
    defs.push({
      id,
      name,
      category: 'wall',
      placement: 'edge',
      footprint: [1, 0],
      materials: WALL_MATERIALS,
      build: (s, out) => fill(materialOf(s), s, out.body),
      // A gable up a wide roof's slope stands on wall down to the eave, a course at a time.
      ...(gable
        ? {
            extend: {
              top: 0,
              byRise: true,
              repeatM: ROOF_RISE_M,
              build: (s: Shade, out: Sink) =>
                wallFill(materialOf(s), s, -L, L, -ROOF_RISE_M, 0, out.body),
            },
          }
        : {}),
    });
  };
  add('build.wall', 'Wall', (m, s, out) => wallFill(m, s, -L, L, 0, WALL_H_M, out));
  add('build.wall_half', 'Half wall', (m, s, out) => {
    wallFill(m, s, -L, L, 0, 1.1, out);
    out.push(box(2 * L, 0.06, WALL_T_M + 0.1, 0, 1.1, 0, SHADES.plank.dark));
  });
  add('build.wall_door', 'Wall with door frame', (m, s, out) => {
    const d = DOOR_W / 2;
    wallFill(m, s, -L, -d, 0, WALL_H_M, out);
    wallFill(m, s, d, L, 0, WALL_H_M, out);
    wallFill(m, s, -d, d, DOOR_H, WALL_H_M, out);
    frame(out, -d, d, 0, DOOR_H);
  });
  add('build.wall_window', 'Wall with window frame', (m, s, out) => {
    const d = WIN_W / 2;
    wallFill(m, s, -L, -d, 0, WALL_H_M, out);
    wallFill(m, s, d, L, 0, WALL_H_M, out);
    wallFill(m, s, -d, d, 0, WIN_SILL, out);
    wallFill(m, s, -d, d, WIN_HEAD, WALL_H_M, out);
    frame(out, -d, d, WIN_SILL, WIN_HEAD);
    out.push(box(WIN_W + 0.3, 0.06, WALL_T_M + 0.16, 0, WIN_SILL - 0.06, -0.03, 0x5d4a3a));
  });
  // Gable infills: the triangle under a roof's slope (low at -x) or under a ridge cell.
  const gableFill = (m: HideoutMaterial, s: Shade, pts: [number, number][]) => {
    const c = m === 'brownstone' ? s.main : m === 'log' ? s.dark : s.main;
    const g = prismXY(pts, WALL_T_M * 0.8, 0, c);
    // Barge boards along the sloped edges, on the outside face.
    const trim: THREE.BufferGeometry[] = [];
    for (let k = 0; k < pts.length; k++) {
      const [ax, ay] = pts[k] as [number, number];
      const [bx, by] = pts[(k + 1) % pts.length] as [number, number];
      if (Math.abs(ax - bx) < 1e-3 || Math.abs(ay - by) < 1e-3) continue;
      trim.push(
        beam(
          v(ax, ay + 0.04, -WALL_T_M / 2 - 0.02),
          v(bx, by + 0.04, -WALL_T_M / 2 - 0.02),
          0.04,
          0.16,
          s.dark,
        ),
      );
    }
    return [g, ...trim];
  };
  add(
    'build.wall_gable',
    'Gable end',
    (m, s, out) =>
      out.push(
        ...gableFill(m, s, [
          [-L, 0],
          [L, 0],
          [L, ROOF_RISE_M + (WALL_T_M / 2) * ROOF_PITCH],
        ]),
      ),
    true,
  );
  add(
    'build.wall_gable_peak',
    'Gable peak',
    (m, s, out) =>
      out.push(
        ...gableFill(m, s, [
          [-L, 0],
          [L, 0],
          [0, ROOF_RISE_M / 2],
        ]),
      ),
    true,
  );
  return defs;
}

/** Which material a shade is (walls draw their own pattern). */
function materialOf(s: Shade): HideoutMaterial {
  for (const [k, v] of Object.entries(SHADES)) if (v === s) return k as HideoutMaterial;
  return 'plank';
}

// --- Roofs -----------------------------------------------------------------------------

/**
 * A plane of roof from a low edge (zLow, yLow) to a high one, x0..x1 wide, with the
 * material's courses: shingle rows, plank boards down the slope, tarpaper battens, sod.
 */
function slope(
  m: HideoutMaterial,
  s: Shade,
  x0: number,
  x1: number,
  zLow: number,
  yLow: number,
  zHigh: number,
  yHigh: number,
  out: THREE.BufferGeometry[],
): void {
  const t = m === 'turf' ? 0.22 : 0.12;
  const w = x1 - x0;
  const cx = (x0 + x1) / 2;
  const dir = Math.sign(zHigh - zLow);
  const len = Math.hypot(zHigh - zLow, yHigh - yLow);
  const angle = Math.atan2(yHigh - yLow, Math.abs(zHigh - zLow));
  // The slab's top face runs along the line; it hangs t below.
  const slab = (ww: number, tt: number, along: number, lift: number, c: number, xc = cx) => {
    const g = part(new THREE.BoxGeometry(ww, tt, along), c);
    g.translate(0, -tt / 2 + lift, 0);
    g.rotateX(dir > 0 ? -angle : angle);
    const mz = (zLow + zHigh) / 2;
    const my = (yLow + yHigh) / 2;
    return g.translate(xc, my, mz);
  };
  out.push(slab(w, t, len, 0, m === 'turf' ? s.dark : s.main));
  switch (m) {
    case 'shingle': {
      // Shingle courses: a strip every 0.4 m up the slope.
      for (let k = 1; k * 0.4 < len; k++) {
        const f = (k * 0.4) / len;
        const g = part(new THREE.BoxGeometry(w, 0.035, 0.05), s.dark);
        g.rotateX(dir > 0 ? -angle : angle);
        g.translate(cx, yLow + (yHigh - yLow) * f + 0.01, zLow + (zHigh - zLow) * f);
        out.push(g);
      }
      break;
    }
    case 'plank':
      for (let x = x0 + 0.25; x < x1 - 0.05; x += 0.5)
        out.push(slab(0.04, 0.03, len, 0.02, s.dark, x));
      break;
    case 'tarpaper':
      for (let x = x0 + 0.5; x < x1 - 0.05; x += 1)
        out.push(slab(0.05, 0.04, len, 0.03, s.light, x));
      break;
    case 'turf': {
      out.push(slab(w, 0.1, len - 0.1, 0.06, s.main));
      break;
    }
    default:
      break;
  }
}

function roofs(): PieceDef[] {
  const defs: PieceDef[] = [];
  const add = (
    id: string,
    name: string,
    build: (m: HideoutMaterial, s: Shade, out: Sink) => void,
    proxy?: (m: HideoutMaterial, s: Shade, out: Sink) => void,
    footprint: readonly [number, number] = [1, 1],
  ): void => {
    defs.push({
      id,
      name,
      category: 'roof',
      placement: 'roof',
      footprint,
      materials: ROOF_MATERIALS,
      build: (s, out) => build(materialOf(s), s, out),
      ...(proxy ? { proxy: (s: Shade, out: Sink) => proxy(materialOf(s), s, out) } : {}),
    });
  };
  const h = CELL_M / 2;
  const plain = (m: HideoutMaterial): HideoutMaterial => (m === 'turf' ? 'turf' : 'tarpaper');
  const slopeAll = (m: HideoutMaterial, s: Shade, out: THREE.BufferGeometry[], simple = false) =>
    slope(simple ? plain(m) : m, s, -h, h, -h - EAVE_M, -EAVE_M * ROOF_PITCH, h, ROOF_RISE_M, out);
  add(
    'build.roof_slope',
    'Roof slope',
    (m, s, out) => slopeAll(m, s, out.body),
    (m, s, out) => {
      const b: THREE.BufferGeometry[] = [];
      slope('tarpaper', s, -h, h, -h - EAVE_M, -EAVE_M * ROOF_PITCH, h, ROOF_RISE_M, b);
      out.body.push(b[0] as THREE.BufferGeometry);
      for (const g of b.slice(1)) g.dispose();
    },
  );
  const ridge = (m: HideoutMaterial, s: Shade, out: THREE.BufferGeometry[]) => {
    slope(m, s, -h, h, -h, 0, 0, ROOF_RISE_M / 2, out);
    slope(m, s, -h, h, h, 0, 0, ROOF_RISE_M / 2, out);
    out.push(box(CELL_M, 0.1, 0.24, 0, ROOF_RISE_M / 2 - 0.02, 0, s.dark));
  };
  add('build.roof_ridge', 'Roof ridge', (m, s, out) => ridge(m, s, out.body));
  add('build.roof_lean', 'Lean-to roof', (m, s, out) =>
    slope(m, s, -h, h, -h - EAVE_M, -EAVE_M * 0.4, h, CELL_M * 0.4, out.body),
  );
  add('build.roof_corner', 'Hip corner', (_m, s, out) => {
    // Two faces meeting on the hip: low along -z and -x (with the eave), high at +x+z.
    const e = h + EAVE_M;
    const ey = -EAVE_M * ROOF_PITCH;
    const t = 0.12;
    const a = v(-e, ey, -e);
    const b = v(h, ey, -e);
    const c = v(h, ROOF_RISE_M, h);
    const d = v(-e, ey, h);
    const down = (p: THREE.Vector3) => p.clone().setY(p.y - t);
    out.body.push(tris([a, c, b, a, d, c], s.main));
    out.body.push(tris([down(a), down(b), down(c), down(a), down(c), down(d)], s.dark));
    out.body.push(
      beam(a.clone().setY(ey + 0.04), c.clone().setY(ROOF_RISE_M + 0.04), 0.2, 0.08, s.dark),
    );
  });
  add('build.roof_flat', 'Flat roof', (m, s, out) => {
    const top = m === 'turf' ? s.main : m === 'plank' ? s.main : SHADES.tarpaper.dark;
    out.body.push(box(CELL_M + 0.02, 0.18, CELL_M + 0.02, 0, -0.06, 0, top));
    out.body.push(box(CELL_M + 0.1, 0.12, 0.12, 0, 0.06, -h, s.dark));
  });
  add('build.dormer', 'Dormer', (m, s, out) => {
    slopeAll(m, s, out.body);
    // A boxed window out of the slope with its own little gable.
    const wall = SHADES.plank;
    out.body.push(box(1.1, 1.25, 1.2, 0, 0, -0.75, wall.main));
    out.body.push(box(0.9, 0.06, 0.1, 0, 0.3, -1.38, wall.dark));
    out.lit.push(box(0.7, 0.7, 0.04, 0, 0.36, -1.36, WINDOW));
    out.body.push(box(0.05, 0.7, 0.06, 0, 0.36, -1.37, wall.dark));
    const roof = prismXY(
      [
        [-0.75, 0],
        [0.75, 0],
        [0, 0.55],
      ],
      1.5,
      0,
      s.main,
    );
    out.body.push(roof.translate(0, 1.2, -0.7));
  });
  defs.push({
    id: 'build.chimney',
    name: 'Chimney',
    category: 'roof',
    placement: 'roof',
    footprint: [1, 1],
    materials: ['brownstone'],
    build: (s, out) => {
      out.body.push(box(0.75, 2.8, 0.75, 0, -0.4, 0.3, s.main));
      for (let y = 0; y < 2.4; y += 0.4) out.body.push(box(0.77, 0.03, 0.77, 0, y, 0.3, s.light));
      out.body.push(box(0.9, 0.12, 0.9, 0, 2.4, 0.3, s.dark));
      out.body.push(box(0.4, 0.06, 0.4, 0, 2.52, 0.3, 0x1c1a18));
    },
  });
  return defs;
}

// --- The catalog ------------------------------------------------------------------------

function foundationExtend(s: Shade, out: Sink): void {
  // A unit-tall block from y -1 to 0; scaled by extendM and set under the body.
  out.body.push(box(CELL_M, 1, CELL_M, 0, -1, 0, s.dark));
}

function foundationBody(mat: 'timber' | 'brownstone', s: Shade, depth: number, out: Sink): void {
  out.body.push(box(CELL_M, depth, CELL_M, 0, -depth, 0, s.main));
  const h = CELL_M / 2;
  if (mat === 'brownstone') {
    for (let y = -depth + 0.3; y < -0.05; y += 0.3)
      for (const [w, d, z, x] of [
        [CELL_M + 0.02, 0.02, -h, 0],
        [CELL_M + 0.02, 0.02, h, 0],
        [0.02, CELL_M + 0.02, 0, -h],
        [0.02, CELL_M + 0.02, 0, h],
      ] as const)
        out.body.push(box(w, 0.025, d, x, y, z, s.light));
    out.body.push(box(CELL_M, 0.03, CELL_M, 0, -0.025, 0, SHADES.flagstone.main));
  } else {
    // Squared timbers laid in courses, a plank top.
    for (let y = -depth + 0.2; y < -0.05; y += 0.2)
      for (const [w, d, z, x] of [
        [CELL_M + 0.02, 0.02, -h, 0],
        [CELL_M + 0.02, 0.02, h, 0],
        [0.02, CELL_M + 0.02, 0, -h],
        [0.02, CELL_M + 0.02, 0, h],
      ] as const)
        out.body.push(box(w, 0.03, d, x, y, z, s.dark));
    out.body.push(box(CELL_M, 0.03, CELL_M, 0, -0.025, 0, SHADES.plank.light));
  }
}

function deck(s: Shade, out: Sink, curbs: readonly ('x-' | 'x+' | 'z-' | 'z+')[]): void {
  const h = CELL_M / 2;
  out.body.push(box(CELL_M, 0.1, CELL_M, 0, -0.1, 0, s.main));
  for (let x = -h + 0.25; x < h; x += 0.25)
    out.body.push(box(0.02, 0.01, CELL_M, x, -0.005, 0, s.dark));
  for (const x of [-0.6, 0.6])
    out.body.push(box(0.18, PIER_DECK_M - 0.1, CELL_M, x, -PIER_DECK_M, 0, s.dark));
  out.body.push(box(CELL_M, 0.2, 0.2, 0, -PIER_DECK_M, -h + 0.15, s.dark));
  out.body.push(box(CELL_M, 0.2, 0.2, 0, -PIER_DECK_M, h - 0.15, s.dark));
  for (const c of curbs) {
    if (c === 'x-' || c === 'x+')
      out.body.push(box(0.2, 0.16, CELL_M, (c === 'x-' ? -1 : 1) * (h - 0.1), 0, 0, s.light));
    else out.body.push(box(CELL_M, 0.16, 0.2, 0, 0, (c === 'z-' ? -1 : 1) * (h - 0.1), s.light));
  }
}

function pierPosts(s: Shade, out: Sink): void {
  for (const [x, z] of [
    [-0.85, -0.85],
    [0.85, -0.85],
    [-0.85, 0.85],
    [0.85, 0.85],
  ] as const)
    out.body.push(cyl(0.14, 1, 6, x, -1, z, s.dark));
}

const one: readonly [number, number] = [1, 1];
const prop = (
  id: string,
  name: string,
  category: Category,
  materials: readonly HideoutMaterial[],
  build: (s: Shade, out: Sink) => void,
  extra: Partial<Pick<PieceDef, 'lamp' | 'footprint' | 'placement'>> = {},
): PieceDef => ({
  id,
  name,
  category,
  placement: extra.placement ?? 'prop',
  footprint: extra.footprint ?? one,
  materials,
  ...(extra.lamp ? { lamp: extra.lamp } : {}),
  build,
});

function catalog(): PieceDef[] {
  const h = CELL_M / 2;
  const defs: PieceDef[] = [];

  // Foundations and floors.
  for (const [id, name, depth] of [
    ['build.foundation', 'Foundation', FOUNDATION_M],
    ['build.foundation_half', 'Low foundation', FOUNDATION_M / 2],
  ] as const) {
    defs.push({
      id,
      name,
      category: 'foundation',
      placement: 'cell',
      footprint: one,
      materials: ['timber', 'brownstone'],
      extend: { top: depth, build: foundationExtend },
      build: (s, out) => foundationBody(materialOf(s) as 'timber' | 'brownstone', s, depth, out),
    });
  }
  defs.push({
    id: 'build.foundation_stairs',
    name: 'Foundation steps',
    category: 'foundation',
    placement: 'cell',
    footprint: one,
    materials: ['timber', 'brownstone'],
    extend: { top: FOUNDATION_M, build: foundationExtend },
    build: (s, out) => {
      // Three steps up toward +z to the foundation's top.
      const run = CELL_M / 3;
      for (let k = 0; k < 3; k++) {
        const top = -FOUNDATION_M + (k + 1) * (FOUNDATION_M / 3);
        const z0 = -h + k * run;
        out.body.push(
          box(
            CELL_M,
            top + FOUNDATION_M,
            h - z0,
            0,
            -FOUNDATION_M,
            (z0 + h) / 2,
            k % 2 ? s.main : s.dark,
          ),
        );
        out.body.push(box(CELL_M, 0.03, run, 0, top - 0.02, z0 + run / 2, s.light));
      }
    },
  });
  defs.push({
    id: 'build.piling',
    name: 'Piling',
    category: 'foundation',
    placement: 'cell',
    footprint: one,
    materials: ['timber'],
    extend: { top: 0.12, build: (s, out) => out.body.push(cyl(0.2, 1, 7, 0, -1, 0, s.dark)) },
    build: (s, out) => {
      out.body.push(box(0.5, 0.12, 0.5, 0, -0.12, 0, s.main));
      out.body.push(cyl(0.22, 0.04, 7, 0, -0.16, 0, IRON));
    },
  });
  defs.push({
    id: 'build.floor',
    name: 'Floor',
    category: 'floor',
    placement: 'cell',
    footprint: one,
    materials: ['plank', 'flagstone'],
    build: (s, out) => {
      const stone = materialOf(s) === 'flagstone';
      out.body.push(box(CELL_M, 0.1, CELL_M, 0, -0.08, 0, s.main));
      if (stone) {
        for (const [x, z, w, d] of [
          [-0.5, -0.55, 0.96, 0.86],
          [0.5, -0.45, 0.96, 1.06],
          [-0.45, 0.45, 1.06, 1.06],
          [0.55, 0.55, 0.86, 0.86],
        ] as const)
          out.body.push(box(w, 0.012, d, x, 0.016, z, hash(x * 3 + z) < 0.5 ? s.light : s.main));
      } else {
        for (let x = -h + 0.25; x < h; x += 0.25)
          out.body.push(box(0.02, 0.01, CELL_M, x, 0.016, 0, s.dark));
        for (const x of [-0.5, 0.5]) out.body.push(box(0.12, 0.2, CELL_M, x, -0.28, 0, s.dark));
      }
    },
  });
  defs.push({
    id: 'build.trapdoor',
    name: 'Trapdoor',
    category: 'floor',
    placement: 'cell',
    footprint: one,
    materials: ['plank'],
    build: (s, out) => {
      out.body.push(box(CELL_M, 0.1, CELL_M, 0, -0.08, 0, s.main));
      for (const x of [-h + 0.25, h - 0.25])
        out.body.push(box(0.02, 0.01, CELL_M, x, 0.016, 0, s.dark));
      out.body.push(box(1.1, 0.03, 1.1, 0, 0.012, 0, s.light));
      for (const z of [-0.3, 0.3]) out.body.push(box(1.0, 0.02, 0.08, 0, 0.04, z, IRON));
      out.body.push(cyl(0.08, 0.02, 6, 0, 0.04, -0.45, IRON));
    },
  });
  defs.push({
    id: 'build.path_stones',
    name: 'Path stones',
    category: 'floor',
    placement: 'cell',
    footprint: one,
    materials: ['flagstone'],
    build: (s, out) => {
      for (let k = 0; k < 6; k++) {
        const x = (hash(k * 7.1) - 0.5) * 1.3;
        const z = -0.8 + k * 0.32;
        const g = cyl(0.22 + hash(k) * 0.1, 0.06, 6, x * 0.5, -0.03, z, k % 2 ? s.main : s.light);
        out.body.push(g.scale(1, 1, 0.75));
      }
    },
  });

  defs.push(...walls());
  defs.push({
    id: 'build.corner_post',
    name: 'Corner post',
    category: 'wall',
    placement: 'edge',
    footprint: [1, 0],
    materials: ['timber'],
    build: (s, out) => {
      out.body.push(box(0.3, WALL_H_M, 0.3, -h, 0, 0, s.main));
      out.body.push(box(0.36, 0.08, 0.36, -h, WALL_H_M - 0.1, 0, s.dark));
    },
  });

  // Openings: they go in the frames above.
  defs.push({
    id: 'build.door_plank',
    name: 'Plank door',
    category: 'opening',
    placement: 'edge',
    footprint: [1, 0],
    materials: ['plank'],
    build: (s, out) => {
      out.body.push(box(DOOR_W - 0.04, DOOR_H - 0.03, 0.06, 0, 0.01, 0, s.main));
      for (let x = -DOOR_W / 2 + 0.18; x < DOOR_W / 2 - 0.05; x += 0.18)
        out.body.push(box(0.015, DOOR_H - 0.05, 0.065, x, 0.02, 0, s.dark));
      for (const y of [0.3, 1.8]) out.body.push(box(DOOR_W - 0.12, 0.12, 0.04, 0, y, 0.05, s.dark));
      out.body.push(beam(v(-0.42, 0.42, 0.05), v(0.42, 1.8, 0.05), 0.1, 0.04, s.dark));
      out.body.push(box(0.05, 0.05, 0.1, 0.4, 1.05, -0.06, IRON));
    },
  });
  defs.push({
    id: 'build.door_iron',
    name: 'Iron-strapped door',
    category: 'opening',
    placement: 'edge',
    footprint: [1, 0],
    materials: ['timber'],
    build: (s, out) => {
      out.body.push(box(DOOR_W - 0.04, DOOR_H - 0.03, 0.09, 0, 0.01, 0, s.dark));
      for (const y of [0.25, 1.05, 1.85])
        out.body.push(box(DOOR_W - 0.06, 0.09, 0.11, 0, y, 0, IRON));
      for (const y of [0.25, 1.85]) out.body.push(cyl(0.05, 0.12, 6, -0.48, y - 0.01, -0.06, IRON));
      out.body.push(box(0.16, 0.24, 0.12, 0.36, 0.95, 0, RUST));
      out.body.push(box(0.03, 0.08, 0.13, 0.36, 1.0, 0, BRASS));
    },
  });
  defs.push({
    id: 'build.shutters',
    name: 'Shutters',
    category: 'opening',
    placement: 'edge',
    footprint: [1, 0],
    materials: ['plank'],
    build: (s, out) => {
      for (const sx of [-1, 1]) {
        const x = (sx * WIN_W) / 4;
        out.body.push(
          box(
            WIN_W / 2 - 0.03,
            WIN_HEAD - WIN_SILL - 0.02,
            0.05,
            x,
            WIN_SILL + 0.01,
            -0.14,
            s.main,
          ),
        );
        for (const y of [WIN_SILL + 0.2, WIN_HEAD - 0.3])
          out.body.push(box(WIN_W / 2 - 0.08, 0.08, 0.03, x, y, -0.17, s.dark));
      }
      out.body.push(box(0.12, 0.04, 0.04, 0, (WIN_SILL + WIN_HEAD) / 2, -0.19, IRON));
    },
  });
  defs.push({
    id: 'build.window_glazed',
    name: 'Glazed window',
    category: 'opening',
    placement: 'edge',
    footprint: [1, 0],
    materials: ['plank'],
    lamp: { x: 0, y: 1.5, z: 0.6, radiusM: 3, color: WINDOW },
    build: (s, out) => {
      out.lit.push(
        box(WIN_W - 0.04, WIN_HEAD - WIN_SILL - 0.02, 0.03, 0, WIN_SILL + 0.01, 0, WINDOW),
      );
      out.body.push(box(0.05, WIN_HEAD - WIN_SILL, 0.06, 0, WIN_SILL, 0, s.dark));
      out.body.push(box(WIN_W, 0.05, 0.06, 0, (WIN_SILL + WIN_HEAD) / 2, 0, s.dark));
    },
  });

  defs.push(...roofs());

  // Stairs and ladders.
  defs.push({
    id: 'build.stairs',
    name: 'Stairs',
    category: 'stairs',
    placement: 'cell',
    footprint: [1, 2],
    materials: ['plank'],
    build: (s, out) => {
      // Twelve steps up 3 m toward +z over two cells.
      const n = 12;
      const run = (2 * CELL_M) / n;
      const rise = LEVEL_M / n;
      for (let k = 0; k < n; k++) {
        const z = -CELL_M + (k + 0.5) * run;
        out.body.push(box(1.6, 0.05, run + 0.04, 0, (k + 1) * rise - 0.05, z, s.main));
        out.body.push(box(1.6, rise - 0.05, 0.03, 0, k * rise, z - run / 2 + 0.02, s.dark));
      }
      for (const x of [-0.84, 0.84]) {
        out.body.push(beam(v(x, -0.05, -CELL_M), v(x, LEVEL_M - 0.15, CELL_M), 0.08, 0.3, s.dark));
      }
      out.body.push(strut(v(0.84, 0.95, -CELL_M), v(0.84, LEVEL_M + 0.9, CELL_M), 0.03, s.light));
      out.body.push(box(0.06, 0.95, 0.06, 0.84, 0, -CELL_M + 0.05, s.dark));
    },
  });
  defs.push({
    id: 'build.ladder',
    name: 'Ladder',
    category: 'stairs',
    placement: 'edge',
    footprint: [1, 0],
    materials: ['timber'],
    build: (s, out) => {
      // Leaning out from the edge into the cell (+z), up to the floor above.
      for (const x of [-0.25, 0.25])
        out.body.push(beam(v(x, 0, 0.6), v(x, LEVEL_M + 0.8, 0.12), 0.06, 0.08, s.dark));
      for (let y = 0.3; y < LEVEL_M + 0.5; y += 0.3) {
        const z = 0.6 - (0.48 * y) / (LEVEL_M + 0.8);
        out.body.push(box(0.5, 0.04, 0.04, 0, y, z, s.main));
      }
    },
  });

  // On the water.
  const pier = (
    id: string,
    name: string,
    curbs: readonly ('x-' | 'x+' | 'z-' | 'z+')[],
    bollard = false,
  ) =>
    defs.push({
      id,
      name,
      category: 'water',
      placement: 'water',
      footprint: one,
      materials: ['timber'],
      extend: { top: PIER_DECK_M, build: pierPosts },
      build: (s, out) => {
        deck(s, out, curbs);
        if (bollard) {
          out.body.push(cyl(0.16, 0.6, 7, -h + 0.25, 0, -h + 0.25, s.dark));
          out.body.push(cyl(0.19, 0.06, 7, -h + 0.25, 0.6, -h + 0.25, s.dark));
        }
      },
    });
  pier('build.pier', 'Pier', ['x-', 'x+']);
  pier('build.pier_corner', 'Pier corner', ['x-', 'z-'], true);
  pier('build.pier_t', 'Pier T', ['x-']);
  defs.push({
    id: 'build.pier_ladder',
    name: 'Pier ladder',
    category: 'water',
    placement: 'edge',
    footprint: [1, 0],
    materials: ['timber'],
    build: (s, out) => {
      for (const x of [-0.28, 0.28]) out.body.push(box(0.07, 3.5, 0.07, x, -2.6, -0.16, s.dark));
      for (let y = -2.4; y < 0.8; y += 0.3)
        out.body.push(box(0.56, 0.04, 0.05, 0, y, -0.16, s.main));
    },
  });
  defs.push({
    id: 'build.mooring_post',
    name: 'Mooring post',
    category: 'water',
    placement: 'prop',
    footprint: one,
    materials: ['timber'],
    build: (s, out) => {
      out.body.push(cyl(0.2, 1.3, 7, 0, -0.4, 0, s.dark));
      out.body.push(cyl(0.23, 0.08, 7, 0, 0.9, 0, s.main));
      for (let k = 0; k < 3; k++)
        out.body.push(cyl(0.22 + k * 0.01, 0.05, 7, 0, 0.3 + k * 0.06, 0, ROPE));
    },
  });
  defs.push({
    id: 'build.slipway',
    name: 'Slipway',
    category: 'water',
    placement: 'water',
    footprint: [2, 4],
    materials: ['timber'],
    build: (s, out) => {
      // The ways run down toward +z into the water, a winch at the head.
      const z0 = -2 * CELL_M + 0.4;
      const z1 = 2 * CELL_M;
      const drop = 1.2;
      const yAt = (z: number) => -((z - z0) / (z1 - z0)) * drop;
      for (const x of [-0.9, 0.9]) {
        out.body.push(beam(v(x, -0.15, z0), v(x, yAt(z1) - 0.15, z1), 0.3, 0.3, s.main));
      }
      for (let z = z0 + 0.3; z < z1; z += 1) {
        out.body.push(box(2.6, 0.15, 0.25, 0, yAt(z) - 0.42, z, s.dark));
        for (const x of [-1.2, 0, 1.2])
          out.body.push(cyl(0.12, 2.2, 6, x, yAt(z) - 2.6, z, s.dark));
      }
      for (const z of [z0 + 1.5, z0 + 3.5, z0 + 5.5])
        out.body.push(box(0.6, 0.3, 0.5, 0, yAt(z) - 0.15, z, s.light));
      // The winch: a drum on two posts.
      for (const x of [-0.8, 0.8])
        out.body.push(box(0.18, 1.0, 0.18, x, 0, -2 * CELL_M + 0.1, s.dark));
      out.body.push(logX(0.2, 1.5, 8, 0, 0.75, -2 * CELL_M + 0.1, s.main));
      out.body.push(logX(0.21, 0.6, 8, 0, 0.75, -2 * CELL_M + 0.1, ROPE));
      out.body.push(box(0.05, 0.5, 0.05, 0.85, 0.75, -2 * CELL_M + 0.1, IRON));
    },
  });

  // Fences and the yard.
  const fence = (
    id: string,
    name: string,
    build: (s: Shade, out: Sink) => void,
    materials: readonly HideoutMaterial[] = ['timber'],
  ) =>
    defs.push({
      id,
      name,
      category: 'fence',
      placement: 'edge',
      footprint: [1, 0],
      materials,
      build,
    });
  fence('build.palisade', 'Palisade', (s, out) => {
    for (let k = 0; k < 8; k++) {
      const x = -h + (k + 0.5) * (CELL_M / 8);
      const ht = 2.5 + hash(k * 3.3) * 0.25;
      out.body.push(cyl(0.125, ht, 6, x, 0, 0, k % 2 ? s.main : s.dark));
      out.body.push(frustum(0, 0.125, 0.35, 6, x, ht, 0, s.light));
    }
    out.body.push(box(CELL_M, 0.14, 0.1, 0, 1.9, 0.16, s.dark));
    out.body.push(box(CELL_M, 0.14, 0.1, 0, 0.5, 0.16, s.dark));
  });
  fence('build.rail_fence', 'Rail fence', (s, out) => {
    out.body.push(box(0.14, 1.3, 0.14, -h, 0, 0, s.dark));
    for (const y of [0.45, 0.95])
      out.body.push(beam(v(-h, y, 0), v(h, y + 0.05, 0), 0.1, 0.12, s.main));
  });
  fence('build.gate', 'Gate', (s, out) => {
    for (const x of [-h, h]) out.body.push(box(0.18, 1.6, 0.18, x, 0, 0, s.dark));
    for (const y of [0.2, 0.7, 1.15])
      out.body.push(box(CELL_M - 0.25, 0.14, 0.06, 0, y, 0, s.main));
    out.body.push(beam(v(-0.85, 0.27, 0.05), v(0.85, 1.22, 0.05), 0.12, 0.05, s.main));
    out.body.push(box(0.1, 0.1, 0.12, 0.75, 0.75, 0, IRON));
  });
  fence(
    'build.brush_screen',
    'Brush screen',
    (_s, out) => {
      for (let k = 0; k < 6; k++) {
        const x = -h + 0.2 + k * 0.32;
        const g = part(new THREE.IcosahedronGeometry(0.55, 0), BRUSH[k % 3] as number);
        g.scale(0.7, 1.2 + hash(k) * 0.5, 0.5).translate(x, 0.6 + hash(k * 2) * 0.3, 0);
        out.body.push(g);
      }
      for (let k = 0; k < 3; k++)
        out.body.push(
          strut(v(-0.8 + k * 0.8, 0, 0.1), v(-0.6 + k * 0.7, 1.9, -0.05), 0.03, 0x5a4636),
        );
    },
    ['turf'],
  );

  // Storage (plan 09 §5.4).
  defs.push(
    prop('build.crate_stack', 'Crate stack', 'storage', ['plank'], (_s, out) => {
      crate(out.body, 0.9, -0.48, 0, 0);
      crate(out.body, 0.9, 0.48, 0, 0.05, 1);
      crate(out.body, 0.86, -0.4, 0.9, 0.02, 1);
    }),
  );
  defs.push(
    prop('build.barrel_rack', 'Barrel rack', 'storage', ['timber'], (s, out) => {
      out.body.push(box(1.9, 0.12, 0.9, 0, 0, 0, s.dark));
      for (const x of [-0.85, 0.85]) out.body.push(box(0.1, 1.4, 0.9, x, 0, 0, s.main));
      out.body.push(box(1.9, 0.08, 0.9, 0, 0.68, 0, s.dark));
      for (const [bx, by] of [
        [-0.42, 0.42],
        [0.2, 0.42],
        [-0.12, 1.06],
        [0.5, 1.06],
      ] as const) {
        const g = part(new THREE.CylinderGeometry(0.29, 0.29, 0.82, 8), BARREL);
        out.body.push(g.rotateX(Math.PI / 2).translate(bx, by - 0.12, 0));
      }
    }),
  );
  defs.push(
    prop('build.shelving', 'Shelving', 'storage', ['plank'], (s, out) => {
      for (const x of [-0.9, 0.9]) out.body.push(box(0.06, 2.2, 0.5, x, 0, 0.6, s.dark));
      for (let k = 0; k < 4; k++) {
        out.body.push(box(1.86, 0.04, 0.5, 0, 0.1 + k * 0.6, 0.6, s.main));
        for (let j = 0; j < 4; j++) {
          if (hash(k * 5 + j * 3) < 0.3) continue;
          const c = [CRATE, SACK, BARREL, 0x8f8a7a][(k + j) % 4] as number;
          out.body.push(
            box(0.32, 0.3 + hash(j + k) * 0.12, 0.36, -0.65 + j * 0.43, 0.14 + k * 0.6, 0.6, c),
          );
        }
      }
    }),
  );
  defs.push(
    prop(
      'build.warehouse_bay',
      'Warehouse bay',
      'storage',
      ['plank'],
      (s, out) => {
        // An open-fronted bay: posts, a back wall and racks of goods, 4 m square.
        for (const x of [-1.9, 1.9])
          for (const z of [-1.9, 1.9]) out.body.push(box(0.2, 2.6, 0.2, x, 0, z, s.dark));
        out.body.push(box(3.9, 0.12, 0.2, 0, 2.5, -1.9, s.dark));
        out.body.push(box(3.9, 2.6, 0.1, 0, 0, 1.92, s.main));
        for (let y = 0.25; y < 2.5; y += 0.25)
          out.body.push(box(3.9, 0.02, 0.02, 0, y, 1.86, s.dark));
        for (const y of [0, 1.2]) out.body.push(box(3.6, 0.08, 1.4, 0, y + 0.1, 1.1, s.dark));
        for (let k = 0; k < 6; k++) crate(out.body, 0.62, -1.4 + k * 0.56, 0.18, 1.1, k);
        for (let k = 0; k < 5; k++) barrel(out.body, -1.3 + k * 0.62, 1.32, 1.1, 0.95);
        for (let k = 0; k < 3; k++) crate(out.body, 0.8, -1.2 + k * 0.9, 0, -0.6, k + 1);
        out.body.push(box(0.8, 0.3, 0.6, 1.3, 0, -0.9, SACK));
      },
      { footprint: [2, 2] },
    ),
  );
  defs.push({
    id: 'build.cellar_vault',
    name: 'Hidden cellar vault',
    category: 'storage',
    placement: 'cell',
    footprint: one,
    materials: ['brownstone'],
    build: (s, out) => {
      // All that shows is a floor with a flush hatch; the vault is below.
      out.body.push(box(CELL_M, 0.1, CELL_M, 0, -0.08, 0, SHADES.plank.main));
      for (let x = -h + 0.25; x < h; x += 0.25)
        out.body.push(box(0.02, 0.01, CELL_M, x, 0.016, 0, SHADES.plank.dark));
      out.body.push(box(1.2, 0.025, 1.2, 0, 0.012, 0, SHADES.plank.main));
      out.body.push(box(0.05, 0.03, 0.05, 0.5, 0.012, 0.5, IRON));
      // A stone lip round the hatch: the vault itself is below and never seen.
      out.body.push(box(1.3, 0.02, 0.06, 0, 0.005, -0.63, s.main));
      out.body.push(box(1.3, 0.02, 0.06, 0, 0.005, 0.63, s.main));
    },
    proxy: (_s, out) => out.body.push(box(CELL_M, 0.1, CELL_M, 0, -0.08, 0, SHADES.plank.main)),
  });
  defs.push(
    prop('build.strongbox', 'Strongbox', 'storage', ['timber'], (s, out) => {
      out.body.push(box(0.85, 0.5, 0.55, 0, 0, 0, s.dark));
      const lid = part(
        new THREE.CylinderGeometry(0.275, 0.275, 0.85, 8, 1, false, 0, Math.PI),
        s.dark,
      );
      out.body.push(
        lid
          .rotateZ(Math.PI / 2)
          .rotateX(Math.PI / 2)
          .translate(0, 0.5, 0),
      );
      for (const x of [-0.3, 0, 0.3]) {
        out.body.push(box(0.07, 0.52, 0.57, x, -0.005, 0, IRON));
        const band = part(
          new THREE.CylinderGeometry(0.285, 0.285, 0.07, 8, 1, false, 0, Math.PI),
          IRON,
        );
        out.body.push(
          band
            .rotateZ(Math.PI / 2)
            .rotateX(Math.PI / 2)
            .translate(x, 0.5, 0),
        );
      }
      out.body.push(box(0.14, 0.18, 0.06, 0, 0.32, -0.3, BRASS));
    }),
  );

  // Living.
  defs.push(
    prop('build.bunk', 'Bunk', 'utility', ['timber'], (s, out) => {
      for (const [x, z] of [
        [-0.95, -0.42],
        [0.95, -0.42],
        [-0.95, 0.42],
        [0.95, 0.42],
      ] as const)
        out.body.push(box(0.08, 1.75, 0.08, x, 0, z, s.dark));
      for (const y of [0.3, 1.25]) {
        out.body.push(box(1.98, 0.08, 0.92, 0, y, 0, s.main));
        out.body.push(box(1.8, 0.14, 0.8, 0, y + 0.08, 0, WOOL));
        out.body.push(box(1.1, 0.06, 0.84, 0.3, y + 0.2, 0, y < 1 ? BLANKET : 0x4c5a6a));
        out.body.push(box(0.4, 0.1, 0.55, -0.68, y + 0.21, 0, 0xd5cdb8));
      }
      for (const z of [-0.42, 0.42]) out.body.push(box(1.9, 0.08, 0.06, 0, 1.55, z, s.dark));
    }),
  );
  defs.push(
    prop(
      'build.stove',
      'Stove',
      'utility',
      ['brownstone'],
      (_s, out) => {
        out.body.push(box(0.75, 0.62, 0.55, 0, 0.18, 0, IRON));
        for (const [x, z] of [
          [-0.3, -0.2],
          [0.3, -0.2],
          [-0.3, 0.2],
          [0.3, 0.2],
        ] as const)
          out.body.push(box(0.06, 0.18, 0.06, x, 0, z, IRON));
        out.body.push(box(0.82, 0.05, 0.6, 0, 0.8, 0, 0x3a3836));
        out.body.push(cyl(0.08, 2.1, 6, 0.15, 0.85, 0.15, IRON));
        out.lit.push(box(0.3, 0.16, 0.03, 0, 0.36, -0.28, FIRE));
      },
      { lamp: { x: 0, y: 0.5, z: -0.6, radiusM: 4, color: FIRE } },
    ),
  );
  defs.push(
    prop(
      'build.fireplace',
      'Fireplace',
      'utility',
      ['brownstone'],
      (s, out) => {
        // Against a wall at +z: the hearth and a chimney breast to the ceiling.
        out.body.push(box(1.8, 0.12, 0.9, 0, 0, 0.35, s.light));
        for (const x of [-0.65, 0.65]) out.body.push(box(0.5, 1.2, 0.7, x, 0.12, 0.6, s.main));
        out.body.push(box(1.8, 0.45, 0.7, 0, 1.32, 0.6, s.main));
        out.body.push(box(1.95, 0.08, 0.3, 0, 1.3, 0.2, SHADES.timber.dark));
        out.body.push(box(1.2, WALL_H_M - 1.77, 0.6, 0, 1.77, 0.65, s.main));
        out.body.push(box(0.8, 1.2, 0.1, 0, 0.12, 0.92, 0x1c1a18));
        for (let k = 0; k < 3; k++)
          out.body.push(logX(0.07, 0.55, 5, 0, 0.2 + k * 0.05, 0.55 + k * 0.08, 0x4a3626));
        out.lit.push(box(0.6, 0.18, 0.3, 0, 0.12, 0.55, FIRE));
      },
      { lamp: { x: 0, y: 0.6, z: -0.3, radiusM: 5, color: FIRE } },
    ),
  );
  defs.push(
    prop(
      'build.lantern',
      'Lantern post',
      'light',
      ['timber'],
      (s, out) => {
        out.body.push(box(0.12, 2.1, 0.12, 0, 0, 0, s.dark));
        out.body.push(box(0.45, 0.06, 0.06, 0.18, 2.0, 0, s.dark));
        out.body.push(box(0.03, 0.12, 0.03, 0.36, 1.88, 0, IRON));
        out.lit.push(box(0.18, 0.26, 0.18, 0.36, 1.6, 0, LAMP));
        out.body.push(frustum(0.02, 0.13, 0.1, 4, 0.36, 1.86, 0, IRON));
        out.body.push(box(0.2, 0.03, 0.2, 0.36, 1.58, 0, IRON));
      },
      { lamp: { x: 0.36, y: 1.72, z: 0, radiusM: 7, color: LAMP } },
    ),
  );
  defs.push(
    prop(
      'build.lantern_wall',
      'Wall lantern',
      'light',
      ['timber'],
      (_s, out) => {
        // A bracket off the wall at +z, the lantern hanging toward -z.
        out.body.push(box(0.12, 0.2, 0.04, 0, 1.9, 0.08, IRON));
        out.body.push(box(0.04, 0.04, 0.35, 0, 2.05, -0.08, IRON));
        out.lit.push(box(0.16, 0.24, 0.16, 0, 1.68, -0.2, LAMP));
        out.body.push(frustum(0.02, 0.11, 0.08, 4, 0, 1.92, -0.2, IRON));
        out.body.push(box(0.18, 0.03, 0.18, 0, 1.66, -0.2, IRON));
      },
      { lamp: { x: 0, y: 1.8, z: -0.3, radiusM: 6, color: LAMP } },
    ),
  );
  defs.push(
    prop(
      'build.signal_lantern',
      'Signal lantern',
      'light',
      ['timber'],
      (s, out) => {
        // A tall mast with a red lantern for your own night return.
        out.body.push(frustum(0.1, 0.16, 6, 6, 0, 0, 0, s.dark));
        for (const a of [0, 2.1, 4.2])
          out.body.push(
            strut(v(Math.sin(a) * 1.0, 0, Math.cos(a) * 1.0), v(0, 1.6, 0), 0.04, s.dark),
          );
        out.body.push(box(0.8, 0.08, 0.08, 0, 5.6, 0, s.dark));
        out.lit.push(box(0.36, 0.5, 0.36, 0, 6.0, 0, SIGNAL));
        out.body.push(frustum(0.04, 0.26, 0.18, 4, 0, 6.5, 0, IRON));
        out.body.push(box(0.4, 0.05, 0.4, 0, 5.96, 0, IRON));
      },
      { lamp: { x: 0, y: 6.2, z: 0, radiusM: 10, color: SIGNAL } },
    ),
  );
  defs.push(
    prop('build.well', 'Well', 'utility', ['brownstone'], (s, out) => {
      out.body.push(cyl(0.75, 0.85, 10, 0, 0, 0, s.main));
      out.body.push(cyl(0.8, 0.08, 10, 0, 0.85, 0, s.light));
      out.body.push(cyl(0.58, 0.04, 10, 0, 0.6, 0, WATER));
      for (const x of [-0.72, 0.72])
        out.body.push(box(0.12, 2.1, 0.12, x, 0.85, 0, SHADES.timber.dark));
      out.body.push(logX(0.08, 1.45, 6, 0, 1.75, 0, SHADES.timber.main));
      out.body.push(logX(0.09, 0.4, 6, 0, 1.75, 0, ROPE));
      out.body.push(box(0.04, 0.6, 0.04, 0, 1.15, 0, ROPE));
      out.body.push(frustum(0.14, 0.11, 0.24, 6, 0, 0.95, 0, BARREL));
      const roof = prismXY(
        [
          [-0.9, 0],
          [0.9, 0],
          [0, 0.7],
        ],
        1.0,
        0,
        SHADES.shingle.main,
      );
      out.body.push(roof.rotateY(Math.PI / 2).translate(0, 2.9, 0));
    }),
  );
  defs.push(
    prop('build.rain_barrel', 'Rain barrel', 'utility', ['timber'], (s, out) => {
      out.body.push(box(0.8, 0.25, 0.8, 0, 0, 0, s.dark));
      barrel(out.body, 0, 0.25, 0, 1.15);
      out.body.push(cyl(0.3, 0.04, 8, 0, 1.28, 0, s.main));
      out.body.push(box(0.08, 0.08, 0.2, 0, 0.45, -0.38, IRON));
      out.body.push(box(0.1, 1.6, 0.1, 0, 1.3, 0.25, 0x5a5550));
    }),
  );

  // The four stations (plan 09 §7.1).
  defs.push(
    prop('build.workbench', 'Workbench', 'station', ['timber'], (s, out) => {
      out.body.push(box(1.9, 0.1, 0.8, 0, 0.82, 0.3, s.light));
      for (const [x, z] of [
        [-0.85, -0.02],
        [0.85, -0.02],
        [-0.85, 0.62],
        [0.85, 0.62],
      ] as const)
        out.body.push(box(0.1, 0.82, 0.1, x, 0, z, s.dark));
      out.body.push(box(1.7, 0.05, 0.6, 0, 0.18, 0.3, s.main));
      // The tool board behind, with a saw, a hammer and a square.
      out.body.push(box(1.9, 1.0, 0.05, 0, 0.92, 0.72, s.main));
      out.body.push(
        prismXY(
          [
            [-0.6, 1.2],
            [-0.05, 1.3],
            [-0.05, 1.5],
            [-0.6, 1.35],
          ],
          0.02,
          0.68,
          0x8f9496,
        ),
      );
      out.body.push(box(0.04, 0.32, 0.03, 0.25, 1.15, 0.68, s.dark));
      out.body.push(box(0.14, 0.05, 0.04, 0.25, 1.45, 0.68, IRON));
      out.body.push(box(0.04, 0.4, 0.02, 0.6, 1.1, 0.68, 0x8f9496));
      out.body.push(box(0.3, 0.04, 0.02, 0.73, 1.1, 0.68, 0x8f9496));
      // A vise at the front corner and a plank being worked.
      out.body.push(box(0.16, 0.18, 0.2, -0.75, 0.92, -0.05, IRON));
      out.body.push(box(0.9, 0.04, 0.25, 0.2, 0.92, 0.25, SHADES.plank.light));
      out.body.push(box(0.25, 0.08, 0.06, 0.55, 0.96, 0.25, 0x8a6a48));
    }),
  );
  defs.push(
    prop(
      'build.smithy',
      'Smithy',
      'station',
      ['brownstone'],
      (s, out) => {
        // The forge hearth with its hood and stack, the anvil on a stump, the bellows.
        out.body.push(box(1.1, 0.8, 0.9, -0.35, 0, 0.45, s.main));
        for (let y = 0.27; y < 0.8; y += 0.27)
          out.body.push(box(1.12, 0.025, 0.92, -0.35, y, 0.45, s.light));
        out.body.push(box(0.8, 0.06, 0.6, -0.35, 0.8, 0.4, 0x1c1a18));
        out.lit.push(box(0.5, 0.06, 0.35, -0.35, 0.84, 0.4, FIRE));
        out.body.push(frustum(0.15, 0.6, 0.6, 4, -0.35, 1.55, 0.5, IRON));
        out.body.push(box(0.3, WALL_H_M - 2.15, 0.3, -0.35, 2.15, 0.5, s.main));
        out.body.push(cyl(0.2, 0.55, 7, 0.6, 0, -0.2, SHADES.log.main));
        out.body.push(box(0.5, 0.18, 0.18, 0.6, 0.55, -0.2, IRON));
        out.body.push(frustum(0.01, 0.09, 0.22, 4, 0.95, 0.6, -0.2, IRON));
        out.body.push(box(0.3, 0.06, 0.15, 0.6, 0.73, -0.2, IRON));
        const bellows = prismXY(
          [
            [0, 0],
            [0.7, 0.08],
            [0.7, 0.32],
            [0, 0.4],
          ],
          0.4,
          0,
          0x5a3f2c,
        );
        out.body.push(bellows.translate(-1.0, 0.55, 0.3));
        out.body.push(box(0.5, 0.3, 0.3, 0.55, 0, 0.6, SHADES.timber.dark));
        out.body.push(box(0.42, 0.02, 0.22, 0.55, 0.28, 0.6, WATER));
      },
      { lamp: { x: -0.35, y: 1.0, z: 0, radiusM: 5, color: FIRE } },
    ),
  );
  defs.push(
    prop('build.cooperage', 'Cooperage', 'station', ['timber'], (s, out) => {
      // A shaving horse, a barrel being raised in its hoop, and a stack of staves.
      out.body.push(beam(v(-0.9, 0.5, -0.3), v(0.1, 0.65, -0.3), 0.3, 0.08, s.main));
      for (const x of [-0.8, 0])
        for (const dz of [-0.12, 0.12])
          out.body.push(box(0.06, 0.5, 0.06, x, 0, -0.3 + dz, s.dark));
      out.body.push(beam(v(-0.05, 0.62, -0.3), v(0.2, 1.05, -0.3), 0.14, 0.06, s.dark));
      for (let k = 0; k < 12; k++) {
        const a = (k / 12) * Math.PI * 2;
        const r0 = 0.28;
        const r1 = 0.36 + (k % 3 === 0 ? 0.08 : 0);
        out.body.push(
          beam(
            v(0.55 + Math.sin(a) * r0, 0.02, 0.45 + Math.cos(a) * r0),
            v(0.55 + Math.sin(a) * r1, 0.85, 0.45 + Math.cos(a) * r1),
            0.13,
            0.03,
            SHADES.plank.light,
          ),
        );
      }
      out.body.push(cyl(0.31, 0.05, 10, 0.55, 0.1, 0.45, IRON));
      for (let k = 0; k < 7; k++)
        out.body.push(box(0.12, 0.03, 0.9, -0.55 + k * 0.13, 0, 0.55, SHADES.plank.light));
      for (let k = 0; k < 5; k++)
        out.body.push(box(0.12, 0.03, 0.9, -0.5 + k * 0.13, 0.03, 0.55, SHADES.plank.main));
      barrel(out.body, -0.7, 0, -0.85, 0.9);
      out.body.push(cyl(0.4, 0.04, 10, 0.75, 0, -0.75, IRON));
    }),
  );
  defs.push(
    prop(
      'build.distillery',
      'Distillery',
      'station',
      ['brownstone'],
      (s, out) => {
        // A copper pot still on its firebox, the swan neck to the worm tub, a mash barrel.
        out.body.push(box(0.95, 0.5, 0.95, -0.4, 0, 0.1, s.main));
        out.lit.push(box(0.35, 0.18, 0.03, -0.4, 0.08, -0.37, FIRE));
        out.body.push(frustum(0.42, 0.36, 0.55, 10, -0.4, 0.5, 0.1, COPPER));
        out.body.push(frustum(0.18, 0.42, 0.3, 10, -0.4, 1.05, 0.1, COPPER));
        out.body.push(frustum(0.06, 0.18, 0.25, 8, -0.4, 1.35, 0.1, COPPER));
        out.body.push(strut(v(-0.4, 1.55, 0.1), v(0.45, 1.2, 0.1), 0.04, COPPER));
        out.body.push(frustum(0.4, 0.4, 1.1, 10, 0.55, 0, 0.1, BARREL));
        for (const y of [0.2, 0.85]) out.body.push(cyl(0.41, 0.05, 10, 0.55, y, 0.1, IRON));
        out.body.push(cyl(0.04, 0.2, 6, 0.55, 0.25, -0.35, COPPER));
        out.body.push(frustum(0.12, 0.1, 0.2, 7, 0.55, 0, -0.45, 0x8f8a7a));
        barrel(out.body, -0.35, 0, 0.8, 0.9);
        out.body.push(box(0.25, 0.05, 0.25, -0.35, 0.82, 0.8, s.light));
      },
      { lamp: { x: -0.4, y: 0.3, z: -0.6, radiusM: 3.5, color: FIRE } },
    ),
  );

  // Decor (plan 09 §5.3): a few period pieces and trophies.
  defs.push(
    prop('build.table', 'Table', 'decor', ['timber'], (s, out) => {
      out.body.push(box(1.5, 0.07, 0.85, 0, 0.73, 0, s.light));
      for (const [x, z] of [
        [-0.65, -0.33],
        [0.65, -0.33],
        [-0.65, 0.33],
        [0.65, 0.33],
      ] as const)
        out.body.push(box(0.07, 0.73, 0.07, x, 0, z, s.dark));
      out.body.push(cyl(0.05, 0.12, 6, 0.3, 0.8, 0.1, 0x6a7c74));
      out.body.push(cyl(0.04, 0.1, 6, -0.25, 0.8, -0.1, 0xd5cdb8));
    }),
  );
  defs.push(
    prop('build.chair', 'Chair', 'decor', ['timber'], (s, out) => {
      out.body.push(box(0.45, 0.05, 0.45, 0, 0.44, 0, s.light));
      for (const [x, z] of [
        [-0.19, -0.19],
        [0.19, -0.19],
        [-0.19, 0.19],
        [0.19, 0.19],
      ] as const)
        out.body.push(box(0.04, 0.44, 0.04, x, 0, z, s.dark));
      for (const x of [-0.19, 0.19]) out.body.push(box(0.04, 0.5, 0.04, x, 0.49, 0.19, s.dark));
      for (const y of [0.7, 0.9]) out.body.push(box(0.42, 0.06, 0.03, 0, y, 0.19, s.main));
    }),
  );
  defs.push(
    prop('build.chest', 'Sea chest', 'decor', ['timber'], (_s, out) => {
      out.body.push(box(0.9, 0.45, 0.5, 0, 0, 0, 0x4a5d58));
      out.body.push(box(0.94, 0.08, 0.54, 0, 0.45, 0, 0x3a4a46));
      for (const x of [-0.46, 0.46]) out.body.push(box(0.04, 0.12, 0.2, x, 0.25, 0, ROPE));
      out.body.push(box(0.1, 0.12, 0.03, 0, 0.32, -0.26, BRASS));
    }),
  );
  defs.push(
    prop('build.rug', 'Rag rug', 'decor', ['plank'], (_s, out) => {
      out.body.push(box(1.6, 0.02, 1.0, 0, 0.02, 0, 0x7a3a32));
      out.body.push(box(1.3, 0.025, 0.7, 0, 0.02, 0, 0x4a5a6e));
      out.body.push(box(0.9, 0.03, 0.35, 0, 0.02, 0, 0xc8b998));
    }),
  );
  defs.push(
    prop('build.nets', 'Nets and floats', 'decor', ['timber'], (s, out) => {
      for (const x of [-0.9, 0.9]) out.body.push(box(0.1, 1.9, 0.1, x, 0, 0, s.dark));
      out.body.push(box(1.9, 0.08, 0.08, 0, 1.85, 0, s.dark));
      out.body.push(
        prismXY(
          [
            [-0.85, 0.3],
            [0.85, 0.4],
            [0.8, 1.85],
            [-0.8, 1.85],
          ],
          0.04,
          0,
          0x6f6a55,
        ),
      );
      for (let k = 0; k < 5; k++) {
        const g = part(new THREE.IcosahedronGeometry(0.11, 0), k % 2 ? 0xc4462e : 0xd9c9a0);
        out.body.push(g.translate(-0.7 + k * 0.35, 0.4 + (k % 2) * 0.12, -0.06));
      }
      out.body.push(cyl(0.2, 0.3, 8, 0.6, 0, 0.35, 0x6f6a55));
    }),
  );
  defs.push(
    prop('build.anchor', 'Old anchor', 'decor', ['timber'], (_s, out) => {
      // Lying against a block, as a trophy by the door.
      out.body.push(box(0.2, 1.6, 0.12, 0, 0.05, 0, IRON));
      out.body.push(beam(v(0, 0.15, 0), v(-0.55, 0.55, 0), 0.12, 0.12, IRON));
      out.body.push(beam(v(0, 0.15, 0), v(0.55, 0.55, 0), 0.12, 0.12, IRON));
      for (const x of [-0.6, 0.6]) out.body.push(frustum(0, 0.12, 0.22, 3, x, 0.5, 0, IRON));
      out.body.push(box(0.9, 0.1, 0.12, 0, 1.45, 0, SHADES.timber.dark));
      const ring = part(new THREE.TorusGeometry(0.12, 0.025, 4, 8), IRON);
      out.body.push(ring.translate(0, 1.82, 0));
    }),
  );
  defs.push(
    prop('build.ships_wheel', "Ship's wheel", 'decor', ['timber'], (s, out) => {
      out.body.push(box(0.2, 1.0, 0.2, 0, 0, 0.1, s.dark));
      const rim = part(new THREE.TorusGeometry(0.45, 0.035, 4, 16), s.light);
      out.body.push(rim.translate(0, 1.2, 0));
      out.body.push(cyl(0.08, 0.12, 8, 0, 1.2, -0.06, s.dark));
      for (let k = 0; k < 8; k++) {
        const a = (k / 8) * Math.PI * 2;
        out.body.push(
          strut(v(0, 1.2, 0), v(Math.sin(a) * 0.62, 1.2 + Math.cos(a) * 0.62, 0), 0.025, s.light),
        );
      }
    }),
  );
  defs.push(
    prop('build.figurehead', 'Figurehead', 'decor', ['timber'], (s, out) => {
      // A carved bust from a robbed ship, on a plinth.
      out.body.push(box(0.6, 0.4, 0.6, 0, 0, 0, s.dark));
      out.body.push(frustum(0.18, 0.28, 0.7, 7, 0, 0.4, 0, PAINT_WHITE));
      out.body.push(frustum(0.3, 0.22, 0.2, 7, 0, 0.95, 0, 0x2f4a6a));
      out.body.push(cyl(0.07, 0.15, 6, 0, 1.12, 0, PAINT_WHITE));
      const head = part(new THREE.IcosahedronGeometry(0.16, 1), PAINT_WHITE);
      out.body.push(head.scale(1, 1.15, 1).translate(0, 1.4, 0));
      const hair = part(new THREE.IcosahedronGeometry(0.17, 0), GILT);
      out.body.push(hair.scale(1, 0.8, 1).translate(0, 1.48, 0.04));
      out.body.push(box(0.5, 0.08, 0.12, 0, 0.35, -0.3, GILT));
    }),
  );
  return defs;
}

export const PIECES: readonly PieceDef[] = catalog();
const BY_ID = new Map(PIECES.map((p) => [p.id, p]));

export function pieceDef(id: string): PieceDef | undefined {
  return BY_ID.get(id);
}

// --- Geometry, cached per piece and material ---------------------------------------------

/** Merges a sink into one geometry with a `glow` attribute: 1 on lit glass, else 0. */
export function finish(sink: Sink): THREE.BufferGeometry {
  const all: THREE.BufferGeometry[] = [];
  for (const [list, glow] of [
    [sink.body, 0],
    [sink.lit, 1],
  ] as const) {
    for (const g of list) {
      const n = g.getAttribute('position').count;
      g.setAttribute('glow', new THREE.BufferAttribute(new Float32Array(n).fill(glow), 1));
      if (!g.getAttribute('normal')) g.computeVertexNormals();
      all.push(g);
    }
  }
  if (all.length === 0) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute([], 3));
    return g;
  }
  const g = mergeGeometries(all, false);
  if (!g) throw new Error('hideout kit: could not merge');
  for (const p of all) p.dispose();
  g.computeBoundingBox();
  g.computeBoundingSphere();
  return g;
}

/** The material a piece is drawn in: the asked one if it has it, else its default. */
export function resolveMaterial(def: PieceDef, material: string | undefined): HideoutMaterial {
  const m = material as HideoutMaterial | undefined;
  return m && def.materials.includes(m) ? m : (def.materials[0] as HideoutMaterial);
}

export function buildPiece(def: PieceDef, material: HideoutMaterial): THREE.BufferGeometry {
  const sink: Sink = { body: [], lit: [] };
  def.build(SHADES[material], sink);
  return finish(sink);
}

export function buildExtension(
  def: PieceDef,
  material: HideoutMaterial,
): THREE.BufferGeometry | undefined {
  if (!def.extend) return undefined;
  const sink: Sink = { body: [], lit: [] };
  def.extend.build(SHADES[material], sink);
  return finish(sink);
}

const tmpColor = new THREE.Color();

/**
 * The distant view's stand-in for a piece: its own `proxy`, or one box over the body's
 * bounds in its average color, plus a glowing box over any glass (so lit windows still
 * show from the ship at night).
 */
export function buildProxy(def: PieceDef, material: HideoutMaterial): THREE.BufferGeometry {
  const s = SHADES[material];
  const sink: Sink = { body: [], lit: [] };
  if (def.proxy) {
    def.proxy(s, sink);
    return finish(sink);
  }
  const full: Sink = { body: [], lit: [] };
  def.build(s, full);
  const boxOf = (list: THREE.BufferGeometry[], out: THREE.BufferGeometry[], min = 0.05): void => {
    if (list.length === 0) return;
    const bb = new THREE.Box3();
    let r = 0;
    let gg = 0;
    let b = 0;
    let weight = 0;
    for (const g of list) {
      g.computeBoundingBox();
      if (g.boundingBox) bb.union(g.boundingBox);
      const col = g.getAttribute('color');
      const n = col ? col.count : 0;
      for (let k = 0; k < n; k++) {
        r += col.getX(k);
        gg += col.getY(k);
        b += col.getZ(k);
      }
      weight += n;
      g.dispose();
    }
    if (bb.isEmpty() || weight === 0) return;
    tmpColor.setRGB(r / weight, gg / weight, b / weight);
    const size = bb.getSize(new THREE.Vector3());
    const c = bb.getCenter(new THREE.Vector3());
    out.push(
      box(
        Math.max(size.x, min),
        Math.max(size.y, min),
        Math.max(size.z, min),
        c.x,
        bb.min.y,
        c.z,
        tmpColor.getHex(),
      ),
    );
  };
  boxOf(full.body, sink.body);
  // Glass thickened so it shows through the wall's box on both faces.
  boxOf(full.lit, sink.lit, 0.42);
  return finish(sink);
}
