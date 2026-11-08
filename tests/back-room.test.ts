import { describe, expect, it } from 'vitest';
import { EventBus } from '../src/core/events';
import { SECONDS_PER_GAME_DAY } from '../src/core/time';
import { attachBackRoom } from '../src/gameplay/back-room';
import { attachEconomy } from '../src/gameplay/economy';
import { attachLaw } from '../src/gameplay/law';
import { attachPortLaw } from '../src/gameplay/port-law';
import { attachPorts } from '../src/gameplay/port';
import { createSchooner } from '../src/gameplay/schooner';
import { attachShipyard } from '../src/gameplay/shipyard';
import { attachSmugglers } from '../src/gameplay/smuggler';
import { createGameWorld } from '../src/gameplay/ecs';
import type { GameContext, GameEvents } from '../src/modes/context';
import { gameEconomy } from '../src/sim/economy/defs';
import {
  fenceAccess,
  fenceAt,
  fenceLotQuote,
  fenceRateFor,
  freshFenceState,
  gameFences,
  restockFence,
  sellToFence,
} from '../src/sim/economy/fence';
import type { CargoStack } from '../src/sim/economy/hold';
import {
  freshContrabandState,
  gameSmuggler,
  gameSmugglers,
  knowsAnchorage,
  learnAnchorage,
  nightOf,
  smugglerById,
  smugglerInWorld,
  smugglersInWorld,
  smugglerStateOf,
} from '../src/sim/economy/smuggler';
import { informChance, informRoll } from '../src/sim/law/port-law';
import { gameLaw } from '../src/sim/law/defs';
import { T1_SCHOONER_ID, T2_SCHOONER_ID, sailShipRecord } from '../src/sim/sailing/ships';
import { gunModsOf, upgradeDefs } from '../src/sim/shipyard/fit';
import { buyGun, gameGuns, gunRefusal } from '../src/sim/shipyard/guns';
import { defaultShipState, fitRefusal, movingUpgrades } from '../src/sim/shipyard/shipyard';
import { createWorldState, parseWorldState } from '../src/sim/world-state';
import type { PortSnapshot } from '../src/ui/port/model';

/**
 * Phase 6 piece E (plan 07 §14.4): the fences in the ports' back rooms after dark, the
 * shady shipwright's guns, powder and shot at the chandlery, and a smuggler list that
 * holds more than one boat for the Siskiwit Bay smuggler (§14.6.1).
 */

const defs = gameEconomy();
const WEEK = SECONDS_PER_GAME_DAY;
/** 23:00 on the first night (May): well after dark. */
const NIGHT = 23 * 3600;
const NOON = 12 * 3600;
const BAYFIELD = fenceAt('port.bayfield') ?? (gameFences()[0] as never);
const DULUTH = fenceAt('port.duluth') ?? (gameFences()[1] as never);
/** Fame values for the tiers (fame_tiers.json): Unknown, Rumored, Known. */
const UNKNOWN = 0;
const KNOWN_FAME = 200;

const hot = (good: string, qty: number, since = NIGHT, region = 'region.apostles'): CargoStack => ({
  good,
  qty,
  hot: { region, heat: 1, traceability: defs.goods.get(good)?.traceability ?? 0, since },
});

describe('the fences (plan 05 §6.2)', () => {
  it('has a small fence at Bayfield for anyone and a big one at Duluth for the Known', () => {
    expect(BAYFIELD.fameTier).toBe(0);
    expect(DULUTH.fameTier).toBe(2);
    expect(DULUTH.weeklyCashCents).toBeGreaterThan(BAYFIELD.weeklyCashCents);
    expect(BAYFIELD.prefers).toEqual(
      expect.arrayContaining(['good.fresh_fish', 'good.salted_fish', 'good.furs']),
    );
    expect(DULUTH.prefers).toBeUndefined();
    expect(gameFences().every((f) => f.shipwright)).toBe(true);
  });

  it('opens after dark, and the Duluth room only once you are Known', () => {
    expect(fenceAccess(BAYFIELD, 0, NOON)).toBe('day');
    expect(fenceAccess(BAYFIELD, 0, NIGHT)).toBe('open');
    expect(fenceAccess(DULUTH, 1, NIGHT)).toBe('fame');
    expect(fenceAccess(DULUTH, 2, NIGHT)).toBe('open');
    expect(fenceAccess(DULUTH, 2, NOON)).toBe('day');
  });

  it('pays 40–70% of value: more with Fame, trust and cool goods; less off his line', () => {
    for (const f of gameFences()) {
      const s = freshFenceState(f, NIGHT);
      for (const fame of [0, 1, 2, 3, 4]) {
        for (const heat of [0, 0.5, 1]) {
          for (const dealt of [0, f.rate.trustAtCents]) {
            s.dealtCents = dealt;
            const r = fenceRateFor(f, s, 'good.furs', heat, fame);
            expect(r).toBeGreaterThanOrEqual(0.4 - 1e-9);
            expect(r).toBeLessThanOrEqual(0.7 + 1e-9);
          }
        }
      }
    }
    const s = freshFenceState(BAYFIELD, NIGHT);
    expect(fenceRateFor(BAYFIELD, s, 'good.furs', 1, 0)).toBeCloseTo(0.4);
    expect(fenceRateFor(BAYFIELD, s, 'good.furs', 1, 2)).toBeGreaterThan(
      fenceRateFor(BAYFIELD, s, 'good.furs', 1, 0),
    );
    expect(fenceRateFor(BAYFIELD, s, 'good.furs', 0, 0)).toBeGreaterThan(
      fenceRateFor(BAYFIELD, s, 'good.furs', 1, 0),
    );
    // Bayfield wants fish and furs; copper he takes for less. Duluth takes anything alike.
    expect(fenceRateFor(BAYFIELD, s, 'good.copper', 1, 0)).toBeCloseTo(0.4 * BAYFIELD.offLine);
    const d = freshFenceState(DULUTH, NIGHT);
    expect(fenceRateFor(DULUTH, d, 'good.copper', 1, 2)).toBeCloseTo(
      fenceRateFor(DULUTH, d, 'good.furs', 1, 2),
    );
  });

  it("buys hot goods and contraband out of his week's cash, and won't touch clean or contract cargo", () => {
    const s = freshFenceState(BAYFIELD, NIGHT);
    const trader = {
      purse: 0,
      cargo: [
        hot('good.furs', 3),
        { good: 'good.untaxed_whiskey', qty: 2 },
        { good: 'good.flour', qty: 4 },
        { good: 'good.lumber', qty: 2, contract: 'contract.x' },
      ] as CargoStack[],
    };
    expect(fenceLotQuote(defs, BAYFIELD, s, trader.cargo[2] as CargoStack, NIGHT, 0)).toEqual({
      ok: false,
      reason: 'clean',
    });
    expect(fenceLotQuote(defs, BAYFIELD, s, trader.cargo[3] as CargoStack, NIGHT, 0)).toEqual({
      ok: false,
      reason: 'contract',
    });
    const furs = defs.goods.get('good.furs')?.basePriceCents ?? 0;
    const r = sellToFence(defs, BAYFIELD, s, trader as never, 0, 2, NIGHT, 0);
    expect(r.ok).toBe(true);
    const paid = Math.floor(furs * 0.4) * 2;
    expect(trader.purse).toBe(paid);
    expect(s.cashCents).toBe(BAYFIELD.weeklyCashCents - paid);
    expect(s.dealtCents).toBe(paid);
    // What's left of the lot is still hot.
    expect(trader.cargo[0]?.qty).toBe(1);
    expect(trader.cargo[0]?.hot).toBeTruthy();
    expect(sellToFence(defs, BAYFIELD, s, trader as never, 1, 2, NIGHT, 0).ok).toBe(true);
    // By day the room is shut.
    expect(sellToFence(defs, BAYFIELD, s, trader as never, 0, 1, NOON, 0)).toEqual({
      ok: false,
      reason: 'day',
    });
  });

  it('runs out of cash for the week, and has it again the next night', () => {
    const s = freshFenceState(BAYFIELD, NIGHT);
    const trader = { purse: 0, cargo: [hot('good.copper', 40)] };
    const r = sellToFence(defs, BAYFIELD, s, trader as never, 0, 40, NIGHT, 0);
    expect(r).toEqual({ ok: false, reason: 'noCash' });
    s.cashCents = 0;
    restockFence(BAYFIELD, s, NIGHT + WEEK);
    expect(s.cashCents).toBe(BAYFIELD.weeklyCashCents);
  });
});

/** A running game at a port: economy, shipyard, law, the back room and the port screen. */
function game(at: number, fame = UNKNOWN) {
  const state = createWorldState('back-room', at);
  state.fame.value = fame;
  const ctx = {
    state,
    world: createGameWorld(),
    events: new EventBus<GameEvents>(),
  } as unknown as GameContext;
  const schooner = createSchooner(0, 0, 0);
  const economy = attachEconomy(ctx, schooner.hazards);
  const lawDefs = gameLaw();
  const shipyard = attachShipyard({
    ctx,
    economy,
    sailing: schooner.sailing,
    hazards: schooner.hazards,
    buoyancy: schooner.buoyancy,
    handling: schooner.handling,
    rules: schooner.hazardRules,
    onHullChanged: () => undefined,
    fameTier: () => (state.fame.value >= 150 ? 2 : state.fame.value >= 50 ? 1 : 0),
  });
  const law = attachLaw(ctx, 'seed', lawDefs);
  const portLaw = attachPortLaw(ctx, law, economy);
  const backRoom = attachBackRoom({
    ctx,
    economy,
    shipyard,
    informRisk: (port) => {
      const region = portLaw.regionOf(port);
      return region ? portLaw.informRisk(region) : undefined;
    },
  });
  const shown: (PortSnapshot | undefined)[] = [];
  const ports = attachPorts({
    ctx,
    economy,
    hazards: schooner.hazards,
    shipyard,
    law: portLaw,
    backRoom,
    rumors: undefined,
    berthPier: () => undefined,
    showPort: (s) => shown.push(s),
    showJournal: () => undefined,
    onOpen: () => undefined,
    castOff: () => undefined,
  });
  const seen: string[] = [];
  ctx.events.tap((type) => seen.push(type));
  return { state, ctx, economy, shipyard, law, portLaw, backRoom, ports, shown, seen };
}

describe('the back room on the port screen (decision 1 of plan 07 §14.6)', () => {
  it('shows a Back room tab at Bayfield after dark, not by day', () => {
    const day = game(NOON);
    day.ports.open('port.bayfield');
    expect(day.shown.at(-1)?.tabs).not.toContain('backRoom');
    expect(day.backRoom.hint('port.bayfield')).toMatch(/after dark/);
    const night = game(NIGHT);
    night.ports.open('port.bayfield');
    const snap = night.shown.at(-1);
    expect(snap?.tabs).toContain('backRoom');
    expect(snap?.backRoom?.name).toBe(BAYFIELD.name);
    expect(snap?.backRoom?.wants).toMatch(/fish/);
    // Only the shady shipwright's gear: nothing a shipyard sells.
    expect(snap?.backRoom?.shipwright?.upgrades.every((u) => u.category !== 'hull')).toBe(true);
  });

  it('keeps the Duluth room shut, without a word, until you are Known', () => {
    const g = game(NIGHT, UNKNOWN);
    g.ports.open('port.duluth');
    expect(g.shown.at(-1)?.tabs).not.toContain('backRoom');
    expect(g.backRoom.hint('port.duluth')).toBeUndefined();
    const known = game(NIGHT, KNOWN_FAME);
    known.ports.open('port.duluth');
    expect(known.shown.at(-1)?.backRoom?.fence).toBe(DULUTH.id);
    // No back room where there's no fence.
    known.ports.open('port.ashland');
    expect(known.shown.at(-1)?.tabs).not.toContain('backRoom');
  });

  it('sells a hot lot to the fence and raises FenceDealt', () => {
    const g = game(NIGHT);
    g.state.player.cargo = [hot('good.furs', 4)];
    g.ports.open('port.bayfield');
    const lot = g.shown.at(-1)?.backRoom?.lots[0];
    expect(lot).toMatchObject({ good: 'good.furs', ratePct: 40, offLine: false });
    const dealt: unknown[] = [];
    g.ctx.events.on('FenceDealt', (e) => dealt.push(e));
    expect(g.ports.actions.fence?.(lot?.index ?? 0, 4)).toMatch(/counts out/);
    expect(dealt).toEqual([
      expect.objectContaining({ fence: BAYFIELD.id, port: 'port.bayfield', qty: 4, hot: true }),
    ]);
    expect(g.state.player.cargo).toHaveLength(0);
    expect(g.state.contraband?.fences?.[BAYFIELD.id]?.dealtCents).toBeGreaterThan(0);
    expect(g.shown.at(-1)?.backRoom?.cashCents).toBeLessThan(BAYFIELD.weeklyCashCents);
  });

  it('has no informant below tier 2; at high Wanted he may sell you out', () => {
    const quiet = game(NIGHT);
    quiet.state.player.cargo = [hot('good.furs', 1)];
    quiet.ports.open('port.bayfield');
    quiet.ports.actions.fence?.(0, 1);
    expect(quiet.seen).not.toContain('CrimeCommitted');

    // Find a night when the fence talks at tier 4, then deal that night.
    const p = informChance(gameLaw(), 4);
    expect(p).toBeGreaterThan(0);
    let t = NIGHT;
    for (let n = 0; n < 60; n++) {
      t = NIGHT + n * WEEK;
      if (informRoll('seed', BAYFIELD.id, nightOf(t), 'fence') < p) break;
    }
    const g = game(t);
    g.law.setTier('region.chequamegon', 4);
    g.state.player.cargo = [hot('good.furs', 2, t)];
    g.ports.open('port.bayfield');
    expect(g.shown.at(-1)?.backRoom?.informRisk).toBeTruthy();
    g.ports.actions.fence?.(0, 1);
    expect(g.seen).toContain('CrimeCommitted');
    // The same night's business is one deal to the law.
    const crimes = g.seen.filter((s) => s === 'CrimeCommitted').length;
    g.ports.actions.fence?.(0, 1);
    expect(g.seen.filter((s) => s === 'CrimeCommitted').length).toBe(crimes);
  });

  it('mounts a bow swivel tonight, and refuses a gun the hull has no mount for', () => {
    // Known, so the fame check passes and the hull's tier is what refuses the cannon pair.
    const g = game(NIGHT, KNOWN_FAME);
    g.state.player.purse = 100_000;
    g.ports.open('port.bayfield');
    const guns = g.shown.at(-1)?.backRoom?.guns ?? [];
    expect(guns.find((x) => x.id === 'gun.light_cannon_pair')?.refusal).toBe(
      "She's too small to carry it.",
    );
    expect(guns.find((x) => x.id === 'gun.bow_swivel')?.refusal).toBeUndefined();
    const before = g.state.environment.clock.gameSeconds;
    expect(g.ports.actions.buyGun?.('gun.bow_swivel')).toMatch(/Mounted/);
    expect(g.state.player.ship?.weapons).toContainEqual({ weapon: 'weapon.swivel', mount: 'bow' });
    // Mounted by the combat core's own rules: a second swivel has no bow to go in.
    expect(g.ports.actions.buyGun?.('gun.bow_swivel')).toMatch(/No room/);
    // The guns are the shipwright's: the yard's upgrade list has none.
    expect(g.shown.at(-1)?.backRoom?.shipwright?.upgrades.map((u) => u.id)).not.toContain(
      'upgrade.bow_swivel',
    );
    expect(g.state.environment.clock.gameSeconds).toBe(before);
    // A gun is aboard now, so the sights fit in the back room (no message on success).
    expect(g.ports.actions.fit('upgrade.gun_sights', 'backRoom')).toBeUndefined();
    // By day the shipwright is shut, and his gun counter with him.
    g.state.environment.clock.gameSeconds = NOON;
    expect(g.ports.actions.buyGun?.('gun.bow_swivel')).toMatch(/shut/);
  });
});

describe('the shady shipwright (plan 10 §5.4, §6; plan 07 piece A)', () => {
  const owner = () => ({ purse: 1_000_000, cargo: [], stores: {} });
  const cannon = gameGuns().find((g) => g.id === 'gun.light_cannon_pair');
  const swivel = gameGuns().find((g) => g.id === 'gun.bow_swivel');

  it('sells the guns from guns.json, and the gun work from upgrades.json', () => {
    const shady = [...upgradeDefs().values()].filter((u) => u.sources.includes('backRoom'));
    expect(shady.map((u) => u.id).sort()).toEqual(
      [
        'upgrade.bored_barrels',
        'upgrade.gun_sights',
        'upgrade.hidden_gun_ports',
        'upgrade.improved_carriages',
      ].sort(),
    );
    expect(
      gameGuns()
        .map((g) => g.weapon)
        .sort(),
    ).toEqual(['weapon.light_cannon', 'weapon.swivel'].sort());
    expect(cannon?.fameTier).toBe(2);
    expect(cannon?.mounts).toEqual(['port', 'starboard']);
    expect(swivel?.mounts).toEqual(['bow']);
  });

  it('gates the cannon on Known and the T2, and the mods on a gun aboard', () => {
    if (!cannon || !swivel) throw new Error('no guns');
    const t1 = defaultShipState(T1_SCHOONER_ID);
    const t2 = defaultShipState(T2_SCHOONER_ID);
    expect(gunRefusal(defs, owner(), t1, cannon, 'port.bayfield', 4)).toBe('hull');
    expect(gunRefusal(defs, owner(), t2, cannon, 'port.bayfield', 1)).toBe('fame');
    expect(gunRefusal(defs, owner(), t2, cannon, 'port.bayfield', 2)).toBeUndefined();
    const sights = upgradeDefs().get('upgrade.gun_sights');
    if (!sights) throw new Error('no sights');
    expect(fitRefusal(owner(), t1, sights, 'backRoom', 1, 0)).toBe('noGun');
    expect(fitRefusal(owner(), t1, sights, 'shipyard', 1, 0)).toBe('notHere');
  });

  it('mounts a pair of cannon on the T2 and counts their room', () => {
    const t2 = defaultShipState(T2_SCHOONER_ID);
    const o = owner();
    expect(buyGun(defs, o, t2, 'port.bayfield', 'gun.light_cannon_pair', 2).ok).toBe(true);
    expect(t2.weapons.map((w) => w.mount).sort()).toEqual(['hand', 'port', 'starboard']);
    // The T2's broadside holds two a side: a second pair has room, a third would not.
    expect(buyGun(defs, o, t2, 'port.bayfield', 'gun.light_cannon_pair', 2).ok).toBe(true);
    expect(buyGun(defs, o, t2, 'port.bayfield', 'gun.light_cannon_pair', 2)).toEqual({
      ok: false,
      reason: 'noRoom',
    });
  });

  it('moves guns to a new hull that can carry them; the mods come only with a gun', () => {
    const t2 = defaultShipState(T2_SCHOONER_ID);
    t2.weapons = [
      { weapon: 'weapon.swivel', mount: 'bow' },
      { weapon: 'weapon.light_cannon', mount: 'port' },
      { weapon: 'weapon.light_cannon', mount: 'starboard' },
    ];
    t2.upgrades = ['upgrade.hidden_gun_ports', 'upgrade.gun_sights'];
    // Down to the T1: its one bow mount takes the swivel, so the gun sights go with it; the
    // cannon stay ashore. Hidden gun ports never move: they stay with the old hull.
    expect(movingUpgrades(t2, sailShipRecord(T1_SCHOONER_ID))).toEqual(['upgrade.gun_sights']);
    expect(
      movingUpgrades({ ...t2, upgrades: ['upgrade.gun_sights'] }, sailShipRecord(T1_SCHOONER_ID)),
    ).toEqual(['upgrade.gun_sights']);
    // The gun sights go with the swivel on the T1; the hidden ports don't.
    const t1 = { ...t2, weapons: [{ weapon: 'weapon.swivel', mount: 'bow' as const }] };
    expect(
      movingUpgrades(
        { ...t1, upgrades: ['upgrade.gun_sights', 'upgrade.hidden_gun_ports'] },
        sailShipRecord(T1_SCHOONER_ID),
      ),
    ).toEqual(['upgrade.gun_sights']);
    // Without a gun, a mod stays behind.
    const bare = { ...t2, weapons: [] };
    expect(
      movingUpgrades({ ...bare, upgrades: ['upgrade.gun_sights'] }, sailShipRecord(T1_SCHOONER_ID)),
    ).toEqual([]);
  });

  it('counts mods only as multipliers on the guns', () => {
    expect(gunModsOf(['upgrade.improved_carriages']).reloadMul).toBeCloseTo(0.8);
    const a = gunModsOf([
      'upgrade.improved_carriages',
      'upgrade.bored_barrels',
      'upgrade.hidden_gun_ports',
    ]);
    expect(a.reloadMul).toBeCloseTo(0.8);
    expect(a.rangeMul).toBeCloseTo(1.2);
    expect(a.looksUnarmed).toBe(true);
  });
});

describe('powder and shot at the chandlery', () => {
  it('sells black powder by the keg until a WANTED poster is up', () => {
    const g = game(NOON);
    g.state.player.purse = 100_000;
    g.ports.open('port.bayfield');
    const row = g.shown.at(-1)?.market.find((r) => r.good === 'good.powder_shot');
    expect(row?.restricted).toBeUndefined();
    expect(g.ports.actions.buy('good.powder_shot', 2)).toBeUndefined();
    expect(g.state.player.cargo.find((s) => s.good === 'good.powder_shot')?.qty).toBe(2);
    g.law.setTier('region.chequamegon', 2);
    g.ports.open('port.bayfield');
    const refused = g.shown.at(-1)?.market.find((r) => r.good === 'good.powder_shot');
    expect(refused?.restricted).toMatch(/powder/);
    expect(refused?.maxBuy).toBe(0);
    expect(g.ports.actions.buy('good.powder_shot', 1)).toMatch(/powder/);
    // Other goods sell as ever.
    expect(g.ports.actions.buy('good.flour', 1)).toBeUndefined();
  });
});

describe('more than one smuggler (plan 07 §14.6.1)', () => {
  const siskiwit = smugglerById('smuggler.siskiwit');

  it('lists the island smuggler first and the Siskiwit Bay boat second', () => {
    expect(gameSmugglers().map((s) => s.id)).toEqual(['smuggler.island', 'smuggler.siskiwit']);
    expect(gameSmuggler().id).toBe('smuggler.island');
    expect(siskiwit?.anchorage.zone).toBe('zone.siskiwit');
    expect(siskiwit?.anchorage.region).toBe('region.south_shore_west');
  });

  it('keeps her out of the world until her zone is built', () => {
    expect(smugglerInWorld(gameSmuggler())).toBe(true);
    if (!siskiwit) throw new Error('no Siskiwit smuggler');
    expect(smugglerInWorld(siskiwit)).toBe(false);
    expect(smugglersInWorld().map((s) => s.id)).toEqual(['smuggler.island']);
  });

  it('keeps each boat its own cash, stock, trust and known anchorage, through a save', () => {
    if (!siskiwit) throw new Error('no Siskiwit smuggler');
    const c = freshContrabandState(NIGHT);
    const island = smugglerStateOf(c, gameSmuggler(), NIGHT);
    const gannet = smugglerStateOf(c, siskiwit, NIGHT);
    expect(island).toBe(c.smuggler);
    expect(gannet).not.toBe(island);
    expect(gannet.cashCents).toBe(siskiwit.weeklyCashCents);
    gannet.dealtCents = 1234;
    expect(learnAnchorage(c, siskiwit)).toBe(true);
    expect(learnAnchorage(c, siskiwit)).toBe(false);
    expect(knowsAnchorage(c, 'deckhand', false, siskiwit)).toBe(true);
    expect(knowsAnchorage(c, 'deckhand', false, gameSmuggler())).toBe(false);
    expect(knowsAnchorage(undefined, 'lumberjack', false, siskiwit)).toBe(true);

    const state = createWorldState('boats', NIGHT);
    state.contraband = c;
    const back = parseWorldState(JSON.parse(JSON.stringify(state)));
    expect(back.contraband?.boats?.['smuggler.siskiwit']?.dealtCents).toBe(1234);
    expect(back.contraband?.knownBoats).toEqual(['smuggler.siskiwit']);
    // A 0.5.0 save has neither: it loads with no boats and no fences.
    const old = JSON.parse(JSON.stringify(createWorldState('old', NIGHT)));
    delete old.contraband.boats;
    delete old.contraband.knownBoats;
    delete old.contraband.fences;
    expect(parseWorldState(old).contraband?.boats).toBeUndefined();
  });

  it('drives every boat as one: the zone and the clock to all, F to the one in hail', () => {
    if (!siskiwit) throw new Error('no Siskiwit smuggler');
    const state = createWorldState('two-boats', NIGHT);
    const ctx = {
      state,
      world: createGameWorld(),
      events: new EventBus<GameEvents>(),
    } as unknown as GameContext;
    const { hazards } = createSchooner(0, 0, 0);
    const economy = attachEconomy(ctx, hazards);
    const shown: (string | undefined)[] = [];
    const all = attachSmugglers({
      ctx,
      economy,
      defs: gameSmugglers(),
      show: (s, def) => shown.push(s ? def.id : undefined),
      onOpen: () => undefined,
      heardOf: () => true,
    });
    expect(all.all).toHaveLength(2);
    // The rumor is of the island smuggler only.
    expect(all.all[0]?.known()).toBe(true);
    expect(all.all[1]?.known()).toBe(false);
    expect(all.marks().map((m) => m.def.id)).toEqual(['smuggler.island']);
    const frame = { origin: { x: -204333, y: -73945 }, compression: 8 };
    all.setZone({ id: 'zone.siskiwit', frame });
    expect(all.def.id).toBe('smuggler.siskiwit');
    const a = all.anchorage;
    if (!a) throw new Error('no anchorage');
    all.step(a);
    expect(all.present).toBe(true);
    expect([...ctx.world.entities].some((e) => e.id === 'npc.smuggler.siskiwit')).toBe(true);
    expect(all.comeAlongside({ x: a.x + 30, z: a.z }, 0)).toBeUndefined();
    expect(shown.at(-1)).toBe('smuggler.siskiwit');
    expect(all.actions.buy('good.untaxed_whiskey', 2)).toMatch(/2 CU/);
    expect(state.contraband?.boats?.['smuggler.siskiwit']?.dealtCents).toBeGreaterThan(0);
    expect(state.contraband?.smuggler.dealtCents).toBe(0);
    all.close();
    expect(all.open).toBe(false);
  });
});
