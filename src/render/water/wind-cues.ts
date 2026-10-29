import { DEFAULT_COMPRESSION, knotsToMs } from '../../core/coords';
import { R_SAILING } from '../../core/time';
import type { LocalWeather } from '../../sim/weather/local-weather';
import type { WaterUniforms } from './water-material';

/**
 * Wind cues on the water (plan 02 §9): cat's-paws that show a gust before it reaches the
 * ship, foam streaks along the wind in a blow, and surf on the shore that follows the
 * sea. Cheap CPU work each frame that feeds the water shader's uniforms.
 *
 * Gusts in `windAt` are a function of time, the same everywhere. The shader draws the
 * gust that will reach the ship in s seconds at the spot the air is s seconds upwind of
 * it, and the patches drift downwind at the wind's scene speed, so a dark patch on the
 * water arrives at the ship as the gust does.
 */

/** Gust samples looking ahead, one per real second. */
export const GUST_SAMPLES = 16;
const GUST_STEP_S = 1;

/** Cat's-paws show from a light breeze, foam streaks from a strong one (knots). */
const PAWS_FROM_KN = 4;
const PAWS_FULL_KN = 10;
const STREAKS_FROM_KN = 14;
const STREAKS_FULL_KN = 32;
/** Significant wave heights where the surf on the shore starts and is full. */
const SURF_FROM_M = 0.15;
const SURF_FULL_M = 1.5;

function smoothstep(a: number, b: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

/** Scene meters per second of the air for a wind in knots, as ships move (v × R / C). */
export function windFlowMs(speedKn: number): number {
  return (knotsToMs(speedKn) * R_SAILING) / DEFAULT_COMPRESSION;
}

export interface WindCues {
  /** All cues off while false (the water bench measures the cost this way). */
  enabled: boolean;
  /** Cat's-paws for the quality preset (off on Low); streaks don't depend on it. */
  catsPaws: boolean;
  /**
   * Updates the uniforms for the wind at `at` (the ship) at game time `gameSeconds`;
   * `seaTime` is the water's clock, which the patches drift with.
   */
  update(at: { x: number; z: number }, gameSeconds: number, seaTime: number): void;
}

/** Wraps the drift offset now and then so it keeps float precision on the GPU. */
const OFFSET_WRAP_M = 50_000;

export function createWindCues(u: WaterUniforms, weather: LocalWeather): WindCues {
  let lastSeaTime: number | undefined;
  const cues: WindCues = {
    enabled: true,
    catsPaws: true,
    update(at, gameSeconds, seaTime) {
      const wind = weather.windAt(at, gameSeconds);
      u.uWindDir.value.set(-Math.sin(wind.fromRad), Math.cos(wind.fromRad));
      // Integrate the drift rather than flow × time, so a change of wind speed doesn't
      // slide the whole pattern.
      const flow = windFlowMs(wind.speedKn);
      const dt = lastSeaTime === undefined ? 0 : Math.min(Math.max(seaTime - lastSeaTime, 0), 0.25);
      lastSeaTime = seaTime;
      u.uWindOffset.value = (u.uWindOffset.value + flow * dt) % OFFSET_WRAP_M;
      u.uCatsPaws.value =
        cues.enabled && cues.catsPaws ? smoothstep(PAWS_FROM_KN, PAWS_FULL_KN, wind.speedKn) : 0;
      u.uStreaks.value = cues.enabled
        ? smoothstep(STREAKS_FROM_KN, STREAKS_FULL_KN, wind.speedKn)
        : 0;
      u.uGustOrigin.value.set(at.x, at.z, Math.max(1, flow * GUST_STEP_S));
      const ahead = u.uGustAhead.value;
      const gameStep = GUST_STEP_S * R_SAILING;
      ahead[0] = wind.gust01;
      for (let k = 1; k < GUST_SAMPLES; k++) {
        ahead[k] = weather.windAt(at, gameSeconds + k * gameStep).gust01;
      }
      u.uSurf.value = smoothstep(SURF_FROM_M, SURF_FULL_M, weather.seaShape.hsM);
    },
  };
  return cues;
}
