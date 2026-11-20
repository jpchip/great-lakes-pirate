import type { CargoStack } from '../economy/hold';
import { COLD } from './footing';

/**
 * The hand sled (plan 04 §8.2's ice-road smuggling; Phase 9 piece M): a ship's sled put
 * down on the ice beside her, a few CU loaded out of her hold, and towed on a rope behind
 * you. A load weighs on the ice as on your legs: it slows you, you can't run with one, and
 * the ice must be thicker to hold the two of you.
 */

export interface Sled {
  x: number;
  z: number;
  /** The way she points (toward you on the rope), clockwise from north. */
  heading: number;
  load: CargoStack[];
}

export function sledUsed(s: Pick<Sled, 'load'>): number {
  return s.load.reduce((n, l) => n + l.qty, 0);
}

export function sledFree(s: Pick<Sled, 'load'>): number {
  return Math.max(0, COLD.sled.capacityCu - sledUsed(s));
}

/** The sled and her load, kg (`weightOf` a good's weight factor). */
export function sledKg(s: Pick<Sled, 'load'>, weightOf: (good: string) => number): number {
  const c = COLD.sled;
  return c.sledKg + s.load.reduce((kg, l) => kg + l.qty * c.cuKg * weightOf(l.good), 0);
}

/** Your walking speed's share hauling her: weighted CU slow you down to the floor. */
export function sledSpeedMul(s: Pick<Sled, 'load'>, weightOf: (good: string) => number): number {
  const c = COLD.sled;
  const cu = s.load.reduce((n, l) => n + l.qty * weightOf(l.good), 0);
  return Math.max(c.minSpeedMul, 1 - c.slowPerCu * cu);
}

/** The sled follows on her rope: drawn after you once it's taut, nose to you. */
export function towSled(s: Sled, toX: number, toZ: number): void {
  const dx = toX - s.x;
  const dz = toZ - s.z;
  const d = Math.hypot(dx, dz);
  const rope = COLD.sled.ropeM;
  if (d <= rope || d < 1e-6) return;
  const k = (d - rope) / d;
  s.x += dx * k;
  s.z += dz * k;
  s.heading = Math.atan2(dx, -dz);
}

/**
 * Loads the sled from a hold, the most valuable CU first (`valueOf` cents a CU), up to her
 * capacity; contract cargo stays aboard. Returns the CU moved.
 */
export function loadSled(s: Sled, hold: CargoStack[], valueOf: (good: string) => number): number {
  let moved = 0;
  const order = hold
    .map((stack, i) => ({ stack, i }))
    .filter(({ stack }) => !stack.contract)
    .sort((a, b) => valueOf(b.stack.good) - valueOf(a.stack.good));
  for (const { stack } of order) {
    const take = Math.min(stack.qty, sledFree(s));
    if (take <= 0) break;
    const paid =
      stack.paidCents !== undefined ? Math.round((stack.paidCents * take) / stack.qty) : undefined;
    s.load.push({
      good: stack.good,
      qty: take,
      ...(stack.hot ? { hot: { ...stack.hot } } : {}),
      ...(paid !== undefined ? { paidCents: paid } : {}),
    });
    stack.qty -= take;
    if (paid !== undefined && stack.paidCents !== undefined) stack.paidCents -= paid;
    moved += take;
  }
  for (let i = hold.length - 1; i >= 0; i--) if ((hold[i]?.qty ?? 0) <= 0) hold.splice(i, 1);
  return moved;
}

/** Back into a hold, merged into a like stack (same good, both clean or both hot). */
export function unloadSled(s: Sled, hold: CargoStack[]): number {
  let moved = 0;
  for (const l of s.load) {
    const like = hold.find((h) => h.good === l.good && !h.contract && !h.hot && !l.hot);
    if (like) {
      like.qty += l.qty;
      if (like.paidCents !== undefined && l.paidCents !== undefined) like.paidCents += l.paidCents;
      else delete like.paidCents;
    } else hold.push({ ...l });
    moved += l.qty;
  }
  s.load = [];
  return moved;
}
