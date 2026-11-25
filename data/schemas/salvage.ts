import { z } from 'zod';
import { idOf } from './common';

/**
 * Salvage (plan 11 §6, §18.4 piece U; `salvage.json`): the old wrecks on the bottom of the
 * Apostles (the real ones the record has, and a few invented ones placed fresh each run),
 * how they're found, how the grapple and hook work them at anchor, and what the lake leaves
 * of a cargo after so many years under it. The wrecks of the run itself (by your hand, the
 * lake's or your own lost ship) are `state.wrecks`; this file only rules how they're worked.
 */

const geo = z.object({ lat: z.number(), lon: z.number() });
const range = z.tuple([z.number().int().min(0), z.number().int().min(0)]);

const cargoLineSchema = z.object({ good: idOf('good'), qty: z.number().int().positive() });

/** What a wreck's papers say, when they come up (plan 11 §7.2: "wreck papers"). */
const papersSchema = z.object({
  /** "Her log in its oilskin". */
  name: z.string().min(1),
  /** The clue, as the journal keeps it. */
  text: z.string().min(1),
  /**
   * The lead it bears on: a legend's (`legend.lucerne`), or another wreck's id (the papers
   * name a ship she lost company with). Absent: a note for the journal only.
   */
  lead: z.string().optional(),
});

export const historicalWreckSchema = z.object({
  id: idOf('wreck'),
  name: z.string().min(1),
  /** "three-masted schooner". */
  classText: z.string().min(1),
  /** When she was lost, "1886-11-16". */
  lost: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  at: geo,
  /** "off Long Island". */
  where: z.string().min(1),
  /** She lies too deep for the grapple whatever the chart says (a diving suit's, later). */
  deep: z.boolean().optional(),
  /** The keepers know where she lies: a light station's log charts her (piece O). */
  logged: z.boolean().optional(),
  cargo: z.array(cargoLineSchema),
  papers: papersSchema.optional(),
  curio: idOf('curio').optional(),
  /** The journal's line. */
  lore: z.string().min(1),
  /** How sure the record is (R1's ✅ / ❓). */
  confidence: z.enum(['confirmed', 'verify']),
});
export type HistoricalWreck = z.infer<typeof historicalWreckSchema>;

export const seededWrecksSchema = z.object({
  /** How many of the spots get a wreck each run. */
  count: z.number().int().nonnegative(),
  /** Shallow places off the islands an old wreck might lie (each a sentence's "where"). */
  spots: z.array(z.object({ at: geo, where: z.string().min(1) })).min(1),
  names: z.array(z.string().min(1)).min(1),
  classes: z.array(z.string().min(1)).min(1),
  /** The years she might have been lost in. */
  years: range,
  /** The cargoes she might have carried: each a list of goods and how many CU. */
  cargoes: z.array(z.array(z.object({ good: idOf('good'), qty: range })).min(1)).min(1),
  /** Her papers' wording, with {name}, {other}, {where} filled in. */
  papers: z.object({
    name: z.string().min(1),
    /** Naming another of this run's old wrecks, so it opens a lead to her. */
    other: z.string().min(1),
    /** With nothing to point at. */
    alone: z.string().min(1),
  }),
  /**
   * Deep wrecks for the diving suit (Phase 10): `count` of these spots, too deep for the
   * grapple, with richer cargoes; the last shallow wreck's papers lead to the first of them.
   */
  deep: z
    .object({
      count: z.number().int().nonnegative(),
      spots: z.array(z.object({ at: geo, where: z.string().min(1) })).min(1),
      classes: z.array(z.string().min(1)).min(1),
      cargoes: z.array(z.array(z.object({ good: idOf('good'), qty: range })).min(1)).min(1),
      curios: z.array(idOf('curio')),
    })
    .optional(),
  /** One of the seeded wrecks carries each of these curios. */
  curios: z.array(idOf('curio')),
  /** "The {classText} {name}, lost {where} in {year} with ..." */
  lore: z.string().min(1),
});

export const salvageRulesSchema = z.object({
  /** The grapple works a wreck from an anchored ship within this many zone meters of her. */
  reachM: z.number().positive(),
  /** No deeper than this, meters (plan 11 §6.2: shallow wrecks, ~10 m). */
  maxDepthM: z.number().positive(),
  /** Too much sea to work a grapple over this significant wave height, meters. */
  maxHsM: z.number().positive(),
  /** Game minutes one cast and drag of the grapple takes. */
  attemptMinutes: z.number().positive(),
  /** Real seconds the line is down before the cast comes up (the hold on the HUD). */
  workRealS: z.number().nonnegative(),
  /** The chance a cast hooks something, in calm, shallow water by day on a fresh wreck. */
  chance: z.number().min(0).max(1),
  /** At the grapple's deepest the chance is this share of it (straight in between). */
  deepFactor: z.number().min(0).max(1),
  /** At `maxHsM` the chance is this share of it. */
  seaFactor: z.number().min(0).max(1),
  /** By lantern light after dark. */
  nightFactor: z.number().min(0).max(1),
  /** A wreck this many years down is broken up and silted: `oldFactor`. */
  oldYears: z.number().nonnegative(),
  oldFactor: z.number().min(0).max(1),
  /** CU a hooked cast brings up, at least. */
  haulCu: range,
  /**
   * From a big hold a hooked cast brings up more: this share of what's left of the good
   * it hooks (picked in the range), when that's more than `haulCu`, up to `haulMaxCu`.
   */
  haulShare: z.tuple([z.number().min(0).max(1), z.number().min(0).max(1)]),
  haulMaxCu: z.number().int().positive(),
  /** The chance a hooked cast brings up her papers or her curio instead, while they're there. */
  findChance: z.number().min(0).max(1),
  /** Seen from the deck on the bottom by day in clear, calm water: zone meters, and how deep. */
  sight: z.object({
    rangeM: z.number().positive(),
    maxDepthM: z.number().positive(),
    maxHsM: z.number().positive(),
    /** Daylight 0–1 needed to see the bottom. */
    daylight: z.number().min(0).max(1),
  }),
  /** The lead line finds her when you sail over her: within this of her middle, zone meters. */
  soundingM: z.number().positive(),
  /** How far her hull stands off the bottom: the depth readout's spike, meters. */
  reliefM: z.number().positive(),
  /** A recent wreck's cargo under her owners' marks: the heat it carries (as looted freight). */
  hotHeat: z.number().min(0).max(1),
  /**
   * The hard-hat diving suit (plan 11 §6.2; Phase 10): going down from the deck at anchor
   * to a wreck too deep for the grapple. One dive is dressing, then trips to the wreck and
   * back to the hoist line while the air lasts; each trip finds something by a chance, as a
   * cast does, and brings up more of her.
   */
  dive: z.object({
    /** The hose reaches no deeper, meters. */
    maxDepthM: z.number().positive(),
    /** No dive over this significant wave height: the ship pitches on the hose. */
    maxHsM: z.number().positive(),
    /** Real seconds the dive lasts on screen. */
    workRealS: z.number().nonnegative(),
    /** Getting into the dress and out again, game minutes. */
    dressMinutes: z.number().nonnegative(),
    /** Game minutes of air: pumping your own reservoir alone (a T1), a crew on the pump. */
    airMinutes: z.object({ solo: z.number().positive(), crewed: z.number().positive() }),
    /** One trip across the wreck and back to the hoist line, game minutes. */
    tripMinutes: z.number().positive(),
    /** The chance a trip finds something, in calm water by day (night and age cut it). */
    chance: z.number().min(0).max(1),
    haulCu: range,
    haulShare: z.tuple([z.number().min(0).max(1), z.number().min(0).max(1)]),
    haulMaxCu: z.number().int().positive(),
    findChance: z.number().min(0).max(1),
    /** A dive fouls in the wreckage: a trip lost working free, and this many minutes. */
    snagChance: z.number().min(0).max(1),
    snagMinutes: z.number().nonnegative(),
    /** Over this sea the ship pitches and the tender calls you up after half the air. */
    pitchHsM: z.number().positive(),
  }),
  /** Seen at it: the crime, at most once a wreck in this many game hours. */
  crime: idOf('crime'),
  crimeEveryHours: z.number().positive(),
  /** Seen working a wreck you made: more heat on top (plan 11 §6.2: "keeps your stay suspicious"). */
  ownVictimHeat: z.number().nonnegative(),
});
export type SalvageRules = z.infer<typeof salvageRulesSchema>;

export const salvageFileSchema = z.object({
  rules: salvageRulesSchema,
  /**
   * How long a CU of each good stays sound on the bottom: calendar days for half of it to go
   * (spoiled, dissolved, rotted). Absent goods keep (ore, coal, stone, copper, whiskey in the
   * cask: Superior is cold and fresh).
   */
  halfLifeDays: z.record(idOf('good'), z.number().positive()),
  historical: z.array(historicalWreckSchema),
  seeded: seededWrecksSchema,
});
export type SalvageFile = z.infer<typeof salvageFileSchema>;
