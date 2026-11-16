import type { PackedLayout, StructureDef } from '../../../data/schemas/structures';
import { CELL_M, PROP_STEP_M, structure } from './structures';

/**
 * A hideout's grid (plan 09 §4, §10, §12; Phase 8 piece A): the pieces on it, built or
 * planned, and an index of which slot each one fills so placement checks are cheap.
 *
 * Local meters, as the district's layouts: x along the shore, z inland, y up from the
 * site's level-0 floor datum. Cell (col, row) spans x col·2 … +2 and z row·2 … +2 from the
 * build bounds' corner. A cell has a **base** slot (foundation, floor, pier, roof) and an
 * **object** slot (what stands on the base) per level; an edge has a frame slot and a
 * fitting slot per level. Props take no slot and are checked against each other.
 *
 * Edges are spelled from either neighbor; the index keeps them on a cell's -z (0) or -x
 * (3) side, so each edge has one key, while the piece keeps the side it was placed from
 * (its facing).
 */

export interface Piece {
  id: string;
  col: number;
  row: number;
  level: number;
  rot: number;
  variant: number;
  paint: number;
}

export interface PlacedPiece {
  uid: number;
  piece: Piece;
  built: boolean;
}

/** Height of the ground above the lake at a point, meters (negative: the lake bed). */
export type GroundFn = (x: number, z: number) => number;

/** Where a hideout is built: its bounds in cells, its floor datum and its ground. */
export interface BuildSite {
  cols: number;
  rows: number;
  /** Level 0's floor, meters above the lake. */
  baseM: number;
  ground: GroundFn;
}

/** A cell, as (col, row). */
export interface Cell {
  col: number;
  row: number;
}

// --- Footprints and edges -------------------------------------------------------------------

/** The cells a cell, roof or water piece covers: its footprint turned by `rot`. */
export function footprintCells(def: StructureDef, p: Piece): Cell[] {
  const [w, d] = p.rot & 1 ? [def.footprint[1], def.footprint[0]] : def.footprint;
  const out: Cell[] = [];
  for (let i = 0; i < w; i++)
    for (let j = 0; j < d; j++) out.push({ col: p.col + i, row: p.row + j });
  return out;
}

/** An edge spelled once: the -z (0) or -x (3) side of a cell. */
export interface EdgeKey {
  col: number;
  row: number;
  side: 0 | 3;
}

export function normalizeEdge(col: number, row: number, side: number): EdgeKey {
  switch (side & 3) {
    case 0:
      return { col, row, side: 0 };
    case 1:
      return { col: col + 1, row, side: 3 };
    case 2:
      return { col, row: row + 1, side: 0 };
    default:
      return { col, row, side: 3 };
  }
}

/** The two cells an edge lies between. */
export function edgeCells(e: EdgeKey): [Cell, Cell] {
  return e.side === 0
    ? [
        { col: e.col, row: e.row },
        { col: e.col, row: e.row - 1 },
      ]
    : [
        { col: e.col, row: e.row },
        { col: e.col - 1, row: e.row },
      ];
}

/** A cell's four edges, normalized. */
export function cellEdges(col: number, row: number): EdgeKey[] {
  return [0, 1, 2, 3].map((s) => normalizeEdge(col, row, s));
}

/** A prop's position, meters, from its sub-grid steps. */
export function propPoint(p: Piece): { x: number; z: number } {
  return { x: p.col * PROP_STEP_M, z: p.row * PROP_STEP_M };
}

/** The cell a prop stands in. */
export function propCell(p: Piece): Cell {
  const { x, z } = propPoint(p);
  return { col: Math.floor(x / CELL_M), row: Math.floor(z / CELL_M) };
}

// --- Slots ----------------------------------------------------------------------------------

export const baseKey = (col: number, row: number, level: number): string =>
  `b:${col}:${row}:${level}`;
export const objectKey = (col: number, row: number, level: number): string =>
  `o:${col}:${row}:${level}`;
export const frameKey = (e: EdgeKey, level: number): string =>
  `e:${e.col}:${e.row}:${e.side}:${level}`;
export const fittingKey = (e: EdgeKey, level: number): string =>
  `f:${e.col}:${e.row}:${e.side}:${level}`;

/** The slots a piece fills; none for a prop. */
export function slotsOf(p: Piece, def: StructureDef = structure(p.id)): string[] {
  switch (def.placement) {
    case 'cell':
    case 'water':
    case 'roof': {
      const key = def.layer === 'object' ? objectKey : baseKey;
      return footprintCells(def, p).map((c) => key(c.col, c.row, p.level));
    }
    case 'edge': {
      const e = normalizeEdge(p.col, p.row, p.rot);
      return [def.category === 'fitting' ? fittingKey(e, p.level) : frameKey(e, p.level)];
    }
    case 'prop':
      return [];
  }
}

// --- The grid -------------------------------------------------------------------------------

/**
 * The pieces of one hideout and the slots they fill. Mutated in place by the edits
 * (edit.ts) and the work session (work.ts); packed for the save.
 */
export class BuildGrid {
  private readonly byUid = new Map<number, PlacedPiece>();
  private readonly slots = new Map<string, number>();
  private nextUid = 1;

  /** Every piece in the order placed (the work session builds in this order). */
  all(): PlacedPiece[] {
    return [...this.byUid.values()];
  }

  built(): PlacedPiece[] {
    return this.all().filter((p) => p.built);
  }

  planned(): PlacedPiece[] {
    return this.all().filter((p) => !p.built);
  }

  get size(): number {
    return this.byUid.size;
  }

  get(uid: number): PlacedPiece | undefined {
    return this.byUid.get(uid);
  }

  /** The piece filling a slot. */
  inSlot(key: string): PlacedPiece | undefined {
    const uid = this.slots.get(key);
    return uid === undefined ? undefined : this.byUid.get(uid);
  }

  /** Adds a piece with no checks (validity.ts checks first). Returns its uid. */
  add(piece: Piece, built: boolean): number {
    const uid = this.nextUid++;
    this.byUid.set(uid, { uid, piece: { ...piece }, built });
    for (const k of slotsOf(piece)) this.slots.set(k, uid);
    return uid;
  }

  remove(uid: number): PlacedPiece | undefined {
    const p = this.byUid.get(uid);
    if (!p) return undefined;
    this.byUid.delete(uid);
    for (const k of slotsOf(p.piece)) if (this.slots.get(k) === uid) this.slots.delete(k);
    return p;
  }

  setBuilt(uid: number, built: boolean): void {
    const p = this.byUid.get(uid);
    if (p) p.built = built;
  }

  /** The piece with this uid, if it is a prop, or any prop, for the overlap check. */
  props(): PlacedPiece[] {
    return this.all().filter((p) => structure(p.piece.id).placement === 'prop');
  }

  /** The base standing in a cell on a level (a floor, foundation, pier or roof). */
  baseAt(col: number, row: number, level: number): PlacedPiece | undefined {
    return this.inSlot(baseKey(col, row, level));
  }

  /** A floor you can stand things on: a base that isn't a roof. */
  floorAt(col: number, row: number, level: number): PlacedPiece | undefined {
    const b = this.baseAt(col, row, level);
    return b && structure(b.piece.id).placement !== 'roof' ? b : undefined;
  }

  /** The frame (wall, fence, post, ladder) on an edge. */
  frameAt(e: EdgeKey, level: number): PlacedPiece | undefined {
    return this.inSlot(frameKey(e, level));
  }

  /** Whether any edge of a cell on a level carries what's above (a wall or post). */
  carriedFromBelow(col: number, row: number, level: number): boolean {
    if (level <= 0) return false;
    return cellEdges(col, row).some((e) => {
      const f = this.frameAt(e, level - 1);
      return !!f && !!structure(f.piece.id).carries;
    });
  }

  /** A copy, for trying an edit out. */
  clone(): BuildGrid {
    const g = new BuildGrid();
    for (const p of this.all()) g.add(p.piece, p.built);
    return g;
  }
}

// --- Packing (plan 09 §10, plan 16 §15) ------------------------------------------------------

const STRIDE = 7;

function packList(pieces: Piece[], palette: string[]): number[] {
  const out: number[] = [];
  for (const p of pieces) {
    let k = palette.indexOf(p.id);
    if (k < 0) {
      k = palette.length;
      palette.push(p.id);
    }
    out.push(k, p.col, p.row, p.level, p.rot, p.variant, p.paint);
  }
  return out;
}

function unpackList(palette: readonly string[], a: readonly number[]): Piece[] {
  const out: Piece[] = [];
  for (let i = 0; i + STRIDE <= a.length; i += STRIDE) {
    const id = palette[a[i] ?? -1];
    if (id === undefined) throw new Error(`layout: no palette entry ${a[i]}`);
    out.push({
      id,
      col: a[i + 1] ?? 0,
      row: a[i + 2] ?? 0,
      level: a[i + 3] ?? 0,
      rot: a[i + 4] ?? 0,
      variant: a[i + 5] ?? 0,
      paint: a[i + 6] ?? 0,
    });
  }
  return out;
}

export function packGrid(grid: BuildGrid): PackedLayout {
  const palette: string[] = [];
  const built = packList(
    grid.built().map((p) => p.piece),
    palette,
  );
  const planned = packList(
    grid.planned().map((p) => p.piece),
    palette,
  );
  return { palette, built, planned };
}

/**
 * Rebuilds a grid from its packed form. Pieces whose ids no longer exist are dropped
 * (a renamed piece in a later build) rather than failing the load.
 */
export function unpackGrid(layout: PackedLayout): BuildGrid {
  const grid = new BuildGrid();
  const keep = (p: Piece): boolean => {
    try {
      structure(p.id);
      return true;
    } catch {
      return false;
    }
  };
  for (const p of unpackList(layout.palette, layout.built)) if (keep(p)) grid.add(p, true);
  for (const p of unpackList(layout.palette, layout.planned)) if (keep(p)) grid.add(p, false);
  return grid;
}

export function emptyLayout(): PackedLayout {
  return { palette: [], built: [], planned: [] };
}

/** A layout moved by whole cells: a starter laid down at a site's chosen corner. */
export function offsetLayout(layout: PackedLayout, dCol: number, dRow: number): PackedLayout {
  const shift = (a: readonly number[]): number[] => {
    const out = [...a];
    for (let i = 0; i + STRIDE <= out.length; i += STRIDE) {
      const isProp = structure(layout.palette[out[i] ?? -1] ?? '').placement === 'prop';
      const k = isProp ? CELL_M / PROP_STEP_M : 1;
      out[i + 1] = (out[i + 1] ?? 0) + dCol * k;
      out[i + 2] = (out[i + 2] ?? 0) + dRow * k;
    }
    return out;
  };
  return {
    palette: [...layout.palette],
    built: shift(layout.built),
    planned: shift(layout.planned),
  };
}
