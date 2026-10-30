import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { SECONDS_PER_GAME_DAY } from '../src/core/time';
import { createLightning, flashAt } from '../src/render/atmosphere/lightning';
import { createRain } from '../src/render/atmosphere/rain';
import {
  LIGHTING_LUTS,
  createLightingSample,
  fogAmount,
  sampleLighting,
  type LutColumn,
} from '../src/render/style/lighting-luts';
import { LAKE_CENTER } from '../src/sim/weather/geography';
import {
  createWeatherState,
  fogBanksAt,
  placeFogBank,
  thunderstormAt,
  type PressureSystem,
  type WeatherState,
} from '../src/sim/weather/weather';

const HOUR = 3600;
const JULY = 70 * SECONDS_PER_GAME_DAY;
const JANUARY = 250 * SECONDS_PER_GAME_DAY;

/** A calm state at time `t` holding one deep, mature low over the lake. */
function stormy(t: number): WeatherState {
  const state = createWeatherState('storm-test', t);
  state.systems = [];
  state.fogBanks = [];
  const low: PressureSystem = {
    id: 1,
    kind: 'low',
    track: 'pacific',
    x: LAKE_CENTER.x,
    y: LAKE_CENTER.y,
    vx: 0,
    vy: 0,
    radius: 600_000,
    peakHpa: -28,
    age: 50 * HOUR,
    life: 100 * HOUR,
  };
  state.systems.push(low);
  return state;
}

describe('lighting LUTs', () => {
  it('has the same elevation rows in every column, in order', () => {
    const rows = (c: LutColumn): number[] => LIGHTING_LUTS[c].map((k) => k.at);
    const clear = rows('clear');
    expect([...clear].sort((a, b) => a - b)).toEqual(clear);
    for (const c of ['overcast', 'storm', 'fog'] as const) expect(rows(c)).toEqual(clear);
  });

  it('gets darker toward the night and under a storm', () => {
    const day = createLightingSample();
    const night = createLightingSample();
    const storm = createLightingSample();
    sampleLighting(40, { cloud01: 0, storm01: 0, fog01: 0 }, day);
    sampleLighting(-30, { cloud01: 0, storm01: 0, fog01: 0 }, night);
    sampleLighting(40, { cloud01: 1, storm01: 1, fog01: 0 }, storm);
    expect(night.horizon.getHex()).not.toBe(day.horizon.getHex());
    expect(night.hemi).toBeLessThan(day.hemi);
    expect(storm.hemi).toBeLessThan(day.hemi);
    expect(storm.zenith.r + storm.zenith.g + storm.zenith.b).toBeLessThan(
      day.zenith.r + day.zenith.g + day.zenith.b,
    );
  });

  it('leaves scattered cloud blue and turns a full deck overcast', () => {
    const clear = createLightingSample();
    const scattered = createLightingSample();
    const deck = createLightingSample();
    sampleLighting(30, { cloud01: 0, storm01: 0, fog01: 0 }, clear);
    sampleLighting(30, { cloud01: 0.2, storm01: 0, fog01: 0 }, scattered);
    sampleLighting(30, { cloud01: 1, storm01: 0, fog01: 0 }, deck);
    expect(scattered.zenith.getHex()).toBe(clear.zenith.getHex());
    expect(deck.zenith.getHex()).not.toBe(clear.zenith.getHex());
  });

  it('holds a thick fog to 80% so the time of day still shows', () => {
    const fog = createLightingSample();
    const column = createLightingSample();
    sampleLighting(30, { cloud01: 0, storm01: 0, fog01: 1 }, fog);
    sampleLighting(30, { cloud01: 0, storm01: 0, fog01: 0 }, column);
    expect(fog.horizon.getHex()).not.toBe(column.horizon.getHex());
  });

  it('measures fog from the visibility: none at 15 km, full at 2 km', () => {
    expect(fogAmount(15_000)).toBe(0);
    expect(fogAmount(40_000)).toBe(0);
    expect(fogAmount(2_000)).toBeCloseTo(1, 6);
    expect(fogAmount(150)).toBe(1);
    expect(fogAmount(5_000)).toBeGreaterThan(fogAmount(9_000));
  });
});

describe('thunderstorms', () => {
  const grid = (state: WeatherState): number[] => {
    const out: number[] = [];
    for (let i = -10; i <= 10; i++) {
      for (let j = -10; j <= 10; j++) {
        const p = { x: LAKE_CENTER.x + i * 30_000, y: LAKE_CENTER.y + j * 30_000 };
        out.push(thunderstormAt(state, p, state.tickSeconds));
      }
    }
    return out;
  };

  it('builds cells under a summer low', () => {
    const cells = grid(stormy(JULY));
    expect(Math.max(...cells)).toBeGreaterThan(0.3);
    for (const v of cells) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
    }
  });

  it('has none in winter, however deep the low', () => {
    expect(Math.max(...grid(stormy(JANUARY)))).toBe(0);
  });

  it('has none without rain', () => {
    const state = createWeatherState('dry', JULY);
    state.systems = [];
    state.fogBanks = [];
    expect(Math.max(...grid(state))).toBe(0);
  });
});

describe('placed fog banks', () => {
  it('stands at full strength where it was put and fades out over its life', () => {
    const state = createWeatherState('bank', 0);
    state.fogBanks = [];
    const bank = placeFogBank(state, { x: 1000, y: 2000 }, { radiusM: 6000, kind: 'radiation' });
    expect(state.fogBanks).toContain(bank);
    const [now] = fogBanksAt(state, 0);
    expect(now).toMatchObject({ kind: 'radiation', x: 1000, y: 2000, radius: 6000, strength: 1 });
    expect(fogBanksAt(state, bank.life * 2)).toEqual([]);
  });

  it('makes room by dropping the oldest instead of refusing', () => {
    const state = createWeatherState('bank', 0);
    state.fogBanks = [];
    const first = placeFogBank(state, { x: 0, y: 0 });
    for (let i = 0; i < 40; i++) placeFogBank(state, { x: i, y: 0 });
    expect(state.fogBanks).not.toContain(first);
    expect(state.fogBanks.length).toBeLessThanOrEqual(40);
  });
});

describe('lightning', () => {
  it('flashes hard, flickers back weaker, and is out inside a second', () => {
    expect(flashAt(-0.1)).toBe(0);
    expect(flashAt(0)).toBe(1);
    expect(flashAt(0.1)).toBeLessThan(flashAt(0.01));
    expect(flashAt(0.17)).toBeGreaterThan(flashAt(0.15));
    expect(flashAt(0.9)).toBe(0);
  });

  it('is the same storm for the same seed, and tells its listeners where it struck', () => {
    const run = (): { bearingRad: number; distanceM: number; toWater: boolean }[] => {
      const lightning = createLightning(7);
      const seen: { bearingRad: number; distanceM: number; toWater: boolean }[] = [];
      lightning.onStrike((s) => seen.push(s));
      const camera = new THREE.Vector3();
      for (let i = 0; i < 600; i++) lightning.update(0.1, 1, 1, camera);
      return seen;
    };
    const a = run();
    expect(a.length).toBeGreaterThan(3);
    expect(run()).toEqual(a);
    for (const s of a) {
      expect(s.distanceM).toBeGreaterThanOrEqual(900);
      expect(s.distanceM).toBeLessThanOrEqual(6500);
    }
  });

  it('stays quiet in fair weather', () => {
    const lightning = createLightning(7);
    for (let i = 0; i < 600; i++) lightning.update(0.1, 0, 0, new THREE.Vector3());
    expect(lightning.strikes).toBe(0);
    expect(lightning.flash01).toBe(0);
  });
});

describe('rain', () => {
  const camera = new THREE.Vector3(0, 10, 0);
  const slant = { x: 2, z: 0 };

  it('draws streaks in proportion to the rain, none when dry', () => {
    const rain = createRain(1000);
    rain.update(camera, 0, slant, 1, 0);
    expect(rain.drawn).toBe(0);
    expect(rain.lines.visible).toBe(false);
    rain.update(camera, 0.5, slant, 1, 0);
    expect(rain.drawn).toBe(500);
    rain.update(camera, 1, slant, 1, 0);
    expect(rain.drawn).toBe(1000);
    expect(rain.lines.visible).toBe(true);
    rain.dispose();
  });

  it('follows the preset capacity', () => {
    const rain = createRain(1000);
    rain.setCapacity(0);
    rain.update(camera, 1, slant, 1, 0);
    expect(rain.drawn).toBe(0);
    rain.setCapacity(250);
    rain.update(camera, 1, slant, 1, 0);
    expect(rain.drawn).toBe(250);
    rain.dispose();
  });
});
