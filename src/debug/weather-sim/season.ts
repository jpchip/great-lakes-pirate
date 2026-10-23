import type { Chart } from '../../core/coords';
import { SECONDS_PER_GAME_DAY, WORLD_TICK_GAME_SECONDS, calendarDate } from '../../core/time';
import { PROBES } from '../../sim/weather/geography';
import {
  airTempAt,
  barometerAt,
  barometerTrend,
  createWeatherState,
  precipitationAt,
  visibilityAt,
  weatherTick,
  windAt,
  type BarometerTrend,
  type WeatherState,
} from '../../sim/weather/weather';

/**
 * Spike S9 harness: run the weather sim over a season and read instruments at a few
 * probes on every world tick, then score it (plan 04 §16). Shared by the chart page,
 * the unit tests and the report script.
 */

export interface ProbeSeries {
  id: string;
  name: string;
  at: Chart;
  hpa: Float32Array;
  tendency: Float32Array;
  windKn: Float32Array;
  fromDeg: Float32Array;
  gust: Float32Array;
  visibilityM: Float32Array;
  rain: Float32Array;
  airC: Float32Array;
}

export interface SystemRecord {
  id: number;
  kind: 'low' | 'high';
  track: string;
  peakHpa: number;
  bornAt: number;
}

export interface FogRecord {
  id: number;
  kind: 'advection' | 'radiation';
  bornAt: number;
}

export interface SeasonRun {
  seed: string;
  /** Game seconds of each sample. */
  t: Float64Array;
  probes: ProbeSeries[];
  systems: SystemRecord[];
  fogBanks: FogRecord[];
  /** Time spent in weatherTick alone, ms, and the tick count. */
  tickMs: number;
  ticks: number;
  /** Optional snapshots for the chart page's scrubber, one per tick. */
  snapshots?: WeatherState[];
}

export const GALE_KN = 34;
export const STRONG_KN = 28;
export const THICK_FOG_M = 400;

export function runSeason(
  seed: string,
  gameDays: number,
  options: { snapshots?: boolean } = {},
): SeasonRun {
  const state = createWeatherState(seed);
  const n = Math.round((gameDays * SECONDS_PER_GAME_DAY) / WORLD_TICK_GAME_SECONDS);
  const t = new Float64Array(n);
  const probes: ProbeSeries[] = PROBES.map((p) => ({
    ...p,
    hpa: new Float32Array(n),
    tendency: new Float32Array(n),
    windKn: new Float32Array(n),
    fromDeg: new Float32Array(n),
    gust: new Float32Array(n),
    visibilityM: new Float32Array(n),
    rain: new Float32Array(n),
    airC: new Float32Array(n),
  }));
  const systems = new Map<number, SystemRecord>();
  const fogBanks = new Map<number, FogRecord>();
  const snapshots: WeatherState[] | undefined = options.snapshots ? [] : undefined;
  let tickMs = 0;

  for (let i = 0; i < n; i++) {
    const now = (i + 1) * WORLD_TICK_GAME_SECONDS;
    const start = performance.now();
    weatherTick(state, now);
    tickMs += performance.now() - start;
    t[i] = now;
    for (const s of state.systems) {
      if (!systems.has(s.id)) {
        systems.set(s.id, {
          id: s.id,
          kind: s.kind,
          track: s.track,
          peakHpa: s.peakHpa,
          bornAt: now - s.age,
        });
      }
    }
    for (const b of state.fogBanks) {
      if (!fogBanks.has(b.id)) fogBanks.set(b.id, { id: b.id, kind: b.kind, bornAt: now - b.age });
    }
    for (const p of probes) {
      const baro = barometerAt(state, p.at, now);
      const wind = windAt(state, p.at, now);
      p.hpa[i] = baro.hpa;
      p.tendency[i] = baro.tendency3h;
      p.windKn[i] = wind.speedKn;
      p.fromDeg[i] = (wind.fromRad * 180) / Math.PI;
      p.gust[i] = wind.gust01;
      p.visibilityM[i] = visibilityAt(state, p.at, now);
      p.rain[i] = precipitationAt(state, p.at, now);
      p.airC[i] = airTempAt(state, p.at, now);
    }
    snapshots?.push(structuredClone(state));
  }

  return {
    seed,
    t,
    probes,
    systems: [...systems.values()],
    fogBanks: [...fogBanks.values()],
    tickMs,
    ticks: n,
    ...(snapshots ? { snapshots } : {}),
  };
}

// ---------------------------------------------------------------------------------
// Scoring

const MONTH_NAMES = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
];
const SECTORS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'] as const;

export interface MonthStats {
  month: string;
  samples: number;
  meanWindKn: number;
  p90WindKn: number;
  maxWindKn: number;
  /** Share of time at or above 28 and 34 knots. */
  strongShare: number;
  galeShare: number;
  galeOnsets: number;
  minHpa: number;
  maxHpa: number;
  /** Share of time under 1 km and under 400 m. */
  fogShare: number;
  thickFogShare: number;
  /** Game days in this month with any thick fog, out of the days sampled. */
  thickFogDays: number;
  days: number;
  /** Share of time the wind came from each of 8 sectors. */
  sectors: Record<(typeof SECTORS)[number], number>;
}

function sector(fromDeg: number): (typeof SECTORS)[number] {
  return SECTORS[Math.round(fromDeg / 45) % 8] as (typeof SECTORS)[number];
}

/** Indexes where a run at or above `kn` starts (after at least 3 h below it). */
export function onsets(series: Float32Array, kn: number, quietTicks = 18): number[] {
  const out: number[] = [];
  let below = quietTicks;
  for (let i = 0; i < series.length; i++) {
    if ((series[i] as number) >= kn) {
      if (below >= quietTicks) out.push(i);
      below = 0;
    } else {
      below++;
    }
  }
  return out;
}

export function monthStats(run: SeasonRun, probe: ProbeSeries): MonthStats[] {
  const byMonth = new Map<number, number[]>();
  for (let i = 0; i < run.t.length; i++) {
    const d = calendarDate(run.t[i] as number);
    const key = d.getUTCFullYear() * 12 + d.getUTCMonth();
    let list = byMonth.get(key);
    if (!list) byMonth.set(key, (list = []));
    list.push(i);
  }
  const galeStarts = new Set(onsets(probe.windKn, GALE_KN));
  const out: MonthStats[] = [];
  for (const [key, idx] of [...byMonth.entries()].sort((a, b) => a[0] - b[0])) {
    const winds = idx.map((i) => probe.windKn[i] as number).sort((a, b) => a - b);
    const sectors = Object.fromEntries(SECTORS.map((s) => [s, 0])) as MonthStats['sectors'];
    const fogDays = new Set<number>();
    const allDays = new Set<number>();
    let fog = 0;
    let thick = 0;
    for (const i of idx) {
      const day = Math.floor((run.t[i] as number) / SECONDS_PER_GAME_DAY);
      allDays.add(day);
      sectors[sector(probe.fromDeg[i] as number)] += 1 / idx.length;
      const vis = probe.visibilityM[i] as number;
      if (vis < 1000) fog++;
      if (vis < THICK_FOG_M) {
        thick++;
        fogDays.add(day);
      }
    }
    const hpas = idx.map((i) => probe.hpa[i] as number);
    out.push({
      month: MONTH_NAMES[key % 12] as string,
      samples: idx.length,
      meanWindKn: winds.reduce((a, b) => a + b, 0) / winds.length,
      p90WindKn: winds[Math.floor(winds.length * 0.9)] as number,
      maxWindKn: winds[winds.length - 1] as number,
      strongShare: winds.filter((w) => w >= STRONG_KN).length / winds.length,
      galeShare: winds.filter((w) => w >= GALE_KN).length / winds.length,
      galeOnsets: idx.filter((i) => galeStarts.has(i)).length,
      minHpa: Math.min(...hpas),
      maxHpa: Math.max(...hpas),
      fogShare: fog / idx.length,
      thickFogShare: thick / idx.length,
      thickFogDays: fogDays.size,
      days: allDays.size,
      sectors,
    });
  }
  return out;
}

export interface BarometerSkill {
  /** Tendency threshold used as the warning, hPa per 3 h (negative). */
  thresholdHpa: number;
  storms: number;
  /** Storms with the barometer at or below the threshold in the 18 hours before onset. */
  warned: number;
  /** Median hours from the start of the fall that warned of a storm to its onset. */
  medianLeadHours: number;
  /** Warning episodes, and how many were followed by a storm within 18 hours. */
  warnings: number;
  warningsFollowed: number;
}

/**
 * How well a falling barometer predicts a storm (≥ 28 kn) at a probe. A warning
 * episode starts when the 3-hour tendency first drops to `thresholdHpa` after at least
 * 6 hours above it.
 */
export function barometerSkill(
  probe: ProbeSeries,
  thresholdHpa: number,
  stormKn = STRONG_KN,
  windowTicks = 108,
): BarometerSkill {
  const storms = onsets(probe.windKn, stormKn);
  const warnings: number[] = [];
  let calm = 36;
  for (let i = 0; i < probe.tendency.length; i++) {
    if ((probe.tendency[i] as number) <= thresholdHpa) {
      if (calm >= 36) warnings.push(i);
      calm = 0;
    } else {
      calm++;
    }
  }
  const leads: number[] = [];
  let warned = 0;
  for (const s of storms) {
    // The latest fall below the threshold in the window before onset, traced back to
    // where that fall began: that's when an attentive player first got the warning.
    let w = -1;
    for (let i = s; i >= Math.max(0, s - windowTicks); i--) {
      if ((probe.tendency[i] as number) <= thresholdHpa) {
        w = i;
        break;
      }
    }
    if (w < 0) continue;
    while (w > 0 && (probe.tendency[w - 1] as number) <= thresholdHpa) w--;
    warned++;
    leads.push(((s - w) * WORLD_TICK_GAME_SECONDS) / 3600);
  }
  leads.sort((a, b) => a - b);
  let followed = 0;
  for (const w of warnings) {
    let hit = false;
    for (let i = w; i < Math.min(probe.windKn.length, w + windowTicks); i++) {
      if ((probe.windKn[i] as number) >= stormKn) {
        hit = true;
        break;
      }
    }
    if (hit) followed++;
  }
  return {
    thresholdHpa,
    storms: storms.length,
    warned,
    medianLeadHours: leads.length ? (leads[Math.floor(leads.length / 2)] as number) : NaN,
    warnings: warnings.length,
    warningsFollowed: followed,
  };
}

export interface TrendOutlook {
  trend: BarometerTrend;
  /** Share of all samples in this trend class. */
  share: number;
  /** Mean of the strongest wind in the next `hours`, knots. */
  meanMaxWindKn: number;
  /** Share of samples followed by ≥ 28 kn within `hours`. */
  stormShare: number;
}

const TRENDS: readonly BarometerTrend[] = [
  'rising fast',
  'rising',
  'steady',
  'falling',
  'falling fast',
];

/** What each barometer reading tends to be followed by: the player-facing rule of thumb. */
export function trendOutlook(probes: readonly ProbeSeries[], hours = 12): TrendOutlook[] {
  const ahead = Math.round((hours * 3600) / WORLD_TICK_GAME_SECONDS);
  const acc = new Map(TRENDS.map((t) => [t, { n: 0, sumMax: 0, storms: 0 }]));
  let total = 0;
  for (const p of probes) {
    for (let i = 0; i + ahead < p.windKn.length; i++) {
      let max = 0;
      for (let j = i; j <= i + ahead; j++) max = Math.max(max, p.windKn[j] as number);
      const a = acc.get(barometerTrend(p.tendency[i] as number));
      if (!a) continue;
      a.n++;
      a.sumMax += max;
      if (max >= STRONG_KN) a.storms++;
      total++;
    }
  }
  return TRENDS.map((trend) => {
    const a = acc.get(trend) ?? { n: 0, sumMax: 0, storms: 0 };
    return {
      trend,
      share: a.n / total,
      meanMaxWindKn: a.n ? a.sumMax / a.n : NaN,
      stormShare: a.n ? a.storms / a.n : NaN,
    };
  });
}
