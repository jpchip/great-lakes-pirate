import { z } from 'zod';
import { createClockState } from '../core/time';
import { Rng } from '../core/rng';
import { APOSTLES_ID } from './terrain/zones';
import { createWeatherState, type WeatherState } from './weather/weather';
import { gameEconomy } from './economy/defs';
import { createMarkets, syncMarkets } from './economy/market';

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

const chartPointSchema = z.object({ x: z.number(), y: z.number() });

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
    chartPos: chartPointSchema,
    heading: z.number(),
    /** The zone the voyage left, for the way back. */
    fromZoneId: z.string().optional(),
  }),
]);

export type PlayerLocation = z.infer<typeof locationSchema>;

/**
 * A voyage under way on the chart (plan 03 §9 `voyage`; added in save v4, Phase 3 piece
 * D): the plotted points from the departure on, and how far along them the ship is. The
 * legs are planned again from the points on load. Null when no voyage is under way.
 */
export const voyageSchema = z.object({
  points: z.array(chartPointSchema).min(2),
  leg: z.number().int().nonnegative(),
  progressM: z.number().nonnegative(),
  startedAt: z.number(),
});

/** Plan 12 §2.2's six backgrounds. */
export const BACKGROUNDS = [
  'deckhand',
  'fisherman',
  'lumberjack',
  'saloon_keeper',
  'ex_navy',
  'poacher',
] as const;

/**
 * Who the player is (plan 12 §2; added in save v5, Phase 4 piece A). Character creation
 * (piece C) fills it; until then every run, and every migrated 0.3.0 run, is a Deckhand.
 */
export const captainSchema = z.object({
  name: z.string().min(1),
  shipName: z.string().min(1),
  background: z.enum(BACKGROUNDS),
});

export type Captain = z.infer<typeof captainSchema>;

/** A stolen lot's flags (plan 05 §6.1). */
const hotMetaSchema = z.object({
  region: z.string(),
  heat: z.number().min(0).max(1),
  traceability: z.number().min(0).max(1),
  since: z.number(),
});

/** A stack in the hold, in whole CU (plan 05 §11 `player.cargo`). */
export const cargoStackSchema = z.object({
  good: z.string(),
  qty: z.number().int().positive(),
  hot: hotMetaSchema.optional(),
  contract: z.string().optional(),
});

/**
 * Every port's stock of every good it trades (plan 05 §11 `markets[portId][goodId]`; save
 * v5). Missing entries are filled at their seasonal target on load (`syncMarkets`).
 */
export const marketsSchema = z.record(
  z.string(),
  z.record(
    z.string(),
    z.object({ stock: z.number().nonnegative(), lastPlayerTradeAt: z.number().optional() }),
  ),
);

/**
 * The traffic's saved state (plan 05 §11 `traffic`, plan 01 §3.4; Phase 4 piece D). Every
 * ship's place and manifest follow from the run's seed and the clock, so only what
 * differs from the timetable is kept: when each ship was last hailed (her news is told
 * once a passage), and how far the cargo deliveries have run against the markets.
 * Phase 6 adds ships robbed or sunk here. Absent in an early v5 save: it starts empty.
 */
export const trafficStateSchema = z.object({
  /** Game seconds the deliveries have moved the markets up to. */
  deliveredTo: z.number(),
  ships: z.record(z.string(), z.object({ hailedAt: z.number().optional() })),
});

export type TrafficState = z.infer<typeof trafficStateSchema>;

/**
 * What the captain knows of prices elsewhere (plan 05 §4.3, §11 `knowledge.prices`; save
 * v6, Phase 4 piece B): per port and good, the last prices seen and when.
 */
export const knowledgeSchema = z.object({
  prices: z.record(
    z.string(),
    z.record(
      z.string(),
      z.object({
        buyCents: z.number().int().nonnegative(),
        sellCents: z.number().int().nonnegative(),
        seenAt: z.number(),
      }),
    ),
  ),
});

/** Ship's stores in the lockers, by store id (plan 05 §7; save v6). */
export const storesSchema = z.record(z.string(), z.number().int().nonnegative());

/** A Phase 4 captain before character creation: the Deckhand of plan 12 §2.2. */
export function defaultCaptain(): Captain {
  return { name: 'Captain', shipName: 'Schooner', background: 'deckhand' };
}

/** The Deckhand's start (plan 12 §2.2): $150 and a few CU of rope and canvas. */
export const DECKHAND_PURSE_CENTS = 15_000;
export const DECKHAND_CARGO = [{ good: 'good.rope_canvas', qty: 5 }] as const;

export const worldStateSchema = z.object({
  player: z.looseObject({
    location: locationSchema,
    captain: captainSchema,
    /** Cash on hand, integer cents (plan 05 §2). Stashed money is the stash's (piece E). */
    purse: z.number().int().nonnegative(),
    cargo: z.array(cargoStackSchema),
    /** Patch and mend kits, lamp oil, provisions (the chandlery; piece B). */
    stores: storesSchema,
  }),
  voyage: voyageSchema.nullable(),
  markets: marketsSchema,
  traffic: trafficStateSchema.optional(),
  knowledge: knowledgeSchema,
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
    player: {
      location: { mode: 'zone', zoneId: APOSTLES_ID },
      captain: defaultCaptain(),
      purse: DECKHAND_PURSE_CENTS,
      cargo: DECKHAND_CARGO.map((s) => ({ ...s })),
      stores: {},
    },
    voyage: null,
    markets: createMarkets(gameEconomy(), clock.gameSeconds),
    traffic: { deliveredTo: clock.gameSeconds, ships: {} },
    knowledge: { prices: {} },
    environment: {
      clock,
      rng: Rng.fromSeed(seed).getState(),
      weather: createWeatherState(seed, clock.gameSeconds),
    },
  };
}

/** Validates a loaded save and gives any port or good it lacks a market (plan 05 §11). */
export function parseWorldState(state: unknown): WorldState {
  const parsed = worldStateSchema.parse(state);
  syncMarkets(gameEconomy(), parsed.markets, parsed.environment.clock.gameSeconds);
  parsed.traffic ??= { deliveredTo: parsed.environment.clock.gameSeconds, ships: {} };
  return parsed;
}
