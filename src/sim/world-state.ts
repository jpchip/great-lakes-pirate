import { z } from 'zod';

/**
 * WorldState skeleton (plan 01 §3.1, plan 16 §5.2). Each slice is filled in by its
 * owner plan; any shape change bumps CURRENT_SAVE_VERSION and adds a migration.
 */
export const worldStateSchema = z.object({
  player: z.looseObject({}),
  environment: z.looseObject({}),
});

export type WorldState = z.infer<typeof worldStateSchema>;
