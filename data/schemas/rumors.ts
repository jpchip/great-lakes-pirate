import { z } from 'zod';
import { idOf } from './common';

/**
 * Rumor templates and the saloon's terms (plan 05 §9, §11 `rumors.json`; Phase 4 piece
 * K). Each rumor kind has a weight in the saloon's draw, a base reliability (the chance
 * the talk is true) and lines with `{placeholders}` the sim fills: `{ship}`, `{good}`,
 * `{port}`, `{to}`, `{when}`, `{price}`, `{wind}`, `{weather}`, `{where}`.
 */

export const RUMOR_KINDS = ['shipment', 'price', 'weather', 'smuggler', 'legend'] as const;
export type RumorKind = (typeof RUMOR_KINDS)[number];

const kindSchema = z.object({
  /** Relative odds of this kind in the saloon's draw, when it has something to tell. */
  weight: z.number().nonnegative(),
  /** The chance a rumor of this kind is true, before the teller and perks. */
  reliability: z.number().min(0).max(1),
  /** The ledger's label for the kind. */
  label: z.string().min(1),
  templates: z.array(z.string().min(1)).min(1),
});

const tellerBandSchema = z.object({
  /** Tellers in this band carry at least this reliability. */
  minReliability: z.number().min(0).max(1),
  /** What the ledger calls the reliability ("Reliable", "Doubtful"). */
  word: z.string().min(1),
  names: z.array(z.string().min(1)).min(1),
});

const legendSchema = z.object({
  id: idOf('legend'),
  name: z.string().min(1),
  /** Where it's set, for plan 11's journal (Phase 9). */
  island: idOf('island').optional(),
  /** The saloons that tell it. */
  ports: z.array(idOf('port')).min(1),
  lines: z.array(z.string().min(1)).min(1),
});

const decoySchema = z.object({
  id: idOf('anchorage'),
  where: z.string().min(1),
});

export const rumorsFileSchema = z.object({
  /** A round at the bar by market size, integer cents (plan 05 §9: $0.25–$2). */
  roundCents: z.object({
    huge: z.number().int().positive(),
    large: z.number().int().positive(),
    medium: z.number().int().positive(),
    small: z.number().int().positive(),
    tiny: z.number().int().positive(),
  }),
  /** Rounds that buy talk in one saloon in one game day; then the bar is talked out. */
  roundsPerDay: z.number().int().positive(),
  /** The ledger keeps this many rumors, newest first. */
  keep: z.number().int().positive(),
  /** Plan 12 §2.2: the Saloon Keeper's perk. */
  saloonKeeper: z.object({
    reliabilityBonus: z.number().min(0).max(1),
    freeRounds: z.number().int().nonnegative(),
  }),
  /** Hailed ships talk about what they've seen themselves. */
  hailReliability: z.number().min(0).max(1),
  /** Weather talk looks this many game hours ahead. */
  weatherLeadHours: z.number().positive(),
  /** Shipment talk covers sailings within this many game days. */
  shipmentHorizonDays: z.number().positive(),
  /** The smuggler's talked of only in these wanted regions' saloons. */
  smugglerRegions: z.array(idOf('region')),
  /** Where a false smuggler rumor sends you. */
  smugglerDecoys: z.array(decoySchema).min(1),
  kinds: z.object({
    shipment: kindSchema,
    price: kindSchema,
    weather: kindSchema,
    smuggler: kindSchema,
    legend: kindSchema,
  }),
  /** Highest band first. */
  tellers: z.array(tellerBandSchema).min(1),
  legends: z.array(legendSchema),
});

export type RumorsFile = z.infer<typeof rumorsFileSchema>;
