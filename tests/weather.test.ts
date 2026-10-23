import { describe, expect, it } from 'vitest';
import { SECONDS_PER_GAME_DAY, WORLD_TICK_GAME_SECONDS, dayAndHour } from '../src/core/time';
import { climateAt, monthPosition } from '../src/sim/weather/climate';
import { LAKE_CENTER, WESTERN_SUPERIOR, inPolygon } from '../src/sim/weather/geography';
import {
  MAX_FOG_BANKS,
  MAX_SYSTEMS,
  STANDARD_HPA,
  barometerTrend,
  createWeatherState,
  lifecycle,
  livingSystems,
  pressureAt,
  pressureTendency,
  visibilityAt,
  weatherTick,
  windAt,
  type PressureSystem,
  type WeatherState,
} from '../src/sim/weather/weather';
import { monthStats, runSeason, trendOutlook } from '../src/debug/weather-sim/season';

const HOUR = 3600;

function run(state: WeatherState, ticks: number): void {
  for (let i = 0; i < ticks; i++) {
    weatherTick(state, state.tickSeconds + WORLD_TICK_GAME_SECONDS);
  }
}

/** A calm state holding one mature system at the lake. */
function withSystem(kind: 'low' | 'high', peakHpa: number): WeatherState {
  const state = createWeatherState('calm');
  state.systems = [];
  state.fogBanks = [];
  const system: PressureSystem = {
    id: 1,
    kind,
    track: kind === 'low' ? 'pacific' : 'high',
    x: LAKE_CENTER.x,
    y: LAKE_CENTER.y,
    vx: 0,
    vy: 0,
    radius: 600_000,
    peakHpa,
    age: 50 * HOUR,
    life: 100 * HOUR,
  };
  state.systems.push(system);
  return state;
}

describe('climate normals', () => {
  it('puts each normal at mid-month', () => {
    expect(monthPosition(new Date(Date.UTC(1900, 10, 15, 12)))).toBeCloseTo(10, 1);
    expect(monthPosition(new Date(Date.UTC(1900, 0, 16, 12)))).toBeCloseTo(0, 1);
  });

  it('peaks storms in November and fog in early summer', () => {
    const nov = climateAt(new Date(Date.UTC(1900, 10, 15)));
    const jul = climateAt(new Date(Date.UTC(1900, 6, 15)));
    const jun = climateAt(new Date(Date.UTC(1900, 5, 15)));
    expect(nov.lowsPerDay * nov.deepShare).toBeGreaterThan(5 * jul.lowsPerDay * jul.deepShare);
    expect(jun.advectionFog).toBeGreaterThan(nov.advectionFog);
  });

  it('turns the prevailing wind the short way round between months', () => {
    // Late October sits between WNW (290°) and NW (315°): blowing toward the southeast.
    const c = climateAt(new Date(Date.UTC(1900, 9, 31)));
    expect(c.prevailingToKn.x).toBeGreaterThan(0);
    expect(c.prevailingToKn.y).toBeLessThan(0);
  });
});

describe('pressure systems', () => {
  it('deepen, hold and fill over their life', () => {
    expect(lifecycle(0, 10)).toBe(0);
    expect(lifecycle(5, 10)).toBe(1);
    expect(lifecycle(10, 10)).toBe(0);
    expect(lifecycle(-1, 10)).toBe(0);
    expect(lifecycle(2, 10)).toBeGreaterThan(0);
  });

  it('dips the barometer at a low and raises it at a high', () => {
    expect(pressureAt(withSystem('low', -20), LAKE_CENTER, 0)).toBeCloseTo(STANDARD_HPA - 20, 0);
    expect(pressureAt(withSystem('high', 12), LAKE_CENTER, 0)).toBeCloseTo(STANDARD_HPA + 12, 0);
  });

  it('blows counter-clockwise around a low and clockwise around a high', () => {
    const east = { x: LAKE_CENTER.x + 420_000, y: LAKE_CENTER.y };
    const low = windAt(withSystem('low', -30), east, 0);
    // East of a low the wind blows north, turned a little in toward the low.
    expect(low.toKn.y).toBeGreaterThan(Math.abs(low.toKn.x));
    expect(low.toKn.x).toBeLessThan(0);
    expect(low.speedKn).toBeGreaterThan(25);
    const high = windAt(withSystem('high', 20), east, 0);
    expect(high.toKn.y).toBeLessThan(0);
  });

  it('reports "from" directions the way sailors do', () => {
    const north = { x: LAKE_CENTER.x + 420_000, y: LAKE_CENTER.y };
    // East of a low the air moves north, so it's a southerly wind (from ≈ 180°).
    const w = windAt(withSystem('low', -30), north, 0);
    expect((w.fromRad * 180) / Math.PI).toBeGreaterThan(130);
    expect((w.fromRad * 180) / Math.PI).toBeLessThan(230);
  });

  it('caps sustained wind below hurricane force', () => {
    const state = withSystem('low', -60);
    for (let r = 100_000; r < 900_000; r += 50_000) {
      const w = windAt(state, { x: LAKE_CENTER.x + r, y: LAKE_CENTER.y }, 0);
      expect(w.speedKn).toBeLessThanOrEqual(60);
    }
  });

  it('shows a falling barometer as a low approaches', () => {
    const state = withSystem('low', -25);
    const s = state.systems[0] as PressureSystem;
    s.x -= 800_000;
    s.vx = 12;
    expect(pressureTendency(state, LAKE_CENTER, 0)).toBeLessThan(-1);
    expect(barometerTrend(pressureTendency(state, LAKE_CENTER, 0))).toMatch(/falling/);
  });

  it('classifies barometer tendencies', () => {
    expect(barometerTrend(-4)).toBe('falling fast');
    expect(barometerTrend(-1.5)).toBe('falling');
    expect(barometerTrend(0.3)).toBe('steady');
    expect(barometerTrend(1.5)).toBe('rising');
    expect(barometerTrend(3.5)).toBe('rising fast');
  });
});

describe('the weather tick', () => {
  it('is deterministic for a seed', () => {
    const a = createWeatherState('same');
    const b = createWeatherState('same');
    run(a, 500);
    run(b, 500);
    expect(a).toEqual(b);
    const c = createWeatherState('other');
    run(c, 500);
    expect(c.systems).not.toEqual(a.systems);
  });

  it('continues identically after a save and reload', () => {
    const straight = createWeatherState('reload');
    run(straight, 600);
    const saved = createWeatherState('reload');
    run(saved, 300);
    const loaded = JSON.parse(JSON.stringify(saved)) as WeatherState;
    run(loaded, 300);
    expect(loaded).toEqual(straight);
  });

  it('starts with weather already on the chart', () => {
    const state = createWeatherState('start');
    expect(state.tickSeconds).toBe(0);
    expect(state.systems.length).toBeGreaterThan(0);
  });

  it('reconstructs the past exactly for the barometer trend', () => {
    const state = createWeatherState('tendency');
    const lag = (3 * HOUR) / WORLD_TICK_GAME_SECONDS;
    const history: number[] = [];
    for (let i = 0; i < 1000; i++) {
      weatherTick(state, state.tickSeconds + WORLD_TICK_GAME_SECONDS);
      history.push(pressureAt(state, LAKE_CENTER, state.tickSeconds));
      if (i >= lag) {
        const actual = (history[i] as number) - (history[i - lag] as number);
        expect(pressureTendency(state, LAKE_CENTER, state.tickSeconds)).toBeCloseTo(actual, 1);
      }
    }
  });

  it('keeps within its system and fog-bank limits', () => {
    const state = createWeatherState('limits');
    for (let i = 0; i < 3000; i++) {
      weatherTick(state, state.tickSeconds + WORLD_TICK_GAME_SECONDS);
      expect(livingSystems(state)).toBeLessThanOrEqual(MAX_SYSTEMS);
      expect(state.fogBanks.length).toBeLessThanOrEqual(MAX_FOG_BANKS);
    }
  });

  it('forms advection fog over the lake and radiation fog at night', () => {
    const state = createWeatherState('fog');
    const seen = new Set<number>(state.fogBanks.map((b) => b.id));
    let advection = 0;
    let radiation = 0;
    for (let i = 0; i < 2000; i++) {
      weatherTick(state, state.tickSeconds + WORLD_TICK_GAME_SECONDS);
      for (const b of state.fogBanks) {
        if (seen.has(b.id)) continue;
        seen.add(b.id);
        if (b.kind === 'advection') {
          advection++;
          expect(inPolygon({ x: b.x, y: b.y }, WESTERN_SUPERIOR)).toBe(true);
        } else {
          radiation++;
          const { hour } = dayAndHour(state.tickSeconds);
          expect(hour >= 21 || hour < 6).toBe(true);
        }
      }
    }
    expect(advection).toBeGreaterThan(0);
    expect(radiation).toBeGreaterThan(0);
  });

  it('thickens visibility to a few hundred meters inside a mature bank', () => {
    const state = withSystem('high', 10);
    state.fogBanks.push({
      id: 9,
      kind: 'advection',
      x: LAKE_CENTER.x,
      y: LAKE_CENTER.y,
      vx: 0,
      vy: 0,
      radius: 10_000,
      coreVisibilityM: 200,
      age: 3 * HOUR,
      life: 10 * HOUR,
    });
    expect(visibilityAt(state, LAKE_CENTER, 0)).toBeCloseTo(200, 0);
    const edge = visibilityAt(state, { x: LAKE_CENTER.x + 7_000, y: LAKE_CENTER.y }, 0);
    expect(edge).toBeGreaterThan(200);
    expect(edge).toBeLessThan(25_000);
    expect(visibilityAt(state, { x: LAKE_CENTER.x + 20_000, y: LAKE_CENTER.y }, 0)).toBe(25_000);
  });
});

describe('a simulated season (prototype S9)', () => {
  const seeds = ['t1', 't2', 't3', 't4'];
  const runs = seeds.map((s) => runSeason(s, 30));
  const months = runs.flatMap((r) => monthStats(r, r.probes[0] as (typeof r.probes)[number]));
  const avg = (month: string, f: (m: (typeof months)[number]) => number) => {
    const list = months.filter((m) => m.month === month);
    return list.reduce((s, m) => s + f(m), 0) / list.length;
  };

  it('is windier in November than in July', () => {
    expect(avg('Nov', (m) => m.meanWindKn)).toBeGreaterThan(avg('Jul', (m) => m.meanWindKn) + 3);
    expect(avg('Nov', (m) => m.galeShare)).toBeGreaterThan(avg('Jul', (m) => m.galeShare));
  });

  it('is foggier in early summer than in late fall', () => {
    const early = avg('Jun', (m) => m.thickFogShare) + avg('Jul', (m) => m.thickFogShare);
    const late = avg('Oct', (m) => m.thickFogShare) + avg('Nov', (m) => m.thickFogShare);
    expect(early).toBeGreaterThan(late);
  });

  it('makes a fast-falling barometer a real storm warning', () => {
    const outlook = trendOutlook(runs.flatMap((r) => r.probes.slice(0, 1)));
    const fast = outlook.find((o) => o.trend === 'falling fast');
    const steady = outlook.find((o) => o.trend === 'steady');
    expect(fast?.stormShare ?? 0).toBeGreaterThan(2 * (steady?.stormShare ?? 1));
  });

  it('stays inside the world-tick budget', () => {
    // Plan 04 §14: ≤ 0.2 ms amortized. It runs at ~0.01 ms; the margin absorbs slow CI.
    const ms = runs.reduce((s, r) => s + r.tickMs, 0) / runs.reduce((s, r) => s + r.ticks, 0);
    expect(ms).toBeLessThan(0.2);
    expect(runs[0]?.ticks).toBe((30 * SECONDS_PER_GAME_DAY) / WORLD_TICK_GAME_SECONDS);
  });
});
