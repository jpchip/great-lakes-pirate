/**
 * The rules for the sounds ashore (Phase 7 piece I; plan 08 §20.4 row I, plan 15 §4.5,
 * §6.1 "Stealth"): which footstep a surface and a gait make and how loud, by the same
 * radius the guards hear (plan 08 §3.2); how a sound from across the district reaches you;
 * what a guard says as he changes his mind; how much of the stealth layer plays; and the
 * beds of the places you walk: the docks at night, the saloon heard from the street, the
 * island's woods. Pure functions, unit-tested; `foot-audio.ts` plays them.
 */

import type { Gait } from '../gameplay/onfoot/controller';
import type { Surface } from '../gameplay/onfoot/noise';
import type { GuardState } from '../gameplay/onfoot/stealth';

const clamp01 = (v: number): number => Math.min(1, Math.max(0, v));
const smooth = (t: number): number => {
  const c = clamp01(t);
  return c * c * (3 - 2 * c);
};

// ---------------------------------------------------------------------------------------
// Footsteps

/** The grounds a footstep was made for (tools/audio/lib/synth-foot.ts). */
export const STEP_GROUNDS = ['wood', 'dirt', 'gravel', 'grass', 'stone', 'snow'] as const;
export type StepGround = (typeof STEP_GROUNDS)[number];
export const STEP_VARIANTS = 2;

export const stepSoundId = (ground: StepGround, variant: number): string =>
  `sfx.foot.step-${ground}-${variant}`;

/** How each surface underfoot sounds: which recording, pitched how, and muffled or not. */
const GROUND: Record<Surface, { ground: StepGround; rate: number; lowpassHz?: number }> = {
  wood: { ground: 'wood', rate: 1 },
  // Boards over joists indoors: duller and a little lower than a pier's planks.
  interior: { ground: 'wood', rate: 0.9, lowpassHz: 2200 },
  dirt: { ground: 'dirt', rate: 1 },
  sand: { ground: 'dirt', rate: 1.18, lowpassHz: 3000 },
  sawdust: { ground: 'dirt', rate: 0.85, lowpassHz: 1800 },
  gravel: { ground: 'gravel', rate: 1 },
  grass: { ground: 'grass', rate: 1 },
  stone: { ground: 'stone', rate: 1 },
  rock: { ground: 'stone', rate: 0.88 },
  snow: { ground: 'snow', rate: 1 },
};

/** A run's footstep on planks: the radius the loudest ordinary step carries, meters. */
export const LOUDEST_STEP_M = 18;
/** The quietest step still has a little sound to it. */
const STEP_FLOOR = 0.05;

/**
 * A footstep's gain from the radius the guards hear it at (plan 15 §4.5: "volume matches
 * gameplay noise radius"). A sneak on grass (under a meter) is barely there; a run on
 * planks (18 m) is full.
 */
export function stepGain(radiusM: number): number {
  if (radiusM <= 0) return 0;
  return STEP_FLOOR + (1 - STEP_FLOOR) * clamp01(radiusM / LOUDEST_STEP_M) ** 0.75;
}

export interface StepSound {
  id: string;
  gain: number;
  rate: number;
  lowpassHz: number | undefined;
}

/**
 * The footstep for a stride: `pick` (0–1) chooses the variant and nudges the pitch so no
 * two steps are the same. Nothing while swimming (strokes are their own sound), standing,
 * or in the air.
 */
export function stepSound(
  surface: Surface | 'water',
  gait: Gait,
  radiusM: number,
  pick: number,
): StepSound | undefined {
  if (surface === 'water' || gait === 'swim' || gait === 'idle' || gait === 'fall') {
    return undefined;
  }
  const gain = stepGain(radiusM);
  if (gain <= 0) return undefined;
  const g = GROUND[surface];
  const variant = 1 + (Math.floor(clamp01(pick) * 1000) % STEP_VARIANTS);
  // A sneak's step is slower and softer in pitch; a run's is sharper.
  const gaitRate = gait === 'sneak' ? 0.92 : gait === 'run' ? 1.06 : 1;
  const jitter = 0.94 + 0.12 * ((pick * 7919) % 1);
  return {
    id: stepSoundId(g.ground, variant),
    gain,
    rate: g.rate * gaitRate * jitter,
    lowpassHz: g.lowpassHz ?? (gait === 'sneak' ? 3200 : undefined),
  };
}

/** A landing's gain from how fast you came down, m/s: nothing below a hop's 3 m/s. */
export function landGain(speed: number): number {
  return speed < 3 ? 0 : 0.25 + 0.75 * clamp01((speed - 3) / 7);
}

// ---------------------------------------------------------------------------------------
// Sounds from across the district

export interface Heard {
  gain: number;
  lowpassHz: number;
}

/**
 * How a sound that carries `radiusM` reaches a listener `distanceM` away: full beside it,
 * fading and duller toward its edge, gone past it. `walled` (you indoors and it out, or
 * the other way) halves the reach and muffles it, like the guards' own hearing.
 */
export function heardAt(distanceM: number, radiusM: number, walled = false): Heard | undefined {
  const r = radiusM * (walled ? 0.5 : 1);
  if (r <= 0 || distanceM >= r) return undefined;
  const near = 1 - distanceM / r;
  return {
    gain: 0.08 + 0.92 * near ** 1.4,
    lowpassHz: (walled ? 0.35 : 1) * (1200 + 9000 * near),
  };
}

/** How far each of the watch's sounds carries to you, meters (a voice, a shout, a whistle). */
export const VOICE_REACH_M = { hm: 16, who: 24, hey: 45, mutter: 12, giveup: 14 } as const;
export const WHISTLE_REACH_M = 140;

// ---------------------------------------------------------------------------------------
// The watch's voices

export type BarkId = keyof typeof VOICE_REACH_M;

export interface Bark {
  bark: BarkId;
  /** The caption's words (plan 15 §5). */
  caption: string;
}

/**
 * What a guard says as his state changes (plan 15 §4.5): a hum as he grows suspicious, a
 * challenge when a noise draws him, a shout when he's sure, a mutter as he starts to
 * search, a grunt as he gives it up. Nothing for the states a man has no say in.
 */
export function barkFor(from: GuardState, to: GuardState, name: string): Bark | undefined {
  const who = name.charAt(0).toUpperCase() + name.slice(1);
  switch (to) {
    case 'suspicious':
      return from === 'alerted' || from === 'search'
        ? undefined
        : { bark: 'hm', caption: `${who}: "Hm?"` };
    case 'distracted':
      return { bark: 'who', caption: `${who}: "Who's there?"` };
    case 'alerted':
      return { bark: 'hey', caption: `${who}: "Hey! Stop!"` };
    case 'search':
      return { bark: 'mutter', caption: `${who} mutters, searching` };
    case 'return':
      return from === 'search' || from === 'suspicious' || from === 'distracted'
        ? { bark: 'giveup', caption: `${who} gives it up` }
        : undefined;
    default:
      return undefined;
  }
}

/** A voice's pitch by the man: marshals low and slow, a sailor higher. */
export function voiceRate(type: string, id: string): number {
  const base = type === 'npc.marshal' ? 0.86 : type === 'npc.sailor' ? 1.08 : 1;
  // Each man his own voice, steady for the night: a few percent either way by his id.
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) % 997;
  return base * (0.95 + 0.1 * (h / 997));
}

// ---------------------------------------------------------------------------------------
// The stealth layer

export interface GuardHeard {
  state: GuardState;
  /** His suspicion meter, 0–1. */
  meter: number;
  distanceM: number;
}

/** A guard this far off adds nothing to the tension. */
export const TENSION_REACH_M = 60;

/**
 * How tense the night is, 0–1, from the guards near you: a filling meter raises it a
 * little, a search more, a chase all the way; distance thins all but the chase.
 */
export function tension01(guards: readonly GuardHeard[]): number {
  let t = 0;
  for (const g of guards) {
    const near = 1 - smooth((g.distanceM - 15) / (TENSION_REACH_M - 15));
    let v: number;
    switch (g.state) {
      case 'alerted':
      case 'fetch':
        v = 1;
        break;
      case 'search':
        v = 0.5 + 0.25 * near;
        break;
      case 'suspicious':
      case 'distracted':
        v = (0.3 + 0.3 * clamp01(g.meter)) * near;
        break;
      case 'patrol':
      case 'return':
        v = 0.45 * clamp01(g.meter) * near;
        break;
      default:
        v = 0;
    }
    t = Math.max(t, v);
  }
  return t;
}

/** The layer's gain: silent while nothing's amiss, in by a third, full in a chase. */
export function tensionGain(tension: number): number {
  return 0.9 * smooth((tension - 0.12) / 0.75);
}

/** Seconds after a "seen" stinger before another may play. */
export const SPOTTED_GAP_S = 12;

// ---------------------------------------------------------------------------------------
// Places

export interface PlaceInputs {
  place: 'district' | 'island' | 'shore';
  /** Under a roof. */
  inside: boolean;
  sunElevationDeg: number;
  /** Calendar month, 0 = January. */
  month0: number;
  windKn: number;
  rain01: number;
  /** Meters to the saloon's door, and whether it's open; undefined where there is none. */
  saloon: { distanceM: number; open: boolean; within: boolean } | undefined;
  swimming: boolean;
}

export interface PlaceMix {
  docks: number;
  docksLowpassHz: number;
  forest: number;
  crickets: number;
  room: number;
  tune: number;
  saloonLowpassHz: number;
}

/** The saloon's tune and talk reach this far down the street, meters. */
export const SALOON_REACH_M = 38;

/**
 * The beds of the place you're walking. The docks' water is heard in a district, more
 * after dark when the town's work has stopped, and faintly through a wall. The woods
 * sound on an island and along a wild shore, with the wind. Crickets sing on warm nights,
 * June to September, away from the rain. The saloon is a muffled tune from the street
 * that opens up as you go in.
 */
export function placeMix(i: PlaceInputs): PlaceMix {
  const night = smooth((2 - i.sunElevationDeg) / 8);
  const open = i.inside ? 0.3 : 1;
  const afloat = i.swimming ? 0.5 : 1;
  const docks = i.place === 'district' ? (0.3 + 0.5 * night) * open : 0;
  const wild = i.place === 'district' ? 0 : 1;
  const forest = wild * (0.18 + 0.82 * clamp01(i.windKn / 22) ** 0.8) * 0.75 * afloat;
  const summer = i.month0 >= 5 && i.month0 <= 8 ? 1 : 0;
  const crickets =
    summer * night * (1 - clamp01(i.rain01 * 2)) * (i.place === 'district' ? 0.25 : 0.5) * open;
  let room = 0;
  let tune = 0;
  let saloonLowpassHz = 900;
  if (i.saloon?.open) {
    if (i.saloon.within) {
      room = 0.8;
      tune = 0.7;
      saloonLowpassHz = 12000;
    } else {
      const near = 1 - clamp01(i.saloon.distanceM / SALOON_REACH_M);
      // Through the wall: the tune's bass and a murmur, brighter by the door.
      room = 0.35 * near ** 2 * open;
      tune = 0.5 * near ** 1.5 * open;
      saloonLowpassHz = 500 + 1900 * near ** 2;
    }
  }
  return {
    docks,
    docksLowpassHz: i.inside ? 900 : 9000,
    forest,
    crickets,
    room,
    tune,
    saloonLowpassHz,
  };
}

// ---------------------------------------------------------------------------------------
// Swimming

/**
 * Seconds between shivering breaths in water this cold, or undefined when it's warm
 * enough not to (above 18 °C).
 */
export function shiverEveryS(waterC: number): number | undefined {
  if (waterC >= 18) return undefined;
  return 3 + 6 * clamp01((waterC - 2) / 16);
}

// ---------------------------------------------------------------------------------------
// Each saloon's tunes (plan 15 §25.2)

/** The songs a saloon plays by day and from supper on, by sound id. */
export interface SaloonTunes {
  day: string;
  night: string;
}

/** Bayfield's (and any saloon without its own): "The Little Brown Bulls", "The Late Boat Waltz". */
export const DEFAULT_SALOON_TUNES: SaloonTunes = {
  day: 'music.foot.saloon',
  night: 'music.saloon.night',
};

/**
 * A saloon's own tunes, by district: Duluth's plays "The Shanty-Man's Life" by day and
 * "Michigan-I-O" on the fiddle and piano at night, so the two towns don't sound alike.
 */
export const SALOON_TUNES: Readonly<Record<string, SaloonTunes>> = {
  'district.bayfield': DEFAULT_SALOON_TUNES,
  'district.duluth': { day: 'music.saloon.day-duluth', night: 'music.saloon.night-duluth' },
};

export function saloonTunes(district: string | undefined): SaloonTunes {
  return (district === undefined ? undefined : SALOON_TUNES[district]) ?? DEFAULT_SALOON_TUNES;
}
