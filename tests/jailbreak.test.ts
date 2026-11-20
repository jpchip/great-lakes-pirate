import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import bayfieldJson from '../data/districts/bayfield.json';
import { SECONDS_PER_GAME_DAY } from '../src/core/time';
import { buildDistrict } from '../src/gameplay/district/district';
import { DistrictNav } from '../src/gameplay/district/district-nav';
import { decodeGround } from '../src/gameplay/district/ground';
import { createCharacter, DEFAULT_CONTROLLER } from '../src/gameplay/onfoot/controller';
import {
  JAILER_ID,
  jailCell,
  jailGuards,
  type JailbreakEvent,
} from '../src/gameplay/onfoot/jailbreak';
import type { Pockets } from '../src/gameplay/onfoot/tools';
import { createWatch } from '../src/gameplay/onfoot/watch';
import { NavMesh, type NavMeshData } from '../src/sim/district/navmesh';
import { parseLayout } from '../src/sim/district/layout';
import { gameLaw, tierDef } from '../src/sim/law/defs';
import {
  beginBreakout,
  breakoutDawn,
  breakoutRefusal,
  breakoutStart,
  escapeJail,
  gameJail,
  jailbreakRules,
  lockupAt,
  imprison,
  imprisonMinor,
  owePromise,
  promiseCents,
  recapture,
  settleDebt,
  standDown,
} from '../src/sim/law/jail';
import { setHeat } from '../src/sim/law/law';
import { createWorldState, parseWorldState, type WorldState } from '../src/sim/world-state';

/**
 * Phase 7 piece G (plan 08 §9, §20.3 #7): the jail's rules for a breakout, and the cell
 * played on the real Bayfield district with its baked ground and navmesh.
 */

const dir = join(import.meta.dirname, '..', 'public', 'districts', 'bayfield');
const groundPath = join(dir, 'ground.bin');
const baked = existsSync(groundPath) && readFileSync(groundPath).byteLength > 200;

const defs = gameLaw();
const jail = gameJail();
const bayfield = lockupAt(jail, 'port.bayfield');
const rules = jailbreakRules(jail, bayfield);
const REGION = 'region.apostles';
const DT = 1 / 60;
const DAY = 160 * SECONDS_PER_GAME_DAY;
const NOON = DAY + 12 * 3600;
const NIGHT = DAY + 23 * 3600;

function jailed(tier: number): WorldState {
  const s = createWorldState('jailbreak', NOON);
  setHeat(defs, s, REGION, tierDef(defs, tier).minHeat + 1);
  s.player.purse = 5000;
  imprison(defs, jail, s, { region: REGION, by: 'npc.constable', how: 'subdued' }, NOON);
  return s;
}

describe("the jail's rules for a breakout (plan 08 §9)", () => {
  it('is open to any prisoner but one in for a fine, and once only before the rope', () => {
    const s = jailed(3);
    if (!s.jail) throw new Error('not jailed');
    expect(breakoutRefusal(s.jail)).toBeUndefined();
    beginBreakout(s.jail);
    expect(s.jail.breakout).toEqual({ attempts: 1, active: true });
    recapture(jail, s);
    expect(breakoutRefusal(s.jail)).toBeUndefined();

    const minor = createWorldState('minor', NOON);
    const m = imprisonMinor(
      defs,
      jail,
      minor,
      { region: REGION, by: 'npc.constable', how: 'subdued' },
      NOON,
    );
    expect(breakoutRefusal(m)).toBe('minor');

    const doomed = jailed(5);
    if (!doomed.jail) throw new Error('not jailed');
    expect(doomed.jail.execution).toBe(true);
    expect(breakoutRefusal(doomed.jail)).toBeUndefined();
    beginBreakout(doomed.jail);
    expect(breakoutRefusal(doomed.jail)).toBe('spent');
  });

  it('starts at eleven that night, or at once in the small hours, and ends at dawn', () => {
    expect(breakoutStart(jail, NOON)).toBe(DAY + rules.startHour * 3600);
    expect(breakoutStart(jail, NIGHT + 1800)).toBe(NIGHT + 1800);
    const small = DAY + 2 * 3600;
    expect(breakoutStart(jail, small)).toBe(small);
    // Too near dawn to try: tonight.
    expect(breakoutStart(jail, DAY + 5 * 3600)).toBe(DAY + rules.startHour * 3600);
    expect(breakoutDawn(jail, NIGHT)).toBe(DAY + SECONDS_PER_GAME_DAY + rules.dawnHour * 3600);
    expect(breakoutDawn(jail, small)).toBe(DAY + rules.dawnHour * 3600);
  });

  it('out is out: no sentence, nothing given back', () => {
    const s = jailed(2);
    const was = escapeJail(s);
    expect(s.jail).toBeNull();
    expect(was.confiscated.cashCents).toBe(5000);
    expect(s.player.purse).toBe(0);
  });

  it('recaptured, the sentence grows; at tier 5 it is the rope', () => {
    const s = jailed(2);
    if (!s.jail) throw new Error('not jailed');
    const { sentenceWeeks, releaseAt } = s.jail;
    beginBreakout(s.jail);
    expect(recapture(jail, s)).toEqual({ weeks: rules.recaptureWeeks });
    expect(s.jail.sentenceWeeks).toBe(sentenceWeeks + rules.recaptureWeeks);
    expect(s.jail.releaseAt).toBe(releaseAt + rules.recaptureWeeks * SECONDS_PER_GAME_DAY);
    expect(s.jail.breakout.active).toBe(false);

    const doomed = jailed(5);
    if (!doomed.jail) throw new Error('not jailed');
    beginBreakout(doomed.jail);
    expect(recapture(jail, doomed)).toBe('execution');
  });

  it('an attempt that came to nothing costs nothing', () => {
    const s = jailed(2);
    if (!s.jail) throw new Error('not jailed');
    const { releaseAt } = s.jail;
    beginBreakout(s.jail);
    standDown(s);
    expect(s.jail.breakout).toEqual({ attempts: 1, active: false });
    expect(s.jail.releaseAt).toBe(releaseAt);
  });

  it('the jailer takes a promise by what you are wanted for, and none from the worst', () => {
    const cents = (tier: number) => {
      const s = jailed(tier);
      return s.jail ? promiseCents(jail, s.jail) : undefined;
    };
    expect(cents(1)).toBe(rules.promise.cents[1]);
    expect(cents(3)).toBe(rules.promise.cents[3]);
    expect(cents(3)).toBeGreaterThan(cents(1) ?? 0);
    expect(cents(4)).toBeUndefined();
    expect(cents(5)).toBeUndefined();
  });

  it('the promise comes due: from the purse, and what is short is heat', () => {
    const s = jailed(2);
    owePromise(jail, s, 4000, NIGHT);
    escapeJail(s);
    const due = NIGHT + rules.promise.dueDays * SECONDS_PER_GAME_DAY;
    expect(s.jailDebt).toEqual({ cents: 4000, dueAt: due, region: bayfield.region });
    expect(settleDebt(defs, jail, s, due - 1)).toBeUndefined();

    // Through a save, and paid in full.
    const paid = parseWorldState(JSON.parse(JSON.stringify(s)));
    paid.player.purse = 6000;
    const heat = paid.wanted[bayfield.region]?.heat ?? 0;
    expect(settleDebt(defs, jail, paid, due)).toMatchObject({ paidCents: 4000, shortCents: 0 });
    expect(paid.player.purse).toBe(2000);
    expect(paid.jailDebt).toBeUndefined();
    expect(paid.wanted[bayfield.region]?.heat ?? 0).toBe(heat);

    // Short: he talks.
    s.player.purse = 1000;
    expect(settleDebt(defs, jail, s, due)).toMatchObject({ paidCents: 1000, shortCents: 3000 });
    expect(s.player.purse).toBe(0);
    expect(s.wanted[bayfield.region]?.heat ?? 0).toBe(heat + rules.promise.heat);
    expect(s.jailDebt).toBeUndefined();
  });

  it('loads a jail saved before the jailbreak', () => {
    const s = jailed(2);
    const raw = JSON.parse(JSON.stringify(s)) as { jail: Record<string, unknown> };
    delete raw.jail['breakout'];
    expect(parseWorldState(raw).jail?.breakout).toEqual({ attempts: 0, active: false });
  });
});

function load() {
  const model = buildDistrict(
    parseLayout(structuredClone(bayfieldJson)),
    decodeGround(new Uint8Array(readFileSync(groundPath))),
  );
  const mesh = new NavMesh(
    JSON.parse(readFileSync(join(dir, 'navmesh.json'), 'utf8')) as NavMeshData,
  );
  return { model, nav: new DistrictNav(mesh, (x, z) => model.floorAt(x, z)) };
}

function scene(
  opts: {
    execution?: boolean;
    promise?: number | undefined;
    bootPick?: boolean;
    tier?: number;
  } = {},
) {
  const { model, nav } = load();
  const clock = { t: NIGHT };
  const pockets: Pockets = { purse: 0, stores: {} };
  const events: JailbreakEvent[] = [];
  const notices: string[] = [];
  const captured: string[] = [];
  const watch = createWatch({
    model,
    nav,
    tier: opts.tier ?? 0,
    seed: 'jailbreak',
    conditions: () => ({
      gameSeconds: clock.t,
      cloud01: 0,
      fogM: 20_000,
      rain01: 0,
      wantedTier: opts.tier ?? 0,
      fame01: 0.2,
    }),
    onCaptured: (by) => captured.push(by),
    pockets,
    heist: {
      targets: [],
      world: { containers: {}, doors: {} },
      hooks: {
        stowPoints: () => [],
        stow: () => undefined,
        perk: (id) => !!opts.bootPick && id === 'perk.boot_lockpick',
        notice: (text) => notices.push(text),
      },
    },
    jailbreak: {
      rules,
      execution: opts.execution ?? false,
      promiseCents: 'promise' in opts ? opts.promise : 1500,
      dawnAt: breakoutDawn(jail, NIGHT),
      on: (e) => events.push(e),
    },
  });
  const jb = watch.jailbreak;
  if (!jb) throw new Error('no jailbreak');
  const player = createCharacter({ x: 0, y: 0, z: 0 });
  const s = {
    model,
    watch,
    jb,
    clock,
    events,
    notices,
    captured,
    player,
    jailer: () => {
      const g = watch.stealth.guard(JAILER_ID);
      if (!g) throw new Error('no jailer');
      return g;
    },
    stand(x: number, z: number) {
      player.position.x = x;
      player.position.z = z;
      player.position.y = model.floorAt(x, z);
    },
    step(seconds = DT) {
      for (let t = 0; t < seconds; t += DT) watch.step(DT, player);
    },
    /** Holds F for `sec`, stepping the watch as the game does. */
    hold(sec: number) {
      let first = true;
      for (let t = 0; t < sec; t += DT) {
        watch.step(DT, player);
        watch.interact(DT, player, true, first);
        first = false;
      }
      watch.interact(DT, player, false, false);
    },
    press() {
      watch.interact(DT, player, true, true);
      watch.interact(DT, player, false, false);
    },
    prompt: () => watch.toolsHud(player)?.prompt,
    /** Steps until `test` holds, up to `maxS`. */
    until(test: () => boolean, maxS = 120) {
      for (let t = 0; t < maxS && !test(); t += DT) watch.step(DT, player);
      return test();
    },
  };
  s.stand(jb.cell.spawn.x, jb.cell.spawn.z);
  s.step();
  return s;
}

describe.runIf(baked)('the cell (plan 08 §9)', () => {
  it('is the west cell of the lockup, behind its door of bars', () => {
    const { model } = load();
    const cell = jailCell(model, rules);
    expect(cell).toMatchObject({ minX: 36, maxX: 42, minZ: 40, maxZ: 46 });
    expect(cell?.door.id).toBe(rules.cellDoor);
    expect(model.buildingAt(39.5, model.floorAt(39.5, 43.5) + 0.5, 43.5)?.def.id).toBe('lockup');
  });

  it('posts the jailer on his round, and more of the law before a hanging', () => {
    const { model } = load();
    const usual = jailGuards(model, rules, false);
    expect(usual.map((g) => g.id)).toEqual([JAILER_ID]);
    expect(usual[0]?.route.points).toHaveLength(3);
    const hanging = jailGuards(model, rules, true);
    expect(hanging.map((g) => g.type)).toEqual(['npc.constable', 'npc.constable', 'npc.marshal']);
  });

  it('holds you: the door is shut, and a prisoner in his cell is nothing to look at', () => {
    const s = scene({ tier: 3 });
    expect(s.jb.inCell).toBe(true);
    expect(s.jb.doorOpen).toBe(false);
    expect(s.prompt()?.label).toBe('Bang on the bars');
    // Watched for a full round, nobody minds.
    s.step(60);
    expect(s.watch.pursued).toBe(false);
    expect(s.jailer().state).toBe('patrol');
    expect(s.captured).toEqual([]);
  });
});

describe.runIf(baked)('the ways out (plan 08 §9)', () => {
  /** Runs the jailer round to his stop by the bars. */
  const atBars = (s: ReturnType<typeof scene>): boolean => {
    const bars = s.model.mark('jail.bars');
    if (!bars) throw new Error('no bars mark');
    return s.until(() => {
      const g = s.jailer();
      const p = g.body.position;
      return Math.hypot(p.x - bars.x, p.z - bars.z) < 0.5 && g.waitS > 4;
    });
  };

  it('his keys: off his belt through the bars while he looks the other way', () => {
    const s = scene();
    expect(atBars(s)).toBe(true);
    // Behind his shoulder, close against the bars.
    s.stand(40.7, 40.5);
    s.step();
    expect(s.prompt()?.label).toBe('Lift the keys from his belt');
    // He comes over facing the cells, then turns to look along them.
    expect(s.until(() => s.prompt()?.ok === true, 5)).toBe(true);
    // Looking your way, there's no doing it.
    const g = s.jailer();
    const was = g.body.heading;
    g.body.heading = Math.atan2(40.7 - g.body.position.x, -(40.5 - g.body.position.z));
    expect(s.prompt()).toMatchObject({ ok: false, why: "He's looking at you" });
    g.body.heading = was;

    s.hold(rules.keys.liftS + 0.2);
    expect(s.jb.hasKeys).toBe(true);
    expect(s.events.map((e) => e.type)).toContain('KeysLifted');
    expect(s.jailer().state).toBe('patrol');

    // Back at his desk, the door.
    s.until(() => s.jailer().body.position.x > 43.5);
    s.stand(39, 40.7);
    s.step();
    expect(s.prompt()?.label).toBe('Unlock the cell door');
    s.press();
    expect(s.jb.doorOpen).toBe(true);
    expect(s.events).toContainEqual({ type: 'CellOpened', how: 'keys' });

    // Out of the cell you're an escaped man to anyone who sees you.
    expect(s.jb.suspect()).toBe(false);
    s.stand(39, 38.6);
    s.step();
    expect(s.jb.inCell).toBe(false);
    expect(s.jb.left).toBe(true);
    expect(s.jb.suspect()).toBe(true);
    expect(s.events.map((e) => e.type)).toContain('LeftCell');
    expect(s.prompt()).toBeUndefined();
  });

  it("a pick in the Poacher's boot opens the cell door, and nobody else's does", () => {
    const plain = scene();
    plain.stand(39, 40.7);
    plain.step();
    expect(plain.prompt()?.label).toBe('Bang on the bars');

    const s = scene({ bootPick: true });
    s.stand(39, 40.7);
    s.step();
    expect(s.prompt()?.label).toBe(`Pick the cell lock (tier ${rules.cellLock})`);
    // Let go half-way: the work stays.
    s.hold(1.2);
    expect(s.jb.doorOpen).toBe(false);
    expect(s.prompt()?.hold01).toBeGreaterThan(0.3);
    s.hold(4);
    expect(s.jb.doorOpen).toBe(true);
    expect(s.events).toContainEqual({ type: 'CellOpened', how: 'pick' });
  });

  it('banging on the bars brings him in to look, and he locks up again after', () => {
    const s = scene();
    s.stand(37.2, 40.7);
    s.step();
    s.press();
    expect(s.events.map((e) => e.type)).toContain('BarsBanged');
    expect(s.prompt()).toMatchObject({ label: 'Bang on the bars', ok: false });
    expect(s.until(() => s.jb.doorOpen, 15)).toBe(true);
    expect(s.events).toContainEqual({ type: 'CellOpened', how: 'jailer' });
    expect(s.notices.join(' ')).toContain('unlocks the door');
    // Still there when he's looked, he turns the key again and goes back to his round.
    expect(s.until(() => !s.jb.doorOpen, 30)).toBe(true);
    expect(s.events.map((e) => e.type)).toContain('CellLocked');
    expect(s.captured).toEqual([]);
  });

  it('a promise of stashed money turns the key, and is owed', () => {
    const s = scene({ promise: 4000 });
    expect(atBars(s)).toBe(true);
    s.stand(40.4, 41.6);
    s.step();
    expect(s.prompt()).toMatchObject({
      label: 'Promise the jailer $40 from your stash',
      ok: true,
    });
    s.press();
    expect(s.jb.doorOpen).toBe(true);
    expect(s.events).toContainEqual({ type: 'Promised', cents: 4000 });
    expect(s.jailer().state).toBe('bribed');
    // Past him and out through the front room: he looks the other way.
    s.stand(39, 38.6);
    s.step(8);
    expect(s.jailer().state).toBe('bribed');
    expect(s.watch.pursued).toBe(false);
  });

  it("he won't hear a promise from a man wanted for too much", () => {
    const s = scene({ promise: undefined });
    expect(atBars(s)).toBe(true);
    s.stand(40.4, 41.6);
    s.step();
    expect(s.prompt()).toMatchObject({ label: 'Promise the jailer money', ok: false });
    s.press();
    expect(s.jb.doorOpen).toBe(false);
    expect(s.jailer().state).toBe('patrol');
  });

  it('out of the cell, the jailer who sees you comes for you', () => {
    const s = scene({ bootPick: true });
    s.stand(39, 40.7);
    s.hold(5);
    expect(s.jb.doorOpen).toBe(true);
    // Stood in the front room under his nose.
    s.stand(42.5, 38.4);
    expect(s.until(() => s.watch.pursued, 20)).toBe(true);
    expect(s.until(() => s.captured.length > 0, 20)).toBe(true);
  });

  it('ends at dawn: tried or not', () => {
    const quiet = scene();
    quiet.clock.t = breakoutDawn(jail, NIGHT) + 1;
    quiet.step();
    expect(quiet.events).toContainEqual({ type: 'Dawn', tried: false });

    const out = scene({ bootPick: true });
    out.stand(39, 40.7);
    out.hold(5);
    out.clock.t = breakoutDawn(jail, NIGHT) + 1;
    out.step(1);
    expect(out.events.filter((e) => e.type === 'Dawn')).toEqual([{ type: 'Dawn', tried: true }]);
  });
});

describe.runIf(baked)('the one chance (plan 08 §9, tier 5)', () => {
  it('starts in irons that take time to slip, and keep the work done', () => {
    const s = scene({ execution: true, promise: undefined, tier: 5 });
    expect(s.jb.inIrons).toBe(true);
    expect(s.prompt()?.label).toBe('Slip the irons');
    const held = s.watch.params({ ...DEFAULT_CONTROLLER });
    expect([held.walkSpeed, held.runSpeed, held.sneakSpeed]).toEqual([0, 0, 0]);
    s.hold(rules.irons.slipS / 2);
    expect(s.jb.inIrons).toBe(true);
    expect(s.prompt()?.hold01).toBeCloseTo(0.5, 1);
    s.hold(rules.irons.slipS / 2 + 0.2);
    expect(s.jb.inIrons).toBe(false);
    expect(s.events.map((e) => e.type)).toContain('IronsSlipped');
    expect(s.watch.params({ ...DEFAULT_CONTROLLER }).walkSpeed).toBe(DEFAULT_CONTROLLER.walkSpeed);
    expect(s.prompt()?.label).toBe('Bang on the bars');
  });

  it('has another constable in the lockup and a marshal at its door, and no promises', () => {
    const s = scene({ execution: true, promise: undefined, tier: 5 });
    const types = s.watch.stealth.guards.map((g) => `${g.id}:${g.type.id}`);
    expect(types).toContain('constable.lockup_2:npc.constable');
    expect(types).toContain('marshal.lockup_1:npc.marshal');
    s.hold(rules.irons.slipS + 0.2);
    const bars = s.model.mark('jail.bars');
    if (!bars) throw new Error('no bars mark');
    s.until(() => {
      const p = s.jailer().body.position;
      return Math.hypot(p.x - bars.x, p.z - bars.z) < 0.5 && s.jailer().waitS > 4;
    });
    s.stand(40.4, 41.6);
    s.step();
    expect(s.prompt()?.label).toBe('Bang on the bars');
    // Wanted as you are, you're still nothing to look at behind the bars.
    s.step(30);
    expect(s.captured).toEqual([]);
  });
});
