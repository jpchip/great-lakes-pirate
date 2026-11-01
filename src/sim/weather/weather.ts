import type { Chart } from '../../core/coords';
import { knotsToMs, msToKnots } from '../../core/coords';
import { Rng, type RngState } from '../../core/rng';
import {
  SECONDS_PER_GAME_DAY,
  WORLD_TICK_GAME_SECONDS,
  calendarDate,
  dayAndHour,
} from '../../core/time';
import { climateAt, type Climate, type LowTrack } from './climate';
import {
  LAKE_BOUNDS,
  LAKE_CENTER,
  RADIATION_FOG_SITES,
  WESTERN_SUPERIOR,
  inPolygon,
} from './geography';
import { fractalNoise, valueNoise } from './noise';

/**
 * The weather sim (plan 04 §5): a handful of moving pressure systems and fog banks on
 * the true-scale chart, advanced on the world tick. Everything else is a query that
 * reads the state at any game time, so gameplay can ask between ticks and the chart
 * can ask anywhere.
 *
 * Positions are chart meters (x east, y north). Callers in a zone convert with
 * zoneToChart first. Pressure is in hPa and wind in knots, the units the HUD shows.
 */

export const MAX_SYSTEMS = 6;
export const MAX_FOG_BANKS = 12;
export const STANDARD_HPA = 1013.25;
/** Clear-air visibility (light haze), meters. */
export const CLEAR_VISIBILITY_M = 25_000;

/** Coriolis parameter at ~47° N, 1/s. */
const CORIOLIS = 2 * 7.2921e-5 * Math.sin((47 * Math.PI) / 180);
const AIR_DENSITY = 1.25;
/** Surface friction over water: the wind is slower than geostrophic and turns toward the low. */
const SURFACE_SPEED = 0.7;
const CROSS_ISOBAR_RAD = (15 * Math.PI) / 180;

const HOUR = 3600;

export interface PressureSystem {
  id: number;
  kind: 'low' | 'high';
  track: LowTrack | 'high';
  /** Chart position at the last tick, meters. */
  x: number;
  y: number;
  /** Velocity, m/s. */
  vx: number;
  vy: number;
  /** Gaussian radius, meters. */
  radius: number;
  /** Pressure anomaly at maturity, hPa (negative for lows). */
  peakHpa: number;
  /** Age at the last tick and total lifetime, game seconds. */
  age: number;
  life: number;
}

export interface FogBank {
  id: number;
  kind: 'advection' | 'radiation';
  x: number;
  y: number;
  vx: number;
  vy: number;
  radius: number;
  /** Visibility at the bank's heart when fully formed, meters. */
  coreVisibilityM: number;
  age: number;
  life: number;
}

/** WorldState.environment.weather. Plain data, so it saves as-is. */
export interface WeatherState {
  rng: RngState;
  /** Seed for the stateless wind-drift and gust noise. */
  noiseSeed: number;
  nextId: number;
  /** Game seconds of the last tick; systems and banks sit where they were then. */
  tickSeconds: number;
  systems: PressureSystem[];
  fogBanks: FogBank[];
}

/** Hours of weather run before the start so the chart isn't empty at game start. */
export const SPIN_UP_HOURS = 48;

export function createWeatherState(seed: string, startSeconds = 0): WeatherState {
  const rng = Rng.fromSeed(`${seed}:weather`);
  const state: WeatherState = {
    rng: rng.getState(),
    noiseSeed: rng.nextUint32(),
    nextId: 1,
    tickSeconds: startSeconds - SPIN_UP_HOURS * HOUR,
    systems: [],
    fogBanks: [],
  };
  state.rng = rng.getState();
  while (state.tickSeconds < startSeconds) {
    weatherTick(state, Math.min(startSeconds, state.tickSeconds + WORLD_TICK_GAME_SECONDS));
  }
  return state;
}

// ---------------------------------------------------------------------------------
// Pressure systems

/** 0 → 1 → 0 over a system's life: deepen, hold, fill. */
export function lifecycle(age: number, life: number): number {
  const a = age / life;
  if (a <= 0 || a >= 1) return 0;
  const smooth = (t: number) => t * t * (3 - 2 * t);
  if (a < 0.35) return smooth(a / 0.35);
  if (a < 0.6) return 1;
  return smooth((1 - a) / 0.4);
}

interface SystemNow {
  x: number;
  y: number;
  radius: number;
  anomalyHpa: number;
}

/** A system's position and strength `dt` seconds after its last tick (dt may be negative). */
function systemAt(s: PressureSystem, dt: number): SystemNow {
  return {
    x: s.x + s.vx * dt,
    y: s.y + s.vy * dt,
    radius: s.radius,
    anomalyHpa: s.peakHpa * lifecycle(s.age + dt, s.life),
  };
}

function systemsAt(state: WeatherState, t: number): SystemNow[] {
  const dt = t - state.tickSeconds;
  return state.systems.map((s) => systemAt(s, dt));
}

/**
 * Lows that overlap would add up to pressures Lake Superior never sees, so a combined
 * dip past LOW_KNEE_HPA is squeezed smoothly toward LOW_KNEE_HPA + LOW_SOFT_HPA. A
 * single low never reaches the knee, so it is untouched.
 */
export const LOW_KNEE_HPA = 32;
export const LOW_SOFT_HPA = 14;

/** The limited dip (negative) and its slope with respect to the raw sum. */
function limitLow(sum: number): { dip: number; slope: number } {
  const depth = -sum;
  if (depth <= LOW_KNEE_HPA) return { dip: sum, slope: 1 };
  const th = Math.tanh((depth - LOW_KNEE_HPA) / LOW_SOFT_HPA);
  return { dip: -LOW_KNEE_HPA - LOW_SOFT_HPA * th, slope: 1 - th * th };
}

interface Field {
  hpa: number;
  /** ∇p, hPa per meter. */
  gx: number;
  gy: number;
}

function fieldAt(systems: readonly SystemNow[], p: Chart): Field {
  let high = 0;
  let low = 0;
  let hgx = 0;
  let hgy = 0;
  let lgx = 0;
  let lgy = 0;
  for (const s of systems) {
    const dx = p.x - s.x;
    const dy = p.y - s.y;
    const r2 = s.radius * s.radius;
    const e = s.anomalyHpa * Math.exp(-(dx * dx + dy * dy) / r2);
    if (s.anomalyHpa < 0) {
      low += e;
      lgx += (-2 * dx * e) / r2;
      lgy += (-2 * dy * e) / r2;
    } else {
      high += e;
      hgx += (-2 * dx * e) / r2;
      hgy += (-2 * dy * e) / r2;
    }
  }
  const { dip, slope } = limitLow(low);
  return {
    hpa: STANDARD_HPA + high + dip,
    gx: hgx + slope * lgx,
    gy: hgy + slope * lgy,
  };
}

/** Sea-level pressure, hPa. */
export function pressureAt(state: WeatherState, p: Chart, t: number): number {
  return fieldAt(systemsAt(state, t), p).hpa;
}

/**
 * Pressure change over the last `hours`, hPa. Systems move in straight lines, so the
 * past is reconstructed exactly by running each one backwards; a system born inside
 * the window contributes nothing before its birth, and a filled one is kept for
 * TENDENCY_MEMORY_HOURS so its fading is still counted.
 */
export function pressureTendency(state: WeatherState, p: Chart, t: number, hours = 3): number {
  return pressureAt(state, p, t) - pressureAt(state, p, t - hours * HOUR);
}

export type BarometerTrend = 'rising fast' | 'rising' | 'steady' | 'falling' | 'falling fast';

/** hPa per 3 hours. Real barometer tendency classes use similar cut-offs. */
export const TREND_STEADY_HPA = 1;
export const TREND_FAST_HPA = 3;

export function barometerTrend(tendency3h: number): BarometerTrend {
  if (tendency3h <= -TREND_FAST_HPA) return 'falling fast';
  if (tendency3h <= -TREND_STEADY_HPA) return 'falling';
  if (tendency3h >= TREND_FAST_HPA) return 'rising fast';
  if (tendency3h >= TREND_STEADY_HPA) return 'rising';
  return 'steady';
}

export interface BarometerReading {
  hpa: number;
  tendency3h: number;
  trend: BarometerTrend;
}

export function barometerAt(state: WeatherState, p: Chart, t: number): BarometerReading {
  const tendency3h = pressureTendency(state, p, t, 3);
  return { hpa: pressureAt(state, p, t), tendency3h, trend: barometerTrend(tendency3h) };
}

// ---------------------------------------------------------------------------------
// Wind

export interface Wind {
  /** Where the wind comes from, radians clockwise from north (a "north wind" is 0). */
  fromRad: number;
  /** Sustained speed, knots. */
  speedKn: number;
  /** Gust strength right now, 0–1; sailing adds up to ~40% on top (plan 02 §3.5). */
  gust01: number;
  /** The vector the air moves along, knots (x east, y north). */
  toKn: { x: number; y: number };
}

/** The wind from systems and the prevailing flow, before drift noise. */
function baseWind(
  state: WeatherState,
  climate: Climate,
  p: Chart,
  t: number,
): { x: number; y: number; nearLow: number } {
  const systems = systemsAt(state, t);
  const g = fieldAt(systems, p);
  // Geostrophic wind in the northern hemisphere, from the gradient in Pa/m.
  const k = 100 / (AIR_DENSITY * CORIOLIS);
  const ug = -k * g.gy;
  const vg = k * g.gx;
  // Friction: slower, and turned toward low pressure (counter-clockwise).
  const c = Math.cos(CROSS_ISOBAR_RAD);
  const s = Math.sin(CROSS_ISOBAR_RAD);
  const u = SURFACE_SPEED * (ug * c - vg * s);
  const v = SURFACE_SPEED * (ug * s + vg * c);

  let nearLow = 0;
  for (const sys of systems) {
    if (sys.anomalyHpa >= 0) continue;
    const r2 = ((p.x - sys.x) ** 2 + (p.y - sys.y) ** 2) / (sys.radius * sys.radius);
    nearLow = Math.max(nearLow, Math.min(1, -sys.anomalyHpa / 25) * Math.exp(-r2));
  }
  return {
    x: msToKnots(u) + climate.prevailingToKn.x,
    y: msToKnots(v) + climate.prevailingToKn.y,
    nearLow,
  };
}

/**
 * The climate normals at a game time. Every query asks for them, often many times at the
 * same `t` (the chart samples the sim across a grid at one time), so the last answer is
 * kept: it is a pure function of `t`.
 */
let climateCache: { t: number; climate: Climate } | undefined;
export function climateAtTime(t: number): Climate {
  if (climateCache?.t !== t) climateCache = { t, climate: climateAt(calendarDate(t)) };
  return climateCache.climate;
}

/**
 * Sustained wind above WIND_KNEE_KN is squeezed toward WIND_KNEE_KN + 15: the sum of
 * close systems can otherwise reach hurricane force, which Superior's worst gales
 * (about 50–60 kn sustained) never did.
 */
export const WIND_KNEE_KN = 45;

function capWind(kn: number): number {
  return kn <= WIND_KNEE_KN ? kn : WIND_KNEE_KN + 15 * Math.tanh((kn - WIND_KNEE_KN) / 15);
}

/** The wind, plus how gusty the air is before the gust noise (0–1). */
export interface SimWind extends Wind {
  gustiness: number;
}

export function windAt(state: WeatherState, p: Chart, t: number): Wind {
  const w = simWindAt(state, p, t);
  return { fromRad: w.fromRad, speedKn: w.speedKn, gust01: w.gust01, toKn: w.toKn };
}

/** `windAt` with the gustiness exposed, for a zone that adds its own gusts in the lee. */
export function simWindAt(state: WeatherState, p: Chart, t: number): SimWind {
  const climate = climateAtTime(t);
  const base = baseWind(state, climate, p, t);
  // Slow drift: ±12° over a few hours and ±15% in speed.
  const hours = t / HOUR;
  const veer = ((12 * Math.PI) / 180) * fractalNoise(state.noiseSeed, hours / 3);
  const surge = 1 + 0.15 * fractalNoise(state.noiseSeed + 7, hours / 2);
  const c = Math.cos(veer);
  const s = Math.sin(veer);
  let x = (base.x * c + base.y * s) * surge;
  let y = (-base.x * s + base.y * c) * surge;
  const raw = Math.hypot(x, y);
  const speedKn = capWind(raw);
  if (raw > 0) {
    x *= speedKn / raw;
    y *= speedKn / raw;
  }

  // Gusts: livelier in lows and when cold air crosses warm water in the fall.
  const air = airTempAt(state, p, t);
  const instability = Math.max(0, Math.min(1, (climate.waterC - air - 2) / 8));
  const gustiness = Math.min(1, 0.2 + 0.5 * base.nearLow + 0.3 * instability);
  const gustNoise = 0.5 + 0.5 * valueNoise(state.noiseSeed + 13, t / 90);
  const gust01 = Math.max(0, Math.min(1, gustiness * gustNoise * Math.min(1, speedKn / 8)));

  // Meteorological "from": the opposite of the direction the air moves.
  const fromRad = (Math.atan2(-x, -y) + 2 * Math.PI) % (2 * Math.PI);
  return { fromRad, speedKn, gust01, toKn: { x, y }, gustiness };
}

// ---------------------------------------------------------------------------------
// Air temperature, precipitation, visibility

/**
 * Air temperature, °C: the normal high and low as a day/night swing peaking at 15:00,
 * plus warm or cold air carried by the wind.
 */
export function airTempAt(state: WeatherState, p: Chart, t: number): number {
  const climate = climateAtTime(t);
  const { hour } = dayAndHour(t);
  const mean = (climate.airMaxC + climate.airMinC) / 2;
  const swing = (climate.airMaxC - climate.airMinC) / 2;
  const diurnal = swing * Math.cos((2 * Math.PI * (hour - 15)) / 24);
  const base = baseWind(state, climate, p, t);
  // Southerly flow brings warm air; northerly flow brings cold.
  const advection = Math.max(-7, Math.min(7, 0.3 * base.y));
  return mean + diurnal + advection;
}

/** Rain or snow rate, 0–1, from lows. Heaviest just ahead (east and north) of the center. */
export function precipitationAt(state: WeatherState, p: Chart, t: number): number {
  let rate = 0;
  for (const s of systemsAt(state, t)) {
    if (s.anomalyHpa >= 0) continue;
    // The rain shield sits ahead of the low along its motion; shift the center that way.
    const cx = s.x + 0.25 * s.radius;
    const cy = s.y + 0.15 * s.radius;
    const r2 = ((p.x - cx) ** 2 + (p.y - cy) ** 2) / (0.55 * s.radius) ** 2;
    const depth = Math.min(1, Math.max(0, (-s.anomalyHpa - 4) / 26));
    rate = Math.max(rate, depth * Math.exp(-r2));
  }
  return rate;
}

function smoothstep(a: number, b: number, x: number): number {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

/** A fog bank's thickness, 0–1: it forms over an hour and lifts over ninety minutes. */
function fogEnvelope(b: FogBank, age: number): number {
  if (age <= 0 || age >= b.life) return 0;
  return Math.min(1, age / HOUR, (b.life - age) / (1.5 * HOUR));
}

/** 0–1 fog strength at a point from one bank. */
function fogStrength(b: FogBank, dt: number, p: Chart): number {
  const x = b.x + b.vx * dt;
  const y = b.y + b.vy * dt;
  const d = Math.hypot(p.x - x, p.y - y);
  return fogEnvelope(b, b.age + dt) * (1 - smoothstep(0.45 * b.radius, b.radius, d));
}

/**
 * Weather visibility, meters: the worst of haze, precipitation and fog. Night and
 * moonlight are applied on top by the sky and stealth code (plan 04 §5.2).
 */
export function visibilityAt(state: WeatherState, p: Chart, t: number): number {
  let vis = CLEAR_VISIBILITY_M;
  const rain = precipitationAt(state, p, t);
  if (rain > 0.02) {
    const snow = airTempAt(state, p, t) < 0.5 ? 2.5 : 1;
    vis = Math.min(vis, CLEAR_VISIBILITY_M / (1 + 18 * snow * rain));
  }
  const dt = t - state.tickSeconds;
  for (const b of state.fogBanks) {
    const f = fogStrength(b, dt, p);
    if (f <= 0) continue;
    // Blend in log space so the edge of a bank thins out gradually.
    vis = Math.min(vis, CLEAR_VISIBILITY_M ** (1 - f) * b.coreVisibilityM ** f);
  }
  return vis;
}

/** A summer storm needs air this warm (the day's mean high, °C) to turn convective. */
const STORM_WARM_C = 14;
const STORM_HOT_C = 22;
/** Thunderstorm cells are tens of kilometers across and drift with the weather. */
const STORM_CELL_M = 45_000;
const STORM_CELL_DRIFT_M_PER_H = 30_000;

/**
 * Thunderstorm intensity, 0–1 (plan 04 §9, §11; Phase 2 piece E): summer cells in the
 * rain ahead of a low. None until the air is warm (the late-May highs are 10–13 °C, so
 * spring is quiet), and then a cell of noise decides where in the rain the storms stand,
 * so the same low brings storms to one shore and plain rain to another. Cells drift east
 * with the prevailing flow.
 */
export function thunderstormAt(state: WeatherState, p: Chart, t: number): number {
  const warm = smoothstep(STORM_WARM_C, STORM_HOT_C, climateAtTime(t).airMaxC);
  if (warm <= 0) return 0;
  const rain = precipitationAt(state, p, t);
  if (rain < 0.1) return 0;
  return warm * smoothstep(0.1, 0.4, rain) * smoothstep(0.4, 0.7, stormCell(state, p, t));
}

/**
 * The storm-cell noise, 0–1: cells of about STORM_CELL_M drifting east with the prevailing
 * flow. Where it is high inside the rain, the rain turns to storms.
 */
function stormCell(state: WeatherState, p: Chart, t: number): number {
  const drift = (STORM_CELL_DRIFT_M_PER_H * t) / 3600;
  const cx = (p.x - drift) / STORM_CELL_M;
  const cy = p.y / STORM_CELL_M;
  // Value noise in x and y from the 1D noise: rows by y, blended along x.
  const row = Math.floor(cy);
  const f = cy - row;
  const along = (r: number): number => 0.5 + 0.5 * valueNoise(state.noiseSeed + 101 * r, cx);
  return along(row) * (1 - f) + along(row + 1) * f;
}

/** Storm cells drift east this fast, m/s, for anything that tracks them. */
export const STORM_CELL_DRIFT_MS = STORM_CELL_DRIFT_M_PER_H / 3600;

/** A gale's rain turns squally from about this wind, knots. */
const SQUALL_GALE_KN = 22;
const SQUALL_FULL_KN = 32;

/**
 * Squall intensity, 0–1 (plan 04 §15, Phase 3 piece E): the thunderstorms of summer, and
 * in the cold months the squalls embedded in a gale's rain, where the same storm cells
 * stand. It is never less than `thunderstormAt`; the difference is the cold squall, which
 * brings the wind and rain but no lightning. The chart draws and meets these as storm cells.
 */
export function squallAt(state: WeatherState, p: Chart, t: number): number {
  const rain = precipitationAt(state, p, t);
  if (rain < 0.1) return 0;
  const cell = smoothstep(0.4, 0.7, stormCell(state, p, t));
  if (cell <= 0) return 0;
  const warm = smoothstep(STORM_WARM_C, STORM_HOT_C, climateAtTime(t).airMaxC);
  const drive =
    warm >= 1
      ? 1
      : Math.max(warm, smoothstep(SQUALL_GALE_KN, SQUALL_FULL_KN, windAt(state, p, t).speedKn));
  return drive * smoothstep(0.1, 0.4, rain) * cell;
}

/**
 * Puts a fog bank at a chart point, formed and standing still, for playtests and checks
 * (`?fogbank=` in main.ts). It lives out `lifeHours` like any other and is saved with the
 * state, so the sim's own spawning and lifting treat it as theirs.
 */
export function placeFogBank(
  state: WeatherState,
  at: Chart,
  options: {
    radiusM?: number;
    kind?: FogBank['kind'];
    coreVisibilityM?: number;
    lifeHours?: number;
  } = {},
): FogBank {
  const life = (options.lifeHours ?? 12) * HOUR;
  const bank: FogBank = {
    id: state.nextId++,
    kind: options.kind ?? 'advection',
    x: at.x,
    y: at.y,
    vx: 0,
    vy: 0,
    radius: options.radiusM ?? 24_000,
    coreVisibilityM: options.coreVisibilityM ?? 150,
    // Past its hour of forming, so it stands at full strength.
    age: Math.max(HOUR, life / 4),
    life,
  };
  // The sim holds at most MAX_FOG_BANKS; make room by dropping the oldest.
  while (state.fogBanks.length >= MAX_FOG_BANKS) state.fogBanks.shift();
  state.fogBanks.push(bank);
  return bank;
}

/** A fog bank as the renderer draws it: where it is now and how thick, chart meters. */
export interface FogBankView {
  id: number;
  kind: FogBank['kind'];
  x: number;
  y: number;
  radius: number;
  /** 0–1: how formed the bank is (it forms over an hour and lifts over ninety minutes). */
  strength: number;
}

/** Every living fog bank at game time `t`, so the renderer can show them coming. */
export function fogBanksAt(state: WeatherState, t: number): FogBankView[] {
  const dt = t - state.tickSeconds;
  const out: FogBankView[] = [];
  for (const b of state.fogBanks) {
    const strength = fogEnvelope(b, b.age + dt);
    if (strength <= 0) continue;
    out.push({
      id: b.id,
      kind: b.kind,
      x: b.x + b.vx * dt,
      y: b.y + b.vy * dt,
      radius: b.radius,
      strength,
    });
  }
  return out;
}

/**
 * Cloud cover, 0–1: a deck that spreads well beyond a low's rain shield, broken cloud
 * on an ordinary day, and clear skies under a high. A stand-in until the cloud layers of
 * plan 04 §9 (piece E) model it properly.
 */
export function cloudAt(state: WeatherState, p: Chart, t: number): number {
  let low = 0;
  let high = 0;
  for (const s of systemsAt(state, t)) {
    const r2 = ((p.x - s.x) ** 2 + (p.y - s.y) ** 2) / (s.radius * s.radius);
    if (s.anomalyHpa < 0) {
      const cx = s.x + 0.2 * s.radius;
      const cy = s.y + 0.1 * s.radius;
      const rr = ((p.x - cx) ** 2 + (p.y - cy) ** 2) / (0.8 * s.radius) ** 2;
      low = Math.max(low, Math.min(1, (-s.anomalyHpa - 2) / 14) * Math.exp(-rr));
    } else {
      high = Math.max(high, Math.min(1, s.anomalyHpa / 10) * Math.exp(-r2));
    }
  }
  const fair = 0.3 * (1 - high);
  return Math.max(0, Math.min(1, fair + (1 - fair) * low));
}

// ---------------------------------------------------------------------------------
// The world tick

function pickTrack(rng: Rng, weights: Climate['tracks']): LowTrack {
  const total = weights.clipper + weights.panhandle + weights.pacific;
  const r = rng.next() * total;
  if (r < weights.clipper) return 'clipper';
  if (r < weights.clipper + weights.panhandle) return 'panhandle';
  return 'pacific';
}

const KMH = 1000 / 3600;

/** Where each track enters the chart (relative to the lake, km) and how fast it moves. */
const TRACKS: Record<
  LowTrack | 'high',
  { from: [number, number, number, number]; kmh: [number, number] }
> = {
  // Alberta clippers dive in from the northwest, fast and fairly shallow.
  clipper: { from: [-900, -500, 650, 850], kmh: [50, 70] },
  // Colorado ("panhandle") lows come up from the southwest and bring the November
  // northeasters when they pass south and east of the lake.
  panhandle: { from: [-1050, -700, -750, -500], kmh: [40, 55] },
  // Pacific lows cross the plains from the west.
  pacific: { from: [-1300, -1150, -250, 350], kmh: [35, 50] },
  // Canadian highs settle in from the northwest behind the lows.
  high: { from: [-1000, -500, 600, 850], kmh: [25, 40] },
};

function spawnSystem(state: WeatherState, rng: Rng, climate: Climate, kind: 'low' | 'high'): void {
  const track = kind === 'high' ? 'high' : pickTrack(rng, climate.tracks);
  const def = TRACKS[track];
  const sx = LAKE_CENTER.x + rng.range(def.from[0], def.from[1]) * 1000;
  const sy = LAKE_CENTER.y + rng.range(def.from[2], def.from[3]) * 1000;
  // Aim somewhere around the lake, so most systems matter to it but not all hit it.
  const spread = kind === 'high' ? 500_000 : 380_000;
  const tx = LAKE_CENTER.x + rng.range(-spread, spread) * 0.6;
  const ty = LAKE_CENTER.y + rng.range(-spread, spread);
  const speed = rng.range(def.kmh[0], def.kmh[1]) * KMH;
  const d = Math.hypot(tx - sx, ty - sy);
  // Mature as it reaches the lake, give or take.
  const arrival = d / speed;

  let peakHpa: number;
  let radius: number;
  if (kind === 'high') {
    peakHpa = rng.range(6, 16) + (climate.airMaxC < 5 ? 4 : 0);
    radius = rng.range(1000, 1500) * 1000;
  } else if (rng.chance(climate.deepShare)) {
    peakHpa = -rng.range(22, 34);
    radius = rng.range(650, 850) * 1000;
  } else {
    peakHpa = -rng.range(5, 17);
    radius = rng.range(700, 1000) * 1000;
  }
  const life = arrival * rng.range(1.4, 2.2);

  state.systems.push({
    id: state.nextId++,
    kind,
    track,
    x: sx,
    y: sy,
    vx: ((tx - sx) / d) * speed,
    vy: ((ty - sy) / d) * speed,
    radius,
    peakHpa,
    age: 0,
    life,
  });
}

/**
 * A system is dropped once it's far enough from the lake that it no longer matters
 * there (2.5 radii leaves under 0.2% of its anomaly), so the barometer never jumps.
 */
function stillRelevant(s: PressureSystem): boolean {
  const d = Math.hypot(s.x - LAKE_CENTER.x, s.y - LAKE_CENTER.y);
  const leaving = (s.x - LAKE_CENTER.x) * s.vx + (s.y - LAKE_CENTER.y) * s.vy > 0;
  return !(leaving && d > 2.5 * s.radius);
}

/** How far back pressureTendency may look and still be exact, game hours. */
export const TENDENCY_MEMORY_HOURS = 6;

export function livingSystems(state: WeatherState): number {
  return state.systems.reduce((n, s) => n + (s.age < s.life ? 1 : 0), 0);
}

/** Per-tick chance for a Poisson process with `perDay` events per game day. */
function perTick(perDay: number, dt: number): number {
  return 1 - Math.exp((-perDay * dt) / SECONDS_PER_GAME_DAY);
}

/** Advection-fog spawn rate per game hour over the whole lake at full weight. */
const ADVECTION_PER_HOUR = 1.6;
/** Radiation-fog spawn rate per game hour per site at full weight. */
const RADIATION_PER_HOUR = 0.35;

function spawnFog(state: WeatherState, rng: Rng, climate: Climate, t: number, dt: number): void {
  if (state.fogBanks.length >= MAX_FOG_BANKS) return;
  const { hour } = dayAndHour(t);

  // Advection fog: warm, moist air over cold water in light to moderate wind.
  const at = {
    x: rng.range(LAKE_BOUNDS.minX, LAKE_BOUNDS.maxX),
    y: rng.range(LAKE_BOUNDS.minY, LAKE_BOUNDS.maxY),
  };
  if (inPolygon(at, WESTERN_SUPERIOR)) {
    const wind = windAt(state, at, t);
    const warmth = airTempAt(state, at, t) - climate.waterC;
    // Moist air comes off the land to the south and southwest; a north wind is dry.
    const moisture = Math.max(0, Math.min(1, 0.35 + wind.toKn.y / 12));
    const windOk = wind.speedKn >= 3 && wind.speedKn <= 16 ? 1 : 0;
    const rain = precipitationAt(state, at, t);
    const weight =
      climate.advectionFog * smoothstep(1, 6, warmth) * windOk * moisture * (rain > 0.3 ? 0 : 1);
    if (weight > 0 && rng.chance(perTick(ADVECTION_PER_HOUR * weight * 24, dt))) {
      const drift = knotsToMs(1) * 0.8;
      state.fogBanks.push({
        id: state.nextId++,
        kind: 'advection',
        x: at.x,
        y: at.y,
        vx: wind.toKn.x * drift,
        vy: wind.toKn.y * drift,
        radius: rng.range(10, 35) * 1000,
        coreVisibilityM: rng.range(60, 350),
        age: 0,
        life: rng.range(4, 14) * HOUR,
      });
    }
  }

  // Radiation fog: clear (no low overhead), calm nights in bays.
  const night = hour >= 21 || hour < 6;
  if (!night) return;
  for (const site of RADIATION_FOG_SITES) {
    if (state.fogBanks.length >= MAX_FOG_BANKS) return;
    const pooled = state.fogBanks.some(
      (b) => b.kind === 'radiation' && Math.hypot(b.x - site.at.x, b.y - site.at.y) < 8000,
    );
    if (pooled) continue;
    const wind = windAt(state, site.at, t);
    const clear = pressureAt(state, site.at, t) >= STANDARD_HPA - 2;
    // Bays are sheltered and the night air settles, so the bay sees less wind than the lake.
    const bayWind = wind.speedKn * 0.6;
    if (!clear || bayWind > 6 || precipitationAt(state, site.at, t) > 0.05) continue;
    const calm = 1 - bayWind / 6;
    if (!rng.chance(perTick(RADIATION_PER_HOUR * climate.radiationFog * calm * 24, dt))) continue;
    // It burns off between 8 and 11 in the morning.
    const hoursToDawn = (24 + 6 - hour) % 24;
    const burnOff = hoursToDawn + rng.range(2, 5);
    state.fogBanks.push({
      id: state.nextId++,
      kind: 'radiation',
      x: site.at.x + rng.range(-3000, 3000),
      y: site.at.y + rng.range(-3000, 3000),
      vx: wind.toKn.x * knotsToMs(1) * 0.2,
      vy: wind.toKn.y * knotsToMs(1) * 0.2,
      radius: rng.range(3, 8) * 1000,
      coreVisibilityM: rng.range(100, 500),
      age: 0,
      life: burnOff * HOUR,
    });
  }
}

function updateFog(state: WeatherState, climate: Climate, t: number, dt: number): void {
  for (const b of state.fogBanks) {
    b.x += b.vx * dt;
    b.y += b.vy * dt;
    b.age += dt;
    const at = { x: b.x, y: b.y };
    const wind = windAt(state, at, t);
    const drift = knotsToMs(1) * (b.kind === 'advection' ? 0.8 : 0.2);
    b.vx = wind.toKn.x * drift;
    b.vy = wind.toKn.y * drift;
    // Strong wind or rain mixes fog out; so does cold air (advection fog only).
    const killed =
      wind.speedKn > (b.kind === 'advection' ? 20 : 10) ||
      precipitationAt(state, at, t) > 0.35 ||
      (b.kind === 'advection' && airTempAt(state, at, t) < climate.waterC - 1);
    if (killed && b.life - b.age > 1.5 * HOUR) b.life = b.age + 1.5 * HOUR;
  }
  state.fogBanks = state.fogBanks.filter((b) => b.age < b.life);
}

/** Advance the weather to `t` (game seconds). Call once per world tick. */
export function weatherTick(state: WeatherState, t: number): void {
  const dt = t - state.tickSeconds;
  if (dt <= 0) return;
  const rng = Rng.fromState(state.rng);
  const climate = climateAtTime(t);

  for (const s of state.systems) {
    s.x += s.vx * dt;
    s.y += s.vy * dt;
    s.age += dt;
  }
  // A filled system stays on the books for the barometer's look-back window, so the
  // trend can still see the pressure it left behind.
  state.systems = state.systems.filter(
    (s) => s.age < s.life + TENDENCY_MEMORY_HOURS * HOUR && stillRelevant(s),
  );
  state.tickSeconds = t;

  if (livingSystems(state) < MAX_SYSTEMS && rng.chance(perTick(climate.lowsPerDay, dt))) {
    spawnSystem(state, rng, climate, 'low');
  }
  if (livingSystems(state) < MAX_SYSTEMS && rng.chance(perTick(climate.highsPerDay, dt))) {
    spawnSystem(state, rng, climate, 'high');
  }

  updateFog(state, climate, t, dt);
  spawnFog(state, rng, climate, t, dt);
  state.rng = rng.getState();
}

/**
 * Bring the weather up to `t` one world tick at a time: catches up after a load, a
 * migrated save or a jump in the clock. Returns the number of ticks run.
 */
export function advanceWeather(state: WeatherState, t: number): number {
  let ticks = 0;
  while (state.tickSeconds + WORLD_TICK_GAME_SECONDS <= t) {
    weatherTick(state, state.tickSeconds + WORLD_TICK_GAME_SECONDS);
    ticks++;
  }
  return ticks;
}
