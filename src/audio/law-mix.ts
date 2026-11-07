/**
 * The law's sound rules (Phase 5 piece H; plan 06 §14.4 row H, plan 15 §4.4, §6.1): which
 * Wanted stinger a tier change earns, the cutter's whistle signals when she hails, her
 * bell (the ship's time, and the alarm as she starts a chase), how loud her engine is with
 * distance and speed, and when her gun's report and the round's fall reach the listener.
 * Pure functions, unit-tested; `law-audio.ts` plays them.
 */

import { SOUND_MS } from './world-mix';

// ---------------------------------------------------------------------------------------
// Wanted stingers

export type WantedStingerId = 'rise' | 'hunted' | 'most' | 'cool';

/** How much a stinger matters: a sharper one may cut in on a milder one's quiet spell. */
export const WANTED_STINGER_RANK: Readonly<Record<WantedStingerId, number>> = {
  cool: 0,
  rise: 1,
  hunted: 2,
  most: 3,
};

/** Seconds after a stinger before another of the same or lower rank may play. */
export const WANTED_STINGER_GAP_S = 8;

export interface TierChange {
  region: string;
  from: number;
  to: number;
}

/**
 * The stinger for the tier changes that came in together (one frame's worth). A rise
 * anywhere is news, since word reaching the law in another region is still word about you:
 * the highest tier reached picks it (5 the bell, 3–4 hunted, 1–2 the souring chord). A fall
 * plays only for the region you're in (paying a fine, or cooling off while you sail it);
 * other regions cool quietly on their own.
 */
export function wantedStingerFor(
  changes: readonly TierChange[],
  playerRegion: string | undefined,
): WantedStingerId | undefined {
  let top = -1;
  let cooled = false;
  for (const c of changes) {
    if (c.to > c.from) top = Math.max(top, c.to);
    else if (c.to < c.from && c.region === playerRegion) cooled = true;
  }
  if (top >= 5) return 'most';
  if (top >= 3) return 'hunted';
  if (top >= 1) return 'rise';
  return cooled ? 'cool' : undefined;
}

/** Whether a stinger may play now, `sinceLastS` after one of rank `lastRank`. */
export function stingerAllowed(
  id: WantedStingerId,
  lastRank: number | undefined,
  sinceLastS: number,
): boolean {
  if (lastRank === undefined || sinceLastS >= WANTED_STINGER_GAP_S) return true;
  return WANTED_STINGER_RANK[id] > lastRank;
}

// ---------------------------------------------------------------------------------------
// Her whistle

export type HailKind = 'inspect' | 'pursue' | 'arrest';

/** What a hail event asks for. */
export function hailKind(e: { intent: 'inspect' | 'pursue'; arrest: boolean }): HailKind {
  return e.arrest ? 'arrest' : e.intent;
}

/** [start, length] of each blast, seconds. */
export type BlastPattern = readonly (readonly [number, number])[];

/**
 * Her whistle as she hails. Heave to for inspection: one long blast and a short one.
 * In pursuit: the alarm, five short, rapid blasts (the 1895 lakes rules' signal of doubt
 * and danger was "several short and rapid blasts"; how a cutter called a ship to heave to
 * isn't recorded in R1, so this is an assumption). Under arrest: one long blast.
 */
export function hailPattern(kind: HailKind): BlastPattern {
  switch (kind) {
    case 'inspect':
      return [
        [0, 2.4],
        [3.1, 0.8],
      ];
    case 'pursue':
      return [0, 1, 2, 3, 4].map((k) => [k * 0.85, 0.5] as const);
    case 'arrest':
      return [[0, 3]];
  }
}

export const HAIL_CAPTIONS: Readonly<Record<HailKind, string>> = {
  inspect: 'whistle, long and short (heave to for inspection)',
  pursue: 'whistle, five short blasts (heave to!)',
  arrest: 'whistle, one long blast (stand by to be boarded)',
};

// ---------------------------------------------------------------------------------------
// Her bell

/**
 * The strokes of the ship's bell at `hour` (0–24, game time): one at half past the start
 * of a watch, up to eight at its end, every four hours.
 */
export function shipsBells(hour: number): number {
  const halfHours = Math.round(hour * 2);
  return ((halfHours + 7) % 8) + 1;
}

/** Seconds from the first stroke of each, struck in pairs: ding-ding, ding-ding, ding. */
export function bellPattern(strokes: number): number[] {
  const out: number[] = [];
  let t = 0;
  for (let k = 0; k < strokes; k++) {
    out.push(t);
    t += k % 2 === 0 ? 0.42 : 1.05;
  }
  return out;
}

/** Game seconds between bells. */
export const HALF_HOUR_S = 1800;

/**
 * The half-hour mark crossed between two clock readings, game seconds, or undefined when
 * none was, or when the clock jumped (waiting, chart travel, jail), which isn't heard.
 */
export function bellDue(prevGameS: number, nowGameS: number): number | undefined {
  const a = Math.floor(prevGameS / HALF_HOUR_S);
  const b = Math.floor(nowGameS / HALF_HOUR_S);
  if (b !== a + 1 || nowGameS - prevGameS > HALF_HOUR_S / 4) return undefined;
  return b * HALF_HOUR_S;
}

/** The alarm as she sets off after you: the bell rung hard and fast, seconds. */
export const ALARM_STROKES: readonly number[] = Array.from({ length: 12 }, (_, k) => k * 0.19);

/** How far her bell is heard, meters. */
export const BELL_RANGE_M = 1600;

// ---------------------------------------------------------------------------------------
// Her engine

/** How far her engine is heard across the water, meters. */
export const ENGINE_RANGE_M = 1200;
/** Her speed at full ahead, knots (law_actors' cruise is 10; she makes 12 in a flat calm). */
const FULL_KN = 12;

/**
 * Her engine at `distanceM` making `speedKn`: louder and faster with way on her (the
 * loop's rate follows the revolutions), duller and fainter with distance and fog. A
 * smaller engine (the tug) runs faster. Undefined past its range.
 */
export function engineLevel(
  distanceM: number,
  speedKn: number,
  damping = 1,
  small = false,
): { gain: number; lowpassHz: number; rate: number } | undefined {
  if (distanceM >= ENGINE_RANGE_M) return undefined;
  const ref = 60;
  const d = Math.max(distanceM, ref);
  const edge = smoothstep((ENGINE_RANGE_M - distanceM) / (0.25 * ENGINE_RANGE_M));
  const way = Math.min(Math.max(speedKn / FULL_KN, 0), 1.1);
  return {
    gain: (ref / d) * edge * (0.3 + 0.7 * way) * (small ? 0.7 : 0.9),
    lowpassHz: Math.max(250, 9000 * (ref / d) ** 0.55 * damping),
    rate: (0.7 + 0.35 * way) * (small ? 1.35 : 1),
  };
}

// ---------------------------------------------------------------------------------------
// Her gun

/** A round's speed on its way, m/s: a 6-pounder's muzzle velocity, slowing a little. */
export const SHELL_MS = 520;

/**
 * When a shot is heard, seconds from now: the report from her gun, and the round falling
 * (its flight and then the sound of it from where it fell).
 */
export function shotTiming(
  gun: { x: number; z: number },
  fell: { x: number; z: number } | undefined,
  listener: { x: number; z: number },
): { reportS: number; fallS: number | undefined } {
  const reportS = Math.hypot(gun.x - listener.x, gun.z - listener.z) / SOUND_MS;
  if (!fell) return { reportS, fallS: undefined };
  const flight = Math.hypot(fell.x - gun.x, fell.z - gun.z) / SHELL_MS;
  return {
    reportS,
    fallS: flight + Math.hypot(fell.x - listener.x, fell.z - listener.z) / SOUND_MS,
  };
}

/**
 * A gunshot's level at `distanceM`: `rangeM` how far it carries, `refM` the distance it's
 * at full level within. Duller with distance and fog. Undefined past its range.
 */
export function shotLevel(
  distanceM: number,
  rangeM: number,
  refM: number,
  damping = 1,
): { gain: number; lowpassHz: number } | undefined {
  if (distanceM >= rangeM) return undefined;
  const d = Math.max(distanceM, refM);
  const edge = smoothstep((rangeM - distanceM) / (0.2 * rangeM));
  return {
    gain: (refM / d) ** 0.8 * edge,
    lowpassHz: Math.max(400, 14000 * (refM / d) ** 0.5 * damping),
  };
}

export const GUN_RANGE = { gun: [8000, 150], rifle: [2500, 40], splash: [1500, 40] } as const;

export const FIRE_CAPTIONS = {
  warning: 'gun, a shot across your bow',
  rigging: 'gun, firing on your rigging',
  rifle: 'rifle shots',
} as const;

function smoothstep(t: number): number {
  const c = Math.min(Math.max(t, 0), 1);
  return c * c * (3 - 2 * c);
}
