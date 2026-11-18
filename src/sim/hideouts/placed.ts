import { footprintCells, propPoint, type BuildGrid, type BuildSite, type Piece } from './grid';
import { CELL_M, LEVEL_M, ROOF_RISE_M, structure } from './structures';
import { cellGround } from './validity';

/**
 * Where each piece stands, for the renderer (piece B) and for walking (plan 09 §10
 * colliders; Phase 8 piece A). Site-local meters: x along, z inland, y up from the site's
 * level-0 floor datum.
 *
 * - Cell, water and roof pieces: x, z at the footprint's middle; `rot` 0–3.
 * - Edge pieces: x, z at the edge's midpoint; `rot` the side of the cell it stands on
 *   (0 the -z side, 1 +x, 2 +z, 3 -x), which is the way its outside faces.
 * - Props: x, z as placed; `yawDeg` clockwise from above (90 turns -z toward +x).
 *
 * y is the walking surface for bases, the foot for edges and objects, and the eave for
 * roofs (a roof on level L sits on level L-1's walls) and chimneys, plus `riseM` for roof
 * cells in from the eave and for the gables beside them. A sloped gable's high end is its
 * local +x, so it's spelled from whichever side of its edge gives the rot that points up
 * the roof (rot 1 rising toward +z, rot 3 toward -z). `extendM` is how far a foundation, piling, pier or slipway reaches down
 * to the ground or lake bed under it. Pieces on bare ground stand at the ground.
 */
export interface PlacedRender {
  uid: number;
  id: string;
  material: string;
  built: boolean;
  x: number;
  y: number;
  z: number;
  rot: number;
  yawDeg?: number;
  paint?: number;
  extendM?: number;
  riseM?: number;
}

const EDGE_MID: Readonly<Record<number, [number, number]>> = {
  0: [0.5, 0],
  1: [1, 0.5],
  2: [0.5, 1],
  3: [0, 0.5],
};

function centerOf(cells: readonly { col: number; row: number }[]): { x: number; z: number } {
  let x = 0;
  let z = 0;
  for (const c of cells) {
    x += (c.col + 0.5) * CELL_M;
    z += (c.row + 0.5) * CELL_M;
  }
  return { x: x / cells.length, z: z / cells.length };
}

/** How many roof cells on this level lie between a roof cell and the roof's edge, along its rot axis. */
function roofSteps(grid: BuildGrid, p: Piece): number {
  const [dc, dr] = p.rot & 1 ? [1, 0] : [0, 1];
  const isRoof = (c: number, r: number): boolean => {
    const b = grid.baseAt(c, r, p.level);
    return !!b && structure(b.piece.id).placement === 'roof';
  };
  const run = (sign: number): number => {
    let n = 0;
    while (isRoof(p.col + sign * dc * (n + 1), p.row + sign * dr * (n + 1))) n++;
    return n;
  };
  return Math.min(run(1), run(-1));
}

export function placedRender(grid: BuildGrid, site: BuildSite): PlacedRender[] {
  const out: PlacedRender[] = [];
  for (const { uid, piece: p, built } of grid.all()) {
    const def = structure(p.id);
    const material = (def.variants[p.variant] ?? def.variants[0])?.material ?? 'timber';
    const base: PlacedRender = {
      uid,
      id: p.id,
      material,
      built,
      x: 0,
      y: p.level * LEVEL_M,
      z: 0,
      rot: p.rot,
    };
    if (p.paint) base.paint = p.paint;
    switch (def.placement) {
      case 'cell':
      case 'water':
      case 'roof': {
        const cells = footprintCells(def, p);
        Object.assign(base, centerOf(cells));
        if (def.placement === 'roof') {
          const steps = roofSteps(grid, p);
          if (steps > 0) base.riseM = steps * ROOF_RISE_M;
        } else if (p.level === 0 && (def.layer === 'base' || def.placement === 'water')) {
          const low = Math.min(...cells.map((c) => cellGround(site, c.col, c.row).min));
          base.extendM = Math.max(0, site.baseM - low);
        } else if (def.id === 'build.chimney') {
          // The stack is drawn from the eave of the level it stands on up (piece B).
          base.y = (p.level + 1) * LEVEL_M;
        } else if (p.level === 0 && !cells.every((c) => grid.floorAt(c.col, c.row, 0))) {
          base.y = cellGround(site, p.col, p.row).mid - site.baseM;
        }
        break;
      }
      case 'edge': {
        const [fx, fz] = EDGE_MID[p.rot & 3] ?? [0.5, 0];
        base.x = (p.col + fx) * CELL_M;
        base.z = (p.row + fz) * CELL_M;
        if (p.level === 0 && !def.fitsIn) {
          const n = p.rot & 3;
          const other = {
            col: p.col + (n === 1 ? 1 : n === 3 ? -1 : 0),
            row: p.row + (n === 2 ? 1 : n === 0 ? -1 : 0),
          };
          if (!grid.floorAt(p.col, p.row, 0) && !grid.floorAt(other.col, other.row, 0)) {
            base.y = site.ground(base.x, base.z) - site.baseM;
          }
        }
        if (def.onRoof) {
          // A gable rises with the roof beside it (piece B stacks courses down to the eave).
          const n = p.rot & 3;
          const sides = [
            { col: p.col, row: p.row },
            {
              col: p.col + (n === 1 ? 1 : n === 3 ? -1 : 0),
              row: p.row + (n === 2 ? 1 : n === 0 ? -1 : 0),
            },
          ];
          let steps = 0;
          for (const c of sides) {
            const roof = grid.baseAt(c.col, c.row, p.level);
            if (roof && structure(roof.piece.id).placement === 'roof') {
              steps = Math.max(steps, roofSteps(grid, roof.piece));
            }
          }
          if (steps > 0) base.riseM = steps * ROOF_RISE_M;
        }
        break;
      }
      case 'prop': {
        const { x, z } = propPoint(p);
        base.x = x;
        base.z = z;
        base.yawDeg = (p.rot * 15) % 360;
        const c = { col: Math.floor(x / CELL_M), row: Math.floor(z / CELL_M) };
        if (p.level === 0 && !grid.floorAt(c.col, c.row, 0))
          base.y = site.ground(x, z) - site.baseM;
        break;
      }
    }
    out.push(base);
  }
  return out;
}

/**
 * A collider for walking (plan 09 §10: from grid occupancy, no physics engine), an
 * axis-aligned box in site-local meters. `floor` is walkable on top; `solid` blocks;
 * `door` is a doorway's opening, open or shut as the build mode decides.
 */
export interface HideoutCollider {
  kind: 'floor' | 'solid' | 'door';
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
  minY: number;
  maxY: number;
  uid: number;
}

const WALL_HALF_M = 0.1;
const DOOR_OPENING_M = 1.1;

/** The stairs' steps, as the render draws them: twelve treads rising toward local +z (rot 0
 * up toward +z, 1 toward -x, 2 toward -z, 3 toward +x). Each tread is a walkable box from its
 * own step to the top, so a step is only as high as one tread (under the controller's step
 * height) and the solid stairs no longer stand as a 3 m wall. */
function stairTreads(
  r: { x: number; y: number; uid: number },
  p: { rot: number },
  b: { minX: number; maxX: number; minZ: number; maxZ: number },
  steps: number,
  rise: number,
  baseY: number,
  bottomY: number,
): HideoutCollider[] {
  const STAIR_STEPS = steps;
  const [dx, dz] = [
    [0, 1],
    [-1, 0],
    [0, -1],
    [1, 0],
  ][p.rot & 3] as [number, number];
  const span = dz !== 0 ? b.maxZ - b.minZ : b.maxX - b.minX;
  const run = span / STAIR_STEPS;
  const out: HideoutCollider[] = [];
  for (let k = 0; k < STAIR_STEPS; k++) {
    const from = k * run; // distance up the stairs from the bottom edge
    const top = baseY + ((k + 1) * rise) / STAIR_STEPS;
    if (dz !== 0) {
      const start = dz > 0 ? b.minZ + from : b.maxZ - from;
      const end = dz > 0 ? b.maxZ : b.minZ;
      out.push({
        kind: 'floor',
        minX: b.minX,
        maxX: b.maxX,
        minZ: Math.min(start, end),
        maxZ: Math.max(start, end),
        minY: bottomY,
        maxY: top,
        uid: r.uid,
      });
    } else {
      const start = dx > 0 ? b.minX + from : b.maxX - from;
      const end = dx > 0 ? b.maxX : b.minX;
      out.push({
        kind: 'floor',
        minX: Math.min(start, end),
        maxX: Math.max(start, end),
        minZ: b.minZ,
        maxZ: b.maxZ,
        minY: bottomY,
        maxY: top,
        uid: r.uid,
      });
    }
  }
  return out;
}

/** Colliders for the built pieces (ghosts don't collide). */
export function hideoutColliders(grid: BuildGrid, site: BuildSite): HideoutCollider[] {
  const out: HideoutCollider[] = [];
  for (const r of placedRender(grid, site)) {
    if (!r.built) continue;
    const def = structure(r.id);
    const h = def.heightM;
    const p = grid.get(r.uid)?.piece;
    if (!p) continue;
    if (def.placement === 'edge') {
      if (def.collider === 'none' || def.fitsIn) continue;
      const alongX = (p.rot & 1) === 0;
      const half = CELL_M / 2;
      const box = (a0: number, a1: number, kind: HideoutCollider['kind']): HideoutCollider =>
        alongX
          ? {
              kind,
              minX: r.x + a0,
              maxX: r.x + a1,
              minZ: r.z - WALL_HALF_M,
              maxZ: r.z + WALL_HALF_M,
              minY: r.y,
              maxY: r.y + h,
              uid: r.uid,
            }
          : {
              kind,
              minX: r.x - WALL_HALF_M,
              maxX: r.x + WALL_HALF_M,
              minZ: r.z + a0,
              maxZ: r.z + a1,
              minY: r.y,
              maxY: r.y + h,
              uid: r.uid,
            };
      if (def.collider === 'door') {
        const o = DOOR_OPENING_M / 2;
        out.push(box(-half, -o, 'solid'), box(o, half, 'solid'), box(-o, o, 'door'));
      } else out.push(box(-half, half, 'solid'));
      continue;
    }
    if (def.placement === 'roof' || def.collider === 'none' || def.collider === 'flat') continue;
    if (def.placement === 'prop') {
      const [sx, sz] = def.sizeM ?? [0.5, 0.5];
      const turned = Math.round((r.yawDeg ?? 0) / 90) % 2 === 1;
      const [hx, hz] = turned ? [sz / 2, sx / 2] : [sx / 2, sz / 2];
      out.push({
        kind: 'solid',
        minX: r.x - hx,
        maxX: r.x + hx,
        minZ: r.z - hz,
        maxZ: r.z + hz,
        minY: r.y,
        maxY: r.y + h,
        uid: r.uid,
      });
      continue;
    }
    const cells = footprintCells(def, p);
    const minX = Math.min(...cells.map((c) => c.col)) * CELL_M;
    const minZ = Math.min(...cells.map((c) => c.row)) * CELL_M;
    const maxX = (Math.max(...cells.map((c) => c.col)) + 1) * CELL_M;
    const maxZ = (Math.max(...cells.map((c) => c.row)) + 1) * CELL_M;
    if (def.id === 'build.stairs') {
      out.push(...stairTreads(r, p, { minX, maxX, minZ, maxZ }, 12, h, r.y, r.y));
      continue;
    }
    if (def.id === 'build.foundation_stairs') {
      // Three steps up to the foundation's top, the render's own rise (0.2 m a step).
      out.push(
        ...stairTreads(
          r,
          p,
          { minX, maxX, minZ, maxZ },
          3,
          def.heightM,
          r.y - def.heightM,
          r.y - def.heightM - (r.extendM ?? 0),
        ),
      );
      continue;
    }
    if (def.layer === 'base') {
      out.push({
        kind: 'floor',
        minX,
        maxX,
        minZ,
        maxZ,
        minY: r.y - h - (r.extendM ?? 0),
        maxY: r.y,
        uid: r.uid,
      });
    } else {
      out.push({ kind: 'solid', minX, maxX, minZ, maxZ, minY: r.y, maxY: r.y + h, uid: r.uid });
    }
  }
  return out;
}
