import { knotsToMs, sceneSpeed } from '../../core/coords';

/**
 * A stand-in helm for spike S7: sail levels from plan 02 §3.2 on a steady beam reach,
 * first-order inertia, and a speed-dependent turn rate. No wind model; plan 02 brings
 * the real one. Speeds are game knots; the ship moves at v₃ᴅ = v × R / C.
 */

/** Furled, Reefed, Half, Full (plan 02 §3.2). */
export const SAIL_LEVELS = ['Furled', 'Reefed', 'Half', 'Full'] as const;
export const SAIL_FACTORS = [0, 0.45, 0.75, 1] as const;

export interface HelmParams {
  /** T2 schooner hull max speed, game knots (plan 02 §10). */
  hullMaxSpeedKn: number;
  /** Fraction of hull speed the steady test wind gives at Full sail. */
  windFactor: number;
  /** Seconds to reach 63% of a new target speed. */
  accelTau: number;
  /** Best turn rate in degrees per real second, at moderate speed. */
  turnRateDeg: number;
  /** Rowing speed with the sweeps, game knots (plan 02 §3.6), used to back off. */
  sweepsKn: number;
  /** Keel depth, meters; shallower water grounds the ship. */
  draftM: number;
  /** Hull length, meters, for the bow and stern grounding probes. */
  lengthM: number;
}

export const DEFAULT_HELM: HelmParams = {
  hullMaxSpeedKn: 9,
  windFactor: 0.85,
  accelTau: 6,
  turnRateDeg: 6,
  sweepsKn: 1.5,
  draftM: 3,
  lengthM: 30,
};

export interface ShipState {
  /** Zone meters. */
  x: number;
  z: number;
  /** Radians, clockwise from north. */
  heading: number;
  /** Game knots; negative is astern under sweeps. */
  speedKn: number;
  sailLevel: number;
  aground: boolean;
}

export interface HelmInput {
  /** -1 port … 1 starboard. */
  steer: number;
  raise: boolean;
  lower: boolean;
  /** Row astern with the sweeps (held while furled). */
  astern: boolean;
}

export interface Scale {
  /** Horizontal compression C. */
  compression: number;
  /** Game seconds per real second, R. */
  rate: number;
}

const smoothstep = (a: number, b: number, t: number): number => {
  const x = Math.min(Math.max((t - a) / (b - a), 0), 1);
  return x * x * (3 - 2 * x);
};

/** Fraction of the best turn rate at a speed: the rudder needs water flow (plan 02 §4). */
export function turnFactor(speedKn: number): number {
  const v = Math.abs(speedKn);
  return 0.15 + 0.85 * smoothstep(0, 3, v) * (1 - 0.15 * smoothstep(6, 9, v));
}

export function targetSpeedKn(s: ShipState, p: HelmParams): number {
  return p.hullMaxSpeedKn * p.windFactor * (SAIL_FACTORS[s.sailLevel] ?? 0);
}

/** On-screen speed in m/s for a game speed in knots. */
export function visualSpeed(speedKn: number, scale: Scale): number {
  return sceneSpeed(knotsToMs(speedKn), scale.rate, scale.compression);
}

/** Turning-circle diameter in zone meters at a speed (Infinity when stopped). */
export function turningCircle(speedKn: number, p: HelmParams, scale: Scale): number {
  const omega = ((p.turnRateDeg * Math.PI) / 180) * turnFactor(speedKn);
  const v = Math.abs(visualSpeed(speedKn, scale));
  return v > 0 ? (2 * v) / omega : Infinity;
}

/**
 * One fixed tick. `ground` gives the terrain height (m, lake = 0) at a zone point; a
 * bow or stern probe shallower than the draft stops the ship.
 */
export function stepHelm(
  s: ShipState,
  input: HelmInput,
  p: HelmParams,
  scale: Scale,
  ground: (x: number, z: number) => number,
  dt: number,
): void {
  if (input.raise) s.sailLevel = Math.min(s.sailLevel + 1, SAIL_LEVELS.length - 1);
  if (input.lower) s.sailLevel = Math.max(s.sailLevel - 1, 0);

  let target = targetSpeedKn(s, p);
  if (s.sailLevel === 0 && input.astern) target = -p.sweepsKn;
  s.speedKn += (target - s.speedKn) * (1 - Math.exp(-dt / p.accelTau));

  const omega = ((p.turnRateDeg * Math.PI) / 180) * turnFactor(s.speedKn);
  s.heading += input.steer * omega * dt;
  s.heading = Math.atan2(Math.sin(s.heading), Math.cos(s.heading));

  const fx = Math.sin(s.heading);
  const fz = -Math.cos(s.heading);
  const v = visualSpeed(s.speedKn, scale);
  const nx = s.x + fx * v * dt;
  const nz = s.z + fz * v * dt;
  // Probe the end that leads: the bow going ahead, the stern going astern.
  const lead = (Math.sign(v) * p.lengthM) / 2;
  if (v !== 0 && ground(nx + fx * lead, nz + fz * lead) > -p.draftM) {
    s.aground = true;
    s.speedKn = 0;
    return;
  }
  s.aground = false;
  s.x = nx;
  s.z = nz;
}
