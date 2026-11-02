import { describe, expect, it } from 'vitest';
import { EventBus } from '../src/core/events';
import { attachEconomy } from '../src/gameplay/economy';
import { attachShipyard } from '../src/gameplay/shipyard';
import { createSchooner } from '../src/gameplay/schooner';
import type { GameContext, GameEvents } from '../src/modes/context';
import { gameEconomy, portInfo } from '../src/sim/economy/defs';
import {
  createSailingState,
  IDLE_COMMAND,
  speedKn,
  stepSailing,
  type SailingWind,
} from '../src/sim/sailing/controller';
import { defaultHandling } from '../src/sim/sailing/handling';
import { defaultHazardRules } from '../src/sim/sailing/hazard-rules';
import { compileSailingClass } from '../src/sim/sailing/ship-class';
import { sailShipRecord, T1_SCHOONER_ID, T2_SCHOONER_ID } from '../src/sim/sailing/ships';
import { fitShip, upgradeDefs } from '../src/sim/shipyard/fit';
import {
  buyHull,
  defaultShipState,
  hullQuote,
  installUpgrade,
  MEND_KIT,
  PATCH_KIT,
  removeUpgrade,
  repairQuote,
  repairShip,
  tradeInQuote,
  useKit,
  type Owner,
} from '../src/sim/shipyard/shipyard';
import { createWorldState, parseWorldState } from '../src/sim/world-state';
import { portSnapshot } from '../src/ui/port/model';

/** Phase 4 piece G: the shipyard, upgrades, repairs and the ship's condition in the save. */

const defs = gameEconomy();
const SUPERIOR = 'port.superior';
const T1 = sailShipRecord(T1_SCHOONER_ID);
const T2 = sailShipRecord(T2_SCHOONER_ID);
const owner = (purse = 1_000_000): Owner => ({ purse, cargo: [], stores: {} });
const DT = 1 / 30;
const SCALE = { rate: 24, compression: 8 };
const north: SailingWind = { fromRad: 0, speedKn: 14, gust01: 0 };

/** Beam-reach speed after a minute at Full in 14 kn, for a class with upgrades. */
function beamSpeed(upgrades: string[], record = T1): number {
  const fit = fitShip(record, defaultHazardRules(), upgrades);
  const c = compileSailingClass(fit.record, defaultHandling());
  const s = createSailingState(0, 0, Math.PI / 2);
  s.sailLevel = 3;
  s.sailSetting = 3;
  for (let i = 0; i < 60 / DT; i++) stepSailing(s, IDLE_COMMAND, c, north, 0, SCALE, DT, []);
  return speedKn(s);
}

describe('shipyards and hulls', () => {
  it('builds at Superior, Duluth and Ashland (plan 10 §3)', () => {
    const yards = [...defs.markets.keys()].filter((p) =>
      portInfo(p)?.services.includes('shipyard'),
    );
    expect(yards.sort()).toEqual(['port.ashland', 'port.duluth', 'port.superior']);
  });

  it('prices the T1 and T2 at the plan 10 §2 values, with their slots and a 45 CU T2 hold', () => {
    expect(T1.priceCents).toBe(50_000);
    expect(T2.priceCents).toBe(160_000);
    expect(T2.cargoCapacity).toBe(45);
    expect(T1.slots).toMatchObject({ hull: 1, rigging: 1, cargo: 1, instruments: 2, utility: 1 });
    expect(T2.slots).toMatchObject({ hull: 2, rigging: 2, cargo: 1, instruments: 3, utility: 2 });
  });

  it('has about ten upgrades, every one with a source and an effect', () => {
    const all = [...upgradeDefs().values()];
    expect(all.length).toBeGreaterThanOrEqual(10);
    for (const u of all) expect(Object.keys(u.effects).length, u.id).toBeGreaterThan(0);
  });
});

describe('trading in (criterion 8)', () => {
  it('values the old ship at half her price by condition and a quarter of her gear', () => {
    const ship = defaultShipState();
    ship.upgrades = ['upgrade.quality_canvas', 'upgrade.marine_telescope'];
    ship.hull01 = 0.5;
    const q = tradeInQuote(ship, T2);
    const condition = (0.5 * T1.hullHP + T1.riggingHP) / (T1.hullHP + T1.riggingHP);
    expect(q.hullCents).toBe(Math.floor(0.5 * 50_000 * condition));
    // The telescope moves across; the canvas stays with her and counts at 25%.
    expect(q.moving).toEqual(['upgrade.marine_telescope']);
    expect(q.upgradesCents).toBe(Math.floor(0.25 * 9_000));
  });

  it('trades a sound T1 in for a T2 at Superior: $1,600 less $250', () => {
    const o = owner(200_000);
    const ship = defaultShipState();
    const state = createWorldState('yard');
    const r = buyHull(defs, state.markets, o, ship, SUPERIOR, T2_SCHOONER_ID, 0);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.event.tradeInCents).toBe(25_000);
    expect(r.event.priceCents).toBe(160_000);
    expect(o.purse).toBe(200_000 - 135_000);
    expect(ship).toEqual({ ...defaultShipState(T2_SCHOONER_ID) });
  });

  it('refuses without the money, and for the hull you already sail', () => {
    const state = createWorldState('yard');
    const ship = defaultShipState();
    const poor = owner(10_000);
    expect(buyHull(defs, state.markets, poor, ship, SUPERIOR, T2_SCHOONER_ID, 0)).toEqual({
      ok: false,
      reason: 'noMoney',
    });
    expect(poor.purse).toBe(10_000);
    expect(buyHull(defs, state.markets, poor, ship, SUPERIOR, T1_SCHOONER_ID, 0)).toEqual({
      ok: false,
      reason: 'sameHull',
    });
  });

  it("sells cargo that won't fit at 80%, and won't strand contract goods", () => {
    const state = createWorldState('yard');
    const ship = defaultShipState(T2_SCHOONER_ID);
    const o = owner(0);
    o.cargo = [
      { good: 'good.lumber', qty: 30 },
      { good: 'good.flour', qty: 10 },
    ];
    const q = hullQuote(defs, state.markets, o, ship, SUPERIOR, T1_SCHOONER_ID, 0);
    expect(q.capacity).toBe(20);
    expect(q.overflow.reduce((n, l) => n + l.qty, 0)).toBe(20);
    expect(q.netCents).toBeLessThan(0);
    const r = buyHull(defs, state.markets, o, ship, SUPERIOR, T1_SCHOONER_ID, 0);
    expect(r.ok).toBe(true);
    expect(o.cargo.reduce((n, s) => n + s.qty, 0)).toBe(20);
    expect(o.purse).toBe(q.overflowCents - q.netCents);

    const stuck = owner(1_000_000);
    stuck.cargo = [{ good: 'good.lumber', qty: 30, contract: 'contract.1' }];
    const s2 = defaultShipState(T2_SCHOONER_ID);
    expect(buyHull(defs, state.markets, stuck, s2, SUPERIOR, T1_SCHOONER_ID, 0)).toEqual({
      ok: false,
      reason: 'cargoStuck',
    });
  });

  it("can't print money: up and back down the hulls always loses", () => {
    const state = createWorldState('yard');
    const o = owner(1_000_000);
    const ship = defaultShipState();
    for (let i = 0; i < 5; i++) {
      expect(buyHull(defs, state.markets, o, ship, SUPERIOR, T2_SCHOONER_ID, 0).ok).toBe(true);
      expect(buyHull(defs, state.markets, o, ship, SUPERIOR, T1_SCHOONER_ID, 0).ok).toBe(true);
    }
    expect(o.purse).toBeLessThan(1_000_000 - 5 * 100_000);
    // Fitting and taking out an upgrade loses three quarters of it.
    const before = o.purse;
    installUpgrade(defs, o, ship, SUPERIOR, 'upgrade.quality_canvas', 'shipyard');
    removeUpgrade(o, ship, SUPERIOR, 'upgrade.quality_canvas', 'shipyard');
    expect(o.purse).toBeLessThan(before);
  });
});

describe('upgrades change handling', () => {
  it('quality canvas makes her faster; planking and a bigger hold cost speed', () => {
    const bare = beamSpeed([]);
    expect(beamSpeed(['upgrade.quality_canvas'])).toBeGreaterThan(bare * 1.03);
    expect(beamSpeed(['upgrade.reinforced_planking'])).toBeLessThan(bare);
    expect(beamSpeed(['upgrade.expanded_hold'])).toBeLessThan(bare);
  });

  it('folds each effect into the class and rules', () => {
    const rules = defaultHazardRules();
    const f = fitShip(T1, rules, [
      'upgrade.reinforced_planking',
      'upgrade.improved_blocks',
      'upgrade.expanded_hold',
      'upgrade.sounding_machine',
      'upgrade.aneroid_barometer',
      'upgrade.heavy_anchor',
    ]);
    expect(f.record.hullHP).toBe(125);
    expect(f.record.sailChangeTimeS).toBeCloseTo(2.4);
    expect(f.record.cargoCapacity).toBe(25);
    expect(f.record.draftFullM).toBeCloseTo(2.2);
    expect(f.record.hullMaxSpeedKn).toBeCloseTo(7.6);
    expect(f.rules.shallowWarnDrafts).toBe(3);
    expect(f.rules.anchorHoldKn).toBe(45);
    expect(f.instruments.forecastHours).toBe(24);
    const storm = fitShip(T1, rules, ['upgrade.storm_sails']).rules.safeWindKn;
    expect(storm[1]).toBe(rules.safeWindKn[1] + 4);
    expect(storm[3]).toBe(rules.safeWindKn[3]);
    const pumps = fitShip(T1, rules, ['upgrade.improved_pumps']).rules;
    expect(pumps.leakSpeedLoss).toBeCloseTo(rules.leakSpeedLoss / 2);
  });

  it('keeps to the slots: one rigging upgrade on a T1, two on a T2', () => {
    const o = owner();
    const ship = defaultShipState();
    expect(installUpgrade(defs, o, ship, SUPERIOR, 'upgrade.quality_canvas', 'shipyard').ok).toBe(
      true,
    );
    expect(installUpgrade(defs, o, ship, SUPERIOR, 'upgrade.storm_sails', 'shipyard')).toEqual({
      ok: false,
      reason: 'noSlot',
    });
    const t2 = defaultShipState(T2_SCHOONER_ID);
    installUpgrade(defs, o, t2, SUPERIOR, 'upgrade.quality_canvas', 'shipyard');
    expect(installUpgrade(defs, o, t2, SUPERIOR, 'upgrade.storm_sails', 'shipyard').ok).toBe(true);
  });

  it('fits instruments at a chandlery on the spot, but not yard work', () => {
    const o = owner();
    const ship = defaultShipState();
    const r = installUpgrade(
      defs,
      o,
      ship,
      'port.bayfield',
      'upgrade.sounding_machine',
      'chandlery',
    );
    expect(r.ok && r.event.hours).toBe(0);
    expect(
      installUpgrade(defs, o, ship, 'port.bayfield', 'upgrade.quality_canvas', 'chandlery'),
    ).toEqual({ ok: false, reason: 'notHere' });
    const yard = installUpgrade(defs, o, ship, SUPERIOR, 'upgrade.expanded_hold', 'shipyard');
    expect(yard.ok && yard.event.hours).toBe(16);
  });
});

describe('repairs (plan 10 §8)', () => {
  it('a yard makes her sound for money and time', () => {
    const o = owner();
    const ship = { ...defaultShipState(), hull01: 0.4, rigging01: 0.7 };
    const q = repairQuote(defs, SUPERIOR, ship, 'shipyard');
    expect(q.hours).toBeGreaterThan(0);
    const r = repairShip(defs, o, ship, SUPERIOR, 'shipyard');
    expect(r.ok).toBe(true);
    expect(ship.hull01).toBe(1);
    expect(ship.rigging01).toBe(1);
    expect(o.purse).toBe(1_000_000 - q.totalCents);
    expect(repairShip(defs, o, ship, SUPERIOR, 'shipyard')).toEqual({ ok: false, reason: 'sound' });
  });

  it('a chandler mends the rigging only, dearer and at once', () => {
    const ship = { ...defaultShipState(), hull01: 0.4, rigging01: 0.5 };
    const yard = repairQuote(defs, 'port.bayfield', ship, 'shipyard');
    const chand = repairQuote(defs, 'port.bayfield', ship, 'chandlery');
    expect(chand.hullCents).toBe(0);
    expect(chand.riggingCents).toBeGreaterThan(yard.riggingCents);
    expect(chand.hours).toBe(0);
    repairShip(defs, owner(), ship, 'port.bayfield', 'chandlery');
    expect(ship).toMatchObject({ hull01: 0.4, rigging01: 1 });
  });

  it('kits patch a fifth of a pool at sea, up to 80%', () => {
    const o = owner();
    o.stores = { [PATCH_KIT]: 3, [MEND_KIT]: 1 };
    const ship = { ...defaultShipState(), hull01: 0.5, rigging01: 0.9 };
    expect(useKit(o, ship, PATCH_KIT).ok).toBe(true);
    expect(ship.hull01).toBeCloseTo(0.7);
    useKit(o, ship, PATCH_KIT);
    expect(ship.hull01).toBeCloseTo(0.8);
    expect(useKit(o, ship, PATCH_KIT)).toEqual({ ok: false, reason: 'kitCap' });
    expect(o.stores[PATCH_KIT]).toBe(1);
    expect(useKit(o, ship, MEND_KIT)).toEqual({ ok: false, reason: 'kitCap' });
    o.stores[MEND_KIT] = 0;
    ship.rigging01 = 0.3;
    expect(useKit(o, ship, MEND_KIT)).toEqual({ ok: false, reason: 'noKit' });
  });
});

describe('in the game', () => {
  const setup = (seed = 'yard-game') => {
    const state = createWorldState(seed);
    const ctx = { state, events: new EventBus<GameEvents>() } as unknown as GameContext;
    const schooner = createSchooner(0, 0, 0);
    const economy = attachEconomy(ctx, schooner.hazards);
    const rebuilt: string[] = [];
    const yard = attachShipyard({
      ctx,
      economy,
      sailing: schooner.sailing,
      hazards: schooner.hazards,
      buoyancy: schooner.buoyancy,
      handling: schooner.handling,
      rules: schooner.hazardRules,
      onHullChanged: (id) => rebuilt.push(id),
    });
    return { state, ctx, schooner, economy, yard, rebuilt };
  };

  it('sails the T2 after buying her: class, hold, buoyancy and the model', () => {
    const { state, schooner, economy, yard, rebuilt, ctx } = setup();
    state.player.purse = 200_000;
    const bought: unknown[] = [];
    ctx.events.on('ShipPurchased', (e) => bought.push(e));
    expect(yard.buyHull(SUPERIOR, T2_SCHOONER_ID)).toBeUndefined();
    expect(schooner.sailing.cls.id).toBe(T2_SCHOONER_ID);
    expect(schooner.hazards.cls.hullHP).toBe(160);
    expect(schooner.hazards.state.hull).toBe(160);
    expect(economy.capacity).toBe(45);
    expect(schooner.buoyancy.length).toBe(T2.buoyancy.length);
    expect(rebuilt).toEqual([T2_SCHOONER_ID]);
    expect(bought).toHaveLength(1);
  });

  it('keeps damage as a share of the pool through an upgrade, and yard time passes', () => {
    const { state, schooner, yard } = setup();
    schooner.hazards.state.hull = 50;
    const t0 = state.environment.clock.gameSeconds;
    expect(yard.install(SUPERIOR, 'upgrade.reinforced_planking', 'shipyard')).toBeUndefined();
    expect(schooner.hazards.cls.hullHP).toBe(125);
    expect(schooner.hazards.state.hull).toBeCloseTo(62.5);
    expect(state.environment.clock.gameSeconds - t0).toBe(12 * 3600);
    expect(schooner.sailing.cls.hullMaxSpeed).toBeLessThan(
      compileSailingClass(T1, defaultHandling()).hullMaxSpeed,
    );
  });

  it('uses the kit the ship needs most with K', () => {
    const { state, schooner, yard } = setup();
    state.player.stores = { [PATCH_KIT]: 1, [MEND_KIT]: 1 };
    schooner.hazards.state.hull = 30;
    schooner.hazards.state.rigging = 50;
    expect(yard.useKit()).toMatch(/Patched the hull: 50%/);
    expect(schooner.hazards.state.hull).toBeCloseTo(50);
    expect(yard.useKit()).toMatch(/Mended the rigging: 80%/);
    expect(yard.useKit()).toMatch(/No patch kits|No mend kits/);
  });

  it('saves her class, condition and fit, and loads them back (criterion 8)', () => {
    const { state, schooner, yard } = setup('yard-save');
    state.player.purse = 500_000;
    yard.buyHull(SUPERIOR, T2_SCHOONER_ID);
    yard.install(SUPERIOR, 'upgrade.marine_telescope', 'shipyard');
    schooner.hazards.state.rigging = 65;
    yard.sync();
    const loaded = parseWorldState(JSON.parse(JSON.stringify(state)));
    expect(loaded.player.ship).toEqual({
      classId: T2_SCHOONER_ID,
      hull01: 1,
      rigging01: 0.5,
      upgrades: ['upgrade.marine_telescope'],
    });
  });

  it('gives a save from before the shipyard a sound, bare T1', () => {
    const state = createWorldState('old');
    delete (state.player as { ship?: unknown }).ship;
    expect(parseWorldState(JSON.parse(JSON.stringify(state))).player.ship).toEqual(
      defaultShipState(),
    );
  });

  it('shows a shipyard tab at Superior and fittings at the Bayfield chandlery', () => {
    const state = createWorldState('yard-ui');
    const snap = (port: string) =>
      portSnapshot({
        defs,
        markets: state.markets,
        knowledge: {},
        trader: state.player,
        capacity: 20,
        load01: 0,
        cargoSpeedLoss: 0.2,
        port,
        gameSeconds: 0,
        ship: { state: defaultShipState(), name: 'Grace' },
      });
    const sup = snap(SUPERIOR);
    expect(sup.tabs).toContain('shipyard');
    expect(sup.shipyard?.hulls.map((h) => h.classId)).toEqual([T1_SCHOONER_ID, T2_SCHOONER_ID]);
    expect(sup.shipyard?.hulls[1]?.netCents).toBe(135_000);
    const bay = snap('port.bayfield');
    expect(bay.tabs).not.toContain('shipyard');
    expect(bay.fittings?.upgrades.every((u) => u.hours === 0)).toBe(true);
    expect(bay.fittings?.upgrades.map((u) => u.id)).toContain('upgrade.marine_telescope');
  });
});
