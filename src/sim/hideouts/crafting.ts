import itemsJson from '../../../data/items.json';
import recipesJson from '../../../data/recipes.json';
import stationsJson from '../../../data/stations.json';
import {
  itemsFileSchema,
  recipesFileSchema,
  stationsFileSchema,
  type CraftItem,
  type RecipeDef,
  type StationDef,
} from '../../../data/schemas/crafting';
import { storeItems, storeMax, type ShipStores } from '../economy/chandlery';
import { addToHold, holdUsed, reduceStack, type CargoStack, type Hold } from '../economy/hold';
import { upgradeDef } from '../shipyard/fit';
import type { PackedLayout } from '../../../data/schemas/structures';
import { packGrid, slotsOf, unpackGrid } from './grid';
import { storageCapacity, type HideoutState, type StationState } from './stash';
import { structure } from './structures';
import { CREW_FACTOR, materialsOnHand, takeMaterials } from './work';

/**
 * Crafting at a hideout (plan 09 §7; Phase 8 piece E). Pure functions on a hideout's
 * state, the way stash.ts and work.ts are.
 *
 * - A recipe needs its **station built** at the hideout (a ghost doesn't count), and a
 *   well or rain barrel when it wants water.
 * - Goods come from the **sources** in order, as a build session's materials do: the
 *   hideout's storage first, then the hold of a ship moored there. Contract cargo is never
 *   used. Things (crates, barrels) come from the hideout's storage only.
 * - What's made goes into **that hideout's storage** (plan 09 §16.3 criterion 4): goods
 *   need the room, things take none. Kits, picks and crowbars are the chandlery's stores and
 *   go aboard into the lockers from there; upgrades wait for a slipway (piece G).
 * - An **active** station works while you wait: the batches take game time, faster with a
 *   crew (as a build session; a workshop is indoors, so the season doesn't slow it).
 * - A **passive** station (the still) is loaded and left: batches run one after another
 *   from when they're loaded, so a week never makes more than one, and what's ready goes
 *   into storage whenever the clock is settled (`settleProduction`), on load or after any
 *   time skip.
 */

export const CRAFT_ITEMS: readonly CraftItem[] = itemsFileSchema.parse(itemsJson);
export const STATIONS: readonly StationDef[] = stationsFileSchema.parse(stationsJson);
export const RECIPES: readonly RecipeDef[] = recipesFileSchema.parse(recipesJson);

const STATION_BY_ID = new Map(STATIONS.map((s) => [s.id, s]));
const RECIPE_BY_ID = new Map(RECIPES.map((r) => [r.id, r]));
const ITEM_BY_ID = new Map(CRAFT_ITEMS.map((i) => [i.id, i]));

export function stationDef(id: string): StationDef | undefined {
  return STATION_BY_ID.get(id);
}

export function recipeDef(id: string): RecipeDef | undefined {
  return RECIPE_BY_ID.get(id);
}

/** The recipes a station makes, in data order. */
export function recipesAt(stationId: string): RecipeDef[] {
  return RECIPES.filter((r) => r.station === stationId);
}

/** A thing's name: a store's, an upgrade's or an item's. */
export function thingName(id: string): string {
  if (id.startsWith('store.')) return storeItems().find((s) => s.id === id)?.name ?? id;
  if (id.startsWith('upgrade.')) return upgradeDef(id)?.name ?? id;
  return ITEM_BY_ID.get(id)?.name ?? id;
}

export type Goods = Record<string, number>;

/** Stations built at a hideout (their pieces standing, not ghosts). */
export function builtStations(h: HideoutState): Set<string> {
  const out = new Set<string>();
  for (const p of unpackGrid(h.layout).built()) {
    const st = structure(p.piece.id).functions.station;
    if (st) out.add(st);
  }
  return out;
}

/** Whether the hideout has a built well or rain barrel. */
export function hasWater(h: HideoutState): boolean {
  return unpackGrid(h.layout)
    .built()
    .some((p) => structure(p.piece.id).functions.water);
}

/** Things stored at a hideout, by id (filled in when absent). */
export function thingsOf(h: HideoutState): Record<string, number> {
  return (h.storage.things ??= {});
}

function stationState(h: HideoutState, stationId: string): StationState {
  const all = (h.stations ??= {});
  return (all[stationId] ??= { queue: [] });
}

function scaled(goods: Goods | undefined, n: number): Goods {
  const out: Goods = {};
  for (const [g, q] of Object.entries(goods ?? {})) out[g] = q * n;
  return out;
}

const sumCu = (goods: Goods): number => Object.values(goods).reduce((a, b) => a + b, 0);

export type CraftRefusal =
  | 'unknown'
  | 'badQty'
  | 'noStation'
  | 'noWater'
  | 'noGoods'
  | 'noThings'
  | 'noRoom'
  | 'noHot'
  | 'queueFull';

export const CRAFT_REFUSALS: Readonly<Record<CraftRefusal, string>> = {
  unknown: 'There is no such work.',
  badQty: 'Choose how many.',
  noStation: 'There is no station for that here.',
  noWater: 'The still wants water: build a well or a rain barrel.',
  noGoods: "You haven't the goods for that here.",
  noThings: "You haven't the makings for that here.",
  noRoom: 'There is no room in the storage for what it makes.',
  noHot: 'There is no stolen lot here to re-crate.',
  queueFull: 'The still is full: wait for a batch to run off.',
};

export interface CraftOptions {
  /** The crew's tier (1–3); solo or shipless is 1. */
  crewTier: number;
  gameSeconds: number;
  /** Re-crating: the hot lot in the hideout's storage, by its index. */
  stackIndex?: number | undefined;
}

export type CraftResult =
  | {
      ok: true;
      recipe: string;
      batches: number;
      /** Game seconds the work took: advance the clock by this (0 for loading the still). */
      seconds: number;
      /** What it made now (nothing yet for a still's batches). */
      goods: Goods;
      things: Goods;
      /** Goods and things used. */
      usedGoods: Goods;
      usedThings: Goods;
      /** A passive batch: when the last one loaded is ready. */
      readyAt?: number;
    }
  | { ok: false; reason: CraftRefusal };

/** What a hideout's built pieces give crafting, worked out once per look (piece E). */
export interface HideoutFacts {
  stations: Set<string>;
  water: boolean;
  capacity: number;
}

export function hideoutFacts(h: HideoutState): HideoutFacts {
  return { stations: builtStations(h), water: hasWater(h), capacity: storageCapacity(h) };
}

/** CU the storage would have free once `goods` were taken from the sources, storage first. */
function roomAfterTaking(h: HideoutState, capacity: number, goods: Goods): number {
  const inStorage = materialsOnHand([h.storage.goods]);
  let freed = 0;
  for (const [g, n] of Object.entries(goods)) freed += Math.min(n, inStorage[g] ?? 0);
  return capacity - holdUsed(h.storage.goods) + freed;
}

/** Why `batches` of a recipe can't be made here now, or undefined if they can. */
export function craftRefusal(
  h: HideoutState,
  recipeId: string,
  batches: number,
  sources: readonly Hold[],
  opts: Pick<CraftOptions, 'stackIndex'> = {},
  facts: HideoutFacts = hideoutFacts(h),
): CraftRefusal | undefined {
  const r = recipeDef(recipeId);
  if (!r) return 'unknown';
  if (!Number.isInteger(batches) || batches <= 0) return 'badQty';
  if (!facts.stations.has(r.station)) return 'noStation';
  if (r.inputs.water && !facts.water) return 'noWater';
  const station = stationDef(r.station);
  if (station?.passive) {
    const queued = h.stations?.[r.station]?.queue.length ?? 0;
    if (queued + batches > station.passive.queueMax) return 'queueFull';
  }
  if (r.recrate) {
    const s = opts.stackIndex === undefined ? undefined : h.storage.goods[opts.stackIndex];
    if (!s?.hot || s.contract || s.qty < batches || isRecrated(s)) return 'noHot';
  }
  const needGoods = scaled(r.inputs.goods, batches);
  const have = materialsOnHand(sources);
  for (const [g, n] of Object.entries(needGoods)) if ((have[g] ?? 0) < n) return 'noGoods';
  const things = h.storage.things ?? {};
  for (const [t, n] of Object.entries(scaled(r.inputs.things, batches))) {
    if ((things[t] ?? 0) < n) return 'noThings';
  }
  // A still's batches are stored when they run off, and wait in the still for room.
  if (!station?.passive) {
    const out = sumCu(scaled(r.output.goods, batches));
    if (out > 0 && roomAfterTaking(h, facts.capacity, needGoods) < out) return 'noRoom';
  }
  return undefined;
}

/** How many batches of a recipe could be made here now (0 if none), up to `cap`. */
export function maxBatches(
  h: HideoutState,
  recipeId: string,
  sources: readonly Hold[],
  opts: Pick<CraftOptions, 'stackIndex'> = {},
  cap = 99,
): number {
  const facts = hideoutFacts(h);
  const ok = (n: number): boolean => !craftRefusal(h, recipeId, n, sources, opts, facts);
  if (!ok(1)) return 0;
  // Every limit is monotone in the batches, so search for the last that works.
  let lo = 1;
  let hi = cap;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (ok(mid)) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

/** Game seconds `batches` of a recipe take at an active station. */
export function craftSeconds(r: RecipeDef, batches: number, crewTier: number): number {
  return Math.round(r.hours * batches * 3600 * (CREW_FACTOR[crewTier] ?? 1));
}

/**
 * Makes `batches` of a recipe at this hideout: takes the goods and things, and either
 * stores what's made (an active station; the caller runs the clock on by `seconds`) or
 * loads the still's queue. All or nothing.
 */
export function craft(
  h: HideoutState,
  recipeId: string,
  batches: number,
  sources: Hold[],
  opts: CraftOptions,
): CraftResult {
  const why = craftRefusal(h, recipeId, batches, sources, opts);
  if (why) return { ok: false, reason: why };
  const r = recipeDef(recipeId) as RecipeDef;
  const station = stationDef(r.station) as StationDef;
  const usedGoods = scaled(r.inputs.goods, batches);
  const usedThings = scaled(r.inputs.things, batches);
  for (const [g, n] of Object.entries(usedGoods)) takeMaterials(sources, g, n);
  const things = thingsOf(h);
  for (const [t, n] of Object.entries(usedThings)) {
    things[t] = (things[t] ?? 0) - n;
    if (things[t] <= 0) Reflect.deleteProperty(things, t);
  }

  if (station.passive) {
    const st = stationState(h, r.station);
    let at = opts.gameSeconds;
    const last = st.queue[st.queue.length - 1];
    if (last) at = Math.max(at, last.readyAt);
    for (let i = 0; i < batches; i++) {
      at += r.hours * 3600;
      st.queue.push({ recipe: r.id, readyAt: at });
    }
    return {
      ok: true,
      recipe: r.id,
      batches,
      seconds: 0,
      goods: {},
      things: {},
      usedGoods,
      usedThings,
      readyAt: at,
    };
  }

  if (r.recrate) recrate(h.storage.goods, opts.stackIndex as number, batches);
  const goods = scaled(r.output.goods, batches);
  for (const [g, n] of Object.entries(goods)) addToHold(h.storage.goods, { good: g, qty: n });
  const made = scaled(r.output.things, batches);
  for (const [t, n] of Object.entries(made)) things[t] = (things[t] ?? 0) + n;
  return {
    ok: true,
    recipe: r.id,
    batches,
    seconds: craftSeconds(r, batches, opts.crewTier),
    goods,
    things: made,
    usedGoods,
    usedThings,
  };
}

/** A hot lot already in plain crates: no marks left to take off. */
export function isRecrated(s: CargoStack): boolean {
  return !!s.hot && s.hot.traceability === 0 && !s.hot.owner;
}

/**
 * Re-crates `qty` CU of the hot stack at `index` (plan 05 §6.1): the company's marks come
 * off (no owner, traceability 0), but it's still stolen goods with its heat and region.
 */
function recrate(stacks: CargoStack[], index: number, qty: number): void {
  const s = stacks[index] as CargoStack;
  const hot = s.hot as NonNullable<CargoStack['hot']>;
  const paid = reduceStack(s, qty);
  if (s.qty <= 0) stacks.splice(index, 1);
  const clean = { region: hot.region, heat: hot.heat, since: hot.since, traceability: 0 };
  // Lots re-crated from the same theft fold together.
  const same = stacks.find(
    (x) =>
      x.good === s.good &&
      !x.contract &&
      x.hot?.traceability === 0 &&
      !x.hot.owner &&
      x.hot.region === hot.region &&
      x.hot.since === hot.since &&
      x.hot.heat === hot.heat,
  );
  if (same) {
    same.qty += qty;
    if (same.paidCents !== undefined || paid !== undefined) {
      same.paidCents = (same.paidCents ?? 0) + (paid ?? 0);
    }
    return;
  }
  stacks.push({
    good: s.good,
    qty,
    hot: clean,
    ...(paid !== undefined ? { paidCents: paid } : {}),
  });
}

export interface ProductionDone {
  station: string;
  recipe: string;
  goods: Goods;
  things: Goods;
}

/**
 * Runs every passive station on to `now`: each batch whose time has come goes into the
 * storage if there's room for it, oldest first. A batch that doesn't fit waits in the
 * still (and the ones behind it with it) until there's room. Safe to call any time: on
 * load, every world tick, after a time skip.
 */
export function settleProduction(h: HideoutState, now: number): ProductionDone[] {
  const out: ProductionDone[] = [];
  for (const [stationId, st] of Object.entries(h.stations ?? {})) {
    while (st.queue.length > 0) {
      const b = st.queue[0] as StationState['queue'][number];
      if (b.readyAt > now) break;
      const r = recipeDef(b.recipe);
      if (!r) {
        st.queue.shift();
        continue;
      }
      const goods = scaled(r.output.goods, 1);
      if (sumCu(goods) > storageCapacity(h) - holdUsed(h.storage.goods)) break;
      for (const [g, n] of Object.entries(goods)) addToHold(h.storage.goods, { good: g, qty: n });
      const things = scaled(r.output.things, 1);
      const store = thingsOf(h);
      for (const [t, n] of Object.entries(things)) store[t] = (store[t] ?? 0) + n;
      st.queue.shift();
      out.push({ station: stationId, recipe: r.id, goods, things });
    }
    if (st.queue.length === 0 && h.stations) Reflect.deleteProperty(h.stations, stationId);
  }
  return out;
}

export type ThingRefusal = 'badQty' | 'notStore' | 'noneHere' | 'lockersFull' | 'noneAboard';

export const THING_REFUSALS: Readonly<Record<ThingRefusal, string>> = {
  badQty: 'Choose how many.',
  notStore: "That stays here: it isn't ship's stores.",
  noneHere: "There aren't that many here.",
  lockersFull: 'The lockers are full.',
  noneAboard: "There aren't that many aboard.",
};

export type ThingResult =
  { ok: true; id: string; qty: number } | { ok: false; reason: ThingRefusal };

/**
 * Takes up to `qty` of a store made here aboard into the lockers, as many as they hold
 * (repair stores add room for kits). Items and upgrades stay at the hideout.
 */
export function takeThing(
  h: HideoutState,
  owner: { stores: ShipStores; ship?: { upgrades: readonly string[] } | undefined },
  id: string,
  qty: number,
): ThingResult {
  if (!Number.isInteger(qty) || qty <= 0) return { ok: false, reason: 'badQty' };
  const item = storeItems().find((s) => s.id === id);
  if (!item) return { ok: false, reason: 'notStore' };
  const things = thingsOf(h);
  const here = things[id] ?? 0;
  if (here <= 0) return { ok: false, reason: 'noneHere' };
  const room = Math.max(0, storeMax(item, owner.ship?.upgrades) - (owner.stores[id] ?? 0));
  const n = Math.min(qty, here, room);
  if (n <= 0) return { ok: false, reason: 'lockersFull' };
  things[id] = here - n;
  if (things[id] <= 0) Reflect.deleteProperty(things, id);
  owner.stores[id] = (owner.stores[id] ?? 0) + n;
  return { ok: true, id, qty: n };
}

/** Puts `qty` of a store from the lockers into the hideout's storage. */
export function stashThing(
  h: HideoutState,
  owner: { stores: ShipStores },
  id: string,
  qty: number,
): ThingResult {
  if (!Number.isInteger(qty) || qty <= 0) return { ok: false, reason: 'badQty' };
  if (!storeItems().some((s) => s.id === id)) return { ok: false, reason: 'notStore' };
  const aboard = owner.stores[id] ?? 0;
  if (aboard < qty) return { ok: false, reason: 'noneAboard' };
  owner.stores[id] = aboard - qty;
  const things = thingsOf(h);
  things[id] = (things[id] ?? 0) + qty;
  return { ok: true, id, qty };
}

/**
 * A layout with a built workshop beside the starter shack: a timber floor of 4 × 2 cells
 * at cols 14–17, rows 1–2, the four stations on it, and a well at col 18 (dev hooks and
 * tests; players build theirs in build mode). Pieces already in those cells are kept.
 */
export function withWorkshop(layout: PackedLayout): PackedLayout {
  const grid = unpackGrid(layout);
  const at = (id: string, col: number, row: number): void => {
    const piece = { id, col, row, level: 0, rot: 0, variant: 0, paint: 0 };
    if (slotsOf(piece).some((k) => grid.inSlot(k))) return;
    grid.add(piece, true);
  };
  for (let c = 14; c <= 17; c++) for (let r = 1; r <= 2; r++) at('build.foundation', c, r);
  at('build.workbench', 14, 1);
  at('build.smithy', 16, 1);
  at('build.cooperage', 14, 2);
  at('build.distillery', 16, 2);
  at('build.well', 18, 1);
  return packGrid(grid);
}
