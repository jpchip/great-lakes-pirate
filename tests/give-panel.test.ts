import { describe, expect, it } from 'vitest';
import {
  claimEverySite,
  giveMoney,
  giveStore,
  loadGoods,
  topUpStores,
} from '../src/debug/give-panel';
import { storeItems, storeMax } from '../src/sim/economy/chandlery';
import { holdUsed } from '../src/sim/economy/hold';
import { SITES } from '../src/sim/hideouts/stash';
import { createWorldState } from '../src/sim/world-state';

describe('the Give panel', () => {
  it('gives and takes money in dollars, never below nothing', () => {
    const p = { purse: 1000 };
    expect(giveMoney(p, 25)).toBe(3500);
    expect(giveMoney(p, -100)).toBe(0);
  });

  it('loads goods up to the hold limit unless told to overload', () => {
    const hold: ReturnType<typeof createWorldState>['player']['cargo'] = [];
    expect(loadGoods(hold, 40, 'good.whiskey', 30)).toBe(30);
    expect(loadGoods(hold, 40, 'good.whiskey', 30)).toBe(10);
    expect(holdUsed(hold)).toBe(40);
    expect(loadGoods(hold, 40, 'good.furs', 5)).toBe(0);
    expect(loadGoods(hold, 40, 'good.furs', 5, true)).toBe(5);
    expect(holdUsed(hold)).toBe(45);
  });

  it('gives stores up to the locker limit, and tops every one up', () => {
    const item = storeItems()[0];
    if (!item) throw new Error('no stores');
    const stores: Record<string, number> = {};
    expect(giveStore(stores, item.id, 999)).toBe(storeMax(item));
    expect(giveStore(stores, item.id, 1)).toBe(0);
    expect(giveStore(stores, 'store.nothing', 1)).toBe(0);
    topUpStores(stores);
    for (const s of storeItems()) expect(stores[s.id]).toBe(storeMax(s));
  });

  it('claims every hideout site once', () => {
    const state = createWorldState('give');
    const first = claimEverySite(state);
    expect(Object.keys(state.hideouts ?? {})).toHaveLength(SITES.length);
    expect(first.length).toBeGreaterThan(0);
    expect(claimEverySite(state)).toEqual([]);
  });
});
