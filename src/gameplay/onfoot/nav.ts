import type { Rng } from '../../core/rng';
import { footprintDistance, type Collider, type Push } from './colliders';
import type { OnFootZone } from './controller';

/**
 * Where guards can walk (plan 08 §5.3; Phase 7 piece D). The district's real navmesh is
 * baked offline with the kit (piece C); until it lands, guards path on this grid, built
 * once from the same heightfield and colliders the controller walks on. Both answer the
 * same `NavQuery`, so the guards don't care which they have.
 */

export interface XZ {
  x: number;
  z: number;
}

export interface NavQuery {
  /**
   * A walkable path from `from` to `to`, corners only (the first is the first corner to head
   * for, the last is `to` or the walkable point nearest it). Undefined if there's none.
   */
  findPath(from: XZ, to: XZ): XZ[] | undefined;
  /** Whether a guard can stand here. */
  walkable(p: XZ): boolean;
  /** A walkable point within `radiusM` of `p`, for a search sweep. */
  randomNear(p: XZ, radiusM: number, rng: Rng): XZ | undefined;
}

export interface NavGridOptions {
  minX: number;
  minZ: number;
  maxX: number;
  maxZ: number;
  /** Cell size, meters. */
  cellM?: number;
  /** The walker's capsule radius and height (the controller's). */
  radius?: number;
  height?: number;
  /** Ledges up to this high are walked up (the controller's step). */
  stepM?: number;
  /** Ground steeper than this blocks, radians. */
  maxSlope?: number;
  /**
   * Floors higher than this above the ground (or the water) aren't walked: roofs. Raised
   * walkways come with the baked navmesh.
   */
  maxRiseM?: number;
}

const near: Collider[] = [];
const push: Push = { nx: 0, nz: 0 };

/** A navigation grid over an on-foot zone: each cell walkable or not, with its floor height. */
export class NavGrid implements NavQuery {
  readonly cols: number;
  readonly rows: number;
  readonly cellM: number;
  readonly minX: number;
  readonly minZ: number;
  /** Floor height of each cell; NaN where nobody stands. */
  readonly floor: Float32Array;
  private readonly stepM: number;
  // A* scratch, reused between searches.
  private readonly g: Float32Array;
  private readonly from: Int32Array;
  private readonly stamp: Uint32Array;
  private readonly closed: Uint32Array;
  private search = 0;
  private readonly heap: number[] = [];
  private readonly f: Float32Array;

  constructor(zone: OnFootZone, opts: NavGridOptions) {
    const cellM = opts.cellM ?? 0.5;
    const radius = opts.radius ?? 0.3;
    const height = opts.height ?? 1.75;
    const stepM = opts.stepM ?? 0.4;
    const maxSlope = opts.maxSlope ?? (40 * Math.PI) / 180;
    const maxRiseM = opts.maxRiseM ?? 2.5;
    this.cellM = cellM;
    this.stepM = stepM;
    this.minX = opts.minX;
    this.minZ = opts.minZ;
    this.cols = Math.max(1, Math.ceil((opts.maxX - opts.minX) / cellM));
    this.rows = Math.max(1, Math.ceil((opts.maxZ - opts.minZ) / cellM));
    const n = this.cols * this.rows;
    this.floor = new Float32Array(n).fill(Number.NaN);
    this.g = new Float32Array(n);
    this.f = new Float32Array(n);
    this.from = new Int32Array(n);
    this.stamp = new Uint32Array(n);
    this.closed = new Uint32Array(n);

    const tops: number[] = [];
    for (let r = 0; r < this.rows; r++) {
      for (let c = 0; c < this.cols; c++) {
        const x = this.minX + (c + 0.5) * cellM;
        const z = this.minZ + (r + 0.5) * cellM;
        const ground = zone.ground.heightAt(x, z);
        zone.colliders.query(x, z, radius + cellM, near);
        // Candidate floors: the ground (if it isn't a cliff), and every top underfoot.
        tops.length = 0;
        if (zone.ground.slopeAt(x, z, 1) <= maxSlope) tops.push(ground);
        for (const col of near) {
          if (col.maxY > ground && footprintDistance(col, x, z, push) <= 0) tops.push(col.maxY);
        }
        tops.sort((a, b) => b - a);
        for (const top of tops) {
          // Guards don't swim, or walk on roofs.
          if (top < zone.waterLevel - 0.2) continue;
          if (top > Math.max(ground, zone.waterLevel) + maxRiseM) continue;
          let clear = true;
          for (const col of near) {
            // Anything from a step above the floor to head height, within a radius, blocks.
            if (col.maxY <= top + stepM || col.minY >= top + height) continue;
            if (footprintDistance(col, x, z, push) < radius) {
              clear = false;
              break;
            }
          }
          if (clear) {
            this.floor[r * this.cols + c] = top;
            break;
          }
        }
      }
    }
  }

  private index(p: XZ): number {
    const c = Math.floor((p.x - this.minX) / this.cellM);
    const r = Math.floor((p.z - this.minZ) / this.cellM);
    if (c < 0 || r < 0 || c >= this.cols || r >= this.rows) return -1;
    return r * this.cols + c;
  }

  private center(i: number): XZ {
    const c = i % this.cols;
    const r = (i - c) / this.cols;
    return { x: this.minX + (c + 0.5) * this.cellM, z: this.minZ + (r + 0.5) * this.cellM };
  }

  private open(i: number): boolean {
    return i >= 0 && !Number.isNaN(this.floor[i] as number);
  }

  walkable(p: XZ): boolean {
    return this.open(this.index(p));
  }

  /** The walkable cell nearest `p`, searching rings out to `maxRings`. */
  private nearestOpen(p: XZ, maxRings = 8): number {
    const i = this.index(p);
    if (this.open(i)) return i;
    const c0 = Math.floor((p.x - this.minX) / this.cellM);
    const r0 = Math.floor((p.z - this.minZ) / this.cellM);
    for (let ring = 1; ring <= maxRings; ring++) {
      let best = -1;
      let bestD = Infinity;
      for (let dr = -ring; dr <= ring; dr++) {
        for (let dc = -ring; dc <= ring; dc++) {
          if (Math.max(Math.abs(dr), Math.abs(dc)) !== ring) continue;
          const c = c0 + dc;
          const r = r0 + dr;
          if (c < 0 || r < 0 || c >= this.cols || r >= this.rows) continue;
          const j = r * this.cols + c;
          if (!this.open(j)) continue;
          const d = dr * dr + dc * dc;
          if (d < bestD) {
            bestD = d;
            best = j;
          }
        }
      }
      if (best >= 0) return best;
    }
    return -1;
  }

  /** Whether two neighbouring cells join: both open and no ledge too high between. */
  private joins(a: number, b: number): boolean {
    if (!this.open(b)) return false;
    return Math.abs((this.floor[a] as number) - (this.floor[b] as number)) <= this.stepM + 0.05;
  }

  /** A straight walk from cell a to cell b crosses only joined, open cells. */
  private straight(a: number, b: number): boolean {
    const pa = this.center(a);
    const pb = this.center(b);
    const d = Math.hypot(pb.x - pa.x, pb.z - pa.z);
    const steps = Math.ceil(d / (this.cellM * 0.4));
    let prev = a;
    for (let s = 1; s <= steps; s++) {
      const t = s / steps;
      const i = this.index({ x: pa.x + (pb.x - pa.x) * t, z: pa.z + (pb.z - pa.z) * t });
      if (i === prev) continue;
      if (i < 0 || !this.joins(prev, i)) return false;
      prev = i;
    }
    return true;
  }

  findPath(fromP: XZ, toP: XZ): XZ[] | undefined {
    const start = this.nearestOpen(fromP);
    const goal = this.nearestOpen(toP);
    if (start < 0 || goal < 0) return undefined;
    if (start === goal) return [toP];
    this.search++;
    const s = this.search;
    const cols = this.cols;
    const gc = goal % cols;
    const gr = (goal - gc) / cols;
    const h = (i: number): number => {
      const c = i % cols;
      const r = (i - c) / cols;
      const dx = Math.abs(c - gc);
      const dz = Math.abs(r - gr);
      return Math.max(dx, dz) + 0.4142 * Math.min(dx, dz);
    };
    const heap = this.heap;
    heap.length = 0;
    this.stamp[start] = s;
    this.g[start] = 0;
    this.f[start] = h(start);
    this.from[start] = -1;
    this.push(start);
    let found = false;
    let expanded = 0;
    while (heap.length > 0) {
      const cur = this.pop();
      if (this.closed[cur] === s) continue;
      this.closed[cur] = s;
      if (cur === goal) {
        found = true;
        break;
      }
      if (++expanded > 20000) break;
      const c = cur % cols;
      const r = (cur - c) / cols;
      for (let dr = -1; dr <= 1; dr++) {
        for (let dc = -1; dc <= 1; dc++) {
          if (dr === 0 && dc === 0) continue;
          const nc = c + dc;
          const nr = r + dr;
          if (nc < 0 || nr < 0 || nc >= cols || nr >= this.rows) continue;
          const nb = nr * cols + nc;
          if (this.closed[nb] === s || !this.joins(cur, nb)) continue;
          // No cutting corners past a blocked cell.
          if (dr !== 0 && dc !== 0) {
            if (!this.joins(cur, r * cols + nc) || !this.joins(cur, nr * cols + c)) continue;
          }
          const ng = (this.g[cur] as number) + (dr !== 0 && dc !== 0 ? 1.4142 : 1);
          if (this.stamp[nb] === s && ng >= (this.g[nb] as number)) continue;
          this.stamp[nb] = s;
          this.g[nb] = ng;
          this.f[nb] = ng + h(nb);
          this.from[nb] = cur;
          this.push(nb);
        }
      }
    }
    if (!found) return undefined;
    // Back from the goal, then pull the string: keep only corners a straight walk can't skip.
    const cells: number[] = [];
    for (let i = goal; i >= 0; i = this.from[i] as number) cells.push(i);
    cells.reverse();
    const corners: XZ[] = [];
    let anchor = 0;
    for (let k = 2; k < cells.length; k++) {
      if (!this.straight(cells[anchor] as number, cells[k] as number)) {
        anchor = k - 1;
        corners.push(this.center(cells[anchor] as number));
      }
    }
    corners.push(this.walkable(toP) ? { x: toP.x, z: toP.z } : this.center(goal));
    return corners;
  }

  randomNear(p: XZ, radiusM: number, rng: Rng): XZ | undefined {
    for (let k = 0; k < 12; k++) {
      const a = rng.range(0, Math.PI * 2);
      const d = Math.sqrt(rng.next()) * radiusM;
      const q = { x: p.x + Math.sin(a) * d, z: p.z + Math.cos(a) * d };
      if (this.walkable(q)) return q;
    }
    return undefined;
  }

  private push(i: number): void {
    const heap = this.heap;
    const f = this.f;
    heap.push(i);
    let k = heap.length - 1;
    while (k > 0) {
      const parent = (k - 1) >> 1;
      if ((f[heap[parent] as number] as number) <= (f[i] as number)) break;
      heap[k] = heap[parent] as number;
      k = parent;
    }
    heap[k] = i;
  }

  private pop(): number {
    const heap = this.heap;
    const f = this.f;
    const top = heap[0] as number;
    const last = heap.pop() as number;
    if (heap.length > 0) {
      let k = 0;
      const n = heap.length;
      for (;;) {
        const l = 2 * k + 1;
        if (l >= n) break;
        const r = l + 1;
        const child =
          r < n && (f[heap[r] as number] as number) < (f[heap[l] as number] as number) ? r : l;
        if ((f[heap[child] as number] as number) >= (f[last] as number)) break;
        heap[k] = heap[child] as number;
        k = child;
      }
      heap[k] = last;
    }
    return top;
  }
}
