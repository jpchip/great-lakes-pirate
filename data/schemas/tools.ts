import { z } from 'zod';
import { idOf } from './common';

/**
 * Tools on foot and the rules of conduct (plan 08 §6, §15; Phase 7 piece E): what the cosh,
 * rope, knife, a bottle and the purse do to a guard, what a bribe costs and who takes one,
 * who takes a drink, and the hours the district's doors are open. Distances are meters,
 * times real seconds unless they say game minutes or hours.
 */

export const toolSchema = z.object({
  id: idOf('tool'),
  name: z.string().min(1),
  /**
   * What it does: `blunt` knocks a man out from behind, `blade` kills from behind, `bind`
   * ties a man who's out cold, `gift` offers a drink, `bribe` offers money.
   */
  kind: z.enum(['blunt', 'blade', 'bind', 'gift', 'bribe']),
  /** The ship's store it's bought as and spent from; absent, it's always to hand. */
  store: idOf('store').optional(),
  /**
   * How close you must be, meters. A blow's reach is past the guards' `BUMP_M` (1.2 m), where
   * a man feels you behind him: strike from just outside it.
   */
  reachM: z.number().positive(),
  /** Seconds the use key is held (tying a man up takes a while). */
  holdS: z.number().nonnegative().default(0),
  /** The sound it makes, meters (a blow's thud). */
  noiseM: z.number().nonnegative().default(0),
  /** Holding it out where it can be seen is suspicious (plan 08 §4: conduct). */
  drawn: z.boolean().default(false),
});
export type ToolDef = z.infer<typeof toolSchema>;

const byNpc = z.record(idOf('npc'), z.number().min(0));

export const toolsFileSchema = z
  .object({
    tools: z.array(toolSchema).min(1),
    takedown: z.object({
      /**
       * You're behind a guard when you're outside this share of his edge of sight's
       * half-angle (`sight.peripheralDeg`): 1 is just past the corner of his eye.
       */
      behindCone: z.number().positive(),
      /** Game hours a coshed man is out (tied, the guards' own `BOUND_GAME_S`). */
      outH: z.number().positive(),
    }),
    bribe: z.object({
      /** What each kind of man asks to look away tonight, cents. */
      priceCents: byNpc,
      /** The price rises by this share each Wanted tier. */
      perTier: z.number().min(0),
      /** Chance multipliers: he knows your face at Wanted tier 2+, he's already wary. */
      knownFace: z.number().min(0).max(1),
      wary: z.number().min(0).max(1),
      /** Game hours he looks away. */
      hours: z.number().positive(),
    }),
    whiskey: z.object({
      /** Chance each kind of man takes a drink on duty. */
      accept: byNpc,
      /** Wary, he's less keen. */
      wary: z.number().min(0).max(1),
      /** Game minutes from the drink to asleep on his feet: the least and the most. */
      passOutMin: z.tuple([z.number().positive(), z.number().positive()]),
    }),
    conduct: z.object({
      /**
       * Opening hours by the port-screen tab a door opens (`opens` in the layout): inside
       * outside them is trespass. `[from, to]` in hours; `to` past midnight is below `from`.
       */
      hours: z.record(z.string(), z.tuple([z.number().min(0).max(24), z.number().min(0).max(24)])),
    }),
  })
  .superRefine((f, ctx) => {
    const ids = new Set(f.tools.map((t) => t.id));
    if (ids.size !== f.tools.length) ctx.addIssue({ code: 'custom', message: 'Duplicate tool id' });
    for (const kind of ['blunt', 'blade', 'bind', 'gift', 'bribe'] as const) {
      if (!f.tools.some((t) => t.kind === kind)) {
        ctx.addIssue({ code: 'custom', message: `No ${kind} tool` });
      }
    }
  });
export type ToolsFile = z.infer<typeof toolsFileSchema>;
