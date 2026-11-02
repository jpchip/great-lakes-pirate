import type { UpgradeCategory } from '../../../data/schemas/upgrades';
import { UPGRADE_CATEGORIES } from '../../../data/schemas/upgrades';
import type { EconomyDefs } from '../../sim/economy/defs';
import { formatCents } from '../../sim/economy/knowledge';
import type { MarketsState } from '../../sim/economy/market';
import { sailShipRecord } from '../../sim/sailing/ships';
import { fitShip, slotsOf, slotsUsed, upgradeDefs } from '../../sim/shipyard/fit';
import { defaultHazardRules } from '../../sim/sailing/hazard-rules';
import {
  fitRefusal,
  hullQuote,
  hullsForSale,
  REMOVAL_REFUND,
  repairQuote,
  upgradePriceCents,
  type FitSource,
  type Owner,
  type ShipState,
} from '../../sim/shipyard/shipyard';

/**
 * What the shipyard tab and the chandlery's fittings show (plan 10 §12, plan 13 §5; Phase
 * 4 piece G): her condition and repairs, hulls for sale with the trade-in worked out, and
 * the upgrades the place fits, with the slots they take.
 */

export const CATEGORY_NAMES: Record<UpgradeCategory, string> = {
  hull: 'Hull',
  rigging: 'Rigging and sails',
  cargo: 'Cargo',
  instruments: 'Instruments',
  utility: 'Utility',
};

/** A class's sailing numbers as fitted, for comparing hulls (plan 10 §12). */
export interface HullStats {
  speedKn: number;
  cargoCu: number;
  draftM: string;
  hullHp: number;
  riggingHp: number;
  sailChangeS: number;
}

export interface HullOffer {
  classId: string;
  name: string;
  tier: number;
  current: boolean;
  priceCents: number;
  tradeInCents: number;
  /** Positive, you pay; negative, the yard pays you. */
  netCents: number;
  stats: HullStats;
  /** Gear that comes across, and cargo sold off because it won't fit. */
  movingNames: string[];
  overflowText: string | undefined;
  /** Why not, or undefined when you can buy her now. */
  refusal: string | undefined;
}

export interface UpgradeRow {
  id: string;
  name: string;
  category: UpgradeCategory;
  blurb: string;
  priceCents: number;
  /** Game hours the yard takes; 0 at a chandlery. */
  hours: number;
  fitted: boolean;
  transferable: boolean;
  /** What taking it out gives back. */
  refundCents: number;
  /** Why it can't go in, or undefined. */
  refusal: string | undefined;
}

export interface SlotRow {
  category: UpgradeCategory;
  label: string;
  used: number;
  total: number;
}

export interface YardSnapshot {
  place: FitSource;
  shipName: string;
  className: string;
  hull01: number;
  rigging01: number;
  stats: HullStats;
  slots: SlotRow[];
  /** What making her sound costs here; undefined when she needs nothing this place does. */
  repair: { totalCents: number; hours: number; affordable: boolean } | undefined;
  /** At a shipyard only. */
  hulls: HullOffer[];
  upgrades: UpgradeRow[];
}

export interface YardSources {
  defs: EconomyDefs;
  markets: MarketsState;
  owner: Owner;
  ship: ShipState;
  shipName: string;
  port: string;
  place: FitSource;
  gameSeconds: number;
}

const REFUSAL_TEXT: Partial<Record<string, string>> = {
  noMoney: "You haven't the money.",
  noSlot: 'No free slot',
  fitted: 'Fitted',
};

function statsOf(classId: string, upgrades: readonly string[]): HullStats {
  const f = fitShip(sailShipRecord(classId), defaultHazardRules(), upgrades).record;
  return {
    speedKn: Math.round(f.hullMaxSpeedKn * 10) / 10,
    cargoCu: f.cargoCapacity,
    draftM: `${f.draftEmptyM.toFixed(1)}–${f.draftFullM.toFixed(1)} m`,
    hullHp: Math.round(f.hullHP),
    riggingHp: Math.round(f.riggingHP),
    sailChangeS: Math.round(f.sailChangeTimeS * 10) / 10,
  };
}

export function yardSnapshot(src: YardSources): YardSnapshot {
  const { defs, markets, owner, ship, port, place } = src;
  const record = sailShipRecord(ship.classId);
  const slots: SlotRow[] = UPGRADE_CATEGORIES.map((category) => ({
    category,
    label: CATEGORY_NAMES[category],
    used: slotsUsed(ship.upgrades, category),
    total: slotsOf(record, category),
  })).filter((s) => s.total > 0);

  const q = repairQuote(defs, port, ship, place);
  const repair =
    q.totalCents > 0
      ? { totalCents: q.totalCents, hours: q.hours, affordable: q.totalCents <= owner.purse }
      : undefined;

  const hulls: HullOffer[] =
    place === 'shipyard'
      ? hullsForSale().map((r) => {
          const current = r.id === ship.classId;
          const hq = hullQuote(defs, markets, owner, ship, port, r.id, src.gameSeconds);
          const due = hq.netCents - hq.overflowCents;
          const sold = hq.overflow.map(
            (l) => `${l.qty} CU ${defs.goods.get(l.good)?.name ?? l.good}`,
          );
          return {
            classId: r.id,
            name: r.name,
            tier: r.tier ?? 0,
            current,
            priceCents: hq.priceCents,
            tradeInCents: hq.tradeIn.totalCents,
            netCents: hq.netCents,
            stats: statsOf(r.id, current ? ship.upgrades : hq.tradeIn.moving),
            movingNames: hq.tradeIn.moving.map((id) => upgradeDefs().get(id)?.name ?? id),
            overflowText: sold.length
              ? `Won't fit: ${sold.join(', ')}, sold here for ${formatCents(hq.overflowCents)}`
              : undefined,
            refusal: current
              ? 'You sail her now'
              : hq.stuck
                ? "Contract or hot cargo won't fit her hold"
                : due > owner.purse
                  ? "You haven't the money."
                  : undefined,
          };
        })
      : [];

  const upgrades: UpgradeRow[] = [...upgradeDefs().values()]
    .filter((u) => u.sources.includes(place))
    .map((u) => {
      const price = upgradePriceCents(defs, port, u);
      const fitted = ship.upgrades.includes(u.id);
      const why = fitted ? undefined : fitRefusal(owner, ship, u, place, price);
      return {
        id: u.id,
        name: u.name,
        category: u.category,
        blurb: u.blurb,
        priceCents: price,
        hours: place === 'shipyard' ? u.installHours : 0,
        fitted,
        transferable: u.transferable,
        refundCents: Math.floor(u.priceCents * REMOVAL_REFUND),
        refusal: why ? (REFUSAL_TEXT[why] ?? why) : undefined,
      };
    });

  return {
    place,
    shipName: src.shipName,
    className: record.name,
    hull01: ship.hull01,
    rigging01: ship.rigging01,
    stats: statsOf(ship.classId, ship.upgrades),
    slots,
    repair,
    hulls,
    upgrades,
  };
}
