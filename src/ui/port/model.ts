import type { Good } from '../../../data/schemas/goods';
import type { PortService } from '../../../data/schemas/ports';
import { portInfo, type EconomyDefs } from '../../sim/economy/defs';
import { holdUsed, isClean, type CargoStack } from '../../sim/economy/hold';
import {
  ageText,
  formatCents,
  bestKnownPurchase,
  bestKnownSale,
  STALE_WEEKS,
  weeksSince,
  type PriceKnowledge,
} from '../../sim/economy/knowledge';
import { quote, unitPrices, type MarketsState } from '../../sim/economy/market';
import {
  storeItems,
  storePriceCents,
  storeRoom,
  type ShipStores,
} from '../../sim/economy/chandlery';
import { maxBuyable, type Trader } from '../../sim/economy/trade';
import { clockLabel, weekLabel } from '../hud/model';
import {
  cargoName,
  companyName,
  contractCargo,
  depositCredit,
  shipyardDiscount,
  standingOf,
  type BoardOffer,
  type ContractDefs,
  type ContractsState,
  type Standing,
} from '../../sim/economy/contracts';
import { holdFree } from '../../sim/economy/hold';

/**
 * What the port screen and the ledger show (plan 05 §12, plan 13 §5; Phase 4 piece B),
 * built from the sim when the screen opens and after every trade. The gameplay tick is
 * paused while either is open, so nothing else moves under them. The screens only read
 * these; buying and selling go back through the port's actions.
 */

export type PortTab = 'market' | 'chandlery' | 'freight' | 'ledger';

/** The services with a tab, in order. Pieces G and K add the shipyard and saloon. */
const SERVICE_TABS: readonly [PortService, PortTab][] = [
  ['market', 'market'],
  ['chandlery', 'chandlery'],
  ['freight', 'freight'],
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
  /** Its contract, and where it's bound. */
  contractId?: string | undefined;
  contractTo?: string | undefined;
  /** What selling it here would fetch: the theft (plan 05 §5.2). Undefined when it can't. */
  stealCents?: number | undefined;
  /** What a CU fetches here, when this port buys it and it's clean. */
  sellCents: number | undefined;
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

/** An offer on the freight agent's board (plan 05 §5.2, plan 13 §5 contracts board). */
export interface OfferRow {
  id: string;
  company: string;
  kind: 'freight' | 'rush' | 'mail' | 'fragile';
  /** A company's own business, on Standing with it. */
  companyTier: boolean;
  toName: string;
  cargo: string;
  qty: number;
  payCents: number;
  depositCents: number;
  /** "by 18:00, Wk of May 14 (in 14 h)" if taken now, and the short form, "due in 34 h". */
  dueText: string;
  dueShort: string;
  note: string;
  /** Why it can't be taken now; undefined when it can. */
  blocked: string | undefined;
  /** It needs more Standing: a teaser of what Standing opens. */
  locked: boolean;
}

/** A contract in hand. */
export interface HeldContractRow {
  id: string;
  company: string;
  kind: OfferRow['kind'];
  fromName: string;
  toName: string;
  cargo: string;
  qty: number;
  aboard: number;
  payCents: number;
  depositCents: number;
  dueText: string;
  dueShort: string;
  /** Late: inside the late window, half pay. Failed: past it, cargo to hand back. */
  status: 'onTime' | 'late' | 'failed';
  /** Fragile knocks taken, each a quarter of the pay. */
  hits: number;
}

export interface FreightSnapshot {
  offers: OfferRow[];
  held: HeldContractRow[];
  /** Standing with this port, and what it opens now. */
  portStanding: number;
  perks: string[];
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
  /** The freight agent's tab, at a port that has one (piece F). */
  freight: FreightSnapshot | undefined;
  /** What happened on arriving: deliveries paid, failed cargo handed back. */
  notices: string[];
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
  /** Contracts in hand, then the last few finished (piece F). Piece K fills the rumors. */
  contracts: { id: string; text: string; done: boolean }[];
  rumors: { id: string; text: string; age: string }[];
  /** Ports first, then companies; a company you stole from is marked. */
  standing: { id: string; name: string; value: number; burned: boolean }[];
}

/** What the contract parts of the screens read. */
export interface ContractSources {
  defs: ContractDefs;
  state: ContractsState;
  standing: Standing;
  /** The board at the open port, priced for this captain. */
  board?: readonly BoardOffer[];
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
  contracts?: ContractSources | undefined;
  notices?: string[] | undefined;
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

/** "due in 34 h", or "overdue". */
export function dueShort(dueAt: number, gameSeconds: number): string {
  const hours = Math.ceil((dueAt - gameSeconds) / 3600);
  return hours > 0 ? `due in ${hours} h` : 'overdue';
}

/** "by 18:00, Wk of May 14 (in 14 h)"; "overdue" once past. */
export function dueText(dueAt: number, gameSeconds: number): string {
  const hours = Math.ceil((dueAt - gameSeconds) / 3600);
  const left = hours > 0 ? `in ${hours} h` : 'overdue';
  return `by ${clockLabel(dueAt)}, ${weekLabel(dueAt)} (${left})`;
}

const KIND_WORD: Record<OfferRow['kind'], string> = {
  freight: '',
  rush: 'Rush: ',
  mail: 'Mail: ',
  fragile: 'Fragile: ',
};

const OUTCOME_WORD = {
  delivered: 'delivered',
  late: 'delivered late',
  failed: 'failed',
  abandoned: 'handed back',
  stolen: 'stolen',
} as const;

function ledgerContracts(
  econ: EconomyDefs,
  c: ContractSources,
  gameSeconds: number,
): LedgerSnapshot['contracts'] {
  const out: LedgerSnapshot['contracts'] = [];
  for (const k of c.state.active) {
    const what = `${KIND_WORD[k.kind]}${k.qty} CU of ${cargoName(econ, c.defs, k.good).toLowerCase()}`;
    const route = `${portName(k.from)} → ${portName(k.to)} for ${companyName(c.defs, k.company)}`;
    const when =
      k.status === 'failed'
        ? 'failed: hand the cargo back at a freight agent'
        : `${dueText(k.dueAt, gameSeconds)}, pays ${formatCents(k.payCents)}`;
    out.push({ id: k.id, text: `${what}, ${route}, ${when}`, done: false });
  }
  for (const h of c.state.history) {
    const what = `${h.qty} CU of ${cargoName(econ, c.defs, h.good).toLowerCase()}`;
    const paid = h.payCents > 0 ? `, ${formatCents(h.payCents)}` : '';
    out.push({
      id: `${h.id}:${h.outcome}`,
      text: `${weekLabel(h.at)}: ${what}, ${portName(h.from)} → ${portName(h.to)} for ${companyName(c.defs, h.company)}, ${OUTCOME_WORD[h.outcome]}${paid}`,
      done: true,
    });
  }
  return out;
}

function ledgerStanding(c: ContractSources): LedgerSnapshot['standing'] {
  const ids = new Set([...Object.keys(c.standing), ...c.state.burned]);
  return [...ids]
    .map((id) => ({
      id,
      name: id.startsWith('port.') ? portName(id) : companyName(c.defs, id),
      value: Math.round(standingOf(c.standing, id)),
      burned: c.state.burned.includes(id),
    }))
    .sort(
      (a, b) =>
        Number(b.id.startsWith('port.')) - Number(a.id.startsWith('port.')) ||
        b.value - a.value ||
        a.name.localeCompare(b.name),
    );
}

/** What this port's Standing opens now (plan 05 §5.2), in a few words each. */
export function standingPerks(defs: ContractDefs, value: number): string[] {
  const perks: string[] = [];
  const credit = depositCredit(defs.rules, value);
  if (credit === 0) perks.push('No deposit asked');
  else if (credit < 1) perks.push('Half deposits');
  const bonus = Math.round(defs.rules.standingPayBonus * value);
  if (bonus > 0) perks.push(`+${bonus}% pay`);
  const discount = Math.round(shipyardDiscount(value, defs.rules) * 100);
  if (discount > 0) perks.push(`${discount}% off at the shipyard`);
  return perks;
}

export function ledgerSnapshot(
  defs: EconomyDefs,
  knowledge: PriceKnowledge,
  gameSeconds: number,
  contracts?: ContractSources,
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
    contracts: contracts ? ledgerContracts(defs, contracts, gameSeconds) : [],
    rumors: [],
    standing: contracts ? ledgerStanding(contracts) : [],
  };
}

function freightSnapshot(
  src: PortSources,
  c: ContractSources,
  services: readonly PortService[],
): FreightSnapshot | undefined {
  if (!services.includes('freight')) return undefined;
  const { defs: econ, trader, capacity, port, gameSeconds } = src;
  const free = holdFree(trader.cargo, capacity);
  const offers: OfferRow[] = (c.board ?? []).map(({ terms: t, locked }) => {
    let blocked: string | undefined;
    if (locked) {
      const who = locked.with.startsWith('port.')
        ? portName(locked.with)
        : (c.defs.companies.get(locked.with)?.short ?? locked.with);
      blocked = `Needs Standing ${locked.need} with ${who}`;
    } else if (free < t.qty) blocked = 'No room';
    else if (trader.purse < t.depositCents) blocked = 'No deposit';
    return {
      id: t.id,
      company: companyName(c.defs, t.company),
      kind: t.kind,
      companyTier: t.tier === 'company',
      toName: portName(t.to),
      cargo: cargoName(econ, c.defs, t.good),
      qty: t.qty,
      payCents: t.payCents,
      depositCents: t.depositCents,
      dueText: dueText(gameSeconds + t.allowSeconds, gameSeconds),
      dueShort: dueShort(gameSeconds + t.allowSeconds, gameSeconds),
      note: t.note,
      blocked,
      locked: !!locked,
    };
  });
  const held: HeldContractRow[] = c.state.active.map((k) => ({
    id: k.id,
    company: companyName(c.defs, k.company),
    kind: k.kind,
    fromName: portName(k.from),
    toName: portName(k.to),
    cargo: cargoName(econ, c.defs, k.good),
    qty: k.qty,
    aboard: contractCargo(trader.cargo, k.id),
    payCents: k.payCents,
    depositCents: k.depositCents,
    dueText: dueText(k.dueAt, gameSeconds),
    dueShort: dueShort(k.dueAt, gameSeconds),
    status: k.status === 'failed' ? 'failed' : gameSeconds > k.dueAt ? 'late' : 'onTime',
    hits: k.hits,
  }));
  const value = Math.round(standingOf(c.standing, port));
  return { offers, held, portStanding: value, perks: standingPerks(c.defs, value) };
}

export function portSnapshot(src: PortSources): PortSnapshot {
  const { defs, markets, knowledge, trader, capacity, port, gameSeconds } = src;
  const info = portInfo(port);
  const pm = defs.markets.get(port);
  const services = info?.services ?? [];
  const tabs: PortTab[] = SERVICE_TABS.filter(
    ([service, tab]) =>
      services.includes(service) &&
      (tab !== 'market' || !!pm) &&
      (tab !== 'freight' || !!src.contracts),
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

  const hold: HoldRow[] = trader.cargo
    .map((s: CargoStack) => {
      const traded = pm?.goods.has(s.good) ?? false;
      const sell =
        traded && isClean(s)
          ? unitPrices(defs, markets, port, s.good, gameSeconds)?.sellCents
          : undefined;
      const c = src.contracts;
      const k = s.contract ? c?.state.active.find((x) => x.id === s.contract) : undefined;
      return {
        good: s.good,
        name: c ? cargoName(defs, c.defs, s.good) : (defs.goods.get(s.good)?.name ?? s.good),
        qty: s.qty,
        hot: !!s.hot,
        contract: !!s.contract,
        contractId: s.contract,
        contractTo: k ? portName(k.to) : undefined,
        stealCents:
          k && traded && k.to !== port
            ? quote(defs, markets, port, s.good, s.qty, 'sell', gameSeconds).totalCents
            : undefined,
        sellCents: sell,
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
    freight: src.contracts ? freightSnapshot(src, src.contracts, services) : undefined,
    notices: src.notices ?? [],
    ledger: ledgerSnapshot(defs, knowledge, gameSeconds, src.contracts),
  };
}
