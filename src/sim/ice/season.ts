import iceJson from '../../../data/ice.json';
import { iceFileSchema, type IceFile } from '../../../data/schemas/ice';
import { Rng } from '../../core/rng';
import {
  CALENDAR_DAYS_PER_GAME_DAY,
  CALENDAR_START_MS,
  SECONDS_PER_GAME_DAY,
} from '../../core/time';
import { climateAt } from '../weather/climate';

/**
 * The year turning (plan 04 §4.2, §8.1; plan 11 §18.4 piece K): each winter's roll and its
 * ice, worked out a calendar day at a time from freezing and thawing degree-days.
 *
 * A winter runs from October 1 of its year to the end of June of the next. Its roll comes
 * from the run's seed and the year, so the same run always has the same winters: a
 * severity (how much colder or milder than the normals, December to March), a day-to-day
 * anomaly over it, and the fall's storms. The ice is then worked out for `CLASSES` shelter
 * classes from the open lake (0) to the most sheltered, shallow bay (1):
 *
 * - **Cooling.** Open water must give up its summer heat before it freezes: the degrees
 *   below 0 summed from October, less a share of the warm days, against a need that falls
 *   from `coolOpenFdd` in the open lake to `coolShelteredFdd` in a shallow bay. Sheltered
 *   bays freeze first, the open lake late or not at all.
 * - **Growth** by Stefan's law, h² grows by stefan² × each day's freezing degrees, and
 *   **melt** by `meltCm` a thawing degree-day. Coverage follows thickness up to
 *   `coverCm`; below `packBelow` the ice is pack, never quite closing the lake.
 * - **Breakup** after mid-March, once the ice has thinned: the cover breaks into floes that
 *   clear in a week or three (the open lake first), and the water is open: ice-out.
 *
 * Everything here is a pure function of the seed and the date, so the traffic's
 * timetable, the markets and the chart all read the same ice without saving it.
 */

export const ICE: IceFile = iceFileSchema.parse(iceJson);

const DAY_MS = 86_400_000;
/** Shelter classes, 0 (open lake) to 1 (a shallow, enclosed bay), evenly spaced. */
export const CLASSES = 21;
/** Days in a winter's series: October 1 to June 30. */
export const WINTER_DAYS = 273;

export type IceKind = 'open' | 'forming' | 'fast' | 'pack' | 'floes';
export const ICE_KINDS: readonly IceKind[] = ['open', 'forming', 'fast', 'pack', 'floes'];

/** Ice at a place and time. */
export interface IceSample {
  /** Share of the water covered, 0–1. */
  coverage: number;
  /** Thickness, cm. */
  thicknessCm: number;
  kind: IceKind;
}

export const OPEN_WATER: Readonly<IceSample> = { coverage: 0, thicknessCm: 0, kind: 'open' };

/** One winter's roll and its ice by shelter class and calendar day. */
export interface Winter {
  /** The year it starts in (the winter of 1900–01 is 1900). */
  year: number;
  /** −2 (mild) … 2 (severe); 0 is the normals. */
  severity: number;
  /** Gales' share of new lows, times the normals, October to December. */
  fallStorms: number;
  /** The air's daily mean, °C, by day of the winter (normals, roll and anomaly). */
  airC: Float32Array;
  /** Per class × day: thickness cm and coverage, and the kind's index in ICE_KINDS. */
  thicknessCm: Float32Array;
  coverage: Float32Array;
  kind: Uint8Array;
}

/** Calendar ms of a game time. */
export function calendarMs(gameSeconds: number): number {
  return CALENDAR_START_MS + (gameSeconds / SECONDS_PER_GAME_DAY) * CALENDAR_DAYS_PER_GAME_DAY * DAY_MS;
}

/** The game time a calendar moment falls at. */
export function gameSecondsAt(ms: number): number {
  return ((ms - CALENDAR_START_MS) / (CALENDAR_DAYS_PER_GAME_DAY * DAY_MS)) * SECONDS_PER_GAME_DAY;
}

/** The winter a calendar moment falls in and its day (fractional) from October 1; undefined in July–September. */
export function winterDay(ms: number): { year: number; day: number } | undefined {
  const d = new Date(ms);
  const y = d.getUTCFullYear();
  const m = d.getUTCMonth();
  if (m >= 6 && m <= 8) return undefined;
  const year = m >= 9 ? y : y - 1;
  return { year, day: (ms - Date.UTC(year, 9, 1)) / DAY_MS };
}

/** How much of the severity a day of the winter feels: all of it December to March. */
function winterWeight(ms: number): number {
  const d = new Date(ms);
  const m = d.getUTCMonth();
  const f = (d.getUTCDate() - 1) / 30;
  if (m === 10) return f; // November: rising
  if (m === 11 || m <= 2) return 1;
  if (m === 3) return 1 - f; // April: falling
  return 0;
}

/** The winter's roll: its severity, its fall storms and the anomaly's draws. */
function rollWinter(seed: string, year: number): { severity: number; fallStorms: number; rng: Rng } {
  const rng = Rng.fromSeed(`${seed}|winter|${year}`);
  const y = ICE.year;
  // A sum of three uniforms: most winters near the normals, a few hard or open ones.
  const u = (rng.next() + rng.next() + rng.next()) / 3;
  const severity = (u * 2 - 1) * y.severityMax * 1.5;
  const clamped = Math.max(-y.severityMax, Math.min(y.severityMax, severity));
  const fallStorms = rng.range(y.fallStorms[0], y.fallStorms[1]);
  return { severity: clamped, fallStorms, rng };
}

const shelterOf = (c: number): number => c / (CLASSES - 1);

/** Works a winter out (cached by the caller). */
export function computeWinter(seed: string, year: number): Winter {
  const g = ICE.growth;
  const { severity, fallStorms, rng } = rollWinter(seed, year);
  const start = Date.UTC(year, 9, 1);
  const airC = new Float32Array(WINTER_DAYS);
  let anomaly = 0;
  const keep = ICE.year.anomalyKeep;
  const spread = ICE.year.anomalyC * Math.sqrt(1 - keep * keep);
  for (let d = 0; d < WINTER_DAYS; d++) {
    const ms = start + (d + 0.5) * DAY_MS;
    const c = climateAt(new Date(ms));
    // A rough normal draw: the anomaly wanders a few degrees about the normals.
    const n = (rng.next() + rng.next() + rng.next() + rng.next() - 2) * Math.sqrt(3);
    anomaly = keep * anomaly + spread * n;
    const w = winterWeight(ms);
    airC[d] = (c.airMaxC + c.airMinC) / 2 - severity * ICE.year.severityC * w + anomaly * w;
  }

  const thicknessCm = new Float32Array(CLASSES * WINTER_DAYS);
  const coverage = new Float32Array(CLASSES * WINTER_DAYS);
  const kind = new Uint8Array(CLASSES * WINTER_DAYS);
  const breakupDay = (Date.UTC(year + 1, g.breakup.month, g.breakup.day) - start) / DAY_MS;
  const kOf = (k: IceKind): number => ICE_KINDS.indexOf(k);

  for (let c = 0; c < CLASSES; c++) {
    const shelter = shelterOf(c);
    const need = g.coolShelteredFdd + (g.coolOpenFdd - g.coolShelteredFdd) * (1 - shelter) ** g.coolPower;
    const pack = shelter < g.packBelow;
    const maxCover = pack ? g.packMaxCoverage : 1;
    const cd = g.breakup.clearDays;
    const clearDays = cd[0] + (cd[1] - cd[0]) * shelter;
    let cooled = 0;
    let h = 0;
    let broken = false;
    let brokenCover = 0;
    for (let d = 0; d < WINTER_DAYS; d++) {
      const t = airC[d] as number;
      const frost = Math.max(0, -t);
      const thaw = Math.max(0, t);
      if (!broken) {
        cooled = Math.max(0, cooled + frost - g.warmBack * thaw);
        if (cooled >= need || h > 0) {
          if (frost > 0) h = Math.sqrt(h * h + g.stefanCm * g.stefanCm * frost);
          h = Math.max(0, h - g.meltCm * thaw);
          // Ice melted out before midwinter has to be cooled for again.
          if (h === 0) cooled = Math.min(cooled, need * 0.8);
        }
        if (d >= breakupDay && h > 0 && h < g.breakup.underCm) {
          broken = true;
          brokenCover = Math.min(maxCover, h / g.coverCm);
        }
      } else {
        h = Math.max(0, h - g.meltCm * thaw);
        brokenCover = Math.max(0, brokenCover - 1 / clearDays);
        if (h === 0) brokenCover = 0;
      }
      const i = c * WINTER_DAYS + d;
      thicknessCm[i] = h;
      let cov: number;
      let k: IceKind;
      if (broken) {
        cov = brokenCover;
        k = cov < 0.05 ? 'open' : 'floes';
      } else {
        cov = Math.min(maxCover, h / g.coverCm);
        k = cov < 0.05 ? 'open' : h < g.coverCm ? 'forming' : pack ? 'pack' : 'fast';
      }
      coverage[i] = cov;
      kind[i] = kOf(k);
    }
  }
  return { year, severity, fallStorms, airC, thicknessCm, coverage, kind };
}

/** Winters worked out, by seed and year; a run looks at two or three at a time. */
const cache = new Map<string, Winter>();
const CACHE_MAX = 6;

export function winterOf(seed: string, year: number): Winter {
  const key = `${seed}|${year}`;
  let w = cache.get(key);
  if (!w) {
    w = computeWinter(seed, year);
    if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value as string);
    cache.set(key, w);
  }
  return w;
}

/** Ice in a shelter class (fractional) on a winter's day (fractional), interpolated. */
export function sampleWinter(w: Winter, shelter: number, day: number): IceSample {
  if (day < 0 || day > WINTER_DAYS - 1) return OPEN_WATER;
  const cf = Math.max(0, Math.min(1, shelter)) * (CLASSES - 1);
  const c0 = Math.min(Math.floor(cf), CLASSES - 2);
  const tc = cf - c0;
  const d0 = Math.min(Math.floor(day), WINTER_DAYS - 2);
  const td = day - d0;
  const at = (arr: Float32Array): number => {
    const a = c0 * WINTER_DAYS + d0;
    const b = (c0 + 1) * WINTER_DAYS + d0;
    const lo = (arr[a] as number) * (1 - td) + (arr[a + 1] as number) * td;
    const hi = (arr[b] as number) * (1 - td) + (arr[b + 1] as number) * td;
    return lo * (1 - tc) + hi * tc;
  };
  const coverage = at(w.coverage);
  const thicknessCm = at(w.thicknessCm);
  // The nearer class and day name the kind.
  const ki = w.kind[(c0 + (tc >= 0.5 ? 1 : 0)) * WINTER_DAYS + d0 + (td >= 0.5 ? 1 : 0)] as number;
  return { coverage, thicknessCm, kind: coverage < 0.05 ? 'open' : (ICE_KINDS[ki] as IceKind) };
}

/** Ice in a shelter class at a game time. */
export function iceForShelter(seed: string, shelter: number, gameSeconds: number): IceSample {
  const wd = winterDay(calendarMs(gameSeconds));
  if (!wd) return OPEN_WATER;
  return sampleWinter(winterOf(seed, wd.year), shelter, wd.day);
}

/** The roll of the winter a game time falls in or follows (July–September: the coming one). */
export function winterAt(seed: string, gameSeconds: number): Winter {
  const ms = calendarMs(gameSeconds);
  const wd = winterDay(ms);
  return winterOf(seed, wd?.year ?? new Date(ms).getUTCFullYear());
}

/**
 * The air's offset from the normals a game time feels from its winter's roll, °C: the
 * severity and the day's anomaly, December to March (ramping in November and out in
 * April). 0 in summer. The weather's `airTempAt` adds it.
 */
export function airOffsetC(seed: string, gameSeconds: number): number {
  const ms = calendarMs(gameSeconds);
  const wd = winterDay(ms);
  if (!wd) return 0;
  const w = winterOf(seed, wd.year);
  const d = Math.max(0, Math.min(WINTER_DAYS - 1, Math.floor(wd.day)));
  const c = climateAt(new Date(Date.UTC(wd.year, 9, 1) + (d + 0.5) * DAY_MS));
  return (w.airC[d] as number) - (c.airMaxC + c.airMinC) / 2;
}

/** The fall storms' multiplier on gales, October to December; 1 otherwise. */
export function fallStormsAt(seed: string, gameSeconds: number): number {
  const m = new Date(calendarMs(gameSeconds)).getUTCMonth();
  if (m < 9) return 1;
  return winterAt(seed, gameSeconds).fallStorms;
}

/**
 * When a shelter class closes (freeze-up) and opens again (ice-out) in a winter, as game
 * seconds: the first day the ice holds `closed`, and the first day after it that `open`
 * holds. Either may be missing (a mild winter never closes the open lake).
 */
export function closeAndOpen(
  w: Winter,
  shelter: number,
  closed: (s: IceSample) => boolean,
  open: (s: IceSample) => boolean,
): { closeAt?: number; openAt?: number } {
  const start = Date.UTC(w.year, 9, 1);
  let closeAt: number | undefined;
  for (let d = 0; d < WINTER_DAYS; d++) {
    const s = sampleWinter(w, shelter, d);
    if (closeAt === undefined) {
      if (closed(s)) closeAt = gameSecondsAt(start + d * DAY_MS);
    } else if (open(s)) {
      return { closeAt, openAt: gameSecondsAt(start + d * DAY_MS) };
    }
  }
  return closeAt === undefined ? {} : { closeAt };
}
