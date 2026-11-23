import sitesJson from '../../../data/sites.json';
import { sitesFileSchema, type SiteDef } from '../../../data/schemas/sites';
import type { PackedLayout } from '../../../data/schemas/structures';
import type { Zone, ZoneFrame } from '../../core/coords';
import {
  addToHold,
  holdFree,
  holdUsed,
  reduceStack,
  type CargoStack,
  type Hold,
} from '../economy/hold';
import { footprintPoint } from '../harbors';
import { setPieceFootprint, zoneDef } from '../terrain/zones';
import { gridHasStrongbox, gridStorageCu } from './edit';
import { emptyLayout, mergeLayouts, offsetLayout, unpackGrid } from './grid';
import { starter } from './structures';

/**
 * Hideouts and their storage (plan 09 §2–3, §12; plan 05 §2; Phase 4 piece E). A starting
 * hideout comes pre-built (09 §2.2), so it's claimed from the start; since Phase 8 piece A
 * it's a layout of grid pieces (data/starters.json), and its storage capacity and strongbox
 * come from the pieces built there.
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

/** What one hideout holds (plan 09 §12 `hideouts[id]`). */
export interface HideoutState {
  siteId: string;
  /** Game seconds of the claim; a starting hideout is claimed at the run's start. */
  claimedAt: number;
  /**
   * Goods (CU), cash, and things made at its stations that take no CU (kits, picks,
   * crates and barrels, upgrades waiting for a slipway; Phase 8 piece E), by id.
   */
  storage: { goods: CargoStack[]; cash: number; things?: Record<string, number> | undefined };
  /** Its pieces, built and planned, packed (Phase 8 piece A; save v10). */
  layout: PackedLayout;
  /** An owned site's lease, or none and squatted on (plan 09 §2.2; Phase 9 piece W). */
  tenure?: 'leased' | 'squatted' | undefined;
  /** Last seen there by a passing ship or a pursuer (plan 09 §8; Phase 8 piece F). */
  spotted?: { at: number; by: string; ship: string } | undefined;
  /** Salvage taken from the site's ruins this season (plan 09 §6.2; piece F). */
  salvage?: { season: string; taken: number } | undefined;
  /** Batches loaded in its passive stations (the still), by station id (piece E). */
  stations?: Record<string, StationState> | undefined;
}

/** A passive station's batches, oldest first: each is ready at `readyAt` (game seconds). */
export interface StationState {
  queue: { recipe: string; readyAt: number }[];
}

/** Bounds for a site that doesn't give its own yet (piece D's Siskiwit, until it does). */
const DEFAULT_BUILD = { alongM: 0, inlandM: 20, cols: 12, rows: 10, baseM: 2 };

/** A site's build bounds (plan 09 §2.1). */
export function siteBuild(site: SiteDef): NonNullable<SiteDef['build']> {
  return site.build ?? DEFAULT_BUILD;
}

/**
 * The pieces a new claim of a site starts with: its starter laid at its corner cell, and
 * its short pier (piece C) at its own, both built.
 */
export function starterLayout(siteId: string): PackedLayout {
  const site = siteDef(siteId);
  if (!site) return emptyLayout();
  const s = site.starter ?? { id: 'starter.shack', col: 1, row: 1 };
  const shack = offsetLayout(starter(s.id).layout, s.col, s.row);
  if (!site.pier) return shack;
  const pier = offsetLayout(starter(site.pier.id).layout, site.pier.col, site.pier.row);
  return mergeLayouts(shack, pier);
}

export type Hideouts = Record<string, HideoutState>;

/**
 * The hideouts a background starts with (plan 12 §2.2): each at its own site (Phase 9
 * piece W), pre-built with the shack and its pier. Hermit Island is nobody's start.
 */
export function startingHideouts(background: string, gameSeconds: number): Hideouts {
  const out: Hideouts = {};
  for (const s of SITES) {
    if (!s.startFor.includes(background)) continue;
    out[hideoutIdOf(s.id)] = {
      siteId: s.id,
      claimedAt: gameSeconds,
      storage: { goods: [], cash: 0 },
      layout: starterLayout(s.id),
      // An owned site you start at is yours by a lease (Phase 9 piece W).
      ...(s.claim === 'owned' ? { tenure: 'leased' as const } : {}),
    };
  }
  return out;
}

/**
 * Gives a run its starting hideouts if it has none: a new run, a 0.3.0 run migrated
 * through v5, or a save from before piece E. A run that has any keeps exactly what it has
 * (plan 09 §16.5): a Lumberjack from 0.7.x keeps Stockton and doesn't get Siskiwit.
 */
export function syncHideouts(
  hideouts: Hideouts | undefined,
  background: string,
  gameSeconds: number,
): Hideouts {
  if (hideouts && Object.keys(hideouts).length > 0) return hideouts;
  const out = hideouts ?? {};
  Object.assign(out, startingHideouts(background, gameSeconds));
  return out;
}

/** Where a hideout is, for the menu and the First Week: `hideout.stockton` → "Stockton Island". */
export function hideoutPlace(hideoutId: string): string | undefined {
  return hideoutSite(hideoutId)?.place;
}

/** The site a hideout id stands on (`hideout.minnesota_point` → `site.minnesota_point`). */
export function hideoutSite(hideoutId: string): SiteDef | undefined {
  return SITES.find((s) => hideoutIdOf(s.id) === hideoutId);
}

/** CU of goods a hideout can hold: its built storage pieces (plan 09 §5.4). */
export function storageCapacity(h: HideoutState): number {
  return gridStorageCu(unpackGrid(h.layout));
}

/** Whether a hideout has a built strongbox, so it can hold cash (plan 09 §5.4). */
export function hasStrongbox(h: HideoutState): boolean {
  return gridHasStrongbox(unpackGrid(h.layout));
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
  const paid = reduceStack(stack, n);
  if (stack.qty === 0) from.splice(index, 1);
  addToHold(to, { ...stack, qty: n, paidCents: paid });
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
  if (!hasStrongbox(h)) return { ok: false, reason: 'noStrongbox' };
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

/**
 * Claiming a site (plan 09 §2.2; Phase 9 piece W). An abandoned site is claimed free by
 * the first thing built there; an owned one (Minnesota Point's light) is leased from its
 * owner, or built on without a lease and squatted. A claim made by building starts empty.
 */
export function claimSite(
  hideouts: Hideouts,
  site: SiteDef,
  gameSeconds: number,
): { hideoutId: string; state: HideoutState; claimed: boolean } {
  const hideoutId = hideoutIdOf(site.id);
  const had = hideouts[hideoutId];
  if (had) return { hideoutId, state: had, claimed: false };
  const state: HideoutState = {
    siteId: site.id,
    claimedAt: gameSeconds,
    storage: { goods: [], cash: 0 },
    layout: emptyLayout(),
    ...(site.claim === 'owned' ? { tenure: 'squatted' as const } : {}),
  };
  hideouts[hideoutId] = state;
  return { hideoutId, state, claimed: true };
}

export type LeaseResult = { ok: true; cents: number } | { ok: false; reason: string };

/** Buys an owned site's lease from the purse: the claim it makes, or makes good a squat. */
export function leaseSite(
  hideouts: Hideouts,
  site: SiteDef,
  player: { purse: number },
  gameSeconds: number,
): LeaseResult {
  if (!site.lease) return { ok: false, reason: 'Nobody to lease it from' };
  const had = hideouts[hideoutIdOf(site.id)];
  if (had?.tenure === 'leased') return { ok: false, reason: 'The lease is yours already' };
  const cents = site.lease.cents;
  if (player.purse < cents) return { ok: false, reason: 'Not enough in your purse' };
  player.purse -= cents;
  const { state } = claimSite(hideouts, site, gameSeconds);
  state.tenure = 'leased';
  return { ok: true, cents };
}

/**
 * The day's chance that a squat is noticed (plan 09 §2.2): for each hideout squatted on,
 * whether it's seen today, by the roll `rand` gives (0–1 a squat, in order of `hideouts`).
 */
export function squatsNoticed(
  hideouts: Hideouts | undefined,
  rand: (siteId: string) => number,
): { site: SiteDef; region: string; heat: number }[] {
  const out: { site: SiteDef; region: string; heat: number }[] = [];
  for (const h of Object.values(hideouts ?? {})) {
    if (h.tenure !== 'squatted') continue;
    const site = siteDef(h.siteId);
    if (!site?.lease) continue;
    if (rand(site.id) < site.lease.squatHeatChance) {
      out.push({ site, region: site.wantedRegion, heat: site.lease.squatHeat });
    }
  }
  return out;
}
