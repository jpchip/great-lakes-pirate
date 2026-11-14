import { describe, expect, it } from 'vitest';
import bayfieldJson from '../data/districts/bayfield.json';
import { EventBus } from '../src/core/events';
import { attachBackRoom } from '../src/gameplay/back-room';
import { attachCaptain } from '../src/gameplay/captain';
import { createGameWorld } from '../src/gameplay/ecs';
import { attachEconomy } from '../src/gameplay/economy';
import { attachLaw } from '../src/gameplay/law';
import { keeperSpot, keeperType, SHOP_TABS, shopPrompt } from '../src/gameplay/onfoot/shops';
import { gameTools } from '../src/gameplay/onfoot/tools';
import { attachPorts } from '../src/gameplay/port';
import { attachPortLaw } from '../src/gameplay/port-law';
import { createSchooner } from '../src/gameplay/schooner';
import { attachShipyard } from '../src/gameplay/shipyard';
import type { GameContext, GameEvents } from '../src/modes/context';
import {
  createFirstWeek,
  firstWeekComplete,
  FIRST_WEEK_STEPS,
} from '../src/sim/character/first-week';
import { CELL_M } from '../src/sim/district/kit';
import { parseLayout } from '../src/sim/district/layout';
import { gameEconomy } from '../src/sim/economy/defs';
import { fenceAt } from '../src/sim/economy/fence';
import type { CargoStack } from '../src/sim/economy/hold';
import { gameLaw } from '../src/sim/law/defs';
import { createWorldState } from '../src/sim/world-state';
import type { PortSnapshot } from '../src/ui/port/model';

/**
 * Phase 7 piece F, part one (plan 08 §20.4): the counters you trade at on foot. A shop's
 * mark opens its tab in its hours, the saloon's bar sells a bottle, and the back room's
 * table is the 0.6.0 fence and shipwright, after dark, on the same numbers (§20.3 #8).
 */

const layout = parseLayout(structuredClone(bayfieldJson));
const rules = gameTools().file;
const defs = gameEconomy();
const NIGHT = 23 * 3600;
const NOON = 12 * 3600;
const mark = (id: string) => {
  const m = layout.marks.find((k) => k.id === id);
  if (!m) throw new Error(`no mark ${id}`);
  return m;
};
const at = (hour: number, backRoomOpen = false) => ({
  hour,
  backRoomOpen,
  fenceName: fenceAt('port.bayfield')?.name,
});

describe("Bayfield's counters (the layout's shop marks)", () => {
  const shops = layout.marks.filter((m) => m.kind === 'shop');

  it('has the bar, the back room, the chandlery, the store and the harbor office', () => {
    expect(shops.map((m) => m.id).sort()).toEqual([
      'shop.back_room',
      'shop.chandlery',
      'shop.general_store',
      'shop.harbor_office',
      'shop.saloon_bar',
    ]);
  });

  it('stands every one inside the building it belongs to', () => {
    for (const m of shops) {
      const b = layout.buildings.find((k) => k.id === m.ref);
      expect(b, m.id).toBeDefined();
      if (!b) continue;
      const x0 = layout.bounds.x0 + b.col * CELL_M;
      const z0 = layout.bounds.z0 + b.row * CELL_M;
      expect(m.x).toBeGreaterThan(x0);
      expect(m.x).toBeLessThan(x0 + b.cols * CELL_M);
      expect(m.z).toBeGreaterThan(z0);
      expect(m.z).toBeLessThan(z0 + b.rows * CELL_M);
      expect(m.opens && SHOP_TABS[m.opens]).toBeTruthy();
    }
  });

  it('stands a keeper across each counter, inside the same building and facing you', () => {
    for (const m of shops) {
      const b = layout.buildings.find((k) => k.id === m.ref);
      if (!b) continue;
      const k = keeperSpot(m);
      const x0 = layout.bounds.x0 + b.col * CELL_M;
      const z0 = layout.bounds.z0 + b.row * CELL_M;
      expect(k.x, m.id).toBeGreaterThan(x0 + 0.4);
      expect(k.x, m.id).toBeLessThan(x0 + b.cols * CELL_M - 0.4);
      expect(k.z, m.id).toBeGreaterThan(z0 + 0.4);
      expect(k.z, m.id).toBeLessThan(z0 + b.rows * CELL_M - 0.4);
      // He looks back along the line to where you stand.
      const toYou = Math.atan2(m.x - k.x, -(m.z - k.z));
      expect(Math.cos(toYou - k.heading)).toBeCloseTo(1, 5);
    }
    expect(keeperType(mark('shop.back_room'))).toBe('npc.fence');
    expect(keeperType(mark('shop.saloon_bar'))).toBe('npc.shopkeeper');
    // The fence keeps to the back room's side of the partition (z = 16).
    expect(keeperSpot(mark('shop.back_room')).z).toBeGreaterThan(16.5);
  });

  it('puts the back room behind the partition, out of reach of the bar', () => {
    const bar = mark('shop.saloon_bar');
    const back = mark('shop.back_room');
    expect(Math.hypot(bar.x - back.x, bar.z - back.z)).toBeGreaterThan(5);
  });
});

describe('what F does at a counter', () => {
  it('opens a shop in its hours and not outside them', () => {
    const store = mark('shop.general_store');
    expect(shopPrompt(layout.buildings, store, rules, at(10))).toEqual({
      text: 'Trade at Booth & Sons General Store',
      tab: 'market',
      title: 'Booth & Sons General Store',
    });
    expect(shopPrompt(layout.buildings, store, rules, at(20))).toBeUndefined();
    expect(shopPrompt(layout.buildings, mark('shop.chandlery'), rules, at(8))?.tab).toBe(
      'chandlery',
    );
    expect(shopPrompt(layout.buildings, mark('shop.harbor_office'), rules, at(9))).toMatchObject({
      tab: 'freight',
      text: 'See the freight agent',
    });
    expect(shopPrompt(layout.buildings, mark('shop.harbor_office'), rules, at(18))).toBeUndefined();
  });

  it('keeps the bar open into the small hours', () => {
    const bar = mark('shop.saloon_bar');
    expect(shopPrompt(layout.buildings, bar, rules, at(23))).toMatchObject({
      text: 'Stand at the bar',
      tab: 'saloon',
      title: 'Lake Superior Saloon',
    });
    expect(shopPrompt(layout.buildings, bar, rules, at(0.5))?.tab).toBe('saloon');
    expect(shopPrompt(layout.buildings, bar, rules, at(4))).toBeUndefined();
  });

  it('finds the fence at his table only when the back room is open', () => {
    const back = mark('shop.back_room');
    expect(shopPrompt(layout.buildings, back, rules, at(12, false))).toBeUndefined();
    expect(shopPrompt(layout.buildings, back, rules, at(23, true))).toEqual({
      text: 'Deal with Nils Okerlund',
      tab: 'backRoom',
      title: 'Lake Superior Saloon: the back room',
    });
    // Dark at four, but the saloon shut at one.
    expect(shopPrompt(layout.buildings, back, rules, at(4, true))).toBeUndefined();
  });

  it('does nothing at a mark that is not a shop', () => {
    expect(shopPrompt(layout.buildings, mark('crowd.0'), rules, at(12, true))).toBeUndefined();
  });
});

const hot = (good: string, qty: number): CargoStack => ({
  good,
  qty,
  hot: {
    region: 'region.apostles',
    heat: 1,
    traceability: defs.goods.get(good)?.traceability ?? 0,
    since: NIGHT,
  },
});

/** The port screen with the back room, walked into (`walkIn`) or on its 0.6.0 tab. */
function game(atSeconds: number, walkIn: boolean) {
  const state = createWorldState('shops', atSeconds);
  const ctx = {
    state,
    world: createGameWorld(),
    events: new EventBus<GameEvents>(),
  } as unknown as GameContext;
  const schooner = createSchooner(0, 0, 0);
  const economy = attachEconomy(ctx, schooner.hazards);
  const shipyard = attachShipyard({
    ctx,
    economy,
    sailing: schooner.sailing,
    hazards: schooner.hazards,
    buoyancy: schooner.buoyancy,
    handling: schooner.handling,
    rules: schooner.hazardRules,
    onHullChanged: () => undefined,
    fameTier: () => 0,
  });
  const law = attachLaw(ctx, 'seed', gameLaw());
  const portLaw = attachPortLaw(ctx, law, economy);
  const backRoom = attachBackRoom({ ctx, economy, shipyard });
  const shown: (PortSnapshot | undefined)[] = [];
  let castOffs = 0;
  let opens = 0;
  const ports = attachPorts({
    ctx,
    economy,
    hazards: schooner.hazards,
    shipyard,
    law: portLaw,
    backRoom,
    rumors: undefined,
    ...(walkIn ? { walkInBackRoom: (port: string) => port === 'port.bayfield' } : {}),
    berthPier: () => undefined,
    ashore: { offered: () => true },
    showPort: (s) => shown.push(s),
    showJournal: () => undefined,
    onOpen: (open) => (opens += open ? 1 : -1),
    castOff: () => castOffs++,
  });
  return {
    state,
    ctx,
    ports,
    shown,
    last: () => shown.at(-1),
    castOffs: () => castOffs,
    opens: () => opens,
  };
}

describe('the back room walked into (§20.3 #8)', () => {
  it("is off Bayfield's port screen at night, with a word on where it is", () => {
    const g = game(NIGHT, true);
    g.ports.open('port.bayfield');
    expect(g.last()?.tabs).not.toContain('backRoom');
    expect(g.last()?.backRoom).toBeUndefined();
    expect(g.last()?.backRoomHint).toMatch(/open tonight.*ashore/i);
    const day = game(NOON, true);
    day.ports.open('port.bayfield');
    expect(day.last()?.backRoomHint).toMatch(/after dark.*ashore/i);
  });

  it('keeps the tab where no district is built', () => {
    const g = game(NIGHT, true);
    g.state.fame.value = 200;
    g.ports.open('port.duluth');
    expect(g.last()?.tabs).toContain('backRoom');
  });

  it("shows at the table what 0.6.0's tab showed: the same lots, rates and gear", () => {
    const tab = game(NIGHT, false);
    tab.state.player.cargo = [hot('good.furs', 4), hot('good.copper', 2)];
    tab.ports.open('port.bayfield');
    const walked = game(NIGHT, true);
    walked.state.player.cargo = [hot('good.furs', 4), hot('good.copper', 2)];
    expect(walked.ports.openShop('port.bayfield', 'backRoom', 'The back room')).toBeUndefined();
    const snap = walked.last();
    expect(snap?.tabs).toEqual(['backRoom']);
    expect(snap?.shop).toEqual({ title: 'The back room' });
    expect(snap?.canGoAshore).toBeUndefined();
    expect(snap?.canWait).toBeUndefined();
    expect(snap?.backRoom).toEqual(tab.last()?.backRoom);
    expect(snap?.backRoom?.lots.length).toBe(2);
    expect(walked.ports.openShopTab).toBe('backRoom');
  });

  it('sells to the fence for the same money as the tab did', () => {
    const tab = game(NIGHT, false);
    tab.state.player.cargo = [hot('good.furs', 4)];
    tab.ports.open('port.bayfield');
    tab.ports.actions.fence?.(0, 4);
    const walked = game(NIGHT, true);
    walked.state.player.cargo = [hot('good.furs', 4)];
    walked.ports.openShop('port.bayfield', 'backRoom', 'The back room');
    expect(walked.ports.actions.fence?.(0, 4)).toMatch(/counts out/);
    expect(walked.state.player.purse).toBe(tab.state.player.purse);
    expect(walked.state.player.cargo).toHaveLength(0);
    // The screen is still his table after the sale.
    expect(walked.last()?.tabs).toEqual(['backRoom']);
  });

  it('finds nobody at the table by day', () => {
    const g = game(NOON, true);
    expect(g.ports.openShop('port.bayfield', 'backRoom', 'The back room')).toMatch(/Nobody/);
    expect(g.ports.openPort).toBeUndefined();
    expect(g.opens()).toBe(0);
  });

  it('leaves on F without casting off, and the port screen is whole again after', () => {
    const g = game(NIGHT, true);
    g.ports.openShop('port.bayfield', 'backRoom', 'The back room');
    expect(g.opens()).toBe(1);
    g.ports.actions.castOff();
    expect(g.castOffs()).toBe(0);
    expect(g.ports.openPort).toBeUndefined();
    expect(g.opens()).toBe(0);
    g.ports.open('port.bayfield');
    expect(g.last()?.shop).toBeUndefined();
    expect(g.last()?.tabs).toContain('market');
    expect(g.last()?.canGoAshore).toBe(true);
    g.ports.actions.castOff();
    expect(g.castOffs()).toBe(1);
  });
});

describe('a shop counter by day', () => {
  it('opens the one tab under the name over the door', () => {
    const g = game(NOON, true);
    expect(
      g.ports.openShop('port.bayfield', 'market', 'Booth & Sons General Store'),
    ).toBeUndefined();
    expect(g.last()?.tabs).toEqual(['market']);
    expect(g.last()?.shop?.title).toBe('Booth & Sons General Store');
    expect(g.last()?.market.length).toBeGreaterThan(0);
  });

  it('sells a bottle of whiskey over the chandlery counter', () => {
    const g = game(NOON, true);
    g.state.player.purse = 1000;
    g.ports.openShop('port.bayfield', 'chandlery', 'Halvorsen Chandlery');
    const before = g.state.player.stores['store.whiskey'] ?? 0;
    expect(g.ports.actions.buyStores('store.whiskey', 1)).toBeUndefined();
    expect(g.state.player.stores['store.whiskey']).toBe(before + 1);
    expect(g.last()?.stores.find((r) => r.id === 'store.whiskey')?.have).toBe(before + 1);
  });

  it("won't open over a screen that's already up", () => {
    const g = game(NOON, true);
    g.ports.open('port.bayfield');
    expect(g.ports.openShop('port.bayfield', 'market', 'x')).toBe('Not now');
  });
});

describe("the First Week's sixth step (plan 12 §3)", () => {
  it('ticks the warehouse off on a burglary, and is never needed', () => {
    const state = createWorldState('first-week', NOON);
    state.firstWeek = createFirstWeek();
    const ctx = { state, world: createGameWorld(), events: new EventBus<GameEvents>() };
    const captain = attachCaptain(ctx as unknown as GameContext, defs, () => undefined);
    const lines = () => captain.firstWeek()?.lines ?? [];
    expect(lines().find((l) => l.step === 'warehouse')).toMatchObject({
      done: false,
      optional: true,
    });
    ctx.events.emit('CrimeCommitted', {
      crimeId: 'c1',
      crime: 'crime.burglary',
      region: 'region.chequamegon',
      port: 'port.bayfield',
      witnesses: 1,
      at: NOON,
    });
    expect(lines().find((l) => l.step === 'warehouse')?.done).toBe(true);
    expect(firstWeekComplete(state.firstWeek)).toBe(false);
    state.firstWeek.done = [...FIRST_WEEK_STEPS];
    expect(firstWeekComplete(state.firstWeek)).toBe(true);
  });
});
