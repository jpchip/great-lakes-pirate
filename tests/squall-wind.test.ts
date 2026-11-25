import { describe, expect, it } from 'vitest';
import type { Chart } from '../src/core/coords';
import { westernSuperiorChart } from '../src/sim/chart/chart-data';
import { createChartSky, glassAt, pressureCentres } from '../src/sim/chart/chart-weather';
import { CHART_TIME_SCALE } from '../src/modes/chart';
import { PROTOTYPE_SCHOONER } from '../src/sim/chart/voyage';
import { fromWorldChart } from '../src/sim/chart/geography';
import {
  advanceWeather,
  barometerAt,
  createWeatherState,
  simWindAt,
  SQUALL_WIND_KN,
  squallAt,
  steadyWindAt,
  type WeatherState,
} from '../src/sim/weather/weather';
import { toWorldChart } from '../src/sim/chart/geography';
import { chartHud } from '../src/ui/chart/model';

/** Plan 04 §5.3 and §12, polish: squalls blow, and the chart reads the glass on hover. */

const DAY = 86_400;
const geo = westernSuperiorChart();

/** The first squall core found over the lake in July, by seed: its state, point and time. */
function findSquall(minSquall: number): { state: WeatherState; p: Chart; t: number } {
  for (let seed = 1; seed < 40; seed++) {
    const state = createWeatherState(`squall-${seed}`);
    // July: the game's day 8 onward is high summer (each game day is a calendar week).
    for (let t = 8 * DAY; t < 12 * DAY; t += 3 * 3600) {
      advanceWeather(state, t);
      for (let x = -60_000; x <= 60_000; x += 6_000) {
        for (let y = -40_000; y <= 40_000; y += 6_000) {
          const p = { x, y };
          if (squallAt(state, p, t) >= minSquall) return { state, p, t };
        }
      }
    }
  }
  throw new Error('no squall found');
}

describe('squalls blow as well as rain', () => {
  const { state, p, t } = findSquall(0.85);

  it('lifts the wind and makes it gusty in the heart of a squall', () => {
    const steady = steadyWindAt(state, p, t);
    const w = simWindAt(state, p, t);
    expect(w.gustiness).toBeGreaterThan(0.85);
    if (steady.speedKn < 12) {
      expect(w.speedKn).toBeGreaterThan(steady.speedKn + 0.5 * SQUALL_WIND_KN);
    } else {
      expect(w.speedKn).toBeGreaterThanOrEqual(steady.speedKn);
    }
  });

  it('leaves the wind alone away from squalls', () => {
    for (let x = -60_000; x <= 60_000; x += 20_000) {
      const q = { x, y: 60_000 };
      if (squallAt(state, q, t) > 0) continue;
      expect(simWindAt(state, q, t).speedKn).toBeCloseTo(steadyWindAt(state, q, t).speedKn, 6);
    }
  });
});

describe("the chart's glass on hover", () => {
  const state = createWeatherState('glass-hover');
  const t = 20 * DAY;
  advanceWeather(state, t);

  it('reads the barometer at the pointer, at the hour the chart shows', () => {
    const p = fromWorldChart(geo, { x: 10_000, y: 5_000 });
    const g = glassAt(state, geo, p, t);
    expect(g.barometer.hpa).toBeCloseTo(barometerAt(state, toWorldChart(geo, p), t).hpa, 6);
  });

  it("names a low or high when the pointer is on its centre, with where it's going", () => {
    const centres = pressureCentres(state, geo, t);
    expect(centres.length).toBeGreaterThan(0);
    const c = centres[0]!;
    const g = glassAt(state, geo, c.pos, t);
    expect(g.centre?.id).toBe(c.id);
    const hud = chartHud({
      session: {
        geo,
        ship: PROTOTYPE_SCHOONER,
        position: c.pos,
        heading: 0,
        wind: { from: 0, speedKn: 10 },
        contacts: [],
        sky: createChartSky(state),
        waypoints: [],
        course: undefined,
        voyage: undefined,
        lookout: 'threatsAndPrizes',
        timeScale: CHART_TIME_SCALE,
        pending: undefined,
        handled: new Set(),
        quietUntil: 0,
      },
      trip: 'look',
      gameSeconds: t,
      backLabel: undefined,
      notice: undefined,
      locked: false,
      pointer: { at: c.pos, x: 200, y: 100 },
    });
    expect(hud.weather?.hover?.text).toMatch(
      c.kind === 'low' ? /^Low \d\d\.\d\d/ : /^High \d\d\.\d\d/,
    );
    expect(hud.weather?.hover?.x).toBe(200);
  });
});
