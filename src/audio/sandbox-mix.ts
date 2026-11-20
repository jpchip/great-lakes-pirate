import type { PokerBeat } from '../sim/poker/table';

/**
 * The rules behind stage 1's sounds (Phase 9 piece J; plan 11 §18.4 row J), pure so the
 * tests can hold them: which tune the saloon plays at what hour, the poker table's beats
 * as a run of cues, how the lamp's clockwork and a sleeping keeper carry, and how far off a
 * ship going aground is heard.
 */

/** The cues the sounds play from the table's beats and the station's work. */
export type SandboxCueId =
  | 'shuffle'
  | 'deal'
  | 'chips'
  | 'rake'
  | 'knock'
  | 'fold'
  | 'show'
  | 'wind'
  | 'douse'
  | 'light'
  | 'oil'
  | 'slosh'
  | 'stair'
  | 'greeting'
  | 'rope'
  | 'cashbox'
  | 'paper'
  | 'crateDown';

export interface Cue {
  id: SandboxCueId;
  /** Seconds from now. */
  delay: number;
  gain: number;
  rate: number;
}

const clamp01 = (x: number): number => Math.min(1, Math.max(0, x));

// ---------------------------------------------------------------------------------------
// The saloon

/** The piano and fiddle play from supper till the small hours; the polka by day. */
export const SALOON_NIGHT_HOURS: readonly [number, number] = [19, 5];

export function saloonNight(hour: number): boolean {
  const [from, to] = SALOON_NIGHT_HOURS;
  const h = ((hour % 24) + 24) % 24;
  return from > to ? h >= from || h < to : h >= from && h < to;
}

// ---------------------------------------------------------------------------------------
// The card table

/** Seconds between the table's moves as they're heard, so a round reads in order. */
export const POKER_STEP_S = 0.55;
/** The longest a run of beats is spread over, seconds: a long round is quickened. */
export const POKER_MAX_S = 9;

/**
 * The table's beats as cues: a deal is the antes in, the shuffle and the cards dealt round;
 * a check is two knuckle raps; a call, bet or raise chips onto the pile (more for a
 * raise); a fold the cards tossed in; a draw a card dealt for each taken (a rap for
 * standing pat); a showdown the hands turned up; and the pot raked in, nearer and louder
 * when it's yours. Captains' moves are a little softer than yours.
 */
export function pokerCues(beats: readonly PokerBeat[], random: () => number): Cue[] {
  const out: Cue[] = [];
  let t = 0;
  const at = (id: SandboxCueId, gain: number, dt = 0, rate = 0.95 + 0.1 * random()): void => {
    out.push({ id, delay: t + dt, gain, rate });
  };
  for (const b of beats) {
    const g = b.you ? 1 : 0.8;
    switch (b.kind) {
      case 'deal': {
        at('chips', 0.6, 0);
        at('chips', 0.5, 0.18);
        at('shuffle', 0.8, 0.45);
        t += 2.4;
        const cards = Math.min(20, b.cards ?? 20);
        for (let k = 0; k < cards; k++) at('deal', 0.5 + 0.2 * random(), k * 0.09);
        t += cards * 0.09 + 0.3;
        break;
      }
      case 'check':
        at('knock', 0.6 * g);
        t += POKER_STEP_S;
        break;
      case 'call':
        at('chips', 0.7 * g);
        t += POKER_STEP_S;
        break;
      case 'bet':
      case 'raise':
        at('chips', 0.8 * g);
        at('chips', 0.6 * g, 0.16);
        if (b.kind === 'raise') at('chips', 0.6 * g, 0.3);
        t += POKER_STEP_S + 0.2;
        break;
      case 'fold':
        at('fold', 0.7 * g);
        t += POKER_STEP_S;
        break;
      case 'draw': {
        const n = b.cards ?? 0;
        if (n === 0) at('knock', 0.35 * g, 0, 1.15);
        // The discards tossed in, then the new ones dealt.
        else at('fold', 0.4 * g);
        for (let k = 0; k < n; k++) at('deal', 0.55 * g, 0.25 + k * 0.1);
        t += POKER_STEP_S + n * 0.1;
        break;
      }
      case 'show':
        at('show', 0.8);
        t += 0.9;
        break;
      case 'won':
        at('rake', b.you ? 0.85 : 0.5, 0.1, b.you ? 1 : 0.92);
        t += 1.6;
        break;
    }
  }
  // A long round (every captain raising) is played a little quicker, never cut.
  const end = out.reduce((m, c) => Math.max(m, c.delay), 0);
  if (end > POKER_MAX_S) {
    const k = POKER_MAX_S / end;
    for (const c of out) c.delay *= k;
  }
  return out;
}

// ---------------------------------------------------------------------------------------
// The lighthouse station

/** The clockwork carries this far, meters (down the tower and out of its door). */
export const CLOCKWORK_REACH_M = 30;
/** A keeper's snore is heard this far from the house's door. */
export const SNORE_REACH_M = 9;
/** Meters walked with a can between sloshes. */
export const SLOSH_EVERY_M = 1.6;

export interface BedLevel {
  gain: number;
  lowpassHz: number;
}

/**
 * The lamp's clockwork: full in the lantern room beside it, and from the ground a dull
 * tick through the tower's brick that fades by `CLOCKWORK_REACH_M`. Silent while the lamp
 * is out or by day, when the lens stands still.
 */
export function clockworkLevel(distanceM: number, aloft: boolean, turning: boolean): BedLevel {
  if (!turning) return { gain: 0, lowpassHz: 800 };
  if (aloft) return { gain: 1 - 0.3 * clamp01(distanceM / 6), lowpassHz: 12000 };
  const near = 1 - clamp01(distanceM / CLOCKWORK_REACH_M);
  return { gain: 0.35 * near ** 2, lowpassHz: 600 + 900 * near };
}

/** A keeper asleep: heard at the house's door, through the wall, a few each louder. */
export function snoreLevel(distanceM: number, sleepers: number): BedLevel {
  if (sleepers <= 0) return { gain: 0, lowpassHz: 1200 };
  const near = 1 - clamp01(distanceM / SNORE_REACH_M);
  return {
    gain: near ** 1.5 * Math.min(1, 0.7 + 0.15 * sleepers),
    lowpassHz: 900 + 1400 * near,
  };
}

/** The cues for something done at the station. */
export function stationCues(
  cue: 'light' | 'douse' | 'climb' | 'talk' | 'oil' | 'tie' | 'search' | 'logbook' | 'stow',
): Cue[] {
  const one = (id: SandboxCueId, gain: number, delay = 0, rate = 1): Cue => ({
    id,
    delay,
    gain,
    rate,
  });
  switch (cue) {
    case 'light':
      // The match and flame, then the keeper's habit: the weight wound up again.
      return [one('light', 0.8), one('wind', 0.5, 2.4)];
    case 'douse':
      return [one('douse', 0.8)];
    case 'climb':
      return [one('stair', 0.6)];
    case 'talk':
      return [one('greeting', 0.8)];
    case 'oil':
      return [one('oil', 0.8)];
    case 'tie':
      return [one('rope', 0.7), one('rope', 0.6, 1.4, 0.92)];
    case 'search':
      return [one('cashbox', 0.7)];
    case 'logbook':
      return [one('paper', 0.6)];
    case 'stow':
      return [one('crateDown', 0.5, 0, 1.15), one('slosh', 0.6, 0.1)];
  }
}

// ---------------------------------------------------------------------------------------
// A ship aground

/** A ship striking a shoal at night is heard this far across the water, meters. */
export const AGROUND_REACH_M = 3000;

/**
 * A ship put on a shoal, heard from `distanceM`: near, the whole of it; farther, the boom
 * and the bell dulled and quieter; nothing past `AGROUND_REACH_M`. Fog's damping (0–1)
 * dulls it further, as it does the whistles.
 */
export function agroundHeard(distanceM: number, damping = 0): BedLevel | undefined {
  if (distanceM > AGROUND_REACH_M) return undefined;
  const near = 1 - clamp01(distanceM / AGROUND_REACH_M);
  return {
    gain: (0.15 + 0.85 * near ** 1.5) * (1 - 0.4 * damping),
    lowpassHz: (500 + 7500 * near ** 2) * (1 - 0.5 * damping),
  };
}

/** Your own ship touching bottom: how hard it's heard, by her speed and whether it's hard. */
export function groundingGain(speedKn: number, hard: boolean): number {
  const g = clamp01(speedKn / 8);
  return hard ? 0.5 + 0.5 * g : 0.2 + 0.4 * g;
}
