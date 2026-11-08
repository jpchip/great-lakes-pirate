/**
 * Shot in flight (plan 07 §4.1; Phase 6 piece A): kinematic arcs from a muzzle velocity
 * and gravity, no physics engine and no drag. Scene meters and real seconds: the frame the
 * ships are drawn and steered in. Positions are zone axes (x east, y up, z south);
 * bearings are radians clockwise from north, elevations radians above the horizon.
 */

export const GRAVITY_MS2 = 9.81;

const DEG = Math.PI / 180;
/** Elevations a gun's sight is laid between: a little depression, up to the best range. */
const MIN_ELEVATION = -8 * DEG;
const MAX_ELEVATION = 45 * DEG;

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

/** A shot's velocity leaving the muzzle, before the ship's own way is added. */
export function launchVelocity(speed: number, bearing: number, elevation: number): Vec3 {
  const flat = Math.cos(elevation) * speed;
  return {
    x: Math.sin(bearing) * flat,
    y: Math.sin(elevation) * speed,
    z: -Math.cos(bearing) * flat,
  };
}

/** Where a shot is `t` seconds after leaving `p0` at `v0`. */
export function positionAt(p0: Vec3, v0: Vec3, t: number, g = GRAVITY_MS2): Vec3 {
  return { x: p0.x + v0.x * t, y: p0.y + v0.y * t - 0.5 * g * t * t, z: p0.z + v0.z * t };
}

/** Seconds until a shot from height `h0` with upward speed `vy` comes down to sea level. */
export function timeToWater(h0: number, vy: number, g = GRAVITY_MS2): number {
  // h0 + vy t - g t²/2 = 0, the later root.
  return (vy + Math.sqrt(Math.max(0, vy * vy + 2 * g * h0))) / g;
}

/** How far over the water a shot carries before it falls in, meters. */
export function rangeFor(speed: number, elevation: number, h0: number, g = GRAVITY_MS2): number {
  const vy = Math.sin(elevation) * speed;
  return Math.cos(elevation) * speed * timeToWater(h0, vy, g);
}

/** The furthest a gun throws from height `h0`, meters (at the best elevation the sight allows). */
export function maxRange(speed: number, h0: number, g = GRAVITY_MS2): number {
  return rangeFor(speed, MAX_ELEVATION, h0, g);
}

/**
 * The low elevation that drops a shot at `range` meters from a muzzle `h0` above the water;
 * undefined when it's out of reach. Range rises with elevation over the sight's span, so a
 * bisection finds it.
 */
export function elevationFor(
  range: number,
  speed: number,
  h0: number,
  g = GRAVITY_MS2,
): number | undefined {
  let lo = MIN_ELEVATION;
  let hi = MAX_ELEVATION;
  if (range <= rangeFor(speed, lo, h0, g)) return lo;
  if (range > rangeFor(speed, hi, h0, g)) return undefined;
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2;
    if (rangeFor(speed, mid, h0, g) < range) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

/**
 * Where to lay a gun to hit a ship moving at a steady velocity: the bearing and elevation
 * of the point she'll be at when the shot gets there. Iterates on the time of flight; the
 * shooter's own way is in `own` (the shot carries it). Undefined when out of reach.
 */
export function leadSolution(
  muzzle: Vec3,
  own: { x: number; z: number },
  target: { x: number; z: number; vx: number; vz: number },
  speed: number,
  g = GRAVITY_MS2,
): { bearing: number; elevation: number; flightS: number } | undefined {
  let t = 0;
  let sol: { bearing: number; elevation: number; flightS: number } | undefined;
  for (let i = 0; i < 8; i++) {
    // Relative to the moving gun, the target moves at her velocity less ours.
    const ax = target.x + (target.vx - own.x) * t - muzzle.x;
    const az = target.z + (target.vz - own.z) * t - muzzle.z;
    const range = Math.hypot(ax, az);
    const elevation = elevationFor(range, speed, muzzle.y, g);
    if (elevation === undefined) return undefined;
    const bearing = Math.atan2(ax, -az);
    const flightS = timeToWater(muzzle.y, Math.sin(elevation) * speed, g);
    sol = { bearing, elevation, flightS };
    if (Math.abs(flightS - t) < 1e-3) break;
    t = flightS;
  }
  return sol;
}
