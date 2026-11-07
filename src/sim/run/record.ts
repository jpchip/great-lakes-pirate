import { z } from 'zod';

/**
 * The run's record (plan 12 §9–10 `stats`; Phase 5 piece D): the counters the end screen's
 * run summary reads, and the logbook, a few lines a day of what happened, which the end
 * screen offers as a download. Both are optional in the save and start empty when absent,
 * so a 0.4.0 run or an early v7 one needs no migration.
 */

export const statsSchema = z.object({
  /** When the run began, game seconds (absent in a migrated run: its first save's time). */
  startedAt: z.number(),
  /** Earned from sales, contracts and smuggling, cents. */
  earnedCents: z.number().int().nonnegative(),
  peakFame: z.number().nonnegative(),
  /** Crimes committed, seen or not. */
  crimes: z.number().int().nonnegative(),
  contracts: z.number().int().nonnegative(),
  captures: z.number().int().nonnegative(),
  /** Every region's highest tier reached. */
  peakTier: z.number().int().nonnegative(),
});
export type RunStats = z.infer<typeof statsSchema>;

export const logEntrySchema = z.object({ at: z.number(), text: z.string() });
export type LogEntry = z.infer<typeof logEntrySchema>;

/** The logbook keeps this many lines; the oldest go first (a long run's save stays small). */
export const LOGBOOK_MAX = 400;

export const logbookSchema = z.array(logEntrySchema);

export function freshStats(now: number): RunStats {
  return {
    startedAt: now,
    earnedCents: 0,
    peakFame: 0,
    crimes: 0,
    contracts: 0,
    captures: 0,
    peakTier: 0,
  };
}

export interface RecordHolder {
  stats?: RunStats | undefined;
  logbook?: LogEntry[] | undefined;
}

export function statsOf(state: RecordHolder, now: number): RunStats {
  state.stats ??= freshStats(now);
  return state.stats;
}

/** Writes a line in the logbook; the same line twice running is written once. */
export function log(state: RecordHolder, at: number, text: string): void {
  const book = (state.logbook ??= []);
  if (book[book.length - 1]?.text === text) return;
  book.push({ at, text });
  if (book.length > LOGBOOK_MAX) book.splice(0, book.length - LOGBOOK_MAX);
}
