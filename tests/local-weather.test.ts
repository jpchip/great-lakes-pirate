import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { zoneToChart } from '../src/core/coords';
import { R_SAILING, SECONDS_PER_GAME_DAY } from '../src/core/time';
import { buoyancySystem, schoonerBuoyancy } from '../src/gameplay/buoyancy';
import { cloneTransform, createGameWorld } from '../src/gameplay/ecs';
import { LATITUDE_RAD, moonAt, moonPhase, sunAt } from '../src/sim/weather/celestial';
import {
  GALE_SCRIPT,
  createLocalWeather,
  galeAt,
  weatherPreset,
} from '../src/sim/weather/local-weather';
import {
  bakeSeaScale,
  createSeaScaleBaker,
  easeSeaShape,
  localSeaScale,
  retuneSea,
  targetSeaShape,
  waveSet,
  windSea,
} from '../src/sim/weather/sea-state';
import { OPEN_WATER, TEST_BAY_ISLANDS, stubIslandShelter } from '../src/sim/weather/shelter';
import {
  GAMEPLAY_WAVES,
  MAX_TOTAL_STEEPNESS,
  createSea,
  displacementAt,
  heightAt,
  sampleSeaScale,
  seaScaleAt,
  uniformSeaScale,
} from '../src/sim/weather/waves';
import {
  barometerAt,
  createWeatherState,
  simWindAt,
  visibilityAt,
} from '../src/sim/weather/weather';

const DEG = Math.PI / 180;
const island = TEST_BAY_ISLANDS[0] ?? { x: 700, z: -350, radius: 220, height: 55 };
const field = stubIslandShelter(TEST_BAY_ISLANDS);

/** A point `d` meters downwind of the island's center for a wind from `fromDeg`. */
function downwind(fromDeg: number, d: number): { x: number; z: number } {
  const ux = Math.sin(fromDeg * DEG);
  const uz = -Math.cos(fromDeg * DEG);
  return { x: island.x - ux * d, z: island.z - uz * d };
}

describe('windAt (plan 02 §11 contract)', () => {
  it('returns the S9 Wind shape with fromRad clockwise from north', () => {
    const weather = createLocalWeather({ ...weatherPreset('moderate'), driftDeg: 0, surge: 0 });
    weather.settings.fromDeg = 90;
    const wind = weather.windAt({ x: 0, z: 0 }, 0);
    expect(wind.fromRad).toBeCloseTo(Math.PI / 2);
    expect(wind.speedKn).toBeCloseTo(14);
    // An east wind blows toward the west.
    expect(wind.toKn.x).toBeCloseTo(-14);
    expect(wind.toKn.y).toBeCloseTo(0);
  });

  it('drifts slowly in direction and speed within the panel limits', () => {
    const weather = createLocalWeather(weatherPreset('moderate'));
    const s = weather.settings;
    let maxVeer = 0;
    for (let t = 0; t < 2 * SECONDS_PER_GAME_DAY; t += 600) {
      const w = weather.windAt({ x: 0, z: 0 }, t);
      let d = Math.abs(w.fromRad / DEG - s.fromDeg);
      d = Math.min(d, 360 - d);
      maxVeer = Math.max(maxVeer, d);
      expect(w.speedKn).toBeGreaterThanOrEqual(s.speedKn * (1 - s.surge) - 1e-9);
      expect(w.speedKn).toBeLessThanOrEqual(s.speedKn * (1 + s.surge) + 1e-9);
    }
    expect(maxVeer).toBeGreaterThan(2);
    expect(maxVeer).toBeLessThanOrEqual(s.driftDeg + 1e-9);
    // One gameplay tick moves the direction by a hair, not a jump.
    const a = weather.windAt({ x: 0, z: 0 }, 5000);
    const b = weather.windAt({ x: 0, z: 0 }, 5000 + R_SAILING / 30);
    expect(Math.abs(a.fromRad - b.fromRad)).toBeLessThan(0.001);
  });

  it('keeps gusts out of speedKn and in 0–1, lasting a few real seconds', () => {
    const weather = createLocalWeather(weatherPreset('fresh'));
    let peaks = 0;
    let last = 0;
    for (let t = 0; t < 3600; t += 1) {
      const w = weather.windAt({ x: 0, z: 0 }, t);
      expect(w.gust01).toBeGreaterThanOrEqual(0);
      expect(w.gust01).toBeLessThanOrEqual(1);
      if (w.gust01 > 0.4 && last <= 0.4) peaks++;
      last = w.gust01;
    }
    // A game hour (2.5 real minutes) has several distinct gusts.
    expect(peaks).toBeGreaterThan(3);
  });

  it('has no gusts in a calm', () => {
    const weather = createLocalWeather({ ...weatherPreset('calm'), speedKn: 0.5 });
    for (let t = 0; t < 3600; t += 7) {
      expect(weather.windAt({ x: 0, z: 0 }, t).gust01).toBeLessThan(0.1);
    }
  });

  it('drops in the lee of an island and recovers downwind', () => {
    const weather = createLocalWeather(
      { ...weatherPreset('moderate'), driftDeg: 0, surge: 0, fromDeg: 315 },
      field,
    );
    const open = weather.windAt(downwind(315, -800), 0);
    const nearLee = weather.windAt(downwind(315, island.radius + 60), 0);
    const farLee = weather.windAt(downwind(315, island.radius + island.height * 12), 0);
    const beyond = weather.windAt(downwind(315, island.radius + island.height * 20), 0);
    expect(open.shelter01).toBe(0);
    expect(nearLee.speedKn).toBeLessThan(open.speedKn * 0.4);
    expect(farLee.speedKn).toBeGreaterThan(nearLee.speedKn);
    expect(farLee.speedKn).toBeLessThan(open.speedKn);
    expect(beyond.speedKn).toBeCloseTo(open.speedKn);
    // The lee is on the downwind side only: turn the wind and the same spot is open.
    const turned = weather.windAt(downwind(315, island.radius + 60), 0);
    weather.settings.fromDeg = 135;
    expect(weather.windAt(downwind(315, island.radius + 60), 0).speedKn).toBeGreaterThan(
      turned.speedKn * 2,
    );
  });

  it('speeds up in a funneling channel', () => {
    const channel = { ...OPEN_WATER, funnelAt: () => 1 };
    const weather = createLocalWeather(
      { ...weatherPreset('moderate'), driftDeg: 0, surge: 0 },
      channel,
    );
    expect(weather.windAt({ x: 0, z: 0 }, 0).speedKn).toBeCloseTo(14 * 1.3);
  });
});

describe('scripted gale', () => {
  it('builds past 40 kn within a few real minutes, veers northwest, and ends', () => {
    const minutes = (m: number): number => m * 60 * R_SAILING;
    expect(galeAt(0)?.speedKn).toBeCloseTo(14);
    expect(galeAt(minutes(3))?.speedKn ?? 0).toBeGreaterThanOrEqual(38);
    expect(galeAt(minutes(6))?.speedKn ?? 0).toBeGreaterThan(40);
    const back = galeAt(minutes(8.5));
    expect(back?.fromDeg ?? 0).toBeGreaterThan(300);
    const last = GALE_SCRIPT[GALE_SCRIPT.length - 1];
    expect(galeAt(minutes((last?.atMin ?? 0) + 0.1))).toBeUndefined();
  });

  it('turns the short way round between keys', () => {
    // 35° to 330° should back through north, never swing through south.
    for (let m = 6; m <= 8; m += 0.1) {
      const from = galeAt(m * 60 * R_SAILING)?.fromDeg ?? 0;
      const wrapped = ((from % 360) + 360) % 360;
      expect(wrapped < 40 || wrapped > 325).toBe(true);
    }
  });

  it('drives windAt and hands back to the panel when it ends', () => {
    const weather = createLocalWeather({ ...weatherPreset('moderate'), driftDeg: 0, surge: 0 });
    const sea = createSea();
    weather.startGale(1000);
    expect(weather.windAt({ x: 0, z: 0 }, 1000 + 6 * 60 * R_SAILING).speedKn).toBeGreaterThan(40);
    weather.tick(1000 + 12 * 60 * R_SAILING, { x: 0, z: 0 }, sea);
    expect(weather.galeActive).toBe(false);
    expect(weather.settings.fromDeg).toBe(315);
    expect(weather.settings.speedKn).toBe(20);
  });
});

describe('waves from wind (plan 04 §6)', () => {
  it('raises a fetch-limited lake sea of believable size', () => {
    const fresh = windSea(20, 60_000);
    expect(fresh.hsM).toBeGreaterThan(1);
    expect(fresh.hsM).toBeLessThan(1.6);
    expect(fresh.peakPeriodS).toBeGreaterThan(4.5);
    expect(fresh.peakPeriodS).toBeLessThan(6);
    const gale = windSea(45, 200_000);
    expect(gale.hsM).toBeGreaterThan(4);
    expect(gale.hsM).toBeLessThan(7);
    expect(windSea(0, 60_000).hsM).toBe(0);
  });

  it('grows with wind and fetch, never past a fully developed sea', () => {
    fc.assert(
      fc.property(
        fc.double({ min: 1, max: 60, noNaN: true }),
        fc.double({ min: 100, max: 600_000, noNaN: true }),
        (kn, fetch) => {
          const a = windSea(kn, fetch);
          expect(windSea(kn * 1.1, fetch).hsM).toBeGreaterThanOrEqual(a.hsM);
          expect(windSea(kn, fetch * 1.1).hsM).toBeGreaterThanOrEqual(a.hsM * (1 - 1e-12));
          const u = (kn * 1852) / 3600;
          expect(a.hsM).toBeLessThanOrEqual(((0.243 * u * u) / 9.81) * (1 + 1e-9));
        },
      ),
    );
  });

  it('maps the shape to 8 waves whose height matches Hs, sorted by size', () => {
    const shape = targetSeaShape(20, 315 * DEG, 60_000);
    const waves = waveSet(shape);
    expect(waves).toHaveLength(8);
    const sigma = Math.sqrt(waves.reduce((s, w) => s + w.amplitude ** 2, 0) / 2);
    expect(4 * sigma).toBeCloseTo(shape.hsM);
    for (let i = 1; i < waves.length; i++) {
      expect(waves[i]?.amplitude ?? 0).toBeLessThan(waves[i - 1]?.amplitude ?? 0);
    }
    // Travels downwind: from the northwest means toward the southeast.
    expect(waves[0]?.direction).toBeCloseTo(135 * DEG);
  });

  it('stays loop-free in the worst gale', () => {
    const sea = createSea();
    retuneSea(sea, waveSet(targetSeaShape(60, 0, 600_000, 2.5)), 0, 0);
    const total = sea.waves.reduce((s, w) => s + w.steepness, 0);
    expect(total).toBeLessThanOrEqual(MAX_TOTAL_STEEPNESS + 1e-9);
  });

  it('lags the wind: the sea builds over game hours', () => {
    const calm = targetSeaShape(8, 0, 60_000);
    const gale = targetSeaShape(40, 0, 60_000);
    const tau = 45 * 60;
    let shape = calm;
    for (let t = 0; t < tau; t += 60) shape = easeSeaShape(shape, gale, 60, tau);
    const fraction = (shape.hsM - calm.hsM) / (gale.hsM - calm.hsM);
    expect(fraction).toBeGreaterThan(0.55);
    expect(fraction).toBeLessThan(0.7);
    expect(easeSeaShape(calm, gale, 1, 0).hsM).toBe(gale.hsM);
  });

  it('turns the sea the short way round', () => {
    const a = { hsM: 1, peakWavelengthM: 30, towardRad: 350 * DEG };
    const b = { hsM: 1, peakWavelengthM: 30, towardRad: 10 * DEG };
    const next = easeSeaShape(a, b, 60, 600);
    const deg = next.towardRad / DEG;
    expect(deg > 350 || deg < 10).toBe(true);
  });

  it('retunes without the surface jumping at the anchor', () => {
    const sea = createSea();
    sea.time = 1234.5;
    const anchor = { x: 180, z: -95 };
    retuneSea(sea, waveSet(targetSeaShape(15, 300 * DEG, 60_000)), anchor.x, anchor.z);
    const before = displacementAt(sea.waves, 8, anchor.x, anchor.z, sea.time);
    // A small step in wind speed and direction, as one tick of easing makes.
    retuneSea(sea, waveSet(targetSeaShape(15.2, 301 * DEG, 60_000)), anchor.x, anchor.z);
    const after = displacementAt(sea.waves, 8, anchor.x, anchor.z, sea.time);
    expect(Math.abs(after.dy - before.dy)).toBeLessThan(0.02);
    expect(sea.wavesVersion).toBe(2);
  });
});

describe('local sea scale: shelter and fetch', () => {
  it('calms the lee and short fetch, and never passes the cap', () => {
    expect(localSeaScale(0, 60_000, 60_000)).toBeCloseTo(1);
    expect(localSeaScale(1, 60_000, 60_000)).toBeCloseTo(0.2);
    expect(localSeaScale(0, 15_000, 60_000)).toBeCloseTo(0.5);
    expect(localSeaScale(0, 1e9, 60_000)).toBeCloseTo(1.25);
    expect(localSeaScale(0, 0, 60_000)).toBeCloseTo(0.15);
  });

  it('samples the grid bilinearly between texel centers and clamps at the edges', () => {
    const grid = {
      minX: 0,
      minZ: 0,
      cellM: 10,
      width: 2,
      height: 2,
      data: new Uint8Array([0, 200, 0, 200]),
    };
    expect(sampleSeaScale(grid, 5, 5)).toBeCloseTo(0);
    expect(sampleSeaScale(grid, 15, 5)).toBeCloseTo(1);
    expect(sampleSeaScale(grid, 10, 5)).toBeCloseTo(0.5);
    expect(sampleSeaScale(grid, -100, 5)).toBeCloseTo(0);
    expect(sampleSeaScale(grid, 100, 100)).toBeCloseTo(1);
    expect(sampleSeaScale(uniformSeaScale(), 1e6, -1e6)).toBe(1);
  });

  it('bakes a calm lee behind the island', () => {
    const { grid, referenceFetchM } = bakeSeaScale(field, 315 * DEG);
    expect(referenceFetchM).toBeGreaterThan(30_000);
    const sea = { ...createSea(), scale: grid };
    const open = downwind(315, -800);
    const lee = downwind(315, island.radius + 120);
    expect(seaScaleAt(sea, open.x, open.z)).toBeGreaterThan(0.9);
    expect(seaScaleAt(sea, lee.x, lee.z)).toBeLessThan(0.35);
  });

  it('bakes a few rows per tick to the same grid as a bake all at once', () => {
    const whole = bakeSeaScale(field, 40 * DEG);
    const baker = createSeaScaleBaker(field, 40 * DEG);
    let steps = 1;
    let bake = baker.step(16);
    while (!bake) {
      bake = baker.step(16);
      steps++;
    }
    expect(steps).toBe(Math.ceil(whole.grid.height / 16));
    expect(bake.referenceFetchM).toBe(whole.referenceFetchM);
    expect(Array.from(bake.grid.data)).toEqual(Array.from(whole.grid.data));
  });

  it('rebakes the lee when the wind turns', () => {
    const weather = createLocalWeather(
      { ...weatherPreset('moderate'), driftDeg: 0, surge: 0, fromDeg: 315 },
      field,
    );
    const sea = createSea();
    weather.tick(0, { x: 0, z: 0 }, sea);
    expect(sea.scaleVersion).toBe(1);
    const spot = downwind(135, island.radius + 120);
    expect(seaScaleAt(sea, spot.x, spot.z)).toBeGreaterThan(0.9);
    weather.settings.fromDeg = 135;
    for (let i = 1; i < 40; i++) weather.tick(i, { x: 0, z: 0 }, sea);
    expect(sea.scaleVersion).toBe(2);
    expect(seaScaleAt(sea, spot.x, spot.z)).toBeLessThan(0.35);
  });

  it('scales wave height and buoyancy the same way', () => {
    const sea = createSea();
    sea.time = 50;
    const full = heightAt(sea.waves, GAMEPLAY_WAVES, 30, 40, sea.time);
    const half = heightAt(sea.waves, GAMEPLAY_WAVES, 30, 40, sea.time, 3, 0.5);
    // Not exactly half, since the horizontal motion shrinks too, but close.
    expect(Math.abs(half - full / 2)).toBeLessThan(0.15);
    expect(heightAt(sea.waves, GAMEPLAY_WAVES, 30, 40, sea.time, 3, 0)).toBeCloseTo(0);
  });

  it('rides calmer in the lee: a schooner heaves less there', () => {
    const run = (x: number, z: number): number => {
      const weather = createLocalWeather(
        { ...weatherPreset('strong'), fromDeg: 315, seaLagMin: 0 },
        field,
      );
      const sea = createSea();
      const world = createGameWorld();
      const transform = { position: { x, y: 0, z }, heading: 0.3 };
      world.add({
        transform,
        previousTransform: cloneTransform(transform),
        buoyancy: schoonerBuoyancy(),
      });
      let range = 0;
      for (let i = 0; i < 30 * 60; i++) {
        sea.time += 1 / 30;
        weather.tick(sea.time * R_SAILING, { x, z }, sea);
        buoyancySystem(world, sea, 1 / 30);
        if (i > 300) range = Math.max(range, Math.abs(transform.position.y));
      }
      return range;
    };
    const open = downwind(315, -800);
    const lee = downwind(315, island.radius + 120);
    expect(run(lee.x, lee.z)).toBeLessThan(run(open.x, open.z) * 0.5);
  });
});

describe('sun and moon (plan 04 §3.4)', () => {
  const at = (dayOfCalendar: Date, hour: number): number => {
    // Game day d covers calendar days 7d..7d+6 from May 7, 1900.
    const days = (dayOfCalendar.getTime() - Date.UTC(1900, 4, 7)) / 86_400_000;
    return Math.floor(days / 7) * SECONDS_PER_GAME_DAY + hour * 3600;
  };

  it('stands about 66.6° high at noon near the summer solstice, due south', () => {
    const sun = sunAt(at(new Date(Date.UTC(1900, 5, 21)), 12));
    expect(sun.elevationRad / DEG).toBeCloseTo(90 - 46.8 + 23.4, 0);
    expect(sun.azimuthRad / DEG).toBeCloseTo(180, 0);
    expect(sun.direction.z).toBeGreaterThan(0.3);
  });

  it('gives June about 15.5 hours of daylight and rises in the northeast', () => {
    const day = at(new Date(Date.UTC(1900, 5, 21)), 0);
    let lit = 0;
    let sunrise: number | undefined;
    for (let m = 0; m < 24 * 60; m++) {
      const sun = sunAt(day + m * 60);
      if (sun.elevationRad > -0.833 * DEG) {
        lit++;
        if (sunrise === undefined) sunrise = sun.azimuthRad / DEG;
      }
    }
    expect(lit / 60).toBeGreaterThan(15);
    expect(lit / 60).toBeLessThan(16.2);
    expect(sunrise ?? 0).toBeGreaterThan(40);
    expect(sunrise ?? 0).toBeLessThan(65);
  });

  it('is below the horizon at midnight and rises in the east', () => {
    expect(sunAt(6 * 3600 - 1800).elevationRad).toBeLessThan(0.2);
    expect(sunAt(0).elevationRad).toBeLessThan(0);
    const morning = sunAt(9 * 3600);
    expect(morning.azimuthRad / DEG).toBeGreaterThan(70);
    expect(morning.azimuthRad / DEG).toBeLessThan(150);
  });

  it('has the right 1900 moon phases', () => {
    // Full moon 1900-05-14, new moon 1900-05-28 (published tables).
    expect(moonPhase(new Date(Date.UTC(1900, 4, 14, 12)))).toBeCloseTo(0.5, 1);
    const fresh = moonPhase(new Date(Date.UTC(1900, 4, 28, 12)));
    expect(Math.min(fresh, 1 - fresh)).toBeLessThan(0.05);
  });

  it('puts the full moon opposite the sun', () => {
    // Find a game time near full moon at midnight.
    let best = 0;
    let bestPhase = 0;
    for (let d = 0; d < 6; d++) {
      const t = d * SECONDS_PER_GAME_DAY;
      const phase = moonAt(t).phase01;
      if (Math.abs(phase - 0.5) < Math.abs(bestPhase - 0.5)) {
        best = t;
        bestPhase = phase;
      }
    }
    const midnight = best;
    const moon = moonAt(midnight);
    const sun = sunAt(midnight);
    expect(moon.illumination01).toBeGreaterThan(0.85);
    expect(moon.elevationRad).toBeGreaterThan(0);
    expect(sun.elevationRad).toBeLessThan(0);
    expect(LATITUDE_RAD).toBeCloseTo(46.8 * DEG);
  });
});

describe('visibility', () => {
  it('is the fog by day and much less at night', () => {
    const weather = createLocalWeather({ ...weatherPreset('moderate'), visibilityM: 15_000 });
    expect(weather.visibilityAt({ x: 0, z: 0 }, 12 * 3600)).toBe(15_000);
    expect(weather.visibilityAt({ x: 0, z: 0 }, 0)).toBeLessThan(2500);
    expect(weather.fogVisibilityAt(0)).toBe(15_000);
    weather.startGale(0);
    expect(weather.fogVisibilityAt(6 * 60 * R_SAILING)).toBeLessThan(3000);
  });
});

describe('weather from the S9 sim (plan 04 §24)', () => {
  const frame = { origin: { x: -204_333, y: -73_945 }, compression: 8 };
  const make = () => {
    const state = createWeatherState('local-sim');
    const weather = createLocalWeather(weatherPreset('moderate'), OPEN_WATER, 0x51ea, {
      state,
      frame,
    });
    weather.tick(0, { x: 0, z: 0 }, createSea());
    return { state, weather };
  };

  it("blows the sim's wind at the player", () => {
    const { state, weather } = make();
    const sim = simWindAt(state, zoneToChart({ x: 0, z: 0 }, frame), 0);
    const wind = weather.windAt({ x: 0, z: 0 }, 0);
    expect(weather.source).toBe('sim');
    expect(wind.speedKn).toBeCloseTo(sim.speedKn, 6);
    expect(wind.fromRad).toBeCloseTo(sim.fromRad, 6);
    // The panel follows the sim, so an override starts where the sim was.
    expect(weather.settings.speedKn).toBeCloseTo(sim.speedKn, 6);
  });

  it('reads visibility and the barometer from the sim', () => {
    const { state, weather } = make();
    const at = zoneToChart({ x: 0, z: 0 }, frame);
    expect(weather.fogVisibilityAt(0)).toBeCloseTo(Math.min(visibilityAt(state, at, 0), 25_000));
    expect(weather.barometerAt(0)?.hpa).toBeCloseTo(barometerAt(state, at, 0).hpa, 6);
  });

  it('advances the sim on the world tick, through any gap', () => {
    const { state, weather } = make();
    weather.tick(3 * 3600 + 30, { x: 0, z: 0 }, createSea());
    expect(state.tickSeconds).toBe(3 * 3600);
  });

  it('lets the dev panel override it, and hands back', () => {
    const { weather } = make();
    weather.applyPreset('gale');
    expect(weather.source).toBe('panel');
    expect(weather.barometerAt(0)).toBeUndefined();
    expect(weather.windAt({ x: 0, z: 0 }, 0).speedKn).toBeGreaterThan(25);
    weather.startGale(0);
    expect(weather.source).toBe('gale');
    weather.useSim();
    expect(weather.source).toBe('sim');
    expect(weather.barometerAt(0)).toBeDefined();
  });

  it('keeps the panel in charge when there is no sim', () => {
    const weather = createLocalWeather();
    expect(weather.source).toBe('panel');
    weather.useSim();
    expect(weather.source).toBe('panel');
    expect(weather.barometerAt(0)).toBeUndefined();
  });
});
