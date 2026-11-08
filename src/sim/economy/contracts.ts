import contractsJson from '../../../data/contracts.json';
import factionsJson from '../../../data/factions.json';
import {
  contractsFileSchema,
  PARCELS,
  type ContractKind,
  type ContractTemplate,
  type ContractTier,
  type Parcel,
} from '../../../data/schemas/contracts';
import { factionsFileSchema, type Faction } from '../../../data/schemas/factions';
import { Rng } from '../../core/rng';
import { gameEconomy, portInfo, seasonAt, type EconomyDefs } from './defs';
import { addToHold, holdFree, type CargoStack, type Hold } from './hold';
import { applyTrade, quote, type MarketsState } from './market';
import { defaultContractRules, type ContractRules } from './contract-rules';
import type { PassageTable } from './passages';
import type { TradeCompletedEvent } from './trade';

/**
 * Freight contracts and Standing (plan 05 §5.2; Phase 4 piece F).
 *
 * Each port with a freight agent posts a **board** of offers, drawn fresh every half game
 * day from the templates that leave from it and are in season. A board is a pure function
 * of the run's seed, the port and the board's number, like the traffic's manifests, so
 * nothing about it is saved but which offers were taken. Pay and the deadline follow from
 * the passage; the deposit is a third of the pay, less with the port's credit.
 *
 * Taking a contract loads its cargo into the hold, marked with the contract's id, and pays
 * the deposit. Docking at the destination delivers it: the pay and the deposit back, and
 * Standing with the offering port, the destination and the shipper. Late inside the late
 * window pays half and costs Standing; past it the contract fails, the deposit is lost and
 * the cargo is handed back at the next freight agent. Selling contract cargo is theft
 * (the Seavey temptation): it pays the market price once, and the shipper drops to
 * Standing 0 and never offers you another contract.
 *
 * Standing (0–100 per port and company) unlocks better contracts (higher-tier templates
 * and more pay), credit for deposits, and shipyard discounts (piece G reads
 * `shipyardDiscount`).
 */

/** Standing by port or company id, 0–100 (plan 05 §11 `player.standing`). */
export type Standing = Record<string, number>;

/** An offer's terms, as the board shows them and as they bind once taken. */
export interface ContractTerms {
  /** `${port}#${board}#${slot}`: unique for the run. */
  id: string;
  template: string;
  company: string;
  kind: ContractKind;
  tier: ContractTier;
  from: string;
  to: string;
  /** A good id or a parcel id (the mail). */
  good: string;
  qty: number;
  payCents: number;
  depositCents: number;
  /** Game seconds from taking it to the due time, and the late window after that. */
  allowSeconds: number;
  lateSeconds: number;
  note: string;
}

export interface Contract extends ContractTerms {
  acceptedAt: number;
  dueAt: number;
  /** Past this the contract has failed. */
  expiresAt: number;
  /** `failed`: expired, with its cargo still aboard to hand back. */
  status: 'active' | 'failed';
  /** Hard knocks taken with fragile cargo aboard. */
  hits: number;
}

export type ContractOutcome = 'delivered' | 'late' | 'failed' | 'abandoned' | 'stolen';

/** A finished contract, for the ledger. */
export interface ContractRecord {
  id: string;
  company: string;
  from: string;
  to: string;
  good: string;
  qty: number;
  outcome: ContractOutcome;
  at: number;
  /** What it paid: the pay on delivery, the market's price on theft, otherwise 0. */
  payCents: number;
}

/** The contracts slice (plan 05 §11 `contracts.active[]`). */
export interface ContractsState {
  active: Contract[];
  /** Offer ids taken from boards still posted, so they don't show again. */
  taken: string[];
  /** Companies whose cargo you stole: they never offer you a contract again. */
  burned: string[];
  history: ContractRecord[];
  tally: Record<ContractOutcome, number>;
}

/** The captain's side of a contract: the purse, the hold and Standing. */
export interface ContractCaptain {
  purse: number;
  cargo: Hold;
  standing: Standing;
}

export interface ContractDefs {
  rules: ContractRules;
  templates: readonly ContractTemplate[];
  /** Templates by the port that offers them. */
  byOrigin: ReadonlyMap<string, readonly ContractTemplate[]>;
  parcels: ReadonlyMap<string, Parcel>;
  companies: ReadonlyMap<string, Faction>;
}

// Events (plan 05 §11: `ContractAccepted/Completed/Failed/Stolen`).
export interface ContractAcceptedEvent {
  contractId: string;
  from: string;
  to: string;
  company: string;
  good: string;
  qty: number;
  depositCents: number;
  dueAt: number;
}
export interface ContractCompletedEvent {
  contractId: string;
  from: string;
  to: string;
  company: string;
  good: string;
  qty: number;
  payCents: number;
  late: boolean;
  /** When it was taken and due (the papers' record runs, Phase 5 piece F). */
  acceptedAt?: number;
  dueAt?: number;
}
export interface ContractFailedEvent {
  contractId: string;
  from: string;
  to: string;
  company: string;
  reason: 'expired' | 'abandoned';
}
/** Raised for Phase 5's Wanted: contract theft is always traced (plan 06 §2). */
export interface ContractStolenEvent {
  contractId: string;
  from: string;
  to: string;
  company: string;
  port: string;
  good: string;
  qty: number;
  totalCents: number;
}

export function createContractsState(): ContractsState {
  return {
    active: [],
    taken: [],
    burned: [],
    history: [],
    tally: { delivered: 0, late: 0, failed: 0, abandoned: 0, stolen: 0 },
  };
}

export function compileContracts(
  templates: readonly ContractTemplate[],
  factions: readonly Faction[],
  econ: EconomyDefs,
  rules: ContractRules = defaultContractRules(),
): ContractDefs {
  const parcels = new Map(PARCELS.map((p) => [p.id, p]));
  const companies = new Map(factions.map((f) => [f.id, f]));
  const byOrigin = new Map<string, ContractTemplate[]>();
  for (const t of templates) {
    if (!companies.has(t.company)) throw new Error(`${t.id}: unknown company ${t.company}`);
    for (const g of t.goods) {
      if (!econ.goods.has(g) && !parcels.has(g)) throw new Error(`${t.id}: unknown cargo ${g}`);
    }
    for (const p of [...t.from, ...t.to]) {
      if (!portInfo(p)) throw new Error(`${t.id}: unknown port ${p}`);
    }
    for (const p of t.from) {
      if (!portInfo(p)?.services.includes('freight')) {
        throw new Error(`${t.id}: ${p} has no freight agent`);
      }
      const list = byOrigin.get(p) ?? [];
      list.push(t);
      byOrigin.set(p, list);
    }
  }
  return { rules, templates, byOrigin, parcels, companies };
}

let cached: ContractDefs | undefined;

/** The game's contracts from `data/contracts.json` and `data/factions.json`. */
export function gameContracts(): ContractDefs {
  cached ??= compileContracts(
    contractsFileSchema.parse(contractsJson),
    factionsFileSchema.parse(factionsJson),
    gameEconomy(),
  );
  return cached;
}

/** The name of a cargo: a good's, or a parcel's (the mail). */
export function cargoName(econ: EconomyDefs, contracts: ContractDefs, id: string): string {
  return econ.goods.get(id)?.name ?? contracts.parcels.get(id)?.name ?? id;
}

export function companyName(contracts: ContractDefs, id: string): string {
  return contracts.companies.get(id)?.name ?? id;
}

// --- Standing -------------------------------------------------------------------------

export function standingOf(standing: Standing, id: string): number {
  return standing[id] ?? 0;
}

/** Moves Standing within 0–100. A burned company stays at 0 for good. */
export function adjustStanding(
  standing: Standing,
  state: ContractsState,
  id: string,
  delta: number,
): void {
  if (state.burned.includes(id)) {
    standing[id] = 0;
    return;
  }
  standing[id] = Math.max(0, Math.min(100, standingOf(standing, id) + delta));
}

/** The share of a deposit still asked at this port Standing: 1, ½ or nothing (credit). */
export function depositCredit(rules: ContractRules, portStanding: number): number {
  if (portStanding >= rules.depositWaivedAt) return 0;
  if (portStanding >= rules.depositHalfAt) return 0.5;
  return 1;
}

/** The shipyard's discount at this port Standing, 0–15% (plan 10 §3; piece G). */
export function shipyardDiscount(
  portStanding: number,
  rules: ContractRules = gameContracts().rules,
): number {
  return (rules.shipyardDiscountMax * Math.max(0, Math.min(100, portStanding))) / 100;
}

// --- The board ------------------------------------------------------------------------

/** Which board is posted at this time: they change every `boardHours`. */
export function boardIndex(rules: ContractRules, gameSeconds: number): number {
  return Math.floor(Math.max(0, gameSeconds) / (rules.boardHours * 3600));
}

const offerBoard = (id: string): number => Number(id.split('#')[1]);

/** What a board draws before any captain's Standing prices it. */
interface Draw {
  id: string;
  template: ContractTemplate;
  to: string;
  good: string;
  qty: number;
}

function draws(
  defs: ContractDefs,
  econ: EconomyDefs,
  seed: string,
  port: string,
  board: number,
): Draw[] {
  const size = econ.markets.get(port)?.def.size;
  const n = size ? defs.rules.offersBySize[size] : 0;
  const templates = defs.byOrigin.get(port);
  if (!n || !templates) return [];
  const season = seasonAt(board * defs.rules.boardHours * 3600);
  // Every template and destination it may take, weighted so a template with many
  // destinations is drawn as often as one with a single destination.
  const pairs: { t: ContractTemplate; to: string; w: number }[] = [];
  for (const t of templates) {
    if (t.seasons && !t.seasons.includes(season)) continue;
    const tos = t.to.filter((p) => p !== port);
    for (const to of tos) pairs.push({ t, to, w: t.weight / tos.length });
  }
  const rng = Rng.fromSeed(`${seed}:contracts:${port}:${board}`);
  const out: Draw[] = [];
  for (let slot = 0; slot < n && pairs.length > 0; slot++) {
    let total = 0;
    for (const p of pairs) total += p.w;
    let pick = rng.next() * total;
    let i = 0;
    for (; i < pairs.length - 1; i++) {
      pick -= (pairs[i] as (typeof pairs)[number]).w;
      if (pick < 0) break;
    }
    const { t, to } = pairs.splice(i, 1)[0] as (typeof pairs)[number];
    out.push({
      id: `${port}#${board}#${slot}`,
      template: t,
      to,
      good: t.goods[rng.int(0, t.goods.length - 1)] as string,
      qty: rng.int(t.qty[0], t.qty[1]),
    });
  }
  return out;
}

/** The Standing a template's terms and lock go by: the shipper's or the offering port's. */
function governingStanding(t: ContractTemplate, from: string, standing: Standing): number {
  return standingOf(standing, t.tier === 'company' ? t.company : from);
}

const roundTo50 = (cents: number): number => Math.round(cents / 50) * 50;

function priceDraw(
  defs: ContractDefs,
  passages: PassageTable,
  from: string,
  d: Draw,
  standing: Standing,
): ContractTerms {
  const r = defs.rules;
  const t = d.template;
  const passage = passages(from, d.to);
  const perCu = r.payBaseCentsPerCu + r.payCentsPerCuRealMinute * passage.realMinutes;
  const bonus = 1 + (r.standingPayBonus * governingStanding(t, from, standing)) / 100;
  const tier = t.tier === 'company' ? r.companyPay : 1;
  const payCents = Math.max(100, roundTo50(d.qty * perCu * r.kindPay[t.kind] * tier * bonus));
  const credit = depositCredit(r, standingOf(standing, from));
  const a = r.allowance[t.kind];
  const allowHours = Math.ceil(
    Math.max(a.minHours, (passage.gameSeconds / 3600) * a.mult + a.plusHours),
  );
  return {
    id: d.id,
    template: t.id,
    company: t.company,
    kind: t.kind,
    tier: t.tier,
    from,
    to: d.to,
    good: d.good,
    qty: d.qty,
    payCents,
    depositCents: roundTo50(payCents * r.depositShare * credit),
    allowSeconds: allowHours * 3600,
    lateSeconds: Math.ceil(allowHours * r.lateWindowShare) * 3600,
    note: t.note,
  };
}

export interface BoardOffer {
  terms: ContractTerms;
  /** Not yet offered to you: the Standing it needs, and with whom. */
  locked?: { with: string; need: number; have: number } | undefined;
}

export interface BoardSources {
  defs: ContractDefs;
  econ: EconomyDefs;
  passages: PassageTable;
  /** The run's seed (the traffic's), so a board is the same after a reload. */
  seed: string;
  state: ContractsState;
  standing: Standing;
  gameSeconds: number;
}

/**
 * The freight agent's board at a port now: the offers not yet taken, priced for this
 * captain's Standing. Burned companies' offers are left off; ones that need more Standing
 * than you have are listed locked, so the board shows what Standing would open.
 */
export function boardOffers(src: BoardSources, port: string): BoardOffer[] {
  const { defs, econ, passages, seed, state, standing, gameSeconds } = src;
  if (!portInfo(port)?.services.includes('freight')) return [];
  const board = boardIndex(defs.rules, gameSeconds);
  const out: BoardOffer[] = [];
  for (const d of draws(defs, econ, seed, port, board)) {
    if (state.taken.includes(d.id) || state.burned.includes(d.template.company)) continue;
    const terms = priceDraw(defs, passages, port, d, standing);
    const have = governingStanding(d.template, port, standing);
    out.push({
      terms,
      locked:
        have < d.template.minStanding
          ? {
              with: d.template.tier === 'company' ? d.template.company : port,
              need: d.template.minStanding,
              have,
            }
          : undefined,
    });
  }
  return out;
}

// --- Taking, delivering, failing ------------------------------------------------------

export type AcceptRefusal = 'unknown' | 'locked' | 'noRoom' | 'noMoney';
export type AcceptResult =
  | { ok: true; contract: Contract; event: ContractAcceptedEvent }
  | { ok: false; reason: AcceptRefusal };

/** CU of a contract's cargo aboard. */
export function contractCargo(hold: readonly CargoStack[], contractId: string): number {
  let n = 0;
  for (const s of hold) if (s.contract === contractId) n += s.qty;
  return n;
}

function removeContractCargo(hold: Hold, contractId: string): void {
  for (let i = hold.length - 1; i >= 0; i--) {
    if ((hold[i] as CargoStack).contract === contractId) hold.splice(i, 1);
  }
}

function record(
  defs: ContractDefs,
  state: ContractsState,
  c: Contract,
  outcome: ContractOutcome,
  at: number,
  payCents: number,
): void {
  state.history.unshift({
    id: c.id,
    company: c.company,
    from: c.from,
    to: c.to,
    good: c.good,
    qty: c.qty,
    outcome,
    at,
    payCents,
  });
  state.history.length = Math.min(state.history.length, defs.rules.historyLength);
  state.tally[outcome]++;
}

function applyOutcome(
  defs: ContractDefs,
  state: ContractsState,
  standing: Standing,
  c: Contract,
  outcome: 'onTime' | 'late' | 'failed' | 'abandoned',
): void {
  const d = defs.rules.standing[outcome];
  // Mail's good name works both ways: it counts double for and against you.
  const k = c.kind === 'mail' ? defs.rules.mailStanding : 1;
  adjustStanding(standing, state, c.from, d.port * k);
  if (d.destination) adjustStanding(standing, state, c.to, d.destination * k);
  adjustStanding(standing, state, c.company, d.company * k);
}

/** Takes an offer from the board at `port`: the cargo goes aboard, the deposit is paid. */
export function acceptContract(
  src: BoardSources,
  captain: ContractCaptain,
  capacity: number,
  port: string,
  offerId: string,
): AcceptResult {
  const offer = boardOffers(src, port).find((o) => o.terms.id === offerId);
  if (!offer) return { ok: false, reason: 'unknown' };
  if (offer.locked) return { ok: false, reason: 'locked' };
  const t = offer.terms;
  if (holdFree(captain.cargo, capacity) < t.qty) return { ok: false, reason: 'noRoom' };
  if (captain.purse < t.depositCents) return { ok: false, reason: 'noMoney' };
  const { state, gameSeconds } = src;
  captain.purse -= t.depositCents;
  addToHold(captain.cargo, { good: t.good, qty: t.qty, contract: t.id });
  const dueAt = gameSeconds + t.allowSeconds;
  const contract: Contract = {
    ...t,
    acceptedAt: gameSeconds,
    dueAt,
    expiresAt: dueAt + t.lateSeconds,
    status: 'active',
    hits: 0,
  };
  state.active.push(contract);
  // Only boards still posted need their taken offers remembered.
  const board = boardIndex(src.defs.rules, gameSeconds);
  state.taken = state.taken.filter((id) => offerBoard(id) >= board - 1);
  state.taken.push(t.id);
  return {
    ok: true,
    contract,
    event: {
      contractId: t.id,
      from: t.from,
      to: t.to,
      company: t.company,
      good: t.good,
      qty: t.qty,
      depositCents: t.depositCents,
      dueAt,
    },
  };
}

/** Fails every contract past its late window: the deposit is lost, Standing falls. */
export function expireContracts(
  defs: ContractDefs,
  state: ContractsState,
  standing: Standing,
  gameSeconds: number,
): ContractFailedEvent[] {
  const out: ContractFailedEvent[] = [];
  for (const c of state.active) {
    if (c.status !== 'active' || gameSeconds <= c.expiresAt) continue;
    c.status = 'failed';
    applyOutcome(defs, state, standing, c, 'failed');
    record(defs, state, c, 'failed', gameSeconds, 0);
    out.push({ contractId: c.id, from: c.from, to: c.to, company: c.company, reason: 'expired' });
  }
  return out;
}

/** The pay a delivery would bring now, before the deposit comes back. */
export function deliveryPay(
  defs: ContractDefs,
  c: Contract,
  aboard: number,
  gameSeconds: number,
): { payCents: number; late: boolean } {
  const late = gameSeconds > c.dueAt;
  const share = Math.min(1, aboard / c.qty);
  const knocks = Math.max(0, 1 - c.hits * defs.rules.fragileHitLoss);
  const lateK = late ? defs.rules.latePay : 1;
  return { payCents: Math.round(c.payCents * share * knocks * lateK), late };
}

export interface Arrival {
  delivered: { contract: Contract; payCents: number; depositCents: number; late: boolean }[];
  /** Failed contracts whose cargo the freight agent took back. */
  returned: Contract[];
  events: ContractCompletedEvent[];
  failed: ContractFailedEvent[];
}

/**
 * Docking at a port: contracts bound here are delivered (pay and deposit), and at a port
 * with a freight agent, or the contract's own ports, a failed contract's cargo is handed
 * back. Expiry runs first, so a contract can't be delivered past its late window.
 */
export function arriveAt(
  defs: ContractDefs,
  state: ContractsState,
  captain: ContractCaptain,
  port: string,
  gameSeconds: number,
): Arrival {
  const failed = expireContracts(defs, state, captain.standing, gameSeconds);
  const out: Arrival = { delivered: [], returned: [], events: [], failed };
  const agent = !!portInfo(port)?.services.includes('freight');
  const keep: Contract[] = [];
  for (const c of state.active) {
    const aboard = contractCargo(captain.cargo, c.id);
    if (c.status === 'failed') {
      if (agent || port === c.to || port === c.from || aboard === 0) {
        removeContractCargo(captain.cargo, c.id);
        out.returned.push(c);
      } else keep.push(c);
      continue;
    }
    if (c.to !== port || aboard === 0) {
      keep.push(c);
      continue;
    }
    const { payCents, late } = deliveryPay(defs, c, aboard, gameSeconds);
    removeContractCargo(captain.cargo, c.id);
    // The deposit always comes back with a delivery; the pay carries any lateness.
    captain.purse += payCents + c.depositCents;
    applyOutcome(defs, state, captain.standing, c, late ? 'late' : 'onTime');
    record(defs, state, c, late ? 'late' : 'delivered', gameSeconds, payCents);
    out.delivered.push({ contract: c, payCents, depositCents: c.depositCents, late });
    out.events.push({
      contractId: c.id,
      from: c.from,
      to: c.to,
      company: c.company,
      good: c.good,
      qty: aboard,
      payCents,
      late,
      acceptedAt: c.acceptedAt,
      dueAt: c.dueAt,
    });
  }
  state.active = keep;
  return out;
}

export type AbandonRefusal = 'unknown' | 'noAgent';

/** Hands a contract back at a freight agent: the cargo goes ashore, the deposit is lost. */
export function abandonContract(
  defs: ContractDefs,
  state: ContractsState,
  captain: ContractCaptain,
  contractId: string,
  port: string,
  gameSeconds: number,
): { ok: true; event: ContractFailedEvent } | { ok: false; reason: AbandonRefusal } {
  const c = state.active.find((x) => x.id === contractId && x.status === 'active');
  if (!c) return { ok: false, reason: 'unknown' };
  if (!portInfo(port)?.services.includes('freight')) return { ok: false, reason: 'noAgent' };
  removeContractCargo(captain.cargo, c.id);
  applyOutcome(defs, state, captain.standing, c, 'abandoned');
  record(defs, state, c, 'abandoned', gameSeconds, 0);
  state.active = state.active.filter((x) => x !== c);
  return {
    ok: true,
    event: { contractId: c.id, from: c.from, to: c.to, company: c.company, reason: 'abandoned' },
  };
}

export type StealRefusal = 'unknown' | 'notTraded' | 'noCargo';

/**
 * The Seavey temptation (plan 05 §5.2): sells a contract's cargo on this port's market.
 * It pays once: the shipper drops to Standing 0 for good and never offers you another
 * contract, the offering port thinks less of you, and `ContractStolen` goes to Phase 5.
 */
export function stealContract(
  defs: ContractDefs,
  econ: EconomyDefs,
  markets: MarketsState,
  state: ContractsState,
  captain: ContractCaptain,
  contractId: string,
  port: string,
  gameSeconds: number,
):
  | { ok: true; event: ContractStolenEvent; trade: TradeCompletedEvent }
  | { ok: false; reason: StealRefusal } {
  const c = state.active.find((x) => x.id === contractId);
  if (!c) return { ok: false, reason: 'unknown' };
  if (!econ.markets.get(port)?.goods.has(c.good)) return { ok: false, reason: 'notTraded' };
  const qty = contractCargo(captain.cargo, c.id);
  if (qty <= 0) return { ok: false, reason: 'noCargo' };
  const q = quote(econ, markets, port, c.good, qty, 'sell', gameSeconds);
  removeContractCargo(captain.cargo, c.id);
  captain.purse += q.totalCents;
  applyTrade(markets, port, c.good, qty, 'sell', gameSeconds);
  if (!state.burned.includes(c.company)) state.burned.push(c.company);
  captain.standing[c.company] = 0;
  adjustStanding(captain.standing, state, c.from, defs.rules.theftPortStanding);
  // An expired contract was already counted as failed; the theft is still recorded.
  record(defs, state, c, 'stolen', gameSeconds, q.totalCents);
  state.active = state.active.filter((x) => x !== c);
  const next = quote(econ, markets, port, c.good, 1, 'sell', gameSeconds);
  return {
    ok: true,
    event: {
      contractId: c.id,
      from: c.from,
      to: c.to,
      company: c.company,
      port,
      good: c.good,
      qty,
      totalCents: q.totalCents,
    },
    trade: {
      port,
      good: c.good,
      side: 'sell',
      qty,
      totalCents: q.totalCents,
      nextUnitCents: next.totalCents,
    },
  };
}

/** A hard knock with fragile cargo aboard: each costs a share of its pay. */
export function knockFragile(state: ContractsState, hold: readonly CargoStack[]): Contract[] {
  const hit: Contract[] = [];
  for (const c of state.active) {
    if (c.kind !== 'fragile' || c.status !== 'active') continue;
    if (contractCargo(hold, c.id) === 0) continue;
    c.hits++;
    hit.push(c);
  }
  return hit;
}
