import { wrecksSchema } from './wrecks';
import { z } from 'zod';
import { lawShipsSchema } from './law/patrol';
import { RUMOR_KINDS } from '../../data/schemas/rumors';
import { createClockState } from '../core/time';
import { Rng } from '../core/rng';
import { APOSTLES_ID } from './terrain/zones';
import { createWeatherState, type WeatherState } from './weather/weather';
import { gameEconomy } from './economy/defs';
import { createMarkets, syncMarkets } from './economy/market';
import { createContractsState, type ContractsState } from './economy/contracts';
import { CONTRACT_KINDS, CONTRACT_TIERS } from '../../data/schemas/contracts';
import { freshContrabandState } from './economy/smuggler';
import { startingHideouts, syncHideouts } from './hideouts/stash';
import { firstWeekSchema } from './character/first-week';
import { defaultShipState } from './shipyard/shipyard';
import {
  createLawState,
  fameSchema,
  jailSchema,
  profilesSchema,
  reportsSchema,
  wantedSchema,
} from './law/state';
import { lanternStateSchema } from './law/lantern';
import { freshStats, logbookSchema, statsSchema } from './run/record';
import { newsSchema } from './news/state';
import { MOUNTS } from '../../data/schemas/combat';

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
 * (piece C) fills it; a migrated 0.3.0 run, and a run started past the main menu by a
 * check (`?play`), is a Deckhand. The portrait is a preset id from `data/portraits.json`
 * (piece C; absent before it, which shows the first preset).
 */
export const captainSchema = z.object({
  name: z.string().min(1),
  shipName: z.string().min(1),
  background: z.enum(BACKGROUNDS),
  portrait: z.string().optional(),
});

export type Captain = z.infer<typeof captainSchema>;
export type Background = Captain['background'];

/** A stolen lot's flags (plan 05 §6.1). */
const hotMetaSchema = z.object({
  region: z.string(),
  heat: z.number().min(0).max(1),
  traceability: z.number().min(0).max(1),
  since: z.number(),
  /** The owning company's marks on looted freight (Phase 6 piece D); absent otherwise. */
  owner: z.string().optional(),
});

/** A stack in the hold, in whole CU (plan 05 §11 `player.cargo`). */
export const cargoStackSchema = z.object({
  good: z.string(),
  qty: z.number().int().positive(),
  hot: hotMetaSchema.optional(),
  contract: z.string().optional(),
  /** What the stack's CU cost you in all, cents. Absent when unknown (starting cargo). */
  paidCents: z.number().int().nonnegative().optional(),
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
 * Phase 6 adds ships robbed, sunk or disabled here (piece D; optional fields, no version
 * bump). Absent in an early v5 save: it starts empty.
 */
export const trafficStateSchema = z.object({
  /** Game seconds the deliveries have moved the markets up to. */
  deliveredTo: z.number(),
  ships: z.record(
    z.string(),
    z.object({
      hailedAt: z.number().optional(),
      /**
       * Robbed (Phase 6 piece D): when, on which passage, what was taken and her cash. Her
       * manifest for that passage is short what was taken, and her cash box stays empty
       * a while.
       */
      robbed: z
        .object({
          at: z.number(),
          cycle: z.number().int().optional(),
          outbound: z.boolean().optional(),
          taken: z.array(z.object({ good: z.string(), qty: z.number().int().positive() })),
          cashCents: z.number().int().nonnegative(),
        })
        .optional(),
      /**
       * Off her timetable (Phase 6 piece D): sunk, scuttled, or disabled and limping in,
       * from `lostAt` until `lostUntil`. She isn't on the water, in port or on the chart,
       * and her calls don't move the markets.
       */
      lostAt: z.number().optional(),
      lostUntil: z.number().optional(),
      lostHow: z.enum(['sunk', 'scuttled', 'disabled']).optional(),
    }),
  ),
});

export type TrafficState = z.infer<typeof trafficStateSchema>;

/**
 * A rumor in the ledger (plan 05 §9; Phase 4 piece K). `truth` is rolled when it's told
 * and never shown: the ledger shows `reliability` as a word with the teller. `draft` is
 * what the talk was about, so it isn't told twice; `subject` what it came out naming (a
 * false smuggler rumor names a decoy anchorage).
 */
export const rumorSchema = z.object({
  id: z.string(),
  kind: z.enum(RUMOR_KINDS),
  source: z.enum(['saloon', 'hail']),
  /** The saloon it was heard in. */
  port: z.string().optional(),
  heardAt: z.number(),
  text: z.string(),
  teller: z.string().optional(),
  reliability: z.number().min(0).max(1),
  truth: z.boolean(),
  draft: z.string(),
  subject: z.string().optional(),
  /** Game seconds after which it's stale: the sailing's gone, the weather's come. */
  expiresAt: z.number().optional(),
});

export type Rumor = z.infer<typeof rumorSchema>;

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
        /** Heard, not seen (piece K): from a rumor or a hailed ship. */
        heard: z.enum(['rumor', 'hail']).optional(),
      }),
    ),
  ),
  /**
   * Rumors heard, newest first (plan 05 §9, §11 `knowledge.rumors`; Phase 4 piece K).
   * Absent in a save from before piece K: it starts empty, so no version bump.
   */
  rumors: z.array(rumorSchema).default([]),
});

/**
 * Contraband's saved state (plan 05 §6; Phase 4 piece H): the island smuggler's cash and
 * stock for the night and her trust in you, the ports whose merchants turned you away and
 * the week they did, the ports where you have a receiver, and whether you know where she lies;
 * Phase 6 piece E adds the other smugglers' boats and the port fences. Optional and filled on load, so
 * a v6 save from before piece H needs no migration.
 */
const smugglerStateSchema = z.object({
  night: z.number().int(),
  cashCents: z.number().int().nonnegative(),
  stock: z.record(z.string(), z.number().int().nonnegative()),
  dealtCents: z.number().int().nonnegative(),
});

export const contrabandStateSchema = z.object({
  /** The island smuggler, the first boat in `smuggler.json`. */
  smuggler: smugglerStateSchema,
  refusals: z.record(z.string(), z.number().int()),
  /** Ports with a merchant who has taken a lot from you: your receiver there. */
  receivers: z.array(z.string()).default([]),
  /** Where the island smuggler lies is known. */
  known: z.boolean(),
  /**
   * Phase 6 piece E: every other smuggler's boat by id (the Siskiwit Bay boat, plan 07
   * §14.6.1), and which of them you know of. Absent before 0.6.0, filled on load.
   */
  boats: z.record(z.string(), smugglerStateSchema).optional(),
  knownBoats: z.array(z.string()).optional(),
  /** The port fences (Phase 6 piece E): each one's cash tonight and his trust, by fence id. */
  fences: z
    .record(
      z.string(),
      z.object({
        night: z.number().int(),
        cashCents: z.number().int().nonnegative(),
        dealtCents: z.number().int().nonnegative(),
      }),
    )
    .optional(),
});

/**
 * Hideouts and what's stored in them (plan 09 §12 `hideouts[id]`; Phase 4 piece E): the
 * site, when it was claimed, and its storage of goods (stacks as in the hold, hot and
 * contract flags kept) and cash in the strongbox. Absent in a save from before piece E:
 * the background's starting hideout is given on load, empty, so no version bump.
 */
export const hideoutsSchema = z.record(
  z.string(),
  z.object({
    siteId: z.string(),
    claimedAt: z.number(),
    storage: z.object({
      goods: z.array(cargoStackSchema),
      cash: z.number().int().nonnegative(),
    }),
  }),
);

/** Ship's stores in the lockers, by store id (plan 05 §7; save v6). */
export const storesSchema = z.record(z.string(), z.number().int().nonnegative());

/** Standing by port or company id, 0–100 (plan 05 §5.2, §11 `player.standing`; piece F). */
export const standingSchema = z.record(z.string(), z.number().min(0).max(100));

const contractSchema = z.object({
  id: z.string(),
  template: z.string(),
  company: z.string(),
  kind: z.enum(CONTRACT_KINDS),
  tier: z.enum(CONTRACT_TIERS),
  from: z.string(),
  to: z.string(),
  good: z.string(),
  qty: z.number().int().positive(),
  payCents: z.number().int().nonnegative(),
  depositCents: z.number().int().nonnegative(),
  allowSeconds: z.number().nonnegative(),
  lateSeconds: z.number().nonnegative(),
  note: z.string(),
  acceptedAt: z.number(),
  dueAt: z.number(),
  expiresAt: z.number(),
  status: z.enum(['active', 'failed']),
  hits: z.number().int().nonnegative(),
});

const outcomeSchema = z.enum(['delivered', 'late', 'failed', 'abandoned', 'stolen']);

/**
 * Freight contracts (plan 05 §5.2, §11 `contracts`; Phase 4 piece F): the ones in hand,
 * the offers taken from boards still posted, the companies you've stolen from, the last
 * few finished for the ledger, and a count of each outcome. The boards themselves follow
 * from the run's seed and the clock. Absent in a save from before piece F: it starts
 * empty, like the traffic slice, so no version bump.
 */
export const contractsStateSchema: z.ZodType<ContractsState> = z.object({
  active: z.array(contractSchema),
  taken: z.array(z.string()),
  burned: z.array(z.string()),
  history: z.array(
    z.object({
      id: z.string(),
      company: z.string(),
      from: z.string(),
      to: z.string(),
      good: z.string(),
      qty: z.number().int().nonnegative(),
      outcome: outcomeSchema,
      at: z.number(),
      payCents: z.number().int().nonnegative(),
    }),
  ),
  tally: z.record(outcomeSchema, z.number().int().nonnegative()),
});

/**
 * The player's ship (plan 10 §11 `player.ship`; Phase 4 piece G): her class, the share
 * left of each damage pool, and the upgrades fitted. Her name is the captain's
 * `shipName`. Absent in a save from before the shipyard: a sound, bare T1.
 */
export const shipStateSchema = z.object({
  classId: z.string(),
  hull01: z.number().min(0).max(1),
  rigging01: z.number().min(0).max(1),
  upgrades: z.array(z.string()),
  /**
   * Her guns in their mounts (plan 07 §10 `player.ship.weapons[]`; save v8, Phase 6 piece
   * A): a bow swivel, broadside cannon, small arms. A 0.5.0 run carries small arms only.
   */
  weapons: z.array(z.object({ weapon: z.string(), mount: z.enum(MOUNTS) })),
});

/** Loose powder charges out of opened kegs (plan 07 §10 `player.ammo`; save v8). */
export const ammoStateSchema = z.object({ charges: z.number().int().nonnegative() });

/** A Phase 4 captain before character creation: the Deckhand of plan 12 §2.2. */
export function defaultCaptain(): Captain {
  return { name: 'Captain', shipName: 'Schooner', background: 'deckhand' };
}

/**
 * Ashore (plan 08 §20, Phase 7 piece A; save v9): you left the ship at a berth or at
 * anchor and are on foot, swimming, or in the boat. `location` still holds the ship's
 * place; this is yours, in the same zone's meters. Null aboard.
 */
export const ashoreSchema = z.object({
  /** How you went ashore: from a berth, or at anchor in the boat. */
  from: z.enum(['berth', 'anchor', 'wreck']),
  /** Your feet and the way you face. */
  at: z.object({ x: z.number(), y: z.number(), z: z.number(), heading: z.number() }),
  /** In the boat (rowing), not on foot. */
  inBoat: z.boolean(),
  /** The berth the ship lies at (`from: 'berth'`). */
  berthId: z.string().optional(),
  /** Where her anchor lies (`from: 'anchor'`), so she's anchored again on a reload. */
  anchor: z.object({ x: z.number(), z: z.number() }).optional(),
});
export type AshoreState = z.infer<typeof ashoreSchema>;

/**
 * The ship's boat (plan 02 §6.5; save v9): stowed aboard, in the water (by the ship or
 * under way), drawn up on a beach, or swamped where a sea filled her.
 */
export const rowboatSchema = z.object({
  state: z.enum(['stowed', 'afloat', 'beached', 'swamped']),
  pose: poseSchema.optional(),
});
export type RowboatSave = z.infer<typeof rowboatSchema>;

/** A danger state the run was snapshotted in (plan 16 §4.2–4.3). */
export const dangerSchema = z.object({
  /** A hunt, or your ship foundering under you (Phase 6 piece F: she's still going down). */
  kind: z.enum(['pursuit', 'foundering']),
  /** Who's after you (`law.morrill`, `law.chartered_tug`), or `sea` while she founders. */
  by: z.string(),
  since: z.number(),
  /** Where on the chart it began, and her heading, to meet the hunter there again. */
  at: chartPointSchema.optional(),
  heading: z.number().optional(),
});
export type DangerState = z.infer<typeof dangerSchema>;

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
    /** Standing with ports and companies (piece F); absent before it, filled on load. */
    standing: standingSchema.optional(),
    /**
     * Company grudges (plan 05 §8.2; Phase 6 piece F), by company id: their ships robbed,
     * fired on or sunk. Optional: absent, nobody bears you one.
     */
    grudges: z.record(z.string(), z.number().nonnegative()).optional(),
    /** Her class, condition and upgrades (piece G); filled on load when absent. */
    ship: shipStateSchema.optional(),
    /** The running lights and the oil in the lamps (Phase 5 piece B); absent until first lit. */
    lantern: lanternStateSchema.optional(),
    /**
     * Charges out of opened kegs of powder and shot (Phase 6 piece A, save v8); the kegs
     * themselves are cargo.
     */
    ammo: ammoStateSchema,
    /** Health, 0–100 (plan 08 §3.3; save v9): hurt on foot, healing over game days. */
    health: z.number().min(0).max(100),
    /** Ashore, or null aboard (Phase 7 piece A; save v9). */
    ashore: ashoreSchema.nullable(),
    /** The ship's boat (save v9). */
    rowboat: rowboatSchema,
  }),
  voyage: voyageSchema.nullable(),
  markets: marketsSchema,
  traffic: trafficStateSchema.optional(),
  contraband: contrabandStateSchema.optional(),
  contracts: contractsStateSchema.optional(),
  hideouts: hideoutsSchema.optional(),
  knowledge: knowledgeSchema,
  /**
   * The Captain's First Week checklist (plan 12 §3, Phase 4 piece C). Only a run made in
   * character creation has one; absent otherwise, so no save version bump.
   */
  firstWeek: firstWeekSchema.optional(),
  /**
   * The law (plan 06 §10; Phase 5 piece A, save v7): Wanted by region, Fame, the ship's
   * profile, reports in progress and jail. A 0.4.0 run migrates Clean everywhere.
   */
  wanted: wantedSchema,
  fame: fameSchema,
  profiles: profilesSchema,
  reports: reportsSchema,
  jail: jailSchema,
  /**
   * The law's ships (Phase 5 piece C): the *Morrill*'s leg and sorties, and the tier-5
   * tug's. Absent in a save from before piece C: she starts lying at Duluth.
   */
  lawShips: lawShipsSchema.optional(),
  /**
   * The run's record for the end screen (plan 12 §10 `stats`; Phase 5 piece D) and the
   * logbook it exports. Optional: absent ones start empty on load, so no version bump.
   */
  stats: statsSchema.optional(),
  logbook: logbookSchema.optional(),
  /**
   * The papers (plan 12 §10 `newspapers`; Phase 5 piece F): stories waiting to be printed
   * and each paper's last editions. Optional: absent, a run starts with no news.
   */
  newspapers: newsSchema.optional(),
  /**
   * Wreck sites (plan 07 §7.3; Phase 6 piece F): ships gone to the bottom, yours among
   * them. Optional: absent, the lake has none yet.
   */
  wrecks: wrecksSchema.optional(),
  /**
   * The danger a snapshot was taken in (plan 16 §4.3; piece D): set only in the `danger`
   * slot's copy, so a reload from it puts the threat back on your tail.
   */
  danger: dangerSchema.optional(),
  environment: z.looseObject({
    clock: clockStateSchema,
    /** Saved so a reload continues the same random sequence (plan 16 §4.4). */
    rng: rngState,
    /** Pressure systems and fog banks (plan 04 §5); added in save v2. */
    weather: weatherStateSchema,
  }),
});

export type WorldState = z.infer<typeof worldStateSchema>;

/** `startSeconds`: the game time the run opens at (character creation: May 7 at dawn). */
export function createWorldState(seed: string, startSeconds = 0): WorldState {
  const clock = createClockState();
  clock.gameSeconds = startSeconds;
  return {
    // A new run starts at the Apostles spawn.
    player: {
      location: { mode: 'zone', zoneId: APOSTLES_ID },
      captain: defaultCaptain(),
      purse: DECKHAND_PURSE_CENTS,
      cargo: DECKHAND_CARGO.map((s) => ({ ...s })),
      stores: {},
      standing: {},
      ship: defaultShipState(),
      ammo: { charges: 0 },
      health: 100,
      ashore: null,
      rowboat: { state: 'stowed' },
    },
    voyage: null,
    markets: createMarkets(gameEconomy(), clock.gameSeconds),
    traffic: { deliveredTo: clock.gameSeconds, ships: {} },
    contraband: freshContrabandState(clock.gameSeconds),
    contracts: createContractsState(),
    hideouts: startingHideouts(defaultCaptain().background, clock.gameSeconds),
    knowledge: { prices: {}, rumors: [] },
    ...createLawState(defaultShipState().classId, defaultCaptain().shipName, clock.gameSeconds),
    stats: freshStats(clock.gameSeconds),
    logbook: [],
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
  parsed.contraband ??= freshContrabandState(parsed.environment.clock.gameSeconds);
  parsed.contracts ??= createContractsState();
  parsed.player.standing ??= {};
  parsed.hideouts = syncHideouts(
    parsed.hideouts,
    parsed.player.captain.background,
    parsed.environment.clock.gameSeconds,
  );
  parsed.player.ship ??= defaultShipState();
  parsed.stats ??= freshStats(parsed.environment.clock.gameSeconds);
  parsed.logbook ??= [];
  return parsed;
}
