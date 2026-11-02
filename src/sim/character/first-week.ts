import { z } from 'zod';

/**
 * The Captain's First Week checklist (plan 12 §3, Phase 4 piece C): optional, skippable,
 * in the journal, with a small tracker on the HUD. It adapts to the starting port, cargo
 * and hideout, and ticks itself off from the game's events, so it teaches by doing.
 * Step 6 (the poorly watched warehouse) waits for Phase 7's docks on foot.
 *
 * Steps 2–4 are ticked by events from pieces F, E and K (`ContractCompleted`,
 * `StorageChanged`, `RumorHeard`). The checklist reads them by name from the bus's tap,
 * so it needs nothing from those pieces but the event.
 */

export const FIRST_WEEK_STEPS = ['sell', 'contract', 'stash', 'rumor', 'voyage'] as const;
export type FirstWeekStep = (typeof FIRST_WEEK_STEPS)[number];

/** The checklist's saved state (save v6, optional: absent for runs made without it). */
export const firstWeekSchema = z.object({
  /** Steps done, in the order they were done. */
  done: z.array(z.enum(FIRST_WEEK_STEPS)),
  /** The captain put the checklist away; the journal keeps it. */
  hidden: z.boolean(),
});

export type FirstWeekState = z.infer<typeof firstWeekSchema>;

export function createFirstWeek(): FirstWeekState {
  return { done: [], hidden: false };
}

/** What the checklist names, from the captain's background (plan 12 §3 "adapts"). */
export interface FirstWeekContext {
  /** The starting port's name. */
  portName: string;
  /** The starting cargo's good and its name. */
  cargoGood: string;
  cargoName: string;
  /** The starting hideout's name. */
  hideoutName: string;
}

export interface FirstWeekLine {
  step: FirstWeekStep;
  number: number;
  text: string;
  /** How it's done, in a line. */
  hint: string;
  done: boolean;
}

export function firstWeekLines(state: FirstWeekState, c: FirstWeekContext): FirstWeekLine[] {
  const text: Record<FirstWeekStep, [string, string]> = {
    sell: [
      `Sell your ${c.cargoName.toLowerCase()} in ${c.portName}`,
      'Dock at a pier and sell on the Market tab.',
    ],
    contract: [
      'Take a freight contract to a nearby port',
      "Take one from a freight agent, sail it there and hand it over at that port's agent.",
    ],
    stash: [
      `Stash goods at ${c.hideoutName}`,
      'Moor at the stash and move cargo from the hold into storage.',
    ],
    rumor: ['Visit a saloon and hear a rumor', 'Buy a drink in a port with a saloon.'],
    voyage: ['Plot a voyage on the chart', 'At a zone edge press M, lay a course and set sail.'],
  };
  return FIRST_WEEK_STEPS.map((step, i) => ({
    step,
    number: i + 1,
    text: text[step][0],
    hint: text[step][1],
    done: state.done.includes(step),
  }));
}

export function firstWeekComplete(state: FirstWeekState): boolean {
  return FIRST_WEEK_STEPS.every((s) => state.done.includes(s));
}

/** The first step not yet done, for the HUD tracker. */
export function nextFirstWeekLine(
  state: FirstWeekState,
  c: FirstWeekContext,
): FirstWeekLine | undefined {
  return firstWeekLines(state, c).find((l) => !l.done);
}

const record = (v: unknown): Record<string, unknown> =>
  typeof v === 'object' && v !== null ? (v as Record<string, unknown>) : {};

/**
 * The step an event completes, if any. Events are matched by name and payload so the
 * checklist doesn't depend on the types of the pieces that raise them.
 */
export function stepForEvent(
  type: string,
  payload: unknown,
  c: Pick<FirstWeekContext, 'cargoGood'>,
): FirstWeekStep | undefined {
  const p = record(payload);
  switch (type) {
    case 'TradeCompleted':
      // The starting cargo, sold anywhere: most sell it at home, and either way it's learned.
      return p['side'] === 'sell' && p['good'] === c.cargoGood ? 'sell' : undefined;
    case 'ContractCompleted':
      return 'contract';
    case 'StorageChanged':
      return p['direction'] === 'in' && typeof p['good'] === 'string' ? 'stash' : undefined;
    case 'RumorHeard':
      return p['source'] === 'saloon' ? 'rumor' : undefined;
    case 'VoyageStarted':
      return 'voyage';
    default:
      return undefined;
  }
}

/** Ticks a step off; returns true when it wasn't done before. */
export function completeStep(state: FirstWeekState, step: FirstWeekStep): boolean {
  if (state.done.includes(step)) return false;
  state.done.push(step);
  return true;
}
