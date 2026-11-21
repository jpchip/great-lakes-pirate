import { z } from 'zod';
import { idOf } from './common';

/**
 * Hideout sites (plan 09 §2, §12 `sites.json`; Phase 4 piece E). Phase 4 builds one, the
 * Stockton Island stash at Presque Isle bay, as a fixed prefab on its set piece in
 * data/zones.json: a landing, a shack, a strongbox and a storage shed (data/harbors.json).
 * Phase 8's grid building replaces the prefab in place and keeps what's stored there.
 *
 * Positions are meters in the set piece footprint's frame, as in data/harbors.json:
 * `alongM` along the shore (right, facing out to sea) and `inlandM` back from the anchor
 * (negative is out over the water).
 */

export const siteSchema = z.object({
  id: idOf('site'),
  name: z.string().min(1),
  /** The short name the chart and the HUD use. */
  shortName: z.string().min(1),
  /** Where it is, as the menu and the First Week name it: "Stockton Island". */
  place: z.string().min(1),
  zone: idOf('zone'),
  island: idOf('island').optional(),
  setPiece: idOf('setpiece'),
  /** Laying low here works for this region (plan 06 §3.3, Phase 5). */
  wantedRegion: idOf('region'),
  /** How hard the site is to spot, 0–1 (plan 09 §8; Phase 8 adds the modifiers). */
  concealment: z.number().min(0).max(1),
  /** Abandoned sites are claimed free; owned ones are bought (plan 09 §2.2). */
  claim: z.enum(['abandoned', 'owned']),
  /**
   * The anchorage off the site: anchored inside it counts as moored at the stash, so its
   * storage opens with P as it does alongside the landing.
   */
  anchorage: z.object({
    alongM: z.number(),
    inlandM: z.number(),
    radiusM: z.number().positive(),
  }),
  /**
   * What Phase 4's prefab stored. Superseded by the hideout's pieces (plan 09 §5.4; Phase 8
   * piece A): capacity and the strongbox come from what's built. Kept so older data loads.
   */
  storage: z
    .object({
      goodsCu: z.number().int().positive(),
      strongbox: z.boolean(),
    })
    .optional(),
  /**
   * The build bounds (plan 09 §2.1, §4.3; Phase 8 piece A): the corner in the set piece's
   * frame, the size in 2 m cells, and level 0's floor height above the lake. Build mode
   * (piece C) places it in the walked scene.
   */
  build: z
    .object({
      alongM: z.number(),
      inlandM: z.number(),
      cols: z.number().int().positive(),
      rows: z.number().int().positive(),
      baseM: z.number(),
    })
    .optional(),
  /** The pre-built hideout a claim starts with (plan 09 §2.2) and its corner cell. */
  starter: z
    .object({
      id: idOf('starter'),
      col: z.number().int().nonnegative(),
      row: z.number().int().nonnegative(),
    })
    .optional(),
  /**
   * The short pier a claim starts with (plan 09 §16.5; Phase 8 piece C), a starter laid at
   * its corner cell: set against the real shore, so it runs from the beach into water deep
   * enough to moor at.
   */
  pier: z
    .object({
      id: idOf('starter'),
      col: z.number().int().nonnegative(),
      row: z.number().int().nonnegative(),
    })
    .optional(),
  /**
   * What the site's ruins give to salvage (plan 09 §6.2, §16.5; Phase 8 piece F): a good, a
   * stock a season, carried on foot a load at a time from the named prefab's pieces of these
   * kinds (the quarry's dressed blocks, the camp's lumber piles).
   */
  salvage: z
    .object({
      good: idOf('good'),
      /** What the load is called: "dressed brownstone", "sawn lumber". */
      name: z.string().min(1),
      perSeason: z.number().int().positive(),
      loadCu: z.number().int().positive(),
      /** The island prefab (`onFoot.pois[].id`) whose pieces are the piles. */
      poi: z.string().min(1),
      kinds: z.array(z.string().min(1)).min(1),
    })
    .optional(),
  /**
   * An owned site's lease (plan 09 §2.2; Phase 9 piece W): bought at the site from its
   * owner, or the site is squatted on, and while squatted each day there's a chance it's
   * noticed, which heats its region.
   */
  lease: z
    .object({
      cents: z.number().int().positive(),
      /** Who it's leased from: "the Lighthouse Board". */
      from: z.string().min(1),
      squatHeatChance: z.number().min(0).max(1),
      squatHeat: z.number().positive(),
    })
    .optional(),
  /** Plan 12 §2.2's starting hideout for these backgrounds (Phase 4: all of them). */
  startFor: z.array(z.string()),
  blurb: z.string().min(1),
});

export const sitesFileSchema = z.array(
  siteSchema.refine((s) => (s.claim === 'owned') === !!s.lease, 'An owned site has a lease'),
);
export type SiteDef = z.infer<typeof siteSchema>;
