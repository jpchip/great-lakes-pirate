/**
 * Hulls that don't pass through each other (plan 03 §25.4, plan 07 §8.2; Phase 6 piece C):
 * every ship is a capsule, her keel line from bow to stern swept by half her beam. Two that
 * overlap are pushed apart by their masses, and their closing speed is taken off with a
 * little bounce. No damage: the ramming damage model is on plan 07 §12's cut list, so a
 * ram is a shove. Plain math on plain bodies, so it unit-tests.
 */

export interface Body {
  /** Zone meters; heading radians clockwise from north (zone z points south). */
  x: number;
  z: number;
  heading: number;
  /** Velocity, m/s. */
  vx: number;
  vz: number;
  /** Half the drawn length, and half the beam, meters. */
  halfLengthM: number;
  halfBeamM: number;
  /** Relative mass; Infinity for a ship that can't be moved (one sailing her timetable). */
  mass: number;
}

export interface Contact2 {
  a: number;
  b: number;
  /** Closing speed along the normal before the bounce, m/s (≥ 0). */
  closingMs: number;
  /** How far they overlapped, meters. */
  depthM: number;
}

/** How much of the closing speed comes back as bounce. */
export const RESTITUTION = 0.25;

/** A ship's relative mass from her drawn length and beam: displacement goes as L·B·draft. */
export function massOf(lengthM: number, beamM: number): number {
  return lengthM * beamM * beamM;
}

/** Closest points of segments p1q1 and p2q2 (2D), as parameters s, t in [0, 1]. */
function closestOnSegments(
  p1x: number,
  p1z: number,
  q1x: number,
  q1z: number,
  p2x: number,
  p2z: number,
  q2x: number,
  q2z: number,
): { s: number; t: number } {
  const d1x = q1x - p1x;
  const d1z = q1z - p1z;
  const d2x = q2x - p2x;
  const d2z = q2z - p2z;
  const rx = p1x - p2x;
  const rz = p1z - p2z;
  const a = d1x * d1x + d1z * d1z;
  const e = d2x * d2x + d2z * d2z;
  const f = d2x * rx + d2z * rz;
  const clamp = (v: number): number => Math.max(0, Math.min(1, v));
  if (a < 1e-9 && e < 1e-9) return { s: 0, t: 0 };
  if (a < 1e-9) return { s: 0, t: clamp(f / e) };
  const c = d1x * rx + d1z * rz;
  if (e < 1e-9) return { s: clamp(-c / a), t: 0 };
  const b = d1x * d2x + d1z * d2z;
  const denom = a * e - b * b;
  let s = denom > 1e-9 ? clamp((b * f - c * e) / denom) : 0;
  let t = (b * s + f) / e;
  if (t < 0) {
    t = 0;
    s = clamp(-c / a);
  } else if (t > 1) {
    t = 1;
    s = clamp((b - c) / a);
  }
  return { s, t };
}

function keel(b: Body): { px: number; pz: number; qx: number; qz: number } {
  const half = Math.max(0, b.halfLengthM - b.halfBeamM);
  const fx = Math.sin(b.heading) * half;
  const fz = -Math.cos(b.heading) * half;
  return { px: b.x + fx, pz: b.z + fz, qx: b.x - fx, qz: b.z - fz };
}

/**
 * Pushes every overlapping pair apart and takes off their closing speed. Moves the bodies
 * in place; returns the contacts, for the caller's events and the speed it gives back to
 * each ship's helm.
 */
export function collide(bodies: Body[], restitution = RESTITUTION): Contact2[] {
  const out: Contact2[] = [];
  for (let i = 0; i < bodies.length; i++) {
    for (let j = i + 1; j < bodies.length; j++) {
      const A = bodies[i] as Body;
      const B = bodies[j] as Body;
      const ia = A.mass === Infinity ? 0 : 1 / A.mass;
      const ib = B.mass === Infinity ? 0 : 1 / B.mass;
      if (ia + ib === 0) continue;
      const reach = A.halfLengthM + B.halfLengthM;
      if (Math.abs(A.x - B.x) > reach || Math.abs(A.z - B.z) > reach) continue;
      const ka = keel(A);
      const kb = keel(B);
      const { s, t } = closestOnSegments(ka.px, ka.pz, ka.qx, ka.qz, kb.px, kb.pz, kb.qx, kb.qz);
      const ax = ka.px + (ka.qx - ka.px) * s;
      const az = ka.pz + (ka.qz - ka.pz) * s;
      const bx = kb.px + (kb.qx - kb.px) * t;
      const bz = kb.pz + (kb.qz - kb.pz) * t;
      let nx = bx - ax;
      let nz = bz - az;
      const d = Math.hypot(nx, nz);
      const depth = A.halfBeamM + B.halfBeamM - d;
      if (depth <= 0) continue;
      if (d > 1e-6) {
        nx /= d;
        nz /= d;
      } else {
        // Dead on top of each other: push out across A's beam.
        nx = Math.cos(A.heading);
        nz = Math.sin(A.heading);
      }
      // Separate, by inverse mass.
      const share = depth / (ia + ib);
      A.x -= nx * share * ia;
      A.z -= nz * share * ia;
      B.x += nx * share * ib;
      B.z += nz * share * ib;
      // Closing speed along the normal (positive: closing).
      const closing = (A.vx - B.vx) * nx + (A.vz - B.vz) * nz;
      if (closing > 0) {
        const jn = ((1 + restitution) * closing) / (ia + ib);
        A.vx -= nx * jn * ia;
        A.vz -= nz * jn * ia;
        B.vx += nx * jn * ib;
        B.vz += nz * jn * ib;
      }
      out.push({ a: i, b: j, closingMs: Math.max(0, closing), depthM: depth });
    }
  }
  return out;
}

/**
 * The water between two hulls, meters: the closest points of their keel lines less half
 * of each beam (negative when they overlap). Boarding (Phase 6 piece D) grapples within a
 * few meters of it.
 */
export function hullGapM(a: Body, b: Body): number {
  const ka = keel(a);
  const kb = keel(b);
  const { s, t } = closestOnSegments(ka.px, ka.pz, ka.qx, ka.qz, kb.px, kb.pz, kb.qx, kb.qz);
  const ax = ka.px + (ka.qx - ka.px) * s;
  const az = ka.pz + (ka.qz - ka.pz) * s;
  const bx = kb.px + (kb.qx - kb.px) * t;
  const bz = kb.pz + (kb.qz - kb.pz) * t;
  return Math.hypot(ax - bx, az - bz) - a.halfBeamM - b.halfBeamM;
}
