import { z } from 'zod';
import { idOf } from './common';

/**
 * Locks, loot and the district's heist targets (plan 08 §6.1, §7, §8, §15; Phase 7 piece E,
 * part two). `locks.json` says how long each tier of lock takes to pick and how it gives you
 * away; `loot_tables.json` what a warehouse's crates, a strongbox or a desk hold; the
 * targets in `districts.json` which buildings are locked when, whose marks are on the goods,
 * and where the containers stand. Times are real seconds unless they say game hours or days.
 */

export const lockTierSchema = z.object({
  /** Seconds of holding F to open it with a pick (plan 08 §6.1: 2, 4, 7). */
  pickS: z.number().positive(),
  /** Chance a second that the pick clicks loud enough to hear. */
  clickPerS: z.number().min(0).max(1),
  /** How far a click carries, meters. */
  clickM: z.number().positive(),
  /** Chance a second that a pick snaps (one lockpick spent; the progress stays). */
  breakPerS: z.number().min(0).max(1),
  /** Seconds the crowbar takes to force it. */
  forceS: z.number().positive(),
  /** How far forcing it is heard, meters. */
  forceM: z.number().positive(),
});
export type LockTier = z.infer<typeof lockTierSchema>;

export const locksFileSchema = z.object({
  tiers: z.record(z.enum(['1', '2', '3']), lockTierSchema),
  /** The store a pick is spent from. */
  picks: idOf('store'),
  /** The Poacher's boot pick (`perk.boot_lockpick`): never runs out, and works this much faster. */
  bootPick: z.object({ perk: z.string(), speed: z.number().positive() }),
});
export type LocksFile = z.infer<typeof locksFileSchema>;

/** A range of crates: `[least, most]` CU of a good. */
const crateRollSchema = z.object({
  good: idOf('good'),
  min: z.number().int().min(0),
  max: z.number().int().min(0),
});

export const lootTableSchema = z.object({
  id: idOf('loot'),
  /** What it is on the prompt: "crates of salted fish", "the strongbox". */
  name: z.string().min(1),
  crates: z.array(crateRollSchema).default([]),
  /** Cash in it, cents: `[least, most]`. */
  cashCents: z.tuple([z.number().int().min(0), z.number().int().min(0)]).default([0, 0]),
  /** Chance it holds papers worth reading (a shipping schedule: a rumor of a sailing). */
  documents: z.number().min(0).max(1).default(0),
});
export type LootTable = z.infer<typeof lootTableSchema>;

export const lootTablesFileSchema = z
  .object({
    tables: z.array(lootTableSchema).min(1),
    /** Game days before an emptied container is stocked again. */
    restockDays: z.number().positive(),
    /** Fuller in the fall, stockpiled for winter (plan 08 §8): crates times this, by season. */
    season: z.record(z.enum(['spring', 'summer', 'fall', 'winter']), z.number().positive()),
    carry: z.object({
      /** Seconds to lift a crate, or to rifle a box for its cash and papers. */
      liftS: z.number().nonnegative(),
      takeS: z.number().nonnegative(),
      /** Walking and running with a crate in your arms, as a share of the usual speed. */
      walk: z.number().positive().max(1),
      run: z.number().positive().max(1),
      /** The Lumberjack's strong back (`perk.strong_back`): this much faster laden. */
      strongBack: z.object({ perk: z.string(), speed: z.number().positive() }),
    }),
  })
  .superRefine((f, ctx) => {
    for (const t of f.tables) {
      for (const c of t.crates) {
        if (c.max < c.min) ctx.addIssue({ code: 'custom', message: `${t.id}: max < min` });
      }
    }
  });
export type LootTablesFile = z.infer<typeof lootTablesFileSchema>;

/** One container in a target: a loot mark in the layout and what's in it. */
export const heistContainerSchema = z.object({
  /** The layout's loot mark it stands at. */
  mark: z.string(),
  table: idOf('loot'),
  /** Its own lock (a strongbox), on top of the door's. */
  lock: z.number().int().min(1).max(3).optional(),
});

/** A building worth breaking into (plan 08 §8): its lock, its owner, its containers. */
export const heistTargetSchema = z.object({
  /** The layout's building id. */
  building: z.string(),
  /** The company whose marks are on the goods (hot `owner`, their grudge). */
  owner: idOf('company').optional(),
  /** Its doors' lock and the hours they're locked (`[from, to]`; past midnight wraps). */
  lock: z.object({
    tier: z.number().int().min(1).max(3),
    hours: z.tuple([z.number().min(0).max(24), z.number().min(0).max(24)]),
  }),
  containers: z.array(heistContainerSchema).min(1),
});
export type HeistTarget = z.infer<typeof heistTargetSchema>;
