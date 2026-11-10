import {
  districtLayoutSchema,
  type DistrictBuildingDef,
  type DistrictLayoutFile,
} from '../../../data/schemas/districts';
import { CELL_M, findKitPiece, kitPiece, PROP_SNAP_M, PROP_TURN_DEG } from './kit';

/**
 * District layouts (plan 08 §13, plan 09 §4 and §11; Phase 7 piece C): the grid math and
 * the edits the dev placement editor makes. A layout is the file as saved: a palette of kit
 * ids and packed tuples, so what the editor holds is exactly what goes to disk, and plan
 * 09's hideout builder can take the same format over in Phase 8.
 *
 * Local meters: x along the shore, z inland (the lake is toward -z). Cell (col, row) spans
 * x0 + col·2 … +2 and z0 + row·2 … +2. Edges are kept on a cell's north (side 0) or west
 * (side 3) edge, so each edge has one spelling: an east edge is the next cell's west edge.
 */

export type DistrictLayout = DistrictLayoutFile;
export type CellTuple = DistrictLayout['cells'][number];
export type EdgeTuple = DistrictLayout['edges'][number];
export type PropTuple = DistrictLayout['props'][number];

export function parseLayout(json: unknown): DistrictLayout {
  const layout = districtLayoutSchema.parse(json);
  for (const id of layout.palette) kitPiece(id);
  for (const b of layout.buildings) {
    kitPiece(b.wall);
    kitPiece(b.floor);
    for (const [id] of b.edges) kitPiece(id);
  }
  return layout;
}

/** A blank layout over `cols × rows` cells with its corner at (x0, z0). */
export function emptyLayout(
  id: string,
  x0: number,
  z0: number,
  cols: number,
  rows: number,
): DistrictLayout {
  return {
    id,
    version: 1,
    cellM: 2,
    bounds: { x0, z0, cols, rows },
    palette: [],
    cells: [],
    edges: [],
    props: [],
    buildings: [],
    marks: [],
  };
}

// --- Grid math ----------------------------------------------------------------------------

export interface CellRef {
  col: number;
  row: number;
}

export function cellAt(layout: DistrictLayout, x: number, z: number): CellRef {
  return {
    col: Math.floor((x - layout.bounds.x0) / CELL_M),
    row: Math.floor((z - layout.bounds.z0) / CELL_M),
  };
}

export function cellCenter(
  layout: DistrictLayout,
  col: number,
  row: number,
): { x: number; z: number } {
  return {
    x: layout.bounds.x0 + (col + 0.5) * CELL_M,
    z: layout.bounds.z0 + (row + 0.5) * CELL_M,
  };
}

export function inBounds(layout: DistrictLayout, col: number, row: number): boolean {
  return col >= 0 && row >= 0 && col < layout.bounds.cols && row < layout.bounds.rows;
}

/** An edge: the north (0) or west (3) side of a cell. */
export interface EdgeRef {
  col: number;
  row: number;
  side: 0 | 3;
}

/** One spelling for an edge: east and south sides become the neighbor's west and north. */
export function normalizeEdge(col: number, row: number, side: number): EdgeRef {
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

/**
 * An edge's midpoint and which way it runs: a north edge runs along x, a west edge along z.
 */
export function edgeSegment(
  layout: DistrictLayout,
  e: EdgeRef,
): { x: number; z: number; alongX: boolean } {
  const x = layout.bounds.x0 + e.col * CELL_M;
  const z = layout.bounds.z0 + e.row * CELL_M;
  return e.side === 0
    ? { x: x + CELL_M / 2, z, alongX: true }
    : { x, z: z + CELL_M / 2, alongX: false };
}

/** The edge nearest a point: whichever cell boundary line is closer. */
export function nearestEdge(layout: DistrictLayout, x: number, z: number): EdgeRef {
  const fx = (x - layout.bounds.x0) / CELL_M;
  const fz = (z - layout.bounds.z0) / CELL_M;
  const dx = Math.abs(fx - Math.round(fx));
  const dz = Math.abs(fz - Math.round(fz));
  return dz < dx
    ? { col: Math.floor(fx), row: Math.round(fz), side: 0 }
    : { col: Math.round(fx), row: Math.floor(fz), side: 3 };
}

export function snapProp(x: number, z: number, yawDeg: number): [number, number, number] {
  const s = (v: number): number => Math.round(v / PROP_SNAP_M) * PROP_SNAP_M;
  const yaw = (((Math.round(yawDeg / PROP_TURN_DEG) * PROP_TURN_DEG) % 360) + 360) % 360;
  return [s(x), s(z), yaw];
}

/**
 * A building's perimeter, edge by edge, in a fixed order: north from the west end, east
 * from the north end, south from the west end, west from the north end. Door numbering
 * and the editor's edge overrides both follow it.
 */
export function perimeter(
  b: DistrictBuildingDef,
): { side: number; index: number; edge: EdgeRef }[] {
  const out: { side: number; index: number; edge: EdgeRef }[] = [];
  for (let i = 0; i < b.cols; i++)
    out.push({ side: 0, index: i, edge: normalizeEdge(b.col + i, b.row, 0) });
  for (let i = 0; i < b.rows; i++)
    out.push({ side: 1, index: i, edge: normalizeEdge(b.col + b.cols - 1, b.row + i, 1) });
  for (let i = 0; i < b.cols; i++)
    out.push({ side: 2, index: i, edge: normalizeEdge(b.col + i, b.row + b.rows - 1, 2) });
  for (let i = 0; i < b.rows; i++)
    out.push({ side: 3, index: i, edge: normalizeEdge(b.col, b.row + i, 3) });
  return out;
}

/** The piece on one perimeter edge: an override, or the building's wall. */
export function perimeterPiece(b: DistrictBuildingDef, side: number, index: number): string {
  const o = b.edges.find(([, s, i]) => s === side && i === index);
  return o ? o[0] : b.wall;
}

export function buildingAtCell(
  layout: DistrictLayout,
  col: number,
  row: number,
): DistrictBuildingDef | undefined {
  return layout.buildings.find(
    (b) => col >= b.col && col < b.col + b.cols && row >= b.row && row < b.row + b.rows,
  );
}

/** The building whose perimeter has this edge, and where on it. */
export function buildingEdge(
  layout: DistrictLayout,
  e: EdgeRef,
): { building: DistrictBuildingDef; side: number; index: number } | undefined {
  for (const b of layout.buildings) {
    for (const p of perimeter(b)) {
      if (p.edge.col === e.col && p.edge.row === e.row && p.edge.side === e.side) {
        return { building: b, side: p.side, index: p.index };
      }
    }
  }
  return undefined;
}

// --- Edits --------------------------------------------------------------------------------

/** The palette slot for a kit id, adding it if new. */
export function paletteIndex(layout: DistrictLayout, id: string): number {
  kitPiece(id);
  let k = layout.palette.indexOf(id);
  if (k < 0) {
    k = layout.palette.length;
    layout.palette.push(id);
  }
  return k;
}

export function pieceId(layout: DistrictLayout, palette: number): string {
  const id = layout.palette[palette];
  if (id === undefined) throw new Error(`layout ${layout.id}: no palette entry ${palette}`);
  return id;
}

export function cellPieceAt(
  layout: DistrictLayout,
  col: number,
  row: number,
): CellTuple | undefined {
  return layout.cells.find((c) => c[1] === col && c[2] === row);
}

export function edgePieceAt(layout: DistrictLayout, e: EdgeRef): EdgeTuple | undefined {
  return layout.edges.find((t) => t[1] === e.col && t[2] === e.row && t[3] === e.side);
}

/** Lays a cell piece, replacing what was there. Returns false outside the bounds. */
export function placeCell(
  layout: DistrictLayout,
  id: string,
  col: number,
  row: number,
  variant = 0,
): boolean {
  if (kitPiece(id).placement !== 'cell') throw new Error(`${id} is not a cell piece`);
  if (!inBounds(layout, col, row)) return false;
  removeCell(layout, col, row);
  layout.cells.push([paletteIndex(layout, id), col, row, variant]);
  return true;
}

export function removeCell(layout: DistrictLayout, col: number, row: number): boolean {
  const k = layout.cells.findIndex((c) => c[1] === col && c[2] === row);
  if (k < 0) return false;
  layout.cells.splice(k, 1);
  return true;
}

/**
 * Lays an edge piece. On a building's perimeter it becomes that building's override
 * instead (setting the building's own wall clears the override).
 */
export function placeEdge(
  layout: DistrictLayout,
  id: string,
  col: number,
  row: number,
  side: number,
  variant = 0,
): boolean {
  if (kitPiece(id).placement !== 'edge') throw new Error(`${id} is not an edge piece`);
  const e = normalizeEdge(col, row, side);
  const onBuilding = buildingEdge(layout, e);
  if (onBuilding) {
    const { building: b, side: s, index } = onBuilding;
    b.edges = b.edges.filter(([, os, oi]) => !(os === s && oi === index));
    if (id !== b.wall) b.edges.push([id, s, index]);
    return true;
  }
  if (
    !inBounds(layout, e.col, e.row) &&
    !inBounds(layout, e.col - 1, e.row) &&
    !inBounds(layout, e.col, e.row - 1)
  ) {
    return false;
  }
  removeEdge(layout, e.col, e.row, e.side);
  layout.edges.push([paletteIndex(layout, id), e.col, e.row, e.side, variant]);
  return true;
}

export function removeEdge(
  layout: DistrictLayout,
  col: number,
  row: number,
  side: number,
): boolean {
  const e = normalizeEdge(col, row, side);
  const onBuilding = buildingEdge(layout, e);
  if (onBuilding) {
    // A building's edge can't be removed, only opened.
    const { building: b, side: s, index } = onBuilding;
    b.edges = b.edges.filter(([, os, oi]) => !(os === s && oi === index));
    b.edges.push(['kit.none', s, index]);
    return true;
  }
  const k = layout.edges.findIndex((t) => t[1] === e.col && t[2] === e.row && t[3] === e.side);
  if (k < 0) return false;
  layout.edges.splice(k, 1);
  return true;
}

export function placeProp(
  layout: DistrictLayout,
  id: string,
  x: number,
  z: number,
  yawDeg: number,
  variant = 0,
): PropTuple {
  if (kitPiece(id).placement !== 'prop') throw new Error(`${id} is not a prop`);
  const [sx, sz, yaw] = snapProp(x, z, yawDeg);
  const t: PropTuple = [paletteIndex(layout, id), sx, sz, yaw, variant];
  layout.props.push(t);
  return t;
}

/** The prop nearest (x, z) within `radius`, by index. */
export function propNear(layout: DistrictLayout, x: number, z: number, radius = 1.5): number {
  let best = -1;
  let bestD = radius;
  layout.props.forEach(([p, px, pz], k) => {
    const piece = findKitPiece(layout.palette[p] ?? '');
    const r = piece ? Math.max(piece.sizeM[0], piece.sizeM[1]) / 2 : 0.5;
    const d = Math.hypot(px - x, pz - z) - r;
    if (d < bestD) {
      bestD = d;
      best = k;
    }
  });
  return best;
}

/** Cells two buildings would share: a new building may not overlap another. */
export function buildingFits(
  layout: DistrictLayout,
  b: Pick<DistrictBuildingDef, 'col' | 'row' | 'cols' | 'rows'>,
  ignore?: string,
): boolean {
  if (
    !inBounds(layout, b.col, b.row) ||
    !inBounds(layout, b.col + b.cols - 1, b.row + b.rows - 1)
  ) {
    return false;
  }
  return !layout.buildings.some(
    (o) =>
      o.id !== ignore &&
      b.col < o.col + o.cols &&
      o.col < b.col + b.cols &&
      b.row < o.row + o.rows &&
      o.row < b.row + b.rows,
  );
}

/** Drops palette entries nothing uses and renumbers the tuples, for a tidy save. */
export function compactPalette(layout: DistrictLayout): void {
  const used = new Set<number>();
  for (const c of layout.cells) used.add(c[0]);
  for (const e of layout.edges) used.add(e[0]);
  for (const p of layout.props) used.add(p[0]);
  const ids = [...used].map((k) => pieceId(layout, k)).sort();
  const remap = new Map([...used].map((k) => [k, ids.indexOf(pieceId(layout, k))]));
  for (const c of layout.cells) c[0] = remap.get(c[0]) ?? c[0];
  for (const e of layout.edges) e[0] = remap.get(e[0]) ?? e[0];
  for (const p of layout.props) p[0] = remap.get(p[0]) ?? p[0];
  layout.palette = ids;
  const byCell = (a: number[], b: number[]): number =>
    (a[2] ?? 0) - (b[2] ?? 0) || (a[1] ?? 0) - (b[1] ?? 0) || (a[3] ?? 0) - (b[3] ?? 0);
  layout.cells.sort(byCell);
  layout.edges.sort(byCell);
}

/**
 * A stable fingerprint of what the navmesh is baked from (FNV-1a over the layout JSON),
 * so a test and the editor can tell when the bake is out of date.
 */
export function layoutHash(layout: DistrictLayout): string {
  const text = JSON.stringify({ ...layout, marks: undefined });
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}
