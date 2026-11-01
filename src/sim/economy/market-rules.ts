import { z } from 'zod';

/**
 * The market model's tuning (plan 05 §4.1), shared by every port. Per-port profiles live
 * in `data/markets.json` and per-good numbers in `data/goods.json`; these turn a port's
 * size and a good's role there into stocks, prices and spreads. The balance harness
 * (`sim/economy/harness.ts`) is what these are tuned against.
 */

const bySize = z.object({
  huge: z.number(),
  large: z.number(),
  medium: z.number(),
  small: z.number(),
  tiny: z.number(),
});

export const marketRulesSchema = z.object({
  /** Target stock of a good the port neither makes nor wants, CU, by port size. */
  depthCu: bySize,
  /**
   * The port's spread: it sells to you at price × (1 + spread) and buys from you at
   * price × (1 − spread) (plan 05 §4.1: 8%, smaller in big ports).
   */
  spread: bySize,
  /** Target stock as a multiple of the depth, by the good's role in the port. */
  stockByRole: z.object({ export: z.number(), neutral: z.number(), import: z.number() }),
  /** Base price as a multiple of the good's, by role: cheap where made, dear where wanted. */
  priceByRole: z.object({ export: z.number(), neutral: z.number(), import: z.number() }),
  /**
   * How hard stock moves the price: price ∝ (target / stock)^elasticity. Higher means a
   * dumped hold crashes the price further.
   */
  elasticity: z.number().positive(),
  /** The price never leaves [min, max] × the port's base price (plan 05 §4.1: 0.4–3). */
  clampMin: z.number().positive(),
  clampMax: z.number().positive(),
  /**
   * Share of the gap to the seasonal target stock that closes per game day: production
   * and consumption folded into one drift. 0.35 closes half the gap in two game days
   * (two calendar weeks), so a crashed price recovers over a few weeks.
   */
  recoveryPerDay: z.number().positive(),
  /** A good out of season: its target stock as a share of the in-season one. */
  offSeasonStock: z.number().min(0).max(1),
  /** Stock never drifts below this many CU, so the price formula stays finite. */
  minStockCu: z.number().positive(),
});

export type MarketRules = z.infer<typeof marketRulesSchema>;

export function defaultMarketRules(): MarketRules {
  return {
    depthCu: { huge: 300, large: 160, medium: 70, small: 40, tiny: 20 },
    spread: { huge: 0.04, large: 0.06, medium: 0.08, small: 0.1, tiny: 0.12 },
    stockByRole: { export: 2.5, neutral: 1, import: 0.6 },
    priceByRole: { export: 0.83, neutral: 1, import: 1.17 },
    elasticity: 0.8,
    clampMin: 0.4,
    clampMax: 3,
    recoveryPerDay: 0.35,
    offSeasonStock: 0.6,
    minStockCu: 0.5,
  };
}
