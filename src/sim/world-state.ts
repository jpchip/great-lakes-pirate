import { z } from 'zod';
import { createClockState } from '../core/time';
import { Rng } from '../core/rng';
import { APOSTLES_ID } from './terrain/zones';
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

/** A ship's place in a zone: zone meters, heading in radians clockwise from north. */
export const poseSchema = z.object({ x: z.number(), z: z.number(), heading: z.number() });

/**
 * Where the player is (plan 03 §9 `player.location`; added in save v3). In a zone, with
 * the ship's pose there; no pose means the zone's spawn, which is what a new run and a
 * migrated v2 save get. On the chart (piece D), with the chart position and heading.
 */
export const locationSchema = z.discriminatedUnion('mode', [
  z.object({ mode: z.literal('zone'), zoneId: z.string(), pose: poseSchema.optional() }),
  z.object({
    mode: z.literal('chart'),
    chartPos: z.object({ x: z.number(), y: z.number() }),
    heading: z.number(),
    /** The zone the voyage left, for the way back. */
    fromZoneId: z.string().optional(),
  }),
]);

export type PlayerLocation = z.infer<typeof locationSchema>;

export const worldStateSchema = z.object({
  player: z.looseObject({ location: locationSchema }),
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
    // A new run starts at the Apostles spawn.
    player: { location: { mode: 'zone', zoneId: APOSTLES_ID } },
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
