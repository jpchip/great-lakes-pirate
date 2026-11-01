import { z } from 'zod';
import { idOf } from './common';

/**
 * The fictional companies that own the lake's ships, docks and mills (plan 05 §10, §11
 * `factions.json`; Phase 4 piece D), and the one government service on the water. Every
 * name the player can attack is fictional and was checked against real firms of the era
 * (plan 05 §16.9). Contracts and Standing (piece F) and grudge (Phase 5) hang off these ids.
 */
export const factionSchema = z.object({
  id: idOf('company'),
  name: z.string().min(1),
  /** The short name a lookout or a ledger line uses ("a Bellwether boat"). */
  short: z.string().min(1),
  kind: z.enum(['company', 'government']),
  /** What it does, for the ledger and "look her over". */
  trade: z.string().min(1),
});

export const factionsFileSchema = z.array(factionSchema);
export type Faction = z.infer<typeof factionSchema>;
