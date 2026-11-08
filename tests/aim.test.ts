import { describe, expect, it } from 'vitest';
import { EventBus } from '../src/core/events';
import { InputMapper } from '../src/core/input';
import { Rng } from '../src/core/rng';
import { attachAim } from '../src/gameplay/aim';
import { ShipCamera, type ShipPose } from '../src/gameplay/camera/ship-camera';
import { attachCombat, PLAYER_ID, RIPPLE_S } from '../src/gameplay/combat';
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
import { aimSightM, barrelTilt, previewArc, sideFor, solveAim } from '../src/sim/combat/aim';
import { rangeFor } from '../src/sim/combat/ballistics';
import { gameCombat, weaponDef } from '../src/sim/combat/defs';
import { ambientSightM } from '../src/sim/law/perception';
import { SHIP_RECORDS } from '../src/sim/sailing/ships';
import { createWorldState } from '../src/sim/world-state';

const DEG = Math.PI / 180;
const defs = gameCombat();
const swivel = weaponDef(defs, 'weapon.swivel');
const cannon = weaponDef(defs, 'weapon.light_cannon');
const record = (id: string) => {
  const r = SHIP_RECORDS.find((s) => s.id === id);
  if (!r) throw new Error(id);
  return r;
};

describe('laying a gun by eye (plan 07 §3)', () => {
  const muzzle = { x: 0, y: 2.5, z: 0 };

  it('holds a broadside to 15° of the beam and a swivel to 60° of the bow', () => {
    // Heading north; the aim point dead ahead.
    const ahead = { x: 0, z: -200 };
    const side = solveAim(cannon, 'starboard', muzzle, 0, ahead, 520);
    expect(side.arcLimited).toBe(true);
    expect(side.bearing).toBeCloseTo(75 * DEG, 5);
    const bow = solveAim(swivel, 'bow', muzzle, 0, { x: 300, z: -10 }, 320);
    expect(bow.arcLimited).toBe(true);
    expect(bow.bearing).toBeCloseTo(60 * DEG, 5);
    const fair = solveAim(swivel, 'bow', muzzle, 0, { x: 50, z: -150 }, 320);
    expect(fair.arcLimited).toBe(false);
    expect(fair.rangeM).toBeCloseTo(Math.hypot(50, 150), 6);
  });

  it("brings an aim past the gun's reach back to it, and finds the elevation for the range", () => {
    const far = solveAim(swivel, 'bow', muzzle, 0, { x: 0, z: -900 }, 320);
    expect(far.beyondReach).toBe(true);
    expect(far.rangeM).toBe(320);
    expect(rangeFor(swivel.muzzleMs, far.elevation, muzzle.y)).toBeCloseTo(320, 0);
  });

  it('tells port from starboard by the bearing off her bow', () => {
    expect(sideFor(0, 90 * DEG)).toBe('starboard');
    expect(sideFor(0, -90 * DEG)).toBe('port');
    // Heading south, the west lies off her starboard hand.
    expect(sideFor(180 * DEG, 270 * DEG)).toBe('starboard');
  });

  it('throws the barrel up as her side rolls up, and lays out her steady heel', () => {
    // Starboard side up 4° on a swell, over a steady 10° heel to port (roll is starboard up).
    const motion = { roll: 14 * DEG, pitch: 0, heel: 10 * DEG };
    expect(barrelTilt('starboard', motion)).toBeCloseTo(4 * DEG);
    expect(barrelTilt('port', motion)).toBeCloseTo(-4 * DEG);
    expect(barrelTilt('starboard', { roll: 10 * DEG, pitch: 0, heel: 10 * DEG })).toBeCloseTo(0);
    expect(barrelTilt('bow', { roll: 0, pitch: 3 * DEG, heel: 0 })).toBeCloseTo(3 * DEG);
  });

  it('draws the arc to the fall of shot, which moves out as the barrel rises', () => {
    const sol = solveAim(swivel, 'bow', muzzle, 0, { x: 0, z: -200 }, 320);
    const level = previewArc(muzzle, { x: 0, z: 0 }, sol.bearing, sol.elevation, 60, 0.02, 5000);
    expect(Math.hypot(level.impact.x, level.impact.z)).toBeCloseTo(200, 0);
    expect(level.splash).toBeDefined();
    expect(level.points[0]).toEqual(muzzle);
    const up = previewArc(
      muzzle,
      { x: 0, z: 0 },
      sol.bearing,
      sol.elevation + 2 * DEG,
      60,
      0.02,
      5000,
    );
    const down = previewArc(
      muzzle,
      { x: 0, z: 0 },
      sol.bearing,
      sol.elevation - 2 * DEG,
      60,
      0.02,
      5000,
    );
    // Fired on the downroll she falls short (into her hull); on the uproll, long and high.
    expect(-up.impact.z).toBeGreaterThan(220);
    expect(-down.impact.z).toBeLessThan(180);
  });

  it("cuts the arc short and hides the ring where the eye can't follow (§3: night and fog)", () => {
    const sol = solveAim(swivel, 'bow', muzzle, 0, { x: 0, z: -250 }, 320);
    const p = previewArc(muzzle, { x: 0, z: 0 }, sol.bearing, sol.elevation, 60, 0.02, 120);
    expect(p.splash).toBeUndefined();
    const last = p.points[p.points.length - 1];
    expect(last && Math.hypot(last.x, last.z)).toBeLessThanOrEqual(120);
    expect(p.points.length).toBeGreaterThan(3);
  });

  it('sees the fall of shot past any gun by day, about 100 m on a black night, and less in fog', () => {
    const sky = {
      sunElevationRad: 30 * DEG,
      moonElevationRad: -1,
      moonIllumination01: 0,
      cloud01: 0,
    };
    expect(aimSightM({ ambientM: ambientSightM(sky), fogM: 20000 })).toBeGreaterThan(520);
    const night = { ...sky, sunElevationRad: -30 * DEG };
    const dark = aimSightM({ ambientM: ambientSightM(night), fogM: 20000 });
    expect(dark).toBeGreaterThan(70);
    expect(dark).toBeLessThan(130);
    const moon = aimSightM({
      ambientM: ambientSightM({ ...night, moonElevationRad: 40 * DEG, moonIllumination01: 1 }),
      fogM: 20000,
    });
    expect(moon).toBeGreaterThan(400);
    expect(aimSightM({ ambientM: ambientSightM(sky), fogM: 300 })).toBeCloseTo(180);
  });
});

/** A player ship, a target lying `distance` off on `bearing`, the combat core and aim. */
function setup(opts: { classId?: string; bearingDeg?: number; distance?: number } = {}) {
  const { classId = 'ship.t1_schooner', bearingDeg = 0, distance = 150 } = opts;
  const state = createWorldState('aim');
  if (state.player.ship) state.player.ship.classId = classId;
  const events = new EventBus<GameEvents>();
  const world = createGameWorld();
  const input = new InputMapper();
  input.context = 'sailing';
  const ctx = { state, events, world, rng: Rng.fromSeed('aim'), input } as unknown as GameContext;
  const transform = { position: { x: 0, y: 0, z: 0 }, heading: 0, roll: 0, pitch: 0 };
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
  const b = bearingDeg * DEG;
  const npc = createNpcShipEntity(
    record('ship.fish_tug'),
    Math.sin(b) * distance,
    -Math.cos(b) * distance,
    b + 90 * DEG,
    0,
  );
  npc.id = 'npc.target';
  world.add(npc);
  let tilt = 0;
  const combat = attachCombat({
    ctx,
    player,
    hazards,
    arena: () => undefined,
    zoneShips: () => (world.has(npc) ? [npc] : []),
    hold: () => npc,
    zoneLand: () => undefined,
    isLawShip: () => false,
    barrelTilt: () => tilt,
  });
  const notices: string[] = [];
  const aim = attachAim({
    ctx,
    player,
    combat,
    sightM: () => 5000,
    refusal: () => undefined,
    heel: () => 0,
    ships: () => [npc],
    captains: () => [],
    nameOf: () => 'Ada Bell',
    notice: (t) => notices.push(t),
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
  const arm = (all = false) => {
    const ship = state.player.ship;
    if (!ship) throw new Error('no ship');
    ship.weapons.push({ weapon: 'weapon.swivel', mount: 'bow' });
    if (all) {
      for (let i = 0; i < 2; i++) {
        ship.weapons.push({ weapon: 'weapon.light_cannon', mount: 'port' });
        ship.weapons.push({ weapon: 'weapon.light_cannon', mount: 'starboard' });
      }
    }
    state.player.cargo.push({ good: 'good.powder_shot', qty: 3 });
  };
  return {
    state,
    world,
    input,
    player,
    npc,
    combat,
    aim,
    notices,
    seen,
    run,
    arm,
    setTilt: (t: number) => (tilt = t),
  };
}

describe('aim mode (plan 07 §3; Phase 6 piece B)', () => {
  it('takes up the rifle when no ship gun is mounted, and the swivel once one is', () => {
    const a = setup();
    expect(a.aim.enter()).toBe(true);
    expect(a.aim.weapon).toBe('rifle');
    a.aim.exit();
    a.arm();
    a.aim.enter();
    expect(a.aim.weapon).toBe('swivel');
    expect(a.aim.ammo).toBe('ammo.round');
  });

  it('Tab enters and leaves it, 1/2/3 pick the gun, C changes the shot', () => {
    const a = setup({ classId: 'ship.t2_schooner', bearingDeg: -90 });
    a.arm(true);
    a.input.trigger('AimMode');
    a.aim.step(a.input, true);
    a.input.endTick();
    expect(a.aim.active).toBe(true);
    expect(a.aim.weapon).toBe('swivel');
    a.input.trigger('AimBroadside');
    a.aim.step(a.input, true);
    a.input.endTick();
    // The broadside opens on the side her nearest ship lies.
    expect(a.aim.weapon).toBe('broadside');
    expect(a.aim.side).toBe('port');
    a.input.trigger('AimBroadside');
    a.aim.step(a.input, true);
    a.input.endTick();
    expect(a.aim.side).toBe('starboard');
    a.input.trigger('CycleAmmo');
    a.aim.step(a.input, true);
    a.input.endTick();
    expect(a.aim.ammo).toBe('ammo.chain');
    a.input.trigger('AimRifle');
    a.aim.step(a.input, true);
    a.input.endTick();
    expect(a.aim.weapon).toBe('rifle');
    expect(a.aim.ammo).toBe('ammo.ball');
    a.input.trigger('AimMode');
    a.aim.step(a.input, true);
    expect(a.aim.active).toBe(false);
  });

  it("refuses a broadside the T1 doesn't mount, and says so", () => {
    const a = setup();
    a.arm();
    a.aim.enter();
    expect(a.aim.select('broadside')).toBe(false);
    expect(a.notices).toContain('She mounts no broadside');
    expect(a.aim.weapon).toBe('swivel');
  });

  it('locks the T1’s rudder while aiming, not a crewed T2’s', () => {
    const t1 = setup();
    t1.arm();
    expect(t1.aim.steeringLocked()).toBe(false);
    t1.aim.enter();
    expect(t1.aim.steeringLocked()).toBe(true);
    const t2 = setup({ classId: 'ship.t2_schooner' });
    t2.arm(true);
    t2.aim.enter();
    expect(t2.aim.steeringLocked()).toBe(false);
  });

  it('fires the swivel on the lay, and the HUD shows it loading', () => {
    const a = setup();
    a.arm();
    a.aim.enter();
    a.aim.aimAt(a.npc.transform?.position.x ?? 0, a.npc.transform?.position.z ?? 0);
    expect(a.aim.hud()?.status).toBe('ready');
    a.input.trigger('Fire');
    // Not when the click landed on the HUD.
    a.aim.step(a.input, false);
    a.input.endTick();
    expect(a.seen.some((s) => s.type === 'WeaponFired')).toBe(false);
    a.input.trigger('Fire');
    a.aim.step(a.input, true);
    a.input.endTick();
    expect(a.seen.filter((s) => s.type === 'WeaponFired')).toHaveLength(1);
    const hud = a.aim.hud();
    expect(hud?.status).toBe('reloading');
    expect(hud?.steeringLocked).toBe(true);
    expect(hud?.reloads.find((r) => r.mount === 'bow')?.ready01).toBeLessThan(0.05);
    expect(a.aim.fire()).toEqual({ ok: false, reason: 'reloading' });
    a.run(6.1);
    expect(a.aim.hud()?.status).toBe('ready');
  });

  it('shows the ship under the gun on the target card', () => {
    const a = setup();
    a.arm();
    a.aim.enter();
    a.aim.aimAt(a.npc.transform?.position.x ?? 0, a.npc.transform?.position.z ?? 0);
    const card = a.aim.targetCard();
    expect(card?.shipId).toBe('npc.target');
    expect(card?.name).toBe('Ada Bell');
    expect(card?.className).toBe('Fishing tug');
    expect(card?.hull01).toBe(1);
    expect(card?.crew).toBeGreaterThan(0);
    expect(card?.rangeM).toBeCloseTo(150, 0);
    // Laid well clear of her: no card.
    a.aim.aimAt(0, 250);
    expect(a.aim.targetCard()).toBeUndefined();
  });

  it('puts the swivel’s shot over her when the bow comes up, and short on the way down', () => {
    const land = (tilt: number): number => {
      const a = setup({ distance: 200 });
      a.arm();
      a.aim.enter();
      // Laid on open water short of her, so nothing's in the way.
      a.aim.aimAt(0, -120);
      a.setTilt(tilt);
      expect(a.aim.fire()).toEqual({ ok: true });
      a.run(8);
      const fell = a.seen.find((s) => s.type === 'ShotLanded')?.payload as {
        at: { z: number };
      };
      return -fell.at.z;
    };
    expect(land(3 * DEG)).toBeGreaterThan(land(0) + 15);
    expect(land(-3 * DEG)).toBeLessThan(land(0) - 15);
  });
});

describe('a crew’s rippled broadside (plan 07 §3)', () => {
  it('fires her guns one after another, each as she rolls then', () => {
    const a = setup({ classId: 'ship.t2_schooner', bearingDeg: 90, distance: 250 });
    a.arm(true);
    const r = a.combat.fire({ ammo: 'ammo.round', mount: 'starboard', target: 'npc.target' });
    expect(r).toMatchObject({ ok: true, mount: 'starboard', rounds: 2 });
    expect(a.seen.filter((s) => s.type === 'WeaponFired')).toHaveLength(1);
    expect(a.combat.volleysPending()).toBe(1);
    a.run(RIPPLE_S + 0.05);
    expect(a.seen.filter((s) => s.type === 'WeaponFired')).toHaveLength(2);
    expect(a.combat.volleysPending()).toBe(0);
    // Powder for both guns came out at the order.
    expect(a.state.player.ammo.charges).toBe(10 - 4);
  });

  it('fires the guns together when asked, and a T1 never ripples', () => {
    const a = setup({ classId: 'ship.t2_schooner', bearingDeg: 90, distance: 250 });
    a.arm(true);
    a.combat.fire({ ammo: 'ammo.round', mount: 'starboard', target: 'npc.target', ripple: false });
    const fired = a.seen.filter((s) => s.type === 'WeaponFired');
    expect(fired).toHaveLength(1);
    expect((fired[0]?.payload as { rounds: number }).rounds).toBe(2);
    expect(a.combat.volleysPending()).toBe(0);
  });
});

describe('the aim camera (plan 07 §3)', () => {
  const pose = (heading: number): ShipPose => ({
    position: { x: 0, y: 0, z: 0 },
    heading,
    roll: 0,
    speed01: 0,
  });
  const run = (cam: ShipCamera, p: ShipPose, s: number) => {
    for (let t = 0; t < s; t += 1 / 60) cam.update(p, () => 0.8, 1 / 60);
  };

  it('goes to the starboard rail to look out along the broadside, then comes back', () => {
    const cam = new ShipCamera();
    const p = pose(0);
    run(cam, p, 0.2);
    const zoom = cam.zoomTo;
    cam.setAim({ lookRel: Math.PI / 2, backM: -2, aftM: 6, upM: 6, leadM: 150 });
    run(cam, p, 3);
    expect(cam.aiming).toBe(true);
    // Heading north and looking east: at her starboard rail abaft the guns, at the water east.
    expect(cam.position.x).toBeCloseTo(2, 0);
    expect(cam.position.z).toBeCloseTo(6, 0);
    expect(cam.position.y).toBeCloseTo(6, 0);
    expect(cam.target.x).toBeCloseTo(150, 0);
    // Dragging and the wheel don't move it off the gun.
    cam.orbit(400, 0);
    cam.zoom(3);
    run(cam, p, 0.1);
    expect(cam.target.x).toBeCloseTo(150, 0);
    expect(cam.zoomTo).toBe(zoom);
    cam.setAim(undefined);
    run(cam, p, 3);
    expect(cam.aiming).toBe(false);
    expect(cam.aimBlend).toBeLessThan(0.01);
    // Back on the chase boom, which comes round from the side it was looking.
    expect(Math.hypot(cam.position.x, cam.position.z)).toBeGreaterThan(30);
  });
});
