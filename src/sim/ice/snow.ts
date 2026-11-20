import winterJson from '../../../data/winter.json';
import { winterFileSchema, type WinterFile } from '../../../data/schemas/winter';
import { Rng } from '../../core/rng';
import { calendarMs, WINTER_DAYS, winterDay, winterOf, type Winter } from './season';

/**
 * The snow on the ground (plan 04 §11; plan 11 §18.4 piece L): worked out a calendar day
 * at a time over each winter's air, the same series the ice grows from (piece K's
 * `Winter.airC`), so a hard winter is a white one and a thaw that opens the bays bares the
 * shore too. A day brings snow by its month's chance, falling as snow below
 * `fallsBelowC` and as rain (which eats into the snow) above; the snow settles a little
 * each day and melts by the thawing degree-days.
 *
 * Like the ice it's a pure function of the run's seed and the date: nothing is saved, and
 * every system that looks (the renderer's snow cover, the palettes, tracks in piece M)
 * reads the same snow. One series covers the whole western lake.
 */

export const WINTER_LOOK: WinterFile = winterFileSchema.parse(winterJson);

const DAY_MS = 86_400_000;

/** One winter's snow on the ground, cm, by day from October 1. */
export interface SnowSeries {
  year: number;
  depthCm: Float32Array;
}

export interface SnowSample {
  /** Snow on the ground, cm. */
  depthCm: number;
  /** How much of the ground it covers, 0 (bare) to 1 (white). */
  cover01: number;
}

export const NO_SNOW: Readonly<SnowSample> = { depthCm: 0, cover01: 0 };

/** Works out a winter's snow from its air (cached by the caller). */
export function computeSnow(seed: string, w: Winter): SnowSeries {
  const s = WINTER_LOOK.snow;
  const rng = Rng.fromSeed(`${seed}|snow|${w.year}`);
  const start = Date.UTC(w.year, 9, 1);
  const depthCm = new Float32Array(WINTER_DAYS);
  let depth = 0;
  for (let d = 0; d < WINTER_DAYS; d++) {
    const month = new Date(start + (d + 0.5) * DAY_MS).getUTCMonth();
    const t = w.airC[d] as number;
    // Both draws every day, so one day's weather never shifts the next's.
    const falls = rng.next() < (s.dayChance[month] as number);
    const amount = rng.range(s.cmPerDay[0], s.cmPerDay[1]);
    if (falls) depth += t < s.fallsBelowC ? amount : -0.5 * amount;
    depth -= s.meltCm * Math.max(0, t);
    depth = Math.max(0, depth * (1 - s.settle));
    depthCm[d] = depth;
  }
  return { year: w.year, depthCm };
}

const cache = new Map<string, SnowSeries>();
const CACHE_MAX = 6;

export function snowOf(seed: string, year: number): SnowSeries {
  const key = `${seed}|${year}`;
  let s = cache.get(key);
  if (!s) {
    s = computeSnow(seed, winterOf(seed, year));
    if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value as string);
    cache.set(key, s);
  }
  return s;
}

/** Cover from depth: a dusting shows, and `coverCm` whitens the ground. */
export function snowCover(depthCm: number): number {
  if (depthCm <= 0) return 0;
  return Math.min(1, depthCm / WINTER_LOOK.snow.coverCm) ** 0.6;
}

/** The snow on the ground at a game time, interpolated between calendar days. */
export function snowAt(seed: string, gameSeconds: number): SnowSample {
  const wd = winterDay(calendarMs(gameSeconds));
  if (!wd) return NO_SNOW;
  const series = snowOf(seed, wd.year).depthCm;
  const f = Math.max(0, Math.min(WINTER_DAYS - 1, wd.day - 0.5));
  const d0 = Math.min(Math.floor(f), WINTER_DAYS - 2);
  const t = f - d0;
  const depthCm = (series[d0] as number) * (1 - t) + (series[d0 + 1] as number) * t;
  return { depthCm, cover01: snowCover(depthCm) };
}

/**
 * The day's mean air at a game time, °C: the winter's own series (normals, roll and
 * anomaly), October to June; undefined in July to September, when the look is summer's.
 */
export function winterAirAt(seed: string, gameSeconds: number): number | undefined {
  const wd = winterDay(calendarMs(gameSeconds));
  if (!wd) return undefined;
  const air = winterOf(seed, wd.year).airC;
  const d = Math.max(0, Math.min(WINTER_DAYS - 1, Math.floor(wd.day)));
  return air[d] as number;
}

/**
 * How wintry the season looks, 0 (summer) to 1 (deep winter): the palettes' blend. The
 * colder of the day's air and the snow on the ground, so a bare cold snap still reads cold
 * and a late snow still reads white.
 */
export function winterLookAt(seed: string, gameSeconds: number): number {
  const air = winterAirAt(seed, gameSeconds);
  if (air === undefined) return 0;
  const cold = Math.max(0, Math.min(1, (4 - air) / 12));
  return Math.max(cold, 0.8 * snowAt(seed, gameSeconds).cover01);
}
