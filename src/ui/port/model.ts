import type { Good } from '../../../data/schemas/goods';
import { SECONDS_PER_GAME_DAY } from '../../core/time';
import type { PortService } from '../../../data/schemas/ports';
import { portInfo, type EconomyDefs } from '../../sim/economy/defs';
import { holdFree, holdUsed, isClean, paidPerCu, type CargoStack } from '../../sim/economy/hold';
import {
  ageText,
  bestKnownPurchase,
  bestKnownSale,
  STALE_WEEKS,
  weeksSince,
  type PriceKnowledge,
} from '../../sim/economy/knowledge';
import { quote, unitPrices, type MarketsState } from '../../sim/economy/market';
import {
  detectionChance,
  offerKind,
  riskWord,
  tooHotForReceiver,
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
import { isStale, reliabilityWord, rumorDefs, type SaloonTerms } from '../../sim/rumors/rumors';
import type { Rumor } from '../../sim/world-state';
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
  type ContractOutcome,
  type ContractsState,
  type Standing,
} from '../../sim/economy/contracts';
import type { ShipState } from '../../sim/shipyard/shipyard';
import { yardSnapshot, type YardSnapshot } from './shipyard-model';
import type { HarborSnapshot, LedgerLawSnapshot } from './harbor-model';

/**
 * What the port screen and the ledger show (plan 05 §12, plan 13 §5; Phase 4 piece B),
 * built from the sim when the screen opens and after every trade. The gameplay tick is
 * paused while either is open, so nothing else moves under them. The screens only read
 * these; buying and selling go back through the port's actions.
 */

export type PortTab =
  'market' | 'chandlery' | 'freight' | 'shipyard' | 'saloon' | 'harbor' | 'ledger';

/** The services with a tab, in order. Pieces F, G and K add the freight agent, shipyard and saloon. */
const SERVICE_TABS: readonly [PortService, PortTab][] = [
  ['market', 'market'],
  ['chandlery', 'chandlery'],
  ['freight', 'freight'],
  ['shipyard', 'shipyard'],
  ['tavern', 'saloon'],
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
  /** What a CU of it aboard cost you on average, cents, when you know. */
  heldPaidCents?: number | undefined;
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
  /** What a CU of the stack cost you on average, cents, when you know. */
  paidCents?: number | undefined;
  /** The stack's place in the hold, for offering it (rows are sorted). */
  index: number;
  /**
   * A hot or contraband lot can be offered to the port's merchants (piece H): the risk in a
   * word, and whether they've already turned you away this week.
   */
  offer?:
    | {
        kind: OfferKind;
        risk: string;
        turnedAway: boolean;
        /** You have a receiver here: no risk, a discount, and the hottest marked goods refused. */
        receiver: boolean;
        tooHot: boolean;
        /** With the law after you here, the risk your receiver turns you in (piece E). */
        informRisk?: string | undefined;
      }
    | undefined;
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
  /** Cash stashed at the hideouts (plan 05 §2; Phase 4 piece E): safe, but not to hand. */
  stashedCents?: number | undefined;
  tabs: PortTab[];
  capacity: number;
  usedCu: number;
  /** The speed the hold's load costs, 0–1 (plan 02 §3). */
  speedLoss: number;
  market: MarketRow[];
  hold: HoldRow[];
  stores: StoreRow[];
  /** The saloon (piece K), when the port has one. */
  saloon: SaloonSnapshot | undefined;
  /** The freight agent's tab, at a port that has one (piece F). */
  freight: FreightSnapshot | undefined;
  /** What happened on arriving: deliveries paid, failed cargo handed back. */
  notices: string[];
  /** The shipyard tab, and the chandlery's fittings and rigging repair (piece G). */
  shipyard: YardSnapshot | undefined;
  fittings: YardSnapshot | undefined;
  ledger: LedgerSnapshot;
  /** The harbor master's tab (Phase 5 piece E): fines, bribes and the poster. */
  harbor?: HarborSnapshot | undefined;
  /**
   * Waiting alongside (the footer's "Wait" choices): offered when the game can run the clock
   * on here; `waitRefusal` says why not just now (e.g. aground).
   */
  canWait?: boolean | undefined;
  waitRefusal?: string | undefined;
}

/** A rumor as the ledger and the saloon show it. */
export interface RumorRow {
  id: string;
  kind: string;
  text: string;
  age: string;
  /** "Likely: a deckhand", or "the Gogebic" for a hail. */
  from: string;
  /** "Reliable", "Likely", "Doubtful", "Tall tale". */
  word: string;
  /** Its time has passed: the ship's sailed, the weather's come. */
  stale: boolean;
  where: string;
}

export interface SaloonSnapshot extends SaloonTerms {
  /** Today's talk heard here, newest first. */
  heard: RumorRow[];
}

export interface LedgerPrice {
  buyCents: number;
  sellCents: number;
  age: string;
  stale: boolean;
  /** Heard from a rumor or a hail, not seen. */
  heard: boolean;
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
/** One stack of the hold, as the ledger lists it at sea. */
export interface LedgerHoldRow {
  name: string;
  qty: number;
  hot: boolean;
  /** Carried for a contract, and where it's bound. */
  contract: boolean;
  contractTo?: string | undefined;
  /** What a CU cost you on average, cents, when you know. */
  paidCents?: number | undefined;
}

export interface LedgerSnapshot {
  dateText: string;
  /** What's in the hold, with CU used and capacity. */
  hold: { rows: LedgerHoldRow[]; usedCu: number; capacity: number };
  /** Ports whose prices you know, nearest in time first. */
  ports: LedgerPort[];
  /** Goods with a known price somewhere, in trade-screen order. */
  goods: { id: string; name: string }[];
  prices: Record<string, Record<string, LedgerPrice>>;
  /** Ports where a merchant takes hot goods from you (piece H). */
  receivers: { id: string; text: string }[];
  /** Contracts in hand, then the last few finished (piece F). Piece K fills the rumors. */
  contracts: LedgerContractRow[];
  rumors: RumorRow[];
  /** Ports first, then companies; a company you stole from is marked. */
  standing: LedgerStandingRow[];
  /** Milestone ticks for standing bars (when contracts are loaded). */
  standingTicks: {
    port: { value: number; label: string }[];
    company: { value: number; label: string }[];
  };
  /** Fame, Wanted by region and the reports on their way (Phase 5 piece E). */
  law?: LedgerLawSnapshot | undefined;
}

/** One port or company on the ledger Standing tab. */
/** One contract on the ledger Contracts tab. */
export interface LedgerContractRow {
  id: string;
  done: boolean;
  kind: OfferRow['kind'];
  qty: number;
  cargo: string;
  fromName: string;
  toName: string;
  company: string;
  payCents: number;
  dueShort?: string | undefined;
  dueText?: string | undefined;
  status: 'active' | 'late' | 'failed' | ContractOutcome;
  week?: string | undefined;
}

export interface LedgerStandingRow {
  id: string;
  name: string;
  kind: 'port' | 'company';
  value: number;
  burned: boolean;
  word: string;
  perks: string[];
  next?: string | undefined;
  fence: boolean;
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
  /** Rumors heard (piece K), for the ledger and the saloon. */
  rumors?: readonly Rumor[];
  /** The saloon's terms here now, when it has one. */
  saloon?: SaloonTerms | undefined;
  /** Ports whose merchants turned you away this week (piece H). */
  refusals?: Refusals | undefined;
  /** Ports where you have a receiver (piece H). */
  receivers?: readonly string[] | undefined;
  contracts?: ContractSources | undefined;
  notices?: string[] | undefined;
  /** The player's ship and her name, for the shipyard and fittings (piece G). */
  ship?: { state: ShipState; name: string } | undefined;
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

/** A rumor for the screen: its words, age, teller and how far to trust it. */
export function rumorRow(r: Rumor, gameSeconds: number): RumorRow {
  const word = reliabilityWord(r.reliability);
  return {
    id: r.id,
    kind: rumorDefs().kinds[r.kind].label,
    text: r.text,
    age: ageText(r.heardAt, gameSeconds),
    from: r.source === 'hail' ? `Hailed ${r.teller ?? 'a ship'}` : `${word}: ${r.teller ?? 'talk'}`,
    word,
    stale: isStale(r, gameSeconds),
    where: r.port ? portName(r.port) : 'at sea',
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

export const CONTRACT_OUTCOME_WORD: Record<ContractOutcome, string> = {
  delivered: 'delivered',
  late: 'delivered late',
  failed: 'failed',
  abandoned: 'handed back',
  stolen: 'stolen',
};

function ledgerContracts(
  econ: EconomyDefs,
  c: ContractSources,
  gameSeconds: number,
): LedgerSnapshot['contracts'] {
  const out: LedgerSnapshot['contracts'] = [];
  for (const k of c.state.active) {
    const status: LedgerContractRow['status'] =
      k.status === 'failed' ? 'failed' : gameSeconds > k.dueAt ? 'late' : 'active';
    out.push({
      id: k.id,
      done: false,
      kind: k.kind,
      qty: k.qty,
      cargo: cargoName(econ, c.defs, k.good).toLowerCase(),
      fromName: portName(k.from),
      toName: portName(k.to),
      company: companyName(c.defs, k.company),
      payCents: k.payCents,
      dueShort: dueShort(k.dueAt, gameSeconds),
      dueText: dueText(k.dueAt, gameSeconds),
      status,
    });
  }
  for (const h of c.state.history) {
    out.push({
      id: `${h.id}:${h.outcome}`,
      done: true,
      kind: 'freight',
      qty: h.qty,
      cargo: cargoName(econ, c.defs, h.good).toLowerCase(),
      fromName: portName(h.from),
      toName: portName(h.to),
      company: companyName(c.defs, h.company),
      payCents: h.payCents,
      status: h.outcome,
      week: weekLabel(h.at),
    });
  }
  return out;
}

export function standingWord(value: number, burned: boolean): string {
  if (burned) return 'Burned';
  if (value >= 90) return 'Friend of the house';
  if (value >= 60) return 'Valued';
  if (value >= 30) return 'Trusted';
  if (value >= 10) return 'Known';
  return 'Stranger';
}

/** Milestone ticks on the 0–100 standing bar. */
export function standingBarTicks(
  defs: ContractDefs,
  kind: 'port' | 'company',
): { value: number; label: string }[] {
  const ticks = new Map<number, string>();
  if (kind === 'port') {
    ticks.set(defs.rules.depositHalfAt, 'Half deposits');
    ticks.set(defs.rules.depositWaivedAt, 'No deposit asked');
    for (const t of defs.templates) {
      if ((t.tier ?? 'open') === 'open' && t.minStanding > 0) {
        ticks.set(t.minStanding, 'Board contracts');
      }
    }
  } else {
    for (const t of defs.templates) {
      if (t.tier === 'company' && t.minStanding > 0) {
        ticks.set(t.minStanding, 'Better contracts');
      }
    }
  }
  return [...ticks.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([value, label]) => ({ value, label }));
}

function companyStandingPerks(defs: ContractDefs, value: number): string[] {
  const bonus = Math.round(defs.rules.standingPayBonus * value);
  return bonus > 0 ? [`+${bonus}% pay`] : [];
}

function minStandingThresholds(defs: ContractDefs, id: string): number[] {
  const isPort = id.startsWith('port.');
  const out = new Set<number>();
  for (const t of defs.templates) {
    if (t.minStanding <= 0) continue;
    if (isPort) {
      if ((t.tier ?? 'open') === 'open' && t.from.includes(id)) out.add(t.minStanding);
    } else if (t.tier === 'company' && t.company === id) out.add(t.minStanding);
  }
  return [...out].sort((a, b) => a - b);
}

function standingNext(
  defs: ContractDefs,
  id: string,
  value: number,
  kind: 'port' | 'company',
  burned: boolean,
): string | undefined {
  if (burned) return undefined;
  const thresholds: { at: number; label: string }[] = [];
  if (kind === 'port') {
    const r = defs.rules;
    thresholds.push({ at: r.depositHalfAt, label: 'half deposits' });
    thresholds.push({ at: r.depositWaivedAt, label: 'no deposit asked' });
    for (const at of minStandingThresholds(defs, id)) {
      thresholds.push({ at, label: 'board contracts' });
    }
  } else {
    for (const at of minStandingThresholds(defs, id)) {
      thresholds.push({ at, label: 'better contracts' });
    }
    const maxBonus = Math.round(defs.rules.standingPayBonus * 100);
    if (maxBonus > 0 && value < 100) {
      thresholds.push({ at: 100, label: `+${maxBonus}% pay` });
    }
  }
  thresholds.sort((a, b) => a.at - b.at);
  const next = thresholds.find((t) => t.at > value);
  return next ? `Next: ${next.label} at ${next.at}` : undefined;
}

function receiverStandingRows(receivers: readonly string[]): LedgerStandingRow[] {
  return receivers.map((id) => ({
    id,
    name: portName(id),
    kind: 'port' as const,
    value: 0,
    burned: false,
    word: standingWord(0, false),
    perks: [] as string[],
    fence: true,
  }));
}

function ledgerStanding(
  c: ContractSources,
  receivers: readonly string[] = [],
): LedgerSnapshot['standing'] {
  const fence = new Set(receivers);
  const ids = new Set([...Object.keys(c.standing), ...c.state.burned]);
  for (const id of receivers) ids.add(id);
  return [...ids]
    .map((id) => {
      const kind = id.startsWith('port.') ? ('port' as const) : ('company' as const);
      const burned = c.state.burned.includes(id);
      const value = burned ? 0 : Math.round(standingOf(c.standing, id));
      const perks =
        kind === 'port' ? standingPerks(c.defs, value) : companyStandingPerks(c.defs, value);
      return {
        id,
        name: kind === 'port' ? portName(id) : companyName(c.defs, id),
        kind,
        value,
        burned,
        word: standingWord(value, burned),
        perks,
        next: standingNext(c.defs, id, value, kind, burned),
        fence: fence.has(id),
      };
    })
    .sort(
      (a, b) =>
        Number(b.kind === 'port') - Number(a.kind === 'port') ||
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
  receivers?: readonly string[],
  rumors: readonly Rumor[] = [],
  held?: { cargo: readonly CargoStack[]; capacity: number },
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
        heard: !!p.heard,
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
  const holdRows: LedgerHoldRow[] = (held?.cargo ?? []).map((s) => {
    const k = s.contract ? contracts?.state.active.find((x) => x.id === s.contract) : undefined;
    const paid = paidPerCu(s);
    return {
      name: contracts
        ? cargoName(defs, contracts.defs, s.good)
        : (defs.goods.get(s.good)?.name ?? s.good),
      qty: s.qty,
      hot: !!s.hot,
      contract: !!s.contract,
      contractTo: k ? portName(k.to) : undefined,
      paidCents: paid === undefined ? undefined : Math.round(paid),
    };
  });
  return {
    dateText: weekLabel(gameSeconds),
    hold: {
      rows: holdRows,
      usedCu: holdUsed(held?.cargo ?? []),
      capacity: held?.capacity ?? 0,
    },
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
    receivers: (receivers ?? []).map((id) => ({
      id,
      text: `${portName(id)}: a merchant who asks no questions`,
    })),
    contracts: contracts ? ledgerContracts(defs, contracts, gameSeconds) : [],
    rumors: rumors.map((r) => rumorRow(r, gameSeconds)),
    standing: contracts
      ? ledgerStanding(contracts, receivers)
      : receiverStandingRows(receivers ?? []),
    standingTicks: contracts
      ? {
          port: standingBarTicks(contracts.defs, 'port'),
          company: standingBarTicks(contracts.defs, 'company'),
        }
      : { port: [], company: [] },
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
      (tab !== 'saloon' || !!src.saloon) &&
      (tab !== 'freight' || !!src.contracts),
  ).map(([, tab]) => tab);
  const rumors = src.rumors ?? [];
  const today = Math.floor(gameSeconds / SECONDS_PER_GAME_DAY);
  tabs.push('ledger');

  const cleanHeld = new Map<string, number>();
  const cleanPaid = new Map<string, number>();
  for (const s of trader.cargo) {
    if (!isClean(s)) continue;
    cleanHeld.set(s.good, (cleanHeld.get(s.good) ?? 0) + s.qty);
    const paid = paidPerCu(s);
    if (paid !== undefined) cleanPaid.set(s.good, Math.round(paid));
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
        heldPaidCents: cleanPaid.get(good),
        maxBuy: maxBuyable(defs, markets, trader, capacity, port, good, gameSeconds),
        role: mg.role,
        bestSale: elsewhere(sale, sale?.sellCents, gameSeconds),
        bestPurchase: elsewhere(purchase, purchase?.buyCents, gameSeconds),
      });
    }
  }

  const receiver = src.receivers?.includes(port) ?? false;
  const turnedAway = !receiver && src.refusals?.[port] === weekOf(gameSeconds);
  const hold: HoldRow[] = trader.cargo
    .map((s: CargoStack, index): HoldRow => {
      const traded = pm?.goods.has(s.good) ?? false;
      const kind = offerKind(defs, s);
      // A trade-only port (Red Cliff) takes no hot goods or contraband: no Offer button.
      const offerable = !!pm && !info?.tradeOnly && !!kind && (kind === 'contraband' || traded);
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
        paidCents: paidPerCu(s) === undefined ? undefined : Math.round(paidPerCu(s) as number),
        index,
        offer:
          offerable && kind
            ? {
                kind,
                risk: riskWord(detectionChance(defs, s, port, gameSeconds)),
                turnedAway,
                receiver,
                tooHot: receiver && tooHotForReceiver(s, gameSeconds),
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

  const yard = (place: 'shipyard' | 'chandlery'): YardSnapshot | undefined =>
    src.ship && services.includes(place)
      ? yardSnapshot({
          defs,
          markets,
          owner: trader,
          ship: src.ship.state,
          shipName: src.ship.name,
          port,
          place,
          gameSeconds,
        })
      : undefined;

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
    saloon:
      src.saloon && tabs.includes('saloon')
        ? {
            ...src.saloon,
            heard: rumors
              .filter(
                (r) =>
                  r.source === 'saloon' &&
                  r.port === port &&
                  Math.floor(r.heardAt / SECONDS_PER_GAME_DAY) === today,
              )
              .map((r) => rumorRow(r, gameSeconds)),
          }
        : undefined,
    freight: src.contracts ? freightSnapshot(src, src.contracts, services) : undefined,
    notices: src.notices ?? [],
    shipyard: yard('shipyard'),
    fittings: yard('chandlery'),
    ledger: ledgerSnapshot(defs, knowledge, gameSeconds, src.contracts, src.receivers, rumors, {
      cargo: trader.cargo,
      capacity,
    }),
  };
}
