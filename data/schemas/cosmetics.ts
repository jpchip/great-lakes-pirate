import { z } from 'zod';
import { idOf } from './common';

/**
 * Paint, canvas and colors (plan 10 §7; Phase 10). Cosmetic only: none of it changes how
 * she sails, what she's worth, or what the law knows her by (plan 06 §2.3). Done at a
 * shipyard or a hideout slipway, cheap and quick. Colors are `#rrggbb` in the palette's
 * soft photochrom range (plan 14 §2), not pure hues.
 */
export const COSMETIC_KINDS = ['hull', 'trim', 'sails', 'pennant'] as const;
export type CosmeticKind = (typeof COSMETIC_KINDS)[number];

const color = z.string().regex(/^#[0-9a-f]{6}$/, 'Expected a color like "#d6d0c2"');

export const cosmeticOptionSchema = z.object({
  id: idOf('cosmetic'),
  kind: z.enum(COSMETIC_KINDS),
  name: z.string().min(1),
  color,
  /** A pennant's second color, on its fly (outer) half. */
  fly: color.optional(),
});
export type CosmeticOption = z.infer<typeof cosmeticOptionSchema>;

export const cosmeticsFileSchema = z.object({
  options: z.array(cosmeticOptionSchema).min(1),
  /** The colors each class is drawn in before you change them: what the screen shows as hers. */
  classDefaults: z.record(z.string(), z.record(z.enum(COSMETIC_KINDS), idOf('cosmetic'))),
  /** What each kind of work costs, and the game hours it takes at a shipyard. */
  work: z.record(
    z.enum([...COSMETIC_KINDS, 'name']),
    z.object({ priceCents: z.number().int().nonnegative(), hours: z.number().nonnegative() }),
  ),
});
export type CosmeticsFile = z.infer<typeof cosmeticsFileSchema>;
