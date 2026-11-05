import crimesJson from '../../../data/crimes.json';
import fameJson from '../../../data/fame_tiers.json';
import actorsJson from '../../../data/law_actors.json';
import regionsJson from '../../../data/regions.json';
import wantedJson from '../../../data/wanted_tiers.json';
import {
  crimesFileSchema,
  fameTiersFileSchema,
  lawActorsFileSchema,
  regionsFileSchema,
  wantedTiersFileSchema,
  type CrimeDef,
  type FameTiersFile,
  type LawActorsFile,
  type RegionDef,
  type WantedTiersFile,
} from '../../../data/schemas/law';

/**
 * The law's static definitions (plan 06 §10; Phase 5 piece A), validated and indexed
 * once. Tests can build their own with `compileLaw` to tune numbers.
 */
export interface LawDefs {
  crimes: ReadonlyMap<string, CrimeDef>;
  wanted: WantedTiersFile;
  fame: FameTiersFile;
  regions: readonly RegionDef[];
  regionById: ReadonlyMap<string, RegionDef>;
  actors: LawActorsFile;
}

export function compileLaw(
  crimes: CrimeDef[],
  wanted: WantedTiersFile,
  fame: FameTiersFile,
  regions: RegionDef[],
  actors: LawActorsFile,
): LawDefs {
  const regionById = new Map(regions.map((r) => [r.id, r]));
  for (const r of regions) {
    for (const n of r.neighbors) {
      if (!regionById.has(n)) throw new Error(`${r.id} neighbors unknown region ${n}`);
      if (n === r.id) throw new Error(`${r.id} neighbors itself`);
    }
  }
  return {
    crimes: new Map(crimes.map((c) => [c.id, c])),
    wanted,
    fame,
    regions,
    regionById,
    actors,
  };
}

let cached: LawDefs | undefined;

/** The game's law from the data files. */
export function gameLaw(): LawDefs {
  cached ??= compileLaw(
    crimesFileSchema.parse(crimesJson),
    wantedTiersFileSchema.parse(wantedJson),
    fameTiersFileSchema.parse(fameJson),
    regionsFileSchema.parse(regionsJson),
    lawActorsFileSchema.parse(actorsJson),
  );
  return cached;
}

export function crimeDef(defs: LawDefs, id: string): CrimeDef {
  const c = defs.crimes.get(id);
  if (!c) throw new Error(`Unknown crime ${id}`);
  return c;
}

/** The Wanted tier for a heat (plan 06 §3.2). */
export function wantedTier(defs: LawDefs, heat: number): number {
  const tiers = defs.wanted.tiers;
  for (let i = tiers.length - 1; i > 0; i--) if (heat >= (tiers[i]?.minHeat ?? Infinity)) return i;
  return 0;
}

export function wantedTierName(defs: LawDefs, tier: number): string {
  return defs.wanted.tiers[tier]?.name ?? '?';
}

/** The Fame tier for a Fame value (plan 06 §4.1). */
export function fameTier(defs: LawDefs, value: number): number {
  const tiers = defs.fame.tiers;
  for (let i = tiers.length - 1; i > 0; i--) if (value >= (tiers[i]?.min ?? Infinity)) return i;
  return 0;
}

export function fameTierName(defs: LawDefs, tier: number): string {
  return defs.fame.tiers[tier]?.name ?? '?';
}

/** A Wanted tier's definition (clamped to the table). */
export function tierDef(defs: LawDefs, tier: number): WantedTiersFile['tiers'][number] {
  const tiers = defs.wanted.tiers;
  const t = tiers[Math.max(0, Math.min(tiers.length - 1, tier))];
  if (!t) throw new Error('No Wanted tiers');
  return t;
}

/** The highest tier: capture there is execution (plan 06 §3.2). */
export function topWantedTier(defs: LawDefs): number {
  return defs.wanted.tiers.length - 1;
}
