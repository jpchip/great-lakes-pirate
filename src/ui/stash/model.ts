import type { EconomyDefs } from '../../sim/economy/defs';
import { holdUsed, type CargoStack } from '../../sim/economy/hold';
import { siteDef, storageCapacity, type HideoutState } from '../../sim/hideouts/stash';
import { weekLabel } from '../hud/model';

/**
 * What the stash screen shows (plan 13 §5 "Storage transfer", plan 09 §3; Phase 4 piece
 * E): the hold and the hideout's storage side by side, each stack with its flags, and the
 * purse beside the strongbox.
 */

export interface StashRow {
  /** The stack's place in its list: what a move names. */
  index: number;
  good: string;
  name: string;
  qty: number;
  hot: boolean;
  contract: boolean;
}

export interface StashSnapshot {
  hideout: string;
  siteName: string;
  blurb: string;
  dateText: string;
  purseCents: number;
  cashCents: number;
  strongbox: boolean;
  hold: StashRow[];
  holdUsed: number;
  holdCapacity: number;
  stash: StashRow[];
  stashUsed: number;
  stashCapacity: number;
  /** Why lying at anchor is refused here, or undefined when it's allowed. */
  lieRefusal: string | undefined;
}

function rows(defs: EconomyDefs, stacks: readonly CargoStack[]): StashRow[] {
  return stacks.map((s, index) => ({
    index,
    good: s.good,
    name: defs.goods.get(s.good)?.name ?? s.good,
    qty: s.qty,
    hot: !!s.hot,
    contract: !!s.contract,
  }));
}

export function stashSnapshot(opts: {
  defs: EconomyDefs;
  hideoutId: string;
  hideout: HideoutState;
  player: { purse: number; cargo: readonly CargoStack[] };
  holdCapacity: number;
  gameSeconds: number;
  lieRefusal: string | undefined;
}): StashSnapshot {
  const { defs, hideout: h, player } = opts;
  const site = siteDef(h.siteId);
  return {
    hideout: opts.hideoutId,
    siteName: site?.name ?? h.siteId,
    blurb: site?.blurb ?? '',
    dateText: weekLabel(opts.gameSeconds),
    purseCents: player.purse,
    cashCents: h.storage.cash,
    strongbox: !!site?.storage.strongbox,
    hold: rows(defs, player.cargo),
    holdUsed: holdUsed(player.cargo),
    holdCapacity: opts.holdCapacity,
    stash: rows(defs, h.storage.goods),
    stashUsed: holdUsed(h.storage.goods),
    stashCapacity: storageCapacity(h),
    lieRefusal: opts.lieRefusal,
  };
}
