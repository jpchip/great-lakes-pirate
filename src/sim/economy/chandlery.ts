import storesJson from '../../../data/stores.json';
import { storesFileSchema, type StoreItem } from '../../../data/schemas/stores';
import type { EconomyDefs } from './defs';

/**
 * The chandlery (plan 05 §7; Phase 4 piece B): ship's stores at a fixed price, dearer in
 * the small ports by their market spread. Stores go in the lockers, not the hold, up to
 * each item's locker limit, and a chandler doesn't buy them back.
 *
 * What uses them: patch and mend kits are the at-sea repairs (plan 02 §6.1, piece G),
 * lamp oil the running lights (plan 02 §2, Phase 5's night visibility), provisions the
 * crew's food (upkeep is cut for Phase 4, plan 05 §14).
 */

/** Counts of each store aboard (plan 05 §11 `player.stores`). */
export type ShipStores = Record<string, number>;

let cached: readonly StoreItem[] | undefined;

export function storeItems(): readonly StoreItem[] {
  cached ??= storesFileSchema.parse(storesJson);
  return cached;
}

/** The large-port spread every chandler's list price already includes. */
const LIST_SPREAD = 0.06;

/** What one of an item costs at this port's chandlery, cents. */
export function storePriceCents(defs: EconomyDefs, portId: string, item: StoreItem): number {
  const spread = defs.markets.get(portId)?.spread ?? LIST_SPREAD;
  return Math.ceil((item.priceCents * (1 + spread)) / (1 + LIST_SPREAD));
}

export type StoreRefusal = 'badQty' | 'unknown' | 'full' | 'noMoney';

export type StoreResult =
  { ok: true; item: string; qty: number; totalCents: number } | { ok: false; reason: StoreRefusal };

/** How many more of an item fit in the lockers. */
export function storeRoom(stores: ShipStores, item: StoreItem): number {
  return Math.max(0, item.max - (stores[item.id] ?? 0));
}

/** Buys `qty` of a store: all or nothing. */
export function buyStores(
  defs: EconomyDefs,
  trader: { purse: number; stores: ShipStores },
  portId: string,
  itemId: string,
  qty: number,
): StoreResult {
  if (!Number.isInteger(qty) || qty <= 0) return { ok: false, reason: 'badQty' };
  const item = storeItems().find((s) => s.id === itemId);
  if (!item) return { ok: false, reason: 'unknown' };
  if (storeRoom(trader.stores, item) < qty) return { ok: false, reason: 'full' };
  const total = storePriceCents(defs, portId, item) * qty;
  if (total > trader.purse) return { ok: false, reason: 'noMoney' };
  trader.purse -= total;
  trader.stores[item.id] = (trader.stores[item.id] ?? 0) + qty;
  return { ok: true, item: item.id, qty, totalCents: total };
}
