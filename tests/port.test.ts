import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { EventBus } from '../src/core/events';
import { InputMapper } from '../src/core/input';
import { migrateSave } from '../src/core/save/migrate';
import { SECONDS_PER_GAME_DAY } from '../src/core/time';
import { attachEconomy } from '../src/gameplay/economy';
import { attachPorts } from '../src/gameplay/port';
import { createSchooner } from '../src/gameplay/schooner';
import type { GameContext, GameEvents } from '../src/modes/context';
import {
  buyStores,
  storeItems,
  storePriceCents,
  type ShipStores,
} from '../src/sim/economy/chandlery';
import { gameEconomy, portInfo } from '../src/sim/economy/defs';
import {
  ageText,
  bestKnownPurchase,
  bestKnownSale,
  formatCents,
  recordPrices,
  type PriceKnowledge,
} from '../src/sim/economy/knowledge';
import { unitPrices } from '../src/sim/economy/market';
import { HARBORS, pierPort } from '../src/sim/harbors';
import { parseWorldState, createWorldState } from '../src/sim/world-state';
import { ledgerSnapshot, portSnapshot, type PortSnapshot } from '../src/ui/port/model';

/** Phase 4 piece B: the port screen, trade, price knowledge, the chandlery and the ledger. */

const must = <T>(v: T | undefined): T => {
  if (v === undefined) throw new Error('missing');
  return v;
};

describe('piers and their ports', () => {
  it('gives every berthed pier the port of its set piece, with a market', () => {
    for (const h of HARBORS) {
      for (const p of h.piers) {
        const port = pierPort(p.id);
        expect(port, p.id).toBeDefined();
        expect(portInfo(must(port))?.services, p.id).toContain('market');
      }
    }
    expect(pierPort('pier.bayfield_fish')).toBe('port.bayfield');
    expect(pierPort('pier.la_pointe_city')).toBe('port.la_pointe');
    expect(pierPort('pier.test_bay')).toBeUndefined();
  });

  it('lists a chandlery at every port but La Pointe', () => {
    for (const port of gameEconomy().markets.keys()) {
      const has = portInfo(port)?.services.includes('chandlery');
      expect(has, port).toBe(port !== 'port.la_pointe');
    }
  });
});

describe('price knowledge (plan 05 §4.3)', () => {
  const defs = gameEconomy();

  it('writes down every price at a market, as the trade screen lists them', () => {
    const state = createWorldState('knowledge');
    const k: PriceKnowledge = {};
    recordPrices(k, defs, state.markets, 'port.bayfield', 1000);
    const book = must(k['port.bayfield']);
    expect(Object.keys(book).sort()).toEqual(
      [...must(defs.markets.get('port.bayfield')).goods.keys()].sort(),
    );
    const now = must(unitPrices(defs, state.markets, 'port.bayfield', 'good.flour', 1000));
    expect(book['good.flour']).toEqual({
      buyCents: now.buyCents,
      sellCents: now.sellCents,
      seenAt: 1000,
    });
  });

  it('finds the best sale and the cheapest purchase elsewhere', () => {
    const k: PriceKnowledge = {
      'port.duluth': { 'good.flour': { buyCents: 900, sellCents: 820, seenAt: 0 } },
      'port.ashland': { 'good.flour': { buyCents: 1300, sellCents: 1180, seenAt: 100 } },
      'port.bayfield': { 'good.flour': { buyCents: 1400, sellCents: 1300, seenAt: 200 } },
    };
    expect(bestKnownSale(k, 'good.flour', 'port.bayfield')).toMatchObject({
      port: 'port.ashland',
      sellCents: 1180,
    });
    expect(bestKnownPurchase(k, 'good.flour', 'port.bayfield')?.port).toBe('port.duluth');
    expect(bestKnownSale(k, 'good.furs', 'port.bayfield')).toBeUndefined();
  });

  it('dates prices in weeks: a game day is a calendar week', () => {
    const day = SECONDS_PER_GAME_DAY;
    expect(ageText(day + 10, day + 3600)).toBe('this week');
    expect(ageText(day * 2 + 10, day * 3 + 10)).toBe('last week');
    expect(ageText(0, day * 5)).toBe('5 weeks ago');
  });

  it('formats money from cents', () => {
    expect(formatCents(1240)).toBe('$12.40');
    expect(formatCents(15_000, true)).toBe('$150');
    expect(formatCents(123_456)).toBe('$1,234.56');
    expect(formatCents(-5)).toBe('-$0.05');
  });
});

describe('the chandlery', () => {
  const defs = gameEconomy();
  const kit = must(storeItems().find((s) => s.id === 'store.patch_kit'));

  it('charges list price in a large port and more in a small one', () => {
    expect(storePriceCents(defs, 'port.superior', kit)).toBe(kit.priceCents);
    expect(storePriceCents(defs, 'port.two_harbors', kit)).toBeGreaterThan(kit.priceCents);
    expect(storePriceCents(defs, 'port.duluth', kit)).toBeLessThan(kit.priceCents);
  });

  it('fills the lockers up to their limit, all or nothing, and takes no hold room', () => {
    const trader = { purse: 10_000, stores: {} as ShipStores };
    expect(buyStores(defs, trader, 'port.superior', kit.id, 2)).toMatchObject({
      ok: true,
      totalCents: 2 * kit.priceCents,
    });
    expect(trader.stores[kit.id]).toBe(2);
    expect(trader.purse).toBe(10_000 - 2 * kit.priceCents);
    expect(buyStores(defs, trader, 'port.superior', kit.id, kit.max)).toEqual({
      ok: false,
      reason: 'full',
    });
    const poor = { purse: 100, stores: {} as ShipStores };
    expect(buyStores(defs, poor, 'port.superior', kit.id, 1)).toEqual({
      ok: false,
      reason: 'noMoney',
    });
    expect(poor).toEqual({ purse: 100, stores: {} });
    expect(buyStores(defs, trader, 'port.superior', 'store.cannon', 1)).toMatchObject({
      ok: false,
    });
  });
});

describe('the port screen model', () => {
  const defs = gameEconomy();
  const snap = (port: string, mutate?: (s: ReturnType<typeof createWorldState>) => void) => {
    const state = createWorldState('port-model');
    mutate?.(state);
    return portSnapshot({
      defs,
      markets: state.markets,
      knowledge: state.knowledge.prices,
      trader: state.player,
      capacity: 20,
      load01: 0.5,
      cargoSpeedLoss: 0.2,
      port,
      gameSeconds: state.environment.clock.gameSeconds,
    });
  };

  it('shows a tab for each built service and always the ledger', () => {
    expect(snap('port.bayfield').tabs).toEqual(['market', 'chandlery', 'ledger']);
    expect(snap('port.la_pointe').tabs).toEqual(['market', 'ledger']);
    expect(snap('port.la_pointe').stores).toEqual([]);
  });

  it("lists the port's goods by category, with what's aboard and the capacity", () => {
    const s = snap('port.bayfield');
    const cats = s.market.map((r) => r.category);
    expect(cats.indexOf('bulk')).toBeLessThan(cats.indexOf('high_value'));
    expect(s.market.some((r) => r.category === 'contraband')).toBe(false);
    const rope = must(s.market.find((r) => r.good === 'good.rope_canvas'));
    expect(rope.held).toBe(5);
    expect(rope.buyCents).toBeGreaterThan(rope.sellCents);
    expect(rope.maxBuy).toBeGreaterThan(0);
    expect(rope.bestSale).toBeUndefined();
    expect(s.usedCu).toBe(5);
    expect(s.capacity).toBe(20);
    expect(s.speedLoss).toBeCloseTo(0.1);
    expect(s.purseCents).toBe(15_000);
  });

  it('marks hot and contract cargo, which an honest sale leaves alone', () => {
    const s = snap('port.bayfield', (state) => {
      state.player.cargo.push({
        good: 'good.furs',
        qty: 2,
        hot: { region: 'region.chequamegon', heat: 0.8, traceability: 0.5, since: 0 },
      });
      state.player.cargo.push({ good: 'good.salt', qty: 3, contract: 'contract.1' });
    });
    const furs = must(s.hold.find((h) => h.good === 'good.furs'));
    expect(furs).toMatchObject({ hot: true, sellCents: undefined });
    const salt = must(s.hold.find((h) => h.good === 'good.salt'));
    expect(salt).toMatchObject({ contract: true, sellCents: undefined });
    expect(must(s.market.find((r) => r.good === 'good.furs')).held).toBe(0);
    expect(must(s.hold.find((h) => h.good === 'good.rope_canvas')).sellCents).toBeGreaterThan(0);
  });

  it('compares with prices seen elsewhere, gray once stale', () => {
    const s = snap('port.bayfield', (state) => {
      state.environment.clock.gameSeconds = 6 * SECONDS_PER_GAME_DAY;
      state.knowledge.prices['port.duluth'] = {
        'good.rope_canvas': { buyCents: 2100, sellCents: 1900, seenAt: 0 },
      };
    });
    expect(must(s.market.find((r) => r.good === 'good.rope_canvas')).bestSale).toEqual({
      portName: 'Duluth',
      cents: 1900,
      age: '6 weeks ago',
      stale: true,
    });
  });

  it('lays the ledger out by port, newest first', () => {
    const k: PriceKnowledge = {
      'port.duluth': { 'good.flour': { buyCents: 900, sellCents: 820, seenAt: 0 } },
      'port.ashland': {
        'good.flour': { buyCents: 1300, sellCents: 1180, seenAt: SECONDS_PER_GAME_DAY },
        'good.coal': { buyCents: 500, sellCents: 450, seenAt: SECONDS_PER_GAME_DAY },
      },
    };
    const l = ledgerSnapshot(defs, k, 2 * SECONDS_PER_GAME_DAY);
    expect(l.ports.map((p) => p.name)).toEqual(['Ashland', 'Duluth']);
    expect(l.ports[0]).toMatchObject({ seenText: 'Wk of May 14, 1900', age: 'last week' });
    expect(l.goods.map((g) => g.id)).toEqual(['good.coal', 'good.flour']);
    expect(l.prices['port.duluth']?.['good.flour']?.age).toBe('2 weeks ago');
  });
});

describe('docking at a port (piece B)', () => {
  const setup = () => {
    const state = createWorldState('port-control');
    const ctx = { state, events: new EventBus<GameEvents>() } as unknown as GameContext;
    const { hazards } = createSchooner(0, 0, 0);
    const economy = attachEconomy(ctx, hazards);
    const shown: (PortSnapshot | undefined)[] = [];
    const opens: boolean[] = [];
    let castOffs = 0;
    const ports = attachPorts({
      ctx,
      economy,
      hazards,
      berthPier: (id) => id.replace(/\.(north|south)\d*$/, ''),
      showPort: (s) => shown.push(s),
      showJournal: () => undefined,
      onOpen: (open) => opens.push(open),
      castOff: () => castOffs++,
    });
    return { ctx, hazards, ports, shown, opens, castOffs: () => castOffs };
  };

  it("opens the port's screen on docking and writes down its prices", () => {
    const { ctx, hazards, ports, shown, opens } = setup();
    const visits: string[] = [];
    ctx.events.on('PortVisited', (e) => visits.push(e.port));
    ctx.events.emit('ShipDocked', { shipId: 'ship.player', berthId: 'pier.ashland_ore.north2' });
    expect(ports.openPort).toBe('port.ashland');
    expect(opens).toEqual([true]);
    expect(visits).toEqual(['port.ashland']);
    expect(shown.at(-1)?.portName).toBe('Ashland');
    expect(Object.keys(ctx.state.knowledge.prices)).toEqual(['port.ashland']);

    ports.close();
    expect(opens).toEqual([true, false]);
    expect(shown.at(-1)).toBeUndefined();
    hazards.state.mooring = 'docked';
    expect(ports.openDocked()).toBe(true);
    ports.close();
    ctx.events.emit('ShipCastOff', { shipId: 'ship.player', berthId: 'pier.ashland_ore.north2' });
    expect(ports.openDocked()).toBe(false);
  });

  it('ignores other ships and piers without a port', () => {
    const { ctx, ports } = setup();
    ctx.events.emit('ShipDocked', { shipId: 'ship.npc', berthId: 'pier.bayfield_city.north' });
    ctx.events.emit('ShipDocked', { shipId: 'ship.player', berthId: 'pier.test_bay.north' });
    expect(ports.openPort).toBeUndefined();
  });

  it('trades through the screen, refreshing it and the ledger', () => {
    const { ctx, ports, shown } = setup();
    ports.open('port.bayfield');
    const before = must(ctx.state.knowledge.prices['port.bayfield']?.['good.rope_canvas']);
    expect(ports.actions.sell('good.rope_canvas', 5)).toBeUndefined();
    const after = must(ctx.state.knowledge.prices['port.bayfield']?.['good.rope_canvas']);
    expect(after.sellCents).toBeLessThan(before.sellCents);
    expect(shown.at(-1)?.hold).toEqual([]);
    expect(ports.actions.sell('good.rope_canvas', 1)).toBe("You haven't that much to sell.");
    expect(ports.actions.buy('good.lumber', 50)).toBe('There is no room in the hold.');
    expect(ports.actions.quote('good.lumber', 3, 'buy')).toBeGreaterThan(0);
    expect(ports.actions.buyStores('store.lamp_oil', 2)).toBeUndefined();
    expect(ctx.state.player.stores['store.lamp_oil']).toBe(2);
  });

  it('casts off from the screen by pressing F for the next tick', () => {
    const { ports, opens, castOffs } = setup();
    ports.open('port.bayfield');
    ports.actions.castOff();
    expect(ports.openPort).toBeUndefined();
    expect(opens).toEqual([true, false]);
    expect(castOffs()).toBe(1);
  });

  it('opens the journal at the helm, never over the port screen', () => {
    const { ports, opens } = setup();
    ports.openJournal();
    expect(ports.journalOpen).toBe(true);
    ports.closeJournal();
    ports.open('port.bayfield');
    ports.openJournal();
    expect(ports.journalOpen).toBe(false);
    expect(opens).toEqual([true, false, true]);
  });
});

describe('an on-screen button presses an action for one tick', () => {
  it('reports the press once, then clears it', () => {
    const input = new InputMapper();
    input.context = 'sailing';
    input.trigger('Interact');
    expect(input.pressed('Interact')).toBe(true);
    input.endTick();
    expect(input.pressed('Interact')).toBe(false);
  });
});

describe('v5 → v6: price knowledge and ship stores join the save (piece B)', () => {
  const fixture = (v: number): { saveVersion: number; state: Record<string, unknown> } =>
    JSON.parse(
      readFileSync(join(import.meta.dirname, 'fixtures', 'saves', `v${v}.json`), 'utf8'),
    ) as { saveVersion: number; state: Record<string, unknown> };

  it('gives a v5 run an empty ledger and empty lockers, keeping the rest', () => {
    const v5 = fixture(5);
    const state = parseWorldState(migrateSave(v5.state, 5));
    expect(state.knowledge).toEqual({ prices: {} });
    expect(state.player.stores).toEqual({});
    expect(state.player.purse).toBe(23_450);
  });

  it('a v6 save keeps what it knows and what it carries', () => {
    const v6 = fixture(6);
    const state = parseWorldState(migrateSave(v6.state, 6));
    expect(state.player.stores).toEqual({ 'store.patch_kit': 2, 'store.lamp_oil': 5 });
    expect(state.knowledge.prices['port.duluth']?.['good.salted_fish']?.sellCents).toBe(1490);
  });
});
