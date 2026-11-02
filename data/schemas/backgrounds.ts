import { z } from 'zod';
import { idOf } from './common';

/**
 * The six backgrounds of plan 12 §2.2 (Phase 4 piece C): start money and cargo, the pier
 * of the starting port the run opens at, the starting hideout, and two perks. `phase` is
 * when a perk starts to do something; the ones for later phases are stored on the
 * captain and wait for their systems.
 */
export const perkSchema = z.object({
  id: idOf('perk'),
  name: z.string().min(1),
  /** One line on what it does, shown on the background card. */
  text: z.string().min(1),
  /** The phase that wires it (plan 00 §7). */
  phase: z.number().int().min(4),
});

export const backgroundSchema = z.object({
  id: idOf('background'),
  name: z.string().min(1),
  blurb: z.string().min(1),
  /** Cash on hand at the start, integer cents (plan 05 §2). */
  purseCents: z.number().int().nonnegative(),
  cargo: z.array(z.object({ good: idOf('good'), qty: z.number().int().positive() })),
  /** The pier of the starting port the run opens at, docked (plan 12 §3). */
  startPier: idOf('pier'),
  /** Every background starts at the Stockton stash in Phase 4 (plan 05 §16.5). */
  hideout: idOf('hideout'),
  /** Duluth and Two Harbors are busier, more policed starts (plan 12 §3). */
  harderStart: z.boolean(),
  perks: z.array(perkSchema).length(2),
});

export const backgroundsFileSchema = z.array(backgroundSchema);
export type BackgroundDef = z.infer<typeof backgroundSchema>;
export type PerkDef = z.infer<typeof perkSchema>;

const color = z.string().regex(/^#[0-9a-f]{6}$/);

/**
 * Portrait presets for character creation (plan 12 §2.1 step 2, Phase 4): a face drawn
 * from a few parts until Phase 7 gives the captain a body (plan 05 §16.5).
 */
export const portraitSchema = z.object({
  id: idOf('portrait'),
  name: z.string().min(1),
  skin: color,
  hair: color,
  beard: z.enum(['none', 'mustache', 'full']),
  hat: z.enum(['none', 'cap', "sou'wester", 'bowler', 'wool', 'bonnet']),
  coat: color,
});

export const portraitsFileSchema = z.array(portraitSchema);
export type PortraitDef = z.infer<typeof portraitSchema>;
