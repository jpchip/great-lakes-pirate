import { describe, expect, it } from 'vitest';
import { SECONDS_PER_GAME_DAY } from '../src/core/time';
import { monthStats, runSeason } from '../src/debug/weather-sim/season';
import { CLIMATE_MONTHS, climateAt } from '../src/sim/weather/climate';
import { LAKE_CENTER } from '../src/sim/weather/geography';
import { airTempAt, createWeatherState } from '../src/sim/weather/weather';

/** The NOAA check (plan 04 §24): the sim against data/climate.json's observations. */

const observed = (month: string) => {
  const m = CLIMATE_MONTHS.find((c) => c.id === `climate.${month.toLowerCase()}`);
  if (!m) throw new Error(`No climate for ${month}`);
  return m.observed;
};

describe('climate data', () => {
  it('reads the normals from data/climate.json', () => {
    const jul = climateAt(new Date(Date.UTC(1900, 6, 15, 12)));
    // Madeline Island, July: 76.9 °F high, 55.9 °F low; Superior at 11 °C mid-month.
    expect(jul.airMaxC).toBeCloseTo(24.9, 0);
    expect(jul.airMinC).toBeCloseTo(13.3, 0);
    expect(jul.waterC).toBeCloseTo(11, 0);
  });

  it('swings the air between the normal low and high over a day', () => {
    const state = createWeatherState('climate-air');
    // With the systems cleared, only the normals and the day/night swing are left.
    state.systems = [];
    const day = 10 * SECONDS_PER_GAME_DAY;
    const temps = Array.from({ length: 24 }, (_, h) =>
      airTempAt(state, LAKE_CENTER, day + h * 3600),
    );
    const c = climateAt(new Date(Date.UTC(1900, 6, 23)));
    expect(Math.max(...temps)).toBeGreaterThan(c.airMaxC - 2.5);
    expect(Math.min(...temps)).toBeLessThan(c.airMinC + 2.5);
  });
});

describe('the sim against observed wind (Devils Island)', () => {
  const seeds = Array.from({ length: 8 }, (_, i) => `noaa-${i + 1}`);
  const runs = seeds.map((s) => runSeason(s, 30));
  const months = runs.flatMap((r) => monthStats(r, r.probes[0] as (typeof r.probes)[number]));
  const avg = (month: string, f: (m: (typeof months)[number]) => number) => {
    const list = months.filter((m) => m.month === month);
    return list.reduce((s, m) => s + f(m), 0) / list.length;
  };

  it.each(['May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov'])(
    'keeps the mean wind in %s near the observed mean',
    (month) => {
      expect(Math.abs(avg(month, (m) => m.meanWindKn) - observed(month).meanWindKn)).toBeLessThan(
        2.5,
      );
    },
  );

  it('leans stormy but within reason: gale time at most a few times observed', () => {
    // A deliberate lean toward gameplay (plan 04 §24): November gales should be met.
    for (const month of ['Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov']) {
      expect(avg(month, (m) => m.galeShare) * 100, month).toBeLessThan(
        6 * observed(month).over34KnPct + 1,
      );
    }
    expect(avg('Nov', (m) => m.galeShare)).toBeGreaterThan(avg('Aug', (m) => m.galeShare));
  });
});

describe('zone frame for the weather', () => {
  it("builds the bake's origin from the zone definition", async () => {
    const { APOSTLES_ID, defFrame, zoneDef } = await import('../src/sim/terrain/zones');
    expect(defFrame(zoneDef(APOSTLES_ID))).toEqual({
      origin: { x: -204_333, y: -73_945 },
      compression: 8,
    });
  });
});
