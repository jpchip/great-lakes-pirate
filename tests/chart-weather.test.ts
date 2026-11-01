import { describe, expect, it } from 'vitest';
import { EventBus } from '../src/core/events';
import { InputMapper } from '../src/core/input';
import { Rng } from '../src/core/rng';
import { chartToZone, zoneToChart, type Chart } from '../src/core/coords';
import { createGameWorld } from '../src/gameplay/ecs';
import {
  allContacts,
  CHART_TIME_SCALE,
  createChartMode,
  readSky,
  sessionShip,
  sessionWeatherFactor,
  SQUALL_SPEED,
  type ChartSession,
} from '../src/modes/chart';
import type { GameContext, GameEvents } from '../src/modes/context';
import { arenaFromChartEncounter } from '../src/sim/arena/encounter';
import { arenaFrame, FOG_WALL_AHEAD_M, metWeatherFrame } from '../src/sim/arena/arena';
import { westernSuperiorChart } from '../src/sim/chart/chart-data';
import {
  chartWindAt,
  courseWeather,
  createChartSky,
  forecastAt,
  forecastSpreadM,
  refreshSky,
  visibilityFactor,
  weatherPicture,
  type ChartSky,
} from '../src/sim/chart/chart-weather';
import { fromWorldChart, toWorldChart } from '../src/sim/chart/geography';
import { checkEncounters, type Contact } from '../src/sim/chart/traffic';
import { planCourse, PROTOTYPE_SCHOONER } from '../src/sim/chart/voyage';
import { createLocalWeather, weatherPreset } from '../src/sim/weather/local-weather';
import { OPEN_WATER } from '../src/sim/weather/shelter';
import { createSea } from '../src/sim/weather/waves';
import {
  advanceWeather,
  createWeatherState,
  placeFogBank,
  squallAt,
  thunderstormAt,
  visibilityAt,
  windAt,
  type WeatherState,
} from '../src/sim/weather/weather';
import { createWorldState } from '../src/sim/world-state';
import { contourSegments } from '../src/render/chart/weather-layer';
import { chartHud, courseWeatherText, outlookText } from '../src/ui/chart/model';

/** Phase 3 piece E: the weather sim on the chart. */

const geo = westernSuperiorChart();
const at = (lat: number, lon: number): Chart => geo.projection.geoToChart({ lat, lon });
const offDuluth = at(46.8, -91.96);
const midLake = at(47.05, -91.3);
const northOfSand = at(47.17, -91.0);
const DAY = 86_400;

function session(sky?: ChartSky, position = midLake): ChartSession {
  return {
    geo,
    ship: PROTOTYPE_SCHOONER,
    position,
    heading: 0,
    wind: { from: 0, speedKn: 10 },
    contacts: [],
    sky,
    waypoints: [],
    course: undefined,
    voyage: undefined,
    lookout: 'threatsAndPrizes',
    timeScale: CHART_TIME_SCALE,
    pending: undefined,
    handled: new Set(),
    quietUntil: 0,
  };
}

/** A fog bank standing on a chart point, formed. */
function fogOn(state: WeatherState, p: Chart, radiusM = 20_000) {
  return placeFogBank(state, toWorldChart(geo, p), { radiusM, coreVisibilityM: 150 });
}

/** The first hour in a run of August weather with a squall cell over the western lake. */
function findSquall(): { state: WeatherState; t: number } {
  for (let k = 0; k < 8; k++) {
    const t0 = 13 * DAY;
    const state = createWeatherState(`squall-${k}`, t0);
    for (let t = t0; t < t0 + 3 * DAY; t += 3600) {
      advanceWeather(state, t);
      if (weatherPicture(state, geo, t).cells.length > 0) return { state, t };
    }
  }
  throw new Error('no squall found');
}

describe('one weather for the chart and the zones (§20.3 criterion 6)', () => {
  it("reads the zone's wind on the chart at the same point and time", () => {
    const state = createWeatherState('one-sky', 4 * DAY);
    const frame = { origin: toWorldChart(geo, midLake), compression: 8 };
    const zone = createLocalWeather(weatherPreset('moderate'), OPEN_WATER, 0x51ea, {
      state,
      frame,
    });
    for (const t of [4 * DAY, 4 * DAY + 5 * 3600, 4 * DAY + 11 * 3600]) {
      advanceWeather(state, t);
      const p = { x: 400, z: -250 };
      zone.tick(t, p, createSea());
      const inZone = zone.windAt(p, t);
      const onChart = chartWindAt(state, geo, fromWorldChart(geo, zoneToChart(p, frame)), t);
      expect(onChart.speedKn).toBeCloseTo(inZone.speedKn, 3);
      expect(onChart.from).toBeCloseTo(inZone.fromRad, 3);
    }
  });

  it('drives the chart wind from the sim under way, and runs the sim on the world tick', () => {
    const state = createWorldState('sky-under-way');
    state.environment.clock.gameSeconds = 3 * DAY + 8 * 3600;
    const ctx: GameContext = {
      state,
      world: createGameWorld(),
      rng: Rng.fromState(state.environment.rng),
      input: new InputMapper(),
      events: new EventBus<GameEvents>(),
      sea: createSea([]),
      weather: createLocalWeather(),
    };
    const sky = createChartSky(state.environment.weather);
    const s = session(sky, offDuluth);
    s.waypoints = [northOfSand];
    readSky(s, state.environment.clock.gameSeconds);
    const mode = createChartMode(ctx, s);
    expect(mode.setSail()).toBe(true);
    for (let i = 0; i < 60; i++) mode.update(1 / 30);
    const now = state.environment.clock.gameSeconds;
    expect(state.environment.weather.tickSeconds).toBeGreaterThan(3 * DAY + 8 * 3600);
    expect(now - state.environment.weather.tickSeconds).toBeLessThan(600);
    const sim = windAt(state.environment.weather, toWorldChart(geo, s.position), now);
    // Read on the last world tick, at most 10 game minutes ago.
    expect(Math.abs(s.wind.speedKn - sim.speedKn)).toBeLessThan(3);
    expect(sky.picture).toBeDefined();
  });
});

describe('fog banks on the chart', () => {
  it('hides the ship: the lookouts see a few hundred meters, and so does the cutter', () => {
    const state = createWeatherState('fog-hides', 5 * DAY);
    const sky = createChartSky(state);
    const s = session(sky);
    fogOn(state, midLake);
    refreshSky(sky, geo, midLake, 5 * DAY);
    expect(sky.visibilityM).toBeLessThan(400);
    expect(sessionWeatherFactor(s)).toBeLessThan(0.05);
    const cutter: Contact = {
      id: 'ship.morrill',
      kind: 'cutter',
      name: 'Revenue cutter Morrill',
      pos: { x: midLake.x + 2500, y: midLake.y },
      heading: 0,
      speedKn: 10,
      conspicuity: 1.2,
      hostile: true,
      threat: true,
      prize: false,
    };
    // Noon, 2.5 km off: in clear air she'd force the meeting; in the fog she can't see you.
    const clear = checkEncounters(midLake, [cutter], 12, 0, 'threats', new Set(), false, 1);
    expect(clear?.forced).toBe(true);
    const fog = checkEncounters(
      midLake,
      [cutter],
      12,
      0,
      'threats',
      new Set(),
      false,
      sessionWeatherFactor(s),
    );
    expect(fog?.contact.id).not.toBe('ship.morrill');
  });

  it('is reported at its wall and met in an arena with the sim bank where it stands', () => {
    const state = createWeatherState('fog-met', 5 * DAY);
    const sky = createChartSky(state);
    const bankAt = { x: midLake.x + 24_000, y: midLake.y };
    const bank = fogOn(state, bankAt);
    refreshSky(sky, geo, midLake, 5 * DAY);
    const contact = sky.contacts.find((c) => c.id === `weather.fog.${bank.id}`);
    expect(contact?.kind).toBe('fog');
    expect(contact?.radiusM).toBeCloseTo(0.75 * 20_000, -2);

    const s = session(sky);
    const enc = checkEncounters(
      midLake,
      allContacts(s),
      12,
      5 * DAY,
      'threatsAndPrizes',
      new Set(),
      false,
      sessionWeatherFactor(s),
    );
    expect(enc?.contact.kind).toBe('fog');
    // Its wall is 9 km off, so the meeting is at that range, not at the bank's heart.
    expect(enc?.distanceM).toBeGreaterThan(8_000);

    const arena = arenaFromChartEncounter(enc as NonNullable<typeof enc>, midLake, Math.PI / 2);
    expect(arena.kind).toBe('fogbank');
    const player = { x: 0, z: 650, heading: Math.PI / 2 };
    const frame = metWeatherFrame(geo, arena, { frame: arenaFrame(midLake), player });
    // The bank's wall stands FOG_WALL_AHEAD_M ahead of the player in the arena.
    const centre = chartToZone(toWorldChart(geo, contact?.pos as Chart), frame);
    const wallZ = Math.hypot(centre.x - player.x, centre.z - player.z) - (20_000 * 0.75) / 8;
    expect(wallZ).toBeCloseTo(FOG_WALL_AHEAD_M, -1);
    const ahead = { x: player.x + FOG_WALL_AHEAD_M + 300, z: player.z };
    expect(visibilityAt(state, zoneToChart(ahead, frame), 5 * DAY)).toBeLessThan(2000);
    expect(visibilityAt(state, zoneToChart(player, frame), 5 * DAY)).toBeGreaterThan(5000);
  });

  it('slows the ship inside a squall', () => {
    const { state, t } = findSquall();
    const sky = createChartSky(state);
    refreshSky(sky, geo, midLake, t);
    const cell = sky.picture?.cells[0];
    expect(cell).toBeDefined();
    const s = session(sky, cell?.pos);
    refreshSky(sky, geo, s.position, t);
    expect(sessionShip(s).cruiseKn).toBeCloseTo(PROTOTYPE_SCHOONER.cruiseKn * SQUALL_SPEED);
  });
});

describe('squalls from the sim', () => {
  it('finds storm cells where the sim stands squalls, and keeps their ids tick to tick', () => {
    const { state, t } = findSquall();
    const sky = createChartSky(state);
    refreshSky(sky, geo, midLake, t);
    const first = sky.picture?.cells ?? [];
    expect(first.length).toBeGreaterThan(0);
    for (const cell of first) {
      expect(squallAt(state, toWorldChart(geo, cell.pos), t)).toBeGreaterThan(0);
      expect(cell.radiusM).toBeGreaterThan(2500);
    }
    advanceWeather(state, t + 600);
    refreshSky(sky, geo, midLake, t + 600);
    const next = sky.picture?.cells ?? [];
    const kept = next.filter((c) => first.some((f) => f.id === c.id));
    expect(kept.length).toBeGreaterThan(0);
    const squalls = sky.contacts.filter((c) => c.kind === 'storm');
    expect(squalls.length).toBe(next.length);
    expect(squalls.every((c) => c.threat)).toBe(true);
  });

  it('meets a squall in an arena at its heart, in the sim weather', () => {
    const { state, t } = findSquall();
    const sky = createChartSky(state);
    refreshSky(sky, geo, midLake, t);
    const c = sky.contacts.find((x) => x.kind === 'storm') as Contact;
    const enc = arenaFromChartEncounter(
      { contact: c, forced: false, distanceM: 5000, bearing: 1 },
      { x: c.pos.x - 20_000, y: c.pos.y },
      Math.PI / 2,
    );
    expect(enc.kind).toBe('squall');
    const player = { x: 0, z: 0, heading: Math.PI / 2 };
    const frame = metWeatherFrame(geo, enc, { frame: arenaFrame(enc.at), player });
    const core = zoneToChart(player, frame);
    expect(
      Math.hypot(core.x - toWorldChart(geo, c.pos).x, core.y - toWorldChart(geo, c.pos).y),
    ).toBeLessThan(10);
    expect(squallAt(state, core, t)).toBeGreaterThan(0);
  });

  it('brings cold squalls to a November gale, without thunder', () => {
    const warm = thunderstormAt;
    let found = false;
    for (let k = 0; k < 12 && !found; k++) {
      const t0 = 26 * DAY;
      const state = createWeatherState(`nov-squall-${k}`, t0);
      for (let t = t0; t < t0 + 3 * DAY && !found; t += 3600) {
        advanceWeather(state, t);
        const pic = weatherPicture(state, geo, t);
        for (const cell of pic.cells) {
          const w = toWorldChart(geo, cell.pos);
          expect(warm(state, w, t)).toBe(0);
          expect(cell.thunder).toBe(false);
          found = true;
        }
      }
    }
    expect(found).toBe(true);
  });
});

describe('the forecast', () => {
  it('reads the wind now, and widens its spread with the lead', () => {
    const state = createWeatherState('forecast', 6 * DAY);
    const now = 6 * DAY;
    const f0 = forecastAt(state, geo, midLake, now, 0);
    const wind = chartWindAt(state, geo, midLake, now);
    expect((f0.windLowKn + f0.windHighKn) / 2).toBeCloseTo(wind.speedKn, 1);
    const f12 = forecastAt(state, geo, midLake, now, 12);
    const spread = (f: typeof f0) => (f.windHighKn - f.windLowKn) / (f.windHighKn + f.windLowKn);
    expect(spread(f12)).toBeGreaterThan(spread(f0));
    expect(forecastSpreadM(24)).toBeGreaterThan(forecastSpreadM(6));
    expect(outlookText(f12, now)).toMatch(/^Outlook to \d\d:\d\d: wind [NESW]+ \d+/);
  });

  it('runs the systems forward: a forecast picture is the sim at that hour', () => {
    const state = createWeatherState('forecast-picture', 6 * DAY);
    const now = 6 * DAY;
    const ahead = weatherPicture(state, geo, now, 6);
    expect(ahead.at).toBe(now + 6 * 3600);
    // The same field as asking the sim directly at that time, before it ticks there.
    const p = toWorldChart(geo, ahead.field.origin);
    expect(ahead.field.windX[0]).toBeCloseTo(windAt(state, p, now + 6 * 3600).toKn.x, 4);
  });

  /**
   * A run with a working breeze off Duluth, so the course is sailed in hours, not days,
   * and nothing on the course to Sand Island until a bank is placed on it.
   */
  function breezy(): { state: WeatherState; t: number } {
    const course = planCourse(geo, offDuluth, [northOfSand]);
    for (let k = 0; ; k++) {
      const t = 5 * DAY;
      const state = createWeatherState(`breeze-${k}`, t);
      if (chartWindAt(state, geo, offDuluth, t).speedKn < 9) continue;
      if (courseWeather(state, geo, course, PROTOTYPE_SCHOONER, t)) continue;
      return { state, t };
    }
  }

  it('warns of fog on the course ahead', () => {
    const { state, t } = breezy();
    fogOn(state, at(47.05, -91.5), 12_000);
    const course = planCourse(geo, offDuluth, [northOfSand]);
    const w = courseWeather(state, geo, course, PROTOTYPE_SCHOONER, t);
    expect(w?.kind).toBe('fog');
    expect(w?.hours).toBeGreaterThan(0.5);
    expect(courseWeatherText(w)).toMatch(/^Fog on the course in about/);
  });

  it('puts the glass, the outlook and the course weather on the chart card', () => {
    const { state } = breezy();
    fogOn(state, at(47.05, -91.5), 12_000);
    const sky = createChartSky(state);
    const s = session(sky, offDuluth);
    s.waypoints = [northOfSand];
    s.course = planCourse(geo, offDuluth, s.waypoints);
    refreshSky(sky, geo, offDuluth, 5 * DAY);
    const card = chartHud({
      session: s,
      trip: 'sea',
      gameSeconds: 5 * DAY,
      backLabel: undefined,
      notice: undefined,
      locked: false,
      forecastLead: 6,
    }).weather;
    expect(card?.barometerText).toMatch(/^Glass \d\d\.\d\d /);
    expect(card?.courseText).toMatch(/^Fog/);
    expect(card?.lead).toBe(6);
    // Without a sky (the unit-test chart), there's no weather card.
    expect(
      chartHud({
        session: session(),
        trip: 'sea',
        gameSeconds: 0,
        backLabel: undefined,
        notice: undefined,
        locked: false,
      }).weather,
    ).toBeUndefined();
  });
});

describe('the chart drawing', () => {
  it('visibility factor is 1 in clear air and falls in fog', () => {
    expect(visibilityFactor(25_000)).toBe(1);
    expect(visibilityFactor(200)).toBeLessThan(0.05);
  });

  it('traces isobars as closed rings around a low', () => {
    const n = 21;
    const values = new Float32Array(n * n);
    for (let j = 0; j < n; j++) {
      for (let i = 0; i < n; i++) values[j * n + i] = Math.hypot(i - 10, j - 10);
    }
    const segs = contourSegments(values, n, n, 5.5);
    expect(segs.length).toBeGreaterThan(20);
    for (const [a, b] of segs) {
      expect(Math.hypot(a.i - 10, a.j - 10)).toBeCloseTo(5.5, 0);
      expect(Math.hypot(b.i - 10, b.j - 10)).toBeCloseTo(5.5, 0);
    }
  });
});
