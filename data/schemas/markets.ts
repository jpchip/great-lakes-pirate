import { z } from 'zod';
import { idOf } from './common';

/**
 * Port market profiles (plan 05 §4.2). A port trades every legal good except the ones it
 * lists as absent; what it makes is cheap and deep in stock, what it wants is dear and
 * thin. The numbers behind sizes and roles live in `sim/economy/market-rules.ts`.
 */
export const marketSchema = z.object({
  id: idOf('market'),
  port: idOf('port'),
  /** Huge to tiny: how deep its stocks are and how wide its spread (plan 05 §4.1). */
  size: z.enum(['huge', 'large', 'medium', 'small', 'tiny']),
  /** Cheap here: the port's exports. */
  exports: z.array(idOf('good')),
  /** Dear here: the port's imports and demand. */
  imports: z.array(idOf('good')),
  /** Goods the port doesn't trade at all. */
  absent: z.array(idOf('good')).default([]),
  /** Multiplier on export role base price for this port only (plan 05 §26.5). */
  exportPrice: z.number().positive().optional(),
  /** Multiplier on export role target stock for this port only. */
  exportStock: z.number().positive().optional(),
  /**
   * Cut off by the ice (an island village, frozen in for the winter): its imports run
   * shorter than a frozen port's (`importStock` × target in place of the rules'), and what
   * the winter's fishing and trapping piles up there with no boat to take it goes cheap
   * (`exports`, `exportStock` × target). The harbor master says so (`word`).
   */
  iceBound: z
    .object({
      exports: z.array(idOf('good')).min(1),
      exportStock: z.number().min(1),
      importStock: z.number().gt(0).max(1),
      word: z.string().min(1),
    })
    .optional(),
});

export const marketsFileSchema = z.array(marketSchema).refine(
  (ms) =>
    ms.every((m) => {
      const all = [...m.exports, ...m.imports, ...m.absent];
      return new Set(all).size === all.length;
    }),
  'A good is at most one of export, import or absent in a port',
);
export type MarketDef = z.infer<typeof marketSchema>;
