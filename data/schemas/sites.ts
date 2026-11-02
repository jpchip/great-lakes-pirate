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
  /** What the prefab stores: CU of goods (the storage shed), and cash (the strongbox). */
  storage: z.object({
    goodsCu: z.number().int().positive(),
    strongbox: z.boolean(),
  }),
  /** Plan 12 §2.2's starting hideout for these backgrounds (Phase 4: all of them). */
  startFor: z.array(z.string()),
  blurb: z.string().min(1),
});

export const sitesFileSchema = z.array(siteSchema);
export type SiteDef = z.infer<typeof siteSchema>;
