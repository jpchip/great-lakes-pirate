import { describe, expect, it } from 'vitest';
import type { Chart } from '../src/core/coords';
import {
  advanceWeather,
  createWeatherState,
  simWindAt,
  SQUALL_WIND_KN,
  squallAt,
  steadyWindAt,
  type WeatherState,
} from '../src/sim/weather/weather';

/** Plan 04 §5.3, polish: squalls blow as well as rain. */

const DAY = 86_400;

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
