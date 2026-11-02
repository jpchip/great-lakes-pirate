import type { EconomyDefs } from '../economy/defs';
import type { SeenPrice } from '../economy/knowledge';
import { unitPrices } from '../economy/market';
import type { SailingClass } from '../sailing/ship-class';
import type { Captain, WorldState } from '../world-state';
import { hasPerk } from './backgrounds';

/**
 * The background perks that touch Phase 4's systems (plan 12 §2.2, Phase 4 piece C). The
 * rest are stored on the captain (through the background) and wait for their phases.
 *
 * - Deckhand: sail changes a quarter faster; a wider hand-trim sweet spot and 5% more
 *   speed in it.
 * - Fisherman: this week's fish prices in every port in the ledger; tighter forecasts.
 * - Saloon Keeper: better rumors, read by the saloon (piece K) from the background.
 */

export const QUICK_HANDS_SAIL_TIME = 0.75;
export const SAIL_TRIMMER_SWEET_SPOT = 1.5;
export const SAIL_TRIMMER_BONUS = 0.05;
/** The Fisherman's forecast spread: a third tighter. */
export const WEATHER_EYE_SKILL = 2 / 3;
/** The goods the Fisherman always knows the price of. */
export const FISH_GOODS = ['good.salted_fish', 'good.fresh_fish'] as const;

type CaptainLike = Pick<Captain, 'background'>;

/**
 * The player's sailing class with the captain's sailing perks. Applied wherever the
 * player's class is built from its record (the start, and a new hull from the shipyard).
 */
export function withSailingPerks(cls: SailingClass, captain: CaptainLike): SailingClass {
  const out = { ...cls };
  if (hasPerk(captain, 'perk.quick_hands')) out.sailChangeTimeS *= QUICK_HANDS_SAIL_TIME;
  if (hasPerk(captain, 'perk.sail_trimmer')) {
    out.trimSweetSpot *= SAIL_TRIMMER_SWEET_SPOT;
    out.trimmedBonus = (out.trimmedBonus ?? 0) + SAIL_TRIMMER_BONUS;
  }
  return out;
}

/** 1 for most captains; the Fisherman's weather eye tightens the chart's forecasts. */
export function forecastSkill(captain: CaptainLike): number {
  return hasPerk(captain, 'perk.weather_eye') ? WEATHER_EYE_SKILL : 1;
}

/**
 * The Fisherman knows the fish prices in every port (plan 12 §2.2): writes this moment's
 * into the ledger beside what was seen there, leaving the other goods as they were. Does
 * nothing for any other captain.
 */
export function recordFishPrices(state: WorldState, defs: EconomyDefs): void {
  if (!hasPerk(state.player.captain, 'perk.fish_market')) return;
  const now = state.environment.clock.gameSeconds;
  const book = state.knowledge.prices;
  for (const [portId, pm] of defs.markets) {
    for (const good of FISH_GOODS) {
      if (!pm.goods.has(good)) continue;
      const p = unitPrices(defs, state.markets, portId, good, now);
      if (!p) continue;
      const seen: SeenPrice = { buyCents: p.buyCents, sellCents: p.sellCents, seenAt: now };
      (book[portId] ??= {})[good] = seen;
    }
  }
}
