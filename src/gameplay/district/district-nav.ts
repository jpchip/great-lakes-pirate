import type { Rng } from '../../core/rng';
import type { NavMesh, NavPoint } from '../../sim/district/navmesh';
import type { NavQuery, XZ } from '../onfoot/nav';

/**
 * Piece C's baked navmesh behind piece D's `NavQuery` (plan 08 §5.3; Phase 7): the guards
 * walk Bayfield's real navmesh through the same three questions they asked the greybox grid.
 *
 * The navmesh works in 3D (a pier deck over the lake bed, a warehouse floor above the
 * street), so a point without a height is put on the highest walkable top there, the same
 * floor the controller stands a walker on.
 */

/** How far off the mesh a guard may be and still be put back on it, meters. */
const SNAP_M = 3;
/** And how far up or down. */
const CLIMB_M = 2;
/** A point this close to the mesh counts as walkable (a guard is put on it as they arrive). */
const WALKABLE_M = 1;

export class DistrictNav implements NavQuery {
  constructor(
    readonly mesh: NavMesh,
    /** The highest walkable top at a point (the district model's `floorAt`). */
    private readonly floorAt: (x: number, z: number) => number,
    /** Doors shut or locked to the guards (piece E's locks; none yet). */
    readonly closedDoors: Set<string> = new Set(),
  ) {}

  private point(p: XZ): NavPoint {
    const y = (p as Partial<NavPoint>).y;
    return { x: p.x, y: typeof y === 'number' ? y : this.floorAt(p.x, p.z), z: p.z };
  }

  findPath(from: XZ, to: XZ): XZ[] | undefined {
    const path = this.mesh.findPath(this.point(from), this.point(to), {
      closedDoors: this.closedDoors,
    });
    // The mesh gives both ends; a guard heads for the first corner after where they stand.
    if (path.length === 0) return undefined;
    const out = path.slice(1).map((q) => ({ x: q.x, z: q.z }));
    return out.length > 0 ? out : [{ x: to.x, z: to.z }];
  }

  walkable(p: XZ): boolean {
    return this.mesh.findNearest(this.point(p), WALKABLE_M, CLIMB_M).poly >= 0;
  }

  randomNear(p: XZ, radiusM: number, rng: Rng): XZ | undefined {
    for (let k = 0; k < 12; k++) {
      const a = rng.range(0, Math.PI * 2);
      const r = radiusM * Math.sqrt(rng.next());
      const x = p.x + Math.sin(a) * r;
      const z = p.z - Math.cos(a) * r;
      const hit = this.mesh.findNearest({ x, y: this.floorAt(x, z), z }, SNAP_M, CLIMB_M);
      if (hit.poly >= 0) return { x: hit.point.x, z: hit.point.z };
    }
    return undefined;
  }
}
