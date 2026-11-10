/**
 * The schooner's boat (plan 02 §6.5, plan 08 §20.6 decision 2; Phase 7 piece A). At
 * anchor you put her over the side and row the short way to a beach or landing; she's
 * yours to row back. Rowed slowly, in the zone only, and swamped in a sea. Pure math in
 * zone meters, like the on-foot controller.
 *
 * Her speed is set at the sailing scale (about 2.5 kn as the helm would show it), so a
 * row from an anchorage to the beach takes a minute or two, not five.
 */

export interface RowboatState {
  x: number;
  z: number;
  /** Radians clockwise from north. */
  heading: number;
  /** Through the water along her heading, m/s; negative backing water. */
  speed: number;
  /** Turning, rad/s. */
  turn: number;
  /** Her bow is on the beach: she won't go farther in. */
  beached: boolean;
}

export interface RowInput {
  /** -1 back water … 1 pull. */
  pull: number;
  /** -1 to port … 1 to starboard. */
  turn: number;
}

export const ROWBOAT = {
  lengthM: 4.2,
  beamM: 1.5,
  /** Gunwale height above the water, for the step out and the camera. */
  freeboardM: 0.45,
  /** Top speed pulling and backing, m/s. */
  pullMs: 3.4,
  backMs: 1.6,
  /** How quickly she gathers way and loses it, s. */
  accelTau: 1.6,
  dragTau: 3,
  /** Turning rate at full helm, rad/s, a little faster under way. */
  turnRad: 0.75,
  /** She takes the ground when the water under her bow is this shallow, m. */
  beachDepthM: 0.4,
  /** Too much sea to put her over the side (significant wave height, m). */
  launchMaxHsM: 1.1,
  /** A sea this big swamps her under you. */
  swampHsM: 1.6,
} as const;

export function createRowboat(x: number, z: number, heading: number): RowboatState {
  return { x, z, heading, speed: 0, turn: 0, beached: false };
}

/** What the boat needs of the world: the depth under a point, and anything she'd hit. */
export interface RowEnv {
  /** Water depth, m; negative over dry land. */
  depthAt(x: number, z: number): number;
  /**
   * Pushes a point out of solid things (piers, the schooner): returns the outward
   * direction and how deep it was in, or undefined if it's clear.
   */
  blocked?(
    x: number,
    z: number,
    radius: number,
  ): { nx: number; nz: number; depth: number } | undefined;
}

const bow = (s: RowboatState, ahead = ROWBOAT.lengthM / 2): { x: number; z: number } => ({
  x: s.x + Math.sin(s.heading) * ahead,
  z: s.z - Math.cos(s.heading) * ahead,
});

/** The bow's point, for the "step ashore" check. */
export function bowPoint(s: RowboatState): { x: number; z: number } {
  return bow(s);
}

/** One fixed tick of rowing. */
export function stepRowboat(s: RowboatState, input: RowInput, env: RowEnv, dt: number): void {
  const pull = Math.max(-1, Math.min(1, input.pull));
  const want = pull >= 0 ? pull * ROWBOAT.pullMs : pull * ROWBOAT.backMs;
  const tau = pull !== 0 ? ROWBOAT.accelTau : ROWBOAT.dragTau;
  s.speed += (want - s.speed) * Math.min(1, dt / tau);
  // Oars turn her even when she's stopped; a little better with way on.
  const way = Math.min(Math.abs(s.speed) / ROWBOAT.pullMs, 1);
  const wantTurn = Math.max(-1, Math.min(1, input.turn)) * ROWBOAT.turnRad * (0.7 + 0.3 * way);
  s.turn += (wantTurn - s.turn) * Math.min(1, dt / 0.4);

  // Aground at the bow: she only backs off.
  const shallowAhead = env.depthAt(bow(s).x, bow(s).z) < ROWBOAT.beachDepthM;
  if (shallowAhead && s.speed > 0) s.speed = 0;
  s.beached = shallowAhead;
  if (s.beached) s.turn *= 0.3;

  s.heading += s.turn * dt;
  s.heading = Math.atan2(Math.sin(s.heading), Math.cos(s.heading));
  s.x += Math.sin(s.heading) * s.speed * dt;
  s.z -= Math.cos(s.heading) * s.speed * dt;

  // Fend off piers and ships at the bow, the middle and the stern.
  if (env.blocked) {
    const r = ROWBOAT.beamM / 2;
    for (const along of [ROWBOAT.lengthM / 2 - r, 0, -(ROWBOAT.lengthM / 2 - r)]) {
      const p = bow(s, along);
      const hit = env.blocked(p.x, p.z, r);
      if (!hit) continue;
      s.x += hit.nx * hit.depth;
      s.z += hit.nz * hit.depth;
      // Lose the way into it.
      const fx = Math.sin(s.heading);
      const fz = -Math.cos(s.heading);
      if ((fx * hit.nx + fz * hit.nz) * s.speed < 0) s.speed *= 0.2;
    }
  }
}

/** Why the boat can't go over the side here, or undefined if she can. */
export function launchRefusal(hsM: number): string | undefined {
  return hsM > ROWBOAT.launchMaxHsM ? 'Too much sea to put the boat over' : undefined;
}

/** True if the sea at the boat swamps her. */
export function swamped(hsM: number): boolean {
  return hsM > ROWBOAT.swampHsM;
}
