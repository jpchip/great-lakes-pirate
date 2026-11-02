import type { SailShipRecord } from '../../../data/schemas/ships';
import type { Upgrade, UpgradeCategory } from '../../../data/schemas/upgrades';
import type { EconomyDefs } from '../economy/defs';
import { holdUsed, isClean, type CargoStack, type Hold } from '../economy/hold';
import { applyTrade, quote, type MarketsState } from '../economy/market';
import { sailShipRecord, SHIP_RECORDS, T1_SCHOONER_ID } from '../sailing/ships';
import { hasSlot, slotsOf, upgradeDef } from './fit';

/**
 * The shipyard (plan 10 §3, §6, §8; Phase 4 piece G): buying a hull and trading the old
 * one in, fitting and removing upgrades, and repairs at a yard, at a chandlery and at sea
 * with the chandlery's kits. Pure functions over the player's ship (`player.ship`), purse,
 * hold and lockers: each is all or nothing and returns what happened for the caller to
 * raise on the bus, or why it was refused. The ship's condition here is a share of each
 * pool, so it holds when an upgrade changes the pool's size; the running game keeps it in
 * step with the hazard state's HP.
 */

/** The player's ship (plan 10 §11 `player.ship`; the name is `player.captain.shipName`). */
export interface ShipState {
  classId: string;
  /** Hull and rigging, each 0 (gone) … 1 (sound). */
  hull01: number;
  rigging01: number;
  /** Fitted upgrade ids, in the order they went in. */
  upgrades: string[];
}

export function defaultShipState(classId: string = T1_SCHOONER_ID): ShipState {
  return { classId, hull01: 1, rigging01: 1, upgrades: [] };
}

/** Who pays: the player (`player.purse`, `player.cargo`, `player.stores`). */
export interface Owner {
  purse: number;
  cargo: Hold;
  stores: Record<string, number>;
}

/** The large-port spread list prices include, as at the chandlery. */
const LIST_SPREAD = 0.06;
/** Trade-in: half the hull's price at her condition, a quarter of the gear left aboard (plan 10 §3). */
export const TRADE_IN_HULL = 0.5;
export const TRADE_IN_UPGRADES = 0.25;
/** Cargo that won't fit the new hold goes at 80% of what it fetches here (plan 10 §3). */
export const OVERFLOW_SALE = 0.8;
/** An upgrade taken out fetches what it would on a trade-in. */
export const REMOVAL_REFUND = TRADE_IN_UPGRADES;

/**
 * Repairs (plan 10 §8). A yard restores a wrecked hull for a quarter of her price and a
 * stripped rig for a tenth, and takes a game hour per 8% of hull and per 15% of rigging
 * missing. A chandler mends the rigging only, at a third over the yard's rate, while you
 * wait. Kits at sea give back a fifth of a pool each, but only up to 80%: the rest is yard
 * work.
 */
export const REPAIR = {
  hullShareOfPrice: 0.25,
  riggingShareOfPrice: 0.1,
  hullHoursPerShare: 1 / 0.08,
  riggingHoursPerShare: 1 / 0.15,
  chandleryMarkup: 1.33,
  kitShare: 0.2,
  kitCap: 0.8,
} as const;

export const PATCH_KIT = 'store.patch_kit';
export const MEND_KIT = 'store.mend_kit';

/** A price in a large port, with this port's spread (smaller ports charge more). */
function atPort(defs: EconomyDefs, port: string, listCents: number): number {
  const spread = defs.markets.get(port)?.spread ?? LIST_SPREAD;
  return Math.ceil((listCents * (1 + spread)) / (1 + LIST_SPREAD));
}

/** The player's classes a shipyard builds (plan 10 §2). */
export function hullsForSale(): SailShipRecord[] {
  return SHIP_RECORDS.flatMap((r) =>
    r.propulsion === 'sail' && r.role === 'player' && r.priceCents !== undefined ? [r] : [],
  ).sort((a, b) => (a.tier ?? 0) - (b.tier ?? 0));
}

/**
 * What a hull costs here. `discount` is the Standing discount (plan 10 §3: up to 15%),
 * which piece F supplies; 0 without it.
 */
export function hullPriceCents(
  defs: EconomyDefs,
  port: string,
  classId: string,
  discount = 0,
): number {
  const r = sailShipRecord(classId);
  return Math.round(atPort(defs, port, r.priceCents ?? 0) * (1 - clampDiscount(discount)));
}

export function upgradePriceCents(
  defs: EconomyDefs,
  port: string,
  upgrade: Upgrade,
  discount = 0,
): number {
  return Math.round(atPort(defs, port, upgrade.priceCents) * (1 - clampDiscount(discount)));
}

const clampDiscount = (d: number): number => Math.min(Math.max(d, 0), 0.15);
const clamp01 = (v: number): number => Math.min(Math.max(v, 0), 1);

/** Her condition as one number, each pool weighted by its size (plan 10 §3). */
export function condition01(record: SailShipRecord, ship: ShipState): number {
  const hp = record.hullHP + record.riggingHP;
  return (clamp01(ship.hull01) * record.hullHP + clamp01(ship.rigging01) * record.riggingHP) / hp;
}

export interface TradeInQuote {
  /** Half her list price at her condition. */
  hullCents: number;
  /** A quarter of the list price of the upgrades she keeps. */
  upgradesCents: number;
  totalCents: number;
  /** Transferable upgrades that move to the new hull, and what stays with the old one. */
  moving: string[];
  staying: string[];
}

/** Which upgrades move to a new hull: transferable ones, while she has the slots. */
export function movingUpgrades(ship: ShipState, to: SailShipRecord): string[] {
  const moving: string[] = [];
  for (const id of ship.upgrades) {
    const u = upgradeDef(id);
    if (u?.transferable && hasSlot(to, moving, u.category)) moving.push(id);
  }
  return moving;
}

export function tradeInQuote(ship: ShipState, to: SailShipRecord): TradeInQuote {
  const from = sailShipRecord(ship.classId);
  const moving = movingUpgrades(ship, to);
  const staying = ship.upgrades.filter((id) => !moving.includes(id));
  const hullCents = Math.floor(TRADE_IN_HULL * (from.priceCents ?? 0) * condition01(from, ship));
  const upgradesCents = Math.floor(
    TRADE_IN_UPGRADES * staying.reduce((sum, id) => sum + (upgradeDef(id)?.priceCents ?? 0), 0),
  );
  return { hullCents, upgradesCents, totalCents: hullCents + upgradesCents, moving, staying };
}

/** Cargo that won't fit the new hold, and what it fetches here at the 80% rate. */
export interface OverflowLot {
  good: string;
  qty: number;
  cents: number;
}

export interface HullQuote {
  classId: string;
  priceCents: number;
  tradeIn: TradeInQuote;
  /** What changes hands: positive, you pay; negative, the yard pays you. */
  netCents: number;
  overflow: OverflowLot[];
  overflowCents: number;
  /** Hot or contract goods that won't fit: they can't be sold here, so no deal. */
  stuck: boolean;
  /** Her hold once the moving upgrades are aboard. */
  capacity: number;
}

/**
 * Which clean CU go when the hold shrinks: the cheapest goods by what they fetch here,
 * so the valuable cargo stays aboard. Hot and contract cargo always stays.
 */
function overflowLots(
  defs: EconomyDefs,
  markets: MarketsState,
  hold: readonly CargoStack[],
  capacity: number,
  port: string,
  now: number,
): { lots: OverflowLot[]; stuck: boolean } {
  let excess = holdUsed(hold) - capacity;
  if (excess <= 0) return { lots: [], stuck: false };
  const clean = new Map<string, number>();
  for (const s of hold) if (isClean(s)) clean.set(s.good, (clean.get(s.good) ?? 0) + s.qty);
  const unit = (good: string): number => {
    const q = quote(defs, markets, port, good, 1, 'sell', now);
    return q.qty > 0 ? q.totalCents : (defs.goods.get(good)?.basePriceCents ?? 0);
  };
  const lots: OverflowLot[] = [];
  for (const good of [...clean.keys()].sort((a, b) => unit(a) - unit(b))) {
    if (excess <= 0) break;
    const qty = Math.min(excess, clean.get(good) ?? 0);
    const q = quote(defs, markets, port, good, qty, 'sell', now);
    const value = q.qty === qty ? q.totalCents : qty * (defs.goods.get(good)?.basePriceCents ?? 0);
    lots.push({ good, qty, cents: Math.floor(value * OVERFLOW_SALE) });
    excess -= qty;
  }
  return { lots, stuck: excess > 0 };
}

/** The hold a class has with these upgrades (expanded hold and the like). */
export function capacityWith(record: SailShipRecord, upgrades: readonly string[]): number {
  let mul = 1;
  for (const id of upgrades) mul *= upgradeDef(id)?.effects.cargoMul ?? 1;
  return Math.floor(record.cargoCapacity * mul);
}

export function hullQuote(
  defs: EconomyDefs,
  markets: MarketsState,
  owner: Owner,
  ship: ShipState,
  port: string,
  classId: string,
  now: number,
  discount = 0,
): HullQuote {
  const to = sailShipRecord(classId);
  const priceCents = hullPriceCents(defs, port, classId, discount);
  const tradeIn = tradeInQuote(ship, to);
  const capacity = capacityWith(to, tradeIn.moving);
  const { lots, stuck } = overflowLots(defs, markets, owner.cargo, capacity, port, now);
  const overflowCents = lots.reduce((sum, l) => sum + l.cents, 0);
  return {
    classId,
    priceCents,
    tradeIn,
    netCents: priceCents - tradeIn.totalCents,
    overflow: lots,
    overflowCents,
    stuck,
    capacity,
  };
}

export type ShipyardRefusal =
  | 'sameHull'
  | 'notForSale'
  | 'noMoney'
  | 'cargoStuck'
  | 'unknown'
  | 'notHere'
  | 'fitted'
  | 'noSlot'
  | 'notFitted'
  | 'sound'
  | 'noKit'
  | 'kitCap';

/** What `ShipPurchased` carries (plan 10 §11). */
export interface ShipPurchasedEvent {
  port: string;
  classId: string;
  fromClassId: string;
  priceCents: number;
  tradeInCents: number;
  /** Cargo sold off because it didn't fit, and what it brought. */
  autoSold: OverflowLot[];
  autoSoldCents: number;
  /** Upgrades that came across. */
  moved: string[];
}

export type ShipyardResult<E> = { ok: true; event: E } | { ok: false; reason: ShipyardRefusal };

/**
 * Buys a new hull, trading in the old one (plan 10 §3): she comes sound and bare but for
 * the transferable gear she has slots for; cargo that won't fit is sold here at 80%; the
 * purse pays the difference, or takes it when the trade-in is worth more.
 */
export function buyHull(
  defs: EconomyDefs,
  markets: MarketsState,
  owner: Owner,
  ship: ShipState,
  port: string,
  classId: string,
  now: number,
  discount = 0,
): ShipyardResult<ShipPurchasedEvent> {
  if (classId === ship.classId) return { ok: false, reason: 'sameHull' };
  if (!hullsForSale().some((r) => r.id === classId)) return { ok: false, reason: 'notForSale' };
  const q = hullQuote(defs, markets, owner, ship, port, classId, now, discount);
  if (q.stuck) return { ok: false, reason: 'cargoStuck' };
  if (q.netCents - q.overflowCents > owner.purse) return { ok: false, reason: 'noMoney' };
  for (const lot of q.overflow) {
    let left = lot.qty;
    for (let i = owner.cargo.length - 1; i >= 0 && left > 0; i--) {
      const s = owner.cargo[i] as CargoStack;
      if (s.good !== lot.good || !isClean(s)) continue;
      const take = Math.min(s.qty, left);
      s.qty -= take;
      left -= take;
      if (s.qty === 0) owner.cargo.splice(i, 1);
    }
    if (defs.markets.get(port)?.goods.has(lot.good))
      applyTrade(markets, port, lot.good, lot.qty, 'sell', now);
  }
  owner.purse += q.overflowCents - q.netCents;
  const fromClassId = ship.classId;
  ship.classId = classId;
  ship.hull01 = 1;
  ship.rigging01 = 1;
  ship.upgrades = [...q.tradeIn.moving];
  return {
    ok: true,
    event: {
      port,
      classId,
      fromClassId,
      priceCents: q.priceCents,
      tradeInCents: q.tradeIn.totalCents,
      autoSold: q.overflow,
      autoSoldCents: q.overflowCents,
      moved: q.tradeIn.moving,
    },
  };
}

export type FitSource = 'shipyard' | 'chandlery';

/** What `UpgradeInstalled` and `UpgradeRemoved` carry (plan 10 §11). */
export interface UpgradeEvent {
  port: string;
  upgrade: string;
  /** Paid to fit it, or refunded for taking it out. */
  cents: number;
  /** Game hours the work takes (0 at a chandlery). */
  hours: number;
}

/** Why an upgrade can't go in here now, or undefined if it can. */
export function fitRefusal(
  owner: Owner,
  ship: ShipState,
  upgrade: Upgrade,
  source: FitSource,
  priceCents: number,
): ShipyardRefusal | undefined {
  if (!upgrade.sources.includes(source)) return 'notHere';
  if (ship.upgrades.includes(upgrade.id)) return 'fitted';
  if (!hasSlot(sailShipRecord(ship.classId), ship.upgrades, upgrade.category)) return 'noSlot';
  if (priceCents > owner.purse) return 'noMoney';
  return undefined;
}

/** Fits an upgrade (plan 10 §6): a yard takes its install hours, a chandler fits it on the spot. */
export function installUpgrade(
  defs: EconomyDefs,
  owner: Owner,
  ship: ShipState,
  port: string,
  upgradeId: string,
  source: FitSource,
  discount = 0,
): ShipyardResult<UpgradeEvent> {
  const u = upgradeDef(upgradeId);
  if (!u) return { ok: false, reason: 'unknown' };
  const price = upgradePriceCents(defs, port, u, discount);
  const refusal = fitRefusal(owner, ship, u, source, price);
  if (refusal) return { ok: false, reason: refusal };
  owner.purse -= price;
  ship.upgrades.push(u.id);
  return {
    ok: true,
    event: {
      port,
      upgrade: u.id,
      cents: price,
      hours: source === 'shipyard' ? u.installHours : 0,
    },
  };
}

/** Takes an upgrade out for a quarter of its list price, freeing the slot. */
export function removeUpgrade(
  owner: Owner,
  ship: ShipState,
  port: string,
  upgradeId: string,
  source: FitSource,
): ShipyardResult<UpgradeEvent> {
  const u = upgradeDef(upgradeId);
  if (!u) return { ok: false, reason: 'unknown' };
  if (!ship.upgrades.includes(u.id)) return { ok: false, reason: 'notFitted' };
  if (!u.sources.includes(source)) return { ok: false, reason: 'notHere' };
  const refund = Math.floor(u.priceCents * REMOVAL_REFUND);
  ship.upgrades = ship.upgrades.filter((id) => id !== u.id);
  owner.purse += refund;
  return {
    ok: true,
    event: {
      port,
      upgrade: u.id,
      cents: refund,
      hours: source === 'shipyard' ? Math.ceil(u.installHours / 2) : 0,
    },
  };
}

/** Free slots in each category with these upgrades. */
export function freeSlots(ship: ShipState, category: UpgradeCategory): number {
  const r = sailShipRecord(ship.classId);
  return (
    slotsOf(r, category) -
    ship.upgrades.filter((id) => upgradeDef(id)?.category === category).length
  );
}

export type RepairPlace = 'shipyard' | 'chandlery';

export interface RepairQuote {
  hullCents: number;
  riggingCents: number;
  totalCents: number;
  hours: number;
  /** Where each pool ends up. */
  hull01: number;
  rigging01: number;
}

/** What it costs to make her sound: a yard does both pools, a chandler the rigging only. */
export function repairQuote(
  defs: EconomyDefs,
  port: string,
  ship: ShipState,
  place: RepairPlace,
): RepairQuote {
  const price = sailShipRecord(ship.classId).priceCents ?? 0;
  const hullMissing = place === 'shipyard' ? 1 - clamp01(ship.hull01) : 0;
  const rigMissing = 1 - clamp01(ship.rigging01);
  const markup = place === 'chandlery' ? REPAIR.chandleryMarkup : 1;
  const hullCents = atPort(defs, port, Math.round(hullMissing * REPAIR.hullShareOfPrice * price));
  const riggingCents = atPort(
    defs,
    port,
    Math.round(rigMissing * REPAIR.riggingShareOfPrice * price * markup),
  );
  const hours =
    place === 'shipyard' && hullMissing + rigMissing > 0
      ? Math.max(
          1,
          Math.ceil(
            hullMissing * REPAIR.hullHoursPerShare + rigMissing * REPAIR.riggingHoursPerShare,
          ),
        )
      : 0;
  return {
    hullCents: hullMissing > 0 ? hullCents : 0,
    riggingCents: rigMissing > 0 ? riggingCents : 0,
    totalCents: (hullMissing > 0 ? hullCents : 0) + (rigMissing > 0 ? riggingCents : 0),
    hours,
    hull01: place === 'shipyard' ? 1 : ship.hull01,
    rigging01: 1,
  };
}

/** What `ShipRepaired` carries (plan 10 §11). */
export interface ShipRepairedEvent {
  /** Undefined for a kit used at sea. */
  port: string | undefined;
  how: RepairPlace | 'patchKit' | 'mendKit';
  hull01: number;
  rigging01: number;
  costCents: number;
  hours: number;
}

export function repairShip(
  defs: EconomyDefs,
  owner: Owner,
  ship: ShipState,
  port: string,
  place: RepairPlace,
): ShipyardResult<ShipRepairedEvent> {
  const q = repairQuote(defs, port, ship, place);
  if (q.totalCents === 0) return { ok: false, reason: 'sound' };
  if (q.totalCents > owner.purse) return { ok: false, reason: 'noMoney' };
  owner.purse -= q.totalCents;
  ship.hull01 = q.hull01;
  ship.rigging01 = q.rigging01;
  return {
    ok: true,
    event: {
      port,
      how: place,
      hull01: ship.hull01,
      rigging01: ship.rigging01,
      costCents: q.totalCents,
      hours: q.hours,
    },
  };
}

/**
 * Uses a patch kit on the hull or a mend kit on the rigging at sea (plan 02 §6.1, plan 10
 * §8): a fifth of the pool back, up to 80%.
 */
export function useKit(
  owner: Owner,
  ship: ShipState,
  kit: typeof PATCH_KIT | typeof MEND_KIT,
): ShipyardResult<ShipRepairedEvent> {
  const pool = kit === PATCH_KIT ? 'hull01' : 'rigging01';
  if ((owner.stores[kit] ?? 0) <= 0) return { ok: false, reason: 'noKit' };
  if (ship[pool] >= REPAIR.kitCap - 1e-9) return { ok: false, reason: 'kitCap' };
  owner.stores[kit] = (owner.stores[kit] ?? 0) - 1;
  ship[pool] = Math.min(REPAIR.kitCap, ship[pool] + REPAIR.kitShare);
  return {
    ok: true,
    event: {
      port: undefined,
      how: kit === PATCH_KIT ? 'patchKit' : 'mendKit',
      hull01: ship.hull01,
      rigging01: ship.rigging01,
      costCents: 0,
      hours: 0,
    },
  };
}

/** The kit the ship needs most: the hull first when it's under the cap, then the rigging. */
export function kitFor(owner: Owner, ship: ShipState): typeof PATCH_KIT | typeof MEND_KIT {
  const hullWants = ship.hull01 < REPAIR.kitCap - 1e-9 && (owner.stores[PATCH_KIT] ?? 0) > 0;
  const rigWants = ship.rigging01 < REPAIR.kitCap - 1e-9 && (owner.stores[MEND_KIT] ?? 0) > 0;
  if (hullWants && (!rigWants || ship.hull01 <= ship.rigging01 + 0.1)) return PATCH_KIT;
  if (rigWants) return MEND_KIT;
  return ship.hull01 <= ship.rigging01 ? PATCH_KIT : MEND_KIT;
}
