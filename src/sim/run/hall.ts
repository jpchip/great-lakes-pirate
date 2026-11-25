import { z } from 'zod';

/**
 * The Hall of Captains (plan 12 §9, plan 16 §2; Phase 9 piece B): a record of each run that
 * ended, kept in its own local store (`hall` in IndexedDB) outside the run save, so it
 * outlives permadeath and every new captain. Records only: nothing carries over.
 */

export const hallRecordSchema = z.object({
  captain: z.string(),
  shipName: z.string(),
  portrait: z.string().optional(),
  cause: z.string(),
  epitaph: z.string(),
  headline: z.string(),
  summary: z.array(z.object({ label: z.string(), value: z.string() })).default([]),
  endedAtIso: z.string(),
  runId: z.string().optional(),
  /** The papers' name for the captain (absent before piece B, or never coined). */
  nickname: z.string().optional(),
  /** The run was brought in from an export file (plan 16 §9). */
  transferred: z.boolean().optional(),
});
export type HallRecord = z.infer<typeof hallRecordSchema>;

/** The store's records, readable ones only, the latest ended first. */
export function hallRecords(raw: readonly unknown[]): HallRecord[] {
  const out: HallRecord[] = [];
  for (const r of raw) {
    const parsed = hallRecordSchema.safeParse(r);
    if (parsed.success) out.push(parsed.data);
  }
  return out.sort((a, b) => b.endedAtIso.localeCompare(a.endedAtIso));
}
