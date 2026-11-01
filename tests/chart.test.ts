import { describe, expect, it } from 'vitest';
import { KNOT_MS, METERS_PER_NAUTICAL_MILE, type Chart } from '../src/core/coords';
import { EventBus } from '../src/core/events';
import { InputMapper } from '../src/core/input';
import { Rng } from '../src/core/rng';
import { createGameWorld } from '../src/gameplay/ecs';
import { CHART_TIME_SCALE, createChartMode, type ChartSession } from '../src/modes/chart';
import type { GameContext, GameEvents } from '../src/modes/context';
import { westernSuperiorChart } from '../src/sim/chart/chart-data';
import {
  firstLandHit,
  inRing,
  isWater,
  rectEntry,
  zoneById,
  type ChartGeography,
} from '../src/sim/chart/geography';
import {
  avoidChance,
  checkEncounters,
  createContacts,
  daylight,
  spotRangeM,
  stepContacts,
  type Contact,
} from '../src/sim/chart/traffic';
import {
  CALM_FLOOR,
  chartSpeedKn,
  estimateSeconds,
  planCourse,
  PROTOTYPE_SCHOONER,
  remainingM,
  startVoyage,
  stepVoyage,
  trueWindAngle,
} from '../src/sim/chart/voyage';
import { createLocalWeather } from '../src/sim/weather/local-weather';
import { createSea } from '../src/sim/weather/waves';
import { createWorldState } from '../src/sim/world-state';

const geo: ChartGeography = westernSuperiorChart();
const at = (lat: number, lon: number): Chart => geo.projection.geoToChart({ lat, lon });
const nm = (m: number): number => m / METERS_PER_NAUTICAL_MILE;

/** Just outside the Twin Ports zone, where a voyage from Duluth starts. */
const offDuluth = at(46.8, -91.96);
const bayfield = geo.ports.find((p) => p.id === 'port.bayfield')?.pos as Chart;
/** Off the Two Harbors waterfront (the port marker itself sits on the shore). */
const offTwoHarbors = at(46.99, -91.65);
/** Clear of the Bayfield peninsula, north of Sand Island and the Apostles zone. */
const northOfSand = at(47.17, -91.0);
/** Off Siskiwit Bay, west of the Apostles zone. */
const offSiskiwit = at(47.0, -91.2);

describe('chart geography', () => {
  it('keeps islands inside the lake and apart from each other', () => {
    for (const island of geo.islands) {
      for (const p of island.points) expect(inRing(p, geo.water), island.id).toBe(true);
      for (const other of geo.islands) {
        if (other === island) continue;
        for (const p of island.points)
          expect(inRing(p, other), `${island.id}/${other.id}`).toBe(false);
      }
    }
  });

  it('tells water from land', () => {
    expect(isWater(geo, offDuluth)).toBe(true);
    expect(isWater(geo, at(47.0, -90.2))).toBe(true); // open lake
    expect(isWater(geo, at(46.5, -91.5))).toBe(false); // Wisconsin, inland
    expect(isWater(geo, at(46.8, -90.72))).toBe(false); // Madeline Island
    expect(isWater(geo, at(46.81, -90.67))).toBe(true); // Big Bay, open to the lake
    expect(isWater(geo, at(46.9, -90.9))).toBe(false); // Bayfield peninsula
  });

  it('finds where a leg runs aground', () => {
    // Straight across the Bayfield peninsula.
    const t = firstLandHit(geo, at(46.88, -91.2), at(46.85, -90.7));
    expect(t).toBeGreaterThan(0);
    expect(t).toBeLessThan(0.5);
    expect(firstLandHit(geo, offDuluth, offTwoHarbors)).toBeUndefined();
  });

  it('places ports and lights where the gazetteer says, within ~15%', () => {
    // R1a: Duluth ↔ Two Harbors 22 nm (straight along the shore here).
    const duluth = geo.ports.find((p) => p.id === 'port.duluth')?.pos as Chart;
    const twoHarbors = geo.ports.find((p) => p.id === 'port.two_harbors')?.pos as Chart;
    expect(nm(Math.hypot(twoHarbors.x - duluth.x, twoHarbors.y - duluth.y))).toBeCloseTo(22, -1);
    // Bayfield ↔ La Pointe 2 nm.
    const laPointe = geo.ports.find((p) => p.id === 'port.la_pointe')?.pos as Chart;
    expect(nm(Math.hypot(laPointe.x - bayfield.x, laPointe.y - bayfield.y))).toBeLessThan(3);
  });

  it('enters a zone rectangle where the leg crosses its edge', () => {
    const zone = zoneById(geo, 'zone.apostles');
    if (!zone) throw new Error('no Apostles zone');
    const t = rectEntry(northOfSand, bayfield, zone);
    expect(t).toBeGreaterThan(0);
    expect(t).toBeLessThan(0.2);
    expect(rectEntry(bayfield, northOfSand, zone)).toBe(0);
    expect(rectEntry(offDuluth, offTwoHarbors, zone)).toBeUndefined();
  });
});

describe('course plotting', () => {
  it('refuses a course across land and accepts one around it', () => {
    const across = planCourse(geo, offDuluth, [bayfield]);
    expect(across.problem).toBe('aground');
    const around = planCourse(geo, offDuluth, [northOfSand, bayfield]);
    expect(around.problem).toBeUndefined();
    expect(around.destinationZone?.id).toBe('zone.apostles');
  });

  it('stops the sailed course at the destination zone edge', () => {
    const course = planCourse(geo, offDuluth, [offSiskiwit, at(47.0, -90.9), bayfield]);
    expect(course.problem).toBeUndefined();
    // The leg into the zone is cut at its edge; later waypoints are inside the zone.
    expect(course.legs).toHaveLength(2);
    expect(course.insideZone).toHaveLength(2);
    const zone = zoneById(geo, 'zone.apostles');
    const end = course.legs.at(-1)?.to as Chart;
    expect(end.x).toBeCloseTo(zone?.min.x ?? NaN, 0);
  });

  it('refuses a course to the zone the ship is already in', () => {
    const inApostles = at(46.75, -90.8);
    expect(planCourse(geo, inApostles, [bayfield]).problem).toBe('insideDestination');
  });

  it('matches the gazetteer: Duluth to Bayfield is a long half-day sail', () => {
    const course = planCourse(geo, offDuluth, [northOfSand, bayfield]);
    // R1a: 64 nm port to port; the chart sails only to the Apostles zone edge.
    expect(nm(course.lengthM)).toBeGreaterThan(40);
    expect(nm(course.lengthM)).toBeLessThan(64);
    const beamReach = { from: Math.PI / 2 + (course.legs[0]?.heading ?? 0), speedKn: 14 };
    const hours = estimateSeconds(course, beamReach, PROTOTYPE_SCHOONER) / 3600;
    expect(hours).toBeGreaterThan(5);
    expect(hours).toBeLessThan(12);
  });
});

describe('sailing model', () => {
  it('measures the true wind angle from the bow', () => {
    const wind = { from: 0, speedKn: 12 };
    expect(trueWindAngle(0, wind)).toBeCloseTo(0);
    expect(trueWindAngle(Math.PI, wind)).toBeCloseTo(Math.PI);
    expect(trueWindAngle(Math.PI / 2, wind)).toBeCloseTo(Math.PI / 2);
    expect(trueWindAngle((3 * Math.PI) / 2, wind)).toBeCloseTo(Math.PI / 2);
  });

  it('is fastest on a beam reach and slowest to windward', () => {
    const wind = { from: 0, speedKn: 14 };
    const beam = chartSpeedKn(Math.PI / 2, wind, PROTOTYPE_SCHOONER);
    const upwind = chartSpeedKn(0, wind, PROTOTYPE_SCHOONER);
    const run = chartSpeedKn(Math.PI, wind, PROTOTYPE_SCHOONER);
    expect(beam).toBeGreaterThan(run);
    expect(run).toBeGreaterThan(upwind);
    expect(beam).toBeGreaterThan(7);
    expect(beam).toBeLessThan(9);
  });

  it('still ghosts along at about 3 kn in a calm', () => {
    for (const heading of [0, Math.PI / 2, Math.PI]) {
      const calm = chartSpeedKn(heading, { from: 0, speedKn: 0 }, PROTOTYPE_SCHOONER);
      expect(calm).toBeCloseTo(PROTOTYPE_SCHOONER.cruiseKn * CALM_FLOOR);
      expect(calm).toBeCloseTo(3);
    }
    // A working breeze is well clear of the floor.
    const breeze = chartSpeedKn(Math.PI / 2, { from: 0, speedKn: 10 }, PROTOTYPE_SCHOONER);
    expect(breeze).toBeGreaterThan(PROTOTYPE_SCHOONER.cruiseKn * CALM_FLOOR * 2);
  });

  it('sails a voyage to arrival in the estimated time, whatever the step size', () => {
    const course = planCourse(geo, offDuluth, [northOfSand, bayfield]);
    const wind = { from: 5.5, speedKn: 12 };
    const eta = estimateSeconds(course, wind, PROTOTYPE_SCHOONER);
    for (const step of [24, 600]) {
      const voyage = startVoyage(course, 0);
      let t = 0;
      while (!voyage.arrived) {
        stepVoyage(voyage, step, wind, PROTOTYPE_SCHOONER);
        t += step;
      }
      expect(t).toBeGreaterThanOrEqual(eta);
      expect(t).toBeLessThan(eta + step);
      expect(remainingM(voyage)).toBeCloseTo(0);
      const end = course.legs.at(-1)?.to as Chart;
      expect(voyage.position.x).toBeCloseTo(end.x, 3);
    }
  });
});

describe('traffic and encounters', () => {
  it('keeps every contact on open water', () => {
    const contacts = createContacts(geo.projection, 'lanes');
    for (const c of contacts) {
      expect(isWater(geo, c.pos), c.id).toBe(true);
      const points = c.lane?.points ?? [];
      for (let i = 1; i < points.length; i++) {
        expect(
          firstLandHit(geo, points[i - 1] as Chart, points[i] as Chart),
          `${c.id} leg ${i}`,
        ).toBeUndefined();
      }
    }
  });

  it('moves ships along their lanes and keeps them on the water', () => {
    const contacts = createContacts(geo.projection, 'move');
    let now = 0;
    for (let i = 0; i < 2000; i++) {
      now += 600;
      stepContacts(contacts, now);
    }
    for (const c of contacts) expect(isWater(geo, c.pos), c.id).toBe(true);
  });

  it('sees farther by day than by night', () => {
    expect(daylight(12)).toBe(1);
    expect(daylight(1)).toBe(0);
    expect(spotRangeM(12)).toBeGreaterThan(1.5 * spotRangeM(1));
  });

  it('filters encounters by the lookout setting, but never a forced one', () => {
    const tug: Contact = {
      id: 'ship.tug',
      kind: 'tug',
      name: 'tug',
      pos: { x: 3000, y: 0 },
      heading: 0,
      speedKn: 6,
      conspicuity: 1,
      hostile: false,
      threat: false,
      prize: false,
    };
    const cutter: Contact = {
      ...tug,
      id: 'ship.cutter',
      kind: 'cutter',
      hostile: true,
      threat: true,
    };
    const here = { x: 0, y: 0 };
    const none = new Set<string>();
    expect(checkEncounters(here, [tug], 12, 0, 'all', none)?.contact.id).toBe('ship.tug');
    // A ship lying in port isn't on the water to be seen.
    expect(checkEncounters(here, [{ ...tug, inPort: true }], 12, 0, 'all', none)).toBeUndefined();
    expect(checkEncounters(here, [tug], 12, 0, 'threatsAndPrizes', none)).toBeUndefined();
    expect(tug.lastSeen?.at).toBe(0);

    // The cutter is close enough to spot the schooner: forced, whatever the setting.
    const enc = checkEncounters(here, [tug, cutter], 12, 0, 'threats', none);
    expect(enc?.contact.id).toBe('ship.cutter');
    expect(enc?.forced).toBe(true);
    expect(
      checkEncounters(here, [cutter], 12, 0, 'threats', new Set(['ship.cutter'])),
    ).toBeUndefined();
  });

  it('makes slipping a hostile easier at night', () => {
    const cutter = {
      contact: { hostile: true, speedKn: 10 } as Contact,
      forced: false,
      distanceM: 9000,
      bearing: 0,
    };
    expect(avoidChance(cutter, 1, 8, 1)).toBeGreaterThan(avoidChance(cutter, 12, 8, 1));
    expect(avoidChance({ ...cutter, contact: { hostile: false } as Contact }, 12, 8, 1)).toBe(1);
  });
});

describe('chart mode', () => {
  function setup(seed: string): { session: ChartSession; ctx: GameContext } {
    const state = createWorldState(seed);
    state.environment.clock.gameSeconds = 8 * 3600;
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
      position: offDuluth,
      heading: 0,
      wind: { from: 5.5, speedKn: 12 },
      contacts: [],
      waypoints: [northOfSand, bayfield],
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

  it('holds the clock while plotting and runs it compressed while under way', () => {
    const { session, ctx } = setup('clock');
    const mode = createChartMode(ctx, session);
    const clock = ctx.state.environment.clock;
    mode.update(1);
    expect(clock.gameSeconds).toBe(8 * 3600);
    expect(mode.setSail()).toBe(true);
    mode.update(1);
    expect(clock.gameSeconds).toBeCloseTo(8 * 3600 + CHART_TIME_SCALE);
  });

  it('sails from Duluth to the Apostles edge in 20–30 real seconds (criterion 2)', () => {
    const { session, ctx } = setup('arrive');
    let arrived: string | undefined;
    const mode = createChartMode(ctx, session, { onArrived: (z) => (arrived = z?.id) });
    const ticks: number[] = [];
    ctx.events.on('WorldTick', ({ gameSeconds }) => ticks.push(gameSeconds));
    mode.setSail();
    let real = 0;
    while (!arrived && real < 120) {
      mode.update(1 / 60);
      real += 1 / 60;
    }
    expect(arrived).toBe('zone.apostles');
    // Plan 03 §20.3 criterion 2: Duluth → the Apostles edge in 20–30 s plus stops.
    expect(real).toBeGreaterThan(20);
    expect(real).toBeLessThan(30);
    expect(ticks.length).toBeGreaterThan(30);
    // The course comes in from the north, so it stops on the zone's north edge.
    expect(session.position.y).toBeCloseTo(zoneById(geo, 'zone.apostles')?.max.y ?? NaN, 0);
  });

  it('pauses for an encounter and resumes after the choice', () => {
    const { session, ctx } = setup('encounter');
    // A freighter dead ahead on the course.
    const freighter: Contact = {
      id: 'ship.test',
      kind: 'freighter',
      name: 'test',
      pos: at(46.9, -91.6),
      heading: 0,
      speedKn: 0,
      conspicuity: 1,
      hostile: false,
      threat: false,
      prize: true,
    };
    session.contacts = [freighter];
    const spotted: string[] = [];
    const mode = createChartMode(ctx, session, { onEncounter: (e) => spotted.push(e.contact.id) });
    mode.setSail();
    for (let i = 0; i < 60 * 30 && !session.pending; i++) mode.update(1 / 60);
    expect(spotted).toEqual(['ship.test']);
    const held = ctx.state.environment.clock.gameSeconds;
    mode.update(1);
    expect(ctx.state.environment.clock.gameSeconds).toBe(held);

    expect(mode.resolve('engage').outcome).toBe('arena');
    mode.resumeFrom('ship.test');
    for (let i = 0; i < 600; i++) mode.update(1 / 60);
    expect(session.pending).toBeUndefined();
    expect(spotted).toHaveLength(1);
  });

  it('keeps an honest clock: chart speed matches the voyage', () => {
    const { session, ctx } = setup('honest');
    const mode = createChartMode(ctx, session);
    mode.setSail();
    const start = { ...session.position };
    mode.update(1); // one real second
    const moved = Math.hypot(session.position.x - start.x, session.position.y - start.y);
    const expected = (session.voyage?.speedKn ?? 0) * KNOT_MS * CHART_TIME_SCALE;
    expect(moved).toBeCloseTo(expected, 0);
  });
});
