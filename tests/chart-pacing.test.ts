import { describe, expect, it } from 'vitest';
import { EventBus } from '../src/core/events';
import { InputMapper } from '../src/core/input';
import { Rng } from '../src/core/rng';
import { createGameWorld } from '../src/gameplay/ecs';
import { CHART_TIME_SCALE, createChartMode, type ChartSession } from '../src/modes/chart';
import type { GameContext, GameEvents } from '../src/modes/context';
import { westernSuperiorChart } from '../src/sim/chart/chart-data';
import { createContacts, type LookoutPref } from '../src/sim/chart/traffic';
import { PROTOTYPE_SCHOONER } from '../src/sim/chart/voyage';
import { createLocalWeather } from '../src/sim/weather/local-weather';
import { createSea } from '../src/sim/weather/waves';
import { createWorldState } from '../src/sim/world-state';

/**
 * Encounter pacing on the route graph's traffic (plan 03 §6.4, §20.3 criterion 4: about 2
 * meaningful encounters on an Apostles crossing with the default lookout, fewer on short
 * hops, more in fall than in spring). Sails each route from many seeds, hours and winds,
 * answering every encounter with "ignore" (or a quick arena and back), and counts
 * interruptions. Spring is the run's first week (May 7, 1900); fall is 22 game days on,
 * the week of October 8 (each game day is a calendar week).
 */

const SPRING_DAY = 0;
const FALL_DAY = 22;

const geo = westernSuperiorChart();
const at = (lat: number, lon: number) => geo.projection.geoToChart({ lat, lon });

const ROUTES: Record<string, { from: [number, number]; via: [number, number][] }> = {
  'Duluth to the Apostles': {
    from: [46.8, -91.96],
    via: [
      [47.05, -91.0],
      [46.812, -90.822],
    ],
  },
  'Duluth to Two Harbors': { from: [46.8, -91.96], via: [[47.0, -91.67]] },
  'Two Harbors to the Apostles': {
    from: [46.96, -91.62],
    via: [
      [47.05, -91.0],
      [46.812, -90.822],
    ],
  },
  'Duluth to Siskiwit Bay': { from: [46.8, -91.96], via: [[46.88, -91.2]] },
};

interface Pacing {
  mean: number;
  max: number;
  realSeconds: number;
}

function sail(
  route: (typeof ROUTES)[string],
  lookout: LookoutPref,
  runs: number,
  day = SPRING_DAY,
): Pacing {
  let total = 0;
  let max = 0;
  let real = 0;
  for (let k = 0; k < runs; k++) {
    const state = createWorldState(`pacing-${k}`);
    state.environment.clock.gameSeconds = (day * 24 + (k % 24)) * 3600;
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
      position: at(...route.from),
      heading: 0,
      wind: { from: Rng.fromSeed(`wind-${k}`).range(0, Math.PI * 2), speedKn: 12 },
      contacts: createContacts(geo.projection, `traffic-${k}`, state.environment.clock.gameSeconds),
      waypoints: route.via.map(([lat, lon]) => at(lat, lon)),
      course: undefined,
      voyage: undefined,
      lookout,
      timeScale: CHART_TIME_SCALE,
      pending: undefined,
      handled: new Set(),
      quietUntil: 0,
    };
    let arrived = false;
    const mode = createChartMode(ctx, session, { onArrived: () => (arrived = true) });
    expect(mode.setSail()).toBe(true);
    let count = 0;
    let t = 0;
    while (!arrived && t < 120) {
      mode.update(1 / 30);
      t += 1 / 30;
      const enc = session.pending;
      if (enc) {
        count++;
        if (mode.resolve('ignore').outcome === 'arena') mode.resumeFrom(enc.contact.id);
      }
    }
    expect(arrived).toBe(true);
    total += count;
    max = Math.max(max, count);
    real += t;
  }
  return { mean: total / runs, max, realSeconds: real / runs };
}

const report = (name: string, p: Pacing): void => {
  if (process.env['PACING_REPORT']) {
    process.stderr.write(
      `\n${name}: mean ${p.mean.toFixed(2)}, max ${p.max}, ${p.realSeconds.toFixed(1)} s`,
    );
  }
};

describe('encounter pacing', () => {
  it.each(Object.keys(ROUTES))('%s stays near 0–2 interruptions by default', (name) => {
    const route = ROUTES[name] as (typeof ROUTES)[string];
    const pacing = sail(route, 'threatsAndPrizes', 100);
    report(`${name}, spring`, pacing);
    expect(pacing.mean).toBeGreaterThan(0.3);
    expect(pacing.mean).toBeLessThan(2.5);
    expect(pacing.max).toBeLessThanOrEqual(5);
  });

  it('gives an Apostles crossing about 2, and a short hop fewer (criterion 4)', () => {
    const crossing = sail(
      ROUTES['Duluth to the Apostles'] as (typeof ROUTES)[string],
      'threatsAndPrizes',
      100,
    );
    const hop = sail(
      ROUTES['Duluth to Two Harbors'] as (typeof ROUTES)[string],
      'threatsAndPrizes',
      100,
    );
    expect(crossing.mean).toBeGreaterThan(1.4);
    expect(crossing.mean).toBeLessThan(2.4);
    expect(hop.mean).toBeLessThan(crossing.mean * 0.6);
  });

  it.each(Object.keys(ROUTES))('%s is busier in fall than in spring', (name) => {
    const route = ROUTES[name] as (typeof ROUTES)[string];
    const spring = sail(route, 'threatsAndPrizes', 100, SPRING_DAY);
    const fall = sail(route, 'threatsAndPrizes', 100, FALL_DAY);
    report(`${name}, fall`, fall);
    expect(fall.mean).toBeGreaterThan(spring.mean);
    expect(fall.mean).toBeLessThan(3);
  });

  it('reports less with a stricter lookout', () => {
    const route = ROUTES['Duluth to the Apostles'] as (typeof ROUTES)[string];
    const all = sail(route, 'all', 60).mean;
    const prizes = sail(route, 'threatsAndPrizes', 60).mean;
    const threats = sail(route, 'threats', 60).mean;
    expect(all).toBeGreaterThanOrEqual(prizes);
    expect(prizes).toBeGreaterThan(threats);
  });
});
