import type { EconomyDefs } from './defs';

/**
 * The ship's hold (plan 05 §3, §6.1, §11 `player.cargo`): stacks of goods in whole CU.
 * A stack can be hot (taken by crime; piece H reads the flags) or a contract's cargo
 * (piece F). Clean stacks of the same good merge; hot and contract stacks keep their own
 * identity so their flags never spread to clean goods.
 */

/** Where and how a lot was stolen (plan 05 §6.1): heat cools with time and distance. */
export interface HotMeta {
  /** The Wanted region it was taken in (ports.json `wantedRegion`). */
  region: string;
  /** 0–1 at the time of the theft. */
  heat: number;
  /** The good's traceability when taken; re-crating (plan 09) lowers it. */
  traceability: number;
  /** Game seconds of the theft. */
  since: number;
}

export interface CargoStack {
  good: string;
  qty: number;
  hot?: HotMeta | undefined;
  /** The freight contract this cargo belongs to (piece F). */
  contract?: string | undefined;
}

export type Hold = CargoStack[];

export const isClean = (s: CargoStack): boolean => !s.hot && !s.contract;

/** CU in use. */
export function holdUsed(hold: readonly CargoStack[]): number {
  let n = 0;
  for (const s of hold) n += s.qty;
  return n;
}

export function holdFree(hold: readonly CargoStack[], capacity: number): number {
  return Math.max(0, capacity - holdUsed(hold));
}

/** Clean CU of a good aboard: what an ordinary sale can take. */
export function cleanQty(hold: readonly CargoStack[], goodId: string): number {
  let n = 0;
  for (const s of hold) if (s.good === goodId && isClean(s)) n += s.qty;
  return n;
}

/**
 * The hold's load, 0 empty … 1 full of the heaviest goods: CU × weight factor over the
 * capacity. It sets `cargo01` for the draft and the speed loss (plan 02 §3, §6.2).
 */
export function holdLoad01(
  defs: EconomyDefs,
  hold: readonly CargoStack[],
  capacity: number,
): number {
  if (capacity <= 0) return 0;
  let w = 0;
  for (const s of hold) w += s.qty * (defs.goods.get(s.good)?.weightFactor ?? 1);
  return Math.min(1, w / capacity);
}

/** Adds goods, merging a clean lot into the clean stack of the same good. */
export function addToHold(hold: Hold, stack: CargoStack): void {
  if (stack.qty <= 0) return;
  if (isClean(stack)) {
    const same = hold.find((s) => s.good === stack.good && isClean(s));
    if (same) {
      same.qty += stack.qty;
      return;
    }
  }
  hold.push({ ...stack });
}

/**
 * Takes up to `qty` CU of clean goods, from the last stack first. Returns how much it
 * took. Hot and contract goods are left alone: selling them is pieces F and H.
 */
export function takeCleanFromHold(hold: Hold, goodId: string, qty: number): number {
  let left = qty;
  for (let i = hold.length - 1; i >= 0 && left > 0; i--) {
    const s = hold[i] as CargoStack;
    if (s.good !== goodId || !isClean(s)) continue;
    const take = Math.min(s.qty, left);
    s.qty -= take;
    left -= take;
    if (s.qty === 0) hold.splice(i, 1);
  }
  return qty - left;
}
