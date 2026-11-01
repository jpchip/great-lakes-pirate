import { describe, expect, it } from 'vitest';
import { EventBus } from '../src/core/events';
import { InputMapper } from '../src/core/input';
import { Rng } from '../src/core/rng';
import { createGameWorld } from '../src/gameplay/ecs';
import { CHART_TIME_SCALE, createChartMode, readSky, type ChartSession } from '../src/modes/chart';
import { createChartSky } from '../src/sim/chart/chart-weather';
import type { GameContext, GameEvents } from '../src/modes/context';
import { westernSuperiorChart } from '../src/sim/chart/chart-data';
import { createContacts, isWeatherContact, type LookoutPref } from '../src/sim/chart/traffic';
import { PROTOTYPE_SCHOONER } from '../src/sim/chart/voyage';
import { createLocalWeather } from '../src/sim/weather/local-weather';
import { createSea } from '../src/sim/weather/waves';
import { createWorldState } from '../src/sim/world-state';

/**
 * Encounter pacing on the route graph's traffic (plan 03 §6.4, §20.3 criterion 4: about 2
 * meaningful encounters on an Apostles crossing with the default lookout, fewer on short
 * hops, more in fall than in spring). Sails each route from many seeds and hours,
 * answering every encounter with "ignore" (or a quick arena and back), and counts
 * interruptions. Spring is the run's first week (May 7, 1900); fall is 22 game days on,
 * the week of October 8 (each game day is a calendar week). The wind is the weather sim's
 * own, and its squalls and fog banks are met as well as the traffic (piece E).
 */

const SPRING_DAY = 0;
const FALL_DAY = 22;

/** The sim's weather is read on every world tick, so these runs take a few seconds each. */
const SLOW = { timeout: 60_000 };

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
  /** Mean meetings with ships and derelicts, leaving out the weather. */
  traffic: number;
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
  let traffic = 0;
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
      // Replaced by the sim's wind at the start (readSky below).
      wind: { from: 0, speedKn: 12 },
      contacts: createContacts(geo.projection, `traffic-${k}`, state.environment.clock.gameSeconds),
      // The sim's weather, as in the game: its wind, and its squalls and fog banks met.
      sky: createChartSky(state.environment.weather),
      waypoints: route.via.map(([lat, lon]) => at(lat, lon)),
      course: undefined,
      voyage: undefined,
      lookout,
      timeScale: CHART_TIME_SCALE,
      pending: undefined,
      handled: new Set(),
      quietUntil: 0,
    };
    readSky(session, state.environment.clock.gameSeconds);
    let arrived = false;
    const mode = createChartMode(ctx, session, { onArrived: () => (arrived = true) });
    expect(mode.setSail()).toBe(true);
    let count = 0;
    let t = 0;
    while (!arrived && t < 600) {
      mode.update(1 / 30);
      t += 1 / 30;
      const enc = session.pending;
      if (enc) {
        count++;
        if (!isWeatherContact(enc.contact)) traffic++;
        if (mode.resolve('ignore').outcome === 'arena') mode.resumeFrom(enc.contact.id);
      }
    }
    expect(arrived).toBe(true);
    total += count;
    max = Math.max(max, count);
    real += t;
  }
  return { mean: total / runs, traffic: traffic / runs, max, realSeconds: real / runs };
}

const report = (name: string, p: Pacing): void => {
  if (process.env['PACING_REPORT']) {
    process.stderr.write(
      `\n${name}: mean ${p.mean.toFixed(2)} (traffic ${p.traffic.toFixed(2)}), max ${p.max}, ${p.realSeconds.toFixed(1)} s`,
    );
  }
};

describe('encounter pacing', () => {
  it.each(Object.keys(ROUTES))('%s stays near 0–2 interruptions by default', SLOW, (name) => {
    const route = ROUTES[name] as (typeof ROUTES)[string];
    const pacing = sail(route, 'threatsAndPrizes', 100);
    report(`${name}, spring`, pacing);
    // The short hop is about 0.3 in May now the sim's wind and the calm floor shorten it.
    expect(pacing.mean).toBeGreaterThan(0.2);
    expect(pacing.mean).toBeLessThan(2.5);
    expect(pacing.max).toBeLessThanOrEqual(5);
  });

  it('gives an Apostles crossing about 2, and a short hop fewer (criterion 4)', SLOW, () => {
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

  it.each(Object.keys(ROUTES))('%s is busier in fall than in spring', SLOW, (name) => {
    const route = ROUTES[name] as (typeof ROUTES)[string];
    const spring = sail(route, 'threatsAndPrizes', 100, SPRING_DAY);
    report(`${name}, spring`, spring);
    const fall = sail(route, 'threatsAndPrizes', 100, FALL_DAY);
    report(`${name}, fall`, fall);
    // The traffic is busier in fall. Counting the weather too, spring's fog banks and
    // fall's quicker crossings in stronger wind bring the totals level.
    expect(fall.traffic).toBeGreaterThan(spring.traffic);
    expect(fall.mean).toBeLessThan(3);
  });

  it('reports less with a stricter lookout', SLOW, () => {
    const route = ROUTES['Duluth to the Apostles'] as (typeof ROUTES)[string];
    const all = sail(route, 'all', 60).mean;
    const prizes = sail(route, 'threatsAndPrizes', 60).mean;
    const threats = sail(route, 'threats', 60).mean;
    expect(all).toBeGreaterThanOrEqual(prizes);
    expect(prizes).toBeGreaterThan(threats);
  });
});
