import { z } from 'zod';
import { idOf } from './common';

export const SEASONS = ['spring', 'summer', 'fall', 'winter'] as const;
export const seasonSchema = z.enum(SEASONS);
export type Season = z.infer<typeof seasonSchema>;

/**
 * Trade goods (plan 05 §3). Cargo is counted in cargo units (CU): an abstract slot of
 * hold space, roughly a ton of bulk or a few crates. A ship's `cargoCapacity` is in CU.
 */
export const goodSchema = z.object({
  id: idOf('good'),
  name: z.string().min(1),
  /** The §3 table's grouping; the trade screen sorts by it. */
  category: z.enum(['bulk', 'provisions', 'manufactured', 'high_value', 'contraband']),
  /**
   * Base price per CU, integer cents (plan 01 §8, plan 05 §2). Each port scales it by its
   * profile (cheap where it's made, dear where it's wanted) before stock moves it.
   */
  basePriceCents: z.number().int().positive(),
  /**
   * What a smuggler asks for contraband, cents per CU (plan 05 §3: untaxed whiskey "30
   * buy / 70 sell"). Absent for goods nobody sells you (poached venison).
   */
  smugglerPriceCents: z.number().int().positive().optional(),
  /**
   * How heavy a CU of it is, 0–1: a full hold of iron ore (1) sits the ship at
   * `draftFullM` and costs the whole cargo speed loss; a full hold of furs much less.
   */
  weightFactor: z.number().gt(0).max(1),
  /**
   * Who may sell it: anyone (`legal`), only below a Wanted tier (`restricted`: black
   * powder, plan 06), or only to a fence or a saloon on the quiet (`contraband`).
   */
  legal: z.enum(['legal', 'restricted', 'contraband']),
  /** The seasons it's produced or brought in; out of season its source ports run low. */
  seasons: z.array(seasonSchema).min(1),
  /**
   * Seasonal demand on the price everywhere (plan 05 §4.1 `seasonalModifier`), e.g. coal
   * dearer in winter. Missing seasons are 1.
   */
  seasonPrice: z.partialRecord(seasonSchema, z.number().positive()).optional(),
  /**
   * How recognizable stolen lots are, 0–1 (plan 05 §6.1): loose grain 0.1, company-marked
   * crates and stamped ingots near 1. Scales the detection chance of selling it hot.
   */
  traceability: z.number().min(0).max(1),
  /** Game days before it spoils (fresh fish, §3). Cut for Phase 4 (§14), kept as data. */
  spoilDays: z.number().positive().optional(),
});

export const goodsFileSchema = z.array(goodSchema);
export type Good = z.infer<typeof goodSchema>;
