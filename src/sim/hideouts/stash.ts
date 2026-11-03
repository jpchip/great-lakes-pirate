import sitesJson from '../../../data/sites.json';
import { sitesFileSchema, type SiteDef } from '../../../data/schemas/sites';
import type { Zone, ZoneFrame } from '../../core/coords';
import { addToHold, holdFree, holdUsed, type CargoStack, type Hold } from '../economy/hold';
import { footprintPoint } from '../harbors';
import { setPieceFootprint, zoneDef } from '../terrain/zones';

/**
 * Hideouts and their storage (plan 09 §2–3, §12; plan 05 §2; Phase 4 piece E). Phase 4 has
 * one: the Stockton Island stash at Presque Isle bay, every background's starting hideout,
 * pre-built with a strongbox and a storage shed (09 §2.2) and so claimed from the start.
 * Goods and cash stored there are safe: they're not in the hold, so they don't load the
 * ship, can't be lost with her, and nothing that searches the ship will find them.
 *
 * Moving goods keeps each stack's identity: a hot lot stays hot (with its heat and since)
 * and contract cargo keeps its contract, so stashing never launders either. Cash is integer
 * cents, as the purse is.
 *
 * Pure functions on plain data; the save keeps `hideouts` (world-state.ts).
 */

export const SITES: readonly SiteDef[] = sitesFileSchema.parse(sitesJson);

export function siteDef(id: string): SiteDef | undefined {
  return SITES.find((s) => s.id === id);
}

/** A hideout's id from its site's: `site.stockton` → `hideout.stockton`. */
export function hideoutIdOf(siteId: string): string {
  return `hideout.${siteId.replace(/^site\./, '')}`;
}

/** What one hideout holds (plan 09 §12 `hideouts[id]`, Phase 4's slice of it). */
export interface HideoutState {
  siteId: string;
  /** Game seconds of the claim; a starting hideout is claimed at the run's start. */
  claimedAt: number;
  storage: { goods: CargoStack[]; cash: number };
}

export type Hideouts = Record<string, HideoutState>;

/** The hideouts a background starts with (plan 12 §2.2; Phase 4: Stockton for all). */
export function startingHideouts(background: string, gameSeconds: number): Hideouts {
  const out: Hideouts = {};
  for (const s of SITES) {
    if (!s.startFor.includes(background)) continue;
    out[hideoutIdOf(s.id)] = {
      siteId: s.id,
      claimedAt: gameSeconds,
      storage: { goods: [], cash: 0 },
    };
  }
  return out;
}

/**
 * Gives a run its starting hideouts if it has none: a new run, a 0.3.0 run migrated
 * through v5, or a save from before piece E. Hideouts it has are left as they are.
 */
export function syncHideouts(
  hideouts: Hideouts | undefined,
  background: string,
  gameSeconds: number,
): Hideouts {
  const out = hideouts ?? {};
  for (const [id, h] of Object.entries(startingHideouts(background, gameSeconds))) out[id] ??= h;
  return out;
}

/** CU of goods a hideout can hold (its storage pieces, plan 09 §5.4). */
export function storageCapacity(h: HideoutState): number {
  return siteDef(h.siteId)?.storage.goodsCu ?? 0;
}

/** Cash stashed across every hideout, cents (plan 05 §2: cash on hand vs. stashed). */
export function stashedCash(hideouts: Hideouts | undefined): number {
  let n = 0;
  for (const h of Object.values(hideouts ?? {})) n += h.storage.cash;
  return n;
}

export type StashRefusal =
  'badQty' | 'noStack' | 'noRoomStash' | 'noRoomHold' | 'noStrongbox' | 'noMoney' | 'noCash';

export type StashResult =
  { ok: true; good?: string; qty?: number; cents?: number } | { ok: false; reason: StashRefusal };

/** Moves up to `qty` CU of one stack from `from` to `to`, keeping its flags. */
function moveStack(from: Hold, to: Hold, index: number, qty: number, room: number): StashResult {
  if (!Number.isInteger(qty) || qty <= 0) return { ok: false, reason: 'badQty' };
  const stack = from[index];
  if (!stack) return { ok: false, reason: 'noStack' };
  const n = Math.min(qty, stack.qty, room);
  if (n <= 0) return { ok: false, reason: 'noRoomHold' };
  stack.qty -= n;
  if (stack.qty === 0) from.splice(index, 1);
  addToHold(to, { ...stack, qty: n });
  return { ok: true, good: stack.good, qty: n };
}

/** Puts goods from the hold's stack `index` into the hideout, as many as fit. */
export function stashGoods(hold: Hold, h: HideoutState, index: number, qty: number): StashResult {
  const room = Math.max(0, storageCapacity(h) - holdUsed(h.storage.goods));
  if (room <= 0 && hold[index] && qty > 0) return { ok: false, reason: 'noRoomStash' };
  return moveStack(hold, h.storage.goods, index, qty, room);
}

/** Takes goods from the hideout's stack `index` into the hold, as many as fit. */
export function takeGoods(
  hold: Hold,
  holdCapacity: number,
  h: HideoutState,
  index: number,
  qty: number,
): StashResult {
  return moveStack(h.storage.goods, hold, index, qty, holdFree(hold, holdCapacity));
}

/** Puts `cents` of the purse in the strongbox. */
export function stashCash(player: { purse: number }, h: HideoutState, cents: number): StashResult {
  if (!Number.isInteger(cents) || cents <= 0) return { ok: false, reason: 'badQty' };
  if (!siteDef(h.siteId)?.storage.strongbox) return { ok: false, reason: 'noStrongbox' };
  if (player.purse < cents) return { ok: false, reason: 'noMoney' };
  player.purse -= cents;
  h.storage.cash += cents;
  return { ok: true, cents };
}

/** Takes `cents` from the strongbox into the purse. */
export function takeCash(player: { purse: number }, h: HideoutState, cents: number): StashResult {
  if (!Number.isInteger(cents) || cents <= 0) return { ok: false, reason: 'badQty' };
  if (h.storage.cash < cents) return { ok: false, reason: 'noCash' };
  h.storage.cash -= cents;
  player.purse += cents;
  return { ok: true, cents };
}

/** A site's anchorage in zone meters: its middle and radius. */
export function siteAnchorage(
  site: SiteDef,
  frame: ZoneFrame,
): { x: number; z: number; radiusM: number } | undefined {
  const piece = zoneDef(site.zone).setPieces.find((p) => p.id === site.setPiece);
  if (!piece) return undefined;
  const fp = setPieceFootprint(piece, frame);
  const p = footprintPoint(fp, site.anchorage.alongM, site.anchorage.inlandM);
  return { ...p, radiusM: site.anchorage.radiusM };
}

/** The site whose anchorage holds `p` in the zone, if any. */
export function siteAnchoredAt(zoneId: string, frame: ZoneFrame, p: Zone): SiteDef | undefined {
  for (const s of SITES) {
    if (s.zone !== zoneId) continue;
    const a = siteAnchorage(s, frame);
    if (a && Math.hypot(p.x - a.x, p.z - a.z) <= a.radiusM) return s;
  }
  return undefined;
}

/** Where a site lies, as a geo point (its set piece's anchor), for the chart. */
export function siteGeo(site: SiteDef): { lat: number; lon: number } | undefined {
  return zoneDef(site.zone).setPieces.find((p) => p.id === site.setPiece)?.at;
}
