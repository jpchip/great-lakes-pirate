import type { Gait } from './controller';
import type { Lamp, LampSet } from './light';
import { lineBlocked, type P3 } from './sightline';
import type { ColliderSet } from './colliders';
import type { Heightfield } from './heightfield';

/**
 * Seeing on foot (plan 08 §4.1, §4.4; Phase 7 piece D), the on-foot half of the shared
 * detection model (plan 06 §7.2). Pure functions, no three.js:
 *
 * - **Exposure** is what the light gem shows: the light on you × how you move × how you
 *   hold yourself. It's the same for every guard.
 * - **Visibility** to one guard adds what's between you: being backlit by a lamp behind you,
 *   and cover (three sight lines, head, chest and hips; each one blocked hides a third).
 * - A guard **sees** you inside a range that grows with your exposure (a few meters in the
 *   dark, the full range lit), inside the sharp cone or, slower and shorter, the edge of
 *   sight, and through fog and rain less far.
 * - The **detection meter** fills while seen, faster the closer and more alert the guard,
 *   and falls back when you're gone. **Recognition** fills only when you're close and lit,
 *   faster the more famous you are (plan 06 §4.2).
 */

const DEG = Math.PI / 180;

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

/** How moving shows you: still is least, running most (plan 08 §3.2). */
export const MOVEMENT_FACTOR: Record<Gait, number> = {
  idle: 0.7,
  sneak: 0.8,
  walk: 1,
  run: 1.35,
  swim: 1,
  fall: 1.2,
  slide: 1.2,
};

/** Crouched you're a low shape; swimming only your head shows. */
export const CROUCH_FACTOR = 0.6;
export const SWIM_FACTOR = 0.35;
/** A crate in your arms shows (plan 08 §3.2: high). */
export const CARRY_FACTOR = 1.25;

/** The player as perception sees them. */
export interface Figure {
  x: number;
  y: number;
  z: number;
  gait: Gait;
  crouching: boolean;
  swimming: boolean;
  carrying: boolean;
  /** Standing height right now, meters (the controller's stand or crouch height). */
  height: number;
}

/** What the light gem shows, 0–1+: the light on you × movement × posture. */
export function exposure(light01: number, f: Figure): number {
  const posture = f.swimming ? SWIM_FACTOR : f.crouching ? CROUCH_FACTOR : 1;
  return light01 * MOVEMENT_FACTOR[f.gait] * posture * (f.carrying ? CARRY_FACTOR : 1);
}

/** The light gem's words (plan 13: a word as well as a shade). */
export type GemLevel = 'hidden' | 'dim' | 'lit' | 'exposed';

export function gemLevel(exposure01: number): GemLevel {
  if (exposure01 < 0.06) return 'hidden';
  if (exposure01 < 0.2) return 'dim';
  if (exposure01 < 0.55) return 'lit';
  return 'exposed';
}

/** Exposure at which a guard sees you out to their full range. */
export const FULL_RANGE_EXPOSURE = 0.6;
/** Nobody sees a figure further off than this share of their range in the pitch dark… */
const MIN_RANGE_SHARE = 0.1;

/**
 * How far a guard of `rangeM` sees a figure of this exposure, before fog: the square root,
 * so moonlight shows you most of the way and lamplight all of it.
 */
export function seeingRangeM(rangeM: number, exposure01: number): number {
  const share = Math.sqrt(clamp01(exposure01 / FULL_RANGE_EXPOSURE));
  return rangeM * Math.max(MIN_RANGE_SHARE, share);
}

/**
 * Fog on foot, 0 (clear) … 1 (thick): from the weather's fog visibility in meters. Haze
 * past a kilometer doesn't matter at a street's length; under 60 m it's a wall.
 */
export function fogOnFoot01(fogM: number): number {
  return clamp01(1 - (fogM - 60) / 940);
}

/** Fog and rain shorten sight on foot: thick fog to 40%, heavy rain to 70%. */
export function airSightFactor(fog01: number, rain01: number): number {
  return (1 - 0.6 * clamp01(fog01)) * (1 - 0.3 * clamp01(rain01));
}

/** A guard's eye, meters above their feet. */
export const EYE_M = 1.6;

/** Backlit (plan 08 §4.1 silhouette): a lamp just behind you, as the guard sees it. */
export const BACKLIT_FACTOR = 1.4;

/**
 * Whether a lit lamp stands behind the figure from the eye: within 25° of the line of
 * sight beyond the figure, and near enough the figure to throw it into outline.
 */
export function backlit(eye: P3, f: Figure, lamps: LampSet, carried: readonly Lamp[]): boolean {
  const dx = f.x - eye.x;
  const dz = f.z - eye.z;
  const d = Math.hypot(dx, dz);
  if (d < 0.5) return false;
  const ux = dx / d;
  const uz = dz / d;
  let hit = false;
  const visit = (l: Lamp): void => {
    if (hit || !l.lit || l.intensity < 0.3) return;
    const lx = l.x - f.x;
    const lz = l.z - f.z;
    const ld = Math.hypot(lx, lz);
    // Beyond the figure, within a couple of its radii of it.
    if (ld < 0.5 || ld > l.radiusM * 1.5) return;
    if ((lx * ux + lz * uz) / ld > Math.cos(25 * DEG)) hit = true;
  };
  lamps.near(f.x, f.z, visit);
  for (const l of carried) visit(l);
  return hit;
}

const sample: P3 = { x: 0, y: 0, z: 0 };

/**
 * How much of the figure the eye can see, 0–1: three sight lines (head, chest, hips),
 * each blocked one hiding a third (plan 08 §4.1 cover, "a few raycasts").
 */
export function coverSeen(
  colliders: ColliderSet,
  eye: P3,
  f: Figure,
  ground?: Heightfield,
): number {
  const h = f.swimming ? 0.3 : f.height;
  let seen = 0;
  for (const share of [0.92, 0.7, 0.5]) {
    sample.x = f.x;
    sample.y = f.y + h * share;
    sample.z = f.z;
    if (!lineBlocked(colliders, eye, sample, ground, ground ? 1 : 0)) seen++;
  }
  return seen / 3;
}

/** A guard's sight, from npc_types.json. */
export interface SightSpec {
  rangeM: number;
  fovDeg: number;
  peripheralDeg: number;
}

/** Where the figure falls in the guard's view: the sharp cone, the edge of sight, or behind. */
export type ViewZone = 'cone' | 'edge' | 'none';

/** Right beside a guard, you're felt even from behind. */
export const BUMP_M = 1.2;

export function viewZone(
  eyeHeading: number,
  eye: { x: number; z: number },
  f: { x: number; z: number },
  sight: SightSpec,
): ViewZone {
  const dx = f.x - eye.x;
  const dz = f.z - eye.z;
  const d = Math.hypot(dx, dz);
  if (d < BUMP_M) return 'cone';
  // Heading h faces (sin h, −cos h).
  const fx = Math.sin(eyeHeading);
  const fz = -Math.cos(eyeHeading);
  const cos = (dx * fx + dz * fz) / d;
  const angle = Math.acos(Math.max(-1, Math.min(1, cos)));
  if (angle <= (sight.fovDeg / 2) * DEG) return 'cone';
  if (angle <= (sight.peripheralDeg / 2) * DEG) return 'edge';
  return 'none';
}

/** The edge of sight sees half as far and fills the meter at this share of the cone's rate. */
export const EDGE_RANGE = 0.5;
export const EDGE_RATE = 0.3;

/** What one guard sees of the figure this look. */
export interface Glimpse {
  zone: ViewZone;
  distanceM: number;
  /** The guard's seeing range for this figure now, after fog, zone and cover. */
  rangeM: number;
  /** 0 at the edge of the range … 1 at the guard's side; 0 when unseen. */
  closeness01: number;
  /** Share of the figure in view, 0–1. */
  cover01: number;
  backlit: boolean;
  seen: boolean;
}

export interface LookInputs {
  eye: P3;
  eyeHeading: number;
  sight: SightSpec;
  /** Multiplies the range: drink, the weather's fog and rain. */
  rangeFactor: number;
  figure: Figure;
  /** The figure's exposure (the light gem's value). */
  exposure01: number;
  colliders: ColliderSet;
  lamps: LampSet;
  carried: readonly Lamp[];
  ground?: Heightfield;
}

/** One guard looks for the figure. Cheap rejections first; sight lines only when in range. */
export function look(i: LookInputs): Glimpse {
  const f = i.figure;
  const distanceM = Math.hypot(f.x - i.eye.x, f.z - i.eye.z);
  const zone = viewZone(i.eyeHeading, i.eye, f, i.sight);
  const none: Glimpse = {
    zone,
    distanceM,
    rangeM: 0,
    closeness01: 0,
    cover01: 0,
    backlit: false,
    seen: false,
  };
  if (zone === 'none') return none;
  const lit = backlit(i.eye, f, i.lamps, i.carried);
  let rangeM =
    seeingRangeM(i.sight.rangeM, i.exposure01 * (lit ? BACKLIT_FACTOR : 1)) * i.rangeFactor;
  if (zone === 'edge') rangeM *= EDGE_RANGE;
  rangeM = Math.max(rangeM, distanceM < BUMP_M ? BUMP_M + 0.1 : 0);
  if (distanceM >= rangeM) return { ...none, rangeM, backlit: lit };
  const cover01 = coverSeen(i.colliders, i.eye, f, i.ground);
  if (cover01 <= 0) return { ...none, rangeM, backlit: lit };
  return {
    zone,
    distanceM,
    rangeM,
    closeness01: clamp01(1 - distanceM / rangeM),
    cover01,
    backlit: lit,
    seen: true,
  };
}

// ---------------------------------------------------------------------------------------
// The detection meter (plan 08 §4.1) and recognition (§4.4).

/** Seconds of looking, beside them and fully alert, to be sure: 0 → alerted. */
export const FILL_S = 1.5;
/** At the very edge of the range the meter still fills at this share of the close rate. */
export const FAR_RATE = 0.18;
/** Out of sight, the meter falls this much a second (about 8 s from alerted to calm). */
export const DECAY_PER_S = 0.12;
/** From here the guard is suspicious: stops, looks, comes to see (plan 08 §5.2). */
export const SUSPICIOUS = 0.35;
export const ALERTED = 1;

/** One look's worth of the meter climbing, per second. */
export function meterRate(g: Glimpse, vigilance: number): number {
  if (!g.seen) return 0;
  const zone = g.zone === 'edge' ? EDGE_RATE : 1;
  return (vigilance * zone * g.cover01 * (FAR_RATE + (1 - FAR_RATE) * g.closeness01)) / FILL_S;
}

/** Recognition (plan 08 §4.4): seconds of a close, lit look to know your face, at top Fame. */
export const RECOGNIZE_S = 4;
/** Recognition needs at least this much of the range closed… */
export const RECOGNIZE_CLOSENESS = 0.45;
/** …and at least this much light on you. */
export const RECOGNIZE_LIGHT = 0.25;
/** An unknown face is still learned at this share of the famous rate (a description). */
const UNKNOWN_FACE = 0.3;

/**
 * Recognition's climb per second: only close and lit, faster the more famous you are
 * (`fame01`: plan 06's recognition, 0 unknown … 1 legendary).
 */
export function recognitionRate(g: Glimpse, light01: number, fame01: number): number {
  if (!g.seen || g.closeness01 < RECOGNIZE_CLOSENESS || light01 < RECOGNIZE_LIGHT) return 0;
  return (g.cover01 * (UNKNOWN_FACE + (1 - UNKNOWN_FACE) * clamp01(fame01))) / RECOGNIZE_S;
}
