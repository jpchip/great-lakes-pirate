/**
 * Where the saloons' talk of the island smuggler points (plan 05 §16.6 decision 1).
 * Piece H builds the smuggler and exports `smugglerAnchorage()` from
 * `src/sim/economy/smuggler.ts` with this same id; until both land, this placeholder
 * names the spot so the rumor can be told. Swap the import in `src/main.ts` then.
 */
export interface SmugglerSpot {
  id: string;
  name: string;
  /** A phrase for talk: "in the lee of Oak Island". */
  where: string;
}

const OAK_LEE: SmugglerSpot = {
  id: 'anchorage.oak_lee',
  name: "Oak Island's lee",
  where: 'in the lee of Oak Island',
};

export function placeholderSmugglerAnchorage(): SmugglerSpot {
  return OAK_LEE;
}
