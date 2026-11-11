import { describe, expect, it } from 'vitest';
import { Rng } from '../src/core/rng';
import { createGreyboxDistrict, inRestricted } from '../src/debug/stealth-greybox/district';
import { ColliderSet } from '../src/gameplay/onfoot/colliders';
import {
  createCharacter,
  DEFAULT_CONTROLLER,
  stepCharacter,
  type CharacterState,
} from '../src/gameplay/onfoot/controller';
import {
  gameNpcs,
  MAX_GUARDS,
  rosterForTier,
  type GuardSpawn,
} from '../src/gameplay/onfoot/guards';
import { ambientLight01, lampFalloff, LampSet, lightAt } from '../src/gameplay/onfoot/light';
import {
  footstepRadiusM,
  Footsteps,
  heard,
  weatherNoiseFactor,
  WALL_FACTOR,
} from '../src/gameplay/onfoot/noise';
import {
  exposure,
  gemLevel,
  look,
  seeingRangeM,
  viewZone,
  type Figure,
} from '../src/gameplay/onfoot/perception';
import { lineBlocked } from '../src/gameplay/onfoot/sightline';
import {
  createStealth,
  GRAB_S,
  KNOCKOUT_GAME_S,
  type Stealth,
  type StealthEvent,
  type StealthInputs,
} from '../src/gameplay/onfoot/stealth';
import type { SkyLight } from '../src/sim/law/perception';
import { dawnView, eyeViews, gemView, noiseView, stealthHud } from '../src/ui/hud/stealth-model';

const DT = 1 / 60;

function need<T>(v: T | undefined): T {
  if (v === undefined) throw new Error('Missing');
  return v;
}
const DEG = Math.PI / 180;
const NIGHT_GAME_S = 23 * 3600;

const FULL_MOON: SkyLight = {
  sunElevationRad: -40 * DEG,
  moonElevationRad: 45 * DEG,
  moonIllumination01: 1,
  cloud01: 0,
};
const NEW_MOON: SkyLight = { ...FULL_MOON, moonIllumination01: 0 };
const DAY: SkyLight = { ...FULL_MOON, sunElevationRad: 40 * DEG };

function figure(over: Partial<Figure> = {}): Figure {
  return {
    x: 0,
    y: 0,
    z: 0,
    gait: 'walk',
    crouching: false,
    swimming: false,
    carrying: false,
    height: 1.75,
    ...over,
  };
}

describe('light on foot', () => {
  it('the moon lights the ground by its phase; the sun outshines everything', () => {
    const newMoon = ambientLight01(NEW_MOON);
    const full = ambientLight01(FULL_MOON);
    expect(newMoon).toBeLessThan(0.06);
    expect(full).toBeGreaterThan(0.3);
    expect(ambientLight01({ ...FULL_MOON, cloud01: 1 })).toBeLessThan(full * 0.5);
    expect(ambientLight01(FULL_MOON, 1)).toBeLessThan(full);
    expect(ambientLight01(DAY)).toBeCloseTo(1, 2);
  });

  it('a lamp lights a pool that fades to nothing at its radius; two pools add up', () => {
    expect(lampFalloff(0, 8)).toBe(1);
    expect(lampFalloff(4, 8)).toBeCloseTo(0.5625, 3);
    expect(lampFalloff(8, 8)).toBe(0);
    const one = new LampSet([{ x: 0, y: 1.2, z: 0, radiusM: 8, intensity: 0.9, lit: true }]);
    const at = (x: number) => lightAt(x, 0, 0, 0.04, one).level01;
    expect(at(0)).toBeGreaterThan(0.85);
    expect(at(5)).toBeLessThan(at(2));
    expect(at(20)).toBeCloseTo(0.04, 5);
    const two = new LampSet([
      { x: -3, y: 1.2, z: 0, radiusM: 8, intensity: 0.6, lit: true },
      { x: 3, y: 1.2, z: 0, radiusM: 8, intensity: 0.6, lit: true },
    ]);
    const between = lightAt(0, 0, 0, 0.04, two);
    expect(between.level01).toBeGreaterThan(
      lightAt(0, 0, 0, 0.04, new LampSet([need(two.lamps[0])])).level01,
    );
    expect(between.level01).toBeLessThanOrEqual(1);
    // A doused lamp gives nothing.
    expect(
      lightAt(0, 0, 0, 0.04, new LampSet([{ ...need(two.lamps[0]), lit: false }])).level01,
    ).toBeCloseTo(0.04, 9);
  });

  it('the gem reads hidden crouched in the dark and exposed walking under a lamp', () => {
    const crouched = figure({ crouching: true, gait: 'sneak' });
    expect(gemLevel(exposure(ambientLight01(NEW_MOON), crouched))).toBe('hidden');
    expect(gemLevel(exposure(0.9, figure()))).toBe('exposed');
    expect(gemLevel(exposure(ambientLight01(FULL_MOON), figure()))).toBe('lit');
  });
});

describe('lines of sight and hearing', () => {
  const walls = new ColliderSet();
  walls.add({ kind: 'box', x: 0, z: 0, halfX: 0.2, halfZ: 5, yaw: 0, minY: 0, maxY: 3 });
  walls.add({ kind: 'box', x: 0, z: 10, halfX: 0.6, halfZ: 0.6, yaw: 0, minY: 0, maxY: 0.9 });

  it('a wall blocks the line; a low crate hides the hips, not the head', () => {
    expect(lineBlocked(walls, { x: -5, y: 1.6, z: 0 }, { x: 5, y: 1.6, z: 0 })).toBe(true);
    expect(lineBlocked(walls, { x: -5, y: 1.6, z: 10 }, { x: 5, y: 1.6, z: 10 })).toBe(false);
    expect(lineBlocked(walls, { x: -5, y: 0.5, z: 10 }, { x: 5, y: 0.5, z: 10 })).toBe(true);
    expect(lineBlocked(walls, { x: -5, y: 1.6, z: -8 }, { x: 5, y: 1.6, z: -8 })).toBe(false);
  });

  it('footsteps: running on planks is loudest, sneaking on grass barely a sound', () => {
    expect(footstepRadiusM('run', 'wood')).toBeGreaterThan(footstepRadiusM('run', 'dirt'));
    expect(footstepRadiusM('run', 'wood')).toBeGreaterThan(15);
    expect(footstepRadiusM('sneak', 'grass')).toBeLessThan(1);
    expect(footstepRadiusM('sneak', 'stone', true)).toBe(7);
    const steps = new Footsteps();
    let made = 0;
    for (let k = 0; k < 100; k++) if (steps.step(0.1, 'walk', 'dirt') > 0) made++;
    expect(made).toBeGreaterThanOrEqual(12);
    expect(made).toBeLessThanOrEqual(14);
  });

  it('walls halve how far a noise carries; rain masks it', () => {
    const e = { kind: 'crate' as const, x: 0, y: 0, z: 0, radiusM: 8, source: 'player' };
    expect(heard(e, { x: 6, z: 0 }, 1, 1, false)).toBeGreaterThan(0);
    expect(heard(e, { x: 6, z: 0 }, 1, 1, true)).toBe(0);
    expect(heard(e, { x: 3, z: 0 }, 1, 1, true)).toBeCloseTo(1 - 3 / (8 * WALL_FACTOR), 5);
    expect(weatherNoiseFactor(1, 0)).toBeLessThan(0.6);
    expect(weatherNoiseFactor(0, 1)).toBeGreaterThan(1);
  });
});

describe('seeing on foot', () => {
  const none = new ColliderSet();
  const lamps = new LampSet();
  const sight = { rangeM: 22, fovDeg: 100, peripheralDeg: 200 };
  const eye = { x: 0, y: 1.6, z: 0 };
  /** The guard faces north (−z); the figure is `d` meters ahead. */
  const glimpse = (d: number, exposure01: number, over: Partial<Figure> = {}) =>
    look({
      eye,
      eyeHeading: 0,
      sight,
      rangeFactor: 1,
      figure: figure({ z: -d, ...over }),
      exposure01,
      colliders: none,
      lamps,
      carried: [],
    });

  it('the range grows with exposure: meters in the dark, the full range lit', () => {
    expect(seeingRangeM(22, 0.6)).toBe(22);
    expect(seeingRangeM(22, 0.02)).toBeLessThan(5);
    expect(glimpse(8, 0.03).seen).toBe(false);
    expect(glimpse(8, 0.4).seen).toBe(true);
    expect(glimpse(20, 0.9).seen).toBe(true);
  });

  it('the cone, the edge of sight and behind', () => {
    expect(viewZone(0, eye, { x: 0, z: -5 }, sight)).toBe('cone');
    expect(viewZone(0, eye, { x: 5, z: 0 }, sight)).toBe('edge');
    expect(viewZone(0, eye, { x: 0, z: 5 }, sight)).toBe('none');
    expect(viewZone(0, eye, { x: 0, z: 0.8 }, sight)).toBe('cone');
  });

  it('cover hides part or all of a figure', () => {
    const crates = new ColliderSet();
    crates.add({ kind: 'box', x: 0, z: -5, halfX: 1, halfZ: 0.4, yaw: 0, minY: 0, maxY: 1.4 });
    const g = (over: Partial<Figure>) =>
      look({
        eye,
        eyeHeading: 0,
        sight,
        rangeFactor: 1,
        figure: figure({ z: -6, ...over }),
        exposure01: 0.9,
        colliders: crates,
        lamps,
        carried: [],
      });
    const standing = g({});
    expect(standing.seen).toBe(true);
    expect(standing.cover01).toBeLessThan(1);
    expect(g({ crouching: true, height: 1.15 }).seen).toBe(false);
  });
});

// ---------------------------------------------------------------------------------------
// The guards in the greybox district.

interface Run {
  stealth: Stealth;
  player: CharacterState;
  events: StealthEvent[];
  inputs: StealthInputs;
  tick(input?: Partial<{ forward: number; run: boolean; crouch: boolean }>, yaw?: number): void;
  walkTo(x: number, z: number, opts?: { run?: boolean; crouch?: boolean; maxS?: number }): boolean;
  wait(s: number): void;
}

function run(
  sky: SkyLight,
  opts: { fogM?: number; tier?: number; at?: { x: number; z: number }; guards?: GuardSpawn[] } = {},
): Run {
  const d = createGreyboxDistrict();
  const defs = gameNpcs();
  const spawns = opts.guards ?? rosterForTier(defs, d.guards, d.spareBeats, opts.tier ?? 0);
  const stealth = createStealth(
    { zone: d, nav: d.nav, lamps: d.lamps, rng: Rng.fromSeed('stealth-test'), lawPost: d.lawPost },
    defs,
    spawns,
    opts.tier ?? 0,
  );
  const start = opts.at ?? d.spawn.position;
  const player = createCharacter({ x: start.x, y: 1.5, z: start.z }, 0);
  const events: StealthEvent[] = [];
  stealth.on((e) => events.push(e));
  const inputs: StealthInputs = {
    player,
    sky,
    fogM: opts.fogM ?? 20000,
    rain01: 0,
    gameSeconds: NIGHT_GAME_S,
    suspect: false,
    fame01: 0.25,
    wantedTier: opts.tier ?? 0,
  };
  const r: Run = {
    stealth,
    player,
    events,
    inputs,
    tick(input = {}, yaw = player.heading) {
      stepCharacter(
        player,
        {
          forward: input.forward ?? 0,
          right: 0,
          run: input.run ?? false,
          crouch: input.crouch ?? false,
        },
        yaw,
        d,
        DT,
        DEFAULT_CONTROLLER,
      );
      inputs.gameSeconds += DT * 6;
      inputs.suspect =
        inRestricted(d, player.position) || player.crouching || player.gait === 'run';
      inputs.surface = d.surfaceAt(player.position.x, player.position.z, player.position.y);
      stealth.step(DT, inputs);
    },
    walkTo(x, z, o = {}) {
      const path = d.nav.findPath(player.position, { x, z });
      if (!path) throw new Error(`No path to ${x}, ${z}`);
      let s = 0;
      for (const p of path) {
        while (Math.hypot(p.x - player.position.x, p.z - player.position.z) > 0.4) {
          const yaw = Math.atan2(p.x - player.position.x, -(p.z - player.position.z));
          r.tick({ forward: 1, run: o.run ?? false, crouch: o.crouch ?? false }, yaw);
          s += DT;
          if (stealth.captured || s > (o.maxS ?? 120)) return false;
        }
      }
      return true;
    },
    wait(s) {
      for (let t = 0; t < s; t += DT) r.tick();
    },
  };
  return r;
}

const guardOf = (r: Run, id: string) => need(r.stealth.guard(id));

const firstAlert = (events: StealthEvent[]) => events.find((e) => e.type === 'PlayerSpotted');

describe('the greybox district', () => {
  const d = createGreyboxDistrict();

  it('guards can walk from the pier to the street round the warehouses', () => {
    const path = d.nav.findPath({ x: 12, z: 26 }, { x: -40, z: -18 });
    expect(path).toBeDefined();
    expect(d.nav.walkable({ x: 12, z: -8 })).toBe(false); // inside the east warehouse
    expect(d.nav.walkable({ x: 12, z: 30 })).toBe(true); // the pier deck
    expect(d.nav.walkable({ x: 30, z: 30 })).toBe(false); // the lake
    expect(d.nav.findPath({ x: 12, z: 26 }, { x: 10, z: 6 })).toBeDefined(); // into the yard
  });

  it('a Wanted tier adds constables and marshals, never past twelve', () => {
    const defs = gameNpcs();
    expect(rosterForTier(defs, d.guards, d.spareBeats, 0)).toHaveLength(d.guards.length);
    const t4 = rosterForTier(defs, d.guards, d.spareBeats, 4);
    expect(t4.filter((g) => g.type === 'npc.marshal')).toHaveLength(1);
    expect(t4.filter((g) => g.type === 'npc.constable').length).toBeGreaterThan(1);
    const many = Array.from({ length: 11 }, (_, k) => ({ ...need(d.guards[0]), id: `g${k}` }));
    expect(rosterForTier(defs, many, d.spareBeats, 5)).toHaveLength(MAX_GUARDS);
  });
});

describe('guards (plan 08 §5.2)', () => {
  it('walk their beats', () => {
    const r = run(NEW_MOON, { at: { x: -50, z: 30 } });
    const g = guardOf(r, 'constable.street');
    const x0 = g.body.position.x;
    r.wait(10);
    expect(Math.abs(g.body.position.x - x0)).toBeGreaterThan(8);
    expect(g.state).toBe('patrol');
  });

  it('see you lit in the yard, give chase and take you if you stand there', () => {
    // Under the gate lamp, in front of the yard watchman's first stop.
    const r = run(FULL_MOON, {
      guards: [
        {
          id: 'w',
          type: 'npc.watchman',
          route: { loop: false, points: [{ x: 3, z: 1, waitS: 999, face: Math.PI }] },
        },
      ],
      at: { x: 3, z: 6 },
    });
    r.wait(4);
    expect(firstAlert(r.events)).toBeDefined();
    expect(guardOf(r, 'w').state).toBe('alerted');
    r.wait(4);
    expect(r.stealth.captured).toBe(true);
    const caught = r.events.find((e) => e.type === 'Captured');
    expect(caught).toMatchObject({ by: 'npc.watchman' });
    expect(r.stealth.readout().captured).toBe(true);
    expect(GRAB_S).toBeLessThan(2);
  });

  it('a constable reports at once; a watchman runs for one', () => {
    const constable = run(FULL_MOON, {
      guards: [
        {
          id: 'c',
          type: 'npc.constable',
          route: { loop: false, points: [{ x: 3, z: 1, waitS: 999, face: Math.PI }] },
        },
      ],
      at: { x: 3, z: 6 },
    });
    constable.wait(4);
    expect(constable.events.find((e) => e.type === 'GuardReported')).toMatchObject({
      npc: 'c',
      why: 'seen',
    });
    expect(constable.stealth.witnesses()[0]).toMatchObject({ id: 'c', kind: 'constable' });

    // A moonless night: the gate lamp shows you, the dark wharf hides you.
    const watch = run(NEW_MOON, {
      guards: [
        {
          id: 'w',
          type: 'npc.watchman',
          route: { loop: false, points: [{ x: 3, z: 1, waitS: 999, face: Math.PI }] },
        },
      ],
      at: { x: 3, z: 6 },
    });
    for (let s = 0; s < 4 && guardOf(watch, 'w').state !== 'alerted'; s += DT) watch.tick();
    expect(guardOf(watch, 'w').state).toBe('alerted');
    expect(watch.events.some((e) => e.type === 'GuardReported')).toBe(false);
    // Run off out the gate and away down the dark west wharf.
    watch.walkTo(-40, 17, { run: true, maxS: 40 });
    expect(watch.stealth.captured).toBe(false);
    watch.wait(90);
    const w = guardOf(watch, 'w');
    expect(watch.events.some((e) => e.type === 'NpcStateChanged' && e.to === 'fetch')).toBe(true);
    expect(watch.events.find((e) => e.type === 'GuardReported')).toMatchObject({ npc: 'w' });
    expect(['return', 'patrol']).toContain(w.state);
  });

  it('a close, lit look learns your face, faster the more famous you are', () => {
    const t = (fame01: number) => {
      const r = run(FULL_MOON, {
        guards: [
          {
            id: 's',
            type: 'npc.sailor',
            route: { loop: false, points: [{ x: 3, z: 3, waitS: 999, face: Math.PI }] },
          },
        ],
        at: { x: 3, z: 6 },
      });
      r.inputs.fame01 = fame01;
      let s = 0;
      while (!r.events.some((e) => e.type === 'PlayerIdentified') && s < 30) {
        r.tick();
        s += DT;
      }
      return s;
    };
    const famous = t(1);
    const unknown = t(0);
    expect(famous).toBeLessThan(6);
    expect(unknown).toBeGreaterThan(famous * 2);
  });

  it('by day in the street nobody minds you; at Wanted tier 2 a known face is trouble', () => {
    // Walk west along the street, meeting the constable coming east.
    const plain = run(DAY, { at: { x: 30, z: -18 } });
    plain.inputs.fame01 = 1;
    plain.walkTo(-36, -18);
    expect(firstAlert(plain.events)).toBeUndefined();
    const wanted = run(DAY, { at: { x: 30, z: -18 }, tier: 2 });
    wanted.inputs.fame01 = 1;
    wanted.walkTo(-36, -18);
    expect(firstAlert(wanted.events)).toBeDefined();
  });

  it('hear running on planks behind them, and come to look', () => {
    const r = run(NEW_MOON, {
      guards: [
        {
          id: 'c',
          type: 'npc.constable',
          route: { loop: false, points: [{ x: 12, z: 36, waitS: 999, face: Math.PI }] },
        },
      ],
      at: { x: 12, z: 24 },
    });
    // Sneak toward his back: nothing.
    r.walkTo(12, 30, { crouch: true });
    expect(guardOf(r, 'c').state).toBe('patrol');
    // Run: he turns.
    r.walkTo(12, 22, { run: true });
    expect(guardOf(r, 'c').state).toBe('suspicious');
  });

  it('a thrown stone draws them off; a bribed guard looks away', () => {
    const r = run(FULL_MOON, {
      guards: [
        {
          id: 'w',
          type: 'npc.watchman',
          route: { loop: false, points: [{ x: 3, z: 1, waitS: 999, face: Math.PI }] },
        },
      ],
      at: { x: -20, z: 16 },
    });
    r.stealth.noiseAt('distraction', { x: 10, y: 1.5, z: 4 });
    r.wait(0.1);
    expect(guardOf(r, 'w').state).toBe('distracted');
    r.wait(4);
    expect(
      Math.hypot(guardOf(r, 'w').body.position.x - 10, guardOf(r, 'w').body.position.z - 4),
    ).toBeLessThan(3);

    const b = run(FULL_MOON, {
      guards: [
        {
          id: 'w',
          type: 'npc.watchman',
          route: { loop: false, points: [{ x: 3, z: 1, waitS: 999, face: Math.PI }] },
        },
      ],
      at: { x: 3, z: 6 },
    });
    b.stealth.bribe('w', NIGHT_GAME_S + 3600);
    b.wait(4);
    expect(firstAlert(b.events)).toBeUndefined();
  });

  it('a knocked-out guard wakes and reports; a body raises the alarm (exit criterion 5)', () => {
    const r = run(NEW_MOON, { at: { x: -50, z: 30 } });
    r.stealth.knockOut('constable.street', r.inputs.gameSeconds);
    expect(guardOf(r, 'constable.street').state).toBe('unconscious');
    r.wait(1);
    r.inputs.gameSeconds += KNOCKOUT_GAME_S;
    r.wait(0.2);
    expect(r.events.find((e) => e.type === 'GuardWoke')).toMatchObject({ npc: 'constable.street' });
    expect(r.events.find((e) => e.type === 'GuardReported')).toMatchObject({ why: 'assault' });

    // Kill the yard watchman where the constable's beat will pass him.
    const k = run(NEW_MOON, {
      guards: [
        {
          id: 'w',
          type: 'npc.watchman',
          route: { loop: false, points: [{ x: -10, z: -17, waitS: 999 }] },
        },
        {
          id: 'c',
          type: 'npc.constable',
          route: {
            loop: false,
            points: [
              { x: -30, z: -18 },
              { x: 10, z: -18 },
            ],
          },
        },
      ],
      at: { x: -50, z: 30 },
    });
    k.wait(1);
    k.stealth.kill('w');
    k.wait(20);
    expect(k.events.find((e) => e.type === 'BodyFound')).toMatchObject({
      npc: 'w',
      finder: 'c',
      dead: true,
    });
    expect(k.events.find((e) => e.type === 'GuardReported')).toMatchObject({
      npc: 'c',
      why: 'body',
    });
    expect(guardOf(k, 'c').state).toBe('search');
  });

  it('a drunk guard sees little, then passes out', () => {
    const r = run(FULL_MOON, {
      guards: [
        {
          id: 's',
          type: 'npc.sailor',
          route: { loop: false, points: [{ x: 12.5, z: 30, waitS: 999, face: Math.PI }] },
        },
      ],
      at: { x: 12, z: 40 },
    });
    r.stealth.makeDrunk('s', r.inputs.gameSeconds, 600);
    r.wait(2);
    expect(guardOf(r, 's').state).toBe('drunk');
    r.inputs.gameSeconds += 700;
    r.wait(0.1);
    expect(guardOf(r, 's').state).toBe('unconscious');
  });
});

/**
 * Exit criterion 3 (plan 08 §20.3): a moonless, foggy night is noticeably easier than a
 * clear full moon. The same walk, past the yard watchman and the constable, both nights.
 */
describe('the same route on two nights', () => {
  const route = (sky: SkyLight, fogM: number) => {
    const r = run(sky, { fogM, at: { x: -30, z: 17 } });
    let worst = 0;
    const done = [
      [-2, 17],
      [-2, 6],
      [8, 6],
      [10, 16],
      [40, 16],
    ].every(([x, z]) => {
      const ok = r.walkTo(need(x), need(z), { crouch: true, maxS: 60 });
      for (const g of r.stealth.guards) worst = Math.max(worst, g.meter);
      return ok;
    });
    return { alerted: Boolean(firstAlert(r.events)), worst, done, captured: r.stealth.captured };
  };

  it('is noticeably easier on a foggy new moon', () => {
    const moonlit = route(FULL_MOON, 20000);
    const dark = route(NEW_MOON, 120);
    expect(moonlit.alerted).toBe(true);
    expect(dark.alerted).toBe(false);
    expect(dark.done).toBe(true);
  });
});

describe('the stealth HUD', () => {
  it('words for the gem and the ring', () => {
    expect(gemView(0.02).words).toBe('Hidden');
    expect(gemView(0.9).level).toBe('exposed');
    expect(noiseView(0).level).toBe('silent');
    expect(noiseView(2).level).toBe('quiet');
    expect(noiseView(18).ring01).toBe(1);
  });

  it('eyes over guards who noticed, pinned to the edge when off screen', () => {
    const base = {
      light: { level01: 0, ambient01: 0, lamps01: 0, brightest: undefined },
      exposure01: 0,
      noiseM: 0,
      pursued: false,
      searched: false,
      captured: false,
    };
    const g = (
      id: string,
      state: 'patrol' | 'alerted' | 'unconscious',
      meter: number,
      x: number,
    ) => ({
      id,
      name: id,
      type: 'npc.watchman',
      state,
      meter,
      identified: false,
      x,
      y: 2,
      z: 0,
    });
    const readout = {
      ...base,
      guards: [
        g('calm', 'patrol', 0, 0),
        g('looking', 'patrol', 0.5, 0),
        g('out', 'unconscious', 0, 0),
        g('behind', 'alerted', 1, 50),
      ],
    };
    const project = (p: { x: number }) => ({ x: 400 + p.x * 100, y: 300, behind: false });
    const eyes = eyeViews(readout, { x: 0, z: 0 }, project, { width: 800, height: 600 });
    expect(eyes.map((e) => e.id)).toEqual(['looking', 'behind']);
    expect(need(eyes[0]).state).toBe('suspicious');
    const behind = need(eyes[1]);
    expect(behind.onScreen).toBe(false);
    expect(behind.x).toBeLessThanOrEqual(800);
    expect(behind.angle).toBeCloseTo(Math.PI / 2, 3);
    expect(
      stealthHud(readout, { x: 0, z: 0 }, project, { width: 800, height: 600 }, NIGHT_GAME_S)
        .danger,
    ).toBe('searching');
  });

  it('counts down to dawn at night only', () => {
    const night = dawnView(NIGHT_GAME_S);
    expect(night).toBeDefined();
    expect(need(night).gameSecondsLeft).toBeGreaterThan(3 * 3600);
    expect(need(night).gameSecondsLeft).toBeLessThan(9 * 3600);
    expect(need(night).text).toMatch(/^Dawn in \d+ h \d\d m$/);
    expect(dawnView(13 * 3600)).toBeUndefined();
  });
});

describe('the perception budget (plan 08 §20.3 #10)', () => {
  it('twelve guards cost well under a millisecond a tick', () => {
    const d = createGreyboxDistrict();
    const roster = rosterForTier(gameNpcs(), d.guards, d.spareBeats, 5);
    for (let k = 0; roster.length < MAX_GUARDS; k++) {
      roster.push({
        id: `extra.${k}`,
        type: 'npc.watchman',
        route: need(d.spareBeats[k % d.spareBeats.length]),
      });
    }
    const r = run(FULL_MOON, { tier: 5, at: { x: 10, z: 16 }, guards: roster });
    expect(r.stealth.guards).toHaveLength(MAX_GUARDS);
    r.wait(2);
    let total = 0;
    const n = 600;
    for (let k = 0; k < n; k++) {
      r.tick();
      total += r.stealth.lastStepMs;
    }
    const avg = total / n;
    // Generous in a shared CI runner; the bench prints the real figure.
    expect(avg).toBeLessThan(1);
  });
});
