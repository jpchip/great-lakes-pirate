import { describe, expect, it } from 'vitest';
import { EventBus } from '../src/core/events';
import { Rng } from '../src/core/rng';
import { attachCombat, PLAYER_ID } from '../src/gameplay/combat';
import {
  cloneTransform,
  createGameWorld,
  snapshotTransforms,
  velocitySystem,
  type Entity,
} from '../src/gameplay/ecs';
import type { ShipHazards } from '../src/gameplay/hazards';
import { createNpcShipEntity } from '../src/gameplay/npc-ships';
import type { GameContext, GameEvents } from '../src/modes/context';
import {
  chargesAvailable,
  fitRefusal,
  fittingWeapons,
  inArc,
  muzzlesLocal,
  reloadSeconds,
  spendCharges,
} from '../src/sim/combat/armament';
import {
  elevationFor,
  launchVelocity,
  leadSolution,
  positionAt,
  rangeFor,
  timeToWater,
} from '../src/sim/combat/ballistics';
import {
  applyHit,
  createShipDamage,
  DAMAGE_RULES,
  explodeBoiler,
  speedFactor,
  stepFoundering,
  type Random,
} from '../src/sim/combat/damage';
import { ammoDef, damageOf, gameCombat, weaponDef } from '../src/sim/combat/defs';
import { hitTest, hullShape, toLocal, toWorld } from '../src/sim/combat/hull';
import { ShotField } from '../src/sim/combat/shots';
import type { Hold } from '../src/sim/economy/hold';
import { SHIP_RECORDS } from '../src/sim/sailing/ships';
import { buyHull, defaultShipState } from '../src/sim/shipyard/shipyard';
import { createWorldState } from '../src/sim/world-state';
import { gameEconomy } from '../src/sim/economy/defs';

const DEG = Math.PI / 180;
const defs = gameCombat();
const record = (id: string) => {
  const r = SHIP_RECORDS.find((s) => s.id === id);
  if (!r) throw new Error(id);
  return r;
};
/** A random source that always says `v`. */
const always = (v: number): Random => ({ next: () => v });

describe('guns and shot data (plan 07 §2)', () => {
  it("has the swivel, the light cannon, the rifle and the cutter's gun, each in reach of its muzzle", () => {
    expect([...defs.weapons.keys()]).toEqual([
      'weapon.swivel',
      'weapon.light_cannon',
      'weapon.rifle',
      'weapon.cutter_gun',
    ]);
    for (const w of defs.weapons.values()) {
      expect(rangeFor(w.muzzleMs, 45 * DEG, 2)).toBeGreaterThanOrEqual(w.rangeM);
    }
  });

  it('arms the T1 at the bow only and the T2 with two guns a side (§2.3)', () => {
    expect(defs.mounts['ship.t1_schooner']).toEqual({ bow: 1, broadside: 0, hand: 1 });
    expect(defs.mounts['ship.t2_schooner']?.broadside).toBe(2);
  });

  it('fires a warning shot as round shot, and grape only from the swivel', () => {
    expect(damageOf(defs, 'weapon.swivel', 'ammo.warning')).toEqual(
      damageOf(defs, 'weapon.swivel', 'ammo.round'),
    );
    expect(weaponDef(defs, 'weapon.light_cannon').ammo).not.toContain('ammo.grape');
    expect(ammoDef(defs, 'ammo.chain').nonLethal).toBe(true);
  });
});

describe('ballistics (plan 07 §4.1)', () => {
  it('finds the elevation that drops a shot at a range, and the arc lands there', () => {
    for (const range of [60, 150, 300]) {
      const e = elevationFor(range, 60, 2.5);
      expect(e).toBeDefined();
      const v = launchVelocity(60, 0.7, e as number);
      const t = timeToWater(2.5, v.y);
      const p = positionAt({ x: 0, y: 2.5, z: 0 }, v, t);
      expect(Math.hypot(p.x, p.z)).toBeCloseTo(range, 0);
      expect(p.y).toBeCloseTo(0, 6);
    }
    expect(elevationFor(5000, 60, 2.5)).toBeUndefined();
  });

  it('leads a moving ship so the shot falls where she will be', () => {
    const target = { x: 0, z: -250, vx: 12, vz: 0 };
    const muzzle = { x: 0, y: 2, z: 0 };
    const sol = leadSolution(muzzle, { x: 0, z: 0 }, target, 60);
    expect(sol).toBeDefined();
    if (!sol) return;
    const v = launchVelocity(60, sol.bearing, sol.elevation);
    const p = positionAt(muzzle, v, sol.flightS);
    expect(p.x).toBeCloseTo(target.x + target.vx * sol.flightS, 0);
    expect(p.z).toBeCloseTo(target.z, 0);
  });
});

describe('hull boxes and hit locations (plan 07 §4.1, 02 §6.3)', () => {
  const tug = hullShape(record('ship.fish_tug'));
  const barge = hullShape(record('ship.schooner_barge'));
  const pose = { x: 100, y: 0, z: -40, heading: 30 * DEG };

  it('maps points to her frame and back', () => {
    const p = { x: 113, y: 1.5, z: -61 };
    const back = toWorld(toLocal(p, pose), pose);
    expect(back.x).toBeCloseTo(p.x);
    expect(back.z).toBeCloseTo(p.z);
    // Her bow is ahead along her heading.
    const bow = toWorld({ x: 0, y: 0, z: 10 }, pose);
    expect(bow.x).toBeCloseTo(100 + Math.sin(pose.heading) * 10);
    expect(bow.z).toBeCloseTo(-40 - Math.cos(pose.heading) * 10);
  });

  const across = (y: number, v = 0, shape = barge) => {
    const a = toWorld({ x: -30, y, z: v }, pose);
    const b = toWorld({ x: 30, y, z: v }, pose);
    return hitTest(a, b, shape, pose);
  };

  it('tells the waterline, the hull, the deck and the rigging apart', () => {
    expect(across(0.2)?.location).toBe('waterline');
    expect(across(barge.freeboardM * 0.8)?.location).toBe('hull');
    expect(across(barge.freeboardM + 1)?.location).toBe('deck');
    expect(across(barge.freeboardM + barge.deckM + 5)?.location).toBe('rigging');
    expect(across(barge.topM + 2)).toBeUndefined();
    // Past her ends, nothing.
    expect(across(1, barge.halfLength + 3)).toBeUndefined();
  });

  it("puts a steamer's funnel and engine midships to aft", () => {
    const high = tug.freeboardM + tug.deckM + 2;
    expect(across(high, -tug.halfLength * 0.2, tug)?.location).toBe('engine');
    // Her bow is near her side; the shot strikes on the side it came from.
    const hit = across(1, 0, tug);
    expect(hit?.local.x).toBeCloseTo(-tug.halfBeam);
  });
});

describe('shot in flight', () => {
  const tug = hullShape(record('ship.fish_tug'));

  it('strikes a ship in its path, falls in the sea past her, and never strikes its own ship', () => {
    const field = new ShotField();
    const muzzle = { x: 0, y: 2, z: 0 };
    const e = elevationFor(150, 60, 2) as number;
    field.add({
      shooter: 'a',
      weapon: 'weapon.swivel',
      ammo: 'ammo.round',
      pos: muzzle,
      vel: launchVelocity(60, 0, e),
    });
    // A shot laid well past her, short of nothing.
    field.add({
      shooter: 'a',
      weapon: 'weapon.swivel',
      ammo: 'ammo.round',
      pos: muzzle,
      vel: launchVelocity(60, 90 * DEG, e),
    });
    const targets = [
      { id: 'tug', shape: tug, pose: { x: 0, y: 0, z: -150, heading: 90 * DEG } },
      { id: 'a', shape: tug, pose: { x: 0, y: 0, z: 0, heading: 0 } },
    ];
    const ends = [];
    for (let i = 0; i < 400 && field.live.length > 0; i++)
      ends.push(...field.step(1 / 30, targets));
    const hit = ends.find((x) => x.kind === 'hit');
    expect(hit && hit.kind === 'hit' && hit.target).toBe('tug');
    const splash = ends.find((x) => x.kind === 'water');
    expect(splash?.at.x).toBeCloseTo(150, -1);
    expect(ends).toHaveLength(2);
  });
});

describe('damage pools (plan 07 §4.2)', () => {
  const round = ammoDef(defs, 'ammo.round');
  const chain = ammoDef(defs, 'ammo.chain');
  const grape = ammoDef(defs, 'ammo.grape');
  const swivel = (a: string) => damageOf(defs, 'weapon.swivel', a);

  it('holes her worse at the waterline, and leaks slow her', () => {
    const a = createShipDamage(record('ship.schooner_barge'), 7);
    const b = createShipDamage(record('ship.schooner_barge'), 7);
    applyHit(a, 'hull', swivel('ammo.round'), round, always(0.99));
    applyHit(b, 'waterline', swivel('ammo.round'), round, always(0.99));
    expect(a.hullMax - a.hull).toBe(14);
    expect(b.hullMax - b.hull).toBe(21);
    expect(speedFactor(b)).toBeLessThan(1);
  });

  it("chain shot tears a sailing ship's rig and slows her, killing nobody", () => {
    const d = createShipDamage(record('ship.schooner_barge'), 7);
    for (let i = 0; i < 20; i++) applyHit(d, 'rigging', swivel('ammo.chain'), chain, always(0.5));
    expect(d.rigging).toBe(0);
    expect(d.killed).toBe(0);
    expect(speedFactor(d)).toBeCloseTo(DAMAGE_RULES.bareRigSpeed, 5);
  });

  it('grape sweeps her deck: hands killed and wounded, counted', () => {
    const d = createShipDamage(record('ship.fish_tug'), 5);
    const rng = Rng.fromSeed('grape');
    let killed = 0;
    let wounded = 0;
    for (let i = 0; i < 3; i++) {
      const r = applyHit(d, 'deck', swivel('ammo.grape'), grape, rng);
      killed += r.killed;
      wounded += r.wounded;
    }
    expect(killed + wounded).toBeGreaterThan(0);
    expect(d.killed).toBe(killed);
    expect(d.wounded).toBe(wounded);
    expect(d.crew).toBe(5 - killed - wounded);
  });

  it("stops a steamer when her engine's wrecked", () => {
    const d = createShipDamage(record('ship.package_steamer'), 28);
    expect(d.engineMax).toBe(Math.round(500 * DAMAGE_RULES.engineShareOfHull));
    for (let i = 0; i < 20; i++) {
      applyHit(
        d,
        'engine',
        damageOf(defs, 'weapon.light_cannon', 'ammo.round'),
        round,
        always(0.99),
      );
    }
    expect(d.engine).toBe(0);
    expect(d.boilerExploded).toBe(false);
    expect(speedFactor(d)).toBe(0);
  });

  it('bursts her boiler at critical engine damage, by chance (kept 2026-10-21)', () => {
    const d = createShipDamage(record('ship.fish_tug'), 5);
    d.engine = d.engineMax * 0.2;
    const r = applyHit(d, 'engine', swivel('ammo.round'), round, always(0.01));
    expect(r.boiler?.killed).toBeGreaterThan(0);
    expect(d.boilerExploded).toBe(true);
    expect(d.engine).toBe(0);
    expect(explodeBoiler(d, always(0.01))).toBeUndefined();
  });

  it('founders at hull 0 and goes under after a while', () => {
    const d = createShipDamage(record('ship.fish_tug'), 5);
    d.hull = 5;
    const r = applyHit(d, 'hull', swivel('ammo.round'), round, always(0.99));
    expect(r.foundering).toBe(true);
    expect(speedFactor(d)).toBe(0);
    expect(stepFoundering(d, DAMAGE_RULES.founderS - 1)).toBe(false);
    expect(stepFoundering(d, 1.5)).toBe(true);
    expect(d.sunk).toBe(true);
  });
});

describe('the guns aboard (plan 07 §2.3, §14.5)', () => {
  it("starts every run with small arms and no ship's guns", () => {
    expect(defaultShipState().weapons).toEqual([{ weapon: 'weapon.rifle', mount: 'hand' }]);
    expect(createWorldState('x').player.ammo).toEqual({ charges: 0 });
  });

  it('mounts a swivel at the T1 bow, but no broadside', () => {
    const t1 = 'ship.t1_schooner';
    expect(fitRefusal(defs, t1, [], 'weapon.swivel', 'bow')).toBeUndefined();
    expect(
      fitRefusal(defs, t1, [{ weapon: 'weapon.swivel', mount: 'bow' }], 'weapon.swivel', 'bow'),
    ).toBe('noRoom');
    expect(fitRefusal(defs, t1, [], 'weapon.light_cannon', 'port')).toBe('noRoom');
    expect(fitRefusal(defs, t1, [], 'weapon.swivel', 'port')).toBe('wrongMount');
    expect(fitRefusal(defs, 'ship.t2_schooner', [], 'weapon.light_cannon', 'port')).toBeUndefined();
  });

  it('leaves the cannon ashore on a trade down to a T1', () => {
    const kept = fittingWeapons(defs, 'ship.t1_schooner', [
      { weapon: 'weapon.swivel', mount: 'bow' },
      { weapon: 'weapon.light_cannon', mount: 'port' },
      { weapon: 'weapon.rifle', mount: 'hand' },
    ]);
    expect(kept.map((w) => w.weapon)).toEqual(['weapon.swivel', 'weapon.rifle']);
  });

  it('keeps her guns through the shipyard when the new hull has room', () => {
    const state = createWorldState('yard');
    state.player.purse = 1_000_000;
    const ship = state.player.ship ?? defaultShipState();
    ship.weapons.push({ weapon: 'weapon.swivel', mount: 'bow' });
    const r = buyHull(
      gameEconomy(),
      state.markets,
      state.player,
      ship,
      'port.bayfield',
      'ship.t2_schooner',
      0,
    );
    expect(r.ok).toBe(true);
    expect(ship.weapons.map((w) => w.weapon)).toContain('weapon.swivel');
  });

  it('lays a broadside within 15° of the beam, and the swivel 60° off the bow', () => {
    const cannon = weaponDef(defs, 'weapon.light_cannon');
    const swivel = weaponDef(defs, 'weapon.swivel');
    expect(inArc(cannon, 'starboard', 100 * DEG)).toBe(true);
    expect(inArc(cannon, 'starboard', 120 * DEG)).toBe(false);
    expect(inArc(cannon, 'port', -80 * DEG)).toBe(true);
    expect(inArc(swivel, 'bow', -55 * DEG)).toBe(true);
    expect(inArc(swivel, 'bow', 70 * DEG)).toBe(false);
  });

  it('loads faster crewed, and the Ex-Navy loads the swivel faster still', () => {
    const swivel = weaponDef(defs, 'weapon.swivel');
    expect(reloadSeconds(swivel, false, false)).toBe(6);
    expect(reloadSeconds(swivel, true, false)).toBe(4);
    expect(reloadSeconds(swivel, false, true)).toBeCloseTo(4.8);
  });

  it('burns powder by the charge, opening kegs from the hold, clean ones first', () => {
    const hold: Hold = [
      {
        good: 'good.powder_shot',
        qty: 1,
        hot: { region: 'r', heat: 1, traceability: 1, since: 0 },
      },
      { good: 'good.powder_shot', qty: 1 },
    ];
    const ammo = { charges: 0 };
    expect(chargesAvailable(defs, hold, ammo)).toBe(20);
    expect(spendCharges(defs, hold, ammo, 4)).toBe(true);
    expect(ammo.charges).toBe(6);
    expect(hold).toHaveLength(1);
    expect(hold[0]?.hot).toBeDefined();
    expect(spendCharges(defs, hold, ammo, 30)).toBe(false);
    expect(ammo.charges).toBe(6);
  });
});

describe('combat in play', () => {
  const setup = (classId = 'ship.fish_tug', distance = 150) => {
    const state = createWorldState('combat');
    const events = new EventBus<GameEvents>();
    const world = createGameWorld();
    const ctx = { state, events, world, rng: Rng.fromSeed('combat') } as unknown as GameContext;
    const transform = { position: { x: 0, y: 0, z: 0 }, heading: 0 };
    const player: Entity = world.add({
      id: PLAYER_ID,
      transform,
      previousTransform: cloneTransform(transform),
      playerControlled: true,
    });
    const hazards = {
      cls: { hullHP: 100, riggingHP: 80 },
      state: { hull: 100, rigging: 80 },
    } as unknown as ShipHazards;
    // Lying stopped, broadside on, dead ahead.
    const npc = createNpcShipEntity(record(classId), 0, -distance, 90 * DEG, 0);
    npc.id = 'npc.target';
    world.add(npc);
    let onTimetable = true;
    const combat = attachCombat({
      ctx,
      player,
      hazards,
      arena: () => undefined,
      zoneShips: () => (world.has(npc) ? [npc] : []),
      hold: () => {
        onTimetable = false;
        return npc;
      },
      zoneLand: () => undefined,
      isLawShip: () => false,
    });
    const seen: { type: keyof GameEvents; payload: unknown }[] = [];
    events.tap((type, payload) => seen.push({ type, payload }));
    const run = (seconds: number) => {
      for (let t = 0; t < seconds; t += 1 / 30) {
        snapshotTransforms(world);
        combat.step(1 / 30);
        velocitySystem(world, 1 / 30);
      }
    };
    return { state, world, player, npc, combat, seen, run, hazards, timetable: () => onTimetable };
  };

  it("won't fire unarmed, or without powder", () => {
    const { combat, state } = setup();
    // Small arms only: no gun takes round shot.
    expect(combat.fire({ ammo: 'ammo.round', target: 'npc.target' })).toEqual({
      ok: false,
      reason: 'wrongAmmo',
    });
    state.player.ship?.weapons.push({ weapon: 'weapon.swivel', mount: 'bow' });
    expect(combat.fire({ ammo: 'ammo.round', target: 'npc.target' })).toEqual({
      ok: false,
      reason: 'noPowder',
    });
  });

  it('lays the swivel on a tug, hits her, and takes it off her hull or works', () => {
    const { combat, state, seen, run, npc, timetable } = setup();
    state.player.ship?.weapons.push({ weapon: 'weapon.swivel', mount: 'bow' });
    state.player.cargo.push({ good: 'good.powder_shot', qty: 1 });

    for (let i = 0; i < 6; i++) {
      const r = combat.fire({ ammo: 'ammo.round', target: 'npc.target' });
      expect(r.ok).toBe(true);
      expect(combat.fire({ ammo: 'ammo.round', target: 'npc.target' })).toEqual({
        ok: false,
        reason: 'reloading',
      });
      run(6.1);
    }
    const hits = seen.filter((s) => s.type === 'ShipHit').length;
    expect(seen.filter((s) => s.type === 'WeaponFired')).toHaveLength(6);
    expect(seen.filter((s) => s.type === 'ShotLanded')).toHaveLength(6);
    // A laid swivel at 150 m mostly hits a tug lying broadside on.
    expect(hits).toBeGreaterThanOrEqual(3);
    const d = npc.damage;
    expect(d && d.hull + d.engine).toBeLessThan((d?.hullMax ?? 0) + (d?.engineMax ?? 0));
    expect(timetable()).toBe(false);
    expect(state.player.ammo.charges).toBe(4);
  });

  it('lets a hulled ship founder and go under, and raises it', () => {
    const { combat, seen, run, world, npc } = setup();
    combat.damage('npc.target', 'hull', 1000);
    expect(seen.some((s) => s.type === 'ShipFoundering')).toBe(true);
    run(DAMAGE_RULES.founderS + 1);
    const sunk = seen.find((s) => s.type === 'ShipSunk')?.payload as GameEvents['ShipSunk'];
    expect(sunk.shipId).toBe('npc.target');
    expect(sunk.crewAboard).toBe(5);
    expect(world.has(npc)).toBe(false);
  });

  it("damages the player's ship when a shot finds her", () => {
    const { combat, npc, run, hazards, seen } = setup('ship.cutter_morrill', 200);
    // The cutter's gun, fired back down the bearing at the player (piece F lays it for real).
    const shape = hullShape(record('ship.cutter_morrill'));
    const muzzle = toWorld(muzzlesLocal(shape, 'bow', 1)[0] ?? { x: 0, y: 0, z: 0 }, {
      x: 0,
      y: 0,
      z: -200,
      heading: 90 * DEG,
    });
    const sol = leadSolution(muzzle, { x: 0, z: 0 }, { x: 0, z: 0, vx: 0, vz: 0 }, 76);
    if (!sol) throw new Error('no solution');
    for (let i = 0; i < 4; i++) {
      expect(
        combat.fireFrom(npc, 'weapon.light_cannon', 'ammo.round', sol.bearing, sol.elevation + 0.01)
          .ok,
      ).toBe(true);
      run(12.1);
    }
    const hits = seen
      .filter((s) => s.type === 'ShipHit')
      .map((s) => s.payload as GameEvents['ShipHit']);
    expect(hits.length).toBeGreaterThan(0);
    expect(hits.every((h) => h.shipId === PLAYER_ID && h.by === 'npc.target')).toBe(true);
    expect(hazards.state.hull + hazards.state.rigging).toBeLessThan(180);
  });

  it('counts the dead of a boiler burst as casualties, lethal', () => {
    const { combat, seen } = setup();
    expect(combat.explode('npc.target')).toBe(true);
    const c = seen.find((s) => s.type === 'CrewCasualties')
      ?.payload as GameEvents['CrewCasualties'];
    expect(c.cause).toBe('boiler');
    expect(c.lethal).toBe(true);
    expect(seen.some((s) => s.type === 'BoilerExploded')).toBe(true);
  });
});
