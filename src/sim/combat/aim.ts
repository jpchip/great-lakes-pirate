import type { Mount, WeaponDef } from '../../../data/schemas/combat';
import { arcCenter } from './armament';
import { elevationFor, launchVelocity, positionAt, type Vec3 } from './ballistics';

/**
 * Laying a gun by eye (plan 07 §3; Phase 6 piece B): where the cursor puts the shot on the
 * water, held inside the gun's arc and reach, the elevation that carries it there, how the
 * ship's roll throws the barrel off that, and the dotted arc and splash ring the player
 * sees, cut short where the light or the fog won't let them see.
 *
 * Pure math on the combat core's frame: zone axes (x east, y up, z south), bearings in
 * radians clockwise from north, elevations above the horizon, scene meters and seconds.
 */

/** The three things a captain shoots with, as 1/2/3 pick them (§3). */
export type AimWeapon = 'swivel' | 'broadside' | 'rifle';

export const AIM_WEAPONS: readonly AimWeapon[] = ['swivel', 'broadside', 'rifle'];

/** The weapon kind each aim choice lays. */
export const AIM_KIND: Record<AimWeapon, WeaponDef['kind']> = {
  swivel: 'swivel',
  broadside: 'broadside',
  rifle: 'small_arms',
};

const TAU = Math.PI * 2;

export function wrapPi(a: number): number {
  return a - TAU * Math.floor((a + Math.PI) / TAU);
}

/** The broadside the aim point lies on: starboard if it's off her right hand. */
export function sideFor(heading: number, bearing: number): 'port' | 'starboard' {
  return wrapPi(bearing - heading) >= 0 ? 'starboard' : 'port';
}

/** Where a laid gun's shot goes, and whether the player had to be held back to get it. */
export interface AimSolution {
  mount: Mount;
  /** Radians from north, inside the arc. */
  bearing: number;
  /** Horizontal meters from the muzzle to where the shot should fall. */
  rangeM: number;
  /** The sight's elevation for that range, before the roll throws it off. */
  elevation: number;
  /** The aim point was outside the arc and was brought back to its edge. */
  arcLimited: boolean;
  /** The aim point was beyond the gun's reach. */
  beyondReach: boolean;
}

/** Closest a gun is laid: inside it the shot goes over the boat alongside anyway. */
export const MIN_AIM_M = 15;

/**
 * Lays a gun on a point on the water: the bearing held to the mount's arc, the range to
 * the gun's reach, and the elevation that drops the shot there from this muzzle.
 */
export function solveAim(
  w: WeaponDef,
  mount: Mount,
  muzzle: Vec3,
  heading: number,
  aim: { x: number; z: number },
  reachM: number,
): AimSolution {
  const dx = aim.x - muzzle.x;
  const dz = aim.z - muzzle.z;
  let bearing = Math.atan2(dx, -dz);
  let arcLimited = false;
  if (w.arcDeg < 360) {
    const center = heading + arcCenter(mount);
    const half = ((w.arcDeg / 2) * Math.PI) / 180;
    const off = wrapPi(bearing - center);
    if (Math.abs(off) > half) {
      bearing = wrapPi(center + Math.sign(off) * half);
      arcLimited = true;
    }
  }
  const want = Math.hypot(dx, dz);
  const beyondReach = want > reachM;
  const rangeM = Math.min(Math.max(want, MIN_AIM_M), reachM);
  const elevation = elevationFor(rangeM, w.muzzleMs, muzzle.y) ?? 0;
  return { mount, bearing, rangeM, elevation, arcLimited, beyondReach };
}

/**
 * How the ship's motion throws a gun's barrel off its sight, radians of elevation: a
 * broadside rises with her side as she rolls (a starboard gun points up as her starboard
 * side comes up), the bow swivel with her bow. The gunner lays out her steady heel, so
 * only the sea's roll and pitch count; the rifleman rides it with his knees, mostly.
 */
export function barrelTilt(
  mount: Mount,
  motion: { roll: number; pitch: number; heel: number },
): number {
  const wave = motion.roll - motion.heel;
  switch (mount) {
    case 'starboard':
      return wave;
    case 'port':
      return -wave;
    case 'bow':
      return motion.pitch + 0.25 * Math.abs(wave);
    case 'hand':
      return 0.2 * motion.pitch;
  }
}

/** The dotted arc and the splash ring, as drawn. */
export interface ArcPreview {
  /** Points along the flight, muzzle first, as far as the eye carries. */
  points: Vec3[];
  /** Where she falls in, if that can be seen; undefined when it's past sight. */
  splash: { x: number; z: number; radiusM: number } | undefined;
  /** Where the shot would fall, seen or not. */
  impact: { x: number; z: number };
  flightS: number;
}

const PREVIEW_DOTS = 28;

/**
 * Flies the shot the gun would throw now (the sight plus the barrel's tilt) and samples
 * its path. The ring is the spread the gun throws at that range; the arc stops at
 * `sightM` from the muzzle and the ring isn't drawn past it (§3: shortened at night and in
 * fog, you can't see as far).
 */
export function previewArc(
  muzzle: Vec3,
  own: { x: number; z: number },
  bearing: number,
  elevation: number,
  muzzleMs: number,
  spreadRad: number,
  sightM: number,
): ArcPreview {
  const v = launchVelocity(muzzleMs, bearing, elevation);
  const vel = { x: v.x + own.x, y: v.y, z: v.z + own.z };
  // The later root of y(t) = 0.
  const g = 9.81;
  const flightS = (vel.y + Math.sqrt(Math.max(0, vel.y * vel.y + 2 * g * muzzle.y))) / g;
  const end = positionAt(muzzle, vel, flightS);
  const points: Vec3[] = [];
  for (let i = 0; i <= PREVIEW_DOTS; i++) {
    const p = positionAt(muzzle, vel, (flightS * i) / PREVIEW_DOTS);
    if (Math.hypot(p.x - muzzle.x, p.z - muzzle.z) > sightM) break;
    points.push(p);
  }
  const range = Math.hypot(end.x - muzzle.x, end.z - muzzle.z);
  const splash =
    range <= sightM
      ? { x: end.x, z: end.z, radiusM: Math.max(2.5, Math.tan(spreadRad) * range) }
      : undefined;
  return { points, splash, impact: { x: end.x, z: end.z }, flightS };
}

/** How far a gunner can see to lay a shot (§3), from the light and the fog. */
export interface AimSight {
  /** The perception module's sight for a ship's hull in this light (5 km by day). */
  ambientM: number;
  /** Fog and haze visibility, zone meters. */
  fogM: number;
}

/** A splash is a smaller thing than a hull: a fraction of what a ship is made out at. */
const SPLASH_SIGHT_SHARE = 0.35;
/** Fog hides the fall of shot well before it hides a ship's loom. */
const FOG_SIGHT_SHARE = 0.6;
/** Even on a black night, the near water shows by the muzzle's flash. */
const MIN_SIGHT_M = 70;

export function aimSightM(s: AimSight): number {
  return Math.max(MIN_SIGHT_M, Math.min(s.ambientM * SPLASH_SIGHT_SHARE, s.fogM * FOG_SIGHT_SHARE));
}
