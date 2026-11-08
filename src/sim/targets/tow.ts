/**
 * Tow lines (plan 07 §8.2; Phase 6 piece C): a schooner-barge rides a hawser astern of her
 * steamer, and goes where the steamer goes. A hit on the hawser parts it: the barge loses
 * her way and drifts, and the steamer (usually) keeps going. Plain math on plain poses.
 */

export interface Pose2 {
  x: number;
  z: number;
  /** Radians clockwise from north (zone z points south). */
  heading: number;
}

export interface TowLine {
  /** The steamer's entity id, and her consort's. */
  leaderId: string;
  consortId: string;
  /** Stern to bow, meters, slack taken up: set from where they lie when first seen. */
  lengthM: number;
  parted: boolean;
}

/** A shot this close to the hawser parts it, meters (a rifle or swivel ball and some luck). */
export const TOW_HIT_M = 4;

/** The point `along` meters ahead of a pose's centre (negative: astern). */
export function alongPose(p: Pose2, along: number): { x: number; z: number } {
  return { x: p.x + Math.sin(p.heading) * along, z: p.z - Math.cos(p.heading) * along };
}

/** The hawser's ends: the leader's stern and the consort's bow. */
export function hawser(
  leader: Pose2,
  leaderHalfM: number,
  consort: Pose2,
  consortHalfM: number,
): { a: { x: number; z: number }; b: { x: number; z: number } } {
  return { a: alongPose(leader, -leaderHalfM), b: alongPose(consort, consortHalfM) };
}

/** Distance from p to the segment ab, meters. */
export function segmentDistance(
  p: { x: number; z: number },
  a: { x: number; z: number },
  b: { x: number; z: number },
): number {
  const abx = b.x - a.x;
  const abz = b.z - a.z;
  const l2 = abx * abx + abz * abz;
  const t = l2 < 1e-9 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * abx + (p.z - a.z) * abz) / l2));
  return Math.hypot(p.x - (a.x + abx * t), p.z - (a.z + abz * t));
}

/** Whether a shot landing at `p` parts the hawser from a to b. */
export function hitsHawser(
  p: { x: number; z: number },
  a: { x: number; z: number },
  b: { x: number; z: number },
  tolM = TOW_HIT_M,
): boolean {
  return segmentDistance(p, a, b) <= tolM;
}

/**
 * Where the consort is after her steamer has moved: the hawser is a rope, so she's pulled
 * along only when it's taut, bow first toward the stern she's made fast to, and lies
 * where she is when it's slack. Returns her new pose.
 */
export function towConsort(
  leader: Pose2,
  leaderHalfM: number,
  consort: Pose2,
  consortHalfM: number,
  lengthM: number,
): Pose2 {
  const stern = alongPose(leader, -leaderHalfM);
  const bow = alongPose(consort, consortHalfM);
  const dx = bow.x - stern.x;
  const dz = bow.z - stern.z;
  const d = Math.hypot(dx, dz);
  // She swings to the pull: her head toward the stern she's made fast to.
  const heading = d > 1e-6 ? Math.atan2(-dx, dz) : consort.heading;
  if (d <= lengthM) {
    // Slack: she keeps her place, easing round toward the pull.
    return { x: consort.x, z: consort.z, heading };
  }
  const k = lengthM / d;
  const nbx = stern.x + dx * k;
  const nbz = stern.z + dz * k;
  // The bow comes up to the hawser's length; the centre lies half a hull astern of it.
  return {
    x: nbx - Math.sin(heading) * consortHalfM,
    z: nbz + Math.cos(heading) * consortHalfM,
    heading,
  };
}
