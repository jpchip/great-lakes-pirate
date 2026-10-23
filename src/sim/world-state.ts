import { z } from 'zod';
import { createClockState } from '../core/time';
import { Rng } from '../core/rng';

/**
 * WorldState skeleton (plan 01 §3.1, plan 16 §5.2). Each slice is filled in by its
 * owner plan; any shape change bumps CURRENT_SAVE_VERSION and adds a migration.
 */

const uint32 = z.number().int().min(0).max(0xffffffff);

export const clockStateSchema = z.object({
  gameSeconds: z.number().nonnegative(),
  worldTickAccumulator: z.number().nonnegative(),
});

export const worldStateSchema = z.object({
  player: z.looseObject({}),
  environment: z.looseObject({
    clock: clockStateSchema,
    /** Saved so a reload continues the same random sequence (plan 16 §4.4). */
    rng: z.tuple([uint32, uint32, uint32, uint32]),
  }),
});

export type WorldState = z.infer<typeof worldStateSchema>;

export function createWorldState(seed: string): WorldState {
  return {
    player: {},
    environment: {
      clock: createClockState(),
      rng: Rng.fromSeed(seed).getState(),
    },
  };
}

export function parseWorldState(state: unknown): WorldState {
  return worldStateSchema.parse(state);
}
