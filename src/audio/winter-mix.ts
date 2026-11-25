/**
 * The rules for winter's sounds (Phase 9 piece N; plan 11 §18.4 row N, plan 15 §4.1, §4.5):
 * how wintry the air is, how loud the winter wind blows, how often a gust comes and the
 * teeth chatter as warmth runs down, what thin ice says as it works toward breaking, which
 * footstep the ice and the frost make, how the sled's runners follow its speed, when the
 * lake's ice booms far off, and how still a harbor frozen in goes at night. Pure functions,
 * unit-tested; `winter-audio.ts` plays them.
 */

import { stepGain } from './foot-mix';
import type { Gait } from '../gameplay/onfoot/controller';
import type { WarmthStage } from '../sim/cold/warmth';
import type { ThinStage } from '../sim/cold/footing';

const clamp01 = (v: number): number => Math.min(1, Math.max(0, v));
const smooth = (t: number): number => {
  const c = clamp01(t);
  return c * c * (3 - 2 * c);
};

const STAGES: readonly WarmthStage[] = ['warm', 'chilled', 'cold', 'freezing', 'frozen'];
const rank = (s: WarmthStage): number => STAGES.indexOf(s);

// ---------------------------------------------------------------------------------------
// The season

/** The months the lake can be winter's, by the calendar: November to April, a little October and May. */
export function winterMonths(month0: number): number {
  if (month0 >= 10 || month0 <= 3) return 1;
  if (month0 === 9 || month0 === 4) return 0.5;
  return 0;
}

/**
 * 0–1: how much winter's soundscape the moment has. Air at freezing and below brings it in
 * (full by −8 °C), and so does ice over the water, whatever the air; out of the season,
 * none.
 */
export function winterness(airC: number, iceCover01: number, month0: number): number {
  const cold = smooth((2 - airC) / 10);
  return clamp01(Math.max(cold, iceCover01)) * winterMonths(month0);
}

/** The share of rain or snow falling as snow: none above 1 °C, all of it by −2 °C. */
export function snowShare(airC: number): number {
  return smooth((1 - airC) / 3);
}

// ---------------------------------------------------------------------------------------
// The wind

export interface WindLevel {
  gain: number;
  lowpassHz: number;
}

/**
 * The winter wind's bed: a breath of it even in a calm, full in a gale; through a wall
 * only a muffled moan.
 */
export function winterWind(windKn: number, winter01: number, inside: boolean): WindLevel {
  const strength = smooth(windKn / 28);
  const gain = winter01 * (0.18 + 0.82 * strength);
  if (inside) return { gain: gain * 0.35, lowpassHz: 700 };
  return { gain, lowpassHz: 2500 + 7500 * strength };
}

/**
 * Seconds between gusts on foot (plan 11 §18.4 row N: "gusts as warmth drops"): rare when
 * you're warm, every few seconds as you freeze; a stronger wind brings them oftener. None
 * under a roof, in the water, or out of winter.
 */
export function gustEveryS(
  stage: WarmthStage,
  windKn: number,
  winter01: number,
  inside: boolean,
): number | undefined {
  if (inside || winter01 < 0.3) return undefined;
  const base = [26, 16, 9, 5.5, 4][rank(stage)] ?? 26;
  return base / (0.6 + 0.8 * smooth(windKn / 25));
}

/** A gust's gain: harder the colder you are and the stronger the wind. */
export function gustGain(stage: WarmthStage, windKn: number): number {
  return Math.min(0.95, (0.35 + 0.12 * rank(stage)) * (0.55 + 0.45 * smooth(windKn / 25)));
}

// ---------------------------------------------------------------------------------------
// The body in the cold

/** Seconds between bouts of chattering teeth: at cold and freezing (and beyond), never warmer. */
export function chatterEveryS(stage: WarmthStage): number | undefined {
  switch (stage) {
    case 'cold':
      return 7;
    case 'freezing':
      return 3.5;
    case 'frozen':
      return 2.6;
    default:
      return undefined;
  }
}

/** Seconds between shivering breaths: from chilled on. */
export function shiverEveryS(stage: WarmthStage): number | undefined {
  switch (stage) {
    case 'chilled':
      return 16;
    case 'cold':
      return 11;
    case 'freezing':
      return 7;
    case 'frozen':
      return 5;
    default:
      return undefined;
  }
}

/** Chattering's gain: louder as you freeze. */
export function chatterGain(stage: WarmthStage): number {
  return stage === 'cold' ? 0.4 : stage === 'freezing' ? 0.55 : 0.65;
}

// ---------------------------------------------------------------------------------------
// Thin ice

/** Where piece M's stages start (`data/cold.json` `thin.crackAt`, `groanAt`), for the rules. */
export interface ThinMarks {
  crackAt: number;
  groanAt: number;
}

export interface ThinIceSound {
  /** Seconds to the next small crack, and its gain. */
  crackEveryS: number;
  crackGain: number;
  /** Seconds to the next groan (groaning only), and its gain. */
  groanEveryS: number | undefined;
  groanGain: number;
}

/**
 * What thin ice keeps saying while it holds you between its warnings: after the first
 * crack, more small cracks, closer together as the stress builds; once it groans, groans
 * every few seconds over them. Stood still, it eases off, so the sounds come slower.
 * Nothing on sound ice or once it's gone.
 */
export function thinIceSound(
  stage: ThinStage,
  stress: number,
  moving: boolean,
  marks: ThinMarks,
): ThinIceSound | undefined {
  if (stage === 'sound' || stage === 'broken') return undefined;
  const u = clamp01((stress - marks.crackAt) / Math.max(0.01, 1 - marks.crackAt));
  const still = moving ? 1 : 1.6;
  if (stage === 'cracking') {
    return {
      crackEveryS: (3.4 - 1.8 * u) * still,
      crackGain: 0.3 + 0.35 * u,
      groanEveryS: undefined,
      groanGain: 0,
    };
  }
  return {
    crackEveryS: (1.6 - 0.8 * u) * still,
    crackGain: 0.45 + 0.4 * u,
    groanEveryS: (3.2 - 1.2 * u) * still,
    groanGain: 0.55 + 0.4 * u,
  };
}

// ---------------------------------------------------------------------------------------
// Footsteps

/** What a stride is on in winter: snow lying, bare lake ice, or snow over the ice. */
export type WinterGround = 'snow' | 'ice' | 'snowIce';

/** Below this the snow squeaks underfoot, °C. */
export const SQUEAK_BELOW_C = -10;

export interface WinterStep {
  id: string;
  gain: number;
  rate: number;
  lowpassHz: number | undefined;
}

export const winterStepId = (kind: 'ice' | 'squeak' | 'snow', variant: number): string =>
  `sfx.foot.step-${kind}-${variant}`;

/**
 * The footstep for a stride in winter, at the gain the guards hear it by (as `stepSound`):
 * on bare ice a hard tick and scuff; on snow the on-foot set's crunch, or below −10 °C a
 * squeak; on snow over the ice a crunch brighter and a little hollow. `pick` (0–1) chooses
 * the variant and nudges the pitch.
 */
export function winterStep(
  ground: WinterGround,
  gait: Gait,
  radiusM: number,
  airC: number,
  pick: number,
): WinterStep | undefined {
  if (gait === 'swim' || gait === 'idle' || gait === 'fall') return undefined;
  const gain = stepGain(radiusM);
  if (gain <= 0) return undefined;
  const variant = 1 + (Math.floor(clamp01(pick) * 1000) % 2);
  const gaitRate = gait === 'sneak' ? 0.92 : gait === 'run' ? 1.06 : 1;
  const jitter = 0.94 + 0.12 * ((pick * 7919) % 1);
  const sneak = gait === 'sneak' ? 3200 : undefined;
  if (ground === 'ice') {
    return { id: winterStepId('ice', variant), gain, rate: gaitRate * jitter, lowpassHz: sneak };
  }
  const squeak = airC < SQUEAK_BELOW_C;
  return {
    id: winterStepId(squeak ? 'squeak' : 'snow', variant),
    gain,
    rate: (ground === 'snowIce' ? 1.08 : 1) * gaitRate * jitter,
    lowpassHz: sneak,
  };
}

// ---------------------------------------------------------------------------------------
// The sled

export interface RunnerLevel {
  gain: number;
  rate: number;
  lowpassHz: number;
}

/**
 * The sled's runners behind you: silent standing, a hiss at a walk, fuller with a load;
 * brighter and a touch higher on bare ice than in snow.
 */
export function runnerLevel(speedMps: number, loadCu: number, onBareIce: boolean): RunnerLevel {
  const moving = smooth((speedMps - 0.15) / 1.2);
  return {
    gain: moving * (0.45 + 0.12 * Math.min(3, Math.max(0, loadCu))),
    rate: 0.85 + 0.3 * clamp01(speedMps / 2.5) + (onBareIce ? 0.1 : 0),
    lowpassHz: onBareIce ? 9000 : 3800,
  };
}

// ---------------------------------------------------------------------------------------
// The hull in the ice

/** Hull HP a second she loses forcing ice at which the grinding is at its loudest. */
export const GRIND_FULL_HP_S = 1.2;

/**
 * The player's hull forcing through ice (piece K's `IceGrinding`): the grind's bed by how
 * hard she's being worked (hull HP a second), lower and duller at a crawl, fuller and
 * brighter driven hard; and how often a floe knocks on her or a crack runs off.
 */
export function grindLevel(hpPerS: number): {
  gain: number;
  rate: number;
  lowpassHz: number;
  knockEveryS: number | undefined;
} {
  if (!(hpPerS > 0.005)) return { gain: 0, rate: 1, lowpassHz: 2500, knockEveryS: undefined };
  const k = clamp01(hpPerS / GRIND_FULL_HP_S);
  return {
    gain: 0.35 + 0.65 * smooth(k),
    rate: 0.82 + 0.25 * k,
    lowpassHz: 2500 + 6500 * k,
    knockEveryS: 2.6 - 1.6 * k,
  };
}

// ---------------------------------------------------------------------------------------
// The ice far off, and a harbor frozen in

/**
 * Seconds between the lake's ice booming far off: only over a closed sheet, oftener at
 * night and the colder the air (the ice cracks as it contracts). Undefined over open water.
 */
export function iceBoomEveryS(
  iceCover01: number,
  airC: number,
  night01: number,
): number | undefined {
  if (iceCover01 < 0.5) return undefined;
  const cold = smooth(-airC / 15);
  return 80 / (0.4 + 0.8 * night01 + 0.8 * cold) / (0.5 + iceCover01);
}

/** A boom `distanceM` off: fainter and duller the further. */
export function iceBoomHeard(distanceM: number): { gain: number; lowpassHz: number } {
  const near = 1 - smooth((distanceM - 300) / 2200);
  return { gain: 0.15 + 0.45 * near, lowpassHz: 700 + 2300 * near };
}

/** 0–1: night (the sun under the horizon, full by 6° down). */
export function nightOf(sunElevationDeg: number): number {
  return 1 - smooth((sunElevationDeg + 1) / 7);
}

export interface FrozenHarbor {
  /** The still night's bed. */
  gain: number;
  /**
   * 0–1: how much the open water's sounds are stilled where you are: the lake lapping at
   * the piles, the gulls (the lake closed over).
   */
  hush01: number;
}

/**
 * A harbor frozen in, at night (plan 11 §18.4 row N): near a harbor, with the ice closed
 * over the water, the night goes still: the frozen night's bed comes up (a little of it by
 * day), most of all in a calm. Wherever the lake is closed over, the water's own sounds go.
 */
export function frozenHarbor(
  harborDistanceM: number,
  iceCover01: number,
  sunElevationDeg: number,
  windKn: number,
): FrozenHarbor {
  const frozen = smooth((iceCover01 - 0.6) / 0.3);
  const near = 1 - smooth((harborDistanceM - 400) / 900);
  const night = nightOf(sunElevationDeg);
  const calm = 1 - smooth((windKn - 8) / 14);
  return {
    gain: frozen * near * (0.25 + 0.75 * night) * (0.35 + 0.65 * calm),
    hush01: frozen,
  };
}
