import type { GUI } from 'three/examples/jsm/libs/lil-gui.module.min.js';
import type { GameEconomy } from '../gameplay/economy';
import { curioDefs, giveCurio } from '../sim/discovery/discovery';
import { storeItems, storeMax } from '../sim/economy/chandlery';
import { addToHold, holdFree, holdUsed } from '../sim/economy/hold';
import { CRAFT_ITEMS, RECIPES, thingName } from '../sim/hideouts/crafting';
import { claimSite, hideoutIdOf, SITES } from '../sim/hideouts/stash';
import type { WorldState } from '../sim/world-state';

/**
 * The Give folder of the dev overlay, for playtesting: money in the purse, goods in the hold
 * (clean or hot), ship's stores and tools in the lockers, things and cash in a hideout,
 * curios, every hideout site claimed, health and Fame. Each change is saved straight away.
 */
export interface GivePanelOptions {
  gui: GUI;
  state: WorldState;
  economy: GameEconomy;
  /** The law region hot goods are marked stolen in: the one you're in. */
  region(): string;
  saveNow(): Promise<void>;
}

const CENTS = 100;

/** Adds whole dollars to the purse (or takes them, never below $0). Returns the new purse. */
export function giveMoney(player: { purse: number }, dollars: number): number {
  const cents = Math.round((Number.isFinite(dollars) ? dollars : 0) * CENTS);
  player.purse = Math.max(0, player.purse + cents);
  return player.purse;
}

/**
 * Loads `qty` CU of a good into the hold, no more than there's room for unless `overload`.
 * Returns the CU loaded. Given goods cost nothing, so they sell at a clean profit.
 */
export function loadGoods(
  hold: WorldState['player']['cargo'],
  capacity: number,
  good: string,
  qty: number,
  overload = false,
): number {
  const want = Math.max(0, Math.floor(qty));
  const room = overload ? want : Math.min(want, holdFree(hold, capacity));
  if (room <= 0) return 0;
  addToHold(hold, { good, qty: room, paidCents: 0 });
  return room;
}

/** Puts `qty` of a store aboard, up to the locker's limit. Returns how many went aboard. */
export function giveStore(
  stores: Record<string, number>,
  id: string,
  qty: number,
  upgrades: readonly string[] = [],
): number {
  const item = storeItems().find((s) => s.id === id);
  if (!item) return 0;
  const have = stores[id] ?? 0;
  const add = Math.max(0, Math.min(Math.floor(qty), storeMax(item, upgrades) - have));
  if (add > 0) stores[id] = have + add;
  return add;
}

/** Every store to its locker limit. */
export function topUpStores(
  stores: Record<string, number>,
  upgrades: readonly string[] = [],
): void {
  for (const item of storeItems()) stores[item.id] = storeMax(item, upgrades);
}

/** Claims every hideout site not yet yours, empty; returns the ids newly claimed. */
export function claimEverySite(state: WorldState): string[] {
  state.hideouts ??= {};
  const now = state.environment.clock.gameSeconds;
  const claimed: string[] = [];
  for (const site of SITES) {
    if (claimSite(state.hideouts, site, now).claimed) claimed.push(hideoutIdOf(site.id));
  }
  return claimed;
}

export function createGivePanel(options: GivePanelOptions): { update(): void } {
  const { state, economy } = options;
  const player = state.player;
  const root = options.gui.addFolder('Give').close();
  const save = (): void => {
    void options.saveNow().catch((err: unknown) => console.warn('Save after give failed', err));
  };
  const upgrades = (): readonly string[] => player.ship?.upgrades ?? [];

  const read = { purse: '', hold: '', stores: '' };
  const readout = root.addFolder('Readout');
  readout.add(read, 'purse').disable().listen();
  readout.add(read, 'hold').disable().listen();
  readout.add(read, 'stores').disable().listen();

  // Money.
  const money = { dollars: 500 };
  const moneyFolder = root.addFolder('Money');
  moneyFolder.add(money, 'dollars', 0, 100_000, 1).name('Dollars');
  moneyFolder
    .add({ go: () => (giveMoney(player, money.dollars), save()) }, 'go')
    .name('Give money');
  moneyFolder
    .add({ go: () => (giveMoney(player, -money.dollars), save()) }, 'go')
    .name('Take money');
  moneyFolder.add({ go: () => ((player.purse = 0), save()) }, 'go').name('Empty the purse');

  // Goods in the hold.
  const goodNames: Record<string, string> = {};
  for (const [id, g] of economy.defs.goods) goodNames[`${g.name} (${id})`] = id;
  const firstGood = Object.values(goodNames)[0] ?? '';
  const goods = { good: firstGood, qty: 10, overload: false, heat: 1 };
  const goodsFolder = root.addFolder('Goods in the hold');
  goodsFolder.add(goods, 'good', goodNames).name('Good');
  goodsFolder.add(goods, 'qty', 1, 500, 1).name('CU');
  goodsFolder.add(goods, 'overload').name('Past the hold limit');
  const load = (qty: number): number => {
    const n = loadGoods(player.cargo, economy.capacity, goods.good, qty, goods.overload);
    if (n < qty) console.info(`Loaded ${n} of ${qty} CU: the hold is full.`);
    economy.syncLoad();
    return n;
  };
  goodsFolder.add({ go: () => (load(goods.qty), save()) }, 'go').name('Load clean');
  goodsFolder
    .add(
      {
        go: () => {
          const n = load(goods.qty);
          if (n > 0) economy.makeHot(goods.good, n, options.region(), goods.heat);
          save();
        },
      },
      'go',
    )
    .name('Load hot (stolen here)');
  goodsFolder.add(goods, 'heat', 0, 5, 0.1).name('Hot heat');
  goodsFolder
    .add(
      {
        go: () => {
          load(holdFree(player.cargo, economy.capacity));
          save();
        },
      },
      'go',
    )
    .name('Fill the hold with it');
  goodsFolder
    .add(
      {
        go: () => {
          player.cargo.length = 0;
          economy.syncLoad();
          save();
        },
      },
      'go',
    )
    .name('Empty the hold');

  // Stores and tools in the lockers.
  const storeNames: Record<string, string> = {};
  for (const item of storeItems()) storeNames[`${item.name} (${item.id})`] = item.id;
  const stores = { id: storeItems()[0]?.id ?? '', qty: 1 };
  const storesFolder = root.addFolder('Stores and tools');
  storesFolder.add(stores, 'id', storeNames).name('Store');
  storesFolder.add(stores, 'qty', 1, 20, 1).name('How many');
  storesFolder
    .add(
      {
        go: () => {
          const n = giveStore(player.stores, stores.id, stores.qty, upgrades());
          if (n < stores.qty) console.info(`Gave ${n}: the lockers hold no more.`);
          save();
        },
      },
      'go',
    )
    .name('Give store');
  storesFolder
    .add({ go: () => (topUpStores(player.stores, upgrades()), save()) }, 'go')
    .name('Top up every store');

  // A hideout's strongbox and shelves.
  const hideoutIds = (): string[] => Object.keys(state.hideouts ?? {});
  // Everything a station makes (crates, kits, the false-light rig, slipway upgrades) and stores.
  const thingIds = [
    ...new Set([
      ...CRAFT_ITEMS.map((i) => i.id),
      ...RECIPES.flatMap((r) => Object.keys(r.output.things ?? {})),
      ...storeItems().map((s) => s.id),
    ]),
  ];
  const thingNames: Record<string, string> = {};
  for (const id of thingIds) thingNames[`${thingName(id)} (${id})`] = id;
  const hideout = { id: hideoutIds()[0] ?? '', thing: thingIds[0] ?? '', qty: 5, dollars: 500 };
  const hideoutFolder = root.addFolder('Hideouts');
  const pick = hideoutFolder.add(hideout, 'id', hideoutIds()).name('Hideout');
  const refreshHideouts = (): void => {
    const ids = hideoutIds();
    pick.options(ids).name('Hideout');
    if (!ids.includes(hideout.id)) hideout.id = ids[0] ?? '';
    pick.updateDisplay();
  };
  hideoutFolder
    .add(
      {
        go: () => {
          const ids = claimEverySite(state);
          console.info(ids.length ? `Claimed ${ids.join(', ')}` : 'Every site is yours already.');
          refreshHideouts();
          save();
        },
      },
      'go',
    )
    .name('Claim every site');
  hideoutFolder.add(hideout, 'thing', thingNames).name('Thing');
  hideoutFolder.add(hideout, 'qty', 1, 50, 1).name('How many');
  hideoutFolder
    .add(
      {
        go: () => {
          const h = state.hideouts?.[hideout.id];
          if (!h) return console.info('Pick a hideout first (or claim every site).');
          h.storage.things ??= {};
          h.storage.things[hideout.thing] = (h.storage.things[hideout.thing] ?? 0) + hideout.qty;
          save();
        },
      },
      'go',
    )
    .name('Put things there');
  hideoutFolder.add(hideout, 'dollars', 0, 100_000, 1).name('Dollars');
  hideoutFolder
    .add(
      {
        go: () => {
          const h = state.hideouts?.[hideout.id];
          if (!h) return console.info('Pick a hideout first (or claim every site).');
          h.storage.cash += Math.max(0, Math.round(hideout.dollars * CENTS));
          save();
        },
      },
      'go',
    )
    .name('Cash into the strongbox');

  // Curios.
  const curioNames: Record<string, string> = {};
  for (const c of curioDefs()) curioNames[`${c.name} (${c.id})`] = c.id;
  const curio = { id: curioDefs()[0]?.id ?? '' };
  const curioFolder = root.addFolder('Curios');
  curioFolder.add(curio, 'id', curioNames).name('Curio');
  const give = (id: string): void => {
    state.curios ??= [];
    giveCurio(state.curios, id, 'dev', state.environment.clock.gameSeconds);
  };
  curioFolder.add({ go: () => (give(curio.id), save()) }, 'go').name('Give curio');
  curioFolder
    .add({ go: () => (curioDefs().forEach((c) => give(c.id)), save()) }, 'go')
    .name('Give every curio');

  // The captain.
  const captain = { fame: state.fame.value };
  const captainFolder = root.addFolder('Captain');
  captainFolder.add({ go: () => ((player.health = 100), save()) }, 'go').name('Heal fully');
  captainFolder
    .add({ go: () => ((player.warmth = { value: 100, wet: 0 }), save()) }, 'go')
    .name('Warm and dry');
  captainFolder.add(captain, 'fame', 0, 1000, 1).name('Fame (Known 150, Legendary 700)');
  captainFolder
    .add({ go: () => ((state.fame.value = captain.fame), save()) }, 'go')
    .name('Set Fame');

  return {
    update() {
      read.purse = `$${(player.purse / CENTS).toFixed(2)}`;
      read.hold = `${holdUsed(player.cargo)} / ${economy.capacity} CU`;
      read.stores =
        Object.entries(player.stores)
          .filter(([, n]) => n > 0)
          .map(([id, n]) => `${id.slice(id.indexOf('.') + 1)} ${n}`)
          .join(', ') || 'none';
    },
  };
}
