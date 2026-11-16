import type { StructureCategory, StructureDef } from '../../../data/schemas/structures';
import { addGoods, pieceCost, type Goods } from './edit';
import {
  fittingKey,
  normalizeEdge,
  objectKey,
  propPoint,
  type BuildGrid,
  type Piece,
  type PlacedPiece,
} from './grid';
import { CELL_M, PROP_STEP_M, PROP_TURNS, STRUCTURES } from './structures';

/**
 * The build mode's tools as pure functions (plan 09 §9, plan 13 §12; Phase 8 piece C):
 * where the piece under the cursor goes, lines and rectangles dragged out, and the palette
 * with costs and what's on hand. The game turns the mouse into a point on the level being
 * edited (site meters) and hands it here.
 */

/** Where the cursor meets the level being edited, site meters (x along, z inland). */
export interface Aim {
  x: number;
  z: number;
}

/** What's held: the piece, its material, how it's turned, and an edge's facing. */
export interface Held {
  id: string;
  variant: number;
  /** Quarter turns for cells, roofs and water; 15° steps for props. */
  rot: number;
  /** Edges: face the other way (spelled from the cell on the other side). */
  flip: boolean;
}

/** The cells a footprint covers along x and z, turned. */
function turned(def: StructureDef, rot: number): [number, number] {
  return rot & 1 ? [def.footprint[1], def.footprint[0]] : def.footprint;
}

/** The piece the cursor would place on `level`. */
export function aimPiece(def: StructureDef, held: Held, aim: Aim, level: number): Piece {
  const base = { id: def.id, level, variant: held.variant, paint: 0 };
  switch (def.placement) {
    case 'prop':
      return {
        ...base,
        col: Math.round(aim.x / PROP_STEP_M),
        row: Math.round(aim.z / PROP_STEP_M),
        rot: ((held.rot % PROP_TURNS) + PROP_TURNS) % PROP_TURNS,
      };
    case 'edge': {
      const col = Math.floor(aim.x / CELL_M);
      const row = Math.floor(aim.z / CELL_M);
      const fx = aim.x / CELL_M - col;
      const fz = aim.z / CELL_M - row;
      // The side of the cell the cursor is nearest: 0 -z, 1 +x, 2 +z, 3 -x.
      const near = [fz, 1 - fx, 1 - fz, fx];
      let side = 0;
      for (let s = 1; s < 4; s++) if ((near[s] ?? 1) < (near[side] ?? 1)) side = s;
      if (!held.flip) return { ...base, col, row, rot: side };
      // The same edge from the neighbor's side: it faces the other way.
      const other = {
        col: col + (side === 1 ? 1 : side === 3 ? -1 : 0),
        row: row + (side === 0 ? -1 : side === 2 ? 1 : 0),
      };
      return { ...base, ...other, rot: (side + 2) % 4 };
    }
    default: {
      const rot = held.rot & 3;
      const [w, d] = turned(def, rot);
      // The footprint centered on the cursor.
      return {
        ...base,
        col: Math.round(aim.x / CELL_M - w / 2),
        row: Math.round(aim.z / CELL_M - d / 2),
        rot,
      };
    }
  }
}

/** Whether dragging lays out more than one of this piece (plan 09 §9). */
export function draggable(def: StructureDef): 'line' | 'rect' | undefined {
  if (def.placement === 'edge') return def.category === 'fitting' ? undefined : 'line';
  if (def.placement === 'prop') return undefined;
  return 'rect';
}

/** Most pieces one drag lays out, so a slip of the mouse can't plan a thousand. */
export const DRAG_MAX = 200;

/**
 * The pieces a drag from `start` to `end` lays out: a line of walls or fences along the
 * start's edge, a rectangle of floors, foundations, roofs or pier, or just the end piece.
 */
export function dragPieces(def: StructureDef, start: Piece, end: Piece): Piece[] {
  const kind = draggable(def);
  if (!kind) return [end];
  if (kind === 'line') {
    const a = normalizeEdge(start.col, start.row, start.rot);
    const b = normalizeEdge(end.col, end.row, end.rot);
    const out: Piece[] = [];
    // Edges on a cell's -z side run along x; on its -x side, along z.
    const alongX = a.side === 0;
    const from = alongX ? a.col : a.row;
    const to = alongX ? b.col : b.row;
    const step = to >= from ? 1 : -1;
    for (let k = from; k !== to + step && out.length < DRAG_MAX; k += step) {
      const col = alongX ? k : a.col;
      const row = alongX ? a.row : k;
      // Keep the start's facing: spelled from the same side of the line it was.
      const flipped = start.rot === 2 || start.rot === 1;
      out.push(
        flipped
          ? {
              ...start,
              col: alongX ? col : col - 1,
              row: alongX ? row - 1 : row,
            }
          : { ...start, col, row },
      );
    }
    return out;
  }
  const [w, d] = turned(def, start.rot & 3);
  const out: Piece[] = [];
  const c0 = Math.min(start.col, end.col);
  const c1 = Math.max(start.col, end.col);
  const r0 = Math.min(start.row, end.row);
  const r1 = Math.max(start.row, end.row);
  // Footprints laid edge to edge from the start's corner.
  const cs = start.col <= end.col ? 1 : -1;
  const rs = start.row <= end.row ? 1 : -1;
  for (let col = start.col; col >= c0 && col <= c1; col += cs * w) {
    for (let row = start.row; row >= r0 && row <= r1; row += rs * d) {
      if (out.length >= DRAG_MAX) return out;
      out.push({ ...start, col, row });
    }
  }
  return out;
}

// --- The palette ----------------------------------------------------------------------------

/** The palette's categories in the order it lists them (plan 13 §12), with their names. */
export const PALETTE_CATEGORIES: readonly { id: StructureCategory; name: string }[] = [
  { id: 'foundation', name: 'Foundations' },
  { id: 'floor', name: 'Floors' },
  { id: 'wall', name: 'Walls' },
  { id: 'fitting', name: 'Doors & windows' },
  { id: 'roof', name: 'Roofs' },
  { id: 'stairs', name: 'Stairs' },
  { id: 'water', name: 'Piers' },
  { id: 'fence', name: 'Fences & paths' },
  { id: 'storage', name: 'Storage' },
  { id: 'living', name: 'Living' },
  { id: 'light', name: 'Lights' },
  { id: 'station', name: 'Workstations' },
  { id: 'decor', name: 'Decor' },
];

export function piecesIn(category: StructureCategory): StructureDef[] {
  return STRUCTURES.filter((s) => s.category === category);
}

/** How many of a piece the goods on hand would pay for, after what's already queued. */
export function affordable(cost: Goods, onHand: Goods, queued: Goods = {}): number {
  let n = Infinity;
  for (const [g, q] of Object.entries(cost)) {
    if (q <= 0) continue;
    n = Math.min(n, Math.floor(Math.max(0, (onHand[g] ?? 0) - (queued[g] ?? 0)) / q));
  }
  return Number.isFinite(n) ? n : 0;
}

/** The materials a list of pieces needs. */
export function costOf(pieces: readonly Piece[]): Goods {
  const out: Goods = {};
  for (const p of pieces) addGoods(out, pieceCost(p));
  return out;
}

/** "4 lumber, 1 hardware" from goods by id, with names from `name`. */
export function goodsText(goods: Goods, name: (id: string) => string): string {
  const parts = Object.entries(goods)
    .filter(([, n]) => n > 0)
    .map(([g, n]) => `${n} ${name(g).toLowerCase()}`);
  return parts.length ? parts.join(', ') : 'nothing';
}

/** How near an edge's line the cursor must be to pick the wall on it, cells. */
const EDGE_PICK = 0.2;

/**
 * The piece under the cursor on a level, for X and Q: a wall or fence when the cursor is
 * on its line, else a prop within reach, else what stands in the cell, else its floor.
 * On level 0 a roof can't be under the cursor; a roof on the level above the walls is
 * picked from that level.
 */
export function pieceAt(grid: BuildGrid, aim: Aim, level: number): PlacedPiece | undefined {
  const col = Math.floor(aim.x / CELL_M);
  const row = Math.floor(aim.z / CELL_M);
  const fx = aim.x / CELL_M - col;
  const fz = aim.z / CELL_M - row;
  const sides: [number, number][] = [
    [0, fz],
    [1, 1 - fx],
    [2, 1 - fz],
    [3, fx],
  ];
  sides.sort((a, b) => a[1] - b[1]);
  for (const [side, d] of sides) {
    if (d > EDGE_PICK) break;
    const e = normalizeEdge(col, row, side);
    const fitting = grid.inSlot(fittingKey(e, level));
    if (fitting) return fitting;
    const frame = grid.frameAt(e, level);
    if (frame) return frame;
  }
  let best: PlacedPiece | undefined;
  let bestD = 0.75;
  for (const p of grid.props()) {
    if (p.piece.level !== level) continue;
    const q = propPoint(p.piece);
    const d = Math.hypot(q.x - aim.x, q.z - aim.z);
    if (d < bestD) {
      best = p;
      bestD = d;
    }
  }
  if (best) return best;
  return grid.inSlot(objectKey(col, row, level)) ?? grid.baseAt(col, row, level);
}
