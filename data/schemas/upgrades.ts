import { z } from 'zod';
import { idOf } from './common';

/**
 * Ship upgrades (plan 10 §5, §11; Phase 4 piece G). Each takes a slot in its category
 * (plan 10 §4: the hull's class sets how many), and changes the ship through its
 * `effects`, which the shipyard folds into the ship's class and hazard rules when it is
 * fitted. The Phase 4 set is plan 10 §13's: about ten legit upgrades. Phase 6 piece E
 * adds the guns, the weapon mods and the rifle, sold only by the shady shipwright in a
 * port's back room at night (plan 10 §5.4, §6; plan 07 §14.4).
 */
export const UPGRADE_CATEGORIES = [
  'hull',
  'rigging',
  'cargo',
  'instruments',
  'utility',
  'weaponMods',
] as const;
export type UpgradeCategory = (typeof UPGRADE_CATEGORIES)[number];

/**
 * Where an upgrade is sold and fitted (plan 10 §6). `backRoom` is the shady shipwright,
 * after dark in a port's back room (Phase 6 piece E): guns are never sold openly.
 * `hideout` is crafted at a hideout's station (plan 10 §6; Phase 8 piece E) and installed
 * at its slipway (piece G).
 */
export const UPGRADE_SOURCES = ['shipyard', 'chandlery', 'backRoom', 'hideout'] as const;
export type UpgradeSource = (typeof UPGRADE_SOURCES)[number];

/** What an upgrade does: each field is optional, and absent means no change. */
export const upgradeEffectsSchema = z.object({
  /** Hull speed multiplier (quality canvas: 1.05). */
  speedMul: z.number().positive().optional(),
  /** Hull speed added, game knots (planking and a bigger hold cost 0.2). */
  speedKn: z.number().optional(),
  /** Hull HP multiplier. */
  hullHpMul: z.number().positive().optional(),
  /** Hold multiplier, rounded down to whole CU. */
  cargoMul: z.number().positive().optional(),
  /** Draft added when fully laden, meters. */
  draftFullM: z.number().optional(),
  /** Sail-change time multiplier (improved blocks: faster). */
  sailChangeMul: z.number().positive().optional(),
  /** Wind each sail level carries before strain, knots added: Furled, Reefed, Half, Full. */
  safeWindKn: z.tuple([z.number(), z.number(), z.number(), z.number()]).optional(),
  /** Anchor holding multiplier. */
  anchorHoldMul: z.number().positive().optional(),
  /** Multiplier on what a leak costs in speed and draft (pumps). */
  leakMul: z.number().positive().optional(),
  /** The depth warning sounds at this many drafts (plan 02 §6.2 is 2). */
  shallowWarnDrafts: z.number().positive().optional(),
  /** How far ahead the chart forecasts, game hours (plan 04 §5.4). */
  forecastHours: z.number().positive().optional(),
  /** Spyglass field of view multiplier (a telescope magnifies more). */
  spyglassFovMul: z.number().positive().optional(),
  /** Range multiplier for looking a ship over. */
  lookRangeMul: z.number().positive().optional(),
  /**
   * Multiplier on the odds a revenue search finds contraband and hot goods (a hidden
   * compartment; Phase 5 piece C, plan 06 §5.1).
   */
  searchMul: z.number().positive().optional(),
  /** Weapon mods (plan 10 §5.4): the guns' range, reload time and spread, multiplied. */
  gunRangeMul: z.number().positive().optional(),
  reloadMul: z.number().positive().optional(),
  spreadMul: z.number().positive().optional(),
  /** Repair stores: room in the lockers for this many more of each kit (plan 10 §5.7). */
  kitsMax: z.number().int().positive().optional(),
  /** Hidden gun ports: she looks unarmed to targets (not to the law's ship profile). */
  looksUnarmed: z.boolean().optional(),
  /**
   * Topsails (plan 10 §5.2; Phase 9 piece G): speed multiplier at Full in light and
   * moderate airs, fading out between 14 and 18 knots of wind.
   */
  lightAirMul: z.number().positive().optional(),
  /** How much further she's seen with her sails set (topsails), at full sail. */
  sailSightMul: z.number().positive().optional(),
  /** How far she's seen in full dark (dark-tanned sails: 0.75), easing in at dusk. */
  nightSightMul: z.number().positive().optional(),
  /** Muffled blocks (plan 10 §5.6): close in after dark, watchers are slower to notice her. */
  muffled: z.boolean().optional(),
  /** Corrected charts: chart voyages run this much faster (plan 10 §5.5's better routing). */
  chartSpeedMul: z.number().positive().optional(),
});

export const upgradeSchema = z.object({
  id: idOf('upgrade'),
  name: z.string().min(1),
  category: z.enum(UPGRADE_CATEGORIES),
  /** Its sailing effect in plain words (plan 10 §12), for the shipyard and tooltips. */
  blurb: z.string().min(1),
  /** Price in a large port, integer cents; smaller ports add their spread. */
  priceCents: z.number().int().positive(),
  sources: z.array(z.enum(UPGRADE_SOURCES)).min(1),
  /** Game hours the yard takes to fit it (plan 10 §6); a chandlery's fitting is instant. */
  installHours: z.number().nonnegative(),
  /** Moves to a new hull on a trade-in when she has the slot (plan 10 §3). */
  transferable: z.boolean(),
  effects: upgradeEffectsSchema,
  /** The Fame tier the seller wants before he'll deal (plan 10 §6: illicit gear is gated). */
  fameTier: z.number().int().min(0).optional(),
  /** A gun work item: it needs a gun aboard to fit (guns are in `guns.json`). */
  needsGun: z.boolean().optional(),
});

export const upgradesFileSchema = z.array(upgradeSchema);
export type Upgrade = z.infer<typeof upgradeSchema>;
export type UpgradeEffects = z.infer<typeof upgradeEffectsSchema>;
