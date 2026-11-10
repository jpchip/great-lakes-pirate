/**
 * The captain's body on foot (plan 08 §3.3, plan 11 §3.2; Phase 7 piece A): simple
 * health from 0 to 100, hurt by falls and drained by cold water, healing over game days
 * when you're dry and out of danger. At 0 the run ends (permadeath, plan 12 §8). Pure
 * numbers, so tests and the e2e hooks can drive it.
 */

export const MAX_HEALTH = 100;

/** Landing slower than this hurts nothing, m/s (about a 2 m drop at the controller's 18 m/s²). */
export const SAFE_FALL_MS = 8.5;
/** Landing this fast is death, m/s (about a 10 m drop). */
export const DEADLY_FALL_MS = 19;
/** Water takes the sting out of a fall: speeds into it count this much less. */
const WATER_CUSHION = 0.5;

/** Health lost landing at `speed` m/s, 0 … MAX_HEALTH. */
export function fallDamage(speed: number, intoWater = false): number {
  const v = intoWater ? speed * WATER_CUSHION : speed;
  if (v <= SAFE_FALL_MS) return 0;
  const t = Math.min((v - SAFE_FALL_MS) / (DEADLY_FALL_MS - SAFE_FALL_MS), 1);
  // Gentle for a slip off a roof, steep toward a cliff.
  return Math.round(MAX_HEALTH * t ** 1.4);
}

/**
 * Water warmer than this is no danger to a swimmer, °C. Superior's surface passes it only
 * in a warm August near shore; spring and fall are dangerous (plan 08 §3.2).
 */
export const SAFE_WATER_C = 16;
/** Health lost per real second swimming, per degree under SAFE_WATER_C. */
const COLD_DRAIN_PER_DEGREE_S = 0.09;
/** Even "warm" Superior water wears on you slowly: health per real second. */
const SWIM_WEAR_S = 0.01;

/**
 * Health lost per real second in the water at `waterC` (plan 08 §3.2). May water at 4 °C
 * takes about 90 seconds from full health; late-summer water barely bites.
 */
export function coldDrainPerS(waterC: number): number {
  return Math.max(0, SAFE_WATER_C - waterC) * COLD_DRAIN_PER_DEGREE_S + SWIM_WEAR_S;
}

/** Seconds a full-health swimmer lasts in water this cold, for the HUD's warning. */
export function secondsToDrown(health: number, waterC: number): number {
  return health / coldDrainPerS(waterC);
}

/** How the cold reads on the HUD, by water temperature. */
export function coldWord(waterC: number): 'deadly' | 'bitter' | 'cold' | 'cool' {
  if (waterC < 6) return 'deadly';
  if (waterC < 10) return 'bitter';
  if (waterC < SAFE_WATER_C) return 'cold';
  return 'cool';
}

/** Wounds heal over game days (plan 08 §3.3): full health back in two days of rest. */
export const HEAL_PER_GAME_HOUR = MAX_HEALTH / 48;

/** Health after `gameSeconds` of healing, capped at full. */
export function heal(health: number, gameSeconds: number): number {
  return Math.min(MAX_HEALTH, health + (HEAL_PER_GAME_HOUR * Math.max(0, gameSeconds)) / 3600);
}

/** Below this the HUD warns that you're badly hurt. */
export const BADLY_HURT = 30;
