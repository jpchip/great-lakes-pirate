import type { Gait } from '../../gameplay/onfoot/controller';
import { gaitClip } from './gait';
import type { ClipName } from './humanoid-spec';

/**
 * Which clip a figure ashore plays (plan 08 §13, §20 piece B in the game): the captain by
 * gait and what their hands are doing, the watch and the townsfolk by their state and how
 * fast they're going. No three.js: unit-tested.
 */

export interface FigureClip {
  clip: ClipName;
  timeScale: number;
  /** Repeat a clip the library plays once (held work: picking a lock, tying a man). */
  loop?: boolean;
}

/** A one-shot the captain's hands just did, and how long ago (s). */
export type CaptainAct = 'cosh' | 'punch' | 'throw' | 'shoot' | 'drink' | 'pickUp' | 'talk';

/** How long each act's clip holds the body before the gait takes it back, seconds. */
export const ACT_SECONDS: Readonly<Record<CaptainAct, number>> = {
  cosh: 0.9,
  punch: 0.7,
  throw: 1.0,
  shoot: 0.9,
  drink: 1.6,
  pickUp: 1.1,
  talk: 1.4,
};

const ACT_CLIP: Readonly<Record<CaptainAct, ClipName>> = {
  cosh: 'cosh',
  punch: 'punch',
  throw: 'throw',
  shoot: 'pistolShoot',
  drink: 'drink',
  pickUp: 'pickUp',
  talk: 'talk',
};

export interface CaptainClipInput {
  gait: Gait;
  /** Horizontal speed, m/s. */
  speed: number;
  /** A crate, a man over the shoulder or a carcass. */
  carrying?: boolean | undefined;
  /** Holding F at a held job (a lock, rope on a man, a dig). */
  working?: boolean | undefined;
  /** The last act and how long ago it was. */
  act?: { kind: CaptainAct; ageS: number } | undefined;
  /** Sitting at the oars. */
  rowing?: boolean | undefined;
}

export function captainClip(input: CaptainClipInput): FigureClip {
  if (input.rowing) return { clip: 'sit', timeScale: 1 };
  const act = input.act;
  if (act && act.ageS < ACT_SECONDS[act.kind] && input.gait !== 'swim') {
    return { clip: ACT_CLIP[act.kind], timeScale: 1 };
  }
  if (input.working && input.speed < 0.3 && input.gait !== 'swim') {
    return { clip: input.gait === 'sneak' ? 'kneelWork' : 'pick', timeScale: 1, loop: true };
  }
  return gaitClip({ gait: input.gait, speed: input.speed, carrying: !!input.carrying });
}

export interface NpcClipInput {
  /** The guard FSM's state, or `idle` for townsfolk and shopkeepers. */
  state: string;
  /** Horizontal speed, m/s. */
  speed: number;
  /** The controller's gait when the figure has one (the watch); else from speed. */
  gait?: Gait | undefined;
  crouching?: boolean | undefined;
  /** Has a lit lantern in hand. */
  lantern?: boolean | undefined;
  /** What a standing figure does with their hands when it's doing nothing (see `idleFor`). */
  idle?: ClipName;
}

const STILL = 0.2;

/** A figure that stands about: a keeper at the counter, hands at a table, a passer-by. */
export function idleFor(type: string, id: string): ClipName {
  if (id.startsWith('crew:') || id.startsWith('cards:')) return 'talk';
  if (type === 'npc.shopkeeper' || type === 'npc.fence') return 'armsFolded';
  if (type === 'npc.keeper') return 'armsFolded';
  return 'idle';
}

export function npcClip(input: NpcClipInput): FigureClip {
  const { state, speed } = input;
  if (state === 'unconscious' || state === 'bound' || state === 'dead') {
    return { clip: 'knockedDown', timeScale: 1 };
  }
  const gait: Gait =
    input.gait ??
    (speed < STILL ? 'idle' : speed > 2.6 ? 'run' : input.crouching ? 'sneak' : 'walk');
  if (speed < STILL && gait !== 'swim' && gait !== 'fall') {
    switch (state) {
      case 'alerted':
      case 'suspicious':
        return { clip: 'alarmed', timeScale: 1, loop: true };
      case 'search':
        return { clip: 'search', timeScale: 1 };
      case 'drunk':
        return { clip: 'drink', timeScale: 0.6, loop: true };
      case 'bribed':
        return { clip: 'armsFolded', timeScale: 1 };
      case 'distracted':
        return { clip: 'talk', timeScale: 1 };
    }
    if (input.crouching) return { clip: 'sneakIdle', timeScale: 1 };
    if (input.lantern) return { clip: 'lanternIdle', timeScale: 1 };
    return { clip: input.idle ?? 'idle', timeScale: 1 };
  }
  return gaitClip({ gait, speed, lantern: !!input.lantern });
}
