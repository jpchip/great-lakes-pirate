import { z } from 'zod';

/**
 * The legends' saved slice (plan 11 §14 `legends[id].step`; Phase 9 piece T): the clues
 * found, the maps drawn, the legends and hoards run down, and the fences a legend put you
 * in with. Optional in the save: absent, none of it has happened, so no version bump.
 */
export const legendsStateSchema = z.object({
  /** Clue ids found (`clue.grotto_logbook`), oldest first. */
  clues: z.array(z.string()),
  /** A lead made a map at a cartography table: by lead id, when. */
  maps: z.record(z.string(), z.number()),
  /** Run down: a legend's id, or a copycat's stash lead's, and when. */
  done: z.record(z.string(), z.number()),
  /** Seeded caches whose note you've found (their leads are open). */
  notes: z.array(z.string()),
  /** Fences who'll deal with you whatever your Fame (the Dark Light's Mr. Carrow). */
  contacts: z.array(z.string()),
});
export type LegendsState = z.infer<typeof legendsStateSchema>;

export function createLegends(): LegendsState {
  return { clues: [], maps: {}, done: {}, notes: [], contacts: [] };
}
