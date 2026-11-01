import { z } from 'zod';
import { idOf } from './common';

/**
 * Ship's stores sold at a chandlery (plan 05 §7, Phase 4 piece B): repair stores,
 * lamp oil and provisions. They're kept in the ship's lockers, not the hold, so they
 * take no CU (plan 10 §5) and can't be traded on. Each has a locker limit for the T1.
 */
export const storeItemSchema = z.object({
  id: idOf('store'),
  name: z.string().min(1),
  /** One line on what it's for, shown in the chandlery. */
  blurb: z.string().min(1),
  /** The chandler's price in a large port, integer cents; smaller ports add their spread. */
  priceCents: z.number().int().positive(),
  /** The most the ship's lockers hold. */
  max: z.number().int().positive(),
});

export const storesFileSchema = z.array(storeItemSchema);
export type StoreItem = z.infer<typeof storeItemSchema>;
