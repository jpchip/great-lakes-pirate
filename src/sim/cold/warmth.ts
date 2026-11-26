import { COLD } from './footing';

/**
 * The warmth meter (plan 11 §3.2 cold exposure, §14 `player.warmth`; Phase 9 piece M). On
 * foot, air colder than a dressed man's comfort (the wind's chill counted) wears it down, a
 * wetting three times as fast, and the water itself fastest of all. A fire, a stove or a
 * keeper's hearth gives it back and dries you; so does mild air, slowly. Aboard, the galley
 * stove does. At nothing left your health goes, after three clear warnings.
 */

export interface Warmth {
  /** 0 … 100. */
  value: number;
  /** Wet through, 0 … 1. */
  wet: number;
}

export const MAX_WARMTH = 100;

export function freshWarmth(): Warmth {
  return { value: MAX_WARMTH, wet: 0 };
}

export type WarmthStage = 'warm' | 'chilled' | 'cold' | 'freezing' | 'frozen';

export function warmthStage(value: number): WarmthStage {
  const w = COLD.warmth;
  if (value <= 0) return 'frozen';
  if (value < w.freezing) return 'freezing';
  if (value < w.cold) return 'cold';
  if (value < w.chilled) return 'chilled';
  return 'warm';
}

/** The warning each stage gives as you come down into it. */
export const WARMTH_WARNINGS: Readonly<Record<Exclude<WarmthStage, 'warm'>, string>> = {
  chilled: 'You are chilled through',
  cold: 'Shivering hard: find a fire, a stove or a house',
  freezing: 'You cannot feel your hands. Get to a fire, now',
  frozen: 'You are freezing to death',
};

/**
 * The air as it feels, °C: Environment Canada's wind chill, for air at or below 10 °C and
 * wind over 5 km/h (`windKn` in knots).
 */
export function feelsLikeC(airC: number, windKn: number): number {
  const kmh = windKn * 1.852;
  if (airC > 10 || kmh < 5) return airC;
  const v = kmh ** 0.16;
  return 13.12 + 0.6215 * airC - 11.37 * v + 0.3965 * airC * v;
}

export interface WarmthInput {
  airC: number;
  windKn: number;
  /** Rain or snow falling, 0–1. */
  precip01: number;
  /** In the water, and how cold it is. */
  swimming: boolean;
  waterC: number;
  /** By a fire, a stove or a hearth (a keeper's house, a saloon, your hideout). */
  heat: boolean;
  /** Under a roof: out of the wind and the weather. */
  indoors: boolean;
  running: boolean;
}

/** Warmth gained (+) or lost (−) a real second, and the wetting, for these conditions. */
export function warmthRate(w: Warmth, input: WarmthInput): number {
  const c = COLD.warmth;
  if (input.heat) return c.heatS;
  if (input.swimming) return -Math.max(1, 16 - input.waterC) * c.waterLossPerDegreeS;
  const feels = input.indoors ? Math.max(input.airC, 5) : feelsLikeC(input.airC, input.windKn);
  const chill = Math.max(0, c.comfortC - feels);
  if (chill <= 0) return c.recoverS * (1 - 0.7 * w.wet);
  const wetMul = 1 + (c.wetMul - 1) * w.wet;
  return -chill * c.lossPerDegreeS * wetMul * (input.running ? c.runWarmMul : 1);
}

/** Wet through by the water or rain, drying by heat or mild air (never freezing air). */
export function wetRate(w: Warmth, input: WarmthInput): number {
  const c = COLD.warmth;
  if (input.swimming) return 1;
  if (input.heat) return -c.dryHeatS;
  let rate = 0;
  if (!input.indoors && input.precip01 > 0.02) {
    // Freezing rain soaks you; snow at hard frost only dusts you.
    rate += input.precip01 * (input.airC > -2 ? c.rainWetS : c.snowWetS);
  }
  if (rate === 0 && input.airC > 0) rate = -c.dryAirS;
  return rate;
}

/** One step on foot: the meter and the wetting move. Returns the stage it fell into, if any. */
export function stepWarmth(w: Warmth, input: WarmthInput, dt: number): WarmthStage | undefined {
  const before = warmthStage(w.value);
  w.wet = Math.min(1, Math.max(0, w.wet + wetRate(w, input) * dt));
  w.value = Math.min(MAX_WARMTH, Math.max(0, w.value + warmthRate(w, input) * dt));
  const after = warmthStage(w.value);
  const rank = (s: WarmthStage): number =>
    ['warm', 'chilled', 'cold', 'freezing', 'frozen'].indexOf(s);
  return rank(after) > rank(before) ? after : undefined;
}

/** A point in zone meters, its height too. */
export interface HeatPoint {
  x: number;
  y: number;
  z: number;
}

/** How far up or down a hideout's stove reaches: its own floor, not the one above or below. */
export const STOVE_REACH_Y_M = 2;

/**
 * Whether you're warmed where you stand (plan 09 §3: a hideout's stove keeps it warm). A
 * fire (the ice road's, an island's hearth) warms you within `heatRadiusM`; a built stove
 * or fireplace within `stoveRadiusM` on its own floor. Under a roof, a district's or a
 * keeper's house is kept warm for you, but a hideout's roof is only shelter: its warmth is
 * the stove you built.
 */
export function heatedAt(
  at: HeatPoint,
  o: {
    fires: readonly { x: number; z: number }[];
    stoves: readonly HeatPoint[];
    indoors: boolean;
    inHideout: boolean;
  },
): boolean {
  const c = COLD.warmth;
  if (o.indoors && !o.inHideout) return true;
  if (o.fires.some((f) => Math.hypot(at.x - f.x, at.z - f.z) < c.heatRadiusM)) return true;
  return o.stoves.some(
    (s) =>
      Math.abs(at.y - s.y) <= STOVE_REACH_Y_M &&
      Math.hypot(at.x - s.x, at.z - s.z) < c.stoveRadiusM,
  );
}

/** Health lost a real second with no warmth left. */
export function coldHealthDrainS(w: Warmth): number {
  return w.value <= 0 ? COLD.warmth.drainHealthS : 0;
}

/** Aboard (or anywhere off your feet) for `gameSeconds`: the galley stove warms and dries you. */
export function warmAboard(w: Warmth, gameSeconds: number): void {
  const gain = (COLD.warmth.aboardPerHour * gameSeconds) / 3600;
  w.value = Math.min(MAX_WARMTH, w.value + gain);
  w.wet = Math.max(0, w.wet - gameSeconds / 3600);
}
