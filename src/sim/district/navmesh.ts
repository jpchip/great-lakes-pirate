/**
 * Guard navigation on a baked district navmesh (plan 08 §5.3, plan 01 §4.5; Phase 7 piece
 * C). The polygons are baked offline with recast-navigation (tools/district/bake.ts) and
 * shipped as plain JSON; this side is plain TypeScript, so the game carries no WASM and the
 * queries unit-test in Node: nearest polygon, A* over polygons, then string-pulling (the
 * "simple stupid funnel") through the shared edges.
 *
 * Doors are links, not polygons: the bake closes every doorway, then joins the polygons
 * just in front of and behind it with a link named for the door, so a locked or shut door
 * is a link the query skips (plan 08 §5.3: "doors are simple open/closed links").
 */

export interface NavPoint {
  x: number;
  y: number;
  z: number;
}

export interface NavDoorLink {
  door: string;
  a: number;
  b: number;
  pa: NavPoint;
  pb: NavPoint;
}

/** The baked file (`public/districts/<id>/navmesh.json`). */
export interface NavMeshData {
  version: 1;
  /** layout.ts `layoutHash` of the layout it was baked from. */
  layoutHash: string;
  agent: { radiusM: number; heightM: number; climbM: number; maxSlopeDeg: number };
  /** Vertices, x y z in whole centimeters. */
  verts: number[];
  /** Each polygon's vertex indices, convex, wound as recast leaves them. */
  polys: number[][];
  /** Per polygon edge `j` (from vertex j to j+1): the polygon across it, or -1. */
  neis: number[][];
  links: NavDoorLink[];
}

export interface PathOptions {
  /** Doors that are shut or locked to this walker. */
  closedDoors?: ReadonlySet<string>;
  /** Give up after expanding this many polygons. */
  maxNodes?: number;
}

const BUCKET_M = 4;

class Heap {
  private readonly items: number[] = [];
  constructor(private readonly f: Float64Array) {}
  get size(): number {
    return this.items.length;
  }
  push(n: number): void {
    const a = this.items;
    a.push(n);
    let i = a.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if ((this.f[a[p]!] ?? 0) <= (this.f[n] ?? 0)) break;
      a[i] = a[p]!;
      i = p;
    }
    a[i] = n;
  }
  pop(): number {
    const a = this.items;
    const top = a[0]!;
    const last = a.pop()!;
    if (a.length > 0) {
      let i = 0;
      const fl = this.f[last] ?? 0;
      for (;;) {
        const l = 2 * i + 1;
        if (l >= a.length) break;
        const r = l + 1;
        const c = r < a.length && (this.f[a[r]!] ?? 0) < (this.f[a[l]!] ?? 0) ? r : l;
        if ((this.f[a[c]!] ?? 0) >= fl) break;
        a[i] = a[c]!;
        i = c;
      }
      a[i] = last;
    }
    return top;
  }
}

export class NavMesh {
  readonly vx: Float64Array;
  readonly vy: Float64Array;
  readonly vz: Float64Array;
  readonly polys: number[][];
  readonly neis: number[][];
  readonly links: NavDoorLink[];
  /** Links touching each polygon. */
  private readonly polyLinks: number[][];
  readonly cx: Float64Array;
  readonly cz: Float64Array;
  readonly area: Float64Array;
  private readonly minX: Float64Array;
  private readonly maxX: Float64Array;
  private readonly minZ: Float64Array;
  private readonly maxZ: Float64Array;
  private readonly buckets = new Map<number, number[]>();
  // A* scratch, sized once.
  private readonly g: Float64Array;
  private readonly f: Float64Array;
  private readonly parent: Int32Array;
  /** How a node was reached: edge index ≥ 0, or -(link + 1). */
  private readonly via: Int32Array;
  private readonly entryX: Float64Array;
  private readonly entryZ: Float64Array;
  private readonly stamp: Uint32Array;
  private readonly closed: Uint32Array;
  private run = 0;

  constructor(readonly data: NavMeshData) {
    const n = data.verts.length / 3;
    this.vx = new Float64Array(n);
    this.vy = new Float64Array(n);
    this.vz = new Float64Array(n);
    for (let k = 0; k < n; k++) {
      this.vx[k] = (data.verts[k * 3] ?? 0) / 100;
      this.vy[k] = (data.verts[k * 3 + 1] ?? 0) / 100;
      this.vz[k] = (data.verts[k * 3 + 2] ?? 0) / 100;
    }
    this.polys = data.polys;
    this.neis = data.neis;
    this.links = data.links;
    const p = data.polys.length;
    this.cx = new Float64Array(p);
    this.cz = new Float64Array(p);
    this.area = new Float64Array(p);
    this.minX = new Float64Array(p);
    this.maxX = new Float64Array(p);
    this.minZ = new Float64Array(p);
    this.maxZ = new Float64Array(p);
    this.polyLinks = Array.from({ length: p }, () => []);
    data.links.forEach((l, k) => {
      this.polyLinks[l.a]?.push(k);
      this.polyLinks[l.b]?.push(k);
    });
    for (let i = 0; i < p; i++) {
      const vs = data.polys[i] ?? [];
      let sx = 0;
      let sz = 0;
      let x0 = Infinity;
      let x1 = -Infinity;
      let z0 = Infinity;
      let z1 = -Infinity;
      for (const v of vs) {
        const x = this.vx[v] ?? 0;
        const z = this.vz[v] ?? 0;
        sx += x;
        sz += z;
        x0 = Math.min(x0, x);
        x1 = Math.max(x1, x);
        z0 = Math.min(z0, z);
        z1 = Math.max(z1, z);
      }
      this.cx[i] = sx / vs.length;
      this.cz[i] = sz / vs.length;
      this.minX[i] = x0;
      this.maxX[i] = x1;
      this.minZ[i] = z0;
      this.maxZ[i] = z1;
      let a = 0;
      for (let k = 0; k < vs.length; k++) {
        const v0 = vs[k] ?? 0;
        const v1 = vs[(k + 1) % vs.length] ?? 0;
        a += (this.vx[v0] ?? 0) * (this.vz[v1] ?? 0) - (this.vx[v1] ?? 0) * (this.vz[v0] ?? 0);
      }
      this.area[i] = Math.abs(a) / 2;
      for (let bz = Math.floor(z0 / BUCKET_M); bz <= Math.floor(z1 / BUCKET_M); bz++) {
        for (let bx = Math.floor(x0 / BUCKET_M); bx <= Math.floor(x1 / BUCKET_M); bx++) {
          const key = this.key(bx, bz);
          let list = this.buckets.get(key);
          if (!list) this.buckets.set(key, (list = []));
          list.push(i);
        }
      }
    }
    this.g = new Float64Array(p);
    this.f = new Float64Array(p);
    this.parent = new Int32Array(p);
    this.via = new Int32Array(p);
    this.entryX = new Float64Array(p);
    this.entryZ = new Float64Array(p);
    this.stamp = new Uint32Array(p);
    this.closed = new Uint32Array(p);
  }

  get polyCount(): number {
    return this.polys.length;
  }

  private key(bx: number, bz: number): number {
    return (bz + 32768) * 65536 + (bx + 32768);
  }

  /** Is (x, z) inside polygon `i`'s footprint (either winding)? */
  contains(i: number, x: number, z: number): boolean {
    if (x < this.minX[i]! - 1e-6 || x > this.maxX[i]! + 1e-6) return false;
    if (z < this.minZ[i]! - 1e-6 || z > this.maxZ[i]! + 1e-6) return false;
    const vs = this.polys[i]!;
    let sign = 0;
    for (let k = 0; k < vs.length; k++) {
      const a = vs[k]!;
      const b = vs[(k + 1) % vs.length]!;
      const c = (this.vx[b]! - this.vx[a]!) * (z - this.vz[a]!) - (this.vz[b]! - this.vz[a]!) * (x - this.vx[a]!);
      if (Math.abs(c) < 1e-9) continue;
      const s = c > 0 ? 1 : -1;
      if (sign === 0) sign = s;
      else if (s !== sign) return false;
    }
    return true;
  }

  /** The polygon's height at (x, z), from the fan triangle under it. */
  heightOn(i: number, x: number, z: number): number {
    const vs = this.polys[i]!;
    const a = vs[0]!;
    for (let k = 1; k + 1 < vs.length; k++) {
      const b = vs[k]!;
      const c = vs[k + 1]!;
      const d = (this.vz[b]! - this.vz[c]!) * (this.vx[a]! - this.vx[c]!) + (this.vx[c]! - this.vx[b]!) * (this.vz[a]! - this.vz[c]!);
      if (Math.abs(d) < 1e-12) continue;
      const u = ((this.vz[b]! - this.vz[c]!) * (x - this.vx[c]!) + (this.vx[c]! - this.vx[b]!) * (z - this.vz[c]!)) / d;
      const v = ((this.vz[c]! - this.vz[a]!) * (x - this.vx[c]!) + (this.vx[a]! - this.vx[c]!) * (z - this.vz[c]!)) / d;
      const w = 1 - u - v;
      if (u >= -1e-6 && v >= -1e-6 && w >= -1e-6) return u * this.vy[a]! + v * this.vy[b]! + w * this.vy[c]!;
    }
    let s = 0;
    for (const v of vs) s += this.vy[v]!;
    return s / vs.length;
  }

  /** The closest point on polygon `i` to (x, z), in the plane. */
  private closestOn(i: number, x: number, z: number, out: NavPoint): number {
    if (this.contains(i, x, z)) {
      out.x = x;
      out.z = z;
      out.y = this.heightOn(i, x, z);
      return 0;
    }
    const vs = this.polys[i]!;
    let best = Infinity;
    for (let k = 0; k < vs.length; k++) {
      const a = vs[k]!;
      const b = vs[(k + 1) % vs.length]!;
      const ex = this.vx[b]! - this.vx[a]!;
      const ez = this.vz[b]! - this.vz[a]!;
      const len2 = ex * ex + ez * ez;
      const t = len2 > 0 ? Math.min(1, Math.max(0, ((x - this.vx[a]!) * ex + (z - this.vz[a]!) * ez) / len2)) : 0;
      const px = this.vx[a]! + ex * t;
      const pz = this.vz[a]! + ez * t;
      const d = Math.hypot(x - px, z - pz);
      if (d < best) {
        best = d;
        out.x = px;
        out.z = pz;
        out.y = this.vy[a]! + (this.vy[b]! - this.vy[a]!) * t;
      }
    }
    return best;
  }

  /**
   * The polygon nearest a point within `radius` across and `climb` up or down, and the
   * nearest point on it; -1 if none.
   */
  findNearest(p: NavPoint, radius = 2, climb = 1.5): { poly: number; point: NavPoint } {
    const point: NavPoint = { x: p.x, y: p.y, z: p.z };
    const tmp: NavPoint = { x: 0, y: 0, z: 0 };
    let best = -1;
    let bestScore = Infinity;
    for (let bz = Math.floor((p.z - radius) / BUCKET_M); bz <= Math.floor((p.z + radius) / BUCKET_M); bz++) {
      for (let bx = Math.floor((p.x - radius) / BUCKET_M); bx <= Math.floor((p.x + radius) / BUCKET_M); bx++) {
        for (const i of this.buckets.get(this.key(bx, bz)) ?? []) {
          const d = this.closestOn(i, p.x, p.z, tmp);
          if (d > radius) continue;
          const dy = Math.abs(tmp.y - p.y);
          if (dy > climb) continue;
          const score = d + dy * 0.5;
          if (score < bestScore) {
            bestScore = score;
            best = i;
            point.x = tmp.x;
            point.y = tmp.y;
            point.z = tmp.z;
          }
        }
      }
    }
    return { poly: best, point };
  }

  /**
   * A walkable path from `from` to `to`: corner points, both ends included. Empty when
   * either end is off the mesh or nothing connects them (a shut door, an island of mesh).
   */
  findPath(from: NavPoint, to: NavPoint, options: PathOptions = {}): NavPoint[] {
    const s = this.findNearest(from);
    const e = this.findNearest(to);
    if (s.poly < 0 || e.poly < 0) return [];
    const chain = this.polyPath(s.poly, s.point, e.poly, e.point, options);
    if (!chain) return [];
    return this.stringPull(chain, s.point, e.point);
  }

  /** A* over polygons; the chain of (polygon, how it was entered) from start to end. */
  private polyPath(
    start: number,
    sp: NavPoint,
    end: number,
    ep: NavPoint,
    options: PathOptions,
  ): { poly: number; via: number }[] | undefined {
    const run = ++this.run;
    const closedDoors = options.closedDoors;
    const maxNodes = options.maxNodes ?? 4096;
    const open = new Heap(this.f);
    const visit = (i: number, g: number, parent: number, via: number, x: number, z: number): void => {
      if (this.closed[i] === run) return;
      if (this.stamp[i] === run && g >= this.g[i]!) return;
      this.stamp[i] = run;
      this.g[i] = g;
      this.f[i] = g + Math.hypot(x - ep.x, z - ep.z);
      this.parent[i] = parent;
      this.via[i] = via;
      this.entryX[i] = x;
      this.entryZ[i] = z;
      open.push(i);
    };
    visit(start, 0, -1, 0, sp.x, sp.z);
    let expanded = 0;
    while (open.size > 0) {
      const i = open.pop();
      if (this.closed[i] === run) continue;
      this.closed[i] = run;
      if (i === end) break;
      if (++expanded > maxNodes) return undefined;
      const ex = this.entryX[i]!;
      const ez = this.entryZ[i]!;
      const vs = this.polys[i]!;
      const ns = this.neis[i]!;
      for (let k = 0; k < vs.length; k++) {
        const n = ns[k] ?? -1;
        if (n < 0 || this.closed[n] === run) continue;
        const a = vs[k]!;
        const b = vs[(k + 1) % vs.length]!;
        const mx = (this.vx[a]! + this.vx[b]!) / 2;
        const mz = (this.vz[a]! + this.vz[b]!) / 2;
        visit(n, this.g[i]! + Math.hypot(mx - ex, mz - ez), i, k, mx, mz);
      }
      for (const li of this.polyLinks[i]!) {
        const l = this.links[li]!;
        if (closedDoors?.has(l.door)) continue;
        const forward = l.a === i;
        const n = forward ? l.b : l.a;
        const p0 = forward ? l.pa : l.pb;
        const p1 = forward ? l.pb : l.pa;
        const cost = Math.hypot(p0.x - ex, p0.z - ez) + Math.hypot(p1.x - p0.x, p1.z - p0.z);
        visit(n, this.g[i]! + cost, i, -(li + 1), p1.x, p1.z);
      }
    }
    if (this.closed[end] !== run) return undefined;
    const chain: { poly: number; via: number }[] = [];
    for (let i = end; i >= 0; i = this.parent[i]!) {
      chain.push({ poly: i, via: this.via[i]! });
      if (i === start) break;
    }
    return chain.reverse();
  }

  /** The funnel through the chain's portals, then heights from the polygons. */
  private stringPull(chain: { poly: number; via: number }[], sp: NavPoint, ep: NavPoint): NavPoint[] {
    // Portals as (left, right) in the plane; "right" is where cross(dir, p - mid) < 0.
    const lx: number[] = [sp.x];
    const lz: number[] = [sp.z];
    const rx: number[] = [sp.x];
    const rz: number[] = [sp.z];
    const polyOf: number[] = [chain[0]!.poly];
    for (let k = 1; k < chain.length; k++) {
      const prev = chain[k - 1]!.poly;
      const { poly, via } = chain[k]!;
      if (via < 0) {
        const l = this.links[-via - 1]!;
        const forward = l.a === prev;
        const p0 = forward ? l.pa : l.pb;
        const p1 = forward ? l.pb : l.pa;
        lx.push(p0.x, p1.x);
        lz.push(p0.z, p1.z);
        rx.push(p0.x, p1.x);
        rz.push(p0.z, p1.z);
        polyOf.push(prev, poly);
        continue;
      }
      const vs = this.polys[prev]!;
      const a = vs[via]!;
      const b = vs[(via + 1) % vs.length]!;
      const mx = (this.vx[a]! + this.vx[b]!) / 2;
      const mz = (this.vz[a]! + this.vz[b]!) / 2;
      const dx = this.cx[poly]! - this.cx[prev]!;
      const dz = this.cz[poly]! - this.cz[prev]!;
      const crossA = dx * (this.vz[a]! - mz) - dz * (this.vx[a]! - mx);
      const [r, l] = crossA < 0 ? [a, b] : [b, a];
      lx.push(this.vx[l]!);
      lz.push(this.vz[l]!);
      rx.push(this.vx[r]!);
      rz.push(this.vz[r]!);
      polyOf.push(poly);
    }
    lx.push(ep.x);
    lz.push(ep.z);
    rx.push(ep.x);
    rz.push(ep.z);
    polyOf.push(chain[chain.length - 1]!.poly);

    // Simple stupid funnel (Mononen 2010), with (x, z) as the plane.
    const area2 = (ax: number, az: number, bx: number, bz: number, cx: number, cz: number): number =>
      (cx - ax) * (bz - az) - (bx - ax) * (cz - az);
    const out: { x: number; z: number; poly: number }[] = [{ x: sp.x, z: sp.z, poly: polyOf[0]! }];
    let apexX = sp.x;
    let apexZ = sp.z;
    let leftX = lx[0]!;
    let leftZ = lz[0]!;
    let rightX = rx[0]!;
    let rightZ = rz[0]!;
    let apexIndex = 0;
    let leftIndex = 0;
    let rightIndex = 0;
    const same = (ax: number, az: number, bx: number, bz: number): boolean =>
      (ax - bx) ** 2 + (az - bz) ** 2 < 1e-8;
    const n = lx.length;
    for (let i = 1; i < n; i++) {
      const nlx = lx[i]!;
      const nlz = lz[i]!;
      const nrx = rx[i]!;
      const nrz = rz[i]!;
      if (area2(apexX, apexZ, rightX, rightZ, nrx, nrz) <= 0) {
        if (same(apexX, apexZ, rightX, rightZ) || area2(apexX, apexZ, leftX, leftZ, nrx, nrz) > 0) {
          rightX = nrx;
          rightZ = nrz;
          rightIndex = i;
        } else {
          apexX = leftX;
          apexZ = leftZ;
          apexIndex = leftIndex;
          out.push({ x: apexX, z: apexZ, poly: polyOf[apexIndex]! });
          leftX = rightX = apexX;
          leftZ = rightZ = apexZ;
          leftIndex = rightIndex = apexIndex;
          i = apexIndex;
          continue;
        }
      }
      if (area2(apexX, apexZ, leftX, leftZ, nlx, nlz) >= 0) {
        if (same(apexX, apexZ, leftX, leftZ) || area2(apexX, apexZ, rightX, rightZ, nlx, nlz) < 0) {
          leftX = nlx;
          leftZ = nlz;
          leftIndex = i;
        } else {
          apexX = rightX;
          apexZ = rightZ;
          apexIndex = rightIndex;
          out.push({ x: apexX, z: apexZ, poly: polyOf[apexIndex]! });
          leftX = rightX = apexX;
          leftZ = rightZ = apexZ;
          leftIndex = rightIndex = apexIndex;
          i = apexIndex;
          continue;
        }
      }
    }
    const last = out[out.length - 1]!;
    if (!same(last.x, last.z, ep.x, ep.z)) out.push({ x: ep.x, z: ep.z, poly: polyOf[n - 1]! });
    // Drop repeats (a door's two link points can land on an apex twice).
    const path: NavPoint[] = [];
    for (const p of out) {
      const prev = path[path.length - 1];
      if (prev && same(prev.x, prev.z, p.x, p.z)) continue;
      path.push({ x: p.x, y: this.heightOn(p.poly, p.x, p.z), z: p.z });
    }
    path[0]!.y = sp.y;
    path[path.length - 1]!.y = ep.y;
    return path;
  }

  /** A random point on the mesh, polygons weighted by area (wanderers, tests). */
  randomPoint(random: () => number): NavPoint {
    let total = 0;
    for (const a of this.area) total += a;
    let pick = random() * total;
    let i = 0;
    for (; i < this.area.length - 1; i++) {
      pick -= this.area[i]!;
      if (pick <= 0) break;
    }
    const vs = this.polys[i]!;
    // A random fan triangle, then a random point in it.
    const k = 1 + Math.floor(random() * (vs.length - 2));
    const a = vs[0]!;
    const b = vs[k]!;
    const c = vs[k + 1]!;
    let u = random();
    let v = random();
    if (u + v > 1) {
      u = 1 - u;
      v = 1 - v;
    }
    const x = this.vx[a]! + u * (this.vx[b]! - this.vx[a]!) + v * (this.vx[c]! - this.vx[a]!);
    const z = this.vz[a]! + u * (this.vz[b]! - this.vz[a]!) + v * (this.vz[c]! - this.vz[a]!);
    return { x, y: this.heightOn(i, x, z), z };
  }

  /** Polygons reachable from `start` (edges and open door links). */
  reachable(start: number, closedDoors?: ReadonlySet<string>): Set<number> {
    const seen = new Set<number>([start]);
    const stack = [start];
    while (stack.length > 0) {
      const i = stack.pop()!;
      for (const n of this.neis[i] ?? []) {
        if (n >= 0 && !seen.has(n)) {
          seen.add(n);
          stack.push(n);
        }
      }
      for (const li of this.polyLinks[i] ?? []) {
        const l = this.links[li]!;
        if (closedDoors?.has(l.door)) continue;
        const n = l.a === i ? l.b : l.a;
        if (!seen.has(n)) {
          seen.add(n);
          stack.push(n);
        }
      }
    }
    return seen;
  }
}
