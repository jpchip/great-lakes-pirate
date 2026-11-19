import { z } from 'zod';

/**
 * What the save keeps of poker night (plan 12 §5.3; Phase 9 piece C): the tables
 * themselves are the night's and are drawn again from the seed, so only what outlives a
 * night is kept. Optional in the save (`world-state.ts`), so no version bump.
 */
export const pokerStateSchema = z.object({
  /** Ports whose card table you're barred from, until (game seconds). */
  barred: z.record(z.string(), z.number()),
  /** Caches whose maps you've won (never offered twice). */
  maps: z.array(z.string()),
  /** Hands played, all told. */
  hands: z.number().int().nonnegative(),
  /** Cash won less lost at cards, all told, cents. */
  netCents: z.number().int(),
});
export type PokerState = z.infer<typeof pokerStateSchema>;

export function createPokerState(): PokerState {
  return { barred: {}, maps: [], hands: 0, netCents: 0 };
}
