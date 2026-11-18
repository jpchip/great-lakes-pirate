import { z } from 'zod';
import { idOf } from './common';

/**
 * Lighthouse stations on foot (plan 11 §10, §18 piece H; plan 06 §6.2): the seven Apostles
 * stations you can land at and walk, their keepers by name, how far each can be bought,
 * the kerosene in the oil house and what's in the house. The station's buildings come
 * from the tower style in `lighthouses.json` (the kit); where it stands, from the light.
 */

export const lightStationRulesSchema = z.object({
  /** Game minutes a free keeper takes to notice a dark lamp and light it again. */
  relightMin: z.number().positive(),
  /** Game days the oil house and the house take to be stocked again. */
  restockDays: z.number().positive(),
  /** Game days until the Lighthouse Service sends a new man for a dead keeper. */
  replaceDays: z.number().positive(),
  /** The highest regional Wanted tier keepers still welcome a visitor at by day. */
  welcomeMaxTier: z.number().int().min(0).max(5),
  /** The station's grounds, meters round the tower: at night anyone on them is suspect. */
  groundsM: z.number().positive(),
  /** Seconds F is held for each thing done at the station. */
  climbS: z.number().positive(),
  douseS: z.number().positive(),
  lightS: z.number().positive(),
  oilS: z.number().positive(),
  houseS: z.number().positive(),
  readS: z.number().positive(),
  takeS: z.number().positive(),
});

export const lightStationSchema = z.object({
  light: idOf('light'),
  /** The island it stands on (the rest of it walks with plan 11 pieces Q and R). */
  island: idOf('island'),
  /** The keepers, head keeper first; as many as the light's `keepers`. */
  keepers: z.array(z.string().min(1)).min(1),
  /** The chance a keeper here takes a bribe (plan 06 §6.2: "a weak loyalty trait"). */
  loyalty: z.number().min(0).max(1),
  /** Cans of kerosene in the oil house when stocked. */
  kerosene: z.number().int().nonnegative(),
  /** The keepers' savings and valuables in the house, cents: rolled between the two. */
  houseCashCents: z.tuple([z.number().int().nonnegative(), z.number().int().nonnegative()]),
});

export const lightStationsFileSchema = z.object({
  rules: lightStationRulesSchema,
  stations: z.array(lightStationSchema),
});

export type LightStationRules = z.infer<typeof lightStationRulesSchema>;
export type LightStationDef = z.infer<typeof lightStationSchema>;
export type LightStationsFile = z.infer<typeof lightStationsFileSchema>;
