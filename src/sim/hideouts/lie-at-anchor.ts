import { SECONDS_PER_GAME_DAY, WORLD_TICK_GAME_SECONDS } from '../../core/time';
import { sunAt } from '../weather/celestial';

/**
 * Lying at anchor until a set hour (plan 03 §2 "wait/sleep", plan 04 §3.3; Phase 4 piece
 * E): anchored in a sheltered spot, or alongside a pier, the captain can let the clock run
 * on until dawn, dusk or a shift of wind. The world ticks run as they do on the chart, so
 * the markets drift, the traffic sails and the weather moves on. It's refused under way,
 * with the anchor dragging, in an exposed spot, or with a ship under way in sight.
 */

export type LieUntil = 'dawn' | 'dusk' | 'wind';

export type LieRefusal = 'underWay' | 'dragging' | 'exposed' | 'shipInSight' | 'aground';

/** Shelter from the wind as it blows now, 0–1, that counts as a sheltered spot. */
export const SHELTERED_01 = 0.3;
/** Light airs: under this, any anchorage will do. */
export const LIGHT_AIRS_KN = 6;
/** A ship under way this close is "in sight", zone meters (about 1.5 real nm at C = 8). */
export const SIGHT_M = 350;
/** Moving this fast counts as under way, m/s. */
const STILL_MS = 0.3;
/** The wind has shifted when it backs or veers this far, or its speed changes this much. */
export const WIND_SHIFT_RAD = (45 * Math.PI) / 180;
export const WIND_CHANGE_KN = 8;
/** The longest lie: a full game day. */
export const MAX_LIE_S = SECONDS_PER_GAME_DAY;

export interface LieCheck {
  /** Anchored (anchor down) or alongside (docked). */
  moored: 'anchored' | 'docked' | 'no';
  speedMs: number;
  dragging: boolean;
  aground: boolean;
  shelter01: number;
  windKn: number;
  /** The nearest ship under way, zone meters; Infinity when none. */
  nearestUnderWayM: number;
}

export function lieRefusal(c: LieCheck): LieRefusal | undefined {
  if (c.aground) return 'aground';
  if (c.moored === 'no' || Math.abs(c.speedMs) > STILL_MS) return 'underWay';
  if (c.dragging) return 'dragging';
  if (c.moored === 'anchored' && c.shelter01 < SHELTERED_01 && c.windKn >= LIGHT_AIRS_KN)
    return 'exposed';
  if (c.nearestUnderWayM <= SIGHT_M) return 'shipInSight';
  return undefined;
}

export const LIE_REFUSALS: Record<LieRefusal, string> = {
  aground: "You're aground: get her off first.",
  underWay: 'Anchor or come alongside first.',
  dragging: 'The anchor is dragging.',
  exposed: 'Too exposed here: find a lee out of this wind.',
  shipInSight: "There's a ship in sight.",
};

/** Seconds from `gameSeconds` until the sun next rises (dawn) or sets (dusk). */
export function secondsUntil(until: 'dawn' | 'dusk', gameSeconds: number): number {
  const up = (t: number): boolean => sunAt(t).elevationRad > 0;
  const step = WORLD_TICK_GAME_SECONDS;
  let t = gameSeconds;
  // Step past the current state first, so asking at dusk for dusk waits a day.
  const want = until === 'dawn';
  let was = up(t);
  for (let k = 0; k < MAX_LIE_S / step; k++) {
    t += step;
    const now = up(t);
    if (now === want && was !== want) return t - gameSeconds;
    was = now;
  }
  return MAX_LIE_S;
}

export interface WindNow {
  fromRad: number;
  speedKn: number;
}

/** Whether the wind has shifted enough from `start` to stop a lie "until the wind shifts". */
export function windShifted(start: WindNow, now: WindNow): boolean {
  let d = Math.abs(now.fromRad - start.fromRad) % (2 * Math.PI);
  if (d > Math.PI) d = 2 * Math.PI - d;
  // A near calm has no direction to speak of: only its speed counts.
  const steady = start.speedKn >= 3 && now.speedKn >= 3;
  return (steady && d >= WIND_SHIFT_RAD) || Math.abs(now.speedKn - start.speedKn) >= WIND_CHANGE_KN;
}

/**
 * Runs the clock on in world ticks (the caller's `tick` advances the clock by one tick and
 * runs it) until the target: a set number of seconds, or the wind's shift. Returns the
 * game seconds that passed.
 */
export function lieAtAnchor(
  until: LieUntil,
  gameSeconds: number,
  tick: () => void,
  wind: () => WindNow,
): number {
  const step = WORLD_TICK_GAME_SECONDS;
  if (until !== 'wind') {
    const total = secondsUntil(until, gameSeconds);
    const ticks = Math.max(1, Math.round(total / step));
    for (let k = 0; k < ticks; k++) tick();
    return ticks * step;
  }
  const start = wind();
  let passed = 0;
  while (passed < MAX_LIE_S) {
    tick();
    passed += step;
    if (windShifted(start, wind())) break;
  }
  return passed;
}

/** "5 h 20 m", for the notice after a lie. */
export function lieText(until: LieUntil, seconds: number): string {
  const m = Math.round(seconds / 60);
  const span = m >= 60 ? `${Math.floor(m / 60)} h${m % 60 ? ` ${m % 60} m` : ''}` : `${m} m`;
  const what =
    until === 'dawn' ? 'until dawn' : until === 'dusk' ? 'until dusk' : 'until the wind shifts';
  return until === 'wind' && seconds >= MAX_LIE_S
    ? `You lay at anchor a day (${span}); the wind held.`
    : `You lay at anchor ${what} (${span}).`;
}
