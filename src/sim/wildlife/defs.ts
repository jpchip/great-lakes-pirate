import islandTiersJson from '../../../data/island_tiers.json';
import wildlifeJson from '../../../data/wildlife.json';
import { islandTiersFileSchema } from '../../../data/schemas/island_tiers';
import {
  wildlifeFileSchema,
  type SpeciesDef,
  type WildlifeFile,
} from '../../../data/schemas/wildlife';

/** `wildlife.json`, parsed once (plan 11 §18.4 piece V). */
export const WILDLIFE: WildlifeFile = wildlifeFileSchema.parse(wildlifeJson);

export function speciesDef(id: string, file: WildlifeFile = WILDLIFE): SpeciesDef | undefined {
  return file.species.find((s) => s.id === id);
}

export function speciesOf(id: string, file: WildlifeFile = WILDLIFE): SpeciesDef {
  const s = speciesDef(id, file);
  if (!s) throw new Error(`wildlife: no species ${id}`);
  return s;
}

/** The island's game, if it has any. */
export function islandGame(
  island: string,
  file: WildlifeFile = WILDLIFE,
): WildlifeFile['islands'][number] | undefined {
  return file.islands.find((i) => i.island === island);
}

/** Whether a species is about in a calendar month (1 January). */
export function inSeason(s: SpeciesDef, month: number): boolean {
  return s.months.includes(month);
}

const TIERS = islandTiersFileSchema.parse(islandTiersJson);

/** The animals an island of this tier may have about at once (`island_tiers.json`). */
export function animalBudget(tier: 'hero' | 'standard' | 'minor' | undefined): number {
  return TIERS.tiers[tier ?? 'standard'].animals;
}
