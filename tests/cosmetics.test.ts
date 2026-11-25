import { describe, expect, it } from 'vitest';
import { EventBus } from '../src/core/events';
import { attachEconomy } from '../src/gameplay/economy';
import { attachShipyard } from '../src/gameplay/shipyard';
import { createSchooner } from '../src/gameplay/schooner';
import type { GameContext, GameEvents } from '../src/modes/context';
import { liveried, schoonerLines, T2_SCHOONER_LINES } from '../src/render/ships/schooner-lines';
import { gameEconomy } from '../src/sim/economy/defs';
import { T1_SCHOONER_ID, T2_SCHOONER_ID } from '../src/sim/sailing/ships';
import {
  applyCosmetic,
  COSMETIC_KINDS,
  cosmeticOptions,
  cosmeticWork,
  currentCosmetic,
  DARK_SAILS_COLOR,
  liveryOf,
  renameShip,
} from '../src/sim/shipyard/cosmetics';
import { buyHull, defaultShipState, type Owner } from '../src/sim/shipyard/shipyard';
import { createWorldState, parseWorldState } from '../src/sim/world-state';
import { looksSnapshot, yardSnapshot } from '../src/ui/port/shipyard-model';

/** Phase 10: paint, canvas, pennant and her name (plan 10 §3, §7), cosmetic only. */

const defs = gameEconomy();
const SUPERIOR = 'port.superior';
const owner = (purse = 100_000): Owner => ({ purse, cargo: [], stores: {} });

describe('the options', () => {
  it('offers several of each kind, and each class has her own colors among them', () => {
    for (const kind of COSMETIC_KINDS) expect(cosmeticOptions(kind).length).toBeGreaterThan(2);
    for (const cls of [T1_SCHOONER_ID, T2_SCHOONER_ID])
      for (const kind of COSMETIC_KINDS) {
        const id = currentCosmetic(defaultShipState(cls), kind);
        expect(cosmeticOptions(kind).some((o) => o.id === id)).toBe(true);
      }
  });

  it('draws a class default in the colors the model already uses', () => {
    // Choosing her own colors back would change nothing on screen.
    const t2 = defaultShipState(T2_SCHOONER_ID);
    const own = Object.fromEntries(COSMETIC_KINDS.map((k) => [k, currentCosmetic(t2, k)]));
    const l = liveryOf({ ...t2, cosmetics: own });
    expect(l.topsides).toBe(T2_SCHOONER_LINES.paint.topsides);
    expect(l.trim).toBe(T2_SCHOONER_LINES.paint.rail);
    expect(l.canvas).toBe(T2_SCHOONER_LINES.paint.canvas);
    expect(l.pennant).toBe(T2_SCHOONER_LINES.paint.pennant);
  });

  it('is cheap and quick next to an upgrade', () => {
    for (const kind of [...COSMETIC_KINDS, 'name'] as const) {
      expect(cosmeticWork(kind).priceCents).toBeLessThanOrEqual(2000);
      expect(cosmeticWork(kind).hours).toBeLessThanOrEqual(12);
    }
  });
});

describe('painting her', () => {
  it('takes the price, records the choice, and refuses what she has or you can’t pay for', () => {
    const o = owner();
    const ship = defaultShipState();
    const r = applyCosmetic(o, ship, SUPERIOR, 'cosmetic.hull_blue');
    expect(r).toEqual({
      ok: true,
      event: {
        port: SUPERIOR,
        kind: 'hull',
        value: 'cosmetic.hull_blue',
        cents: cosmeticWork('hull').priceCents,
        hours: cosmeticWork('hull').hours,
      },
    });
    expect(o.purse).toBe(100_000 - cosmeticWork('hull').priceCents);
    expect(ship.cosmetics).toEqual({ hull: 'cosmetic.hull_blue' });
    expect(applyCosmetic(o, ship, SUPERIOR, 'cosmetic.hull_blue')).toEqual({
      ok: false,
      reason: 'same',
    });
    // White is the T1's own: nothing to paint.
    expect(applyCosmetic(o, defaultShipState(), SUPERIOR, 'cosmetic.hull_white')).toEqual({
      ok: false,
      reason: 'same',
    });
    expect(applyCosmetic(owner(0), ship, SUPERIOR, 'cosmetic.hull_red')).toEqual({
      ok: false,
      reason: 'noMoney',
    });
    expect(applyCosmetic(o, ship, SUPERIOR, 'cosmetic.plaid')).toEqual({
      ok: false,
      reason: 'unknown',
    });
  });

  it('draws her in the colors chosen; tanned canvas takes no other color', () => {
    const ship = defaultShipState();
    ship.cosmetics = {
      hull: 'cosmetic.hull_black',
      trim: 'cosmetic.trim_red',
      sails: 'cosmetic.sails_ochre',
      pennant: 'cosmetic.pennant_blue_white',
    };
    expect(liveryOf(ship)).toEqual({
      topsides: 0x2c302f,
      trim: 0x8a3426,
      canvas: 0xc19a5b,
      pennant: 0x3d5a85,
      pennantFly: 0xe4ddcc,
    });
    ship.upgrades.push('upgrade.dark_sails');
    expect(liveryOf(ship).canvas).toBe(DARK_SAILS_COLOR);
    expect(applyCosmetic(owner(), ship, SUPERIOR, 'cosmetic.sails_cream')).toEqual({
      ok: false,
      reason: 'tanned',
    });
    expect(looksSnapshot(ship, 100_000).rows.find((r) => r.kind === 'sails')?.refusal).toBe(
      'Her canvas is tanned dark',
    );
  });

  it('paints the model: topsides, rail, houses that match the rail, canvas and pennant', () => {
    const t2 = liveried(schoonerLines(T2_SCHOONER_ID), {
      topsides: 0x111111,
      trim: 0x222222,
      canvas: 0x333333,
      pennant: 0x444444,
      pennantFly: 0x555555,
    });
    expect(t2.paint).toMatchObject({
      topsides: 0x111111,
      rail: 0x222222,
      house: 0x222222,
      canvas: 0x333333,
      pennant: 0x444444,
      pennantFly: 0x555555,
    });
    // The T1's houses are weathered wood, not her rail's color, and stay so.
    const t1 = liveried(schoonerLines(T1_SCHOONER_ID), { trim: 0x222222 });
    expect(t1.paint.house).toBe(schoonerLines(T1_SCHOONER_ID).paint.house);
    // The shared lines aren't touched, and no livery is the lines themselves.
    expect(schoonerLines(T2_SCHOONER_ID).paint.rail).not.toBe(0x222222);
    expect(liveried(schoonerLines(T1_SCHOONER_ID), {})).toBe(schoonerLines(T1_SCHOONER_ID));
  });

  it('leaves paint and canvas with the old hull; the pennant comes across', () => {
    const state = createWorldState('cosmetic-hull');
    const o = owner(1_000_000);
    const ship = defaultShipState();
    ship.cosmetics = { hull: 'cosmetic.hull_red', pennant: 'cosmetic.pennant_yellow' };
    expect(buyHull(defs, state.markets, o, ship, SUPERIOR, T2_SCHOONER_ID, 0).ok).toBe(true);
    expect(ship.cosmetics).toEqual({ pennant: 'cosmetic.pennant_yellow' });
  });

  it('keeps her colors in the save, and a save without them loads', () => {
    const state = createWorldState('cosmetic-save');
    const ship = defaultShipState();
    ship.cosmetics = { trim: 'cosmetic.trim_blue' };
    state.player.ship = ship;
    expect(parseWorldState(JSON.parse(JSON.stringify(state))).player.ship?.cosmetics).toEqual({
      trim: 'cosmetic.trim_blue',
    });
    delete state.player.ship.cosmetics;
    expect(parseWorldState(JSON.parse(JSON.stringify(state))).player.ship?.cosmetics).toBe(
      undefined,
    );
  });
});

describe('naming her', () => {
  it('renames her for a small price, tidying the name, and refuses a blank or long one', () => {
    const o = owner();
    const captain = { shipName: 'Wren' };
    const r = renameShip(o, captain, SUPERIOR, '  Lady   of the Lake ');
    expect(r.ok).toBe(true);
    expect(captain.shipName).toBe('Lady of the Lake');
    expect(o.purse).toBe(100_000 - cosmeticWork('name').priceCents);
    expect(renameShip(o, captain, SUPERIOR, '   ')).toEqual({ ok: false, reason: 'badName' });
    expect(renameShip(o, captain, SUPERIOR, 'x'.repeat(33))).toEqual({
      ok: false,
      reason: 'badName',
    });
    expect(renameShip(o, captain, SUPERIOR, 'Lady of the Lake')).toEqual({
      ok: false,
      reason: 'same',
    });
  });
});

describe('in the game', () => {
  const setup = () => {
    const state = createWorldState('cosmetic-game');
    const ctx = { state, events: new EventBus<GameEvents>() } as unknown as GameContext;
    const schooner = createSchooner(0, 0, 0);
    const economy = attachEconomy(ctx, schooner.hazards);
    const rebuilt: string[] = [];
    const repainted: unknown[] = [];
    const yard = attachShipyard({
      ctx,
      economy,
      sailing: schooner.sailing,
      hazards: schooner.hazards,
      buoyancy: schooner.buoyancy,
      handling: schooner.handling,
      rules: schooner.hazardRules,
      onHullChanged: (id) => rebuilt.push(id),
      onLiveryChanged: (l) => repainted.push(l),
    });
    return { state, ctx, yard, rebuilt, repainted, schooner };
  };

  it('repaints the model, passes the yard time and raises the event; she sails the same', () => {
    const { state, ctx, yard, rebuilt, repainted, schooner } = setup();
    const cls = schooner.sailing.cls;
    const seen: GameEvents['CosmeticChanged'][] = [];
    ctx.events.on('CosmeticChanged', (e) => seen.push(e));
    const t0 = state.environment.clock.gameSeconds;
    expect(yard.paint(SUPERIOR, 'cosmetic.hull_green')).toBeUndefined();
    expect(repainted).toEqual([{ topsides: 0x3c5244 }]);
    expect(yard.livery).toEqual({ topsides: 0x3c5244 });
    expect(rebuilt).toEqual([]);
    expect(state.environment.clock.gameSeconds - t0).toBe(cosmeticWork('hull').hours * 3600);
    expect(seen.map((e) => e.value)).toEqual(['cosmetic.hull_green']);
    expect(schooner.sailing.cls).toEqual(cls);
    // A pennant goes up on the spot.
    const t1 = state.environment.clock.gameSeconds;
    expect(yard.paint(SUPERIOR, 'cosmetic.pennant_black_red')).toBeUndefined();
    expect(state.environment.clock.gameSeconds).toBe(t1);
    expect(yard.paint(SUPERIOR, 'cosmetic.pennant_black_red')).toBe('She has that already.');
  });

  it('names a new hull at purchase before the news goes out, and a rename leaves the law’s profile alone', () => {
    const { state, ctx, yard } = setup();
    state.player.purse = 200_000;
    state.player.captain.shipName = 'Wren';
    state.profiles.ship.name = 'Wren';
    let named = '';
    ctx.events.on('ShipPurchased', () => (named = state.player.captain.shipName));
    expect(yard.buyHull(SUPERIOR, T2_SCHOONER_ID, ' Iron  Duke ')).toBeUndefined();
    expect(named).toBe('Iron Duke');
    expect(yard.buyHull(SUPERIOR, T1_SCHOONER_ID, '')).toBe('A name, of up to 32 letters.');
    expect(state.player.ship?.classId).toBe(T2_SCHOONER_ID);

    expect(yard.rename(SUPERIOR, 'Moth')).toBeUndefined();
    expect(state.player.captain.shipName).toBe('Moth');
    expect(state.profiles.ship.name).toBe('Wren');
  });

  it('shows the swatches and her name at a shipyard, not at a chandlery', () => {
    const { state } = setup();
    const ship = defaultShipState();
    ship.cosmetics = { hull: 'cosmetic.hull_red' };
    const base = {
      defs,
      markets: state.markets,
      owner: { purse: 500, cargo: [], stores: {} },
      ship,
      shipName: 'Wren',
      port: SUPERIOR,
      gameSeconds: 0,
    };
    const yard = yardSnapshot({ ...base, place: 'shipyard' });
    const hull = yard.looks?.rows.find((r) => r.kind === 'hull');
    expect(hull?.options.filter((o) => o.current).map((o) => o.id)).toEqual(['cosmetic.hull_red']);
    // $5 won't buy a coat of paint, but runs up a pennant.
    expect(hull?.affordable).toBe(false);
    expect(yard.looks?.rows.find((r) => r.kind === 'pennant')?.affordable).toBe(true);
    expect(yardSnapshot({ ...base, place: 'chandlery' }).looks).toBeUndefined();
  });
});
