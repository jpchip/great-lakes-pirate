import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { chartFileSchema } from '../data/schemas/chart';
import { EventBus } from '../src/core/events';
import { InputMapper } from '../src/core/input';
import { Rng } from '../src/core/rng';
import { createGameWorld } from '../src/gameplay/ecs';
import { CHART_TIME_SCALE, createChartMode, type ChartSession } from '../src/modes/chart';
import type { GameContext, GameEvents } from '../src/modes/context';
import { buildGeography } from '../src/sim/chart/geography';
import { createContacts, type LookoutPref } from '../src/sim/chart/traffic';
import { PROTOTYPE_SCHOONER } from '../src/sim/chart/voyage';
import { createSea } from '../src/sim/weather/waves';
import { createWorldState } from '../src/sim/world-state';

/**
 * Prototype S8 pacing check (plan 03 §6.4: 0–2 meaningful encounters per typical
 * voyage). Sails each route from many seeds, hours and winds, answering every
 * encounter with "ignore" (or a quick arena and back), and counts interruptions.
 */

const geo = buildGeography(
  chartFileSchema.parse(
    JSON.parse(readFileSync(join(import.meta.dirname, '..', 'data', 'chart.json'), 'utf8')),
  ),
);
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
  'Duluth to Siskiwit Bay': { from: [46.8, -91.96], via: [[46.87, -91.1]] },
};

interface Pacing {
  mean: number;
  max: number;
  realSeconds: number;
}

function sail(route: (typeof ROUTES)[string], lookout: LookoutPref, runs: number): Pacing {
  let total = 0;
  let max = 0;
  let real = 0;
  for (let k = 0; k < runs; k++) {
    const state = createWorldState(`pacing-${k}`);
    state.environment.clock.gameSeconds = (k % 24) * 3600;
    const ctx: GameContext = {
      state,
      world: createGameWorld(),
      rng: Rng.fromState(state.environment.rng),
      input: new InputMapper(),
      events: new EventBus<GameEvents>(),
      sea: createSea([]),
    };
    const session: ChartSession = {
      geo,
      ship: PROTOTYPE_SCHOONER,
      position: at(...route.from),
      heading: 0,
      wind: { from: Rng.fromSeed(`wind-${k}`).range(0, Math.PI * 2), speedKn: 12 },
      contacts: createContacts(geo.projection, Rng.fromSeed(`traffic-${k}`)),
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

describe('encounter pacing', () => {
  it.each(Object.keys(ROUTES))('%s stays near 0–2 interruptions by default', (name) => {
    const route = ROUTES[name] as (typeof ROUTES)[string];
    const pacing = sail(route, 'threatsAndPrizes', 100);
    // The Duluth–Apostles corridor is the busiest lane; allow a little over the target.
    expect(pacing.mean).toBeGreaterThan(0.3);
    expect(pacing.mean).toBeLessThan(2.5);
    expect(pacing.max).toBeLessThanOrEqual(6);
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
