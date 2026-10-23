/**
 * Simple collision primitives for on-foot areas (plan 01 §2.2): vertical boxes with a
 * yaw, vertical cylinders, and grid-cell occupancy maps for buildings. Every shape is
 * an extruded 2D footprint between minY and maxY, which is all docks, crates, trees
 * and hideout pieces need. A uniform spatial hash keeps queries local.
 */

export interface BoxCollider {
  kind: 'box';
  /** Footprint center. */
  x: number;
  z: number;
  halfX: number;
  halfZ: number;
  /** Rotation about +y in radians, the same as three.js `rotation.y`. */
  yaw: number;
  minY: number;
  maxY: number;
}

export interface CylinderCollider {
  kind: 'cylinder';
  x: number;
  z: number;
  radius: number;
  minY: number;
  maxY: number;
}

export type Collider = BoxCollider | CylinderCollider;

/** The outward direction from a shape to a point, in the XZ plane. */
export interface Push {
  nx: number;
  nz: number;
}

/**
 * Signed horizontal distance from (x, z) to the collider's footprint: negative inside.
 * `out` gets the unit direction that pushes the point out of the shape.
 */
export function footprintDistance(c: Collider, x: number, z: number, out: Push): number {
  if (c.kind === 'cylinder') {
    const dx = x - c.x;
    const dz = z - c.z;
    const d = Math.hypot(dx, dz);
    if (d < 1e-9) {
      out.nx = 1;
      out.nz = 0;
    } else {
      out.nx = dx / d;
      out.nz = dz / d;
    }
    return d - c.radius;
  }

  // World → box local (the inverse of three.js's rotation about y).
  const cos = Math.cos(c.yaw);
  const sin = Math.sin(c.yaw);
  const wx = x - c.x;
  const wz = z - c.z;
  const lx = wx * cos - wz * sin;
  const lz = wx * sin + wz * cos;

  const qx = Math.abs(lx) - c.halfX;
  const qz = Math.abs(lz) - c.halfZ;
  let nlx: number;
  let nlz: number;
  let d: number;
  if (qx > 0 || qz > 0) {
    // Outside: the vector from the nearest point on the box.
    const ox = Math.max(qx, 0) * Math.sign(lx);
    const oz = Math.max(qz, 0) * Math.sign(lz);
    d = Math.hypot(ox, oz);
    nlx = ox / d;
    nlz = oz / d;
  } else if (qx > qz) {
    // Inside: out through the nearest face.
    d = qx;
    nlx = lx >= 0 ? 1 : -1;
    nlz = 0;
  } else {
    d = qz;
    nlx = 0;
    nlz = lz >= 0 ? 1 : -1;
  }
  // Box local → world.
  out.nx = nlx * cos + nlz * sin;
  out.nz = -nlx * sin + nlz * cos;
  return d;
}

/** Axis-aligned XZ bounds of a collider's footprint. */
function bounds(c: Collider): { minX: number; maxX: number; minZ: number; maxZ: number } {
  if (c.kind === 'cylinder') {
    return {
      minX: c.x - c.radius,
      maxX: c.x + c.radius,
      minZ: c.z - c.radius,
      maxZ: c.z + c.radius,
    };
  }
  const cos = Math.abs(Math.cos(c.yaw));
  const sin = Math.abs(Math.sin(c.yaw));
  const ex = c.halfX * cos + c.halfZ * sin;
  const ez = c.halfX * sin + c.halfZ * cos;
  return { minX: c.x - ex, maxX: c.x + ex, minZ: c.z - ez, maxZ: c.z + ez };
}

/**
 * A building footprint on a regular grid (plan 09's grid building, plan 08's modular
 * kit): each cell is empty (0) or solid up to `baseY + height`.
 */
export class OccupancyGrid {
  readonly heights: Float32Array;

  constructor(
    readonly originX: number,
    readonly originZ: number,
    readonly cellSize: number,
    readonly cols: number,
    readonly rows: number,
    readonly baseY: number,
  ) {
    this.heights = new Float32Array(cols * rows);
  }

  set(col: number, row: number, height: number): void {
    if (col < 0 || row < 0 || col >= this.cols || row >= this.rows) {
      throw new RangeError(`Cell (${col}, ${row}) is outside the grid`);
    }
    this.heights[row * this.cols + col] = height;
  }

  get(col: number, row: number): number {
    if (col < 0 || row < 0 || col >= this.cols || row >= this.rows) return 0;
    return this.heights[row * this.cols + col] ?? 0;
  }
}

const BUCKET_KEY_OFFSET = 32768;

/** Every collider in an on-foot area, bucketed for local queries. */
export class ColliderSet {
  private readonly all: Collider[] = [];
  private readonly buckets = new Map<number, number[]>();
  private readonly grids: OccupancyGrid[] = [];
  private readonly seen: number[] = [];
  private stamp = 0;
  // Occupied grid cells come back as pooled boxes, so queries don't allocate.
  private readonly cellPool: BoxCollider[] = [];

  constructor(readonly bucketSize = 4) {}

  get size(): number {
    return this.all.length;
  }

  colliders(): readonly Collider[] {
    return this.all;
  }

  occupancyGrids(): readonly OccupancyGrid[] {
    return this.grids;
  }

  add(c: Collider): void {
    const index = this.all.length;
    this.all.push(c);
    this.seen.push(0);
    const b = bounds(c);
    const s = this.bucketSize;
    for (let bz = Math.floor(b.minZ / s); bz <= Math.floor(b.maxZ / s); bz++) {
      for (let bx = Math.floor(b.minX / s); bx <= Math.floor(b.maxX / s); bx++) {
        const key = this.key(bx, bz);
        let list = this.buckets.get(key);
        if (!list) {
          list = [];
          this.buckets.set(key, list);
        }
        list.push(index);
      }
    }
  }

  addGrid(grid: OccupancyGrid): void {
    this.grids.push(grid);
  }

  /**
   * Colliders whose footprints may come within `radius` of (x, z). Fills and returns
   * `out`; entries for grid cells are reused by the next query.
   */
  query(x: number, z: number, radius: number, out: Collider[]): Collider[] {
    out.length = 0;
    this.stamp++;
    const s = this.bucketSize;
    for (let bz = Math.floor((z - radius) / s); bz <= Math.floor((z + radius) / s); bz++) {
      for (let bx = Math.floor((x - radius) / s); bx <= Math.floor((x + radius) / s); bx++) {
        const list = this.buckets.get(this.key(bx, bz));
        if (!list) continue;
        for (const index of list) {
          if (this.seen[index] === this.stamp) continue;
          this.seen[index] = this.stamp;
          out.push(this.all[index] as Collider);
        }
      }
    }

    let pooled = 0;
    for (const g of this.grids) {
      const c0 = Math.floor((x - radius - g.originX) / g.cellSize);
      const c1 = Math.floor((x + radius - g.originX) / g.cellSize);
      const r0 = Math.floor((z - radius - g.originZ) / g.cellSize);
      const r1 = Math.floor((z + radius - g.originZ) / g.cellSize);
      for (let row = r0; row <= r1; row++) {
        for (let col = c0; col <= c1; col++) {
          const h = g.get(col, row);
          if (h <= 0) continue;
          let box = this.cellPool[pooled];
          if (!box) {
            box = { kind: 'box', x: 0, z: 0, halfX: 0, halfZ: 0, yaw: 0, minY: 0, maxY: 0 };
            this.cellPool.push(box);
          }
          pooled++;
          const half = g.cellSize / 2;
          box.x = g.originX + col * g.cellSize + half;
          box.z = g.originZ + row * g.cellSize + half;
          box.halfX = half;
          box.halfZ = half;
          box.minY = g.baseY;
          box.maxY = g.baseY + h;
          out.push(box);
        }
      }
    }
    return out;
  }

  private key(bx: number, bz: number): number {
    return (bz + BUCKET_KEY_OFFSET) * 65536 + (bx + BUCKET_KEY_OFFSET);
  }
}
