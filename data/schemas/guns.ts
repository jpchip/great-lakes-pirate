import { z } from 'zod';
import { idOf } from './common';

/**
 * The guns the shady shipwright sells (plan 10 §5.4, §6; Phase 6 piece E, reconciled with
 * piece A). A gun is not an upgrade: it's mounted in `player.ship.weapons` by the combat
 * core's `fitRefusal`, which holds the mounts each class has (`weapons.json`). An offer
 * names the weapon, the mounts it takes (a pair of cannon takes both sides), its price and
 * the Fame and hull it needs.
 */
export const gunSchema = z.object({
  id: idOf('gun'),
  name: z.string().min(1),
  /** The weapon in `weapons.json`. */
  weapon: idOf('weapon'),
  /** Where it's mounted, one entry a gun: a pair takes both sides. */
  mounts: z.array(z.enum(['bow', 'port', 'starboard', 'hand'])).min(1),
  /** Price in a large port, integer cents, for all the mounts it takes. */
  priceCents: z.number().int().positive(),
  /** The Fame tier the shipwright wants before he'll deal (plan 10 §6). */
  fameTier: z.number().int().min(0),
  /** The smallest hull tier that can carry it. */
  minTier: z.number().int().min(1),
  blurb: z.string().min(1),
});

export type Gun = z.infer<typeof gunSchema>;

export const gunsFileSchema = z.array(gunSchema);
