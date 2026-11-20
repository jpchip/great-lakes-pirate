import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { Rng } from '../src/core/rng';
import { SECONDS_PER_GAME_DAY } from '../src/core/time';
import { attachIslandAshore } from '../src/gameplay/island-ashore';
import { buildAshoreScene } from '../src/gameplay/onfoot/ashore-scene';
import { createCharacter } from '../src/gameplay/onfoot/controller';
import { createIslandWildlife } from '../src/gameplay/onfoot/wildlife';
import { counterAmount, counterForEvent } from '../src/sim/character/ambitions';
import { ISLANDS, placeZoneIslands, type PlacedIsland } from '../src/sim/islands/on-foot';
import type { GridField } from '../src/sim/terrain/grid-field';
import { loadZoneTerrain, type LoadedZone } from '../src/sim/terrain/load';
import { manifestFrame } from '../src/sim/terrain/zones';
import {
  createAnimal,
  hearShot,
  shootAnimal,
  thinkAnimal,
  type AnimalEvent,
  type Perception,
} from '../src/sim/wildlife/animals';
import { animalBudget, speciesOf, WILDLIFE } from '../src/sim/wildlife/defs';
import {
  deerLeft,
  emptyWildlife,
  hitChance,
  startingDeer,
  visitors,
  WEEK_S,
} from '../src/sim/wildlife/hunt';
import { compassWord, readSign } from '../src/sim/wildlife/spawn';
import { checkTrap } from '../src/sim/wildlife/traps';
import { createWorldState } from '../src/sim/world-state';
import recipesJson from '../data/recipes.json';
import goodsJson from '../data/goods.json';
import storesJson from '../data/stores.json';

/**
 * Phase 9 piece V (plan 11 §18.4, §18.20): hunting and wildlife. The data, the deer's and
 * the predators' FSM, the hunt's odds, the herd and its regrowth, who's about on a landing,
 * the traplines, the Venison King's count, and on the baked terrain a hunt from landing to
 * the hold.
 */

const DEER = speciesOf('animal.deer');
const BEAR = speciesOf('animal.bear');
const WOLF = speciesOf('animal.wolf');

const seen = (d: number, over: Partial<Perception> = {}): Perception => ({
  at: { x: 0, z: -d },
  distM: d,
  sees: true,
  hears: false,
  smells: false,
  byFire: false,
  beyond: false,
  ...over,
});
const unseen = (d: number): Perception => seen(d, { sees: false, hears: false, smells: false });

describe('wildlife.json', () => {
  it('names real islands, cabins, goods and stores', () => {
    for (const g of WILDLIFE.islands) {
      expect(
        ISLANDS.some((i) => i.id === g.island && i.onFoot),
        g.island,
      ).toBe(true);
    }
    // Deer on Stockton, Madeline and Oak (plan 11 §4).
    const deer = WILDLIFE.islands.filter((g) => g.deer > 0).map((g) => g.island);
    expect(deer.sort()).toEqual(['island.madeline', 'island.oak', 'island.stockton']);
    for (const line of WILDLIFE.traps.lines) {
      const isl = ISLANDS.find((i) => i.id === line.island);
      expect(
        isl?.onFoot?.pois.some((p) => p.id === line.poi && p.poi === 'poi.trapper_cabin'),
        line.poi,
      ).toBe(true);
    }
    const goods = goodsJson.map((g) => g.id);
    expect(goods).toContain(WILDLIFE.hunt.carcass.good);
    expect(goods).toContain(WILDLIFE.traps.good);
    expect(storesJson.map((s) => s.id)).toContain(WILDLIFE.traps.store);
    // Bears sleep the winter; wolves come with it.
    expect(BEAR.months).not.toContain(1);
    expect(WOLF.months).toEqual(expect.arrayContaining([12, 1, 2]));
    expect(WOLF.months).not.toContain(7);
  });

  it('smokes venison at the smokehouse', () => {
    const r = recipesJson.find((k) => k.id === 'recipe.smoked_venison');
    expect(r?.station).toBe('station.smokehouse');
    expect(r?.inputs.goods).toMatchObject({ 'good.venison': 3 });
    expect(r?.output.goods).toMatchObject({ 'good.smoked_venison': 2 });
    const smoked = goodsJson.find((g) => g.id === 'good.smoked_venison');
    expect(smoked?.legal).toBe('contraband');
  });
});

describe('the deer', () => {
  it('grazes, looks up at you, and bolts when you come on or make a noise', () => {
    const rng = Rng.fromSeed('deer');
    const out: AnimalEvent[] = [];
    const a = createAnimal('deer.0', DEER, { x: 0, y: 1, z: 0 }, 0);
    thinkAnimal(a, 0.1, unseen(80), rng, out);
    expect(a.state).toBe('graze');
    thinkAnimal(a, 0.1, seen(50), rng, out);
    expect(a.state).toBe('alert');
    expect(a.speed).toBe(0);
    // Standing still at a distance, it settles again.
    for (let t = 0; t < DEER.alertS + 1; t += 0.1) thinkAnimal(a, 0.1, unseen(50), rng, out);
    expect(a.state).toBe('graze');
    thinkAnimal(a, 0.1, seen(40), rng, out);
    thinkAnimal(a, 0.1, seen(DEER.fleeAtM - 1), rng, out);
    expect(a.state).toBe('flee');
    expect(a.speed).toBe(DEER.runMps);
    expect(out.some((e) => e.type === 'Bolted')).toBe(true);
    // A gunshot sends a grazing deer off too.
    const b = createAnimal('deer.1', DEER, { x: 0, y: 1, z: 0 }, 0);
    hearShot(b, { x: 0, z: -200 }, rng, out);
    expect(b.state).toBe('flee');
  });

  it('dropped by a ball, or run on wounded and down a little later', () => {
    const out: AnimalEvent[] = [];
    let dropped = 0;
    let wounded = 0;
    for (let k = 0; k < 40; k++) {
      const rng = Rng.fromSeed(`shot:${k}`);
      const a = createAnimal(`deer.${k}`, DEER, { x: 0, y: 1, z: 0 }, 0);
      const dead = shootAnimal(a, { x: 0, z: -30 }, rng, out, {
        killChance: WILDLIFE.hunt.killChance,
        woundedS: WILDLIFE.hunt.woundedS,
      });
      if (dead) {
        dropped++;
        continue;
      }
      wounded++;
      expect(a.state).toBe('wounded');
      for (let t = 0; t <= WILDLIFE.hunt.woundedS + 0.5; t += 0.5) {
        thinkAnimal(a, 0.5, unseen(60), rng, out);
      }
      expect(a.state).toBe('dead');
    }
    expect(dropped).toBeGreaterThan(wounded);
    expect(wounded).toBeGreaterThan(0);
  });
});

describe('bears and wolves: Wander → Wary → Threaten → Attack or Flee', () => {
  const pr = BEAR.predator;
  if (!pr) throw new Error('bear has no predator block');

  it('warns before it attacks, and bites when it reaches you', () => {
    const rng = Rng.fromSeed('bear');
    const out: AnimalEvent[] = [];
    const a = createAnimal('bear.0', BEAR, { x: 0, y: 1, z: 0 }, 0);
    thinkAnimal(a, 0.1, seen(pr.waryM - 5), rng, out);
    expect(a.state).toBe('wary');
    thinkAnimal(a, 0.1, seen(pr.threatenM - 2), rng, out);
    expect(a.state).toBe('threaten');
    a.bold = true;
    for (let t = 0; t < pr.threatenS + 0.2; t += 0.1) {
      thinkAnimal(a, 0.1, seen(pr.threatenM - 2), rng, out);
    }
    expect(a.state).toBe('attack');
    expect(a.speed).toBe(BEAR.runMps);
    for (let t = 0; t < pr.everyS * 2; t += 0.1) thinkAnimal(a, 0.1, seen(1), rng, out);
    const warned = out.filter((e) => e.type === 'Warned').map((e) => e.state);
    expect(warned).toEqual(['wary', 'threaten', 'attack']);
    expect(out.filter((e) => e.type === 'Bit').length).toBeGreaterThanOrEqual(1);
  });

  it('a bluff runs out into flight; backing off makes it wary; a fire keeps it off', () => {
    const rng = Rng.fromSeed('bluff');
    const out: AnimalEvent[] = [];
    const a = createAnimal('bear.0', BEAR, { x: 0, y: 1, z: 0 }, 0);
    thinkAnimal(a, 0.1, seen(30), rng, out);
    thinkAnimal(a, 0.1, seen(pr.threatenM - 2), rng, out);
    a.bold = false;
    for (let t = 0; t < pr.threatenS + 0.2; t += 0.1) {
      thinkAnimal(a, 0.1, seen(pr.threatenM - 2), rng, out);
    }
    expect(a.state).toBe('flee');

    const b = createAnimal('bear.1', BEAR, { x: 0, y: 1, z: 0 }, 0);
    thinkAnimal(b, 0.1, seen(30), rng, out);
    thinkAnimal(b, 0.1, seen(pr.threatenM - 2), rng, out);
    thinkAnimal(b, 0.1, seen(pr.threatenM * 1.5), rng, out);
    expect(b.state).toBe('wary');

    const w = createAnimal('wolf.0', WOLF, { x: 0, y: 1, z: 0 }, 0);
    w.state = 'attack';
    thinkAnimal(w, 0.1, seen(10, { byFire: true }), rng, out);
    expect(w.state).toBe('wary');
    expect(w.speed).toBe(0);
  });

  it('surprised close, it attacks at once; out of reach in the boat, it gives up', () => {
    const rng = Rng.fromSeed('close');
    const out: AnimalEvent[] = [];
    const a = createAnimal('bear.0', BEAR, { x: 0, y: 1, z: 0 }, 0);
    thinkAnimal(a, 0.1, seen(pr.closeM - 1), rng, out);
    expect(a.state).toBe('attack');
    thinkAnimal(a, 0.1, seen(20, { beyond: true }), rng, out);
    expect(a.state).toBe('wary');
  });

  it('three balls kill a bear; a wolf drops to one', () => {
    const rng = Rng.fromSeed('balls');
    const out: AnimalEvent[] = [];
    const opts = { killChance: 1, woundedS: 10 };
    const w = createAnimal('wolf.0', WOLF, { x: 0, y: 1, z: 0 }, 0);
    expect(shootAnimal(w, { x: 0, z: 0 }, rng, out, opts)).toBe(true);
    const b = createAnimal('bear.0', BEAR, { x: 0, y: 1, z: 0 }, 0);
    expect(shootAnimal(b, { x: 0, z: 0 }, rng, out, opts)).toBe(false);
    expect(shootAnimal(b, { x: 0, z: 0 }, rng, out, opts)).toBe(false);
    expect(shootAnimal(b, { x: 0, z: 0 }, rng, out, opts)).toBe(true);
    expect(b.state).toBe('dead');
  });
});

describe('the hunt', () => {
  it('hits more often near, crouched and still, than far, standing or moving', () => {
    const still = { crouched: false, moving: false, targetRunning: false };
    expect(hitChance(20, still)).toBeGreaterThan(hitChance(80, still));
    expect(hitChance(60, { ...still, crouched: true })).toBeGreaterThan(hitChance(60, still));
    expect(hitChance(60, { ...still, moving: true })).toBeLessThan(hitChance(60, still));
    expect(hitChance(60, { ...still, targetRunning: true })).toBeLessThan(hitChance(60, still));
    expect(hitChance(WILDLIFE.hunt.rangeM + 1, still)).toBe(0);
  });

  it('an island has its herd this run, thinned by what you take and grown back after', () => {
    const start = startingDeer('island.stockton', 42);
    expect(start).toBeGreaterThan(0);
    expect(startingDeer('island.cat', 42)).toBe(0);
    const w = emptyWildlife();
    w.taken['island.stockton'] = [0, 10, 20];
    expect(deerLeft('island.stockton', w, 42, 100)).toBe(start - 3);
    const back = WEEK_S / WILDLIFE.population.regrowPerWeek;
    expect(deerLeft('island.stockton', w, 42, back + 100)).toBe(start);
  });

  it('a bear in summer, wolves in winter, never past the tier budget', () => {
    let bears = 0;
    let packs = 0;
    for (let day = 0; day < 200; day++) {
      const summer = visitors('island.oak', {
        deerLeft: 6,
        month: 7,
        day,
        runSeed: 1,
        budget: animalBudget('standard'),
      });
      expect(summer.wolves).toBe(0);
      expect(summer.deer + summer.wolves + (summer.bear ? 1 : 0)).toBeLessThanOrEqual(4);
      if (summer.bear) bears++;
      const winter = visitors('island.madeline', {
        deerLeft: 6,
        month: 1,
        day,
        runSeed: 1,
        budget: animalBudget('hero'),
      });
      expect(winter.bear).toBe(false);
      expect(winter.deer + winter.wolves).toBeLessThanOrEqual(4);
      if (winter.wolves) packs++;
    }
    expect(bears).toBeGreaterThan(30);
    expect(packs).toBeGreaterThan(40);
    // A shot-out island has no deer to show.
    expect(
      visitors('island.oak', { deerLeft: 0, month: 7, day: 3, runSeed: 1, budget: 4 }).deer,
    ).toBe(0);
  });

  it('reads the way in the sign, and with woodcraft how many and how near', () => {
    const sign = { x: 0, y: 1, z: 0, heading: Math.PI / 2 };
    expect(compassWord(Math.PI / 2)).toBe('east');
    expect(readSign(sign, { x: 120, z: 0, count: 3 }, false)).toMatch(/heading east/);
    expect(readSign(sign, { x: 120, z: 0, count: 3 }, true)).toMatch(/3 deer.*120 m/);
    expect(readSign(sign, undefined, false)).toMatch(/days old/);
  });
});

describe('the traplines', () => {
  it('holds nothing at first, may hold a pelt after a week or three, spoils if left', () => {
    let caught = 0;
    for (let k = 0; k < 60; k++) {
      const setAt = 1000 + k;
      const early = checkTrap(`spot:${k}`, setAt, setAt + 0.5 * WEEK_S, 9, false);
      expect(early.ready).toBe(false);
      const later = checkTrap(`spot:${k}`, setAt, setAt + 3.1 * WEEK_S, 9, false);
      expect(later.ready).toBe(true);
      if (later.caught) {
        caught++;
        const left = checkTrap(`spot:${k}`, setAt, later.readyAt + 6 * WEEK_S, 9, false);
        expect(left.spoiled).toBe(true);
      }
      // The same setting holds the same on a reload.
      expect(checkTrap(`spot:${k}`, setAt, setAt + 3.1 * WEEK_S, 9, false)).toEqual(later);
    }
    expect(caught).toBeGreaterThan(10);
    expect(caught).toBeLessThan(50);
  });
});

describe('the Venison King', () => {
  it('counts venison sold by the CU, fresh or smoked, and nothing else', () => {
    const sold = { port: 'port.duluth', good: 'good.venison', qty: 4, totalCents: 1 };
    expect(counterForEvent('ContrabandSold', sold, 0)).toBe('venisonSold');
    expect(counterAmount('ContrabandSold', sold)).toBe(4);
    expect(counterForEvent('FenceDealt', { ...sold, good: 'good.smoked_venison', qty: 2 }, 0)).toBe(
      'venisonSold',
    );
    expect(counterForEvent('SmugglerDealt', { ...sold, side: 'fence', smuggler: 's' }, 0)).toBe(
      'venisonSold',
    );
    expect(counterForEvent('SmugglerDealt', { ...sold, side: 'buy', smuggler: 's' }, 0)).toBe(
      undefined,
    );
    expect(counterForEvent('ContrabandSold', { ...sold, good: 'good.untaxed_whiskey' }, 0)).toBe(
      undefined,
    );
    expect(counterAmount('PokerPlayed', {})).toBe(1);
  });
});

const dir = join(__dirname, '..', 'public', 'world', 'apostles');
const baked = existsSync(join(dir, 'manifest.json'));

describe('a hunt on the baked terrain', () => {
  let zone: LoadedZone;
  let placed: PlacedIsland[];
  const read = async (path: string) => new Uint8Array(readFileSync(join(dir, path)));
  beforeAll(async () => {
    if (!baked) return;
    zone = await loadZoneTerrain(read);
    placed = placeZoneIslands(
      zone.manifest.zone,
      zone.manifest.islands ?? [],
      (x, z) => zone.terrain.heightAt(x, z),
      manifestFrame(zone.manifest),
    );
  });

  const sceneOn = (id: string) => {
    const state = createWorldState('wild-test');
    const ashore = attachIslandAshore({
      state,
      heightAt: (x, z) => zone.terrain.heightAt(x, z),
      grid: () => ({
        x0: zone.terrain.height.x0,
        z0: zone.terrain.height.z0,
        step: zone.terrain.height.step,
      }),
      islands: () => placed,
      ground: (iid) => {
        const m = zone.manifest.islands?.find((k) => k.id === iid);
        return m
          ? ({
              x0: m.x0,
              z0: m.z0,
              step: 1,
              maxX: m.x0 + m.width - 1,
              maxZ: m.z0 + m.height - 1,
            } as GridField)
          : undefined;
      },
      runSeed: () => 7,
      notice: () => undefined,
    });
    const island = placed.find((i) => i.id === id);
    if (!island) throw new Error(id);
    const l = island.landings[0] ?? island.anchor;
    if (!l) throw new Error(`${id}: no landing`);
    // In from the anchor point if there's no named landing: anywhere on its land.
    const s = ashore.sceneFor(l);
    if (!s) throw new Error(`${id}: no scene`);
    const scene = buildAshoreScene({
      ground: s.ground,
      center: l,
      box: s.box,
      extra: s.extra,
      ladders: s.ladders,
    });
    return { state, island, scene, landing: { x: l.x, z: l.z } };
  };

  const wildlifeOn = (
    id: string,
    gameSeconds: number,
    extra: {
      stores?: Record<string, number>;
      hold?: { good: string; qty: number }[];
      state?: ReturnType<typeof createWorldState>;
    } = {},
  ) => {
    const on = sceneOn(id);
    const { island, scene, landing } = on;
    const state = extra.state ?? on.state;
    const notices: string[] = [];
    let health = 100;
    const hold = extra.hold ?? [];
    const w = createIslandWildlife({
      island,
      scene,
      landing,
      budget: animalBudget(island.tier),
      now: () => gameSeconds,
      runSeed: () => 7,
      state: () => (state.wildlife ??= { taken: {}, traps: {} }),
      stores: extra.stores ?? {},
      hasRifle: () => true,
      woodcraft: () => false,
      light01: () => 1,
      fogM: () => 5000,
      wind: () => ({ x: 0, z: 0 }),
      hooks: {
        notice: (t) => notices.push(t),
        hurt: (n) => (health -= n),
        shot: () => undefined,
        killed: () => undefined,
        trap: () => undefined,
        stow: (good, qty) => {
          hold.push({ good, qty });
          return undefined;
        },
        furs: (good, qty) => {
          hold.push({ good, qty });
          return undefined;
        },
      },
    });
    return { w, state, island, scene, notices, hold, health: () => health };
  };

  // A July noon (the calendar starts on May 7, 1900; a game day is a week).
  const JULY = 9 * SECONDS_PER_GAME_DAY + 12 * 3600;

  it.skipIf(!baked)('deer about on Stockton, Madeline and Oak, on their own ground', () => {
    for (const id of ['island.stockton', 'island.madeline', 'island.oak']) {
      const { w, island } = wildlifeOn(id, JULY);
      const deer = w.animals.filter((a) => a.species.id === 'animal.deer');
      expect(deer.length, id).toBeGreaterThan(0);
      expect(w.animals.length, id).toBeLessThanOrEqual(animalBudget(island.tier));
      expect(w.sign.length, id).toBeGreaterThan(0);
      for (const a of w.animals) expect(a.y, `${id} ${a.id}`).toBeGreaterThan(0.5);
    }
  });

  it.skipIf(!baked)('trap spots round the trappers’ cabins', () => {
    for (const line of WILDLIFE.traps.lines) {
      const { w } = wildlifeOn(line.island, JULY);
      const spots = w.spots.filter((s) => s.id.startsWith(`${line.poi}:`));
      expect(spots.length, line.poi).toBeGreaterThanOrEqual(WILDLIFE.traps.spotsPerLine - 1);
    }
  });

  it.skipIf(!baked)('shot, dressed, carried and laid in the boat as venison', () => {
    const { w, state, hold } = wildlifeOn('island.stockton', JULY);
    const deer = w.animals.find((a) => a.species.id === 'animal.deer');
    if (!deer) throw new Error('no deer');
    // Up close behind a tree's worth of cover, aimed at it: shoot until it's down.
    const me = createCharacter({ x: deer.x + 12, y: deer.y, z: deer.z });
    me.grounded = true;
    me.heading = Math.atan2(deer.x - me.position.x, -(deer.z - me.position.z));
    me.crouching = true;
    let shots = 0;
    while (deer.state !== 'dead' && shots < 12) {
      w.shoot(me, deer.id);
      shots++;
      for (let t = 0; t < 3; t += 0.1) {
        w.step(0.1, me, { strideM: 0, interactDown: false, beyond: false });
      }
      // It ran: follow it.
      me.position.x = deer.x + 12;
      me.position.z = deer.z;
      me.position.y = deer.y;
      me.heading = Math.atan2(deer.x - me.position.x, -(deer.z - me.position.z));
    }
    expect(deer.state).toBe('dead');
    expect(state.wildlife?.taken['island.stockton']?.length).toBe(1);
    // Beside it: dress it out, F held.
    me.position.x = deer.x + 1;
    me.position.z = deer.z;
    expect(w.prompt(me)?.text).toBe('Field-dress the deer (hold F)');
    w.prompt(me)?.act();
    for (let t = 0; t < WILDLIFE.hunt.dressS + 0.5; t += 0.1) {
      w.step(0.1, me, { strideM: 0, interactDown: true, beyond: false });
    }
    expect(deer.dressed).toBe(true);
    expect(w.prompt(me)?.text).toBe('Lift the carcass onto your shoulders');
    w.prompt(me)?.act();
    expect(w.carrying).toEqual({ good: 'good.venison', cu: 2 });
    const base = { walkSpeed: 2, runSpeed: 5 } as Parameters<typeof w.params>[0];
    expect(w.params(base).walkSpeed).toBeLessThan(2);
    w.boatPrompt()?.act();
    expect(hold).toEqual([{ good: 'good.venison', qty: 2 }]);
    expect(w.carrying).toBeUndefined();
  });

  it.skipIf(!baked)('a trap set in January is checked weeks later and given back', () => {
    // January 14, 1901.
    const JAN = 36 * SECONDS_PER_GAME_DAY + 12 * 3600;
    const stores: Record<string, number> = { 'store.traps': 4 };
    const first = wildlifeOn('island.oak', JAN, { stores });
    const spot = first.w.spots[0];
    if (!spot) throw new Error('no spot');
    const me = createCharacter({ x: spot.x, y: spot.y, z: spot.z });
    me.grounded = true;
    expect(first.w.prompt(me)?.text).toMatch(/^Set a trap/);
    first.w.prompt(me)?.act();
    expect(stores['store.traps']).toBe(3);
    expect(first.state.wildlife?.traps[spot.id]).toBeDefined();
    expect(first.w.prompt(me)?.text).toBe('Your trap: nothing yet');
    // Three weeks on, it's ready: emptied, the trap comes back to the lockers.
    const hold: { good: string; qty: number }[] = [];
    const later = wildlifeOn('island.oak', JAN + 3.2 * WEEK_S, {
      stores,
      hold,
      state: first.state,
    });
    expect(later.w.prompt(me)?.text).toMatch(/^(Take the pelt from the trap|Check the trap)$/);
    later.w.prompt(me)?.act();
    expect(stores['store.traps']).toBe(4);
    expect(first.state.wildlife?.traps[spot.id]).toBeUndefined();
    expect(hold.every((h) => h.good === 'good.furs' && h.qty === 1)).toBe(true);
  });

  it.skipIf(!baked)('out of season, a spot takes no trap', () => {
    const { w } = wildlifeOn('island.oak', JULY, { stores: { 'store.traps': 2 } });
    const spot = w.spots[0];
    if (!spot) throw new Error('no spot');
    const me = createCharacter({ x: spot.x, y: spot.y, z: spot.z });
    me.grounded = true;
    expect(w.prompt(me)?.text).toBe('A trap spot (out of season)');
  });
});
