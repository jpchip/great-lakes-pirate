import type { Collider } from '../../gameplay/onfoot/colliders';
import { DOOR_HEIGHT_M, WALL_M } from './kit';
import type { DistrictModel } from './district';
import { layoutHash } from './layout';
import { NavMesh, type NavDoorLink, type NavMeshData, type NavPoint } from './navmesh';

/**
 * The pure half of the navmesh bake (plan 08 §5.3; Phase 7 piece C): the triangle soup
 * recast voxelizes, and what happens to its polygons after. The recast call itself is in
 * tools/district/bake.run.ts, so the WASM never reaches the game bundle.
 *
 * The soup is the ground above the water plus every collider as a closed solid, with each
 * doorway shut by a slab, so the polygons stop at the door; the doors come back as links.
 */

/** A guard: the controller's capsule (gameplay/onfoot/controller.ts). */
export const GUARD_AGENT = { radiusM: 0.3, heightM: 1.75, climbM: 0.4, maxSlopeDeg: 42 } as const;

export interface TriangleSoup {
  positions: number[];
  indices: number[];
}

/** Ground triangles stop this far above the water, so guards don't wade. */
const SHORE_MARGIN_M = 0.15;
/** Where a door link's ends sit, in front of and behind the wall line. */
const LINK_REACH_M = 0.7;

export function navGeometry(model: DistrictModel): TriangleSoup {
  const positions: number[] = [];
  const indices: number[] = [];
  const vert = (x: number, y: number, z: number): number => {
    positions.push(x, y, z);
    return positions.length / 3 - 1;
  };

  // The ground inside the bounds, 1 m quads, two triangles each, both wound up.
  const g = model.ground;
  const i0 = Math.max(0, Math.floor((model.minX - g.originX) / g.cellSize));
  const i1 = Math.min(g.samplesX - 1, Math.ceil((model.maxX - g.originX) / g.cellSize));
  const j0 = Math.max(0, Math.floor((model.minZ - g.originZ) / g.cellSize));
  const j1 = Math.min(g.samplesZ - 1, Math.ceil((model.maxZ - g.originZ) / g.cellSize));
  const w = i1 - i0 + 1;
  const base = positions.length / 3;
  for (let j = j0; j <= j1; j++) {
    for (let i = i0; i <= i1; i++) {
      vert(g.originX + i * g.cellSize, g.sample(i, j), g.originZ + j * g.cellSize);
    }
  }
  const at = (i: number, j: number): number => base + (j - j0) * w + (i - i0);
  const dry = model.waterLevel + SHORE_MARGIN_M;
  for (let j = j0; j < j1; j++) {
    for (let i = i0; i < i1; i++) {
      const a = at(i, j);
      const b = at(i + 1, j);
      const c = at(i + 1, j + 1);
      const d = at(i, j + 1);
      const ys = [a, b, c, d].map((k) => positions[k * 3 + 1] ?? 0);
      if (Math.min(...ys) < dry) continue;
      // Counter-clockwise seen from above (x east, z south): normals point up.
      indices.push(a, d, c, a, c, b);
    }
  }

  const solid = (c: Collider): void => {
    if (c.kind === 'cylinder') {
      const n = 8;
      const ring: number[] = [];
      for (let k = 0; k < n; k++) {
        const t = (k / n) * Math.PI * 2;
        const x = c.x + Math.cos(t) * c.radius;
        const z = c.z + Math.sin(t) * c.radius;
        ring.push(vert(x, c.minY, z), vert(x, c.maxY, z));
      }
      prism(ring, n);
      return;
    }
    const cos = Math.cos(c.yaw);
    const sin = Math.sin(c.yaw);
    const ring: number[] = [];
    for (const [sx, sz] of [
      [-1, -1],
      [1, -1],
      [1, 1],
      [-1, 1],
    ] as const) {
      // Local → world, the inverse of colliders.ts footprintDistance.
      const lx = sx * c.halfX;
      const lz = sz * c.halfZ;
      const x = c.x + lx * cos + lz * sin;
      const z = c.z - lx * sin + lz * cos;
      ring.push(vert(x, c.minY, z), vert(x, c.maxY, z));
    }
    prism(ring, 4);
  };
  // A closed prism from a ring of (bottom, top) pairs: top cap, bottom cap, sides.
  function prism(ring: number[], n: number): void {
    const bottom = (k: number): number => ring[(k % n) * 2] ?? 0;
    const top = (k: number): number => ring[(k % n) * 2 + 1] ?? 0;
    // Wind each cap both ways: recast keeps whichever faces up, so the winding of the
    // footprint (which depends on the yaw's sign) doesn't matter.
    for (let k = 1; k + 1 < n; k++) {
      indices.push(top(0), top(k), top(k + 1), top(0), top(k + 1), top(k));
      indices.push(bottom(0), bottom(k + 1), bottom(k));
    }
    for (let k = 0; k < n; k++) {
      indices.push(bottom(k), bottom(k + 1), top(k + 1), bottom(k), top(k + 1), top(k));
      indices.push(bottom(k), top(k + 1), bottom(k + 1), bottom(k), top(k), top(k + 1));
    }
  }

  for (const c of model.colliders.colliders()) {
    // The invisible bounds fence is far taller than anything; recast just needs it solid.
    solid(c);
  }
  // Shut every doorway with a slab (the door), so polygons stop at the wall line.
  for (const d of model.doors) {
    const half = d.widthM / 2 + 0.05;
    solid({
      kind: 'box',
      x: d.x,
      z: d.z,
      halfX: d.alongX ? half : WALL_M / 2,
      halfZ: d.alongX ? WALL_M / 2 : half,
      yaw: 0,
      minY: d.y - 0.3,
      maxY: d.y + DOOR_HEIGHT_M,
    });
  }
  return { positions, indices };
}

/** Polygons as recast leaves them: vertices in meters, neighbor per edge or -1. */
export interface RawNavMesh {
  verts: number[];
  polys: number[][];
  neis: number[][];
}

/**
 * Finishes a bake: keeps the polygons connected to the gangway (dropping crate tops and
 * roofs), joins each door's two sides with a link, and packs it as navmesh.json.
 */
export function finishNavMesh(
  raw: RawNavMesh,
  model: DistrictModel,
  gangway: NavPoint,
): { data: NavMeshData; report: string[] } {
  const report: string[] = [];
  const pack = (polys: number[][], neis: number[][], links: NavDoorLink[]): NavMeshData => ({
    version: 1,
    layoutHash: layoutHash(model.layout),
    agent: { ...GUARD_AGENT },
    verts: raw.verts.map((v) => Math.round(v * 100)),
    polys,
    neis,
    links,
  });

  // Links on the full mesh first, so the flood fill can cross doors.
  const full = new NavMesh(pack(raw.polys, raw.neis, []));
  const links: NavDoorLink[] = [];
  for (const d of model.doors) {
    const nx = d.alongX ? 0 : 1;
    const nz = d.alongX ? 1 : 0;
    const side = (s: number): { poly: number; point: NavPoint } =>
      full.findNearest({ x: d.x + nx * s * LINK_REACH_M, y: d.y, z: d.z + nz * s * LINK_REACH_M }, 0.6, 0.6);
    const a = side(-1);
    const b = side(1);
    if (a.poly < 0 || b.poly < 0 || a.poly === b.poly) {
      report.push(`door ${d.id}: no mesh on ${a.poly < 0 ? 'the front' : b.poly < 0 ? 'the back' : 'both sides as one'}; not linked`);
      continue;
    }
    links.push({ door: d.id, a: a.poly, b: b.poly, pa: round(a.point), pb: round(b.point) });
  }
  const withLinks = new NavMesh(pack(raw.polys, raw.neis, links));
  const start = withLinks.findNearest(gangway, 3, 2);
  if (start.poly < 0) throw new Error(`navmesh: no polygon at the gangway (${gangway.x}, ${gangway.z})`);
  const keep = withLinks.reachable(start.poly);

  // Renumber the kept polygons and the vertices they use.
  const polyMap = new Map<number, number>();
  [...keep].sort((a, b) => a - b).forEach((p, k) => polyMap.set(p, k));
  const vertMap = new Map<number, number>();
  const verts: number[] = [];
  const polys: number[][] = [];
  const neis: number[][] = [];
  for (const [old] of polyMap) {
    polys.push(
      (raw.polys[old] ?? []).map((v) => {
        let k = vertMap.get(v);
        if (k === undefined) {
          k = verts.length / 3;
          vertMap.set(v, k);
          verts.push(raw.verts[v * 3] ?? 0, raw.verts[v * 3 + 1] ?? 0, raw.verts[v * 3 + 2] ?? 0);
        }
        return k;
      }),
    );
    neis.push((raw.neis[old] ?? []).map((n) => (n >= 0 ? (polyMap.get(n) ?? -1) : -1)));
  }
  const keptLinks = links
    .filter((l) => polyMap.has(l.a) && polyMap.has(l.b))
    .map((l) => ({ ...l, a: polyMap.get(l.a)!, b: polyMap.get(l.b)! }));
  report.push(
    `${polys.length} polygons kept of ${raw.polys.length}; ${keptLinks.length} door links of ${model.doors.length} doors`,
  );
  const data: NavMeshData = {
    version: 1,
    layoutHash: layoutHash(model.layout),
    agent: { ...GUARD_AGENT },
    verts: verts.map((v) => Math.round(v * 100)),
    polys,
    neis,
    links: keptLinks,
  };
  return { data, report };
}

function round(p: NavPoint): NavPoint {
  return { x: Math.round(p.x * 100) / 100, y: Math.round(p.y * 100) / 100, z: Math.round(p.z * 100) / 100 };
}
