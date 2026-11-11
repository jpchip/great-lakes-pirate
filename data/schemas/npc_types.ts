import { z } from 'zod';
import { idOf } from './common';

/**
 * On-foot NPC types (plan 08 §5.1, §15; Phase 7 piece D): how each kind of guard and
 * witness sees, hears, moves and reacts, and how the district's watch grows with the
 * region's Wanted tier (plan 08 §5.2). Ranges are meters on foot, times are real seconds.
 */

const lanternSchema = z.object({
  /** Meters the carried lantern lights around its bearer. */
  radiusM: z.number().positive(),
  /** 0–1 at the bearer's feet. */
  intensity: z.number().min(0).max(1),
});

export const npcTypeSchema = z.object({
  id: idOf('npc'),
  name: z.string().min(1),
  /** Who they are to the law when they report (plan 06 §2.4). */
  witness: z.enum(['watchman', 'constable', 'sailor']),
  /**
   * What they do once alerted: `report` files with the law there and then (a constable),
   * `fetch` runs for a constable first (a watchman), `shout` cries for help and keeps clear
   * (a sailor: a witness, not a fighter).
   */
  onAlert: z.enum(['report', 'fetch', 'shout']),
  /** Whether they chase and try to subdue you. */
  pursues: z.boolean(),
  sight: z.object({
    /** How far they see a lit, standing, walking figure in the open at night, meters. */
    rangeM: z.number().positive(),
    /** Full width of the sharp cone, degrees. */
    fovDeg: z.number().positive().max(360),
    /** Full width of the edge of sight, degrees, where the meter fills slowly. */
    peripheralDeg: z.number().positive().max(360),
  }),
  /** Multiplies every noise's radius for them: 1 is ordinary ears. */
  hearing: z.number().positive(),
  /** Alertness by day and by night, 0–1: how fast the detection meter fills. */
  vigilance: z.object({ day: z.number().min(0).max(1), night: z.number().min(0).max(1) }),
  speed: z.object({ walk: z.number().positive(), run: z.number().positive() }),
  /** Carried at night; their lantern lights you up when you're close. */
  lantern: lanternSchema.optional(),
  /** Seconds they sweep around where they lost you before giving up. */
  searchS: z.number().positive(),
  /** Chance a bribe is taken (piece E reads it). */
  bribeChance: z.number().min(0).max(1),
  /** Rifle, pistol, club or nothing: what they come at you with (piece E). */
  armed: z.enum(['none', 'club', 'pistol', 'rifle']),
});
export type NpcType = z.infer<typeof npcTypeSchema>;

export const tierScalingSchema = z.object({
  tier: z.number().int().min(0).max(5),
  /** Constables added to the district's night roster. */
  extraConstables: z.number().int().min(0),
  /** Marshals posted (tier 4+). */
  marshals: z.number().int().min(0),
  /** Multiplies every guard's vigilance. */
  vigilance: z.number().positive(),
  /** Multiplies search time. */
  search: z.number().positive(),
  /** Seconds after the alert before others nearby join the search. */
  recruitDelayS: z.number().nonnegative(),
});
export type TierScaling = z.infer<typeof tierScalingSchema>;

export const npcTypesFileSchema = z
  .object({
    types: z.array(npcTypeSchema).min(1),
    /** One row per Wanted tier, 0 to 5. */
    tiers: z.array(tierScalingSchema).length(6),
  })
  .superRefine((f, ctx) => {
    const ids = new Set(f.types.map((t) => t.id));
    for (const need of ['npc.watchman', 'npc.constable', 'npc.sailor', 'npc.marshal']) {
      if (!ids.has(need)) ctx.addIssue({ code: 'custom', message: `${need} is missing` });
    }
    if (ids.size !== f.types.length) ctx.addIssue({ code: 'custom', message: 'Duplicate id' });
    f.tiers.forEach((t, i) => {
      if (t.tier !== i) ctx.addIssue({ code: 'custom', message: `tiers[${i}] is tier ${t.tier}` });
    });
  });
export type NpcTypesFile = z.infer<typeof npcTypesFileSchema>;
