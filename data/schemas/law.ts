import { z } from 'zod';
import { idOf } from './common';
import { geoSchema } from './zones';

/**
 * The law's data (plan 06 §10; Phase 5 piece A): crimes, the Wanted tiers, the Fame tiers,
 * the seven Wanted regions, and the law's actors and witnesses. Hours are game hours (the
 * clock's, so one game day is 24 of them and stands for a calendar week).
 */

/** Who can see a crime and carry a report (plan 06 §2.4, §5.5; piece B's observers). */
export const WITNESS_KINDS = [
  'keeper',
  'crew',
  'cutter',
  'townsfolk',
  'merchant',
  'freightAgent',
] as const;

/** How well a witness saw it (plan 06 §2.3). */
export const IDENTIFICATIONS = ['unknown', 'schooner', 'ship', 'person'] as const;

/** A crime and its heat (plan 06 §2.2). */
export const crimeSchema = z.object({
  id: idOf('crime'),
  name: z.string().min(1),
  /** Base heat, before the identification factor. */
  heat: z.number().int().positive(),
  /** The phase that makes it possible to commit (5 is the smuggling life, §14.6). */
  phase: z.number().int().min(5),
  /** Always traced to you, whatever was seen (contract theft): identified as `person`. */
  traced: z.boolean().default(false),
  /** Makes news, which spreads part of its heat to the neighboring regions (§3.4). */
  news: z.boolean().default(false),
  /** Standing lost in the port it's reported in, when it's identified to you (§4.3). */
  standing: z.number().int().nonnegative().default(0),
  /** Fame gained when it's identified to you (§4.1). Piece F's headlines add more. */
  fame: z.number().int().nonnegative().default(0),
  notes: z.string().optional(),
});

export const crimesFileSchema = z.array(crimeSchema);
export type CrimeDef = z.infer<typeof crimeSchema>;

const tierSchema = z.object({
  tier: z.number().int().nonnegative(),
  name: z.string().min(1),
  /** The lowest heat in the tier. */
  minHeat: z.number().nonnegative(),
  /** Heat lost per game hour while you're away from the region (§3.3). */
  decayPerHour: z.number().nonnegative(),
  /** Decay alone never takes heat below this (tier 4+ won't drop below tier 3). */
  decayFloor: z.number().nonnegative().default(0),
});

/** The six Wanted tiers and the rules heat moves by (plan 06 §2.3, §3.2–3.4). */
export const wantedTiersFileSchema = z
  .object({
    tiers: z.array(tierSchema).min(2),
    /** Heat × factor by identification; `unknown` only raises the region's alertness. */
    identification: z.record(z.enum(IDENTIFICATIONS), z.number().min(0).max(1)),
    decay: z.object({
      /** No decay for this long after a crime in the region. */
      graceHours: z.number().nonnegative(),
      /** The share of the away rate that runs while you're in the region. */
      presentFactor: z.number().min(0).max(1),
      /** Alertness (unidentified crimes) lost per game hour. */
      alertPerHour: z.number().nonnegative(),
    }),
    spread: z.object({
      /** The share of a newsworthy crime's heat that reaches each neighbor. */
      fraction: z.number().min(0).max(1),
      /** Added to the fraction for each Fame tier (§3.4: higher at higher Fame). */
      perFameTier: z.number().min(0).max(1),
      /** How long the news takes to reach the neighbors after the report is filed. */
      delayHours: z.number().nonnegative(),
    }),
  })
  .refine(
    (f) =>
      f.tiers.every(
        (t, i) =>
          t.tier === i &&
          (i === 0 ? t.minHeat === 0 : t.minHeat > (f.tiers[i - 1]?.minHeat ?? Infinity)),
      ),
    'Tiers must run 0, 1, 2… with rising minHeat from 0',
  );
export type WantedTiersFile = z.infer<typeof wantedTiersFileSchema>;

/** The Fame meter (plan 06 §4.1). */
export const fameTiersFileSchema = z
  .object({
    tiers: z.array(
      z.object({
        tier: z.number().int().nonnegative(),
        name: z.string().min(1),
        min: z.number().nonnegative(),
      }),
    ),
    decay: z.object({
      /** Game days with nothing notable before Fame starts to fade. */
      graceDays: z.number().nonnegative(),
      /** The share lost per game day after that. */
      perDay: z.number().min(0).max(1),
      /** The share lost per game day at the top tier (legends fade more slowly). */
      legendPerDay: z.number().min(0).max(1),
    }),
  })
  .refine(
    (f) =>
      f.tiers.every(
        (t, i) =>
          t.tier === i && (i === 0 ? t.min === 0 : t.min > (f.tiers[i - 1]?.min ?? Infinity)),
      ),
    'Tiers must run 0, 1, 2… with rising min from 0',
  );
export type FameTiersFile = z.infer<typeof fameTiersFileSchema>;

/**
 * A Wanted region (plan 06 §3.1). A point in the lake belongs to the first region whose
 * area holds it, in file order; a point in none belongs to the region whose anchor is
 * nearest. The areas are lon/lat rings; land inside them doesn't matter.
 */
export const regionSchema = z.object({
  id: idOf('region'),
  name: z.string().min(1),
  /** Where the region's reports land: its harbor master and police (none built yet for South Shore West). */
  seat: idOf('port').optional(),
  /** The region's middle, for open water outside every area. */
  anchor: geoSchema,
  areas: z.array(z.array(geoSchema).min(3)).default([]),
  /** Regions its news reaches (§3.4). */
  neighbors: z.array(idOf('region')),
});

export const regionsFileSchema = z.array(regionSchema);
export type RegionDef = z.infer<typeof regionSchema>;

/** How long a witness takes to report (plan 06 §2.4), in game hours. */
const delaySchema = z.object({
  minH: z.number().nonnegative(),
  maxH: z.number().nonnegative(),
  /** Waits for the next dawn first (a keeper who rows to town; plan 06 §2.4). */
  atDawn: z.boolean().default(false),
});

/** The law's actors (plan 06 §5) and its witnesses' report delays (§2.4). */
export const lawActorsFileSchema = z.object({
  witnesses: z.record(
    z.enum(WITNESS_KINDS),
    z.object({
      delay: delaySchema,
      /** A keeper's delay by `lighthouses.json` `reporting`. */
      byReporting: z.record(z.enum(['fast', 'medium', 'slow']), delaySchema).optional(),
    }),
  ),
  /** The hour dawn reports leave at. */
  dawnHour: z.number().min(0).max(24),
  cutter: z.object({
    id: idOf('law'),
    name: z.string().min(1),
    classId: idOf('ship'),
    /** Where she coals (§5.1). */
    coalingPort: idOf('port'),
    /** She never inspects you below this tier in a region (decided 2026-10-21). */
    inspectsFromTier: z.number().int().min(1),
    /** A region at this tier or above draws her strongly (§5.1). */
    drawnFromTier: z.number().int().min(1),
  }),
  tug: z.object({
    id: idOf('law'),
    name: z.string().min(1),
    classId: idOf('ship'),
    /** The tier that charters her (§5.1: tier 5). */
    fromTier: z.number().int().min(1),
    /** How long she hunts, game days. */
    days: z.number().positive(),
  }),
});
export type LawActorsFile = z.infer<typeof lawActorsFileSchema>;
