import type { StructureDef } from '../../../data/schemas/structures';
import {
  baseKey,
  BuildGrid,
  edgeCells,
  footprintCells,
  normalizeEdge,
  objectKey,
  propCell,
  propPoint,
  slotsOf,
  type BuildSite,
  type Cell,
  type Piece,
  type PlacedPiece,
} from './grid';
import {
  CELL_M,
  CLIFF_M,
  FLOOR_LEVELS,
  findStructure,
  GROUND_SLOPE_M,
  MOORING_MIN_DEPTH_M,
  PROP_TURNS,
  SPAN_CELLS,
  structure,
} from './structures';

/**
 * Validity (plan 09 §4.3; Phase 8 piece A): pure checks of whether a piece can go where
 * the ghost is, each refusal with a reason the ghost can show (§13: invalid placements
 * always explain why). The checks run in a fixed order, so the reason given is the first
 * thing wrong: what the piece is, where it is, what's in the way, what holds it up, and
 * then the ground and water under it.
 */

export type Refusal =
  | 'unknown'
  | 'variant'
  | 'rotation'
  | 'level'
  | 'bounds'
  | 'occupied'
  | 'noFloor'
  | 'noSupport'
  | 'noFrame'
  | 'inWater'
  | 'groundTooLow'
  | 'cliff'
  | 'tooSteep'
  | 'needsWater'
  | 'tooShallow'
  | 'tooDeep'
  | 'needsShore'
  | 'noDeepWater'
  | 'supports'
  | 'storageInUse'
  | 'cashInStrongbox'
  | 'notThere';

/** What the ghost's tooltip says for each refusal. */
export const REFUSAL_TEXT: Readonly<Record<Refusal, string>> = {
  unknown: 'No such piece',
  variant: "That material isn't made for this piece",
  rotation: "It doesn't turn that way",
  level: "It can't go on this level",
  bounds: 'Outside the build area',
  occupied: "Something's already there",
  noFloor: 'Needs a floor under it',
  noSupport: 'Needs walls or posts below to carry it',
  noFrame: 'Needs a frame to fit into',
  inWater: 'Needs dry ground',
  groundTooLow: 'The ground falls away too far',
  cliff: 'The ground rises into it',
  tooSteep: 'The ground is too steep here',
  needsWater: 'Needs water under it',
  tooShallow: 'The water is too shallow',
  tooDeep: 'The water is too deep',
  needsShore: 'Needs to run from the shore into deep water',
  noDeepWater: 'Needs deep water alongside to moor',
  supports: 'Other pieces stand on it',
  storageInUse: "The goods stored here wouldn't fit without it",
  cashInStrongbox: 'Empty the strongbox first',
  notThere: "There's nothing there",
};

export type Check = { ok: true } | { ok: false; reason: Refusal };

const OK: Check = { ok: true };
const no = (reason: Refusal): Check => ({ ok: false, reason });

// --- Ground ---------------------------------------------------------------------------------

/** The ground under a cell: lowest, highest and middle, meters above the lake. */
export function cellGround(
  site: BuildSite,
  col: number,
  row: number,
): {
  min: number;
  max: number;
  mid: number;
} {
  const x0 = col * CELL_M;
  const z0 = row * CELL_M;
  const hs = [
    site.ground(x0, z0),
    site.ground(x0 + CELL_M, z0),
    site.ground(x0, z0 + CELL_M),
    site.ground(x0 + CELL_M, z0 + CELL_M),
  ];
  const mid = site.ground(x0 + CELL_M / 2, z0 + CELL_M / 2);
  return { min: Math.min(mid, ...hs), max: Math.max(mid, ...hs), mid };
}

/** Water depth under a cell's middle, meters (0 on dry land). */
export function cellDepth(site: BuildSite, col: number, row: number): number {
  return Math.max(0, -cellGround(site, col, row).mid);
}

const inBounds = (site: BuildSite, c: Cell): boolean =>
  c.col >= 0 && c.row >= 0 && c.col < site.cols && c.row < site.rows;

// --- Support --------------------------------------------------------------------------------

/**
 * How far each base on a level is from the walls that carry it, in cells, following
 * bases on the same level (plan 09 §4.3's support graph). A cell `extra` is counted as if
 * it held a base, for checking a piece before it's placed.
 */
export function spanDistances(
  grid: BuildGrid,
  level: number,
  extra: readonly Cell[] = [],
): Map<string, number> {
  const cells = new Map<string, Cell>();
  for (const p of grid.all()) {
    if (p.piece.level !== level) continue;
    const def = structure(p.piece.id);
    if (def.layer !== 'base' && def.placement !== 'roof') continue;
    for (const c of footprintCells(def, p.piece)) cells.set(`${c.col}:${c.row}`, c);
  }
  for (const c of extra) cells.set(`${c.col}:${c.row}`, c);
  const dist = new Map<string, number>();
  const queue: Cell[] = [];
  for (const [k, c] of cells) {
    if (grid.carriedFromBelow(c.col, c.row, level)) {
      dist.set(k, 0);
      queue.push(c);
    }
  }
  for (let i = 0; i < queue.length; i++) {
    const c = queue[i] as Cell;
    const d = (dist.get(`${c.col}:${c.row}`) ?? 0) + 1;
    if (d > SPAN_CELLS) continue;
    for (const [dc, dr] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ] as const) {
      const k = `${c.col + dc}:${c.row + dr}`;
      const n = cells.get(k);
      if (!n || dist.has(k)) continue;
      dist.set(k, d);
      queue.push(n);
    }
  }
  return dist;
}

/** Whether a base above level 0, or a roof, is carried: every cell within the span. */
function carried(grid: BuildGrid, def: StructureDef, p: Piece): Check {
  if (p.level <= 0) return no('noSupport');
  const cells = footprintCells(def, p);
  const dist = spanDistances(grid, p.level, cells);
  return cells.every((c) => dist.has(`${c.col}:${c.row}`)) ? OK : no('noSupport');
}

/** A base on level 0 on the terrain: dry (unless it's a piling), reaching down, no cliff. */
function onTerrain(site: BuildSite, def: StructureDef, p: Piece): Check {
  for (const c of footprintCells(def, p)) {
    const g = cellGround(site, c.col, c.row);
    if (!def.wet && g.mid < 0) return no('inWater');
    if (g.max > site.baseM + CLIFF_M) return no('cliff');
    if (site.baseM - g.min > (def.reachM ?? 0)) return no('groundTooLow');
  }
  return OK;
}

/** Bare ground for a fence, a well or a lantern: dry and not too steep. */
function bareGround(site: BuildSite, cells: readonly Cell[]): Check {
  for (const c of cells) {
    if (!inBounds(site, c)) continue;
    const g = cellGround(site, c.col, c.row);
    if (g.mid < 0) return no('inWater');
    if (g.max - g.min > GROUND_SLOPE_M) return no('tooSteep');
  }
  return OK;
}

function inWater(site: BuildSite, def: StructureDef, p: Piece): Check {
  const w = def.water;
  if (!w) return no('needsWater');
  const cells = footprintCells(def, p);
  const depths = cells.map((c) => cellDepth(site, c.col, c.row));
  if (w.shore) {
    const shallow = Math.min(...depths);
    const deep = Math.max(...depths);
    if (shallow > 0.3 || deep < w.minDepthM) return no('needsShore');
    if (deep > w.maxDepthM) return no('tooDeep');
    return OK;
  }
  for (const d of depths) {
    if (d <= 0) return no('needsWater');
    if (d < w.minDepthM) return no('tooShallow');
    if (d > w.maxDepthM) return no('tooDeep');
  }
  return OK;
}

/** Open water beside a cell at least `depthM` deep, with no base over it. */
export function deepWaterBeside(
  grid: BuildGrid,
  site: BuildSite,
  c: Cell,
  depthM: number,
): boolean {
  for (const [dc, dr] of [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
  ] as const) {
    const n = { col: c.col + dc, row: c.row + dr };
    if (grid.baseAt(n.col, n.row, 0)) continue;
    if (cellDepth(site, n.col, n.row) >= depthM) return true;
  }
  return false;
}

/**
 * Whether a piece stands on what's around it: the support part of validity, also what
 * removal re-checks for the pieces left behind.
 */
export function stands(grid: BuildGrid, site: BuildSite, p: Piece): Check {
  const def = structure(p.id);
  switch (def.placement) {
    case 'roof':
      return carried(grid, def, p);
    case 'water':
      return inWater(site, def, p);
    case 'cell':
      if (def.stand === 'base')
        return p.level === 0 ? onTerrain(site, def, p) : carried(grid, def, p);
      return onFloors(grid, site, def, p, footprintCells(def, p));
    case 'prop':
      return onFloors(grid, site, def, p, [propCell(p)]);
    case 'edge': {
      const e = normalizeEdge(p.col, p.row, p.rot);
      if (def.fitsIn) {
        const f = grid.frameAt(e, p.level);
        return f && def.fitsIn.includes(f.piece.id) ? OK : no('noFrame');
      }
      const sides = edgeCells(e);
      if (sides.some((c) => grid.floorAt(c.col, c.row, p.level))) return OK;
      if (def.onRoof && sides.some((c) => grid.baseAt(c.col, c.row, p.level))) return OK;
      if (p.level === 0 && def.groundOk) return bareGround(site, sides);
      return no('noFloor');
    }
  }
}

function onFloors(
  grid: BuildGrid,
  site: BuildSite,
  def: StructureDef,
  p: Piece,
  cells: readonly Cell[],
): Check {
  const floored = cells.every((c) => grid.floorAt(c.col, c.row, p.level));
  if (!floored) {
    if (!(p.level === 0 && def.groundOk)) return no('noFloor');
    if (cells.some((c) => grid.floorAt(c.col, c.row, 0))) return no('noFloor');
    const g = bareGround(site, cells);
    if (!g.ok) return g;
  }
  if (def.functions.mooring) {
    if (!cells.some((c) => deepWaterBeside(grid, site, c, MOORING_MIN_DEPTH_M))) {
      return no('noDeepWater');
    }
  }
  return OK;
}

// --- Placement ------------------------------------------------------------------------------

function maxLevel(def: StructureDef): number {
  const top = def.placement === 'roof' ? FLOOR_LEVELS : FLOOR_LEVELS - 1;
  return Math.min(top, def.maxLevel ?? top);
}

/** Whether two props would stand in each other. */
function propsOverlap(a: Piece, b: Piece): boolean {
  const da = structure(a.id);
  const db = structure(b.id);
  if (a.level !== b.level || !da.sizeM || !db.sizeM) return false;
  const pa = propPoint(a);
  const pb = propPoint(b);
  const ra = Math.min(...da.sizeM) / 2;
  const rb = Math.min(...db.sizeM) / 2;
  return Math.hypot(pa.x - pb.x, pa.z - pb.z) < ra + rb - 1e-6;
}

/**
 * Whether `p` can be placed on the grid as it stands (planned pieces count, as ghosts do
 * for the player). `ignore` leaves one piece out, for moving it.
 */
export function canPlace(grid: BuildGrid, site: BuildSite, p: Piece, ignore?: number): Check {
  const def = findStructure(p.id);
  if (!def) return no('unknown');
  if (!Number.isInteger(p.variant) || p.variant < 0 || p.variant >= def.variants.length) {
    return no('variant');
  }
  const turns = def.placement === 'prop' ? PROP_TURNS : 4;
  if (!Number.isInteger(p.rot) || p.rot < 0 || p.rot >= turns) return no('rotation');
  const minLevel = def.placement === 'roof' ? 1 : 0;
  if (!Number.isInteger(p.level) || p.level < minLevel || p.level > maxLevel(def)) {
    return no('level');
  }

  // Bounds.
  switch (def.placement) {
    case 'edge': {
      const e = normalizeEdge(p.col, p.row, p.rot);
      if (!edgeCells(e).some((c) => inBounds(site, c))) return no('bounds');
      break;
    }
    case 'prop': {
      const { x, z } = propPoint(p);
      const lim = (v: number, n: number): boolean => v >= 0 && v <= n * CELL_M;
      if (!lim(x, site.cols) || !lim(z, site.rows)) return no('bounds');
      if (!Number.isInteger(p.col) || !Number.isInteger(p.row)) return no('bounds');
      break;
    }
    default:
      if (!footprintCells(def, p).every((c) => inBounds(site, c))) return no('bounds');
  }

  // Overlap.
  for (const k of slotsOf(p, def)) {
    const there = grid.inSlot(k);
    if (there && there.uid !== ignore) return no('occupied');
  }
  if (def.placement === 'prop') {
    const c = propCell(p);
    const obj = grid.inSlot(objectKey(c.col, c.row, p.level));
    if (obj && obj.uid !== ignore) return no('occupied');
    for (const q of grid.props())
      if (q.uid !== ignore && propsOverlap(p, q.piece)) return no('occupied');
  }
  if (def.layer === 'object') {
    for (const q of grid.props()) {
      if (q.uid === ignore || q.piece.level !== p.level) continue;
      const c = propCell(q.piece);
      if (footprintCells(def, p).some((f) => f.col === c.col && f.row === c.row)) {
        return no('occupied');
      }
    }
  }
  if (def.layer === 'base' && p.level === 0) {
    // Nothing standing on bare ground where a floor would go.
    for (const c of footprintCells(def, p)) {
      if (grid.inSlot(objectKey(c.col, c.row, 0)) && !grid.inSlot(baseKey(c.col, c.row, 0))) {
        const o = grid.inSlot(objectKey(c.col, c.row, 0));
        if (o && o.uid !== ignore) return no('occupied');
      }
    }
  }

  // Support, then ground and water.
  if (ignore === undefined) return stands(grid, site, p);
  const g = grid.clone();
  g.remove(ignore);
  return stands(g, site, p);
}

// --- Removal --------------------------------------------------------------------------------

/**
 * Every piece that would fall with `uids` gone: the support graph re-checked until
 * nothing more falls. Returns the dependents only, in grid order.
 */
export function dependentsOf(grid: BuildGrid, site: BuildSite, uids: readonly number[]): number[] {
  const g = grid.clone();
  // The clone renumbers; map old uids by order.
  const order = grid.all().map((p) => p.uid);
  const cloneOrder = g.all().map((p) => p.uid);
  const toClone = new Map(order.map((u, i) => [u, cloneOrder[i] as number]));
  const fromClone = new Map(cloneOrder.map((u, i) => [u, order[i] as number]));
  for (const u of uids) {
    const c = toClone.get(u);
    if (c !== undefined) g.remove(c);
  }
  const fallen: number[] = [];
  for (;;) {
    const drop: PlacedPiece[] = g.all().filter((p) => !stands(g, site, p.piece).ok);
    if (drop.length === 0) break;
    for (const p of drop) {
      g.remove(p.uid);
      fallen.push(fromClone.get(p.uid) as number);
    }
  }
  const set = new Set(fallen);
  return order.filter((u) => set.has(u));
}
