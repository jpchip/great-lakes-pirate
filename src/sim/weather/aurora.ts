import { Rng } from '../../core/rng';
import { calendarDate, SECONDS_PER_GAME_DAY } from '../../core/time';
import { WINTER_LOOK } from '../ice/snow';

/**
 * The northern lights (plan 04 §9 "Aurora", cut #3 lifted by plan 11 §18.4 piece L): an
 * occasional fall and winter night's display, rolled per night from the run's seed. A
 * night's chance comes from its month and the sunspot cycle (cycle 14 peaked early in
 * 1906, so the later runs see more); a display starts in the evening, builds, holds and
 * fades over a few hours.
 *
 * This is the display's own strength: the renderer shows it only in the dark and through
 * a clear sky, so a cloudy night hides one that's there.
 */

export interface AuroraNight {
  /** 0–1 at its height. */
  strength: number;
  /** Game seconds it starts and ends. */
  startAt: number;
  endAt: number;
}

/** The share of the monthly chance the sunspot cycle allows in a year (fractional). */
export function auroraCycleShare(year: number): number {
  const c = WINTER_LOOK.aurora.cycle;
  const phase = Math.cos((2 * Math.PI * (year - c.maxYear)) / c.periodYears);
  return c.minShare + (1 - c.minShare) * (0.5 + 0.5 * phase);
}

/**
 * The display on the night of game day `day` (its evening and the small hours after), or
 * undefined for a dark sky.
 */
export function auroraNight(seed: string, day: number): AuroraNight | undefined {
  const a = WINTER_LOOK.aurora;
  const evening = calendarDate(day * SECONDS_PER_GAME_DAY + 20 * 3600);
  const year = evening.getUTCFullYear() + evening.getUTCMonth() / 12;
  const chance = (a.nightChance[evening.getUTCMonth()] as number) * auroraCycleShare(year);
  const rng = Rng.fromSeed(`${seed}|aurora|${day}`);
  const roll = rng.next();
  const strength = rng.range(a.strength[0], a.strength[1]);
  const start = rng.range(a.startHour[0], a.startHour[1]);
  const hours = rng.range(a.hours[0], a.hours[1]);
  if (roll >= chance) return undefined;
  const startAt = day * SECONDS_PER_GAME_DAY + start * 3600;
  return { strength, startAt, endAt: startAt + hours * 3600 };
}

/** The display's strength now, 0–1: building over its first hour, fading over its last. */
export function auroraAt(seed: string, gameSeconds: number): number {
  // A night belongs to the day whose evening it is: from noon to noon.
  const day = Math.floor((gameSeconds - 12 * 3600) / SECONDS_PER_GAME_DAY);
  const night = auroraNight(seed, day);
  if (!night || gameSeconds <= night.startAt || gameSeconds >= night.endAt) return 0;
  const len = night.endAt - night.startAt;
  const ramp = Math.min(3600, len / 3);
  const env = Math.min(1, (gameSeconds - night.startAt) / ramp, (night.endAt - gameSeconds) / ramp);
  return night.strength * env * env * (3 - 2 * env);
}
