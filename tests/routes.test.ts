import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { portsFileSchema } from '../data/schemas/ports';
import { routesFileSchema } from '../data/schemas/routes';
import { KNOT_MS, METERS_PER_NAUTICAL_MILE, type Chart } from '../src/core/coords';
import { EventBus } from '../src/core/events';
import { InputMapper } from '../src/core/input';
import { Rng } from '../src/core/rng';
import { SECONDS_PER_GAME_DAY } from '../src/core/time';
import { createGameWorld } from '../src/gameplay/ecs';
import { CHART_TIME_SCALE, createChartMode, type ChartSession } from '../src/modes/chart';
import type { GameContext, GameEvents } from '../src/modes/context';
import {
  arenaFromChartEncounter,
  COMPANY_RANGE_M,
  CONSORT_ASTERN_M,
  MAX_ARENA_SHIPS,
} from '../src/sim/arena/encounter';
import { westernSuperiorChart } from '../src/sim/chart/chart-data';
import {
  encounterBudget,
  expectedEncounters,
  laneShare,
  MAX_BUDGET,
  tradeLaneLines,
} from '../src/sim/chart/director';
import { distance, firstLandHit, isWater } from '../src/sim/chart/geography';
import {
  createTraffic,
  laneLonLats,
  monthAt,
  placeTraffic,
  seasonBusyness,
  westernSuperiorRoutes,
} from '../src/sim/chart/routes';
import {
  avoidChance,
  checkEncounters,
  createContacts,
  detourSeconds,
  type Contact,
  type Encounter,
} from '../src/sim/chart/traffic';
import { planCourse, PROTOTYPE_SCHOONER, remainingSeconds } from '../src/sim/chart/voyage';
import { SHIP_RECORDS } from '../src/sim/sailing/ships';
import { createLocalWeather } from '../src/sim/weather/local-weather';
import { createSea } from '../src/sim/weather/waves';
import { createWorldState } from '../src/sim/world-state';
import { chartHud, encounterCard } from '../src/ui/chart/model';

/** Phase 3 piece F: traffic on the route graph, the encounter director and detours. */

const geo = westernSuperiorChart();
const graph = westernSuperiorRoutes();
const at = (lat: number, lon: number): Chart => geo.projection.geoToChart({ lat, lon });
const toChart = ([lon, lat]: [number, number]): Chart => at(lat, lon);
const HOUR = 3600;
/** Game days are calendar weeks from May 7, 1900: day 22 is the week of October 8. */
const MAY = 0;
const OCTOBER = 22 * SECONDS_PER_GAME_DAY;
const JANUARY = 35 * SECONDS_PER_GAME_DAY;

describe('routes.json', () => {
  it('parses, and every node, waypoint and derelict lies on open water', () => {
    const raw = JSON.parse(
      readFileSync(join(import.meta.dirname, '..', 'data', 'routes.json'), 'utf8'),
    ) as unknown;
    expect(() => routesFileSchema.parse(raw)).not.toThrow();
    for (const node of graph.nodes.values())
      expect(isWater(geo, toChart(node.at)), node.id).toBe(true);
    for (const poi of graph.pois) expect(isWater(geo, toChart(poi.at)), poi.id).toBe(true);
  });

  it('keeps every lane leg clear of the land mask', () => {
    for (const lane of graph.lanes) {
      const points = laneLonLats(graph, lane).map(toChart);
      for (let i = 1; i < points.length; i++) {
        expect(
          firstLandHit(geo, points[i - 1] as Chart, points[i] as Chart),
          `${lane.id} leg ${i}`,
        ).toBeUndefined();
      }
    }
  });

  it('crews every lane with traffic classes from ships.json, and names every ship', () => {
    const npc = new Set(SHIP_RECORDS.filter((r) => r.role === 'npc').map((r) => r.id));
    for (const lane of graph.lanes) {
      for (const entry of lane.fleet) {
        expect(npc, `${lane.id} ${entry.classId}`).toContain(entry.classId);
        if (entry.consort) expect(npc).toContain(entry.consort);
        expect(entry.names.length, lane.id).toBeGreaterThanOrEqual(entry.count);
      }
    }
    for (const poi of graph.pois) expect(npc).toContain(poi.classId);
  });

  it('links port nodes to ports.json, and gives the Morrill her beat', () => {
    const raw = JSON.parse(
      readFileSync(join(import.meta.dirname, '..', 'data', 'ports.json'), 'utf8'),
    ) as unknown;
    const ports = new Set(portsFileSchema.parse(raw).map((p) => p.id));
    for (const node of graph.nodes.values()) {
      if (node.port) expect(ports, node.id).toContain(node.port);
    }
    const patrols = graph.lanes.filter((l) => l.use === 'patrol');
    expect(patrols.map((l) => l.fleet[0]?.classId)).toEqual(['ship.cutter_morrill']);
  });
});

describe('abstract ships on the lanes', () => {
  const ships = (seed: string, t: number): Contact[] => {
    const c = createTraffic(geo.projection, seed);
    placeTraffic(c, t);
    return c;
  };

  it('puts every ship where the seed and the clock say, the same every time', () => {
    const a = ships('run-1', 30 * HOUR);
    const b = ships('run-1', 30 * HOUR);
    const other = ships('run-2', 30 * HOUR);
    expect(a.map((c) => c.pos)).toEqual(b.map((c) => c.pos));
    expect(a.map((c) => c.pos)).not.toEqual(other.map((c) => c.pos));
    // Every ship and derelict on the route graph is there, with an id of its own.
    const fleet = graph.lanes.reduce((n, l) => n + l.fleet.reduce((m, e) => m + e.count, 0), 0);
    expect(a).toHaveLength(fleet + graph.pois.length);
    expect(new Set(a.map((c) => c.id)).size).toBe(a.length);
  });

  it('sails each ship along its lane at her speed, as {leg, progress}', () => {
    const c = createTraffic(geo.projection, 'steady');
    let moving = 0;
    for (let t = 10 * HOUR; t < 40 * HOUR; t += 600) {
      placeTraffic(c, t);
      const after = c.map((s) => ({ ...s.pos }));
      placeTraffic(c, t + 600);
      c.forEach((s, i) => {
        const moved = distance(after[i] as Chart, s.pos);
        // Never faster than her speed (a turn at a lane's end can be slower).
        expect(moved, s.id).toBeLessThanOrEqual(s.speedKn * KNOT_MS * 600 + 1);
        if (moved > 0) moving++;
        expect(isWater(geo, s.pos), s.id).toBe(true);
      });
    }
    expect(moving).toBeGreaterThan(0);
    for (const s of c) {
      if (!s.schedule) continue;
      expect(s.lane?.leg).toBeGreaterThanOrEqual(0);
      expect(s.lane?.leg).toBeLessThan(s.schedule.points.length - 1);
    }
  });

  it('lays the fleet up for the ice, and sails more of it in October than in May', () => {
    const underWay = (t0: number, ore = false): number => {
      let n = 0;
      for (let k = 0; k < 40; k++) {
        const c = ships(`season-${k}`, t0 + k * 5 * HOUR);
        n += c.filter(
          (s) => s.schedule && s.underWay && (!ore || /_ore$/.test(s.schedule.laneId)),
        ).length;
      }
      return n;
    };
    expect(monthAt(JANUARY)).toBe(0);
    expect(underWay(JANUARY)).toBe(0);
    // The ore trade peaks in the fall (plan 05 §8.1); summer's passenger line thins out.
    expect(underWay(OCTOBER, true)).toBeGreaterThan(underWay(MAY, true) * 1.4);
    expect(underWay(OCTOBER)).toBeGreaterThan(underWay(MAY));
    expect(seasonBusyness(0)).toBe(0);
    expect(seasonBusyness(9)).toBeGreaterThan(seasonBusyness(4));
  });

  it('hides ships lying in port, and keeps tugs in sight on the grounds', () => {
    let hidden = 0;
    let onGrounds = 0;
    for (let k = 0; k < 60; k++) {
      const c = ships(`port-${k}`, MAY + k * 3 * HOUR);
      hidden += c.filter((s) => s.inPort).length;
      onGrounds += c.filter((s) => s.kind === 'tug' && !s.inPort && s.underWay === false).length;
    }
    expect(hidden).toBeGreaterThan(0);
    expect(onGrounds).toBeGreaterThan(0);
  });

  it('keeps the derelicts still, and a freighter towing her consort', () => {
    const c = ships('poi', 12 * HOUR);
    const derelicts = c.filter((s) => s.kind === 'derelict');
    expect(derelicts.map((d) => d.id).sort()).toEqual(graph.pois.map((p) => p.id).sort());
    for (const d of derelicts) expect(d.speedKn).toBe(0);
    expect(c.some((s) => s.consorts?.[0]?.classId === 'ship.schooner_barge')).toBe(true);
  });
});

function chartSetup(
  seed: string,
  startS: number,
  waypoints: Chart[],
  from = at(46.8, -91.96),
): { session: ChartSession; ctx: GameContext } {
  const state = createWorldState(seed);
  state.environment.clock.gameSeconds = startS;
  const ctx: GameContext = {
    state,
    world: createGameWorld(),
    rng: Rng.fromState(state.environment.rng),
    input: new InputMapper(),
    events: new EventBus<GameEvents>(),
    sea: createSea([]),
    weather: createLocalWeather(),
  };
  const session: ChartSession = {
    geo,
    ship: PROTOTYPE_SCHOONER,
    position: from,
    heading: 0,
    wind: { from: 5.5, speedKn: 12 },
    contacts: [],
    waypoints,
    course: undefined,
    voyage: undefined,
    lookout: 'threatsAndPrizes',
    timeScale: CHART_TIME_SCALE,
    pending: undefined,
    handled: new Set(),
    quietUntil: 0,
  };
  return { session, ctx };
}

describe('the encounter director', () => {
  const lanes = tradeLaneLines(geo.projection);
  const crossing = planCourse(geo, at(46.8, -91.96), [at(47.05, -91.0), at(46.812, -90.822)]);
  const hop = planCourse(geo, at(46.8, -91.96), [at(47.0, -91.67)]);
  const offLanes = planCourse(geo, at(47.45, -91.0), [at(47.5, -90.4)]);

  it('budgets more for a long crossing than a short hop, and more in fall', () => {
    expect(laneShare(crossing, lanes)).toBeGreaterThan(0.9);
    expect(expectedEncounters(crossing, 4, lanes)).toBeGreaterThan(1.5);
    expect(expectedEncounters(hop, 4, lanes)).toBeLessThan(0.6);
    expect(expectedEncounters(crossing, 9, lanes)).toBeGreaterThan(
      expectedEncounters(crossing, 4, lanes),
    );
    expect(expectedEncounters(crossing, 0, lanes)).toBe(0);
  });

  it('budgets less off the lanes than on them, mile for mile', () => {
    expect(offLanes.problem).toBeUndefined();
    const perNm = (c: typeof crossing) =>
      expectedEncounters(c, 7, lanes) / (c.lengthM / METERS_PER_NAUTICAL_MILE);
    expect(laneShare(offLanes, lanes)).toBeLessThan(0.5);
    expect(perNm(offLanes)).toBeLessThan(perNm(crossing));
  });

  it('rounds the expected count at random in proportion, up to the cap', () => {
    const rng = Rng.fromSeed('budget');
    let sum = 0;
    for (let i = 0; i < 2000; i++) sum += encounterBudget(1.3, rng);
    expect(sum / 2000).toBeCloseTo(1.3, 1);
    expect(encounterBudget(9, rng)).toBe(MAX_BUDGET);
    expect(encounterBudget(0, rng)).toBe(0);
  });

  it('sets the budget on sailing, spends it on reports, then lets only threats through', () => {
    const { session, ctx } = chartSetup('spend', MAY + 9 * HOUR, [
      at(47.05, -91.0),
      at(46.812, -90.822),
    ]);
    const mode = createChartMode(ctx, session);
    expect(mode.setSail()).toBe(true);
    expect(session.budget).toBeGreaterThanOrEqual(1);
    session.budget = 0;
    const prize: Contact = {
      id: 'ship.prize',
      kind: 'freighter',
      name: 'prize',
      pos: { ...session.position },
      heading: 0,
      speedKn: 0,
      conspicuity: 1,
      hostile: false,
      threat: false,
      prize: true,
    };
    const squall: Contact = {
      ...prize,
      id: 'weather.test',
      kind: 'storm',
      threat: true,
      prize: false,
      radiusM: 100,
    };
    const none = new Set<string>();
    expect(
      checkEncounters(session.position, [prize], 12, 0, 'all', none, { threatsOnly: true }),
    ).toBeUndefined();
    expect(
      checkEncounters(session.position, [prize, squall], 12, 0, 'all', none, { threatsOnly: true })
        ?.contact.id,
    ).toBe('weather.test');
  });
});

describe('the Morrill', () => {
  const morrill = (): Contact => ({
    id: 'ship.morrill',
    kind: 'cutter',
    name: 'Revenue cutter Morrill',
    pos: { x: 2000, y: 0 },
    heading: 0,
    speedKn: 10,
    conspicuity: 1.2,
    hostile: true,
    threat: true,
    prize: false,
  });

  it('is sighted but forces nothing until she hunts (Phase 5, or ?cutter=hunt)', () => {
    const here = { x: 0, y: 0 };
    const none = new Set<string>();
    const sighted = checkEncounters(here, [morrill()], 12, 0, 'threats', none, {
      hostilesHunt: false,
    });
    expect(sighted?.forced).toBe(false);
    expect(sighted?.hunts).toBe(false);
    // In the quiet spell, a cutter that isn't hunting doesn't interrupt at all.
    expect(
      checkEncounters(here, [morrill()], 12, 0, 'threats', none, {
        hostilesHunt: false,
        forcedOnly: true,
      }),
    ).toBeUndefined();
    const hunting = checkEncounters(here, [morrill()], 12, 0, 'threats', none, {
      hostilesHunt: true,
      forcedOnly: true,
    });
    expect(hunting?.forced).toBe(true);
  });

  it('can always be steered clear of when she is not hunting', () => {
    const enc: Encounter = {
      contact: morrill(),
      forced: false,
      distanceM: 9000,
      bearing: 0,
      hunts: false,
    };
    expect(avoidChance(enc, 12, 6, 1)).toBe(1);
    expect(avoidChance({ ...enc, hunts: true }, 12, 6, 1)).toBeLessThan(1);
  });

  it('patrols in the game traffic, hostile and a threat', () => {
    const c = createContacts(geo.projection, 'patrol', MAY + 10 * HOUR);
    const cutter = c.find((s) => s.kind === 'cutter');
    expect(cutter?.hostile).toBe(true);
    expect(cutter?.threat).toBe(true);
    expect(cutter?.prize).toBe(false);
  });
});

describe('steering clear costs time (S8 finding 4)', () => {
  const squall = (distanceM: number): Encounter => ({
    contact: {
      id: 'weather.squall',
      kind: 'storm',
      name: 'Squall line',
      pos: { x: 0, y: 0 },
      heading: 0,
      speedKn: 9,
      conspicuity: 2,
      hostile: false,
      threat: true,
      prize: false,
      radiusM: 9000,
    },
    forced: false,
    distanceM,
    bearing: 0,
  });

  it('prices a detour by what was avoided', () => {
    const ship = {
      ...squall(5000),
      contact: { ...squall(0).contact, kind: 'freighter' as const, radiusM: 0 },
    };
    const hostile = { ...ship, contact: { ...ship.contact, hostile: true } };
    expect(detourSeconds(ship, 7)).toBeCloseTo((2 * METERS_PER_NAUTICAL_MILE) / (7 * KNOT_MS));
    expect(detourSeconds(hostile, 7)).toBeGreaterThan(detourSeconds(ship, 7));
    expect(detourSeconds(squall(5000), 7)).toBeGreaterThan(detourSeconds(ship, 7));
  });

  it('lets a squall raised late clip you', () => {
    expect(avoidChance(squall(20_000), 12, 7, 1)).toBe(1);
    expect(avoidChance(squall(500), 12, 7, 1)).toBeLessThan(0.7);
    expect(avoidChance(squall(0), 12, 7, 1)).toBe(0.5);
  });

  it('holds the voyage back by the detour and puts it in the ETA', () => {
    const run = (avoid: boolean): { realS: number; eta: number } => {
      const { session, ctx } = chartSetup('detour', MAY + 9 * HOUR, [
        at(47.05, -91.0),
        at(46.812, -90.822),
      ]);
      let arrived = false;
      const mode = createChartMode(ctx, session, { onArrived: () => (arrived = true) });
      mode.setSail();
      let eta = 0;
      if (avoid) {
        // Sighted 4 nm off: steering clear always works, and costs the detour.
        session.pending = squall(4 * METERS_PER_NAUTICAL_MILE);
        expect(
          encounterCard(session.pending, session, ctx.state.environment.clock.gameSeconds)
            .avoidLabel,
        ).toBe('Steer clear');
        expect(mode.resolve('avoid')).toEqual({ outcome: 'continue', escaped: true });
        expect(session.detourS).toBeGreaterThan(0);
        const voyage = session.voyage;
        if (!voyage) throw new Error('no voyage');
        eta = remainingSeconds(voyage, session.wind, session.ship) + (session.detourS ?? 0);
        const hud = chartHud({
          session,
          trip: 'sea',
          gameSeconds: ctx.state.environment.clock.gameSeconds,
          backLabel: undefined,
          notice: undefined,
          locked: false,
        });
        expect(hud.statusText).toMatch(/^Standing off/);
      }
      let t = 0;
      while (!arrived && t < 120) {
        mode.update(1 / 30);
        t += 1 / 30;
        session.pending = undefined;
      }
      return { realS: t, eta };
    };
    const straight = run(false);
    const detour = run(true);
    expect(detour.realS).toBeGreaterThan(straight.realS + 0.5);
    expect(detour.eta).toBeGreaterThan(0);
  });
});

describe('ships from the traffic in an arena', () => {
  const ship = (over: Partial<Contact>): Contact => ({
    id: 'ship.a',
    kind: 'freighter',
    name: 'A',
    classId: 'ship.ore_freighter',
    pos: { x: 0, y: 0 },
    heading: Math.PI / 2,
    speedKn: 8,
    conspicuity: 1.3,
    hostile: false,
    threat: false,
    prize: true,
    underWay: true,
    ...over,
  });

  it('brings the consort astern and nearby traffic at its place, up to the budget', () => {
    const met = ship({ consorts: [{ classId: 'ship.schooner_barge', name: 'Consort' }] });
    const near = ship({
      id: 'ship.b',
      kind: 'tug',
      classId: 'ship.fish_tug',
      pos: { x: 4000, y: 2000 },
      underWay: false,
    });
    const far = ship({ id: 'ship.far', pos: { x: COMPANY_RANGE_M * 8 + 500, y: 0 } });
    const inPort = ship({ id: 'ship.port', pos: { x: 100, y: 0 }, inPort: true });
    const enc = arenaFromChartEncounter(
      { contact: met, forced: false, distanceM: 6000, bearing: 0 },
      { x: -6000, y: 0 },
      Math.PI / 2,
      { company: [met, near, far, inPort] },
    );
    expect(enc.ships.map((s) => s.id)).toEqual(['ship.a', 'ship.a.consort_1', 'ship.b']);
    // Heading east, the consort is astern to the west.
    expect(enc.ships[1]?.offset?.x).toBeCloseTo(-CONSORT_ASTERN_M);
    expect(enc.ships[1]?.classId).toBe('ship.schooner_barge');
    // 4 km east and 2 km north on the chart is 500 m east, 250 m north (-z) in the arena.
    expect(enc.ships[2]?.offset).toEqual({ x: 500, z: -250 });
    // The tug on her nets has no way on.
    expect(enc.ships[2]?.speedKn).toBe(0);

    const crowd = Array.from({ length: 8 }, (_, i) =>
      ship({ id: `ship.c${i}`, pos: { x: 300 * (i + 1), y: 0 } }),
    );
    const full = arenaFromChartEncounter(
      { contact: met, forced: false, distanceM: 6000, bearing: 0 },
      { x: -6000, y: 0 },
      0,
      { company: crowd },
    );
    expect(full.ships).toHaveLength(MAX_ARENA_SHIPS);
  });
});
