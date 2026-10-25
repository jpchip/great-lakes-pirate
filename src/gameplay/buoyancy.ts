import { GAMEPLAY_WAVES, heightAt, type Sea } from '../sim/weather/waves';
import type { GameWorld } from './ecs';

/**
 * Cheap arcade buoyancy (plan 02 §5.1, plan 01 §4.1): sample the shared wave set at six
 * hull points, turn them into heave, pitch and roll targets, and chase the targets with
 * damped springs. No rigid-body solver. Always uses the first GAMEPLAY_WAVES waves so the
 * ship moves the same on every quality preset.
 */
export interface Buoyancy {
  /** Distance between the bow and stern sample points, meters. */
  length: number;
  /** Distance between the port and starboard sample points, meters. */
  beam: number;
  /** Natural periods, seconds. Longer feels heavier. */
  heavePeriod: number;
  pitchPeriod: number;
  rollPeriod: number;
  /** Damping ratio for all three springs (1 = critically damped). */
  damping: number;
  /** Spring state; starts at rest. */
  heave: number;
  heaveVelocity: number;
  pitch: number;
  pitchVelocity: number;
  roll: number;
  rollVelocity: number;
}

export type BuoyancySpec = Pick<
  Buoyancy,
  'length' | 'beam' | 'heavePeriod' | 'pitchPeriod' | 'rollPeriod' | 'damping'
>;

/** Buoyancy at rest for a hull spec, e.g. a ships.json record's `buoyancy`. */
export function createBuoyancy(spec: BuoyancySpec): Buoyancy {
  return {
    ...spec,
    heave: 0,
    heaveVelocity: 0,
    pitch: 0,
    pitchVelocity: 0,
    roll: 0,
    rollVelocity: 0,
  };
}

/** Tuning for the placeholder schooner (~30 m on deck; plan 02 §10 tier 2). */
export function schoonerBuoyancy(): Buoyancy {
  return {
    length: 26,
    beam: 6.5,
    heavePeriod: 3.2,
    pitchPeriod: 3.8,
    rollPeriod: 4.6,
    damping: 0.55,
    heave: 0,
    heaveVelocity: 0,
    pitch: 0,
    pitchVelocity: 0,
    roll: 0,
    rollVelocity: 0,
  };
}

export interface HullTargets {
  heave: number;
  pitch: number;
  roll: number;
}

/**
 * Samples the hull points around (x, z) for a ship with `heading`, returning the
 * attitude the water wants. Points: bow, stern, and port/starboard pairs at ±L/4.
 */
export function hullTargets(
  sea: Sea,
  b: Pick<Buoyancy, 'length' | 'beam'>,
  x: number,
  z: number,
  heading: number,
  out: HullTargets = { heave: 0, pitch: 0, roll: 0 },
): HullTargets {
  // Forward is north at heading 0 (-z); starboard is east (+x).
  const fx = Math.sin(heading);
  const fz = -Math.cos(heading);
  const sx = -fz;
  const sz = fx;
  const half = b.length / 2;
  const quarter = b.length / 4;
  const side = b.beam / 2;
  const h = (along: number, across: number): number =>
    heightAt(
      sea.waves,
      GAMEPLAY_WAVES,
      x + fx * along + sx * across,
      z + fz * along + sz * across,
      sea.time,
    );

  const bow = h(half, 0);
  const stern = h(-half, 0);
  const portFore = h(quarter, -side);
  const stbdFore = h(quarter, side);
  const portAft = h(-quarter, -side);
  const stbdAft = h(-quarter, side);

  out.heave = (bow + stern + portFore + stbdFore + portAft + stbdAft) / 6;
  // Fore trio vs. aft trio; their centroids are (L/2 + 2·L/4) / 3 = L/3 from midships.
  const fore = (bow + portFore + stbdFore) / 3;
  const aft = (stern + portAft + stbdAft) / 3;
  out.pitch = Math.atan2(fore - aft, (2 * b.length) / 3);
  const port = (portFore + portAft) / 2;
  const stbd = (stbdFore + stbdAft) / 2;
  out.roll = Math.atan2(stbd - port, b.beam);
  return out;
}

function spring(
  x: number,
  v: number,
  target: number,
  period: number,
  zeta: number,
  dt: number,
): [number, number] {
  const omega = (2 * Math.PI) / period;
  const a = omega * omega * (target - x) - 2 * zeta * omega * v;
  const v2 = v + a * dt;
  return [x + v2 * dt, v2];
}

const targets: HullTargets = { heave: 0, pitch: 0, roll: 0 };

/** Run once per gameplay tick after the sea clock has advanced. */
export function buoyancySystem(world: GameWorld, sea: Sea, dt: number): void {
  for (const { transform, buoyancy: b } of world.with('transform', 'buoyancy')) {
    const { x, z } = transform.position;
    hullTargets(sea, b, x, z, transform.heading, targets);
    [b.heave, b.heaveVelocity] = spring(
      b.heave,
      b.heaveVelocity,
      targets.heave,
      b.heavePeriod,
      b.damping,
      dt,
    );
    [b.pitch, b.pitchVelocity] = spring(
      b.pitch,
      b.pitchVelocity,
      targets.pitch,
      b.pitchPeriod,
      b.damping,
      dt,
    );
    [b.roll, b.rollVelocity] = spring(
      b.roll,
      b.rollVelocity,
      targets.roll,
      b.rollPeriod,
      b.damping,
      dt,
    );
    transform.position.y = b.heave;
    transform.pitch = b.pitch;
    transform.roll = b.roll;
  }
}
