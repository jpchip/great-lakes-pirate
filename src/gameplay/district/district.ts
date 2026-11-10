import type {
  DistrictBuildingDef,
  DistrictMark,
  KitPiece,
  Surface,
} from '../../../data/schemas/districts';
import { ColliderSet, type BoxCollider, type Collider } from '../onfoot/colliders';
import type { OnFootZone } from '../onfoot/controller';
import type { Heightfield } from '../onfoot/heightfield';
import { CELL_M, DECK_THICK_M, DOOR_HEIGHT_M, kitPiece, WALL_M } from '../../sim/district/kit';
import {
  edgeSegment,
  perimeter,
  perimeterPiece,
  pieceId,
  type DistrictLayout,
  type EdgeRef,
} from '../../sim/district/layout';

/**
 * A district built from its layout (plan 08 §2, §13–15; Phase 7 piece C): the colliders the
 * on-foot controller walks on, with a surface on every walkable top; the lamps whose pools
 * of light perception reads; the doors, their buildings and which port tab a shop door
 * opens; the climbs (ladders and vaults); and the marks the later pieces hang guards, loot
 * and the gangway on. Pure and deterministic, so the navmesh bake, the renderer and the
 * tests all see the same district.
 */

export interface DistrictLamp {
  id: string;
  piece: string;
  x: number;
  /** The flame. */
  y: number;
  z: number;
  radiusM: number;
  intensity: number;
  color: string;
}

export interface DistrictDoor {
  /** `<building>.door<n>` in perimeter order, or `door.<col>_<row>_<side>` for a loose one. */
  id: string;
  piece: string;
  building: string | undefined;
  /** The middle of the opening, on the wall line. */
  x: number;
  z: number;
  /** The wall runs along x (a north or south wall) or along z. */
  alongX: boolean;
  widthM: number;
  /** The threshold. */
  y: number;
  /** A shop door opens this port-screen tab by day (plan 08 §20.6 decision 3). */
  opens: DistrictBuildingDef['opens'];
}

export interface DistrictBuilding {
  def: DistrictBuildingDef;
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
  floorY: number;
  eavesY: number;
  /** The top of the roof (the ridge, or the false front's parapet). */
  topY: number;
  doors: string[];
}

export interface DistrictClimb {
  kind: 'vault' | 'ladder';
  piece: string;
  x: number;
  z: number;
  /** From and to, meters: a ladder from the water to the deck, a vault onto the top. */
  y0: number;
  y1: number;
}

/** A pile under a deck: drawn by the renderer, swum round on foot. */
export interface DistrictPile {
  x: number;
  z: number;
  y0: number;
  y1: number;
}

/** A placed piece, resolved: what the renderer draws and where. */
export interface PlacedPiece {
  piece: KitPiece;
  x: number;
  /** The base the piece stands on. */
  y: number;
  z: number;
  /** Clockwise from north, radians (props), or 0 / π/2 for an edge along x / along z. */
  heading: number;
  /** For edge pieces: the top of the wall (a building's eaves). */
  topY: number;
  variant: number;
  /** The building it belongs to (perimeter walls, floors), for roof fade and paint. */
  building: string | undefined;
}

export interface DistrictModel extends OnFootZone {
  layout: DistrictLayout;
  /** Walkable bounds, local meters. */
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
  buildings: DistrictBuilding[];
  lamps: DistrictLamp[];
  doors: DistrictDoor[];
  climbs: DistrictClimb[];
  piles: DistrictPile[];
  marks: DistrictMark[];
  cells: PlacedPiece[];
  edges: PlacedPiece[];
  props: PlacedPiece[];
  mark(id: string): DistrictMark;
  /** What's underfoot: with a height, the deck, floor or crate top there; without, the cell. */
  surfaceAt(x: number, z: number, y?: number): Surface;
  /** The building whose inside holds the point, if any (roof fade, close camera). */
  buildingAt(x: number, y: number, z: number): DistrictBuilding | undefined;
  /** The highest walkable top at (x, z): the ground, a deck or a floor. */
  floorAt(x: number, z: number): number;
}

const DEG = Math.PI / 180;
/** The invisible fence round the walkable bounds. */
const BOUND_WALL_M = 0.5;
/** A wall reaches this far below the lowest ground under it, so no gap shows. */
const FOOTING_M = 0.3;

export function buildDistrict(
  layout: DistrictLayout,
  ground: Heightfield,
  waterLevel = 0,
): DistrictModel {
  const { x0, z0, cols, rows } = layout.bounds;
  const colliders = new ColliderSet();
  const add = (c: Collider): void => colliders.add(c);
  const groundMin = (xa: number, za: number, xb: number, zb: number): number =>
    Math.min(
      ground.heightAt(xa, za),
      ground.heightAt(xb, za),
      ground.heightAt(xa, zb),
      ground.heightAt(xb, zb),
    );
  const groundMax = (xa: number, za: number, xb: number, zb: number): number =>
    Math.max(
      ground.heightAt(xa, za),
      ground.heightAt(xb, za),
      ground.heightAt(xa, zb),
      ground.heightAt(xb, zb),
      ground.heightAt((xa + xb) / 2, (za + zb) / 2),
    );

  // Walkable tops per cell, from cell pieces and building floors.
  const top = new Map<number, { y: number; surface: Surface; deck: boolean }>();
  const cellKey = (c: number, r: number): number => r * 65536 + c;
  const cellSurface = new Map<number, Surface>();

  // --- Buildings ------------------------------------------------------------------------
  const buildings: DistrictBuilding[] = [];
  for (const def of layout.buildings) {
    const minX = x0 + def.col * CELL_M;
    const minZ = z0 + def.row * CELL_M;
    const maxX = minX + def.cols * CELL_M;
    const maxZ = minZ + def.rows * CELL_M;
    const floor = kitPiece(def.floor);
    let gmax = -Infinity;
    for (let c = 0; c <= def.cols; c++) {
      for (let r = 0; r <= def.rows; r++) {
        gmax = Math.max(gmax, ground.heightAt(minX + c * CELL_M, minZ + r * CELL_M));
      }
    }
    const floorY = gmax + floor.heightM;
    const eavesY = floorY + def.wallHeightM;
    const span = def.ridge === 'x' ? maxZ - minZ : maxX - minX;
    const topY =
      def.roof === 'gable'
        ? eavesY + Math.min(span * 0.35, 5)
        : def.roof === 'falseFront'
          ? eavesY + 1.8
          : eavesY + 0.4;
    buildings.push({ def, minX, maxX, minZ, maxZ, floorY, eavesY, topY, doors: [] });
    for (let c = def.col; c < def.col + def.cols; c++) {
      for (let r = def.row; r < def.row + def.rows; r++) {
        top.set(cellKey(c, r), { y: floorY, surface: floor.surface ?? 'wood', deck: false });
      }
    }
    add({
      kind: 'box',
      x: (minX + maxX) / 2,
      z: (minZ + maxZ) / 2,
      halfX: (maxX - minX) / 2,
      halfZ: (maxZ - minZ) / 2,
      yaw: 0,
      minY: groundMin(minX, minZ, maxX, maxZ) - FOOTING_M,
      maxY: floorY,
      surface: floor.surface ?? 'wood',
    });
  }

  // --- Cell pieces ----------------------------------------------------------------------
  const cells: PlacedPiece[] = [];
  const piles: DistrictPile[] = [];
  // Decks and floors collide as runs along a row, not cell by cell.
  const runs = new Map<
    string,
    { row: number; c0: number; c1: number; minY: number; maxY: number; surface: Surface }
  >();
  const sortedCells = [...layout.cells].sort((a, b) => a[2] - b[2] || a[1] - b[1]);
  for (const [p, col, row, variant] of sortedCells) {
    const piece = kitPiece(pieceId(layout, p));
    const cx = x0 + (col + 0.5) * CELL_M;
    const cz = z0 + (row + 0.5) * CELL_M;
    const xa = cx - CELL_M / 2;
    const za = cz - CELL_M / 2;
    const xb = xa + CELL_M;
    const zb = za + CELL_M;
    let y: number;
    let minY: number;
    if (piece.collider === 'deck') {
      y = piece.deckM ?? 1.6;
      minY = y - DECK_THICK_M;
      const g = ground.heightAt(cx, cz);
      if ((col + row) % 2 === 0 && g < minY - 0.2)
        piles.push({ x: cx, z: cz, y0: g - 0.5, y1: minY });
    } else if (piece.collider === 'floor') {
      y = groundMax(xa, za, xb, zb) + piece.heightM;
      minY = groundMin(xa, za, xb, zb) - FOOTING_M;
    } else {
      y = ground.heightAt(cx, cz);
      minY = y;
    }
    const surface = piece.surface ?? 'dirt';
    cells.push({ piece, x: cx, y, z: cz, heading: 0, topY: y, variant, building: undefined });
    if (!top.has(cellKey(col, row))) {
      if (piece.collider === 'deck' || piece.collider === 'floor') {
        top.set(cellKey(col, row), { y, surface, deck: piece.collider === 'deck' });
      } else {
        cellSurface.set(cellKey(col, row), surface);
      }
    }
    if (piece.collider !== 'deck' && piece.collider !== 'floor') continue;
    const key = `${piece.id}:${row}:${y.toFixed(2)}`;
    const run = runs.get(key);
    if (run && run.c1 === col - 1) {
      run.c1 = col;
      run.minY = Math.min(run.minY, minY);
    } else {
      if (run) addRun(run);
      runs.set(key, { row, c0: col, c1: col, minY, maxY: y, surface });
    }
  }
  function addRun(r: {
    row: number;
    c0: number;
    c1: number;
    minY: number;
    maxY: number;
    surface: Surface;
  }): void {
    add({
      kind: 'box',
      x: x0 + ((r.c0 + r.c1 + 1) / 2) * CELL_M,
      z: z0 + (r.row + 0.5) * CELL_M,
      halfX: ((r.c1 - r.c0 + 1) * CELL_M) / 2,
      halfZ: CELL_M / 2,
      yaw: 0,
      minY: r.minY,
      maxY: r.maxY,
      surface: r.surface,
    });
  }
  for (const r of runs.values()) addRun(r);
  for (const pile of piles) {
    add({
      kind: 'cylinder',
      x: pile.x,
      z: pile.z,
      radius: 0.16,
      minY: pile.y0,
      maxY: pile.y1,
      blocksSight: false,
    });
  }

  /** The walkable top at (x, z): a cell's deck or floor, else the ground. */
  const floorAt = (x: number, z: number): number => {
    const c = Math.floor((x - x0) / CELL_M);
    const r = Math.floor((z - z0) / CELL_M);
    const t = top.get(cellKey(c, r));
    const g = ground.heightAt(x, z);
    return t ? (t.deck ? t.y : Math.max(t.y, g)) : g;
  };

  // --- Edges ----------------------------------------------------------------------------
  const edges: PlacedPiece[] = [];
  const doors: DistrictDoor[] = [];
  const climbs: DistrictClimb[] = [];
  const edgeBase = (e: EdgeRef): number => {
    // The higher of the two cells either side (a deck or floor), else the ground.
    const { x, z, alongX } = edgeSegment(layout, e);
    const ox = alongX ? 0 : 0.3;
    const oz = alongX ? 0.3 : 0;
    return Math.max(floorAt(x - ox, z - oz), floorAt(x + ox, z + oz));
  };
  const edgeGround = (e: EdgeRef): number => {
    const { x, z, alongX } = edgeSegment(layout, e);
    const h = CELL_M / 2;
    return alongX
      ? Math.min(ground.heightAt(x - h, z), ground.heightAt(x + h, z))
      : Math.min(ground.heightAt(x, z - h), ground.heightAt(x, z + h));
  };

  const placeEdge = (
    piece: KitPiece,
    e: EdgeRef,
    baseY: number,
    topY: number,
    variant: number,
    building: DistrictBuilding | undefined,
    doorIndex: () => number,
  ): void => {
    const seg = edgeSegment(layout, e);
    edges.push({
      piece,
      x: seg.x,
      y: baseY,
      z: seg.z,
      heading: seg.alongX ? 0 : Math.PI / 2,
      topY,
      variant,
      building: building?.def.id,
    });
    const footY = Math.min(baseY, edgeGround(e)) - FOOTING_M;
    // A wall box spanning `from`..`to` along the edge (meters from its middle).
    const wall = (
      from: number,
      to: number,
      minY: number,
      maxY: number,
      blocksSight: boolean,
    ): void => {
      const mid = (from + to) / 2;
      const half = (to - from) / 2;
      const b: BoxCollider = seg.alongX
        ? {
            kind: 'box',
            x: seg.x + mid,
            z: seg.z,
            halfX: half,
            halfZ: WALL_M / 2,
            yaw: 0,
            minY,
            maxY,
          }
        : {
            kind: 'box',
            x: seg.x,
            z: seg.z + mid,
            halfX: WALL_M / 2,
            halfZ: half,
            yaw: 0,
            minY,
            maxY,
          };
      if (!blocksSight) b.blocksSight = false;
      add(b);
    };
    // Walls overlap half their thickness at the corners so no crack opens between them.
    const h = CELL_M / 2 + WALL_M / 2;
    switch (piece.collider) {
      case 'wall':
      case 'window':
      case 'fence':
        wall(-h, h, footY, topY, piece.blocksSight);
        break;
      case 'rail':
        wall(-h, h, baseY, baseY + piece.heightM, false);
        break;
      case 'door': {
        const w = piece.openingM ?? 1.4;
        wall(-h, -w / 2, footY, topY, piece.blocksSight);
        wall(w / 2, h, footY, topY, piece.blocksSight);
        if (topY > baseY + DOOR_HEIGHT_M + 0.05)
          wall(-w / 2, w / 2, baseY + DOOR_HEIGHT_M, topY, piece.blocksSight);
        const n = doorIndex();
        const door: DistrictDoor = {
          id: building ? `${building.def.id}.door${n}` : `door.${e.col}_${e.row}_${e.side}`,
          piece: piece.id,
          building: building?.def.id,
          x: seg.x,
          z: seg.z,
          alongX: seg.alongX,
          widthM: w,
          y: baseY,
          opens: building?.def.opens,
        };
        doors.push(door);
        if (building) building.doors.push(door.id);
        break;
      }
      default:
        break;
    }
    if (piece.climb === 'ladder') {
      climbs.push({
        kind: 'ladder',
        piece: piece.id,
        x: seg.x,
        z: seg.z,
        y0: waterLevel,
        y1: baseY,
      });
    } else if (piece.climb === 'vault') {
      climbs.push({
        kind: 'vault',
        piece: piece.id,
        x: seg.x,
        z: seg.z,
        y0: baseY,
        y1: baseY + piece.heightM,
      });
    }
  };

  for (const b of buildings) {
    let n = 0;
    for (const { side, index, edge } of perimeter(b.def)) {
      const piece = kitPiece(perimeterPiece(b.def, side, index));
      placeEdge(piece, edge, b.floorY, b.eavesY, 0, b, () => n++);
    }
  }
  for (const [p, col, row, side, variant] of layout.edges) {
    const piece = kitPiece(pieceId(layout, p));
    const e: EdgeRef = { col, row, side: side === 0 ? 0 : 3 };
    const baseY = edgeBase(e);
    const inside = buildings.find((b) => {
      const seg = edgeSegment(layout, e);
      return seg.x > b.minX && seg.x < b.maxX && seg.z > b.minZ && seg.z < b.maxZ;
    });
    // A partition inside a building runs floor to eaves; outside, a wall is its own height.
    const topY = inside ? inside.eavesY : baseY + piece.heightM;
    placeEdge(piece, e, inside ? inside.floorY : baseY, topY, variant, undefined, () => 0);
  }

  // --- Props ----------------------------------------------------------------------------
  const props: PlacedPiece[] = [];
  const lamps: DistrictLamp[] = [];
  for (const [p, x, z, yawDeg, variant] of layout.props) {
    const piece = kitPiece(pieceId(layout, p));
    const y = floorAt(x, z);
    const heading = yawDeg * DEG;
    const inBuilding = buildings.find((b) => x > b.minX && x < b.maxX && z > b.minZ && z < b.maxZ);
    props.push({
      piece,
      x,
      y,
      z,
      heading,
      topY: y + piece.heightM,
      variant,
      building: inBuilding?.def.id,
    });
    const [w, d] = piece.sizeM;
    const blocks = piece.blocksSight;
    if (piece.collider === 'solid') {
      if (piece.round) {
        add({
          kind: 'cylinder',
          x,
          z,
          radius: w / 2,
          minY: y,
          maxY: y + piece.heightM,
          ...(blocks ? {} : { blocksSight: false }),
          surface: 'wood',
        });
      } else {
        add({
          kind: 'box',
          x,
          z,
          halfX: w / 2,
          halfZ: d / 2,
          yaw: -heading,
          minY: y,
          maxY: y + piece.heightM,
          surface: 'wood',
          ...(blocks ? {} : { blocksSight: false }),
        });
      }
    } else if (piece.collider === 'post') {
      add({
        kind: 'cylinder',
        x,
        z,
        radius: w / 2,
        minY: y,
        maxY: y + piece.heightM,
        blocksSight: false,
      });
    }
    if (piece.light) {
      lamps.push({
        id: `lamp.${lamps.length}`,
        piece: piece.id,
        x,
        y: y + piece.light.heightM,
        z,
        radiusM: piece.light.radiusM,
        intensity: piece.light.intensity,
        color: piece.light.color,
      });
    }
    if (piece.climb === 'vault') {
      climbs.push({ kind: 'vault', piece: piece.id, x, z, y0: y, y1: y + piece.heightM });
    }
  }

  // --- Bounds ---------------------------------------------------------------------------
  const minX = x0;
  const minZ = z0;
  const maxX = x0 + cols * CELL_M;
  const maxZ = z0 + rows * CELL_M;
  const fence = (x: number, z: number, hx: number, hz: number): void =>
    add({
      kind: 'box',
      x,
      z,
      halfX: hx,
      halfZ: hz,
      yaw: 0,
      minY: -6,
      maxY: 12,
      blocksSight: false,
    });
  fence(
    (minX + maxX) / 2,
    minZ - BOUND_WALL_M / 2,
    (maxX - minX) / 2 + BOUND_WALL_M,
    BOUND_WALL_M / 2,
  );
  fence(
    (minX + maxX) / 2,
    maxZ + BOUND_WALL_M / 2,
    (maxX - minX) / 2 + BOUND_WALL_M,
    BOUND_WALL_M / 2,
  );
  fence(minX - BOUND_WALL_M / 2, (minZ + maxZ) / 2, BOUND_WALL_M / 2, (maxZ - minZ) / 2);
  fence(maxX + BOUND_WALL_M / 2, (minZ + maxZ) / 2, BOUND_WALL_M / 2, (maxZ - minZ) / 2);

  const marks = layout.marks;
  const scratch: Collider[] = [];
  return {
    layout,
    ground,
    colliders,
    waterLevel,
    minX,
    maxX,
    minZ,
    maxZ,
    buildings,
    lamps,
    doors,
    climbs,
    piles,
    marks,
    cells,
    edges,
    props,
    floorAt,
    mark(id) {
      const m = marks.find((k) => k.id === id);
      if (!m) throw new Error(`district ${layout.id}: no mark ${id}`);
      return m;
    },
    surfaceAt(x, z, y) {
      let best: Surface | undefined;
      let bestTop = -Infinity;
      for (const c of colliders.query(x, z, 0.05, scratch)) {
        if (y === undefined) break;
        if (!c.surface || c.maxY > y + 0.1 || c.maxY < y - 0.25 || c.maxY < bestTop) continue;
        const inside =
          c.kind === 'cylinder'
            ? Math.hypot(x - c.x, z - c.z) <= c.radius + 0.05
            : insideBox(c, x, z);
        if (!inside) continue;
        best = c.surface;
        bestTop = c.maxY;
      }
      if (best) return best;
      const c = Math.floor((x - x0) / CELL_M);
      const r = Math.floor((z - z0) / CELL_M);
      return cellSurface.get(cellKey(c, r)) ?? 'dirt';
    },
    buildingAt(x, y, z) {
      return buildings.find(
        (b) =>
          x > b.minX &&
          x < b.maxX &&
          z > b.minZ &&
          z < b.maxZ &&
          y >= b.floorY - 0.6 &&
          y < b.eavesY,
      );
    },
  };
}

function insideBox(b: BoxCollider, x: number, z: number): boolean {
  const cos = Math.cos(b.yaw);
  const sin = Math.sin(b.yaw);
  const wx = x - b.x;
  const wz = z - b.z;
  const lx = wx * cos - wz * sin;
  const lz = wx * sin + wz * cos;
  return Math.abs(lx) <= b.halfX + 0.05 && Math.abs(lz) <= b.halfZ + 0.05;
}
