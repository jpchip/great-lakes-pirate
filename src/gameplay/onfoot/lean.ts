import { footprintDistance, type Collider, type Push } from './colliders';
import type { CharacterState, OnFootZone } from './controller';

/**
 * Lean and peek (plan 08 §3.1 Q/E, §17 cut #2 taken back; Phase 7 follow-up). Standing
 * still, Q leans left and E right of where you look: your head and the camera go out up to
 * `LEAN_M` sideways while your feet stay put, so you can look round a corner or a stack of
 * crates and show a guard only your head. A wall in the way stops the lean short. Moving,
 * swimming, climbing or carrying straightens you up.
 *
 * Pure: the ashore mode steps it after the controller, perception reads the head's offset
 * (`perception.ts`, the three sight lines), the camera's pivot follows it.
 */

/** How far the head goes out at full lean, meters. */
export const LEAN_M = 0.6;
/** Lean per second, in and out (about a fifth of a second to full). */
export const LEAN_RATE = 5;
/** Clearance kept between the head and a wall. */
const HEAD_CLEARANCE_M = 0.14;
/** The head's height as a share of the body's. */
const HEAD_SHARE = 0.92;

export interface Lean {
  /** −1 full left … 0 upright … 1 full right, eased. */
  amount: number;
  /** Where the head is now relative to the feet, meters in x and z (wall-limited). */
  offsetX: number;
  offsetZ: number;
}

export function createLean(): Lean {
  return { amount: 0, offsetX: 0, offsetZ: 0 };
}

/** Straight up at once (a teleport, a fade, getting into the boat). */
export function resetLean(l: Lean): void {
  l.amount = 0;
  l.offsetX = 0;
  l.offsetZ = 0;
}

/** Whether you're leaning enough to count (for the HUD and perception). */
export function leaning(l: Lean): boolean {
  return Math.abs(l.amount) > 0.05;
}

const nearby: Collider[] = [];
const push: Push = { nx: 0, nz: 0 };

/**
 * How far the head can go from (x, z) along (ux, uz) at height `headY` before a wall, up
 * to `max`: a short march against the props that span the head's height.
 */
export function leanRoom(
  zone: OnFootZone,
  x: number,
  headY: number,
  z: number,
  ux: number,
  uz: number,
  max = LEAN_M,
): number {
  zone.colliders.query(x + (ux * max) / 2, z + (uz * max) / 2, max / 2 + HEAD_CLEARANCE_M, nearby);
  const step = 0.05;
  for (let d = step; d <= max + 1e-6; d += step) {
    const px = x + ux * d;
    const pz = z + uz * d;
    for (const c of nearby) {
      if (headY < c.minY || headY > c.maxY) continue;
      if (footprintDistance(c, px, pz, push) < HEAD_CLEARANCE_M) return Math.max(0, d - step);
    }
  }
  return max;
}

/**
 * One tick of leaning. `want` is −1 (Q), 1 (E) or 0; `moving` is whether there's any move
 * input this tick; `able` lets the caller forbid it (arms full, in the boat). `viewYaw` is
 * the camera's heading, clockwise from north: the lean is to the right or left of the view.
 */
export function stepLean(
  l: Lean,
  want: number,
  c: CharacterState,
  moving: boolean,
  able: boolean,
  viewYaw: number,
  zone: OnFootZone,
  height: number,
  dt: number,
): void {
  const can =
    able && !moving && c.grounded && !c.swimming && c.ladder === undefined && c.move === undefined;
  const target = can ? Math.max(-1, Math.min(1, want)) : 0;
  const step = LEAN_RATE * dt;
  const d = target - l.amount;
  l.amount += Math.max(-step, Math.min(step, d));
  if (Math.abs(l.amount) < 1e-3) l.amount = 0;
  if (l.amount === 0) {
    l.offsetX = 0;
    l.offsetZ = 0;
    return;
  }
  // Right of the view: heading h faces (sin h, −cos h), so its right is (cos h, sin h).
  const side = Math.sign(l.amount);
  const ux = Math.cos(viewYaw) * side;
  const uz = Math.sin(viewYaw) * side;
  const p = c.position;
  const room = leanRoom(zone, p.x, p.y + height * HEAD_SHARE, p.z, ux, uz);
  const m = Math.min(Math.abs(l.amount) * LEAN_M, room);
  l.offsetX = ux * m;
  l.offsetZ = uz * m;
}
