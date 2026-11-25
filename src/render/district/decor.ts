import * as THREE from 'three';
import type { DistrictBuilding, DistrictModel } from '../../gameplay/district/district';
import { WALL_M } from '../../sim/district/kit';
import { box, frustum, part, strut } from '../style/parts';
import { barrel, crate, TELEGRAPH_ARM_M } from './kit-meshes';
import { idHash } from './styles';

/**
 * The lived-in clutter of a district (the 0.9 district polish), drawn only: wash on lines
 * behind the houses, rain barrels and stove wood at their corners, goods set out by the
 * shop doors, a bench outside the saloon, and the telegraph wires between the poles. All
 * of it is small and stands against a wall or in a back yard, so it has no colliders and
 * needs no navmesh rebake; it merges into the body mesh of its block.
 */

const POST = 0x6a5440;
const WIRE = 0x2a2724;
const PLANK = 0x7a6450;
const PLANK_DARK = 0x5d4a3a;
const SACK = 0xc8b998;
/** Wash on the line: bleached linen, unbleached, chambray, red flannel, gray wool. */
const WASH = [0xf0ece0, 0xe0d6bc, 0x7d93a8, 0xa33a2c, 0x8d8a84, 0xd8c7a0] as const;

function rand(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s * 16807 + 11) % 2147483647;
    return s / 2147483647;
  };
}

/** A wall's frame: a point on it, the way along it, and the way out of the building. */
interface WallFrame {
  at: THREE.Vector3;
  along: THREE.Vector3;
  out: THREE.Vector3;
  len: number;
}

function wallOf(b: DistrictBuilding, side: number): WallFrame {
  const cx = (b.minX + b.maxX) / 2;
  const cz = (b.minZ + b.maxZ) / 2;
  const y = b.floorY;
  switch (side) {
    case 0:
      return {
        at: new THREE.Vector3(cx, y, b.minZ),
        along: new THREE.Vector3(1, 0, 0),
        out: new THREE.Vector3(0, 0, -1),
        len: b.maxX - b.minX,
      };
    case 2:
      return {
        at: new THREE.Vector3(cx, y, b.maxZ),
        along: new THREE.Vector3(1, 0, 0),
        out: new THREE.Vector3(0, 0, 1),
        len: b.maxX - b.minX,
      };
    case 1:
      return {
        at: new THREE.Vector3(b.maxX, y, cz),
        along: new THREE.Vector3(0, 0, 1),
        out: new THREE.Vector3(1, 0, 0),
        len: b.maxZ - b.minZ,
      };
    default:
      return {
        at: new THREE.Vector3(b.minX, y, cz),
        along: new THREE.Vector3(0, 0, 1),
        out: new THREE.Vector3(-1, 0, 0),
        len: b.maxZ - b.minZ,
      };
  }
}

/** Moves parts built in a frame (x along the wall, z out of it) onto the wall. */
function onWall(
  parts: THREE.BufferGeometry[],
  f: WallFrame,
  t: number,
  o: number,
  y = 0,
): THREE.BufferGeometry[] {
  const yaw = Math.atan2(f.out.x, f.out.z);
  const p = f.at.clone().addScaledVector(f.along, t).addScaledVector(f.out, o);
  for (const g of parts) g.rotateY(yaw).translate(p.x, p.y + y, p.z);
  return parts;
}

/** The side a building's first door is in (0 north, 1 east, 2 south, 3 west), if any. */
function doorSide(model: DistrictModel, b: DistrictBuilding): number | undefined {
  const d = model.doors.find((k) => k.building === b.def.id);
  if (!d) return undefined;
  const cx = (b.minX + b.maxX) / 2;
  const cz = (b.minZ + b.maxZ) / 2;
  if (d.alongX) return d.z < cz ? 0 : 2;
  return d.x > cx ? 1 : 3;
}

/** Nothing else stands here: no building, no prop, no door within `r`, and inside bounds. */
function clear(model: DistrictModel, x: number, z: number, y: number, r: number): boolean {
  if (x < model.minX + 1 || x > model.maxX - 1 || z < model.minZ + 1 || z > model.maxZ - 1)
    return false;
  if (model.buildingAt(x, y + 0.5, z)) return false;
  for (const b of model.buildings)
    if (x > b.minX - r && x < b.maxX + r && z > b.minZ - r && z < b.maxZ + r) return false;
  for (const p of model.props) if (Math.hypot(p.x - x, p.z - z) < r + 0.6) return false;
  for (const d of model.doors) if (Math.hypot(d.x - x, d.z - z) < r + 1.2) return false;
  return Math.abs(model.floorAt(x, z) - y) < 1.2;
}

/** Near a wall but clear of props and doors (the building itself is allowed). */
function freeByWall(model: DistrictModel, x: number, z: number, r: number): boolean {
  for (const p of model.props) if (Math.hypot(p.x - x, p.z - z) < r + 0.5) return false;
  for (const d of model.doors) if (Math.hypot(d.x - x, d.z - z) < r + 0.9) return false;
  for (const b of model.buildings)
    if (x > b.minX + 0.05 && x < b.maxX - 0.05 && z > b.minZ + 0.05 && z < b.maxZ - 0.05)
      return false;
  return true;
}

function garment(
  out: THREE.BufferGeometry[],
  kind: number,
  x: number,
  y: number,
  color: number,
): number {
  switch (kind) {
    case 0: {
      // A sheet, folded over the line.
      out.push(box(0.95, 1.05, 0.02, x, y - 1.05, 0, color));
      return 1.0;
    }
    case 1: {
      // A shirt with its arms out.
      out.push(box(0.46, 0.62, 0.03, x, y - 0.64, 0, color));
      out.push(box(0.82, 0.16, 0.03, x, y - 0.2, 0, color));
      return 0.88;
    }
    case 2: {
      // Trousers by the cuffs.
      for (const sx of [-0.12, 0.12]) out.push(box(0.2, 0.82, 0.03, x + sx, y - 0.84, 0, color));
      out.push(box(0.46, 0.18, 0.03, x, y - 0.98, 0, color));
      return 0.55;
    }
    default: {
      // Long underwear or a nightshirt.
      out.push(box(0.4, 0.95, 0.03, x, y - 0.97, 0, color));
      return 0.48;
    }
  }
}

/** A clothesline on two T posts, `len` long, along local x, in the yard (z out). */
function washLine(out: THREE.BufferGeometry[], len: number, seed: number): void {
  const r = rand(Math.floor(seed * 1e6) + 7);
  for (const sx of [-len / 2, len / 2]) {
    out.push(box(0.1, 2.15, 0.1, sx, 0, 0, POST));
    out.push(box(0.08, 0.08, 0.9, sx, 1.95, 0, POST));
  }
  for (const z of [-0.35, 0.35]) {
    // Sagging a little in the middle.
    const a = new THREE.Vector3(-len / 2, 1.97, z);
    const m = new THREE.Vector3(0, 1.82, z);
    const b = new THREE.Vector3(len / 2, 1.97, z);
    out.push(strut(a, m, 0.01, WIRE), strut(m, b, 0.01, WIRE));
  }
  let x = -len / 2 + 0.5;
  while (x < len / 2 - 0.6) {
    const kind = Math.floor(r() * 4);
    const color = WASH[Math.floor(r() * WASH.length)] as number;
    const z = r() < 0.5 ? -0.35 : 0.35;
    const g: THREE.BufferGeometry[] = [];
    const w = garment(g, kind, 0, 1.92 - 0.14 * (1 - Math.abs(x) / (len / 2)), color);
    for (const p of g) out.push(p.translate(x + w / 2, 0, z));
    x += w + 0.15 + r() * 0.4;
  }
}

function rainBarrel(out: THREE.BufferGeometry[]): void {
  barrel(out, 0, 0, 0, 1.05);
  out.push(frustum(0.3, 0.3, 0.04, 8, 0, 0.94, 0, 0x2f3638));
  // The downspout from the eaves.
  out.push(box(0.1, 2.2, 0.1, 0, 1.0, -0.25, 0x6c6a64));
}

function stoveWood(out: THREE.BufferGeometry[], len: number): void {
  for (let k = 0; k < 4; k++)
    for (let j = 0; j < Math.floor(len / 0.24); j++) {
      const g = part(new THREE.CylinderGeometry(0.11, 0.11, 0.5, 5), j % 3 ? 0x8d6b47 : 0x7a5d3e);
      g.rotateX(Math.PI / 2).translate(
        -len / 2 + 0.12 + j * 0.24 + (k % 2) * 0.06,
        0.11 + k * 0.21,
        0,
      );
      out.push(g);
    }
  out.push(
    box(len + 0.3, 0.06, 0.8, 0, 1.0, 0.05, 0x5e4a3a)
      .rotateX(-0.25)
      .translate(0, 0.1, 0),
  );
}

function bench(out: THREE.BufferGeometry[], len: number): void {
  out.push(box(len, 0.06, 0.38, 0, 0.44, 0, PLANK));
  out.push(box(len, 0.32, 0.05, 0, 0.62, -0.17, PLANK));
  for (const sx of [-len / 2 + 0.12, len / 2 - 0.12])
    out.push(box(0.06, 0.44, 0.34, sx, 0, 0, PLANK_DARK));
}

function sacks(out: THREE.BufferGeometry[], n: number): void {
  for (let k = 0; k < n; k++) {
    const g = part(new THREE.IcosahedronGeometry(0.34, 0), k % 2 ? SACK : 0xb8a984);
    g.scale(0.8, 1.15, 0.7).translate(-0.32 * (n - 1) + k * 0.64, 0.38, 0);
    out.push(g);
  }
}

function ropeCoil(out: THREE.BufferGeometry[], x: number, y: number): void {
  for (let k = 0; k < 3; k++) {
    const g = part(new THREE.TorusGeometry(0.34 - k * 0.04, 0.06, 4, 10), 0xb89a62);
    g.rotateX(Math.PI / 2).translate(x, y + 0.06 + k * 0.1, 0);
    out.push(g);
  }
}

function sandwichBoard(out: THREE.BufferGeometry[]): void {
  for (const s of [-1, 1]) {
    const g = box(0.6, 0.95, 0.04, 0, 0, 0, 0x2a2a28);
    g.rotateX(s * 0.22).translate(0, 0, s * 0.12);
    out.push(g);
    const f = box(0.66, 1.0, 0.03, 0, -0.03, 0, 0x6a4b33);
    f.rotateX(s * 0.22).translate(0, 0, s * 0.11);
    out.push(f);
  }
}

/** The telegraph wires: each pole to its nearest neighbours, sagging between. */
function telegraphWires(model: DistrictModel, out: THREE.BufferGeometry[]): void {
  const poles = model.props.filter((p) => p.piece.id === 'kit.telegraph_pole');
  const done = new Set<string>();
  const arm = (p: (typeof poles)[number], s: number): THREE.Vector3 => {
    const local = new THREE.Vector3(0, p.piece.heightM - 0.44, s);
    local.applyAxisAngle(new THREE.Vector3(0, 1, 0), -p.heading);
    return local.add(new THREE.Vector3(p.x, p.y, p.z));
  };
  poles.forEach((a, i) => {
    const near = poles
      .map((b, j) => ({ j, d: Math.hypot(b.x - a.x, b.z - a.z) }))
      .filter((n) => n.j !== i && n.d < 48)
      .sort((p, q) => p.d - q.d)
      .slice(0, 2);
    for (const { j, d } of near) {
      const key = i < j ? `${i}:${j}` : `${j}:${i}`;
      if (done.has(key)) continue;
      done.add(key);
      const b = poles[j];
      if (!b) continue;
      for (const s of [-TELEGRAPH_ARM_M, -0.25, 0.25, TELEGRAPH_ARM_M]) {
        const p0 = arm(a, s);
        // The matching pin on the far pole: the one on the same side of the line.
        const c1 = arm(b, s);
        const c2 = arm(b, -s);
        const p1 = p0.distanceTo(c1) <= p0.distanceTo(c2) ? c1 : c2;
        const sag = 0.25 + d * 0.012;
        const n = 8;
        let prev = p0;
        for (let k = 1; k <= n; k++) {
          const t = k / n;
          const q = p0.clone().lerp(p1, t);
          q.y -= sag * 4 * t * (1 - t);
          out.push(strut(prev, q, 0.012, WIRE));
          prev = q;
        }
      }
    }
  });
}

/** Everything above, in district meters, for the view to merge into its blocks. */
export function decorGeometry(model: DistrictModel): THREE.BufferGeometry[] {
  const out: THREE.BufferGeometry[] = [];
  telegraphWires(model, out);
  for (const b of model.buildings) {
    const h = idHash(b.def.id);
    const front = doorSide(model, b);
    if (front === undefined) continue;
    const back = (front + 2) % 4;
    const left = (front + 3) % 4;
    const right = (front + 1) % 4;
    if (b.def.kind === 'house') {
      // Wash on the line in the back yard, most days.
      if (h < 0.7) {
        const f = wallOf(b, back);
        const len = Math.min(f.len - 0.4, 5.5);
        // Clear of the privy and the woodshed: try the middle of the yard, then either side.
        for (const t of [0, -1.6, 1.6]) {
          const at = f.at.clone().addScaledVector(f.along, t).addScaledVector(f.out, 3.0);
          const end = (s: number): THREE.Vector3 =>
            at.clone().addScaledVector(f.along, (s * len) / 2);
          const ok = [at, end(-1), end(1)].every((q) => clear(model, q.x, q.z, b.floorY, 0.5));
          if (!ok) continue;
          const g: THREE.BufferGeometry[] = [];
          washLine(g, len, h);
          out.push(...onWall(g, f, t, 3.0, model.floorAt(at.x, at.z) - b.floorY));
          break;
        }
      }
      // A rain barrel at a front corner, and stove wood along a side wall.
      const fw = wallOf(b, front);
      const corner = (h < 0.5 ? -1 : 1) * (fw.len / 2 - 0.45);
      const bp = fw.at.clone().addScaledVector(fw.along, corner).addScaledVector(fw.out, 0.45);
      if (freeByWall(model, bp.x, bp.z, 0.4)) {
        const g: THREE.BufferGeometry[] = [];
        rainBarrel(g);
        out.push(...onWall(g, fw, corner, 0.45, model.floorAt(bp.x, bp.z) - b.floorY));
      }
      const sw = wallOf(b, h < 0.5 ? right : left);
      const wp = sw.at.clone().addScaledVector(sw.out, 0.4);
      if (freeByWall(model, wp.x, wp.z, 1.0)) {
        const g: THREE.BufferGeometry[] = [];
        stoveWood(g, Math.min(2.2, sw.len - 1.5));
        out.push(...onWall(g, sw, 0, WALL_M / 2 + 0.32, model.floorAt(wp.x, wp.z) - b.floorY));
      }
      continue;
    }
    // Goods set out by a shop's door, a bench by the saloon's.
    const door = model.doors.find((d) => d.building === b.def.id);
    if (!door) continue;
    const f = wallOf(b, front);
    const along =
      (door.alongX ? door.x - f.at.x : door.z - f.at.z) * (door.alongX ? f.along.x : f.along.z);
    const items: { t: number; draw: (g: THREE.BufferGeometry[]) => void; r: number }[] = [];
    const s = h < 0.5 ? -1 : 1;
    switch (b.def.kind) {
      case 'store':
        items.push({
          t: along + s * (door.widthM / 2 + 0.9),
          r: 0.5,
          draw: (g) => barrel(g, 0, 0, 0),
        });
        items.push({
          t: along + s * (door.widthM / 2 + 1.75),
          r: 0.5,
          draw: (g) => crate(g, 0.75, 0, 0, 0, 1),
        });
        items.push({ t: along - s * (door.widthM / 2 + 1.4), r: 0.8, draw: (g) => sacks(g, 3) });
        break;
      case 'chandlery':
        items.push({
          t: along + s * (door.widthM / 2 + 0.9),
          r: 0.5,
          draw: (g) => ropeCoil(g, 0, 0),
        });
        items.push({
          t: along + s * (door.widthM / 2 + 1.8),
          r: 0.5,
          draw: (g) => barrel(g, 0, 0, 0, 0.9),
        });
        items.push({
          t: along - s * (door.widthM / 2 + 1.0),
          r: 0.5,
          draw: (g) => {
            ropeCoil(g, 0, 0);
            ropeCoil(g, 0, 0.32);
          },
        });
        break;
      case 'saloon':
        items.push({ t: along + s * (door.widthM / 2 + 1.6), r: 0.9, draw: (g) => bench(g, 1.8) });
        items.push({
          t: along - s * (door.widthM / 2 + 0.8),
          r: 0.4,
          draw: (g) => sandwichBoard(g),
        });
        break;
      case 'fishShed':
      case 'packingHouse':
      case 'warehouse':
      case 'cooperage':
        if (h < 0.6)
          items.push({
            t: along + s * (door.widthM / 2 + 1.0),
            r: 0.5,
            draw: (g) => barrel(g, 0, 0, 0),
          });
        break;
      default:
        break;
    }
    for (const it of items) {
      if (Math.abs(it.t) > f.len / 2 - 0.5) continue;
      const o = WALL_M / 2 + 0.45;
      const p = f.at.clone().addScaledVector(f.along, it.t).addScaledVector(f.out, o);
      // Skip the false front's pilasters and anything already there.
      if (!freeByWall(model, p.x, p.z, it.r * 0.6)) continue;
      const g: THREE.BufferGeometry[] = [];
      it.draw(g);
      out.push(...onWall(g, f, it.t, o, model.floorAt(p.x, p.z) - b.floorY));
    }
  }
  return out;
}
