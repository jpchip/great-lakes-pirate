import type { Fence } from '../../../data/schemas/fences';
import type { EconomyDefs } from '../../sim/economy/defs';
import {
  fenceCash,
  fenceLotQuote,
  fenceTrust01,
  maxFenceLot,
  type FenceLotRefusal,
  type FenceState,
} from '../../sim/economy/fence';
import type { CargoStack } from '../../sim/economy/hold';
import type { Trader } from '../../sim/economy/trade';
import type { YardSnapshot } from './shipyard-model';

/**
 * What the back room tab shows (plan 05 §6.2, §12 "Fence screen"; Phase 6 piece E): the
 * fence, his cash for the week and how far he trusts you, every lot in your hold with his
 * rate or why he won't take it, and the shady shipwright's guns and gun work beside it.
 * Built with the port screen, after dark at a port with a fence who'll see you.
 */

export interface BackRoomLot {
  /** The stack's place in the hold. */
  index: number;
  good: string;
  name: string;
  qty: number;
  hot: boolean;
  /** His rate as a whole percent of the good's value, and a CU's price. */
  ratePct: number | undefined;
  unitCents: number | undefined;
  /** Not his line: he takes it, for less. */
  offLine: boolean;
  /** The most CU his cash covers tonight. */
  maxQty: number;
  refusal: string | undefined;
}

/** A gun the shipwright sells: its price and why she can't have it now, if she can't. */
export interface BackRoomGun {
  id: string;
  name: string;
  blurb: string;
  priceCents: number;
  /** "Bow" or "Port and starboard": where it's mounted. */
  where: string;
  refusal: string | undefined;
}

export interface BackRoomSnapshot {
  fence: string;
  name: string;
  where: string;
  blurb: string;
  /** "He wants fish and furs" or "He takes anything". */
  wants: string;
  cashCents: number;
  trustText: string;
  lots: BackRoomLot[];
  /** With the law after you in the port's region, the risk he sells you out, in a word. */
  informRisk?: string | undefined;
  /** The shady shipwright's guns and gun work, if he works out of this room. */
  guns?: BackRoomGun[] | undefined;
  shipwright?: YardSnapshot | undefined;
}

const REFUSALS: Record<FenceLotRefusal, string> = {
  clean: 'Clean goods: sell them at the market',
  contract: "A company's freight: he won't touch it",
  unknown: "He doesn't deal in it",
};

function trustText(t: number): string {
  if (t < 0.1) return "He doesn't know you yet";
  if (t < 0.4) return 'He knows your face';
  if (t < 0.8) return 'He deals with you';
  return 'He trusts you';
}

/** "fish and furs": the goods he wants, in plain words. */
function wantsText(defs: EconomyDefs, fence: Fence): string {
  if (!fence.prefers) return 'He takes anything';
  const names = [
    ...new Set(fence.prefers.map((g) => defs.goods.get(g)?.talk.name ?? g.replace('good.', ''))),
  ];
  const list =
    names.length <= 1
      ? (names[0] ?? '')
      : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1] ?? ''}`;
  return `He wants ${list}; anything else he takes for less`;
}

export function backRoomSnapshot(
  defs: EconomyDefs,
  fence: Fence,
  state: FenceState,
  trader: Trader,
  gameSeconds: number,
  fameTier: number,
): BackRoomSnapshot {
  const lots = trader.cargo.map((s: CargoStack, index): BackRoomLot => {
    const q = fenceLotQuote(defs, fence, state, s, gameSeconds, fameTier);
    return {
      index,
      good: s.good,
      name: defs.goods.get(s.good)?.name ?? s.good,
      qty: s.qty,
      hot: !!s.hot,
      ratePct: q.ok ? Math.round(q.rate * 100) : undefined,
      unitCents: q.ok ? q.unitCents : undefined,
      offLine: q.ok && !q.inLine,
      maxQty: maxFenceLot(defs, fence, state, s, gameSeconds, fameTier),
      refusal: q.ok ? undefined : REFUSALS[q.reason],
    };
  });
  // Lots he'll take first, then the rest.
  lots.sort((a, b) => Number(!!a.refusal) - Number(!!b.refusal) || a.name.localeCompare(b.name));
  return {
    fence: fence.id,
    name: fence.name,
    where: fence.where,
    blurb: fence.blurb,
    wants: wantsText(defs, fence),
    cashCents: fenceCash(fence, state, gameSeconds),
    trustText: trustText(fenceTrust01(fence, state)),
    lots,
  };
}
