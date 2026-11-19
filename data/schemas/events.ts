import { z } from 'zod';
import { idOf } from './common';

/**
 * The sandbox's events (plan 12 §5, plan 11 §18.4 piece A; `events.json`). Each event has
 * triggers over the world state, a weight in the draw, a cooldown, prerequisites, the
 * channels it reaches you by and its outcomes as changes to the sim: a price, a payroll in
 * a ship's strongbox, the cutter's sorties, heat, Standing. None of them is a mini-game.
 *
 * Channels: `rumor` (talk in the saloons of its region), `paper` (an item in the papers
 * that cover its region), `letter` (waiting at the harbor master's in any port), `chart`
 * (met on a voyage) and `scene` (a short scene on docking at its port). A letter, a chart
 * meeting and a scene can carry choices, each with its own outcomes.
 *
 * Text fills `{placeholders}`: `{port}`, `{region}`, `{ship}`, `{good}`, `{cash}`,
 * `{when}`, `{captain}`, `{hideout}`, `{cost}`.
 */

export const EVENT_CHANNELS = ['rumor', 'paper', 'letter', 'chart', 'scene'] as const;
export type EventChannel = (typeof EVENT_CHANNELS)[number];

export const EVENT_TYPES = ['opportunity', 'threat', 'market', 'feud', 'rival', 'flavor'] as const;

const range = z.object({ min: z.number().optional(), max: z.number().optional() });
const centsRange = z.tuple([z.number().int(), z.number().int()]);

/** What an event (or a choice) does to the sim. */
export const outcomeSchema = z.discriminatedUnion('kind', [
  /** A market shock (plan 05 §4.1): the stock of a good at the event's port times `factor`. */
  z.object({
    kind: z.literal('price'),
    good: idOf('good'),
    factor: z.number().positive(),
    /** Other ports it hits too; the event's own port always. */
    ports: z.array(idOf('port')).optional(),
  }),
  /** A payroll in the strongbox of a ship sailing loaded from the event's port soon. */
  z.object({
    kind: z.literal('payroll'),
    cents: centsRange,
    /** How far ahead her sailing may be, game days. */
    withinDays: z.number().positive(),
  }),
  /** The *Morrill*'s sorties lean to the event's region while it lasts. */
  z.object({ kind: z.literal('cutter') }),
  /** The docks district's warehouses and holds at the event's port are full again. */
  z.object({ kind: z.literal('restock') }),
  /** The moored crews at the event's port drink easy while it lasts: half the bottles. */
  z.object({ kind: z.literal('crewsIdle') }),
  /** Your hideout nearest the event's region is talked of, as if seen (plan 09 §8). */
  z.object({ kind: z.literal('spotted'), by: z.string().min(1) }),
  /** Heat in the event's region. */
  z.object({ kind: z.literal('heat'), amount: z.number().positive() }),
  /** Standing at the event's port. */
  z.object({ kind: z.literal('standing'), amount: z.number() }),
  /** Fame. */
  z.object({ kind: z.literal('fame'), amount: z.number().positive() }),
  /** Cash to the purse, drawn in the range (negative takes it). */
  z.object({ kind: z.literal('cash'), cents: centsRange }),
  /** A flag other events read. */
  z.object({ kind: z.literal('flag'), flag: z.string().min(1) }),
  /** A line in the logbook. */
  z.object({ kind: z.literal('log'), text: z.string().min(1) }),
]);
export type EventOutcome = z.infer<typeof outcomeSchema>;

const choiceSchema = z.object({
  id: z.string().regex(/^[a-z0-9_]+$/),
  label: z.string().min(1),
  /** What came of it, shown after. */
  result: z.string().min(1),
  /** Cash it takes; refused without it. */
  costCents: z.number().int().nonnegative().optional(),
  outcomes: z.array(outcomeSchema).default([]),
});
export type EventChoiceDef = z.infer<typeof choiceSchema>;

const articleSchema = z.object({
  headline: z.string().min(1),
  deck: z.string().min(1),
  body: z.string().min(1),
});

export const eventDefSchema = z.object({
  id: idOf('event'),
  name: z.string().min(1),
  type: z.enum(EVENT_TYPES),
  /** Relative odds in the draw among the events whose triggers hold. */
  weight: z.number().positive(),
  /** Game days before it can fire again. */
  cooldownDays: z.number().nonnegative(),
  /** How long it stands, game hours (the price, the payroll, the talk). */
  hours: z.number().positive(),
  /** At most this many times a run; unlimited when absent. */
  maxPerRun: z.number().int().positive().optional(),
  channels: z.array(z.enum(EVENT_CHANNELS)).min(1),
  triggers: z
    .object({
      /** Calendar months it can fire in, 0 = January. */
      months: z.array(z.number().int().min(0).max(11)).optional(),
      /** Your Fame tier. */
      fame: range.optional(),
      /** The highest Wanted tier you have anywhere. */
      wanted: range.optional(),
      /** Your Standing at its port. */
      standing: range.optional(),
      /** A gale blows at its port (the storm signal is up). */
      gale: z.boolean().optional(),
      flags: z
        .object({ all: z.array(z.string()).optional(), none: z.array(z.string()).optional() })
        .optional(),
      /** You hold a hideout. */
      hideout: z.boolean().optional(),
      /** Game hours of the day it fires in, [from, to) (wraps past midnight). */
      hours: z.tuple([z.number().min(0).max(24), z.number().min(0).max(24)]).optional(),
    })
    .default({}),
  /** Events that must have fired before. */
  after: z.array(idOf('event')).optional(),
  /** Ports it can happen at; one is chosen. Absent: the region you're in (or at sea). */
  ports: z.array(idOf('port')).optional(),
  /** What happens as it fires. */
  outcomes: z.array(outcomeSchema).default([]),
  /** Lines the saloons of its region tell while it stands. */
  rumor: z.array(z.string().min(1)).optional(),
  /** The papers' item. */
  paper: articleSchema.optional(),
  letter: z
    .object({ from: z.string().min(1), subject: z.string().min(1), body: z.string().min(1) })
    .optional(),
  /** A chart meeting or a scene on docking. */
  scene: z.object({ title: z.string().min(1), body: z.string().min(1) }).optional(),
  choices: z.array(choiceSchema).optional(),
  /** The choice taken if a letter goes unanswered until the event ends. */
  defaultChoice: z.string().optional(),
  /**
   * False for a beat another system fires (a feud's, Phase 9 piece D): never drawn on the
   * tick, only fired by its system. Absent, it's drawn.
   */
  draw: z.boolean().optional(),
  /** The papers' item is about you: printed as news that names you. */
  paperNames: z.boolean().optional(),
});
export type EventDef = z.infer<typeof eventDefSchema>;

export const eventsFileSchema = z
  .object({
    rules: z.object({
      /** Game hours between draws. */
      checkHours: z.number().positive(),
      /** The chance a draw fires anything. */
      chance: z.number().min(0).max(1),
      /** At most this many events stand at once. */
      maxActive: z.number().int().positive(),
      /** A run's first events wait this many game days (the First Week). */
      graceDays: z.number().nonnegative(),
      /** Unread letters kept; the oldest go. */
      keepLetters: z.number().int().positive(),
      /** A scene on docking: the chance an eligible one plays. */
      sceneChance: z.number().min(0).max(1),
    }),
    events: z.array(eventDefSchema).min(1),
  })
  .superRefine((file, ctx) => {
    const ids = new Set(file.events.map((e) => e.id));
    for (const e of file.events) {
      for (const a of e.after ?? []) {
        if (!ids.has(a)) ctx.addIssue({ code: 'custom', message: `${e.id}: unknown after ${a}` });
      }
      const text: Record<string, unknown> = {
        rumor: e.rumor,
        paper: e.paper,
        letter: e.letter,
        chart: e.scene,
        scene: e.scene,
      };
      for (const c of e.channels) {
        if (!text[c]) ctx.addIssue({ code: 'custom', message: `${e.id}: no text for ${c}` });
      }
      if (e.choices && !e.channels.some((c) => c === 'letter' || c === 'chart' || c === 'scene')) {
        ctx.addIssue({ code: 'custom', message: `${e.id}: choices need a letter, chart or scene` });
      }
      if (e.defaultChoice && !e.choices?.some((c) => c.id === e.defaultChoice)) {
        ctx.addIssue({ code: 'custom', message: `${e.id}: unknown defaultChoice` });
      }
      if (e.channels.includes('chart') && e.channels.includes('scene')) {
        ctx.addIssue({ code: 'custom', message: `${e.id}: a chart meeting or a scene, not both` });
      }
    }
  });
export type EventsFile = z.infer<typeof eventsFileSchema>;
