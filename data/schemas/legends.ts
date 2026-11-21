import { z } from 'zod';
import { idOf } from './common';
import { geoSchema } from './zones';

/**
 * Clues, legends and seeded caches (plan 11 §7–9, §14; §18.4 piece T): `legends.json`,
 * `clues.json` and `caches.json`.
 *
 * A legend is told in the saloons (its tale is in `rumors.json`), and every clue to it
 * shrinks its lead's circle on the chart. Three clues make a map at a cartography table,
 * with an X on the spot. The spot is where the payoff lies: dug for, searched for in a
 * cave, or grappled up from a wreck.
 *
 * A point on an island is a prefab's named mark (`poi` and `mark`, piece P's marks); a
 * point on the mainland is a point on the chart, with a pad round it to land on.
 */

/** A prefab's named point on an island: `hermit_cabin`'s `behind`. */
export const poiMarkSchema = z.object({
  island: idOf('island'),
  poi: z.string().regex(/^[a-z0-9_]+$/),
  mark: z.string().regex(/^[a-z0-9_]+$/),
});
export type PoiMarkRef = z.infer<typeof poiMarkSchema>;

/** Where a legend's payoff lies. */
export const legendSpotSchema = z.discriminatedUnion('kind', [
  /** Dug for at a prefab's mark (or searched under a floor), held F. */
  poiMarkSchema.extend({
    kind: z.literal('poi'),
    dig: z.boolean(),
    name: z.string().min(1),
    /** Where the mark lies on the chart, for a map's X (a test checks it's the mark's). */
    at: geoSchema,
  }),
  /** Dug for at a point on the chart: a pad is walked round it (the mainland). */
  z.object({
    kind: z.literal('chart'),
    zone: idOf('zone'),
    at: geoSchema,
    /** The pad's own name, for its landing. */
    place: z.string().min(1),
    name: z.string().min(1),
  }),
  /** Searched for at a cave's mark, at the dark of the moon or on the ice. */
  z.object({
    kind: z.literal('cave'),
    cave: idOf('cave'),
    mark: z.string().regex(/^[a-z0-9_]+$/),
    name: z.string().min(1),
    at: geoSchema,
  }),
  /** Grappled up from a wreck once the lead knows where in her to hook. */
  z.object({ kind: z.literal('wreck'), wreck: idOf('wreck') }),
  /** Dug for above a beaten copycat's camp (the Copycat's Hoard). */
  z.object({ kind: z.literal('stash'), name: z.string().min(1) }),
]);
export type LegendSpot = z.infer<typeof legendSpotSchema>;

export const legendDefSchema = z.object({
  id: idOf('legend'),
  name: z.string().min(1),
  spot: legendSpotSchema,
  /** Cash in it, rolled between the two by the run's seed (the hoard's is the rival's). */
  cashCents: z.tuple([z.number().int().nonnegative(), z.number().int().nonnegative()]),
  curio: idOf('curio').optional(),
  /** What you find, the HUD's line: `{cash}` is the money. */
  found: z.string().min(1),
  /** The journal's line once it's done: the tale explained. */
  told: z.string().min(1),
  /** A hideout site it puts on the chart, when it's one you haven't found. */
  site: idOf('site').optional(),
  /** A fence who'll deal with you from now on whatever your Fame. */
  fence: idOf('fence').optional(),
});
export type LegendDef = z.infer<typeof legendDefSchema>;

export const legendRulesSchema = z.object({
  /** Clues on a lead (the tale counts) before a cartography table makes it a map. */
  mapClues: z.number().int().min(2),
  /** A map's circle round the spot, real meters: close enough to see the mark. */
  mapRadiusM: z.number().positive(),
  /** Game hours at the table to draw a map. */
  mapHours: z.number().positive(),
  /** Holding F this long digs, or opens a hiding place, s. */
  digHoldS: z.number().positive(),
  /** Reach to a spot, m. */
  reachM: z.number().positive(),
  /** A clue's mark is read from this close, m. */
  markReachM: z.number().positive(),
  /** The Devil's Grotto's ledge shows only under a moon this dark (0 new … 1 full). */
  darkMoon: z.number().min(0).max(1),
  /** The pad walked round a dig on the mainland, m each side. */
  padM: z.number().positive(),
});

export const legendsFileSchema = z
  .object({ rules: legendRulesSchema, legends: z.array(legendDefSchema) })
  .superRefine((f, ctx) => {
    const ids = new Set<string>();
    for (const l of f.legends) {
      if (ids.has(l.id)) ctx.addIssue({ code: 'custom', message: `duplicate ${l.id}` });
      ids.add(l.id);
      if (l.cashCents[0] > l.cashCents[1]) {
        ctx.addIssue({ code: 'custom', message: `${l.id}: cashCents low above high` });
      }
    }
  });
export type LegendsFile = z.infer<typeof legendsFileSchema>;

/** Where a clue is found. */
export const clueSourceSchema = z.discriminatedUnion('kind', [
  /** Read in a light station's logbook, or taken with it. */
  z.object({ kind: z.literal('logbook'), light: idOf('light') }),
  /** Among the papers rifled from a box in a district (a desk, a strongbox). */
  z.object({ kind: z.literal('document'), district: idOf('district') }),
  /** Something in the land you walk up to and read with F: a carving, a net on a reel. */
  poiMarkSchema.extend({ kind: z.literal('mark'), name: z.string().min(1) }),
  /** A cave's mark you read with F. */
  z.object({
    kind: z.literal('caveMark'),
    cave: idOf('cave'),
    mark: z.string().regex(/^[a-z0-9_]+$/),
    name: z.string().min(1),
  }),
  /** Something at a legend's own pad you read with F (the dead tower's door). */
  z.object({ kind: z.literal('pad'), legend: idOf('legend'), name: z.string().min(1) }),
]);
export type ClueSource = z.infer<typeof clueSourceSchema>;

export const clueDefSchema = z.object({
  id: idOf('clue'),
  /** The lead it adds to: a legend, or a seeded cache. */
  lead: z.string().regex(/^(legend|cache)\.[a-z0-9_]+$/),
  source: clueSourceSchema,
  /** The journal's line: what it says. */
  text: z.string().min(1),
  /** "the Devils Island light's log", for the journal. */
  from: z.string().min(1),
  /** A curio found with it (the Ghost Net's glass float). */
  curio: idOf('curio').optional(),
});
export type ClueDef = z.infer<typeof clueDefSchema>;

export const cluesFileSchema = z.array(clueDefSchema).superRefine((list, ctx) => {
  const ids = new Set<string>();
  for (const c of list) {
    if (ids.has(c.id)) ctx.addIssue({ code: 'custom', message: `duplicate ${c.id}` });
    ids.add(c.id);
  }
});

/**
 * A seeded cache (plan 11 §7.1, §9): candidate hiding places on an island, at its prefabs'
 * cairns and under its cabins' floors. Each run stocks some of them, the seed choosing
 * which, which spot holds it and what's in it.
 */
export const seededCacheSchema = z.object({
  id: idOf('cache'),
  name: z.string().min(1),
  island: idOf('island'),
  /** "the island's lookout cairn". */
  where: z.string().min(1),
  spots: z
    .array(
      z.object({
        poi: z.string().regex(/^[a-z0-9_]+$/),
        mark: z.string().regex(/^[a-z0-9_]+$/),
        name: z.string().min(1),
      }),
    )
    .min(1),
  cashCents: z.tuple([z.number().int().nonnegative(), z.number().int().nonnegative()]),
  found: z.string().min(1),
  curio: idOf('curio').optional(),
  /** The papers that put you onto it, when there are any to find this run. */
  note: z.string().min(1),
});
export type SeededCacheDef = z.infer<typeof seededCacheSchema>;

export const cachesFileSchema = z.object({
  /** The share of seeded caches stocked in a run. */
  stockedShare: z.number().gt(0).max(1),
  /** A cache's lead from papers: its circle round the island, real meters. */
  leadRadiusM: z.number().positive(),
  /** The chance a box's papers in a district are a note about a stocked cache. */
  noteChance: z.number().min(0).max(1),
  caches: z.array(seededCacheSchema),
});
export type CachesFile = z.infer<typeof cachesFileSchema>;
