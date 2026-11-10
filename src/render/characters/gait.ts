import type { Gait } from '../../gameplay/onfoot/controller';
import type { ClipName } from './humanoid-spec';

/**
 * Which clip a moving character plays (plan 08 §3.2, §20 piece B), and how fast, so the
 * feet keep pace with the controller instead of sliding. No three.js: unit-tested.
 */

/** Ground speed each locomotion clip was animated at, m/s (measured by eye on a grid). */
export const CLIP_SPEED: Partial<Record<ClipName, number>> = {
  walk: 1.6,
  run: 3.6,
  sprint: 5.8,
  sneak: 1.1,
  carry: 1.3,
  swim: 1.2,
};

export interface GaitInput {
  gait: Gait;
  /** Horizontal speed, m/s. */
  speed: number;
  /** Carrying a crate (plan 08 §7). */
  carrying?: boolean;
  /** A held lantern swaps the standing idle for the lantern one. */
  lantern?: boolean;
}

export interface GaitClip {
  clip: ClipName;
  timeScale: number;
}

const STILL = 0.15;

export function gaitClip(input: GaitInput): GaitClip {
  const { gait, speed } = input;
  const scaled = (clip: ClipName): GaitClip => {
    const nominal = CLIP_SPEED[clip] ?? 1;
    return { clip, timeScale: Math.min(1.8, Math.max(0.5, speed / nominal)) };
  };
  switch (gait) {
    case 'swim':
      return speed < STILL ? { clip: 'swimIdle', timeScale: 1 } : scaled('swim');
    case 'fall':
      return { clip: 'fall', timeScale: 1 };
    case 'slide':
      return { clip: 'fall', timeScale: 0.5 };
    case 'sneak':
      return speed < STILL ? { clip: 'sneakIdle', timeScale: 1 } : scaled('sneak');
    case 'idle':
      if (input.carrying) return { clip: 'carry', timeScale: 0 };
      return { clip: input.lantern ? 'lanternIdle' : 'idle', timeScale: 1 };
    case 'walk':
      return scaled(input.carrying ? 'carry' : 'walk');
    case 'run':
      if (input.carrying) return scaled('carry');
      return scaled(speed > 4.6 ? 'sprint' : 'run');
  }
}
