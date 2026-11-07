import { describe, expect, it } from 'vitest';
import type { Chart } from '../src/core/coords';
import { SECONDS_PER_GAME_DAY } from '../src/core/time';
import { sampleArenaLand, OPEN_LAKE, type ArenaLand } from '../src/sim/arena/land';
import { createHelm, steerShips, type SteeredShip } from '../src/sim/arena/steering';
import { westernSuperiorChart } from '../src/sim/chart/chart-data';
import {
  legAlongM,
  legDoneAt,
  patrolLanes,
  placePatrol,
  type PatrolLeg,
} from '../src/sim/chart/patrol';
import { westernSuperiorRoutes } from '../src/sim/chart/routes';
import { checkEncounters, type Contact } from '../src/sim/chart/traffic';
import { searchChance } from '../src/sim/economy/contraband';
import { gameEconomy } from '../src/sim/economy/defs';
import {
  afterInspection,
  createCutterBrain,
  cutterLocks,
  cutterOrders,
  hitChance,
  stepCutter,
  CUTTER_RULES,
  type CutterAction,
  type CutterBrain,
  type CutterSense,
} from '../src/sim/law/cutter';
import { gameLaw } from '../src/sim/law/defs';
import {
  advancePatrol,
  beatWeight,
  charterTug,
  createMorrill,
  legEndNode,
  planMorrill,
  planTug,
  shelterIfGale,
  sortieWeights,
  type PatrolState,
  type PatrolWorld,
} from '../src/sim/law/patrol';
import { SHIP_RECORDS } from '../src/sim/sailing/ships';

/**
 * Phase 5 piece C: the *Morrill*. Her sorties by Wanted on the route graph, the chart's
 * encounter check by Wanted and detection, her captain's rules at close quarters (never
 * at tier 0, inspection at 1, pursuit at 2+, surrender and boarding, the shallows, lost
 * sight), the hold search with a hidden compartment, and the tier-5 tug.
 */

const geo = westernSuperiorChart();
const graph = westernSuperiorRoutes();
const lanes = patrolLanes(geo.projection, graph.lanes, graph.nodes);
const defs = gameLaw();
const HOUR = 3600;
/** Day 0 is May 7, 1900; game day 35 is about January (1 game day is a calendar week). */
const JANUARY = 35 * SECONDS_PER_GAME_DAY;

function world(tiers: Record<string, number> = {}, gale = false): PatrolWorld {
  return {
    defs,
    lanes,
    seed: 'test',
    tier: (r) => tiers[r] ?? 0,
    gale: () => gale,
  };
}

/** Where her sorties take her over `days`, as hours spent on each beat lane. */
function hoursOnBeats(w: PatrolWorld, days: number): Map<string, number> {
  const s = createMorrill(defs, lanes, 0);
  const out = new Map<string, number>();
  const speed = defs.actors.cutter.speedKn;
  const plan = (m: PatrolState, at: number) => planMorrill(w, m, at);
  for (let t = 0; t < days * SECONDS_PER_GAME_DAY; t += HOUR) {
    advancePatrol(w, s, speed, t, plan);
    if (s.leg.purpose === 'beat' || s.leg.purpose === 'return') {
      out.set(s.leg.lane, (out.get(s.leg.lane) ?? 0) + 1);
    }
  }
  return out;
}

describe("the Morrill's sorties (§5.1)", () => {
  it('gives every beat in law_actors.json a lane that runs out from one of her bases', () => {
    const c = defs.actors.cutter;
    for (const b of c.beats) {
      const l = lanes.get(b.lane);
      expect(l, b.lane).toBeDefined();
      expect(c.bases, b.lane).toContain(l?.from.id);
      for (const r of b.regions) expect(defs.regionById.has(r), r).toBe(true);
    }
    // Every region has a beat, so the tug always has somewhere to work.
    for (const r of defs.regions) {
      expect(
        c.beats.some((b) => b.regions.includes(r.id)),
        r.id,
      ).toBe(true);
    }
    const t = lanes.get(c.transfer);
    expect([t?.from.id, t?.to.id].sort()).toEqual([...c.bases].sort());
  });

  it('weights a beat by its regions: a Hunted region draws her strongly', () => {
    const clean = beatWeight(defs, ['region.apostles'], () => 0);
    const suspicious = beatWeight(defs, ['region.apostles'], () => 1);
    const hunted = beatWeight(defs, ['region.apostles'], () => 3);
    expect(suspicious).toBeGreaterThan(clean);
    expect(hunted).toBeGreaterThan(suspicious * 3);
  });

  it('spends her time where the Wanted is', () => {
    const calm = hoursOnBeats(world(), 30);
    const hot = hoursOnBeats(world({ 'region.apostles': 3 }), 30);
    const share = (m: Map<string, number>, lane: string): number =>
      (m.get(lane) ?? 0) / [...m.values()].reduce((a, b) => a + b, 0);
    expect(share(hot, 'lane.beat_apostles')).toBeGreaterThan(
      share(calm, 'lane.beat_apostles') * 1.8,
    );
    // She still gets round the lake when nothing is hot.
    expect(calm.size).toBeGreaterThanOrEqual(4);
  });

  it('goes back to Duluth to coal', () => {
    const w = world({ 'region.chequamegon': 4 });
    const s = createMorrill(defs, lanes, 0);
    const speed = defs.actors.cutter.speedKn;
    let coaled = 0;
    let last = s.coaledAt;
    for (let t = 0; t < 20 * SECONDS_PER_GAME_DAY; t += HOUR) {
      advancePatrol(w, s, speed, t, (m, at) => planMorrill(w, m, at));
      if (s.coaledAt !== last) {
        coaled++;
        last = s.coaledAt;
        expect(legEndNode(w, s.leg)).toBe('node.duluth');
      }
    }
    expect(coaled).toBeGreaterThanOrEqual(3);
  });

  it('lies in winter quarters at Duluth while the ice is in', () => {
    const w = world({ 'region.apostles': 5 });
    const s = createMorrill(defs, lanes, JANUARY);
    advancePatrol(w, s, 10, JANUARY + 5 * HOUR, (m, at) => planMorrill(w, m, at));
    expect(s.leg.purpose).toBe('winter');
    expect(legEndNode(w, s.leg)).toBe('node.duluth');
  });

  it("won't put out in a gale, and runs for port when one catches her out", () => {
    const calm = world();
    const s = createMorrill(defs, lanes, 0);
    s.coaledAt = 0;
    expect(planMorrill(world({}, true), s, 10).purpose).toBe('shelter');
    // Out on the beat through the islands, half way, when it comes on to blow.
    const beat = lanes.get('lane.beat_apostles');
    if (!beat) throw new Error('no beat');
    const leg: PatrolLeg = {
      lane: beat.id,
      fromM: 0,
      toM: beat.lengthM,
      departAt: 0,
      lieS: HOUR,
      purpose: 'beat',
    };
    const out = { leg };
    const mid = legDoneAt(leg, 10) / 2;
    expect(shelterIfGale(calm, out, 10, mid, 6)).toBe(false);
    expect(shelterIfGale(world({}, true), out, 10, mid, 6)).toBe(true);
    expect(out.leg.purpose).toBe('shelter');
    // Back to Bayfield, the port at her lane's end (the far end is open water).
    expect(out.leg.toM).toBe(0);
    expect(out.leg.fromM).toBeCloseTo(legAlongM(leg, 10, mid));
  });

  it('sometimes leaves for Lake Michigan when the lake is quiet, never when it is hot', () => {
    expect(sortieWeights(world(), 'node.duluth').map((o) => o.lane)).toContain(
      defs.actors.cutter.away.lane,
    );
    expect(
      sortieWeights(world({ 'region.duluth': 3 }), 'node.duluth').map((o) => o.lane),
    ).not.toContain(defs.actors.cutter.away.lane);
  });

  it('is where her leg says, and out of sight lying in port', () => {
    const s = createMorrill(defs, lanes, 0);
    const c: Contact = {
      id: 'ship.morrill',
      kind: 'cutter',
      name: 'Revenue cutter Morrill',
      pos: { x: 0, y: 0 },
      heading: 0,
      speedKn: 10,
      conspicuity: 1,
      hostile: true,
      threat: true,
      prize: false,
      patrol: { lanes, leg: s.leg, speedKn: 10 },
    };
    placePatrol(c, 0);
    expect(c.inPort).toBe(true);
    const beat = lanes.get('lane.beat_apostles');
    if (!beat || !c.patrol) throw new Error('no beat');
    c.patrol.leg = {
      lane: beat.id,
      fromM: 0,
      toM: beat.lengthM,
      departAt: 0,
      lieS: HOUR,
      purpose: 'beat',
    };
    placePatrol(c, 1800);
    expect(c.inPort).toBe(false);
    expect(c.underWay).toBe(true);
    // Lying at the islands station (fishing grounds, open water): in sight.
    placePatrol(c, legDoneAt(c.patrol.leg, 10) - 60);
    expect(c.inPort).toBe(false);
    expect(c.underWay).toBe(false);
  });

  it('charters the tug in a tier-5 region, on the beats that cover it', () => {
    const w = world({ 'region.chequamegon': 5 });
    const t = charterTug(w, 'region.chequamegon', 0);
    expect(t).toBeDefined();
    if (!t) return;
    expect(t.until).toBe(defs.actors.tug.days * SECONDS_PER_GAME_DAY);
    const leg = planTug(w, t, 0);
    const covered = defs.actors.cutter.beats
      .filter((b) => b.regions.includes('region.chequamegon'))
      .map((b) => b.lane);
    expect(covered).toContain(leg.lane);
  });
});

describe('the chart: forced by Wanted and detection, not a dev flag', () => {
  const cutter = (at: Chart): Contact => ({
    id: 'ship.morrill',
    kind: 'cutter',
    name: 'Revenue cutter Morrill',
    pos: at,
    heading: 0,
    speedKn: 10,
    conspicuity: 1.2,
    hostile: true,
    threat: true,
    prize: false,
  });
  const here = { x: 0, y: 0 };
  const none = new Set<string>();

  it('never forces a meeting when she does not hunt (tier 0), however close', () => {
    const enc = checkEncounters(here, [cutter({ x: 500, y: 0 })], 12, 0, 'threats', none, {
      hunter: () => ({ hunts: false, seesAtM: 20_000 }),
    });
    expect(enc?.forced).toBe(false);
    expect(enc?.hunts).toBe(false);
  });

  it('forces one inside the range her lookout sees the ship at, not beyond', () => {
    const near = checkEncounters(here, [cutter({ x: 3000, y: 0 })], 12, 0, 'threats', none, {
      hunter: () => ({ hunts: true, seesAtM: 4000 }),
    });
    expect(near?.forced).toBe(true);
    const far = checkEncounters(here, [cutter({ x: 5000, y: 0 })], 12, 0, 'threats', none, {
      hunter: () => ({ hunts: true, seesAtM: 4000 }),
    });
    expect(far?.forced).toBe(false);
  });

  it('still lets ?cutter=hunt force her for checks', () => {
    const enc = checkEncounters(here, [cutter({ x: 500, y: 0 })], 12, 0, 'threats', none, {
      hostilesHunt: true,
      hunter: () => ({ hunts: false, seesAtM: 0 }),
    });
    expect(enc?.forced).toBe(true);
  });
});

function sense(over: Partial<CutterSense> = {}): CutterSense {
  return {
    tier: 1,
    inspectsFromTier: 1,
    pursuesFromTier: 2,
    awareness: 'spotted',
    identified: false,
    player: { x: 0, z: 0 },
    distanceM: 1000,
    playerKn: 7,
    playerShoal: false,
    rigging01: 1,
    ...over,
  };
}

/** Runs her captain for `seconds` at 10 Hz; returns every action. */
function run(
  b: CutterBrain,
  s: Partial<CutterSense>,
  seconds: number,
  rand = () => 0,
): CutterAction[] {
  const out: CutterAction[] = [];
  for (let t = 0; t < seconds; t += 0.1) out.push(...stepCutter(b, sense(s), 0.1, rand));
  return out;
}
const types = (a: CutterAction[]): string[] => a.map((x) => x.type);

describe('her captain at close quarters (criterion 7, §5.1, §8.1)', () => {
  it('never bothers a clean captain, seen or not', () => {
    const b = createCutterBrain();
    const a = run(b, { tier: 0, awareness: 'identified', identified: true, distanceM: 50 }, 60);
    expect(a).toEqual([]);
    expect(b.phase).toBe('patrol');
  });

  it('at tier 1, closes, hails for inspection, and searches once you heave to', () => {
    const b = createCutterBrain();
    expect(types(run(b, { distanceM: 1500 }, 1))).toEqual(['pursuit']);
    expect(b.phase).toBe('closing');
    expect(b.intent).toBe('inspect');
    const hail = run(b, { distanceM: 600 }, 1);
    expect(hail).toContainEqual({ type: 'hail', intent: 'inspect', arrest: false });
    // Hove to alongside: the search party comes aboard and takes its time.
    run(b, { distanceM: 60, playerKn: 0.5 }, CUTTER_RULES.heaveToS + 0.5);
    expect(b.phase).toBe('inspecting');
    expect(cutterOrders(b).mode).toBe('alongside');
    const searched = run(b, { distanceM: 40, playerKn: 0.5 }, CUTTER_RULES.inspectS + 0.5);
    expect(types(searched)).toContain('inspect');
    // Nothing found: she lets you go and the chart is free.
    expect(types(afterInspection(b, false, 1, 2))).toEqual(['release']);
    expect(cutterLocks(b, 'spotted')).toBe(false);
  });

  it('arrests after a find in a Wanted region: staying hove to is a surrender', () => {
    const b = createCutterBrain({ hunting: true, intent: 'inspect' });
    b.phase = 'inspecting';
    const a = afterInspection(b, true, 2, 2);
    expect(a).toEqual([{ type: 'hail', intent: 'pursue', arrest: true }]);
    const taken = run(b, { tier: 2, distanceM: 40, playerKn: 0.3 }, CUTTER_RULES.heaveToS + 0.5);
    expect(taken).toContainEqual({ type: 'capture', how: 'surrender' });
    expect(b.phase).toBe('captured');
  });

  it('turns an inspection you run from into a pursuit: warning shot, then the rigging', () => {
    const b = createCutterBrain({ hunting: true, intent: 'inspect' });
    run(b, { distanceM: 600 }, 1);
    expect(b.phase).toBe('hailed');
    const warned = run(b, { distanceM: 600 }, CUTTER_RULES.hailGraceS);
    expect(types(warned)).toContain('warningShot');
    expect(b.intent).toBe('pursue');
    const fired = run(b, { distanceM: 400 }, CUTTER_RULES.warnGraceS + 3 * CUTTER_RULES.fireEveryS);
    const rounds = fired.filter((x) => x.type === 'fire');
    expect(rounds.length).toBeGreaterThanOrEqual(3);
    // Rigging only: each hit is a share of the rigging, never the hull.
    for (const r of rounds)
      if (r.type === 'fire' && r.hit) expect(r.riggingShare).toBeGreaterThan(0);
  });

  it('pursues a known ship at tier 2, a seen one at tier 3', () => {
    const known = createCutterBrain();
    run(known, { tier: 2, identified: true }, 0.2);
    expect(known.intent).toBe('pursue');
    const unknown = createCutterBrain();
    run(unknown, { tier: 2, identified: false }, 0.2);
    expect(unknown.intent).toBe('inspect');
    const hunted = createCutterBrain();
    run(hunted, { tier: 3, identified: false }, 0.2);
    expect(hunted.intent).toBe('pursue');
  });

  it('boards a ship whose rigging is shot away once she is alongside', () => {
    const b = createCutterBrain({ hunting: true, intent: 'pursue' });
    const a = run(b, { tier: 2, distanceM: 30, playerKn: 4, rigging01: 0.1 }, 0.5);
    expect(a).toContainEqual({ type: 'capture', how: 'boarded' });
  });

  it("won't follow into the shallows: stands off, holds fire, and gives it up", () => {
    const b = createCutterBrain({ hunting: true, intent: 'pursue' });
    b.phase = 'firing';
    const a = run(b, { tier: 2, distanceM: 300, playerShoal: true }, CUTTER_RULES.standOffS + 1);
    expect(types(a)).not.toContain('fire');
    expect(a).toContainEqual({ type: 'gaveUp', why: 'shallows' });
    expect(b.phase).toBe('released');
  });

  it('searches where you were last seen when her lookout loses you, then gives up', () => {
    const b = createCutterBrain({ hunting: true, intent: 'pursue' });
    run(b, { tier: 2, distanceM: 600, player: { x: 100, z: 200 } }, 1);
    const lost = run(b, { tier: 2, awareness: 'unaware' }, 1);
    expect(b.phase).toBe('searching');
    expect(lost).toContainEqual({ type: 'pursuit', locked: false });
    expect(cutterOrders(b)).toEqual({ mode: 'search', at: { x: 100, z: 200 } });
    const gone = run(b, { tier: 2, awareness: 'unaware' }, CUTTER_RULES.searchS);
    expect(gone).toContainEqual({ type: 'gaveUp', why: 'lost' });
  });

  it('hits more often close aboard than at the end of her range', () => {
    expect(hitChance(CUTTER_RULES, 50)).toBeGreaterThan(hitChance(CUTTER_RULES, 750));
  });
});

describe('the hold search (§14.5)', () => {
  const economy = gameEconomy();
  const whiskey = { good: 'good.untaxed_whiskey', qty: 10 };

  it("uses the merchants' odds, raised by tier, halved by a hidden compartment", () => {
    const t1 = searchChance(economy, whiskey, 1, 'region.apostles', 0);
    const t4 = searchChance(economy, whiskey, 4, 'region.apostles', 0);
    const hidden = searchChance(economy, whiskey, 1, 'region.apostles', 0, 0.45);
    expect(t1).toBeGreaterThan(0.4);
    expect(t4).toBeGreaterThan(t1);
    expect(hidden).toBeLessThan(t1 * 0.5);
    // Clean goods and contract cargo are never "found".
    expect(searchChance(economy, { good: 'good.rope_canvas', qty: 5 }, 3, undefined, 0)).toBe(0);
  });
});

describe('the shallows she draws too much for', () => {
  it('grids the chart’s 3-fathom water as shoal in an arena, open lake as deep', () => {
    // Off the Bayfield shore inside Chequamegon Bay's flats, and the open lake off Duluth.
    const bay = sampleArenaLand(
      geo,
      { origin: geo.projection.geoToChart({ lat: 46.66, lon: -90.87 }), compression: 8 },
      1500,
    );
    const open = sampleArenaLand(
      geo,
      { origin: geo.projection.geoToChart({ lat: 47.05, lon: -91.3 }), compression: 8 },
      1500,
    );
    const shoalCells = (l: ArenaLand): number => {
      let n = 0;
      for (let x = -1500; x < 1500; x += 50) {
        for (let z = -1500; z < 1500; z += 50) if (l.isShoal?.(x, z)) n++;
      }
      return n;
    };
    expect(open.isShoal?.(0, 0)).toBe(false);
    expect(shoalCells(open)).toBeLessThan(10);
    expect(shoalCells(bay)).toBeGreaterThan(200);
  });

  it("keeps a deep-draft helm out of shoal water it's chasing toward", () => {
    // A shoal everywhere north of z = -200.
    const land: ArenaLand = {
      ...OPEN_LAKE,
      halfM: 2000,
      allDeep: false,
      isShoal: (_x, z) => z < -200,
    };
    const record = SHIP_RECORDS.find((r) => r.id === 'ship.cutter_morrill');
    if (!record) throw new Error('no cutter');
    const helm = createHelm(record, 0, 12, true);
    helm.deepDraft = true;
    helm.orders = { mode: 'intercept' };
    const s: SteeredShip = { x: 0, z: 400, vx: 0, vz: 0, heading: 0, lengthM: 50, helm };
    const player = { x: 0, z: -900, vx: 0, vz: 0, lengthM: 30 };
    let deepest = Infinity;
    for (let t = 0; t < 120; t += 0.1) {
      steerShips([s], player, land, 0.1);
      s.x += s.vx * 0.1;
      s.z += s.vz * 0.1;
      deepest = Math.min(deepest, s.z);
    }
    // She may put her bow a few meters over the edge as she stops; never her length.
    expect(deepest).toBeGreaterThan(-240);
  });
});
