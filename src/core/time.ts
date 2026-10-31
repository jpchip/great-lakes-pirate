/**
 * Game time (plan 01 §3.3, plan 03 §3.3, plan 04 §3.2–3.3).
 *
 * - R is game seconds per real second: 24 while sailing (a day ≈ 60 real minutes),
 *   6 on foot.
 * - The world ("strategic") tick runs every 10 game minutes.
 * - The season calendar runs 7 calendar days per game day, starting the week of
 *   Monday, May 7, 1900.
 */

export const R_SAILING = 24;
export const R_ON_FOOT = 6;

export const SECONDS_PER_GAME_MINUTE = 60;
export const SECONDS_PER_GAME_DAY = 24 * 60 * 60;
export const WORLD_TICK_GAME_SECONDS = 10 * SECONDS_PER_GAME_MINUTE;
export const CALENDAR_DAYS_PER_GAME_DAY = 7;

/** Monday, May 7, 1900, 00:00 (UTC is used throughout so time zones never matter). */
export const CALENDAR_START_MS = Date.UTC(1900, 4, 7);

/** Serializable clock state; lives in WorldState.environment. */
export interface ClockState {
  /** Game seconds elapsed since the start of the run. */
  gameSeconds: number;
  /** Game seconds accumulated toward the next world tick. */
  worldTickAccumulator: number;
}

export function createClockState(): ClockState {
  return { gameSeconds: 0, worldTickAccumulator: 0 };
}

/**
 * Advance the clock by `realSeconds` at `rate` (R). Returns the number of world ticks
 * that came due; the caller runs them.
 */
export function advanceClock(clock: ClockState, realSeconds: number, rate: number): number {
  return advanceGameTime(clock, realSeconds * rate);
}

/**
 * A playtest clock speed-up (`?timewarp=60`, the dev panel's Time folder): the clock and
 * the weather run this many times faster while the ship still sails at R. At 60 a game
 * day passes in a real minute, so a week of weather plays out in seven.
 */
export const MAX_TIME_WARP = 120;

/** Reads a `?timewarp=` value: 1 when missing or bad, otherwise clamped to 1–120. */
export function parseTimeWarp(value: string | null): number {
  const n = Number(value);
  if (value === null || !Number.isFinite(n)) return 1;
  return Math.min(MAX_TIME_WARP, Math.max(1, n));
}

/** Advance by game seconds directly (chart travel, waiting). Returns world ticks due. */
export function advanceGameTime(clock: ClockState, gameSeconds: number): number {
  if (gameSeconds <= 0) return 0;
  clock.gameSeconds += gameSeconds;
  clock.worldTickAccumulator += gameSeconds;
  const ticks = Math.floor(clock.worldTickAccumulator / WORLD_TICK_GAME_SECONDS);
  clock.worldTickAccumulator -= ticks * WORLD_TICK_GAME_SECONDS;
  return ticks;
}

/**
 * Batch fast-forward (jail, sleep, build sessions): runs every world tick in a tight
 * loop outside the per-frame budget. `onProgress` lets a progress screen update.
 */
export function fastForward(
  clock: ClockState,
  gameSeconds: number,
  worldTick: () => void,
  onProgress?: (done: number, total: number) => void,
): number {
  const ticks = advanceGameTime(clock, gameSeconds);
  for (let i = 0; i < ticks; i++) {
    worldTick();
    onProgress?.(i + 1, ticks);
  }
  return ticks;
}

/** Game day index (0 = the first day) and hours into it. */
export function dayAndHour(gameSeconds: number): { day: number; hour: number } {
  const day = Math.floor(gameSeconds / SECONDS_PER_GAME_DAY);
  return { day, hour: (gameSeconds - day * SECONDS_PER_GAME_DAY) / 3600 };
}

/** Calendar date (UTC) for the season calendar: each game day is one calendar week. */
export function calendarDate(gameSeconds: number): Date {
  const calendarMs = (gameSeconds / SECONDS_PER_GAME_DAY) * CALENDAR_DAYS_PER_GAME_DAY * 86_400_000;
  return new Date(CALENDAR_START_MS + calendarMs);
}
