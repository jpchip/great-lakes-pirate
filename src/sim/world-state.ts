import { z } from 'zod';
import { createClockState } from '../core/time';
import { Rng } from '../core/rng';
import { createWeatherState, type WeatherState } from './weather/weather';

/**
 * WorldState skeleton (plan 01 §3.1, plan 16 §5.2). Each slice is filled in by its
 * owner plan; any shape change bumps CURRENT_SAVE_VERSION and adds a migration.
 */

const uint32 = z.number().int().min(0).max(0xffffffff);
const rngState = z.tuple([uint32, uint32, uint32, uint32]);

export const clockStateSchema = z.object({
  gameSeconds: z.number().nonnegative(),
  worldTickAccumulator: z.number().nonnegative(),
});

const pressureSystemSchema = z.object({
  id: z.number().int().positive(),
  kind: z.enum(['low', 'high']),
  track: z.enum(['clipper', 'panhandle', 'pacific', 'high']),
  x: z.number(),
  y: z.number(),
  vx: z.number(),
  vy: z.number(),
  radius: z.number().positive(),
  peakHpa: z.number(),
  age: z.number(),
  life: z.number().positive(),
});

const fogBankSchema = z.object({
  id: z.number().int().positive(),
  kind: z.enum(['advection', 'radiation']),
  x: z.number(),
  y: z.number(),
  vx: z.number(),
  vy: z.number(),
  radius: z.number().positive(),
  coreVisibilityM: z.number().positive(),
  age: z.number(),
  life: z.number().positive(),
});

/** The S9 weather sim's state (plan 04 §13, §24): plain data, at most a few KB. */
export const weatherStateSchema: z.ZodType<WeatherState> = z.object({
  rng: rngState,
  noiseSeed: uint32,
  nextId: z.number().int().positive(),
  tickSeconds: z.number(),
  systems: z.array(pressureSystemSchema),
  fogBanks: z.array(fogBankSchema),
});

export const worldStateSchema = z.object({
  player: z.looseObject({}),
  environment: z.looseObject({
    clock: clockStateSchema,
    /** Saved so a reload continues the same random sequence (plan 16 §4.4). */
    rng: rngState,
    /** Pressure systems and fog banks (plan 04 §5); added in save v2. */
    weather: weatherStateSchema,
  }),
});

export type WorldState = z.infer<typeof worldStateSchema>;

export function createWorldState(seed: string): WorldState {
  const clock = createClockState();
  return {
    player: {},
    environment: {
      clock,
      rng: Rng.fromSeed(seed).getState(),
      weather: createWeatherState(seed, clock.gameSeconds),
    },
  };
}

export function parseWorldState(state: unknown): WorldState {
  return worldStateSchema.parse(state);
}
