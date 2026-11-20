import { z } from 'zod';
import { idOf } from './common';

/**
 * Ambitions (plan 12 §4.1, plan 09 §16.4 piece H; `ambitions.json`): optional goals the
 * captain can pin, up to three, to follow on the HUD and in the journal. Each one finished
 * leaves a themed mark in the ledger (a bank draft for wealth, a WANTED clipping for
 * infamy...), pays a small reward and gets a line in the papers.
 *
 * Every goal is measured from the run's own state or from a counter the game keeps from
 * the bus, so the catalog is data: a new goal of a kind below needs no code.
 */

export const AMBITION_CATEGORIES = ['wealth', 'infamy', 'trade', 'seamanship', 'builder'] as const;
export type AmbitionCategory = (typeof AMBITION_CATEGORIES)[number];

/**
 * Counters kept from the bus (`src/sim/character/ambitions.ts` `counterForEvent`):
 * escapes from the *Morrill*, contracts delivered on time, record runs, ports made through
 * a gale in November, schooners launched from a slipway (Phase 8 piece G), cargoes won
 * at the card table (Phase 9 piece C), and ships put on a shoal by a false light (Phase 9
 * piece I).
 */
export const AMBITION_COUNTERS = [
  'morrillEscapes',
  'contractsOnTime',
  'recordRuns',
  'novemberGales',
  'slipwayLaunches',
  'pokerCargoes',
  // Ships put on a shoal with a false light or a doused one (Phase 9 piece I).
  'moonCussings',
  // CU of venison sold, fresh or smoked, to fences, smugglers or on the quiet (piece V).
  'venisonSold',
] as const;
export type AmbitionCounter = (typeof AMBITION_COUNTERS)[number];

const goalSchema = z.discriminatedUnion('kind', [
  /** Cash in the strongboxes of all your hideouts together, cents. */
  z.object({ kind: z.literal('hideoutCash'), cents: z.number().int().positive() }),
  /** Your Fame tier (plan 06 §4.1). */
  z.object({ kind: z.literal('fameTier'), tier: z.number().int().positive() }),
  /** Game days at large while Most Wanted in one region (a game day is a calendar week). */
  z.object({ kind: z.literal('mostWantedDays'), days: z.number().positive() }),
  /** Ports with your Standing at least `min`. */
  z.object({
    kind: z.literal('portStanding'),
    min: z.number().min(0).max(100),
    ports: z.number().int().positive(),
  }),
  /** Hideout sites held. */
  z.object({ kind: z.literal('hideouts'), count: z.number().int().positive() }),
  /** Pieces standing at any one hideout (Phase 8's grid). */
  z.object({ kind: z.literal('hideoutPieces'), count: z.number().int().positive() }),
  /** One of the counters reaching `target`. */
  z.object({
    kind: z.literal('counter'),
    counter: z.enum(AMBITION_COUNTERS),
    target: z.number().int().positive(),
  }),
]);
export type AmbitionGoal = z.infer<typeof goalSchema>;

export const ambitionSchema = z.object({
  id: idOf('ambition'),
  category: z.enum(AMBITION_CATEGORIES),
  /** The ledger's name for it. */
  name: z.string().min(1),
  /** What to do, in a line. */
  text: z.string().min(1),
  goal: goalSchema,
  /** The small reward (plan 12 §4.1): cash to the purse, and Fame. */
  reward: z.object({
    cents: z.number().int().nonnegative().default(0),
    fame: z.number().nonnegative().default(0),
  }),
  /** The logbook's line when it's done. */
  logbook: z.string().min(1),
});
export type AmbitionDef = z.infer<typeof ambitionSchema>;

export const ambitionsFileSchema = z
  .object({
    /** How many can be pinned at once. */
    maxPinned: z.number().int().positive(),
    /** Each category's mark in the ledger (plan 12 §4.1 "logbook marks"). */
    marks: z.record(
      z.enum(AMBITION_CATEGORIES),
      z.object({
        /** "A bank draft". */
        name: z.string().min(1),
        /** The words on it. */
        legend: z.string().min(1),
      }),
    ),
    ambitions: z.array(ambitionSchema).min(1),
  })
  .superRefine((f, ctx) => {
    const ids = new Set<string>();
    for (const a of f.ambitions) {
      if (ids.has(a.id)) ctx.addIssue({ code: 'custom', message: `duplicate ambition ${a.id}` });
      ids.add(a.id);
    }
    for (const c of AMBITION_CATEGORIES) {
      if (!f.marks[c]) ctx.addIssue({ code: 'custom', message: `no mark for ${c}` });
    }
  });
export type AmbitionsFile = z.infer<typeof ambitionsFileSchema>;
