import type { SailingState } from '../sim/sailing/controller';
import type { SailingClass } from '../sim/sailing/ship-class';

/**
 * What the sailing soundscape should sound like right now (plan 02 §9, plan 15 §4.2):
 * pure numbers from the ship's state, so the mapping is tested without Web Audio.
 * sailing-audio.ts turns them into node parameters and one-shot schedules.
 */

export interface SailingAudioInput {
  /** Wind at the ship including the gust, knots (shelter already applied). */
  windKn: number;
  /** Gust strength now, 0–1. */
  gust01: number;
  /** Speed through the water as a share of the hull's maximum, 0–1 (sternway counts). */
  speed01: number;
  /** Sails set, 0 (Furled) … 3 (Full). */
  sailSetting: number;
  /** How hard the canvas is flogging, 0–1 (see `luffAmount`). */
  luff01: number;
  /** Heel as a share of the class's maximum, 0–1. */
  heel01: number;
  /** How fast the hull pitches and rolls on the waves, rad/s. */
  motion: number;
  /** Wave amplitude running against the bow, meters (plan 02 §5.2). */
  headSeaM: number;
  /**
   * Rigging strain, 0–1. The overpressing meter (plan 02 §6, piece E) feeds this once it
   * exists; until then it is estimated from heel and wind.
   */
  strain01?: number | undefined;
}

export interface SailingMixLevels {
  /** Broadband wind bed: gain and low-pass cutoff. */
  windGain: number;
  windCutoffHz: number;
  /** Wind singing in the rigging: a resonant band that rises with the wind. */
  whistleGain: number;
  whistleHz: number;
  /** Water rushing along the hull: the CC0 loop's gain, rate and low-pass. */
  washGain: number;
  washRate: number;
  washCutoffHz: number;
  /** Low water rumble that swells as the hull works in the waves. */
  swellGain: number;
  /** One-shot rates (per second) and gains. */
  creakPerS: number;
  creakGain: number;
  luffPerS: number;
  luffGain: number;
  slapPerS: number;
  slapGain: number;
  breakPerS: number;
}

/** Wind speed that counts as "full" for the wind bed, knots (a gale, plan 04 §5.1). */
const FULL_WIND_KN = 40;
/** The rigging starts to sing above this, knots. */
const WHISTLE_FROM_KN = 14;
/** Hull motion that counts as "working hard", rad/s. */
const FULL_MOTION = 0.3;

const clamp01 = (v: number): number => Math.min(Math.max(v, 0), 1);

/** How hard the sails are flogging: in irons, eased too far, or while being set or struck. */
export function luffAmount(s: SailingState, c: SailingClass): number {
  const canvas = clamp01(s.sailSetting);
  if (canvas <= 0) return 0;
  let luff = s.inIrons ? 1 : 0;
  if (s.manualTrim && !s.inIrons) {
    luff = Math.max(luff, clamp01((s.trim - s.idealTrim - c.trimSweetSpot) / c.trimFalloff));
  }
  // Canvas going up or coming down shakes before it sets.
  if (Math.abs(s.sailSetting - s.sailLevel) > 0.01) luff = Math.max(luff, 0.35);
  return luff * canvas;
}

/** Rigging strain from heel and wind, until piece E's overpressing meter is wired in. */
export function estimatedStrain(heel01: number, windKn: number, sailSetting: number): number {
  return clamp01(heel01 * clamp01(windKn / 25) * clamp01(sailSetting / 2));
}

export function sailingMix(input: SailingAudioInput): SailingMixLevels {
  const wind = clamp01(input.windKn / FULL_WIND_KN);
  const gust = clamp01(input.gust01);
  const speed = clamp01(Math.abs(input.speed01));
  const motion = clamp01(input.motion / FULL_MOTION);
  const strain = input.strain01 ?? estimatedStrain(input.heel01, input.windKn, input.sailSetting);
  const luff = clamp01(input.luff01);
  const whistle = clamp01((input.windKn - WHISTLE_FROM_KN) / (FULL_WIND_KN - WHISTLE_FROM_KN));
  const headSea = clamp01(input.headSeaM / 1.5);

  return {
    windGain: 0.04 + 0.55 * wind ** 1.3 * (1 + 0.4 * gust),
    windCutoffHz: 280 + 1500 * wind + 700 * gust,
    whistleGain: 0.22 * whistle ** 1.5 * (0.6 + 0.4 * gust),
    whistleHz: 520 + 900 * wind + 350 * gust,
    washGain: 0.04 + 0.85 * speed ** 1.2,
    washRate: 0.85 + 0.35 * speed,
    washCutoffHz: 700 + 6000 * speed,
    swellGain: 0.05 + 0.45 * motion,
    creakPerS: 0.12 + 1.3 * strain + 0.6 * motion,
    creakGain: 0.25 + 0.6 * Math.max(strain, motion * 0.5),
    luffPerS: luff * (0.7 + 2.6 * wind),
    luffGain: luff * (0.3 + 0.6 * wind),
    slapPerS: headSea * (0.25 + 1.6 * speed) + 0.4 * motion * speed,
    slapGain: 0.3 + 0.5 * Math.max(speed, headSea),
    breakPerS: 0.3 * clamp01((input.headSeaM - 1.2) / 2),
  };
}

/**
 * Fires irregular one-shots at a rate that may change every frame: it counts expected
 * events and fires when the count passes an exponentially distributed threshold, so the
 * gaps are random but the average follows the rate.
 */
export class RandomTrigger {
  private count = 0;
  private threshold: number;

  constructor(
    private readonly random: () => number = Math.random,
    /** Never fire twice within this many seconds. */
    private readonly minGapS = 0.08,
  ) {
    this.threshold = this.draw();
  }

  private sinceLast = Infinity;

  /** Advances by `dt` seconds at `perS` events per second; true when one fires. */
  tick(dt: number, perS: number): boolean {
    this.sinceLast += dt;
    if (perS <= 0) return false;
    this.count += perS * dt;
    if (this.count < this.threshold || this.sinceLast < this.minGapS) return false;
    this.count = 0;
    this.sinceLast = 0;
    this.threshold = this.draw();
    return true;
  }

  private draw(): number {
    return -Math.log(1 - this.random() * 0.999);
  }
}

/**
 * Start times (seconds) of the separate hits in a clip: where a 10 ms envelope rises past
 * `on` of the clip's peak after having fallen below `off`. Used to pick single flaps out
 * of the luffing clip.
 */
export function findOnsets(
  samples: Float32Array,
  sampleRate: number,
  on = 0.3,
  off = 0.1,
): number[] {
  const win = Math.max(1, Math.round(sampleRate * 0.01));
  const env: number[] = [];
  for (let i = 0; i < samples.length; i += win) {
    let sum = 0;
    const end = Math.min(samples.length, i + win);
    for (let j = i; j < end; j++) sum += (samples[j] as number) ** 2;
    env.push(Math.sqrt(sum / (end - i)));
  }
  const peak = Math.max(...env, 1e-9);
  const onsets: number[] = [];
  let armed = true;
  env.forEach((e, k) => {
    if (armed && e >= on * peak) {
      onsets.push((k * win) / sampleRate);
      armed = false;
    } else if (!armed && e < off * peak) {
      armed = true;
    }
  });
  return onsets;
}
