// Phase 8 piece F (plan 09 §3, §6.2, §8, §16.4; plan 06 §3.3, §5.4): sleeping in a bunk
// to lay low, a hideout's anchorage ending a pursuit, a site's concealment and being
// spotted there, the saloons' talk and the cutter's lean, and the ruins' salvage.

import { describe, expect, it } from 'vitest';
import { Rng } from '../src/core/rng';
import { SECONDS_PER_GAME_DAY, WORLD_TICK_GAME_SECONDS } from '../src/core/time';
import { gameEconomy } from '../src/sim/economy/defs';
import { BuildGrid, unpackGrid } from '../src/sim/hideouts/grid';
import {
  bedsOf,
  concealmentOf,
  markSpotted,
  recentlySpotted,
  returnSalvage,
  salvageLeft,
  salvageSeason,
  sleepSeconds,
  SPOT_REPEAT_S,
  spotRangeM,
  spottedNow,
  spottedRegions,
  SPOTTED_S,
  takeSalvage,
} from '../src/sim/hideouts/life';
import {
  siteDef,
  SITES,
  startingHideouts,
  starterLayout,
  type HideoutState,
} from '../src/sim/hideouts/stash';
import {
  createCutterBrain,
  stepCutter,
  turnHostile,
  type CutterSense,
} from '../src/sim/law/cutter';
import { gameLaw } from '../src/sim/law/defs';
import { setHeat, tickLaw, tierIn, type LawWorld } from '../src/sim/law/law';
import { beatWeight } from '../src/sim/law/patrol';
import { createLawState } from '../src/sim/law/state';
import { rumorDrafts, type RumorWorld, type SpottedTalk } from '../src/sim/rumors/rumors';
import { sunAt } from '../src/sim/weather/celestial';
import { createWorldState, parseWorldState } from '../src/sim/world-state';

const defs = gameLaw();
const HOUR = 3600;
const DAY = SECONDS_PER_GAME_DAY;
const APOSTLES = 'region.apostles';
const NOON = 12 * HOUR;

function must<T>(x: T | undefined): T {
  if (x === undefined) throw new Error('missing');
  return x;
}

const stockton = must(siteDef('site.stockton'));
const siskiwit = must(siteDef('site.siskiwit'));
const starter = (): BuildGrid => unpackGrid(starterLayout('site.stockton'));
const day = { night: false, shipHere: false };

describe('sleeping in a bunk (plan 09 §3)', () => {
  it('the starting shack has a bunk to sleep in', () => {
    expect(bedsOf(starter())).toBe(1);
    expect(bedsOf(new BuildGrid())).toBe(0);
  });

  it('wakes at dawn, noon or dusk, or after eight hours, within a day', () => {
    for (const t of [0, 5 * HOUR, NOON, 20 * HOUR, 3 * DAY + 17 * HOUR]) {
      for (const until of ['dawn', 'noon', 'dusk', 'eight'] as const) {
        const s = sleepSeconds(until, t);
        expect(s).toBeGreaterThanOrEqual(HOUR);
        expect(s).toBeLessThanOrEqual(DAY);
      }
      expect(sleepSeconds('eight', t)).toBe(8 * HOUR);
      expect((t + sleepSeconds('noon', t)) % DAY).toBe(NOON);
      // Waking at dawn, the sun has just come up; at dusk it has just gone down.
      const dawn = t + sleepSeconds('dawn', t);
      expect(sunAt(dawn).elevationRad).toBeGreaterThan(0);
      expect(sunAt(dawn - 600).elevationRad).toBeLessThanOrEqual(0);
      const dusk = t + sleepSeconds('dusk', t);
      expect(sunAt(dusk).elevationRad).toBeLessThanOrEqual(0);
      expect(sunAt(dusk - 600).elevationRad).toBeGreaterThan(0);
    }
  });
});

describe('laying low (plan 06 §3.3; criterion 10)', () => {
  const world = (): LawWorld => ({
    law: createLawState('ship.t1_schooner', 'Wren', 0),
    standing: {},
    seed: 'test',
  });
  /** Ten hours of world ticks with the captain in the region, away, or asleep there. */
  const after = (how: 'present' | 'away' | 'lyingLow', heat: number): number => {
    const w = world();
    setHeat(defs, w.law, APOSTLES, heat);
    const here = how === 'away' ? 'region.duluth' : APOSTLES;
    const layLow = how === 'lyingLow' ? APOSTLES : undefined;
    for (let t = DAY; t < DAY + 10 * HOUR; t += WORLD_TICK_GAME_SECONDS) {
      tickLaw(defs, w, t, WORLD_TICK_GAME_SECONDS / HOUR, here, layLow);
    }
    return w.law.wanted[APOSTLES]?.heat ?? 0;
  };

  it('asleep at a hideout in the region, its heat cools faster than with you away', () => {
    const present = 100 - after('present', 100);
    const away = 100 - after('away', 100);
    const low = 100 - after('lyingLow', 100);
    expect(away).toBeGreaterThan(present);
    expect(low).toBeCloseTo(away * defs.wanted.decay.layLowFactor, 5);
    expect(defs.wanted.decay.layLowFactor).toBeGreaterThan(1);
  });

  it('only the hideout region cools faster', () => {
    const w = world();
    setHeat(defs, w.law, APOSTLES, 100);
    setHeat(defs, w.law, 'region.chequamegon', 100);
    for (let t = DAY; t < DAY + 10 * HOUR; t += WORLD_TICK_GAME_SECONDS) {
      tickLaw(defs, w, t, WORLD_TICK_GAME_SECONDS / HOUR, APOSTLES, APOSTLES);
    }
    expect(w.law.wanted[APOSTLES]?.heat ?? 0).toBeLessThan(
      w.law.wanted['region.chequamegon']?.heat ?? 0,
    );
  });

  it("doesn't lift a Notorious region below Hunted: that needs a reduction action", () => {
    const w = world();
    setHeat(defs, w.law, APOSTLES, 320);
    for (let t = DAY; t < 6 * DAY; t += WORLD_TICK_GAME_SECONDS) {
      tickLaw(defs, w, t, WORLD_TICK_GAME_SECONDS / HOUR, APOSTLES, APOSTLES);
    }
    expect(tierIn(defs, w.law, APOSTLES)).toBe(3);
  });
});

describe('pursuit ends at a hideout (plan 06 §5.4; criterion 10)', () => {
  const sense = (over: Partial<CutterSense> = {}): CutterSense => ({
    tier: 3,
    inspectsFromTier: 1,
    pursuesFromTier: 2,
    awareness: 'identified',
    identified: true,
    player: { x: 0, z: 0 },
    distanceM: 500,
    playerKn: 7,
    playerShoal: false,
    rigging01: 1,
    ...over,
  });

  it('a hunting cutter breaks off when you reach the anchorage, and saw where you went', () => {
    const b = createCutterBrain({ hunting: true, intent: 'pursue' });
    stepCutter(b, sense(), 0.1, () => 0);
    expect(b.locked).toBe(true);
    const out = stepCutter(b, sense({ refuge: true }), 0.1, () => 0);
    expect(out).toContainEqual({ type: 'gaveUp', why: 'hideout', sawIt: true });
    expect(out).toContainEqual({ type: 'pursuit', locked: false });
    expect(b.locked).toBe(false);
    // Lying there, she won't take it up again, even with you in plain sight.
    for (let i = 0; i < 2000; i++) stepCutter(b, sense({ refuge: true }), 0.1, () => 0);
    expect(b.phase).toBe('released');
    // Out of it again after her cooldown, she's after you as before.
    for (let i = 0; i < 1000; i++) stepCutter(b, sense(), 0.1, () => 0);
    expect(b.phase).not.toBe('released');
  });

  it("out of her sight, she doesn't know where you went", () => {
    const b = createCutterBrain({ hunting: true, intent: 'pursue' });
    stepCutter(b, sense(), 0.1, () => 0);
    const out = stepCutter(b, sense({ refuge: true, awareness: 'unaware' }), 0.1, () => 0);
    expect(out).toContainEqual({ type: 'gaveUp', why: 'hideout', sawIt: false });
  });

  it('even a cutter you fired on breaks off there', () => {
    const b = createCutterBrain({ hunting: true, intent: 'pursue' });
    turnHostile(b);
    stepCutter(b, sense(), 0.1, () => 0);
    expect(b.phase).toBe('firing');
    const out = stepCutter(b, sense({ refuge: true }), 0.1, () => 0);
    expect(out.map((a) => a.type)).toContain('gaveUp');
    for (let i = 0; i < 100; i++) {
      const more = stepCutter(b, sense({ refuge: true }), 0.1, () => 0);
      expect(more.map((a) => a.type)).not.toContain('fire');
    }
  });
});

describe('concealment (plan 09 §8)', () => {
  it("is the site's base with the starting shack's shutters and stove smoke", () => {
    const c = concealmentOf(stockton, starter(), day);
    expect(c.value).toBeGreaterThan(0.5);
    expect(c.value).toBeLessThan(0.7);
    expect(c.parts.map((p) => p.id)).toContain('smoke');
    expect(c.word).toBe('Hidden');
  });

  it('a ship lying there, lamps after dark and an upper floor give it away', () => {
    const g = starter();
    const base = concealmentOf(stockton, g, day).value;
    expect(concealmentOf(stockton, g, { night: false, shipHere: true }).value).toBeCloseTo(
      base - 0.1,
      5,
    );
    // A lantern does nothing by day, and gives the place away by night.
    const lit = g.clone();
    lit.add(
      { id: 'build.lantern', col: 14, row: 14, level: 0, rot: 0, variant: 0, paint: 0 },
      true,
    );
    expect(concealmentOf(stockton, lit, day).value).toBeCloseTo(base, 5);
    expect(concealmentOf(stockton, lit, { night: true, shipHere: false }).value).toBeLessThan(base);
    const tall = g.clone();
    tall.add({ id: 'build.floor', col: 2, row: 2, level: 1, rot: 0, variant: 0, paint: 0 }, true);
    expect(concealmentOf(stockton, tall, day).value).toBeCloseTo(base - 0.05, 5);
  });

  it('screens help only so much, and planned pieces count only once built', () => {
    const g = new BuildGrid();
    for (let i = 0; i < 12; i++) {
      g.add(
        { id: 'build.brush_screen', col: i, row: 0, level: 0, rot: 0, variant: 0, paint: 0 },
        true,
      );
    }
    const c = concealmentOf(stockton, g, day);
    expect(c.value).toBeCloseTo(stockton.concealment + 0.15, 5);
    const ghost = new BuildGrid();
    ghost.add(
      { id: 'build.brush_screen', col: 0, row: 0, level: 0, rot: 0, variant: 0, paint: 0 },
      false,
    );
    expect(concealmentOf(stockton, ghost, day).value).toBeCloseTo(stockton.concealment, 5);
  });

  it('a well-hidden site is seen only from close aboard; a bare one from far off', () => {
    expect(spotRangeM(0.9, false)).toBeLessThan(spotRangeM(0.5, false));
    expect(spotRangeM(0.5, false)).toBeLessThan(spotRangeM(0.1, false));
    expect(spotRangeM(0.5, true)).toBeLessThan(spotRangeM(0.5, false));
    expect(spotRangeM(1, false)).toBe(0);
  });
});

describe('being spotted (plan 09 §8, §16.5)', () => {
  const fresh = (): HideoutState => must(startingHideouts('deckhand', 0)['hideout.stockton']);

  it('marks the site for a week, once a pass', () => {
    const h = fresh();
    const t = 2 * DAY;
    expect(markSpotted(h, { at: t, by: 'the tug Sophia', ship: 'Wren' })).toBe(true);
    expect(recentlySpotted(h, t + HOUR)).toBe(true);
    expect(markSpotted(h, { at: t + HOUR, by: 'the tug Ida', ship: 'Wren' })).toBe(false);
    expect(h.spotted?.by).toBe('the tug Sophia');
    expect(markSpotted(h, { at: t + SPOT_REPEAT_S, by: 'the tug Ida', ship: 'Wren' })).toBe(true);
    expect(spottedNow(h, t + SPOT_REPEAT_S + SPOTTED_S - 1)).toBe(true);
    expect(spottedNow(h, t + SPOT_REPEAT_S + SPOTTED_S)).toBe(false);
  });

  it("draws the Morrill's sorties to its region for the week", () => {
    const h = fresh();
    markSpotted(h, { at: DAY, by: 'the Morrill', ship: 'Wren' });
    const hideouts = { 'hideout.stockton': h };
    expect(spottedRegions(hideouts, SITES, DAY + HOUR).has(APOSTLES)).toBe(true);
    expect(spottedRegions(hideouts, SITES, DAY + SPOTTED_S + 1).size).toBe(0);
    const plain = beatWeight(defs, [APOSTLES], () => 0);
    const leaning = beatWeight(
      defs,
      [APOSTLES],
      () => 0,
      (r) => r === APOSTLES,
    );
    expect(leaning - plain).toBe(defs.actors.cutter.spottedPull);
    expect(leaning).toBeGreaterThan(beatWeight(defs, [APOSTLES], () => 2));
  });

  it("is talked of in the saloons of the site's region and the next, not further off", () => {
    const state = createWorldState('life-talk');
    const talk: SpottedTalk = {
      hideout: 'hideout.stockton',
      where: 'Presque Isle bay, on Stockton Island',
      by: 'the tug Sophia',
      ship: 'Wren',
      at: DAY,
      until: DAY + SPOTTED_S,
      regions: [APOSTLES, 'region.chequamegon', 'region.ashland', 'region.south_shore_west'],
    };
    const world: RumorWorld = {
      economy: gameEconomy(),
      markets: state.markets,
      spotted: () => [talk],
    };
    const r = Rng.fromSeed('talk');
    const rand = () => r.next();
    const at = (port: string, t = DAY + HOUR) =>
      rumorDrafts(world, [], port, t, rand).filter((d) => d.kind === 'spotted');
    const bayfield = at('port.bayfield');
    expect(bayfield).toHaveLength(1);
    const told = must(bayfield[0]).render(true, rand).text;
    expect(told).toContain('Wren');
    expect(told).toContain('Presque Isle bay');
    expect(at('port.la_pointe')).toHaveLength(1);
    expect(at('port.duluth')).toHaveLength(0);
    // A week on, nobody talks of it.
    expect(at('port.bayfield', DAY + SPOTTED_S + 1)).toHaveLength(0);
  });
});

describe('salvage (plan 09 §6.2, §16.5)', () => {
  it("each site's ruins give 20 CU a season in loads, then nothing until the next", () => {
    const h = must(startingHideouts('deckhand', 0)['hideout.stockton']);
    expect(stockton.salvage?.good).toBe('good.brownstone');
    expect(siskiwit.salvage?.good).toBe('good.lumber');
    const t = 3 * DAY;
    let total = 0;
    for (let i = 0; i < 20; i++) total += takeSalvage(stockton, h, t);
    expect(total).toBe(20);
    expect(salvageLeft(stockton, h, t)).toBe(0);
    expect(takeSalvage(stockton, h, t)).toBe(0);
    returnSalvage(h, 2, t);
    expect(salvageLeft(stockton, h, t)).toBe(2);
    // The next season (a game day is a calendar week, so a season is about 13 days).
    let next = t;
    while (salvageSeason(next) === salvageSeason(t)) next += DAY;
    expect(salvageLeft(stockton, h, next)).toBe(20);
    expect(takeSalvage(stockton, h, next)).toBe(stockton.salvage?.loadCu);
  });

  it('every salvage good is a real good', () => {
    const goods = gameEconomy().goods;
    for (const s of SITES) if (s.salvage) expect(goods.has(s.salvage.good)).toBe(true);
  });
});

describe('the save (plan 09 §12)', () => {
  it('keeps who spotted a hideout and the salvage taken', () => {
    const state = createWorldState('life-save');
    const h = must(state.hideouts?.['hideout.stockton']);
    markSpotted(h, { at: DAY, by: 'the tug Sophia', ship: 'Wren' });
    takeSalvage(stockton, h, DAY);
    const back = parseWorldState(JSON.parse(JSON.stringify(state)));
    const b = must(back.hideouts?.['hideout.stockton']);
    expect(b.spotted).toEqual(h.spotted);
    expect(b.salvage).toEqual(h.salvage);
  });
});
