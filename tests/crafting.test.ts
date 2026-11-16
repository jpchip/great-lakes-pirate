/* eslint-disable @typescript-eslint/no-non-null-assertion -- lookups of things just made */
import { describe, expect, it } from 'vitest';
import goodsJson from '../data/goods.json';
import locksJson from '../data/locks.json';
import { SECONDS_PER_GAME_DAY } from '../src/core/time';
import { chargesAvailable, spendCharges } from '../src/sim/combat/armament';
import { gameCombat } from '../src/sim/combat/defs';
import { buyStores, storeItems, storeMax } from '../src/sim/economy/chandlery';
import { gameEconomy } from '../src/sim/economy/defs';
import { holdUsed, type CargoStack, type Hold } from '../src/sim/economy/hold';
import {
  builtStations,
  craft,
  craftRefusal,
  CRAFT_ITEMS,
  maxBatches,
  RECIPES,
  recipeDef,
  settleProduction,
  stashThing,
  STATIONS,
  takeThing,
  thingName,
  withWorkshop,
} from '../src/sim/hideouts/crafting';
import { packGrid, unpackGrid } from '../src/sim/hideouts/grid';
import { starterLayout, storageCapacity, type HideoutState } from '../src/sim/hideouts/stash';
import { STRUCTURES, structure } from '../src/sim/hideouts/structures';
import { CREW_FACTOR } from '../src/sim/hideouts/work';
import { upgradeDef } from '../src/sim/shipyard/fit';
import { defaultShipState, useKit } from '../src/sim/shipyard/shipyard';
import { createWorldState, parseWorldState } from '../src/sim/world-state';
import { stashSnapshot } from '../src/ui/stash/model';

const GOODS = new Set((goodsJson as { id: string }[]).map((g) => g.id));

/** Stockton's starter shack (40 CU, a strongbox) with the workshop beside it. */
function hideout(goods: CargoStack[] = [], things: Record<string, number> = {}): HideoutState {
  return {
    siteId: 'site.stockton',
    claimedAt: 0,
    storage: { goods, cash: 0, things },
    layout: withWorkshop(starterLayout('site.stockton')),
  };
}

const bare = (): HideoutState => ({
  siteId: 'site.stockton',
  claimedAt: 0,
  storage: { goods: [], cash: 0 },
  layout: starterLayout('site.stockton'),
});

const lot = (good: string, qty: number, extra: Partial<CargoStack> = {}): CargoStack => ({
  good,
  qty,
  ...extra,
});

const opts = { crewTier: 1, gameSeconds: 0 };

describe('crafting data', () => {
  it('has the four Phase 8 stations, each a piece that names it', () => {
    expect(STATIONS.map((s) => s.id)).toEqual([
      'station.workbench',
      'station.smithy',
      'station.cooperage',
      'station.distillery',
    ]);
    for (const st of STATIONS) expect(structure(st.piece).functions.station).toBe(st.id);
    const stationPieces = STRUCTURES.filter((s) => s.functions.station);
    expect(stationPieces.map((s) => s.functions.station).sort()).toEqual(
      STATIONS.map((s) => s.id).sort(),
    );
  });

  it('has twelve or more recipes, every one at a station and made of things that exist', () => {
    expect(RECIPES.length).toBeGreaterThanOrEqual(12);
    const stations = new Set(STATIONS.map((s) => s.id));
    const items = new Set(CRAFT_ITEMS.map((i) => i.id));
    const stores = new Set(storeItems().map((s) => s.id));
    const thingExists = (id: string): boolean =>
      id.startsWith('store.')
        ? stores.has(id)
        : id.startsWith('upgrade.')
          ? !!upgradeDef(id)
          : items.has(id);
    for (const r of RECIPES) {
      expect(stations, r.id).toContain(r.station);
      for (const g of [
        ...Object.keys(r.inputs.goods ?? {}),
        ...Object.keys(r.output.goods ?? {}),
      ]) {
        expect(GOODS, `${r.id} ${g}`).toContain(g);
      }
      for (const t of [
        ...Object.keys(r.inputs.things ?? {}),
        ...Object.keys(r.output.things ?? {}),
      ]) {
        expect(thingExists(t), `${r.id} ${t}`).toBe(true);
      }
    }
  });

  it("covers §16.2's list: kits, shot, picks, crowbar, crates, barrels, re-crating, the rig, whiskey, two upgrades", () => {
    const made = new Set(
      RECIPES.flatMap((r) => [
        ...Object.keys(r.output.goods ?? {}),
        ...Object.keys(r.output.things ?? {}),
      ]),
    );
    for (const id of [
      'store.patch_kit',
      'store.mend_kit',
      'good.powder_shot',
      'store.lockpicks',
      'store.crowbar',
      'item.crate',
      'item.barrel',
      'item.false_light',
      'good.untaxed_whiskey',
      'upgrade.improved_carriages',
      'upgrade.repair_stores',
    ]) {
      expect(made, id).toContain(id);
    }
    expect(RECIPES.some((r) => r.recrate)).toBe(true);
    expect(upgradeDef('upgrade.improved_carriages')!.sources).toContain('hideout');
    expect(upgradeDef('upgrade.repair_stores')!.sources).toEqual(['hideout']);
  });

  it('names every thing', () => {
    expect(thingName('store.patch_kit')).toBe('Patch kit');
    expect(thingName('item.false_light')).toBe('False-light rig');
    expect(thingName('upgrade.improved_carriages')).toBe('Improved carriages');
  });
});

describe('stations', () => {
  it('needs the station built: the starter shack has none', () => {
    const h = bare();
    expect(builtStations(h).size).toBe(0);
    expect(craftRefusal(h, 'recipe.patch_kits', 1, [[lot('good.lumber', 5)]])).toBe('noStation');
  });

  it("doesn't count a ghost", () => {
    const h = hideout();
    const grid = unpackGrid(h.layout);
    const bench = grid.all().find((p) => p.piece.id === 'build.workbench')!;
    grid.setBuilt(bench.uid, false);
    h.layout = packGrid(grid);
    expect(builtStations(h).has('station.workbench')).toBe(false);
    expect(builtStations(h).has('station.smithy')).toBe(true);
  });

  it('keeps the shack whole beside the workshop', () => {
    const h = hideout();
    expect(storageCapacity(h)).toBe(40);
    expect([...builtStations(h)].sort()).toEqual(STATIONS.map((s) => s.id).sort());
  });
});

describe('crafting at an active station', () => {
  it('takes goods from the storage first, then the hold, and keeps what it makes here', () => {
    const h = hideout([lot('good.lumber', 1), lot('good.rope_canvas', 1)]);
    const hold: Hold = [lot('good.lumber', 3), lot('good.rope_canvas', 3)];
    const r = craft(h, 'recipe.patch_kits', 2, [h.storage.goods, hold], opts);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(h.storage.goods).toEqual([]);
    expect(hold).toEqual([lot('good.lumber', 2), lot('good.rope_canvas', 2)]);
    expect(h.storage.things).toEqual({ 'store.patch_kit': 8 });
    expect(r.seconds).toBe(2 * 3600);
  });

  it('works faster with a crew', () => {
    const h = hideout([lot('good.hardware', 3), lot('good.lumber', 2)]);
    const r = craft(h, 'recipe.improved_carriages', 1, [h.storage.goods], {
      crewTier: 3,
      gameSeconds: 0,
    });
    expect(r.ok && r.seconds).toBe(8 * 3600 * CREW_FACTOR[3]!);
    expect(h.storage.things).toEqual({ 'upgrade.improved_carriages': 1 });
  });

  it('never uses contract cargo, and is all or nothing', () => {
    const h = hideout([lot('good.hardware', 2, { contract: 'c1' })]);
    expect(craft(h, 'recipe.lockpicks', 1, [h.storage.goods], opts)).toEqual({
      ok: false,
      reason: 'noGoods',
    });
    expect(h.storage.goods[0]!.qty).toBe(2);
  });

  it('needs room in the storage for goods it makes, counting what it uses up', () => {
    const filler = lot('good.salt', 38);
    const h = hideout([filler, lot('good.hardware', 1), lot('good.coal', 1)]);
    // 40 CU full: the hardware and coal leave, a keg comes in.
    expect(craftRefusal(h, 'recipe.shot', 1, [h.storage.goods])).toBeUndefined();
    const h2 = hideout([lot('good.salt', 40)]);
    expect(
      craftRefusal(h2, 'recipe.shot', 1, [
        h2.storage.goods,
        [lot('good.hardware', 1), lot('good.coal', 1)],
      ]),
    ).toBe('noRoom');
  });

  it('counts how many batches can be made', () => {
    const h = hideout([lot('good.hardware', 5)]);
    expect(maxBatches(h, 'recipe.lockpicks', [h.storage.goods])).toBe(5);
    expect(maxBatches(h, 'recipe.false_light', [h.storage.goods])).toBe(0);
  });

  it('makes salt fish from fresh with barrels from the cooperage', () => {
    const h = hideout([lot('good.lumber', 2), lot('good.hardware', 1)]);
    expect(craft(h, 'recipe.barrels', 1, [h.storage.goods], opts).ok).toBe(true);
    expect(h.storage.things).toEqual({ 'item.barrel': 8 });
    const hold: Hold = [lot('good.fresh_fish', 4), lot('good.salt', 2)];
    expect(craft(h, 'recipe.salt_fish', 2, [h.storage.goods, hold], opts).ok).toBe(true);
    expect(h.storage.things).toEqual({ 'item.barrel': 4 });
    expect(h.storage.goods).toEqual([lot('good.salted_fish', 6)]);
    expect(hold).toEqual([]);
  });

  it('stores the false-light rig as an item for Phase 9', () => {
    const h = hideout([lot('good.hardware', 1), lot('good.kerosene', 1), lot('good.lumber', 1)]);
    expect(craft(h, 'recipe.false_light', 1, [h.storage.goods], opts).ok).toBe(true);
    expect(h.storage.things).toEqual({ 'item.false_light': 1 });
    expect(takeThing(h, { stores: {} }, 'item.false_light', 1)).toEqual({
      ok: false,
      reason: 'notStore',
    });
  });
});

describe('re-crating hot goods', () => {
  const hot = {
    region: 'region.apostles',
    heat: 0.9,
    traceability: 0.8,
    since: 100,
    owner: 'company.northern_range',
  };

  it('takes the marks off a load per crate, keeping the theft', () => {
    const h = hideout([lot('good.copper', 3, { hot, paidCents: 300 })], { 'item.crate': 2 });
    const r = craft(h, 'recipe.recrate', 2, [h.storage.goods], { ...opts, stackIndex: 0 });
    expect(r.ok && r.seconds).toBe(3600);
    expect(h.storage.goods).toEqual([
      lot('good.copper', 1, { hot, paidCents: 100 }),
      lot('good.copper', 2, {
        hot: { region: 'region.apostles', heat: 0.9, traceability: 0, since: 100 },
        paidCents: 200,
      }),
    ]);
    expect(h.storage.things).toEqual({});
    // Nothing left to take off a re-crated lot.
    h.storage.things = { 'item.crate': 1 };
    expect(craftRefusal(h, 'recipe.recrate', 1, [h.storage.goods], { stackIndex: 1 })).toBe(
      'noHot',
    );
  });

  it('refuses clean goods and wants a crate', () => {
    const h = hideout([lot('good.copper', 3), lot('good.furs', 2, { hot })]);
    expect(craftRefusal(h, 'recipe.recrate', 1, [h.storage.goods], { stackIndex: 0 })).toBe(
      'noHot',
    );
    expect(craftRefusal(h, 'recipe.recrate', 1, [h.storage.goods], { stackIndex: 1 })).toBe(
      'noThings',
    );
    h.storage.things = { 'item.crate': 9 };
    expect(maxBatches(h, 'recipe.recrate', [h.storage.goods], { stackIndex: 1 })).toBe(2);
  });

  it('shows the button on hot lots in the shed only when the cooperage can do it', () => {
    const h = hideout([lot('good.copper', 3), lot('good.furs', 2, { hot })], { 'item.crate': 1 });
    const snap = stashSnapshot({
      defs: gameEconomy(),
      hideoutId: 'hideout.stockton',
      hideout: h,
      player: { purse: 0, cargo: [] },
      holdCapacity: 20,
      gameSeconds: 0,
      lieRefusal: undefined,
    });
    expect(snap.stash.map((r) => r.recrate)).toEqual([0, 1]);
  });
});

describe('the still (passive production)', () => {
  const WEEK = SECONDS_PER_GAME_DAY;
  const mash = (): CargoStack[] => [lot('good.grain', 12)];

  it('wants water: a well or a rain barrel', () => {
    const h = hideout(mash(), { 'item.barrel': 4 });
    const grid = unpackGrid(h.layout);
    grid.remove(grid.all().find((p) => p.piece.id === 'build.well')!.uid);
    h.layout = packGrid(grid);
    expect(craftRefusal(h, 'recipe.whiskey', 1, [h.storage.goods])).toBe('noWater');
  });

  it('has whiskey waiting after a voyage, and never more than one batch a week', () => {
    const h = hideout(mash(), { 'item.barrel': 16 });
    const r = craft(h, 'recipe.whiskey', 4, [h.storage.goods], { ...opts, gameSeconds: 1000 });
    expect(r.ok && r.seconds).toBe(0);
    expect(h.storage.goods).toEqual([]);
    expect(h.stations!['station.distillery']!.queue.map((b) => b.readyAt)).toEqual([
      1000 + WEEK,
      1000 + 2 * WEEK,
      1000 + 3 * WEEK,
      1000 + 4 * WEEK,
    ]);
    // Away two and a half weeks: two batches have run off.
    const done = settleProduction(h, 1000 + 2.5 * WEEK);
    expect(done.map((d) => d.recipe)).toEqual(['recipe.whiskey', 'recipe.whiskey']);
    expect(h.storage.goods).toEqual([lot('good.untaxed_whiskey', 8)]);
    expect(settleProduction(h, 1000 + 2.9 * WEEK)).toEqual([]);
    // Away for months: the rest, and no more.
    settleProduction(h, 1000 + 20 * WEEK);
    expect(h.storage.goods).toEqual([lot('good.untaxed_whiskey', 16)]);
    expect(h.stations!['station.distillery']).toBeUndefined();
  });

  it('caps a week whatever the time skip: 52 weeks of loading make 4 batches at most', () => {
    const h = hideout([lot('good.grain', 30)], { 'item.barrel': 40 });
    expect(craftRefusal(h, 'recipe.whiskey', 5, [h.storage.goods])).toBe('queueFull');
    craft(h, 'recipe.whiskey', 4, [h.storage.goods], opts);
    expect(craftRefusal(h, 'recipe.whiskey', 1, [h.storage.goods])).toBe('queueFull');
    settleProduction(h, 52 * WEEK);
    expect(h.storage.goods.find((s) => s.good === 'good.untaxed_whiskey')!.qty).toBe(16);
  });

  it('chains a batch loaded later behind the ones in the still', () => {
    const h = hideout(mash(), { 'item.barrel': 8 });
    craft(h, 'recipe.whiskey', 1, [h.storage.goods], opts);
    craft(h, 'recipe.whiskey', 1, [h.storage.goods], { ...opts, gameSeconds: 0.5 * WEEK });
    expect(h.stations!['station.distillery']!.queue.map((b) => b.readyAt)).toEqual([
      WEEK,
      2 * WEEK,
    ]);
  });

  it('waits in the still for room in the storage', () => {
    const h = hideout([lot('good.grain', 3), lot('good.salt', 37)], { 'item.barrel': 4 });
    craft(h, 'recipe.whiskey', 1, [h.storage.goods], opts);
    expect(holdUsed(h.storage.goods)).toBe(37);
    expect(settleProduction(h, 2 * WEEK)).toEqual([]);
    h.storage.goods[0]!.qty = 30;
    expect(settleProduction(h, 2 * WEEK)).toHaveLength(1);
    expect(holdUsed(h.storage.goods)).toBe(34);
  });
});

describe('crafted things work where bought ones do (criterion 9)', () => {
  it('a crafted patch kit patches', () => {
    const h = hideout([lot('good.lumber', 1), lot('good.rope_canvas', 1)]);
    craft(h, 'recipe.patch_kits', 1, [h.storage.goods], opts);
    const owner = { purse: 0, cargo: [] as Hold, stores: {} as Record<string, number> };
    expect(takeThing(h, owner, 'store.patch_kit', 4)).toEqual({
      ok: true,
      id: 'store.patch_kit',
      qty: 4,
    });
    const ship = { ...defaultShipState(), hull01: 0.3 };
    expect(useKit(owner, ship, 'store.patch_kit').ok).toBe(true);
    expect(ship.hull01).toBeGreaterThan(0.3);
    expect(owner.stores['store.patch_kit']).toBe(3);
  });

  it('crafted shot fires', () => {
    const defs = gameCombat();
    const h = hideout([lot('good.hardware', 1), lot('good.coal', 1)]);
    craft(h, 'recipe.shot', 1, [h.storage.goods], opts);
    const hold: Hold = [h.storage.goods.shift()!];
    const ammo = { charges: 0 };
    expect(hold[0]!.good).toBe(defs.powder.good);
    expect(chargesAvailable(defs, hold, ammo)).toBe(10);
    expect(spendCharges(defs, hold, ammo, 3)).toBe(true);
  });

  it('crafted picks are the picks a lock wants', () => {
    const h = hideout([lot('good.hardware', 1)]);
    craft(h, 'recipe.lockpicks', 1, [h.storage.goods], opts);
    const owner = { stores: {} as Record<string, number> };
    takeThing(h, owner, 'store.lockpicks', 6);
    expect(owner.stores[locksJson.picks]).toBe(6);
  });
});

describe('the lockers', () => {
  it('take only as many as they hold, and leave the rest here', () => {
    const h = hideout([], { 'store.patch_kit': 10 });
    const owner = { stores: { 'store.patch_kit': 2 } as Record<string, number> };
    expect(takeThing(h, owner, 'store.patch_kit', 10)).toEqual({
      ok: true,
      id: 'store.patch_kit',
      qty: 4,
    });
    expect(h.storage.things).toEqual({ 'store.patch_kit': 6 });
    expect(takeThing(h, owner, 'store.patch_kit', 1)).toEqual({ ok: false, reason: 'lockersFull' });
    expect(stashThing(h, owner, 'store.patch_kit', 3).ok).toBe(true);
    expect(owner.stores['store.patch_kit']).toBe(3);
    expect(h.storage.things).toEqual({ 'store.patch_kit': 9 });
  });

  it('repair stores make room for four more of each kit, at the chandlery too', () => {
    const kit = storeItems().find((s) => s.id === 'store.patch_kit')!;
    const oil = storeItems().find((s) => s.id === 'store.lamp_oil')!;
    expect(storeMax(kit, ['upgrade.repair_stores'])).toBe(kit.max + 4);
    expect(storeMax(oil, ['upgrade.repair_stores'])).toBe(oil.max);
    const h = hideout([], { 'store.patch_kit': 20 });
    const ship = { ...defaultShipState(), upgrades: ['upgrade.repair_stores'] };
    const owner = { stores: {} as Record<string, number>, ship };
    expect(takeThing(h, owner, 'store.patch_kit', 20)).toMatchObject({ qty: kit.max + 4 });
    const trader = { purse: 100_000, stores: { 'store.mend_kit': 6 }, ship };
    expect(buyStores(gameEconomy(), trader, 'port.bayfield', 'store.mend_kit', 4).ok).toBe(true);
    expect(buyStores(gameEconomy(), trader, 'port.bayfield', 'store.mend_kit', 1).ok).toBe(false);
  });
});

describe('saves', () => {
  it('round-trips things and the still', () => {
    const state = createWorldState('craft');
    const h = state.hideouts!['hideout.stockton']!;
    h.layout = withWorkshop(h.layout);
    h.storage.goods.push(lot('good.grain', 3));
    h.storage.things = { 'item.barrel': 4, 'store.crowbar': 2 };
    expect(craft(h, 'recipe.whiskey', 1, [h.storage.goods], opts).ok).toBe(true);
    const back = parseWorldState(JSON.parse(JSON.stringify(state)));
    expect(back.hideouts).toEqual(state.hideouts);
    expect(back.hideouts!['hideout.stockton']!.stations!['station.distillery']!.queue).toHaveLength(
      1,
    );
  });

  it('loads a hideout from before crafting', () => {
    const state = createWorldState('old');
    const h = state.hideouts!['hideout.stockton']!;
    expect(h.storage.things).toBeUndefined();
    expect(h.stations).toBeUndefined();
    expect(recipeDef('recipe.patch_kits')).toBeDefined();
    expect(craftRefusal(h, 'recipe.patch_kits', 1, [h.storage.goods])).toBe('noStation');
  });
});
