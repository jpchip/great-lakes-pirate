import type { Gait } from './controller';

/**
 * Noise on foot (plan 08 §3.2, §4.2; Phase 7 piece D): every sound the player makes is an
 * event with a radius in meters. Footsteps come once a stride, louder running and on
 * planks; forcing a lock, a thrown stone landing, a splash or a shot are one-off events
 * (piece E raises those). Rain masks what's heard, and walls halve a radius on its way to
 * a listener. The HUD's noise ring and the footstep sounds (piece I) read the same radius.
 */

/** What's underfoot (plan 15 §4.5's footstep set). */
export type Surface = 'wood' | 'dirt' | 'gravel' | 'grass' | 'stone' | 'snow' | 'interior';

export type NoiseKind =
  | 'footstep'
  | 'landing'
  | 'splash'
  | 'lock'
  | 'crate'
  | 'distraction'
  | 'glass'
  | 'shout'
  | 'whistle'
  | 'gunshot';

export interface NoiseEvent {
  kind: NoiseKind;
  x: number;
  y: number;
  z: number;
  /** Meters it carries in still, dry air with nothing in the way. */
  radiusM: number;
  /** Who made it: `player`, or an NPC's id (a guard's whistle). */
  source: string;
}

/** A stride's footstep radius by gait on ordinary ground, meters (plan 08 §3.2). */
export const GAIT_NOISE_M: Record<Gait, number> = {
  idle: 0,
  sneak: 1.5,
  walk: 5,
  run: 12,
  swim: 1,
  fall: 0,
  slide: 4,
};

/** Planks are louder than dirt; grass hushes; snow crunches. */
export const SURFACE_NOISE: Record<Surface, number> = {
  wood: 1.5,
  dirt: 0.8,
  gravel: 1.2,
  grass: 0.6,
  stone: 1,
  snow: 1.3,
  interior: 1,
};

/** Meters a stride covers, by gait: footsteps come this often. */
export const STRIDE_M: Partial<Record<Gait, number>> = {
  sneak: 0.55,
  walk: 0.75,
  run: 1.1,
  swim: 1.2,
  slide: 0.8,
};

/** A one-off noise's radius, meters (plan 08 §4.2, §6). Gunshots carry across the district. */
export const EVENT_NOISE_M: Record<Exclude<NoiseKind, 'footstep' | 'landing'>, number> = {
  splash: 10,
  lock: 4,
  crate: 8,
  distraction: 9,
  glass: 14,
  shout: 22,
  whistle: 40,
  gunshot: 150,
};

/** Carrying a crate is noisy whatever the gait (plan 08 §3.2: medium). */
export const CARRY_NOISE_M = 7;

/** The footstep radius for a gait on a surface, meters, before the weather. */
export function footstepRadiusM(gait: Gait, surface: Surface, carrying = false): number {
  const base = carrying && gait !== 'idle' && gait !== 'swim' ? CARRY_NOISE_M : GAIT_NOISE_M[gait];
  // Swimming is quiet whatever the bottom.
  return gait === 'swim' ? base : base * SURFACE_NOISE[surface];
}

/** A hard landing thumps: nothing below 4 m/s, a run's worth by 9 m/s. */
export function landingRadiusM(landingSpeed: number, surface: Surface): number {
  if (landingSpeed < 4) return 0;
  return Math.min(16, (landingSpeed - 4) * 2.4 + 3) * SURFACE_NOISE[surface];
}

/** The air: rain masks sound (plan 08 §11), fog carries it a little. */
export function weatherNoiseFactor(rain01: number, fog01: number): number {
  const rain = Math.min(1, Math.max(0, rain01));
  const fog = Math.min(1, Math.max(0, fog01));
  return (1 - 0.45 * rain) * (1 + 0.1 * fog);
}

/** A wall or a building between the noise and the ear halves how far it carries. */
export const WALL_FACTOR = 0.5;

/**
 * How well a listener hears a noise, 0 (not at all) to 1 (right beside it). `hearing`
 * is the listener's ears (npc_types.json), `blocked` whether a wall stands between.
 */
export function heard(
  e: NoiseEvent,
  ear: { x: number; z: number },
  hearing: number,
  weather: number,
  blocked: boolean,
): number {
  const r = e.radiusM * hearing * weather * (blocked ? WALL_FACTOR : 1);
  if (r <= 0) return 0;
  const d = Math.hypot(e.x - ear.x, e.z - ear.z);
  return d >= r ? 0 : 1 - d / r;
}

/**
 * The player's footsteps: counts the distance walked and gives a stride's footstep each
 * time a stride is covered. One per player.
 */
export class Footsteps {
  private travelled = 0;

  /** Distance walked this tick, the gait and the ground: a footstep radius, or 0. */
  step(distanceM: number, gait: Gait, surface: Surface, carrying = false): number {
    const stride = STRIDE_M[gait];
    if (!stride || distanceM <= 0) return 0;
    this.travelled += distanceM;
    if (this.travelled < stride) return 0;
    this.travelled %= stride;
    return footstepRadiusM(gait, surface, carrying);
  }
}
