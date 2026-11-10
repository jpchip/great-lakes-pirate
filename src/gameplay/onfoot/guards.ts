import npcTypesJson from '../../../data/npc_types.json';
import {
  npcTypesFileSchema,
  type NpcType,
  type NpcTypesFile,
  type TierScaling,
} from '../../../data/schemas/npc_types';
import type { XZ } from './nav';

/**
 * The district's watch (plan 08 §5.1, §5.2; Phase 7 piece D): the NPC types from
 * `npc_types.json`, where each guard walks, and how the roster grows with the region's
 * Wanted tier: more constables, sharper eyes, longer searches, and marshals from tier 4.
 */

export interface NpcDefs {
  file: NpcTypesFile;
  byId: ReadonlyMap<string, NpcType>;
}

export function compileNpcs(file: NpcTypesFile): NpcDefs {
  return { file, byId: new Map(file.types.map((t) => [t.id, t])) };
}

let cached: NpcDefs | undefined;

export function gameNpcs(): NpcDefs {
  cached ??= compileNpcs(npcTypesFileSchema.parse(npcTypesJson));
  return cached;
}

export function npcType(defs: NpcDefs, id: string): NpcType {
  const t = defs.byId.get(id);
  if (!t) throw new Error(`Unknown npc type ${id}`);
  return t;
}

export function tierScaling(defs: NpcDefs, tier: number): TierScaling {
  const rows = defs.file.tiers;
  return rows[Math.max(0, Math.min(rows.length - 1, Math.round(tier)))] as TierScaling;
}

/** A stop on a patrol: stand here `waitS` real seconds, facing `face` (a heading) if given. */
export interface Waypoint extends XZ {
  waitS?: number;
  face?: number;
}

export interface Route {
  points: Waypoint[];
  /** Walk the points in a loop, or there and back. */
  loop: boolean;
}

/** One guard as the district places them. */
export interface GuardSpawn {
  id: string;
  type: string;
  name?: string;
  route: Route;
  /** Starts at this point of the route. */
  startAt?: number;
}

/** The plan 01 §5 budget: no more than this many full-AI NPCs at once. */
export const MAX_GUARDS = 12;

/**
 * The night's roster at a Wanted tier (plan 08 §5.2): the district's own guards, plus the
 * tier's extra constables and marshals walking the district's spare beats in turn, capped
 * at the full-AI budget.
 */
export function rosterForTier(
  defs: NpcDefs,
  base: readonly GuardSpawn[],
  spareBeats: readonly Route[],
  tier: number,
): GuardSpawn[] {
  const t = tierScaling(defs, tier);
  const out = [...base];
  let beat = 0;
  const nextBeat = (): Route | undefined => {
    if (spareBeats.length === 0) return undefined;
    return spareBeats[beat++ % spareBeats.length];
  };
  for (let k = 0; k < t.marshals && out.length < MAX_GUARDS; k++) {
    const route = nextBeat();
    if (route) out.push({ id: `marshal.${k + 1}`, type: 'npc.marshal', route });
  }
  for (let k = 0; k < t.extraConstables && out.length < MAX_GUARDS; k++) {
    const route = nextBeat();
    if (route) out.push({ id: `constable.extra_${k + 1}`, type: 'npc.constable', route });
  }
  return out.slice(0, MAX_GUARDS);
}
