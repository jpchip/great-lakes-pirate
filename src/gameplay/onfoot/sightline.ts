import type { Collider, ColliderSet } from './colliders';
import type { Heightfield } from './heightfield';

/**
 * Lines of sight on foot (plan 08 §4.1 cover, §4.2 walls; Phase 7 piece D): whether a
 * straight line between two points passes through a prop, a wall or the ground. Every
 * collider is a footprint extruded between two heights, so a line is clipped to the
 * footprint in plan view and then checked against the heights over that stretch.
 */

export interface P3 {
  x: number;
  y: number;
  z: number;
}

const near: Collider[] = [];

/**
 * The stretch [t0, t1] of the segment a→b (as fractions of it) that lies over the
 * collider's footprint, or undefined if it never does.
 */
function clipToFootprint(
  c: Collider,
  ax: number,
  az: number,
  bx: number,
  bz: number,
): [number, number] | undefined {
  if (c.kind === 'cylinder') {
    const dx = bx - ax;
    const dz = bz - az;
    const fx = ax - c.x;
    const fz = az - c.z;
    const A = dx * dx + dz * dz;
    const B = 2 * (fx * dx + fz * dz);
    const C = fx * fx + fz * fz - c.radius * c.radius;
    if (A < 1e-12) return C <= 0 ? [0, 1] : undefined;
    const disc = B * B - 4 * A * C;
    if (disc < 0) return undefined;
    const s = Math.sqrt(disc);
    const t0 = Math.max(0, (-B - s) / (2 * A));
    const t1 = Math.min(1, (-B + s) / (2 * A));
    return t0 <= t1 ? [t0, t1] : undefined;
  }
  // Into the box's frame (the inverse of its yaw), then a slab test.
  const cos = Math.cos(c.yaw);
  const sin = Math.sin(c.yaw);
  const lax = (ax - c.x) * cos - (az - c.z) * sin;
  const laz = (ax - c.x) * sin + (az - c.z) * cos;
  const lbx = (bx - c.x) * cos - (bz - c.z) * sin;
  const lbz = (bx - c.x) * sin + (bz - c.z) * cos;
  let t0 = 0;
  let t1 = 1;
  const slab = (a: number, b: number, half: number): boolean => {
    const d = b - a;
    if (Math.abs(d) < 1e-12) return a >= -half && a <= half;
    let e0 = (-half - a) / d;
    let e1 = (half - a) / d;
    if (e0 > e1) [e0, e1] = [e1, e0];
    t0 = Math.max(t0, e0);
    t1 = Math.min(t1, e1);
    return t0 <= t1;
  };
  if (!slab(lax, lbx, c.halfX)) return undefined;
  if (!slab(laz, lbz, c.halfZ)) return undefined;
  return [t0, t1];
}

/** Whether the segment passes through this collider. */
export function segmentHits(c: Collider, a: P3, b: P3): boolean {
  const span = clipToFootprint(c, a.x, a.z, b.x, b.z);
  if (!span) return false;
  const y0 = a.y + (b.y - a.y) * span[0];
  const y1 = a.y + (b.y - a.y) * span[1];
  return Math.min(y0, y1) < c.maxY && Math.max(y0, y1) > c.minY;
}

/**
 * Whether anything solid stands between a and b: a collider, or the ground rising above
 * the line (sampled every `groundStepM`; pass 0 to skip the ground on flat districts).
 */
export function lineBlocked(
  colliders: ColliderSet,
  a: P3,
  b: P3,
  ground?: Heightfield,
  groundStepM = 1,
): boolean {
  const mx = (a.x + b.x) / 2;
  const mz = (a.z + b.z) / 2;
  const half = Math.hypot(b.x - a.x, b.z - a.z) / 2;
  colliders.query(mx, mz, half + 0.5, near);
  for (const c of near) if (segmentHits(c, a, b)) return true;
  if (ground && groundStepM > 0) {
    const d = half * 2;
    for (let s = groundStepM; s < d - groundStepM * 0.5; s += groundStepM) {
      const t = s / d;
      const y = a.y + (b.y - a.y) * t;
      if (ground.heightAt(a.x + (b.x - a.x) * t, a.z + (b.z - a.z) * t) > y) return true;
    }
  }
  return false;
}
