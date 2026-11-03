/**
 * Where the saloons' talk of the island smuggler points (plan 05 §16.6 decision 1).
 * Piece H's `smugglerAnchorage()` in `src/sim/economy/smuggler.ts` supplies it.
 */
export interface SmugglerSpot {
  id: string;
  name: string;
  /** A phrase for talk: "in the lee of Oak Island". */
  where: string;
}
