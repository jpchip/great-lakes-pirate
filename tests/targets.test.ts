import { describe, expect, it } from 'vitest';
import { EventBus } from '../src/core/events';
import { createGameWorld, type Entity } from '../src/gameplay/ecs';
import { createNpcShipEntity } from '../src/gameplay/npc-ships';
import { attachCollisions } from '../src/gameplay/collisions';
import { attachTargets, type TargetsDeps } from '../src/gameplay/targets';
import type { GameContext, GameEvents } from '../src/modes/context';
import { collide, massOf, type Body } from '../src/sim/arena/collide';
import { devEncounter } from '../src/sim/arena/encounter';
import { OPEN_LAKE } from '../src/sim/arena/land';
import {
  arenaSceneSpeed,
  createHelm,
  steerShips,
  type SteeredShip,
  type Traffic,
} from '../src/sim/arena/steering';
import {
  createCaptain,
  fleeLine,
  noteCasualties,
  noteHit,
  noteWarningShot,
  standing,
  stepCaptain,
  type TargetCaptain,
  type TargetSituation,
} from '../src/sim/targets/morale';
import { hawser, hitsHawser, towConsort } from '../src/sim/targets/tow';
import { SHIP_RECORDS } from '../src/sim/sailing/ships';
import { createWorldState } from '../src/sim/world-state';
import { gameTraffic, manifestFor } from '../src/sim/traffic/cargo';
import { westernSuperiorChart } from '../src/sim/chart/chart-data';
import { createContacts } from '../src/sim/chart/traffic';
import { gameEconomy } from '../src/sim/economy/defs';

/**
 * Phase 6 piece C: targets and morale. The four target classes' combat stats, the morale
 * meter and the captain's Transit → Alert → Flee / Fight / Strike, the tug that strikes
 * to warning shots without a death, the steamer that runs, the barge on her towline and
 * the hawser that parts, and hulls that block and bounce.
 */

const record = (id: string) => {
  const r = SHIP_RECORDS.find((s) => s.id === id);
  if (!r) throw new Error(`no ${id}`);
  return r;
};
const captainOf = (id: string): TargetCaptain => {
  const c = createCaptain(`test.${id}`, record(id));
  if (!c) throw new Error(`no captain for ${id}`);
  // No determined captains in the rules tests: they're seeded by id.
  (c as { determined: boolean }).determined = false;
  return c;
};

/** A T1 with a swivel, by day, at Unknown Fame, running down on her from 400 m. */
function sit(over: Partial<TargetSituation> = {}): TargetSituation {
  return {
    rangeM: 400,
    closingKn: 4,
    cpaM: 30,
    fameTier: 0,
    playerGuns: 1,
    dark01: 0,
    witnesses: 0,
    canOutrun: false,
    becalmed: false,
    trapped: false,
    towed: false,
    adrift: false,
    ...over,
  };
}

const TARGETS = [
  'ship.fish_tug',
  'ship.schooner_barge',
  'ship.package_steamer',
  'ship.ore_freighter',
];

describe('target classes (plan 07 §8)', () => {
  it('gives the four target classes combat stats, and the cutter none to rob', () => {
    for (const id of TARGETS) {
      const c = record(id).combat;
      expect(c?.target, id).toBe(true);
      expect(c?.armed, id).toBe(false);
    }
    expect(record('ship.cutter_morrill').combat?.target).toBe(false);
    expect(createCaptain('x', record('ship.cutter_morrill'))).toBeUndefined();
    expect(createCaptain('x', record('ship.t1_schooner'))).toBeUndefined();
  });

  it('settles the crews in plan 07 §8 ranges, and the manifest reads them', () => {
    expect(record('ship.fish_tug').combat?.crew).toBeLessThanOrEqual(5);
    expect(record('ship.schooner_barge').combat?.crew).toBeLessThanOrEqual(7);
    const steamer = record('ship.package_steamer').combat?.crew ?? 0;
    expect(steamer).toBeGreaterThanOrEqual(12);
    expect(steamer).toBeLessThanOrEqual(18);
    const ore = record('ship.ore_freighter').combat?.crew ?? 0;
    expect(ore).toBeGreaterThanOrEqual(18);
    expect(ore).toBeLessThanOrEqual(25);
    const c = createContacts(westernSuperiorChart().projection, 'crew-traffic', 0).find(
      (k) => k.schedule && k.classId === 'ship.package_steamer',
    );
    if (!c) throw new Error('no package steamer on the lanes');
    const m = manifestFor(gameTraffic(), gameEconomy(), c, 3, true);
    expect(m?.crew).toBe(steamer);
    expect(m?.armed).toBe(false);
  });

  it('runs the tug less readily than the steamers', () => {
    expect(fleeLine(captainOf('ship.fish_tug'))).toBeLessThan(
      fleeLine(captainOf('ship.package_steamer')),
    );
  });
});

describe('morale and the captain (plan 07 §5)', () => {
  it('stays on her lane until something looks like a pirate', () => {
    const c = captainOf('ship.package_steamer');
    // Passing well clear, opening the range: nothing to see.
    expect(stepCaptain(c, sit({ rangeM: 900, closingKn: -2, cpaM: 900 }), 0.1)).toEqual([]);
    expect(c.phase).toBe('transit');
    const acts = stepCaptain(c, sit(), 0.1);
    expect(acts.some((a) => a.type === 'phase' && a.to === 'alert')).toBe(true);
  });

  it('a T1 makes a fish tug strike with warning shots, killing nobody (§14.3 criterion 1)', () => {
    const c = captainOf('ship.fish_tug');
    const s = sit({ canOutrun: true });
    stepCaptain(c, s, 0.1);
    expect(['alert', 'fleeing']).toContain(c.phase);
    let shots = 0;
    while (c.phase !== 'struck' && shots < 10) {
      noteWarningShot(c);
      shots++;
      stepCaptain(c, s, 0.1);
    }
    expect(c.phase).toBe('struck');
    expect(shots).toBeLessThanOrEqual(4);
    expect(c.damage.killed).toBe(0);
  });

  it('a stranded schooner-barge strikes to warning shots too', () => {
    const c = captainOf('ship.schooner_barge');
    const s = sit({ adrift: true });
    stepCaptain(c, s, 0.1);
    // Adrift, she can't run: she waits.
    expect(c.phase).toBe('alert');
    let shots = 0;
    while (c.phase !== 'struck' && shots < 10) {
      noteWarningShot(c);
      shots++;
      stepCaptain(c, s, 0.1);
    }
    expect(shots).toBeLessThanOrEqual(2);
  });

  it('a package steamer runs, and holds on through warning shots from a T1', () => {
    const c = captainOf('ship.package_steamer');
    const s = sit({ canOutrun: true });
    // Only coming close, a T1 at Unknown Fame doesn't send her running.
    stepCaptain(c, s, 0.1);
    expect(c.phase).toBe('alert');
    noteWarningShot(c);
    stepCaptain(c, s, 0.1);
    expect(c.phase).toBe('fleeing');
    noteWarningShot(c);
    stepCaptain(c, s, 0.1);
    expect(c.phase).toBe('fleeing');
    // Disabled (her engine stopped), she strikes (§8: flees, then surrenders if disabled).
    noteHit(c, 'engine', 1);
    stepCaptain(c, { ...s, canOutrun: false }, 0.1);
    expect(c.phase).toBe('struck');
  });

  it('a T2 takes a package steamer by intimidation at medium Fame (§14.3 criterion 2)', () => {
    const low = captainOf('ship.package_steamer');
    const known = captainOf('ship.package_steamer');
    const count = (c: TargetCaptain, s: TargetSituation): number => {
      stepCaptain(c, s, 0.1);
      let n = 0;
      while (c.phase !== 'struck' && n < 20) {
        noteWarningShot(c);
        n++;
        stepCaptain(c, s, 0.1);
      }
      return n;
    };
    const atKnown = count(known, sit({ fameTier: 2, playerGuns: 2 }));
    const atUnknown = count(low, sit({ fameTier: 0, playerGuns: 1 }));
    expect(known.phase).toBe('struck');
    expect(atKnown).toBeLessThanOrEqual(4);
    expect(atKnown).toBeLessThan(atUnknown);
  });

  it('names every share of the meter, so the HUD can say why', () => {
    const c = captainOf('ship.package_steamer');
    const parts = standing(
      c,
      sit({ fameTier: 3, friendM: 1000, refugeM: 2000, witnesses: 3, canOutrun: true }),
    );
    const labels = parts.map((p) => p.label);
    expect(labels).toEqual(
      expect.arrayContaining([
        'your Fame',
        'your guns',
        'the cutter is near',
        'a harbor is near',
        'ships in view',
        'she can outrun you',
      ]),
    );
    // Ships in view count by day, not on a dark night.
    const dark = standing(c, sit({ witnesses: 3, dark01: 1 }));
    expect(dark.find((p) => p.label === 'ships in view')).toBeUndefined();
  });

  it('casualties take a big bite, and a determined captain holds on longer', () => {
    const a = captainOf('ship.package_steamer');
    noteCasualties(a, 2, 0);
    expect(a.shock).toBeLessThan(-10);
    const d = captainOf('ship.ore_freighter');
    (d as { determined: boolean }).determined = true;
    const plain = captainOf('ship.ore_freighter');
    stepCaptain(d, sit(), 0.1);
    stepCaptain(plain, sit(), 0.1);
    expect(d.morale).toBeGreaterThan(plain.morale);
  });

  it('a night surprise costs her nerve; the shock wears off once the firing stops', () => {
    const c = captainOf('ship.ore_freighter');
    const acts = stepCaptain(c, sit({ dark01: 1, rangeM: 200 }), 0.1);
    expect(acts.some((a) => a.type === 'surprised')).toBe(true);
    const shocked = c.shock;
    expect(shocked).toBeLessThan(0);
    for (let i = 0; i < 400; i++) stepCaptain(c, sit({ dark01: 1, rangeM: 200 }), 0.25);
    expect(c.shock).toBeGreaterThan(shocked);
  });

  it('a runner that opens the range has fled; a struck ship stays struck', () => {
    const c = captainOf('ship.package_steamer');
    // A Known pirate: she knows the ship, and runs without a shot fired.
    stepCaptain(c, sit({ canOutrun: true, fameTier: 2 }), 0.1);
    expect(c.phase).toBe('fleeing');
    const acts = stepCaptain(
      c,
      sit({ canOutrun: true, fameTier: 2, rangeM: 2000, closingKn: -3 }),
      0.1,
    );
    expect(acts.some((a) => a.type === 'phase' && a.to === 'fled')).toBe(true);
    const t = captainOf('ship.fish_tug');
    for (let i = 0; i < 6; i++) noteWarningShot(t);
    stepCaptain(t, sit(), 0.1);
    expect(t.phase).toBe('struck');
    stepCaptain(t, sit({ rangeM: 3000 }), 600);
    expect(t.phase).toBe('struck');
  });

  it('only an armed ship, or a determined steamer up close, fights', () => {
    const c = captainOf('ship.package_steamer');
    (c as { determined: boolean }).determined = true;
    noteGunfireNow(c);
    stepCaptain(c, sit({ rangeM: 300 }), 0.1);
    expect(c.phase).toBe('fighting');
    const plain = captainOf('ship.package_steamer');
    stepCaptain(plain, sit({ rangeM: 300 }), 0.1);
    expect(plain.phase).not.toBe('fighting');
  });

  it('caught alongside by a ship she can’t outrun, she loses heart', () => {
    const c = captainOf('ship.schooner_barge');
    const s = sit({ rangeM: 60, closingKn: 0, towed: true });
    for (let i = 0; i < 100; i++) stepCaptain(c, s, 0.1);
    expect(c.parts.some((p) => p.label === 'caught')).toBe(true);
  });
});

function noteGunfireNow(c: TargetCaptain): void {
  c.quietS = 0;
}

describe('tow lines (plan 07 §8.2)', () => {
  it('pulls the consort after her steamer when the hawser is taut, not when slack', () => {
    const leader = { x: 0, z: -100, heading: 0 };
    const consort = { x: 0, z: 100, heading: 0 };
    // Stern at z = -50, bow at z = 70: 120 m apart on a 100 m hawser → pulled up 20 m.
    const pulled = towConsort(leader, 50, consort, 30, 100);
    expect(pulled.z).toBeCloseTo(80, 3);
    expect(pulled.heading).toBeCloseTo(0, 6);
    const slack = towConsort(leader, 50, consort, 30, 200);
    expect(slack.z).toBe(100);
  });

  it('swings her to the pull as her steamer turns', () => {
    const leader = { x: 200, z: -100, heading: Math.PI / 2 };
    const next = towConsort(leader, 50, { x: 0, z: 100, heading: 0 }, 30, 100);
    expect(next.heading).toBeGreaterThan(0.3);
  });

  it('parts to a shot that falls on the hawser, and only then', () => {
    const h = hawser({ x: 0, z: -100, heading: 0 }, 50, { x: 0, z: 100, heading: 0 }, 30);
    expect(hitsHawser({ x: 2, z: 0 }, h.a, h.b)).toBe(true);
    expect(hitsHawser({ x: 12, z: 0 }, h.a, h.b)).toBe(false);
    expect(hitsHawser({ x: 0, z: 140 }, h.a, h.b)).toBe(false);
  });
});

describe('collisions (plan 03 §25.4)', () => {
  const body = (over: Partial<Body>): Body => ({
    x: 0,
    z: 0,
    heading: 0,
    vx: 0,
    vz: 0,
    halfLengthM: 10,
    halfBeamM: 2.5,
    mass: massOf(20, 5),
    ...over,
  });

  it('pushes overlapping hulls apart and takes off their closing speed', () => {
    // Two schooners side by side, 3 m apart (their beams are 5 m), closing at 2 m/s.
    const a = body({ x: -1.5, vx: 1 });
    const b = body({ x: 1.5, vx: -1 });
    const out = collide([a, b]);
    expect(out).toHaveLength(1);
    expect(b.x - a.x).toBeGreaterThanOrEqual(5 - 1e-6);
    // They now open (a bounce), not close.
    expect(b.vx - a.vx).toBeGreaterThan(0);
  });

  it('a big hull shoves a small one, and an immovable one isn’t moved', () => {
    const tug = body({ x: 0, vx: 0 });
    const big = body({ x: 6, halfLengthM: 50, halfBeamM: 6, mass: massOf(100, 12), vx: -2 });
    collide([tug, big]);
    expect(Math.abs(tug.x)).toBeGreaterThan(Math.abs(big.x - 6));
    const wall = body({ x: 4, mass: Infinity });
    const me = body({ x: 0, vx: 2 });
    collide([me, wall]);
    expect(wall.x).toBe(4);
    expect(me.vx).toBeLessThan(0);
  });

  it('leaves hulls that don’t touch alone, end to end too', () => {
    const a = body({ z: 0 });
    const b = body({ z: -21 });
    expect(collide([a, b])).toHaveLength(0);
    const c = body({ z: -19 });
    expect(collide([a, c])).toHaveLength(1);
  });
});

describe('fleeing helms', () => {
  const steamer = record('ship.package_steamer');
  const ship = (): SteeredShip => ({
    x: 0,
    z: 0,
    vx: 0,
    vz: 0,
    heading: 0,
    lengthM: steamer.lengthM,
    helm: createHelm(steamer, 0, 11),
  });
  const player: Traffic = { x: 0, z: 300, vx: 0, vz: -3, lengthM: 20 };

  it('runs dead away from the player at her flank speed', () => {
    const s = ship();
    s.heading = Math.PI / 2;
    s.helm.flankKn = 12.5;
    s.helm.orders = { mode: 'flee', kn: 12.5 };
    for (let i = 0; i < 600; i++) steerShips([s], player, OPEN_LAKE, 0.1);
    // The player is due south of her: she runs north.
    expect(Math.abs(Math.atan2(Math.sin(s.heading), Math.cos(s.heading)))).toBeLessThan(0.1);
    expect(s.helm.speedKn).toBeGreaterThan(11);
  });

  it('makes for a refuge off her quarter', () => {
    const s = ship();
    s.helm.orders = { mode: 'flee', kn: 11, refuge: { x: 1000, z: -1000 } };
    for (let i = 0; i < 600; i++) steerShips([s], player, OPEN_LAKE, 0.1);
    expect(s.heading).toBeGreaterThan(0.5);
    expect(s.heading).toBeLessThan(1.1);
  });

  it('heaves to when struck', () => {
    const s = ship();
    s.helm.speedKn = 11;
    s.helm.orders = { mode: 'stop' };
    for (let i = 0; i < 3000; i++) steerShips([s], player, OPEN_LAKE, 0.1);
    expect(s.helm.speedKn).toBeLessThan(0.5);
  });
});

describe('targets in an arena', () => {
  /** A dev convoy arena with the player close astern of the freighter's tow. */
  function setup(over: Partial<TargetsDeps> = {}) {
    const state = createWorldState('targets', 12 * 3600);
    const events = new EventBus<GameEvents>();
    const world = createGameWorld();
    const ctx = { state, events, world } as unknown as GameContext;
    const enc = devEncounter('convoy', { x: 0, y: 0 }, 0);
    const ships = enc.ships.map((s, i) => {
      const r = record(s.classId);
      const off = s.offset ?? { x: 0, z: 0 };
      const x = off.x + i * 0;
      const e = createNpcShipEntity(r, x, off.z, s.heading, s.speedKn);
      e.id = s.id;
      if (s.towedBy && e.npc) e.npc.towedBy = s.towedBy;
      world.add(e);
      const steer: SteeredShip = {
        x,
        z: off.z,
        vx: e.velocity?.x ?? 0,
        vz: e.velocity?.z ?? 0,
        heading: s.heading,
        lengthM: r.lengthM * r.displayScale,
        helm: createHelm(r, s.heading, s.speedKn),
      };
      return { entity: e, steer };
    });
    const player: Entity = {
      id: 'ship.player',
      transform: { position: { x: 0, y: 0, z: 600 }, heading: 0 },
      previousTransform: { position: { x: 0, y: 0, z: 600 }, heading: 0 },
    };
    const log: string[] = [];
    const notices: string[] = [];
    for (const k of ['TargetStateChanged', 'MoraleBroken', 'TowCut', 'ShipFled'] as const) {
      events.on(k, (e) => log.push(`${k}:${JSON.stringify(e)}`));
    }
    const targets = attachTargets({
      ctx,
      player,
      playerKn: () => 5,
      arena: () => ({ ships, land: OPEN_LAKE }),
      zoneShips: () => [],
      hold: () => undefined,
      zoneLand: () => undefined,
      windAt: () => ({ fromRad: 0, speedKn: 12 }),
      dark01: () => 0,
      fameTier: () => 0,
      playerGuns: () => 1,
      refuges: () => [],
      nameOf: (id) => id,
      notice: (t) => notices.push(t),
      ...over,
    });
    const tick = (dt = 0.1): void => {
      // The arena's helms, then the captains, then the ships move (the sailing tick's order).
      for (const s of ships) {
        const t = s.entity.transform;
        if (!t) continue;
        s.steer.x = t.position.x;
        s.steer.z = t.position.z;
        s.steer.heading = t.heading;
      }
      const pp = player.transform?.position ?? { x: 0, z: 0 };
      steerShips(
        ships.map((s) => s.steer),
        { x: pp.x, z: pp.z, vx: 0, vz: 0, lengthM: 20 },
        OPEN_LAKE,
        dt,
      );
      for (const s of ships) {
        if (s.entity.transform) s.entity.transform.heading = s.steer.heading;
        if (s.entity.velocity) {
          s.entity.velocity.x = s.steer.vx;
          s.entity.velocity.z = s.steer.vz;
        }
      }
      targets.step(dt);
      for (const s of ships) {
        const t = s.entity.transform;
        const v = s.entity.velocity;
        if (!t || !v) continue;
        if (s.entity.previousTransform) {
          s.entity.previousTransform.position.x = t.position.x;
          s.entity.previousTransform.position.z = t.position.z;
        }
        t.position.x += v.x * dt;
        t.position.z += v.z * dt;
      }
    };
    return { ctx, ships, targets, tick, log, notices, player };
  }

  it('keeps the barge on her towline as the freighter steams on', () => {
    const { ships, tick, targets } = setup();
    tick();
    const line = targets.towLines()[0];
    expect(line?.consortId).toBe('dev.convoy.barge');
    for (let i = 0; i < 600; i++) tick();
    const f = ships[0]?.entity.transform?.position;
    const b = ships[1]?.entity.transform?.position;
    if (!f || !b) throw new Error('no ships');
    const h = targets.towLines()[0];
    if (!h) throw new Error('no hawser');
    expect(Math.hypot(h.b.x - h.a.x, h.b.z - h.a.z)).toBeLessThan(200);
    // A minute on at 8 kn: she's come along with her steamer.
    expect(Math.hypot(b.x - f.x, b.z - f.z)).toBeLessThan(400);
  });

  it('parts the hawser to a shot on it: the barge drifts and the freighter steams on', () => {
    const { ships, tick, targets, log } = setup();
    tick();
    const line = targets.towLines()[0];
    if (!line) throw new Error('no hawser');
    const mid = { x: (line.a.x + line.b.x) / 2, z: (line.a.z + line.b.z) / 2 };
    expect(targets.shotLanded(mid).towCut).toBe('dev.convoy.barge');
    expect(log.some((l) => l.startsWith('TowCut'))).toBe(true);
    for (let i = 0; i < 1200; i++) tick();
    const barge = ships[1]?.steer.helm.speedKn ?? 99;
    const freighter = ships[0]?.steer.helm.speedKn ?? 0;
    expect(barge).toBeLessThan(1);
    expect(freighter).toBeGreaterThan(5);
    expect(ships[1]?.entity.npc?.towParted).toBe(true);
  });

  it('warning shots across the tug’s bow make her strike under a white flag', () => {
    const { ships, tick, targets, log } = setup();
    tick();
    const tug = ships[2]?.entity;
    if (!tug?.transform) throw new Error('no tug');
    let shots = 0;
    while (!targets.isStruck('dev.convoy.tug') && shots < 8) {
      const t = tug.transform;
      targets.shotLanded({
        x: t.position.x + Math.sin(t.heading) * 80,
        z: t.position.z - Math.cos(t.heading) * 80,
      });
      shots++;
      for (let i = 0; i < 5; i++) tick();
    }
    expect(targets.isStruck('dev.convoy.tug')).toBe(true);
    expect(tug.npc?.struck).toBe(true);
    expect(log.some((l) => l.startsWith('MoraleBroken'))).toBe(true);
    for (let i = 0; i < 1200; i++) tick();
    expect(ships[2]?.steer.helm.speedKn ?? 99).toBeLessThan(0.5);
    // Gunfire carried: the freighter and her barge are on the alert too.
    const phases = targets.captains().map((c) => c.phase);
    expect(phases.filter((p) => p !== 'transit').length).toBe(3);
  });

  it('a shot that hits isn’t also a warning shot', () => {
    const { tick, targets } = setup();
    tick();
    const t = targets.captains()[2];
    expect(t?.id).toBe('dev.convoy.tug');
    const out = targets.shotLanded({ x: 0, z: 0 }, 'dev.convoy.freighter');
    expect(out.warned).not.toBe('dev.convoy.freighter');
  });

  it('a fleeing steamer opens on a slow T1', () => {
    const { tick, targets, ships, player } = setup({ playerKn: () => 3 });
    tick();
    targets.cutTow('dev.convoy.barge');
    // A shot near the freighter: she's off.
    const f = ships[0]?.entity;
    if (!f?.transform) throw new Error('no freighter');
    targets.shotLanded({ x: f.transform.position.x + 150, z: f.transform.position.z });
    for (let i = 0; i < 50; i++) tick();
    const cap = targets.captains().find((c) => c.id === 'dev.convoy.freighter');
    expect(['fleeing', 'alert']).toContain(cap?.phase);
    const p = player.transform?.position;
    if (!p) throw new Error('no player');
    const d0 = Math.hypot(f.transform.position.x - p.x, f.transform.position.z - p.z);
    for (let i = 0; i < 600; i++) tick();
    const d1 = Math.hypot(f.transform.position.x - p.x, f.transform.position.z - p.z);
    expect(d1).toBeGreaterThan(d0);
    expect(arenaSceneSpeed(1)).toBeGreaterThan(0);
  });
});

describe('collisions in play', () => {
  it('a schooner sailing into a lying freighter bounces off, and the event is told once', () => {
    const state = createWorldState('bump', 0);
    const events = new EventBus<GameEvents>();
    const world = createGameWorld();
    const ctx = { state, events, world } as unknown as GameContext;
    const f = createNpcShipEntity(record('ship.ore_freighter'), 0, 0, Math.PI / 2, 0);
    f.id = 'freighter';
    world.add(f);
    const tug = createNpcShipEntity(record('ship.fish_tug'), 0, 7, Math.PI / 2, 0);
    tug.id = 'tug';
    if (tug.velocity) tug.velocity.z = -2;
    if (tug.previousTransform) tug.previousTransform.position.z = 7.2;
    world.add(tug);
    const bumps: string[] = [];
    events.on('ShipsCollided', (e) => bumps.push(`${e.a}-${e.b}`));
    const c = attachCollisions({ ctx, movable: () => true, helmOf: () => undefined });
    c.step(0.1);
    c.step(0.1);
    const fz = f.transform?.position.z ?? 0;
    const tz = tug.transform?.position.z ?? 0;
    // Clear of each other: half the freighter's beam and half the tug's.
    const half = (id: string) => record(id).buoyancy.beam / 2;
    expect(tz - fz).toBeGreaterThanOrEqual(
      half('ship.ore_freighter') + half('ship.fish_tug') - 1e-6,
    );
    // The big hull barely moved.
    expect(Math.abs(fz)).toBeLessThan(0.5);
    expect(bumps).toHaveLength(1);
  });
});
