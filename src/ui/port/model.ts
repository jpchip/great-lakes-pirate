import type { Good } from '../../../data/schemas/goods';
import type { PortService } from '../../../data/schemas/ports';
import { portInfo, type EconomyDefs } from '../../sim/economy/defs';
import { holdUsed, isClean, type CargoStack } from '../../sim/economy/hold';
import {
  ageText,
  bestKnownPurchase,
  bestKnownSale,
  STALE_WEEKS,
  weeksSince,
  type PriceKnowledge,
} from '../../sim/economy/knowledge';
import { unitPrices, type MarketsState } from '../../sim/economy/market';
import {
  detectionChance,
  offerKind,
  riskWord,
  weekOf,
  type OfferKind,
  type Refusals,
} from '../../sim/economy/contraband';
import {
  storeItems,
  storePriceCents,
  storeRoom,
  type ShipStores,
} from '../../sim/economy/chandlery';
import { maxBuyable, type Trader } from '../../sim/economy/trade';
import { weekLabel } from '../hud/model';

/**
 * What the port screen and the ledger show (plan 05 §12, plan 13 §5; Phase 4 piece B),
 * built from the sim when the screen opens and after every trade. The gameplay tick is
 * paused while either is open, so nothing else moves under them. The screens only read
 * these; buying and selling go back through the port's actions.
 */

export type PortTab = 'market' | 'chandlery' | 'ledger';

/** The services with a tab, in order. Pieces F, G and K add the freight agent, shipyard and saloon. */
const SERVICE_TABS: readonly [PortService, PortTab][] = [
  ['market', 'market'],
  ['chandlery', 'chandlery'],
];

/** The trade screen sorts by the plan 05 §3 grouping, then by name. */
const CATEGORY_ORDER: readonly Good['category'][] = [
  'bulk',
  'provisions',
  'manufactured',
  'high_value',
  'contraband',
];

export const CATEGORY_LABELS: Record<Good['category'], string> = {
  bulk: 'Bulk',
  provisions: 'Provisions',
  manufactured: 'Manufactured',
  high_value: 'High value',
  contraband: 'Contraband',
};

/** A price you saw at another port. */
export interface ElsewhereSnapshot {
  portName: string;
  cents: number;
  age: string;
  stale: boolean;
}

export interface MarketRow {
  good: string;
  name: string;
  category: Good['category'];
  /** The next CU's price each way: what you pay, what you get. */
  buyCents: number;
  sellCents: number;
  /** Whole CU the port has to sell. */
  stock: number;
  /** Clean CU of it in the hold: what you can sell here. */
  held: number;
  maxBuy: number;
  /** Cheap here (an export) or dear (an import): a hint, not a promise. */
  role: 'export' | 'neutral' | 'import';
  /** The best price you know of to sell it elsewhere, and the cheapest to buy it. */
  bestSale: ElsewhereSnapshot | undefined;
  bestPurchase: ElsewhereSnapshot | undefined;
}

export interface HoldRow {
  good: string;
  name: string;
  qty: number;
  /** Taken by crime (plan 05 §6.1): the ember mark, and no honest sale. */
  hot: boolean;
  /** A freight contract's cargo (piece F). */
  contract: boolean;
  /** What a CU fetches here, when this port buys it and it's clean. */
  sellCents: number | undefined;
  /** The stack's place in the hold, for offering it (rows are sorted). */
  index: number;
  /**
   * A hot or contraband lot can be offered to the port's merchants (piece H): the risk in a
   * word, and whether they've already turned you away this week.
   */
  offer?: { kind: OfferKind; risk: string; turnedAway: boolean } | undefined;
}

export interface StoreRow {
  id: string;
  name: string;
  blurb: string;
  priceCents: number;
  have: number;
  max: number;
  /** How many more you can buy: locker room and purse. */
  maxBuy: number;
}

export interface PortSnapshot {
  port: string;
  portName: string;
  dateText: string;
  purseCents: number;
  tabs: PortTab[];
  capacity: number;
  usedCu: number;
  /** The speed the hold's load costs, 0–1 (plan 02 §3). */
  speedLoss: number;
  market: MarketRow[];
  hold: HoldRow[];
  stores: StoreRow[];
  ledger: LedgerSnapshot;
}

export interface LedgerPrice {
  buyCents: number;
  sellCents: number;
  age: string;
  stale: boolean;
}

export interface LedgerPort {
  id: string;
  name: string;
  /** "Wk of May 7, 1900", when last seen. */
  seenText: string;
  age: string;
  stale: boolean;
}

/** The ledger in journal v1 (plan 05 §12, plan 13 §5): prices, contracts, rumors, Standing. */
export interface LedgerSnapshot {
  dateText: string;
  /** Ports whose prices you know, nearest in time first. */
  ports: LedgerPort[];
  /** Goods with a known price somewhere, in trade-screen order. */
  goods: { id: string; name: string }[];
  prices: Record<string, Record<string, LedgerPrice>>;
  /** Pieces F and K fill these. */
  contracts: { id: string; text: string }[];
  rumors: { id: string; text: string; age: string }[];
  standing: { id: string; name: string; value: number }[];
}

export interface PortSources {
  defs: EconomyDefs;
  markets: MarketsState;
  knowledge: PriceKnowledge;
  trader: Trader & { stores: ShipStores };
  capacity: number;
  load01: number;
  cargoSpeedLoss: number;
  port: string;
  gameSeconds: number;
  /** Ports whose merchants turned you away this week (piece H). */
  refusals?: Refusals | undefined;
}

const portName = (id: string): string => portInfo(id)?.name ?? id;

function goodOrder(defs: EconomyDefs): (a: string, b: string) => number {
  return (a, b) => {
    const ga = defs.goods.get(a);
    const gb = defs.goods.get(b);
    if (!ga || !gb) return a.localeCompare(b);
    return (
      CATEGORY_ORDER.indexOf(ga.category) - CATEGORY_ORDER.indexOf(gb.category) ||
      ga.name.localeCompare(gb.name)
    );
  };
}

function elsewhere(
  seen: { port: string; seenAt: number } | undefined,
  cents: number | undefined,
  gameSeconds: number,
): ElsewhereSnapshot | undefined {
  if (!seen || cents === undefined) return undefined;
  return {
    portName: portName(seen.port),
    cents,
    age: ageText(seen.seenAt, gameSeconds),
    stale: weeksSince(seen.seenAt, gameSeconds) >= STALE_WEEKS,
  };
}

export function ledgerSnapshot(
  defs: EconomyDefs,
  knowledge: PriceKnowledge,
  gameSeconds: number,
): LedgerSnapshot {
  const ports: (LedgerPort & { seenAt: number })[] = [];
  const goods = new Set<string>();
  const prices: LedgerSnapshot['prices'] = {};
  for (const [port, book] of Object.entries(knowledge)) {
    let seenAt = -Infinity;
    const row: Record<string, LedgerPrice> = {};
    for (const [good, p] of Object.entries(book)) {
      goods.add(good);
      seenAt = Math.max(seenAt, p.seenAt);
      row[good] = {
        buyCents: p.buyCents,
        sellCents: p.sellCents,
        age: ageText(p.seenAt, gameSeconds),
        stale: weeksSince(p.seenAt, gameSeconds) >= STALE_WEEKS,
      };
    }
    if (!Number.isFinite(seenAt)) continue;
    prices[port] = row;
    ports.push({
      id: port,
      name: portName(port),
      seenAt,
      seenText: weekLabel(seenAt),
      age: ageText(seenAt, gameSeconds),
      stale: weeksSince(seenAt, gameSeconds) >= STALE_WEEKS,
    });
  }
  ports.sort((a, b) => b.seenAt - a.seenAt || a.name.localeCompare(b.name));
  return {
    dateText: weekLabel(gameSeconds),
    ports: ports.map((p) => ({
      id: p.id,
      name: p.name,
      seenText: p.seenText,
      age: p.age,
      stale: p.stale,
    })),
    goods: [...goods]
      .sort(goodOrder(defs))
      .map((id) => ({ id, name: defs.goods.get(id)?.name ?? id })),
    prices,
    contracts: [],
    rumors: [],
    standing: [],
  };
}

export function portSnapshot(src: PortSources): PortSnapshot {
  const { defs, markets, knowledge, trader, capacity, port, gameSeconds } = src;
  const info = portInfo(port);
  const pm = defs.markets.get(port);
  const services = info?.services ?? [];
  const tabs: PortTab[] = SERVICE_TABS.filter(
    ([service, tab]) => services.includes(service) && (tab !== 'market' || !!pm),
  ).map(([, tab]) => tab);
  tabs.push('ledger');

  const cleanHeld = new Map<string, number>();
  for (const s of trader.cargo) {
    if (isClean(s)) cleanHeld.set(s.good, (cleanHeld.get(s.good) ?? 0) + s.qty);
  }

  const market: MarketRow[] = [];
  if (pm) {
    for (const good of [...pm.goods.keys()].sort(goodOrder(defs))) {
      const mg = pm.goods.get(good);
      const p = unitPrices(defs, markets, port, good, gameSeconds);
      if (!mg || !p) continue;
      const sale = bestKnownSale(knowledge, good, port);
      const purchase = bestKnownPurchase(knowledge, good, port);
      market.push({
        good,
        name: mg.good.name,
        category: mg.good.category,
        buyCents: p.buyCents,
        sellCents: p.sellCents,
        stock: Math.floor(markets[port]?.[good]?.stock ?? 0),
        held: cleanHeld.get(good) ?? 0,
        maxBuy: maxBuyable(defs, markets, trader, capacity, port, good, gameSeconds),
        role: mg.role,
        bestSale: elsewhere(sale, sale?.sellCents, gameSeconds),
        bestPurchase: elsewhere(purchase, purchase?.buyCents, gameSeconds),
      });
    }
  }

  const turnedAway = src.refusals?.[port] === weekOf(gameSeconds);
  const hold: HoldRow[] = trader.cargo
    .map((s: CargoStack, index): HoldRow => {
      const traded = pm?.goods.has(s.good) ?? false;
      const kind = offerKind(defs, s);
      const offerable = !!pm && !!kind && (kind === 'contraband' || traded);
      const sell =
        traded && isClean(s)
          ? unitPrices(defs, markets, port, s.good, gameSeconds)?.sellCents
          : undefined;
      return {
        good: s.good,
        name: defs.goods.get(s.good)?.name ?? s.good,
        qty: s.qty,
        hot: !!s.hot,
        contract: !!s.contract,
        sellCents: sell,
        index,
        offer:
          offerable && kind
            ? {
                kind,
                risk: riskWord(detectionChance(defs, s, port, gameSeconds)),
                turnedAway,
              }
            : undefined,
      };
    })
    .sort((a, b) => goodOrder(defs)(a.good, b.good) || Number(a.hot) - Number(b.hot));

  const stores: StoreRow[] = services.includes('chandlery')
    ? storeItems().map((item) => {
        const price = storePriceCents(defs, port, item);
        return {
          id: item.id,
          name: item.name,
          blurb: item.blurb,
          priceCents: price,
          have: trader.stores[item.id] ?? 0,
          max: item.max,
          maxBuy: Math.min(storeRoom(trader.stores, item), Math.floor(trader.purse / price)),
        };
      })
    : [];

  return {
    port,
    portName: info?.name ?? port,
    dateText: weekLabel(gameSeconds),
    purseCents: trader.purse,
    tabs,
    capacity,
    usedCu: holdUsed(trader.cargo),
    speedLoss: src.load01 * src.cargoSpeedLoss,
    market,
    hold,
    stores,
    ledger: ledgerSnapshot(defs, knowledge, gameSeconds),
  };
}
