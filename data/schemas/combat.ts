import { z } from 'zod';
import { idOf } from './common';

/**
 * Guns and their shot (plan 07 §2, §4; Phase 6 piece A). Ranges and speeds are scene
 * meters and real seconds, the frame shots fly in: an arena is 3 km across and ships close
 * to a few hundred meters. Damage is in the target's pool points (`hullHP`, `riggingHP` in
 * ships.json; the engine's from `sim/combat/damage.ts`), and in hands for the crew.
 */

/** The damage pools a shot can reach (plan 07 §4.2). Steering waits on the cut list. */
export const DAMAGE_POOLS = ['hull', 'rigging', 'crew', 'engine'] as const;
export type DamagePool = (typeof DAMAGE_POOLS)[number];

/** Where a gun is carried (plan 07 §2.1): on a pivot at the bow, along a side, in hand. */
export const MOUNTS = ['bow', 'port', 'starboard', 'hand'] as const;
export type Mount = (typeof MOUNTS)[number];

const poolDamageSchema = z.object({
  /** Hull points off a hit low on her side. */
  hull: z.number().nonnegative(),
  /** Rigging points off a hit aloft. */
  rigging: z.number().nonnegative(),
  /** Hands hit by a shot that sweeps the deck (killed or wounded by the ammo's share). */
  crew: z.number().nonnegative(),
  /** Engine points off a hit in a steamer's engine and boiler spaces. */
  engine: z.number().nonnegative(),
});

export const weaponSchema = z
  .object({
    id: idOf('weapon'),
    name: z.string().min(1),
    /** Bow pivot, a broadside, or small arms (plan 07 §2.1). */
    kind: z.enum(['swivel', 'broadside', 'small_arms']),
    /** Total traverse, degrees, centered on the bow (swivel) or the beam (broadside). */
    arcDeg: z.number().positive().max(360),
    /** The furthest a sight will be laid, scene meters. */
    rangeM: z.number().positive(),
    /** Shot speed leaving the muzzle, scene m/s; `rangeM` must be reachable with it. */
    muzzleMs: z.number().positive(),
    /** Seconds to load again: alone (the T1), and with a crew (T2 and up). */
    reloadSoloS: z.number().positive(),
    reloadCrewedS: z.number().positive(),
    /** One-sigma scatter of a laid gun, degrees, in bearing and in elevation. */
    spreadDeg: z.number().nonnegative(),
    /** Powder charges a shot burns (a keg of powder and shot holds `chargesPerCu`). */
    charges: z.number().int().nonnegative(),
    /** What it can fire, `ammo.json` ids. */
    ammo: z.array(idOf('ammo')).min(1),
    /** Damage by the ammo it fires (warning shots use their `as` ammo), against each pool. */
    damage: z.record(idOf('ammo'), poolDamageSchema),
    /** A guide price at the shady shipwright, integer cents (piece E sets the real one). */
    priceCents: z.number().int().positive(),
  })
  .refine((w) => w.muzzleMs ** 2 / 9.81 >= w.rangeM, 'rangeM is beyond the muzzle velocity')
  .refine(
    (w) => w.ammo.every((a) => a === 'ammo.warning' || w.damage[a] !== undefined),
    'Every ammo a weapon fires needs its damage row',
  );

/** Which guns a player's hull carries (plan 07 §2.3): a bow pivot, guns a side, small arms. */
const mountsSchema = z.object({
  bow: z.number().int().nonnegative(),
  /** Guns on each side, port and starboard alike. */
  broadside: z.number().int().nonnegative(),
  hand: z.number().int().nonnegative(),
});

export const weaponsFileSchema = z.object({
  weapons: z.array(weaponSchema).min(1),
  /** By player class id. */
  mounts: z.record(idOf('ship'), mountsSchema),
});

export const ammoSchema = z.object({
  id: idOf('ammo'),
  name: z.string().min(1),
  /** A warning shot fires this ammo, laid to fall across her bow (plan 07 §2.2). */
  as: idOf('ammo').optional(),
  warning: z.boolean().default(false),
  /** Multiplies the gun's reach (grape scatters early). */
  rangeMul: z.number().positive().max(1).default(1),
  /** Multiplies the gun's scatter. */
  spreadMul: z.number().positive().default(1),
  /** Of the hands a shot hits, the share killed; the rest are wounded. */
  killedShare: z.number().min(0).max(1),
  /** The chance a hit on her hull or rigging kills a hand anyway (round shot's splinters). */
  strayKillChance: z.number().min(0).max(1),
  /** Meant to stay off the murder list (chain, warning): the HUD says so. */
  nonLethal: z.boolean(),
});

export const ammoFileSchema = z.object({
  /** The good the guns burn and how many charges a CU of it makes (plan 07 §2.2). */
  powder: z.object({ good: idOf('good'), chargesPerCu: z.number().int().positive() }),
  ammo: z.array(ammoSchema).min(1),
});

export type WeaponDef = z.infer<typeof weaponSchema>;
export type WeaponsFile = z.infer<typeof weaponsFileSchema>;
export type AmmoDef = z.infer<typeof ammoSchema>;
export type AmmoFile = z.infer<typeof ammoFileSchema>;
export type PoolDamage = z.infer<typeof poolDamageSchema>;
