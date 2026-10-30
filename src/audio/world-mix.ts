import type { FogSignal } from '../../data/schemas/lighthouses';

/**
 * What the world around the ship should sound like (plan 15 §4.1, §4.3, §11 Phase 2):
 * rain, thunder, fog, the lights' fog signals, gulls and loons. Pure numbers from the
 * weather, the sky and where the ship is, so the rules are tested without Web Audio;
 * world-audio.ts turns them into nodes and one-shots.
 *
 * Distances are zone meters. The zone is compressed, so ranges are set by ear for the
 * zone, not from real acoustics, except that sound still travels at 343 m/s.
 */

const clamp01 = (v: number): number => Math.min(Math.max(v, 0), 1);
const smooth = (t: number): number => {
  const c = clamp01(t);
  return c * c * (3 - 2 * c);
};

/** Speed of sound, m/s: thunder and fog signals arrive this late. */
export const SOUND_MS = 343;

// --- Rain and fog -----------------------------------------------------------------------

export interface RainLevels {
  /** The rain loop's gain and low-pass: a drizzle is soft and dull, a downpour bright. */
  gain: number;
  cutoffHz: number;
}

export function rainMix(rain01: number, storm01: number): RainLevels {
  const r = clamp01(rain01);
  return {
    gain: r <= 0.02 ? 0 : 0.85 * r ** 0.8 * (1 + 0.25 * clamp01(storm01)),
    cutoffHz: 1800 + 7000 * r,
  };
}

/** Fog visibility below which a fog bank is "in" for the ear, meters. */
export const FOG_SOUND_FROM_M = 4000;

/** How foggy it sounds, 0–1: nothing at 4 km and up, full by 300 m. */
export function fogAmount(fogVisibilityM: number): number {
  return smooth((FOG_SOUND_FROM_M - fogVisibilityM) / (FOG_SOUND_FROM_M - 300));
}

export interface FogLevels {
  /** A low, close hush over the water. */
  hushGain: number;
  /** Drips off the wet rigging, per second. */
  dripsPerS: number;
  /**
   * The roll-off on distant sounds in thick air (plan 15 §7, "fog and snow damping"),
   * as a multiplier on their low-pass cutoff.
   */
  damping: number;
}

export function fogMix(fogVisibilityM: number, windKn: number): FogLevels {
  const fog = fogAmount(fogVisibilityM);
  // Fog lies on calm water; a breeze through it drowns the drips.
  const still = clamp01(1 - (windKn - 6) / 14);
  return {
    hushGain: 0.22 * fog,
    dripsPerS: 0.9 * fog * (0.3 + 0.7 * still),
    damping: 1 - 0.55 * fog,
  };
}

// --- Thunder ----------------------------------------------------------------------------

/** Strikes closer than this get the clap; farther ones only roll. */
export const NEAR_THUNDER_M = 2500;

export interface ThunderShot {
  near: boolean;
  /** Seconds after the flash. */
  delayS: number;
  gain: number;
  lowpassHz: number;
}

/**
 * The thunder for a strike `distanceM` away: about 3 s a kilometer behind the flash,
 * quieter and duller the farther it is; a strike that stays in the cloud rumbles softer.
 */
export function thunderShot(distanceM: number, toWater: boolean, damping = 1): ThunderShot {
  const d = Math.max(distanceM, 300);
  const level = Math.min(1, (1200 / d) ** 0.7) * (toWater ? 1 : 0.7);
  return {
    near: d < NEAR_THUNDER_M,
    delayS: d / SOUND_MS,
    gain: level,
    lowpassHz:
      Math.min(9000, Math.max(300, 8000 * (900 / d) ** 1.1 * (toWater ? 1 : 0.6))) * damping,
  };
}

// --- Fog signals ------------------------------------------------------------------------

/** How far each kind of signal carries, zone meters (a whistle well past a light's range). */
export const SIGNAL_RANGE_M: Readonly<Record<FogSignal['kind'], number>> = {
  whistle: 7000,
  bell: 2500,
};

/** Keepers sound the signal once the fog at the station is this thick, meters. */
export const SIGNAL_FOG_M = 3000;

/**
 * How loud and bright a signal is `distanceM` away, or undefined past its range. It
 * falls a little slower than inverse distance (the zone is compressed) and fades out
 * over the last fifth of the range; the air dulls it with distance, more so in fog.
 */
export function signalLevel(
  kind: FogSignal['kind'],
  distanceM: number,
  damping = 1,
): { gain: number; lowpassHz: number } | undefined {
  const range = SIGNAL_RANGE_M[kind];
  if (distanceM >= range) return undefined;
  const ref = kind === 'whistle' ? 500 : 150;
  const d = Math.max(distanceM, ref);
  const edge = smooth((range - distanceM) / (0.2 * range));
  return {
    gain: (ref / d) ** 0.85 * edge,
    lowpassHz: Math.max(500, 12000 * (ref / d) ** 0.6 * damping),
  };
}

/** A station's own offset into its cycle, so neighbours don't sound in step. */
export function signalPhase(id: string, periodS: number): number {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 16777619);
  return ((h >>> 0) / 4294967296) * periodS;
}

export interface Blast {
  /** When the blast or stroke starts at the station, seconds on the signal clock. */
  startS: number;
  lengthS: number;
}

/** Every blast of `signal` that starts in [fromS, toS) on the signal clock. */
export function blastsBetween(
  signal: Pick<FogSignal, 'pattern' | 'periodS'>,
  phaseS: number,
  fromS: number,
  toS: number,
): Blast[] {
  const out: Blast[] = [];
  if (toS <= fromS) return out;
  const p = signal.periodS;
  const first = Math.floor((fromS - phaseS) / p) - 1;
  const last = Math.floor((toS - phaseS) / p) + 1;
  for (let k = first; k <= last; k++) {
    for (const [at, lengthS] of signal.pattern) {
      const startS = phaseS + k * p + at;
      if (startS >= fromS && startS < toS) out.push({ startS, lengthS });
    }
  }
  return out.sort((a, b) => a.startS - b.startS);
}

// --- Wildlife ---------------------------------------------------------------------------

/** 0 at night, 1 in daylight, easing through the twilight. */
export function daylight(sunElevationDeg: number): number {
  return smooth((sunElevationDeg + 4) / 10);
}

/** Wind and rain keep the birds quiet: 1 on a fair day, near 0 in a gale or a downpour. */
export function fairWeather(windKn: number, rain01: number, storm01: number): number {
  return clamp01(1 - (windKn - 22) / 16) * (1 - 0.75 * clamp01(rain01)) * (1 - clamp01(storm01));
}

export interface GullInput {
  sunElevationDeg: number;
  /** Signed distance to the shore, meters (positive over water). */
  shoreDistanceM: number;
  /** Distance to the nearest harbor's piers, meters. */
  harborDistanceM: number;
  windKn: number;
  rain01: number;
  storm01: number;
}

/**
 * Gull calls per second: a few over open water (gulls follow boats), more along the
 * shore, and most around the fish docks and the harbors, by day in fair weather.
 */
export function gullRate(i: GullInput): number {
  const shore = clamp01(1 - (i.shoreDistanceM - 60) / 700);
  const harbor = clamp01(1 - i.harborDistanceM / 1500);
  const presence = 0.025 + 0.18 * shore + 0.5 * harbor ** 1.5;
  return presence * daylight(i.sunElevationDeg) * fairWeather(i.windKn, i.rain01, i.storm01);
}

/** Loons spend May to September on the lake; most have left by November. */
export function loonSeason(month0: number): number {
  if (month0 >= 4 && month0 <= 8) return 1;
  if (month0 === 9) return 0.5;
  if (month0 === 10) return 0.1;
  return 0;
}

export interface LoonInput {
  sunElevationDeg: number;
  /** Calendar month, 0 = January. */
  month0: number;
  shoreDistanceM: number;
  windKn: number;
  rain01: number;
  storm01: number;
}

/**
 * Loon calls (each a short series) per second: at dusk, through the night and at dawn,
 * on calm water within reach of a sheltered shore.
 */
export function loonRate(i: LoonInput): number {
  const el = i.sunElevationDeg;
  // Twilight is their hour; the night still has some; full day hardly any.
  const twilight = Math.exp(-(((el + 3) / 6) ** 2));
  const time = Math.max(twilight, el < -6 ? 0.55 : 0, 0.04);
  const calm =
    clamp01(1 - (i.windKn - 8) / 10) * (1 - clamp01(i.rain01)) * (1 - clamp01(i.storm01));
  const near = clamp01(1 - (i.shoreDistanceM - 300) / 4000);
  return 0.045 * time * calm * (0.3 + 0.7 * near) * loonSeason(i.month0);
}

/** How loud and dull a bird is at `distanceM`, from its own `refM` (where it's full). */
export function birdLevel(
  distanceM: number,
  refM: number,
  damping = 1,
): { gain: number; lowpassHz: number } {
  const d = Math.max(distanceM, refM);
  return {
    gain: (refM / d) ** 0.9,
    lowpassHz: Math.max(700, 14000 * (refM / d) ** 0.7 * damping),
  };
}

// --- Music ------------------------------------------------------------------------------

export type MusicMood = 'day' | 'night' | 'quiet';

export interface MusicInput {
  sunElevationDeg: number;
  fogVisibilityM: number;
  windKn: number;
  rain01: number;
  storm01: number;
}

/**
 * Which open-water cue fits now (plan 15 §6.1, §11 Phase 2): the waltz by day, the air at
 * night, and none in fog (the music thins out so the fog signals lead) or in heavy
 * weather (the storm layer comes in a later phase).
 */
export function musicMood(i: MusicInput): MusicMood {
  if (i.fogVisibilityM < 2500 || i.storm01 > 0.2 || i.rain01 > 0.5 || i.windKn >= 28) {
    return 'quiet';
  }
  return i.sunElevationDeg < -4 ? 'night' : 'day';
}
