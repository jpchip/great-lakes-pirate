import { sailShipRecord, T1_SCHOONER_ID } from '../sailing/ships';
import type { Hold } from '../economy/hold';
import { hasSlot, upgradeDef } from '../shipyard/fit';
import { defaultShipState, gunAboard, type ShipState } from '../shipyard/shipyard';
import { addGoods, type Goods } from './edit';
import type { PackedLayout } from '../../../data/schemas/structures';
import {
  footprintCells,
  packGrid,
  slotsOf,
  unpackGrid,
  type BuildGrid,
  type BuildSite,
} from './grid';
import { siteDef, siteGeo, type HideoutState, type Hideouts } from './stash';
import { CELL_M, structure } from './structures';
import { cellDepth } from './validity';
import { buildSeconds, materialsOnHand, takeMaterials } from './work';

/**
 * The slipway (plan 09 §7.1, §7.4, plan 10 §8–9; Phase 8 piece G). A built slipway at a
 * hideout hauls the ship out for three kinds of work, each a session of game time from the
 * hideout's own materials, the way building and crafting are:
 *
 * - **Full repairs** (plan 10 §8): hull and rigging back to sound, past the kits' 80%, from
 *   lumber, hardware and rope and canvas (tar counts as rope and canvas, 09 §16.5) in
 *   proportion to what's missing. Slower than a yard, but no bill.
 * - **Installing crafted upgrades** (plan 10 §6): the repair stores and improved carriages
 *   made at the workbench and smithy wait in the hideout's storage until fitted here. Taking
 *   them in takes the upgrade's own hours, as a yard would.
 * - **A new schooner when shipless** (09 §7.4, §16.5): only when you have no ship, a T1 from
 *   30 lumber, 6 hardware and 6 rope and canvas, three game days solo. She comes bare and
 *   sound; the gear stored here can go into her at once.
 *
 * Repairs and installs need the ship moored at the hideout (alongside its pier or in its
 * anchorage); the running game checks that. Work on the ways is outdoor work, so the
 * season slows it as it does building (09 §6.3), and a bigger crew speeds it.
 *
 * Pure functions on a hideout's state and the player's ship, each all or nothing.
 */

export const SLIPWAY = {
  /** Materials for a whole hull's worth of repair; a share of it costs that share, rounded up. */
  hullGoods: { 'good.lumber': 10, 'good.hardware': 2, 'good.rope_canvas': 2 } as Goods,
  /** Materials for a whole rig's worth. */
  riggingGoods: { 'good.rope_canvas': 4 } as Goods,
  /** Game hours for a whole hull and a whole rig, solo in summer (a yard takes 12.5 and 6.7). */
  hullHours: 16,
  riggingHours: 8,
  /** The schooner a shipless captain can lay down (plan 09 §16.5: T1 only). */
  newShip: {
    classId: T1_SCHOONER_ID,
    goods: { 'good.lumber': 30, 'good.hardware': 6, 'good.rope_canvas': 6 } as Goods,
    /** Three game days, solo: there's no crew without a ship. */
    hours: 72,
  },
} as const;

export type SlipwayRefusal =
  | 'noSlipway'
  | 'shipless'
  | 'hasShip'
  | 'sound'
  | 'noGoods'
  | 'noThing'
  | 'unknown'
  | 'fitted'
  | 'noSlot'
  | 'noGun';

export const SLIPWAY_REFUSALS: Readonly<Record<SlipwayRefusal, string>> = {
  noSlipway: 'There is no slipway built here.',
  shipless: 'You have no ship to haul out.',
  hasShip: 'You have a ship already: the slipway builds only for a captain without one.',
  sound: 'She needs no repair.',
  noGoods: "There aren't the materials here.",
  noThing: "There's none of that kept here.",
  unknown: 'There is no such fitting.',
  fitted: 'She has one already.',
  noSlot: 'No free slot for it on this hull.',
  noGun: 'There is no gun aboard to fit it to.',
};

export type SlipwayResult<E> = { ok: true; event: E } | { ok: false; reason: SlipwayRefusal };

/** Work options: the crew's tier (1 solo … 3) and when the work starts, for the season. */
export interface SlipwayWork {
  crewTier: number;
  gameSeconds: number;
}

/** Whether a slipway is built here (a ghost doesn't haul anything out). */
export function hasSlipway(h: HideoutState): boolean {
  return unpackGrid(h.layout)
    .built()
    .some((p) => structure(p.piece.id).functions.slipway);
}

const clamp01 = (v: number): number => Math.min(Math.max(v, 0), 1);

function scaledUp(goods: Goods, share: number): Goods {
  const out: Goods = {};
  if (share <= 1e-9) return out;
  for (const [g, n] of Object.entries(goods)) out[g] = Math.ceil(n * share - 1e-9);
  return out;
}

function hasAll(have: Goods, need: Goods): boolean {
  return Object.entries(need).every(([g, n]) => (have[g] ?? 0) >= n);
}

function take(sources: Hold[], goods: Goods): void {
  for (const [g, n] of Object.entries(goods)) takeMaterials(sources, g, n);
}

export interface RepairQuote {
  goods: Goods;
  seconds: number;
}

/** What hauling her out and making her sound would take. Nothing when she's sound. */
export function slipwayRepairQuote(ship: ShipState, work: SlipwayWork): RepairQuote {
  const hull = 1 - clamp01(ship.hull01);
  const rig = 1 - clamp01(ship.rigging01);
  const goods: Goods = {};
  addGoods(goods, scaledUp(SLIPWAY.hullGoods, hull));
  addGoods(goods, scaledUp(SLIPWAY.riggingGoods, rig));
  const hours =
    hull + rig > 1e-9
      ? Math.max(1, Math.ceil(hull * SLIPWAY.hullHours + rig * SLIPWAY.riggingHours))
      : 0;
  return { goods, seconds: hours > 0 ? buildSeconds(hours, work) : 0 };
}

export function repairRefusal(
  h: HideoutState,
  ship: ShipState | undefined,
  sources: readonly Hold[],
  work: SlipwayWork,
): SlipwayRefusal | undefined {
  if (!hasSlipway(h)) return 'noSlipway';
  if (!ship) return 'shipless';
  const q = slipwayRepairQuote(ship, work);
  if (q.seconds === 0) return 'sound';
  if (!hasAll(materialsOnHand(sources), q.goods)) return 'noGoods';
  return undefined;
}

export interface SlipwayRepaired {
  used: Goods;
  seconds: number;
  hull01: number;
  rigging01: number;
}

/** Hauls her out and makes her sound: hull and rigging to full, materials from `sources`. */
export function repairAtSlipway(
  h: HideoutState,
  ship: ShipState,
  sources: Hold[],
  work: SlipwayWork,
): SlipwayResult<SlipwayRepaired> {
  const why = repairRefusal(h, ship, sources, work);
  if (why) return { ok: false, reason: why };
  const q = slipwayRepairQuote(ship, work);
  take(sources, q.goods);
  ship.hull01 = 1;
  ship.rigging01 = 1;
  return { ok: true, event: { used: q.goods, seconds: q.seconds, hull01: 1, rigging01: 1 } };
}

/** Upgrades kept here waiting for the slipway, by id. */
export function upgradesKept(h: HideoutState): [string, number][] {
  return Object.entries(h.storage.things ?? {}).filter(
    ([id, n]) => n > 0 && id.startsWith('upgrade.'),
  );
}

/** Why a kept upgrade can't go into her here now, or undefined. */
export function installRefusal(
  h: HideoutState,
  ship: ShipState | undefined,
  upgradeId: string,
): SlipwayRefusal | undefined {
  if (!hasSlipway(h)) return 'noSlipway';
  if (!ship) return 'shipless';
  const u = upgradeDef(upgradeId);
  if (!u) return 'unknown';
  if ((h.storage.things?.[upgradeId] ?? 0) <= 0) return 'noThing';
  if (ship.upgrades.includes(u.id)) return 'fitted';
  if (u.needsGun && !gunAboard(ship)) return 'noGun';
  if (!hasSlot(sailShipRecord(ship.classId), ship.upgrades, u.category)) return 'noSlot';
  return undefined;
}

/** Seconds the install takes here: the upgrade's own hours, by crew and season. */
export function installSeconds(upgradeId: string, work: SlipwayWork): number {
  return buildSeconds(upgradeDef(upgradeId)?.installHours ?? 0, work);
}

export interface SlipwayInstalled {
  upgrade: string;
  seconds: number;
}

/** Fits a kept upgrade: out of the hideout's storage and into her. */
export function installAtSlipway(
  h: HideoutState,
  ship: ShipState,
  upgradeId: string,
  work: SlipwayWork,
): SlipwayResult<SlipwayInstalled> {
  const why = installRefusal(h, ship, upgradeId);
  if (why) return { ok: false, reason: why };
  const things = (h.storage.things ??= {});
  things[upgradeId] = (things[upgradeId] ?? 0) - 1;
  if ((things[upgradeId] ?? 0) <= 0) Reflect.deleteProperty(things, upgradeId);
  ship.upgrades.push(upgradeId);
  return { ok: true, event: { upgrade: upgradeId, seconds: installSeconds(upgradeId, work) } };
}

/** Seconds a new schooner takes on the ways: solo, in this season. */
export function newShipSeconds(gameSeconds: number): number {
  return buildSeconds(SLIPWAY.newShip.hours, { crewTier: 1, gameSeconds });
}

/** Why a new schooner can't be laid down here now, or undefined. */
export function newShipRefusal(
  h: HideoutState,
  shipless: boolean,
  sources: readonly Hold[],
): SlipwayRefusal | undefined {
  if (!hasSlipway(h)) return 'noSlipway';
  if (!shipless) return 'hasShip';
  if (!hasAll(materialsOnHand(sources), SLIPWAY.newShip.goods)) return 'noGoods';
  return undefined;
}

export interface ShipBuilt {
  ship: ShipState;
  used: Goods;
  seconds: number;
}

/** Builds and launches a new schooner (bare and sound) for a captain without a ship. */
export function buildShipAtSlipway(
  h: HideoutState,
  shipless: boolean,
  sources: Hold[],
  gameSeconds: number,
): SlipwayResult<ShipBuilt> {
  const why = newShipRefusal(h, shipless, sources);
  if (why) return { ok: false, reason: why };
  take(sources, SLIPWAY.newShip.goods);
  return {
    ok: true,
    event: {
      ship: defaultShipState(SLIPWAY.newShip.classId),
      used: { ...SLIPWAY.newShip.goods },
      seconds: newShipSeconds(gameSeconds),
    },
  };
}

/** Rough distance between two geo points, km (fine for choosing the nearer of two sites). */
function geoKm(a: { lat: number; lon: number }, b: { lat: number; lon: number }): number {
  const dLat = (a.lat - b.lat) * 111;
  const dLon = (a.lon - b.lon) * 111 * Math.cos(((a.lat + b.lat) / 2) * (Math.PI / 180));
  return Math.hypot(dLat, dLon);
}

/**
 * The hideout with a built slipway that a captain who has lost her ship would make for:
 * the nearest to where she went down, or the first if that isn't known.
 */
export function slipwayHideout(
  hideouts: Hideouts | undefined,
  near?: { lat: number; lon: number },
): string | undefined {
  let best: string | undefined;
  let bestKm = Infinity;
  for (const [id, h] of Object.entries(hideouts ?? {})) {
    if (!hasSlipway(h)) continue;
    const site = siteDef(h.siteId);
    const at = site && siteGeo(site);
    const km = near && at ? geoKm(near, at) : 0;
    if (km < bestKm) {
      best = id;
      bestKm = km;
    }
  }
  return best;
}

/**
 * Where to stand at a slipway, site meters: the middle of its driest cell, at the head of
 * the ways. Undefined without a built slipway.
 */
export function slipwayHead(
  grid: BuildGrid,
  site: BuildSite,
): { x: number; z: number; seaward: { x: number; z: number } } | undefined {
  const way = grid.built().find((p) => structure(p.piece.id).functions.slipway);
  if (!way) return undefined;
  const cells = footprintCells(structure(way.piece.id), way.piece);
  let head = cells[0];
  let foot = cells[0];
  for (const c of cells) {
    if (!head || cellDepth(site, c.col, c.row) < cellDepth(site, head.col, head.row)) head = c;
    if (!foot || cellDepth(site, c.col, c.row) > cellDepth(site, foot.col, foot.row)) foot = c;
  }
  if (!head || !foot) return undefined;
  return {
    x: (head.col + 0.5) * CELL_M,
    z: (head.row + 0.5) * CELL_M,
    seaward: { x: (foot.col + 0.5) * CELL_M, z: (foot.row + 0.5) * CELL_M },
  };
}

/**
 * A place on each MVP site where the ways meet the rules on the baked shore (checked in
 * tests/slipway.test.ts): for the dev hook, the tests and the screenshots.
 */
export const SLIPWAY_SPOTS: Readonly<Record<string, { col: number; row: number; rot: number }>> = {
  'site.stockton': { col: 2, row: 1, rot: 0 },
  'site.siskiwit': { col: 9, row: 1, rot: 0 },
};

/** The layout with a built slipway at the site's spot (dev builds and tests). */
export function withSlipway(layout: PackedLayout, siteId: string): PackedLayout {
  const spot = SLIPWAY_SPOTS[siteId];
  if (!spot) return layout;
  const grid = unpackGrid(layout);
  const piece = { id: 'build.slipway', ...spot, level: 0, variant: 0, paint: 0 };
  if (!slotsOf(piece).some((k) => grid.inSlot(k))) grid.add(piece, true);
  return packGrid(grid);
}
