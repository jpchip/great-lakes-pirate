import { z } from 'zod';

/**
 * The year turning's saved slice (plan 16 §12 `ice`; Phase 9 piece K). The ice itself is
 * a pure function of the run's seed and the date, so only what has been told is kept:
 * which harbors the game last saw frozen in (so freeze-up and ice-out are news once), whether
 * the ice road was last seen open, who was the first boat into Duluth each spring, and
 * whether the Mataafa storm has been told.
 * Optional, so a 0.8.x save loads with none and picks the winter up from its date.
 */
export const iceStateSchema = z.object({
  /** Harbors last seen frozen in, by port id. */
  frozen: z.array(z.string()),
  /** The first boat into the race's port, by the year of its spring. */
  firstBoat: z.record(z.string(), z.object({ ship: z.string(), you: z.boolean(), at: z.number() })),
  /**
   * The Bayfield–La Pointe ice road was last seen marked and open (piece M), so its opening
   * and closing are news once. Absent on a save from before it: taken as it stands.
   */
  road: z.boolean().optional(),
  /** The Mataafa storm was told (game seconds). */
  mataafaAt: z.number().optional(),
});
export type IceState = z.infer<typeof iceStateSchema>;

export function freshIceState(): IceState {
  return { frozen: [], firstBoat: {} };
}
