import { describe, expect, it } from 'vitest';
import { SECONDS_PER_GAME_DAY } from '../src/core/time';
import { gameSecondsAt } from '../src/sim/ice/season';
import { snowAt, snowCover, winterAirAt, winterLookAt } from '../src/sim/ice/snow';
import {
  buildIceLut,
  buildShelterGrid,
  iceCalm,
  iceDayKey,
  lutSample,
  sampleShelterGrid,
} from '../src/sim/ice/zone-ice';
import { auroraAt, auroraCycleShare, auroraNight } from '../src/sim/weather/aurora';
import { createLocalWeather } from '../src/sim/weather/local-weather';
import { createSea } from '../src/sim/weather/waves';
import { applyWinterPalette } from '../src/render/style/winter-palette';
import { createLightingSample, sampleLighting } from '../src/render/style/lighting-luts';

const at = (iso: string): number => gameSecondsAt(Date.parse(`${iso}T12:00:00Z`));
const SEEDS = ['run-1', 'run-2', 'run-3', 'run-5', 'run-8'];

describe("winter's look: the snow on the ground (piece L)", () => {
  it('is white in February and gone by July, every winter', () => {
    for (const seed of SEEDS) {
      expect(snowAt(seed, at('1901-02-10')).cover01).toBeGreaterThan(0.5);
      expect(snowAt(seed, at('1901-07-15')).depthCm).toBe(0);
      expect(snowAt(seed, at('1900-08-01')).cover01).toBe(0);
    }
  });

  it('is deeper in a hard winter than a mild one', () => {
    // run-3 rolls the hardest winter of the five, run-8 the mildest (plan 04 §26).
    const hard = snowAt('run-3', at('1901-03-20')).depthCm;
    const mild = snowAt('run-8', at('1901-03-20')).depthCm;
    expect(hard).toBeGreaterThan(mild);
  });

  it('is a pure function of the seed and the date', () => {
    expect(snowAt('run-1', at('1901-01-05'))).toEqual(snowAt('run-1', at('1901-01-05')));
    expect(snowCover(0)).toBe(0);
    expect(snowCover(100)).toBe(1);
  });

  it('reads the winter air, and the look is summer in summer', () => {
    expect(winterAirAt('run-1', at('1900-08-01'))).toBeUndefined();
    expect(winterAirAt('run-1', at('1901-01-20'))).toBeLessThan(-3);
    expect(winterLookAt('run-1', at('1900-07-01'))).toBe(0);
    expect(winterLookAt('run-1', at('1901-01-20'))).toBeGreaterThan(0.7);
  });
});

describe('the aurora', () => {
  it('comes on some fall and winter nights, few in summer, by seed', () => {
    const count = (startIso: string, days: number): number => {
      const d0 = Math.floor(at(startIso) / SECONDS_PER_GAME_DAY);
      let n = 0;
      for (let d = d0; d < d0 + days; d++) if (auroraNight('run-1', d)) n++;
      return n;
    };
    // Each game day is a calendar week, so 60 game days span more than a year.
    expect(count('1900-09-01', 30)).toBeGreaterThan(0);
    const june = Math.floor(at('1901-06-15') / SECONDS_PER_GAME_DAY);
    expect(auroraNight('run-1', june)).toBeUndefined();
  });

  it('builds and fades inside its night', () => {
    const d0 = Math.floor(at('1900-10-01') / SECONDS_PER_GAME_DAY);
    let day = d0;
    while (!auroraNight('run-1', day)) day++;
    const n = auroraNight('run-1', day);
    if (!n) throw new Error('no night');
    expect(auroraAt('run-1', n.startAt - 60)).toBe(0);
    const mid = auroraAt('run-1', (n.startAt + n.endAt) / 2);
    expect(mid).toBeGreaterThan(0);
    expect(mid).toBeLessThanOrEqual(1);
    expect(auroraAt('run-1', n.endAt + 60)).toBe(0);
  });

  it('follows the sunspot cycle, peaking in 1906', () => {
    expect(auroraCycleShare(1906.1)).toBeCloseTo(1);
    expect(auroraCycleShare(1900.35)).toBeLessThan(0.6);
  });
});

describe("the zone's ice", () => {
  it('a lookup strip a calendar day: open in summer, sheltered water fast in February', () => {
    const summer = buildIceLut('run-1', at('1900-08-01'));
    expect(summer.maxCover).toBe(0);
    const feb = buildIceLut('run-1', at('1901-02-15'));
    expect(lutSample(feb, 1).kind).toBe('fast');
    expect(feb.data[(feb.samples.length - 1) * 4]).toBeGreaterThan(200);
    expect(feb.data[(feb.samples.length - 1) * 4 + 3]).toBe(255);
    expect(iceDayKey('run-1', at('1901-02-15'))).toBe(feb.key);
  });

  it('has floes at the break-up somewhere along the strip', () => {
    let found = false;
    for (let d = 0; d < 60 && !found; d++) {
      const lut = buildIceLut('run-3', at('1901-03-15') + (d * 86_400) / 7);
      found =
        lut.samples.some((s) => s.kind === 'floes') &&
        lut.data.some((v, i) => i % 4 === 2 && v > 0);
    }
    expect(found).toBe(true);
  });

  it('calms the sea under a sheet, less under floes, not at all in open water', () => {
    expect(iceCalm({ coverage: 0, thicknessCm: 0, kind: 'open' })).toBe(1);
    expect(iceCalm({ coverage: 1, thicknessCm: 30, kind: 'fast' })).toBeLessThan(0.1);
    const floes = iceCalm({ coverage: 0.6, thicknessCm: 20, kind: 'floes' });
    expect(floes).toBeGreaterThan(0.5);
    expect(floes).toBeLessThan(1);
  });

  it('samples a shelter grid over the zone bilinearly', () => {
    const g = buildShelterGrid({ minX: 0, maxX: 640, minZ: 0, maxZ: 320 }, (x) => x / 640);
    expect(g.width).toBe(20);
    expect(g.height).toBe(10);
    expect(sampleShelterGrid(g, 320, 100)).toBeCloseTo(0.5, 1);
    expect(sampleShelterGrid(g, -100, 0)).toBeLessThan(0.05);
  });

  it('the calm reaches the sea scale the ship floats on', () => {
    const weather = createLocalWeather();
    const sea = createSea();
    weather.tick(0, { x: 0, z: 0 }, sea);
    const before = weather.waveParams({ x: 0, z: 0 }).scale;
    weather.setSeaCalm(() => 0.1);
    weather.tick(1, { x: 0, z: 0 }, sea);
    expect(weather.waveParams({ x: 0, z: 0 }).scale).toBeCloseTo(before * 0.1, 1);
    weather.setSeaCalm(undefined);
    weather.tick(2, { x: 0, z: 0 }, sea);
    expect(weather.waveParams({ x: 0, z: 0 }).scale).toBeCloseTo(before, 5);
  });
});

describe('the winter palette', () => {
  it('pales the day sky and lifts the ground light with snow; nothing in summer', () => {
    const summer = createLightingSample();
    sampleLighting(30, { cloud01: 0, storm01: 0, fog01: 0 }, summer);
    const winter = createLightingSample();
    sampleLighting(30, { cloud01: 0, storm01: 0, fog01: 0 }, winter);
    applyWinterPalette(winter, 1, 1, 30);
    expect(winter.hemiGround.getHSL({ h: 0, s: 0, l: 0 }).l).toBeGreaterThan(
      summer.hemiGround.getHSL({ h: 0, s: 0, l: 0 }).l,
    );
    expect(winter.hemi).toBeGreaterThan(summer.hemi);
    const same = createLightingSample();
    sampleLighting(30, { cloud01: 0, storm01: 0, fog01: 0 }, same);
    applyWinterPalette(same, 0, 0, 30);
    expect(same.zenith.equals(summer.zenith)).toBe(true);
  });
});
