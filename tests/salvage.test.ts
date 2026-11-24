import { describe, expect, it } from 'vitest';
import salvageJson from '../data/salvage.json';
import { salvageFileSchema } from '../data/schemas/salvage';
import { chartToZone } from '../src/core/coords';
import { EventBus } from '../src/core/events';
import { Rng } from '../src/core/rng';
import { attachDiscovery } from '../src/gameplay/discovery';
import { attachEconomy } from '../src/gameplay/economy';
import type { GameLaw } from '../src/gameplay/law';
import { attachSalvage } from '../src/gameplay/salvage';
import type { GameContext, GameEvents } from '../src/modes/context';
import { createWorldState, parseWorldState } from '../src/sim/world-state';
import { gameLaw } from '../src/sim/law/defs';
import { worldChart } from '../src/sim/discovery/discovery';
import {
  ageDaysOld,
  castChance,
  castGrapple,
  castRefusal,
  cargoLeft,
  depthSpike,
  oldWrecks,
  pickedClean,
  progressOf,
  SALVAGE_RULES,
  seenOnBottom,
  soundShare,
  wreckClaim,
  freshSalvage,
} from '../src/sim/salvage';
import { defFrame, zoneDef, APOSTLES_ID } from '../src/sim/terrain/zones';
import { freshWrecks, recordWreck } from '../src/sim/wrecks';
import type { Witness } from '../src/sim/law/witness';

const T0 = 10 * 3600;
const R = SALVAGE_RULES;
const must = <T>(v: T | undefined): T => {
  if (v === undefined) throw new Error('missing');
  return v;
};

describe('salvage data and old wrecks', () => {
  it('parses, and the record has the Lucerne', () => {
    const f = salvageFileSchema.parse(salvageJson);
    expect(f.historical.map((h) => h.id)).toContain('wreck.lucerne');
    expect(f.seeded.spots.length).toBeGreaterThanOrEqual(f.seeded.count);
  });

  it('seeds the same invented wrecks for a run, and others for another', () => {
    const a = oldWrecks('run-a');
    const b = oldWrecks('run-a');
    const c = oldWrecks('run-zz');
    expect(a.map((w) => w.name)).toEqual(b.map((w) => w.name));
    const seededA = a.filter((w) => w.seeded);
    expect(seededA).toHaveLength(3);
    const key = (ws: typeof a) =>
      ws
        .filter((w) => w.seeded)
        .map((w) => `${w.name}@${w.where}`)
        .join('|');
    expect(key(a)).not.toEqual(key(c));
    // Each seeded wreck's papers name the next; the last stands alone.
    expect(seededA[0]?.papers?.lead).toBe(seededA[1]?.id);
    expect(seededA[2]?.papers?.lead).toBeUndefined();
    expect(seededA.every((w) => w.lostYear >= 1868 && w.lostYear <= 1898)).toBe(true);
  });
});

describe('the lake on a cargo', () => {
  it('keeps ore, rots flour, rusts hardware slowly', () => {
    const years14 = 14 * 365;
    expect(soundShare('good.iron_ore', years14)).toBe(1);
    expect(soundShare('good.whiskey', years14)).toBe(1);
    expect(soundShare('good.flour', years14)).toBeLessThan(0.001);
    expect(soundShare('good.flour', 30)).toBeCloseTo(0.5);
    expect(soundShare('good.hardware', 3650)).toBeCloseTo(0.5);
  });

  it('counts the Lucerne about 14 years down in 1900', () => {
    const lucerne = must(oldWrecks('x').find((w) => w.id === 'wreck.lucerne'));
    const days = ageDaysOld(lucerne.lostMs, T0);
    expect(days / 365.25).toBeGreaterThan(13);
    expect(days / 365.25).toBeLessThan(14);
  });
});

describe('finding and working a wreck', () => {
  it('is seen on the bottom only by day in a calm in clear shallow water', () => {
    const c = { distM: 30, depthM: 6, hsM: 0.2, daylight: 1, visibilityM: 10_000 };
    expect(seenOnBottom(R, c)).toBe(true);
    expect(seenOnBottom(R, { ...c, daylight: 0 })).toBe(false);
    expect(seenOnBottom(R, { ...c, hsM: 1.2 })).toBe(false);
    expect(seenOnBottom(R, { ...c, depthM: 30 })).toBe(false);
    expect(seenOnBottom(R, { ...c, distM: 200 })).toBe(false);
  });

  it('spikes the depth readout only over her', () => {
    expect(depthSpike(R, 0)).toBeCloseTo(R.reliefM);
    expect(depthSpike(R, R.soundingM + 1)).toBe(0);
  });

  it('refuses too deep, too rough, picked clean or a full hold', () => {
    const ok = { depthM: 6, hsM: 0.2, deep: false, holdFree: 5, pickedClean: false };
    expect(castRefusal(R, ok)).toBeUndefined();
    expect(castRefusal(R, { ...ok, deep: true })).toMatch(/too deep/);
    expect(castRefusal(R, { ...ok, depthM: 14 })).toMatch(/too deep/);
    expect(castRefusal(R, { ...ok, hsM: 1.5 })).toMatch(/sea/);
    expect(castRefusal(R, { ...ok, pickedClean: true })).toMatch(/picked clean/);
    expect(castRefusal(R, { ...ok, holdFree: 0 })).toMatch(/room/);
    expect(castRefusal(R, { ...ok, holdFree: 0, findsLeft: true })).toBeUndefined();
  });

  it('hooks less often deep, rough, at night and on an old wreck', () => {
    const base = { depthM: 0, hsM: 0, daylight: 1, ageYears: 0 };
    const p = castChance(R, base);
    expect(p).toBeCloseTo(R.chance);
    expect(castChance(R, { ...base, depthM: R.maxDepthM })).toBeLessThan(p);
    expect(castChance(R, { ...base, hsM: R.maxHsM })).toBeLessThan(p);
    expect(castChance(R, { ...base, daylight: 0 })).toBeLessThan(p);
    expect(castChance(R, { ...base, ageYears: 20 })).toBeLessThan(p);
  });

  it('brings an old cargo up sound or spoiled by its kind, her papers, until picked clean', () => {
    const target = {
      id: 'w',
      cargo: [
        { good: 'good.iron_ore', qty: 6 },
        { good: 'good.flour', qty: 4 },
      ],
      papers: true,
      ageDays: 5000,
    };
    const p = progressOf(freshSalvage(), 'w', 0);
    const rng = Rng.fromSeed('casts');
    let casts = 0;
    while (!pickedClean(target, p) && casts < 200) {
      castGrapple(R, target, p, 1, rng, 100, casts++);
    }
    expect(pickedClean(target, p)).toBe(true);
    expect(p.raised.find((l) => l.good === 'good.iron_ore')?.qty).toBe(6);
    expect(p.raised.find((l) => l.good === 'good.flour')).toBeUndefined();
    expect(p.spoiled.find((l) => l.good === 'good.flour')?.qty).toBe(4);
    expect(p.papersAt).toBeDefined();
    expect(cargoLeft(target.cargo, p)).toEqual([]);
  });

  it('a missed cast takes nothing, and a full hold keeps the haul in her', () => {
    const target = { id: 'w', cargo: [{ good: 'good.coal', qty: 5 }], papers: false, ageDays: 0 };
    const p = progressOf(freshSalvage(), 'w', 0);
    expect(castGrapple(R, target, p, 0, Rng.fromSeed('a'), 10, 0)).toEqual({ hooked: false });
    const r = castGrapple(R, target, p, 1, Rng.fromSeed('a'), 0, 0);
    expect(r).toMatchObject({ hooked: true, kind: 'cargo', sound: 0 });
    expect(cargoLeft(target.cargo, p)[0]?.qty).toBe(5);
  });

  it('knows whose a run wreck is', () => {
    expect(wreckClaim({ how: 'abandoned', byPlayer: true })).toBe('yours');
    expect(wreckClaim({ how: 'sunk', byPlayer: true, owner: 'company.x' })).toBe('victim');
    expect(wreckClaim({ how: 'foundered', byPlayer: false, owner: 'company.x' })).toBe('owned');
    expect(wreckClaim({ how: 'foundered', byPlayer: false })).toBe('free');
  });
});

describe('salvage in the game', () => {
  function setup(seen: Witness[] = []) {
    const state = createWorldState('salvage', T0);
    const events = new EventBus<GameEvents>();
    const ctx = { state, events } as unknown as GameContext;
    const economy = attachEconomy(ctx, undefined);
    state.player.cargo = [];
    const commits: { crime: string; company?: string | undefined }[] = [];
    const heat: number[] = [];
    const law = {
      defs: gameLaw(),
      witnesses: { witnesses: () => seen },
      commit: (c: { crime: string; company?: string }) => {
        commits.push(c);
        return [];
      },
      addHeat: (_r: string, h: number) => {
        heat.push(h);
        return [];
      },
      region: () => 'region.apostles',
    } as unknown as GameLaw;
    const noteRef: { current: ((id: string) => string | undefined) | undefined } = {
      current: undefined,
    };
    const discovery = attachDiscovery({
      ctx,
      law: law.defs,
      notice: () => {},
      lookout: () => undefined,
      oldWrecks: () => oldWrecks('seed'),
      wreckNote: (id) => noteRef.current?.(id),
    });
    const frame = defFrame(zoneDef(APOSTLES_ID));
    let ship = { x: 0, z: 0 };
    let anchored = true;
    const notices: string[] = [];
    const salvage = attachSalvage({
      ctx,
      law,
      economy,
      discovery,
      seed: 'seed',
      zone: () => ({ id: APOSTLES_ID, frame }),
      depthAt: () => 6,
      hsAt: () => 0.2,
      ship: () => ship,
      anchored: () => anchored,
      daylight: () => 1,
      visibilityM: () => 20_000,
      passTime: (s) => (state.environment.clock.gameSeconds += s),
      notice: (t) => notices.push(t),
    });
    noteRef.current = (id) => salvage.note(id);
    const goTo = (at: { lat: number; lon: number }) => {
      ship = chartToZone(worldChart(at), frame);
    };
    return {
      state,
      salvage,
      discovery,
      commits,
      heat,
      notices,
      goTo,
      setAnchored: (a: boolean) => (anchored = a),
    };
  }

  const runWreck = (
    state: ReturnType<typeof createWorldState>,
    over: { byPlayer: boolean; how: 'sunk' | 'foundered' | 'abandoned'; owner?: string },
  ) => {
    state.wrecks ??= freshWrecks();
    return recordWreck(state.wrecks, {
      shipId: 'ship.x',
      name: 'Ada Bell',
      classId: 'ship.fish_tug',
      className: 'Fishing tug',
      how: over.how,
      byPlayer: over.byPlayer,
      owner: over.owner,
      at: { lat: 46.95, lon: -90.6 },
      region: 'region.apostles',
      now: T0,
      drowned: 0,
      cargo: [{ good: 'good.salted_fish', qty: 6 }],
    });
  };

  it('finds the Lucerne by sight over her, and grapples her ore up clean', () => {
    const g = setup();
    const lucerne = must(g.salvage.old.find((w) => w.id === 'wreck.lucerne'));
    g.goTo(lucerne.at);
    expect(g.salvage.look()).toContain('wreck.lucerne');
    expect(g.discovery.knows('wreck.lucerne')).toBe(true);
    expect(g.salvage.chip()).toMatch(/F cast the grapple/);
    let ore = 0;
    for (let i = 0; i < 20 && ore === 0; i++) {
      g.salvage.castNow(1);
      ore = g.state.player.cargo.find((s) => s.good === 'good.iron_ore')?.qty ?? 0;
    }
    expect(ore).toBeGreaterThan(0);
    expect(g.state.player.cargo.every((s) => !s.hot)).toBe(true);
    expect(g.salvage.note('wreck.lucerne')).toMatch(/Grappled/);
    expect(
      g.discovery.journal().discoveries.find((x) => x.kind === 'wreck')?.rows[0]?.text,
    ).toMatch(/Grappled/);
  });

  it('takes time: each cast passes the game clock', () => {
    const g = setup();
    g.goTo(must(g.salvage.old.find((w) => w.id === 'wreck.lucerne')).at);
    g.salvage.look();
    const t = g.state.environment.clock.gameSeconds;
    g.salvage.castNow(0);
    expect(g.state.environment.clock.gameSeconds - t).toBe(R.attemptMinutes * 60);
  });

  it('the line goes down on F and comes up after its time; weighing anchor brings it in', () => {
    const g = setup();
    g.goTo(must(g.salvage.old.find((w) => w.id === 'wreck.lucerne')).at);
    g.salvage.look();
    expect(g.salvage.start()).toBe(true);
    expect(g.salvage.working()).toBe('wreck.lucerne');
    expect(g.salvage.update(R.workRealS / 2)).toBeUndefined();
    expect(g.salvage.update(R.workRealS)).toBeDefined();
    expect(g.salvage.start()).toBe(true);
    g.setAnchored(false);
    g.salvage.update(0.1);
    expect(g.salvage.working()).toBeUndefined();
  });

  it("a seeded wreck's papers open a lead to the next one", () => {
    const g = setup();
    const seeded = g.salvage.old.filter((w) => w.seeded);
    const first = must(seeded[0]);
    g.goTo(first.at);
    g.salvage.look();
    for (let i = 0; i < 60 && g.state.salvage?.wrecks[first.id]?.papersAt === undefined; i++) {
      g.salvage.castNow(1);
      g.state.player.cargo = [];
    }
    const lead = g.discovery.leads.find((l) => l.id === seeded[1]?.id);
    expect(lead?.kind).toBe('wreck');
    expect(lead?.clues[0]?.text).toContain(seeded[1]?.name ?? '?');
  });

  it("a recent wreck's cargo comes up under her owners' marks, and being seen is a crime", () => {
    const witness: Witness = {
      id: 'crew.x',
      kind: 'crew',
      name: 'a passing tug',
      identification: 'ship',
    };
    const g = setup([witness]);
    const w = runWreck(g.state, { byPlayer: false, how: 'foundered', owner: 'company.hollister' });
    g.goTo(w.at);
    g.discovery.chart(w.id, 'sight');
    for (let i = 0; i < 10 && g.state.player.cargo.length === 0; i++) g.salvage.castNow(1);
    const stack = must(g.state.player.cargo[0]);
    expect(stack.hot?.owner).toBe('company.hollister');
    expect(g.commits).toEqual([expect.objectContaining({ crime: 'crime.wreck_plunder' })]);
    // Once a day at most.
    for (let i = 0; i < 3; i++) g.salvage.castNow(1);
    expect(g.commits).toHaveLength(1);
    expect(g.heat).toEqual([]);
  });

  it('one you sank is hot, and seen at her more heat; your own lost ship is yours', () => {
    const witness: Witness = {
      id: 'k',
      kind: 'keeper',
      name: 'the keeper',
      identification: 'ship',
    };
    const g = setup([witness]);
    const victim = runWreck(g.state, { byPlayer: true, how: 'sunk' });
    g.goTo(victim.at);
    expect(g.discovery.knows(victim.id)).toBe(false);
    g.discovery.chart(victim.id, 'yours');
    for (let i = 0; i < 10 && g.state.player.cargo.length === 0; i++) g.salvage.castNow(1);
    expect(g.state.player.cargo[0]?.hot).toBeDefined();
    expect(g.heat).toEqual([R.ownVictimHeat]);

    const h = setup([witness]);
    const own = runWreck(h.state, { byPlayer: true, how: 'abandoned' });
    h.goTo(own.at);
    h.discovery.chart(own.id, 'yours');
    for (let i = 0; i < 10 && h.state.player.cargo.length === 0; i++) h.salvage.castNow(1);
    expect(h.state.player.cargo[0]?.hot).toBeUndefined();
    expect(h.commits).toEqual([]);
  });

  it('round-trips the slice through the save', () => {
    const g = setup();
    g.goTo(must(g.salvage.old.find((w) => w.id === 'wreck.lucerne')).at);
    g.salvage.look();
    g.salvage.castNow(1);
    const back = parseWorldState(JSON.parse(JSON.stringify(g.state)));
    expect(back.salvage?.wrecks['wreck.lucerne']?.casts).toBe(1);
  });
});

describe('a big wreck gives up more a cast', () => {
  it("brings up a share of a steamer's hold, a few CU of a small one's", () => {
    const big = {
      id: 'big',
      cargo: [{ good: 'good.dry_goods', qty: 300 }],
      papers: false,
      ageDays: 0,
    };
    const small = {
      id: 'small',
      cargo: [{ good: 'good.coal', qty: 10 }],
      papers: false,
      ageDays: 0,
    };
    const bigHauls: number[] = [];
    const smallHauls: number[] = [];
    for (let i = 0; i < 20; i++) {
      const rng = Rng.fromSeed(`haul|${i}`);
      const a = castGrapple(R, big, progressOf(freshSalvage(), 'big', 0), 1, rng, 1000, 0);
      const b = castGrapple(R, small, progressOf(freshSalvage(), 'small', 0), 1, rng, 1000, 0);
      if (a.hooked && a.kind === 'cargo') bigHauls.push(a.sound + a.spoiled);
      if (b.hooked && b.kind === 'cargo') smallHauls.push(b.sound + b.spoiled);
    }
    expect(Math.min(...bigHauls)).toBeGreaterThanOrEqual(6);
    expect(Math.max(...bigHauls)).toBeLessThanOrEqual(R.haulMaxCu);
    expect(Math.max(...smallHauls)).toBeLessThanOrEqual(R.haulCu[1]);
  });
});
