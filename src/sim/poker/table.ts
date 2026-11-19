import pokerJson from '../../../data/poker.json';
import {
  MARKER_KINDS,
  pokerFileSchema,
  type MarkerKind,
  type PokerCaptain,
  type PokerFile,
  type PokerRules,
} from '../../../data/schemas/poker';
import { Rng } from '../../core/rng';
import type { ContractTerms } from '../economy/contracts';
import { formatCents } from '../economy/knowledge';
import {
  bestPalm,
  captainDiscards,
  cardName,
  fourFlush,
  handStrength,
  newDeck,
  rankHand,
  shuffle,
  type Card,
  type HandRank,
} from './cards';

/**
 * Poker night at a saloon's card table (plan 12 §5.3; Phase 9 piece C), as a pure state
 * machine. A night's table is drawn from the run's seed, the port and the night: two or
 * three captains who sit in that port, their stacks, and perhaps a marker one of them will
 * put up on a hand. A hand is five-card draw at limit stakes in antes: the ante, a round of
 * betting, one draw, a second round, the showdown. You always act first; the captains
 * answer by their style and their read of their hand, and give away tells as they do.
 *
 * Cash moves through `purse` (the captain's own, from the caller) as it's bet. A side
 * stake against a marker is settled here as who won it; moving a lot of cargo, a contract
 * or a map between the holds is the caller's (`gameplay/poker.ts`).
 */

let cached: PokerFile | undefined;
export function gamePoker(): PokerFile {
  cached ??= pokerFileSchema.parse(pokerJson);
  return cached;
}

export const YOU = 'you';

/** Something staked on a hand besides cash: his marker, or what you match it with. */
export interface Marker {
  kind: MarkerKind | 'cash';
  /** `you`, or the captain's id. */
  owner: string;
  valueCents: number;
  /** "40 CU of salted fish", "his contract: 30 CU of flour to Duluth", "a map". */
  label: string;
  good?: string | undefined;
  qty?: number | undefined;
  /** Your contract's id, or the id his becomes yours under. */
  contract?: string | undefined;
  /** A cache's id (a map). */
  cache?: string | undefined;
  /** His contract's terms, to become yours if you win it. */
  terms?: ContractTerms | undefined;
}

export interface Seat {
  id: string;
  def: PokerCaptain;
  stack: number;
  /** He's left the table: bust, or had enough. */
  gone?: boolean | undefined;
}

export type HandPhase = 'bet1' | 'draw' | 'bet2' | 'done' | 'caught';
export type BetAction = 'check' | 'bet' | 'call' | 'raise' | 'fold';

export interface HandResult {
  /** Who took the pot (more than one: split). */
  winners: string[];
  potCents: number;
  /** Shown hands at the showdown, by seat. */
  shown: Record<string, string>;
  /** "Hale takes $4.50 with three nines." */
  text: string;
  /** Your cash won less what you put in this hand. */
  netCents: number;
  /** The side stake, if there was one: who took both markers. */
  side?: 'you' | 'him' | 'split' | undefined;
}

export interface HandState {
  n: number;
  phase: HandPhase;
  deck: Card[];
  cards: Record<string, Card[]>;
  /** Seats still in, in order of play: you first. */
  inHand: string[];
  potCents: number;
  /** What each seat has put in this hand. */
  put: Record<string, number>;
  /** The betting round: the bet to match, what each has put in it, the raises, who's to act. */
  level: number;
  paid: Record<string, number>;
  raises: number;
  toAct: string[];
  /** The side stake: his marker, the captain, and what you matched it with. */
  side?: { captain: string; his: Marker; yours: Marker } | undefined;
  /** What happened this hand, a line each. */
  log: string[];
  /** Each captain's tell this round. */
  tells: Record<string, string>;
  /** Cards each seat drew. */
  drew: Record<string, number>;
  /** You palmed a card this hand, unseen. */
  palmed?: boolean | undefined;
  /** Who saw you palm it. */
  caughtBy?: string | undefined;
  result?: HandResult | undefined;
}

export interface TableState {
  port: string;
  night: number;
  anteCents: number;
  /** Poker night: the event's high-stakes game. */
  big: boolean;
  seats: Seat[];
  /** Hands dealt tonight. */
  hands: number;
  /** Cards palmed at this table tonight, seen or not. */
  cheats: number;
  /** A captain's marker, offered on the next hand until it's been played for. */
  offer?: Marker | undefined;
  hand?: HandState | undefined;
  /** Why the table's done for tonight, or undefined while it plays. */
  over?: string | undefined;
  /** Your cash won and lost tonight, net. */
  netCents: number;
  rng: Rng;
  /** Your purse, as the hand dealt took it: winnings go back into it. */
  player?: { purse: number } | undefined;
}

export interface TableSetup {
  port: string;
  night: number;
  seed: string;
  big: boolean;
  /** A marker of a kind for a captain to put up, or undefined where none can be had. */
  marker(kind: MarkerKind, owner: PokerCaptain, rng: Rng): Marker | undefined;
}

export function anteAt(rules: PokerRules, port: string, big: boolean): number {
  const ante = rules.anteCents[port] ?? rules.anteCents['default'] ?? 25;
  return Math.round(ante * (big ? rules.eventAnte : 1));
}

/** The most a hand can cost a seat: the ante and every bet and raise in both rounds. */
export function maxSpend(rules: PokerRules, ante: number): number {
  return ante * (1 + rules.raisesPerRound * (rules.betAntes[0] + rules.betAntes[1]));
}

/** Tonight's table at a port: the captains, their stacks and a marker, from the seed. */
export function openTable(setup: TableSetup, file: PokerFile = gamePoker()): TableState {
  const { rules } = file;
  const rng = Rng.fromSeed(`${setup.seed}:poker:${setup.port}:${setup.night}`);
  const ante = anteAt(rules, setup.port, setup.big);
  const pool = file.captains.filter((c) => c.ports.includes(setup.port));
  const want = rng.int(rules.seats[0], rules.seats[1]);
  const seats: Seat[] = [];
  while (seats.length < want && pool.length > 0) {
    const def = pool.splice(rng.int(0, pool.length - 1), 1)[0] as PokerCaptain;
    seats.push({
      id: def.id,
      def,
      stack: ante * rng.int(rules.stackAntes[0], rules.stackAntes[1]),
    });
  }
  const table: TableState = {
    port: setup.port,
    night: setup.night,
    anteCents: ante,
    big: setup.big,
    seats,
    hands: 0,
    cheats: 0,
    netCents: 0,
    rng,
  };
  if (seats.length > 0 && (setup.big || rng.chance(rules.markers.chance))) {
    const owner = rng.pick(seats);
    const kinds = MARKER_KINDS.map((k) => ({ k, w: rules.markers.weights[k] ?? 0 }));
    // Draw kinds by weight until one can be had here.
    while (kinds.some((k) => k.w > 0)) {
      const total = kinds.reduce((t, k) => t + k.w, 0);
      let pick = rng.next() * total;
      const k = kinds.find((x) => (pick -= x.w) < 0 && x.w > 0) ?? kinds.find((x) => x.w > 0);
      if (!k) break;
      const m = setup.marker(k.k, owner.def, rng);
      if (m) {
        table.offer = m;
        break;
      }
      k.w = 0;
    }
  }
  if (seats.length === 0) table.over = 'Nobody is playing tonight.';
  return table;
}

export function seatOf(table: TableState, id: string): Seat | undefined {
  return table.seats.find((s) => s.id === id);
}

/** "Hale": a captain's surname, for the log. */
export function shortName(table: TableState, id: string): string {
  if (id === YOU) return 'You';
  const name = seatOf(table, id)?.def.name ?? id;
  return name.split(' ').pop() ?? name;
}

/** Why you can't be dealt in now, or undefined. */
export function dealRefusal(
  table: TableState,
  purse: number,
  file: PokerFile = gamePoker(),
): string | undefined {
  if (table.over) return table.over;
  if (table.hand && table.hand.phase !== 'done') return 'Finish this hand first.';
  if (purse < maxSpend(file.rules, table.anteCents)) {
    return `You'd want ${formatCents(maxSpend(file.rules, table.anteCents))} in your purse to sit a hand.`;
  }
  return undefined;
}

/**
 * Deals a hand: everyone antes, five cards each, and the first round opens with you. With
 * `side`, his marker and your match are staked between the two of you.
 */
export function dealHand(
  table: TableState,
  player: { purse: number },
  side?: { his: Marker; yours: Marker },
  file: PokerFile = gamePoker(),
): HandState | string {
  const why = dealRefusal(table, player.purse, file);
  if (why) return why;
  const seats = table.seats.filter((s) => !s.gone);
  const deck = shuffle(newDeck(), table.rng);
  const hand: HandState = {
    n: table.hands + 1,
    phase: 'bet1',
    deck,
    cards: {},
    inHand: [YOU, ...seats.map((s) => s.id)],
    potCents: 0,
    put: {},
    level: 0,
    paid: {},
    raises: 0,
    toAct: [],
    log: [],
    tells: {},
    drew: {},
  };
  table.hands += 1;
  table.hand = hand;
  table.player = player;
  for (const id of hand.inHand) {
    hand.cards[id] = deck.splice(0, 5);
    pay(table, hand, player, id, table.anteCents);
  }
  hand.log.push(`Everyone antes ${formatCents(table.anteCents)}.`);
  if (side) {
    hand.side = { captain: side.his.owner, his: side.his, yours: side.yours };
    if (table.offer && table.offer.owner === side.his.owner) table.offer = undefined;
    hand.log.push(
      `${shortName(table, side.his.owner)} puts up ${side.his.label}; you put up ${side.yours.label}.`,
    );
  }
  startRound(table, hand, file);
  return hand;
}

function pay(
  table: TableState,
  hand: HandState,
  player: { purse: number },
  id: string,
  cents: number,
): void {
  if (cents <= 0) return;
  if (id === YOU) player.purse -= cents;
  else {
    const s = seatOf(table, id);
    if (s) s.stack -= cents;
  }
  hand.potCents += cents;
  hand.put[id] = (hand.put[id] ?? 0) + cents;
  hand.paid[id] = (hand.paid[id] ?? 0) + cents;
}

function betSize(table: TableState, hand: HandState, file: PokerFile): number {
  const k = hand.phase === 'bet2' ? file.rules.betAntes[1] : file.rules.betAntes[0];
  return table.anteCents * k;
}

function startRound(table: TableState, hand: HandState, file: PokerFile): void {
  hand.level = 0;
  hand.paid = {};
  hand.raises = 0;
  hand.toAct = [...hand.inHand];
  tellRound(table, hand, file);
  runCaptains(table, hand, file);
}

/** A captain's read of his hand: its strength, a draw's promise before it, and his nerves. */
function readHand(table: TableState, hand: HandState, id: string, file: PokerFile): number {
  const cards = hand.cards[id] ?? [];
  let s = handStrength(rankHand(cards));
  if (hand.phase === 'bet1' && rankHand(cards).category === 0 && fourFlush(cards)) s += 0.25;
  return s + (table.rng.next() * 2 - 1) * file.rules.noise;
}

function tellRound(table: TableState, hand: HandState, file: PokerFile): void {
  hand.tells = {};
  for (const id of hand.inHand) {
    if (id === YOU) continue;
    const def = seatOf(table, id)?.def;
    if (!def) continue;
    const s = handStrength(rankHand(hand.cards[id] ?? []));
    const strong = s >= 0.62;
    const weak = s < 0.4;
    if (!strong && !weak) continue;
    const truthful = table.rng.chance(def.honesty);
    const showsStrong = truthful ? strong : !strong;
    hand.tells[id] = showsStrong ? def.tells.strong : def.tells.weak;
  }
  void file;
}

/** What you may do now, in the betting. */
export function yourOptions(
  table: TableState,
  player: { purse: number },
  file: PokerFile = gamePoker(),
): BetAction[] {
  const hand = table.hand;
  if (!hand || (hand.phase !== 'bet1' && hand.phase !== 'bet2')) return [];
  if (hand.toAct[0] !== YOU) return [];
  const owe = hand.level - (hand.paid[YOU] ?? 0);
  const size = betSize(table, hand, file);
  const out: BetAction[] = [];
  if (owe === 0) {
    out.push('check');
    if (hand.raises < file.rules.raisesPerRound && player.purse >= size) out.push('bet');
  } else {
    if (player.purse >= owe) out.push('call');
    if (hand.raises < file.rules.raisesPerRound && player.purse >= owe + size) out.push('raise');
    out.push('fold');
  }
  return out;
}

/** What it costs you to call now, cents. */
export function toCall(table: TableState): number {
  const hand = table.hand;
  if (!hand) return 0;
  return Math.max(0, hand.level - (hand.paid[YOU] ?? 0));
}

/** The size of a bet or raise this round, cents. */
export function betNow(table: TableState, file: PokerFile = gamePoker()): number {
  return table.hand ? betSize(table, table.hand, file) : 0;
}

function act(
  table: TableState,
  hand: HandState,
  player: { purse: number },
  id: string,
  action: BetAction,
  file: PokerFile,
): void {
  hand.toAct.shift();
  const who = shortName(table, id);
  const owe = hand.level - (hand.paid[id] ?? 0);
  switch (action) {
    case 'check':
      hand.log.push(id === YOU ? 'You check.' : `${who} checks.`);
      return;
    case 'call':
      pay(table, hand, player, id, owe);
      hand.log.push(id === YOU ? `You call ${formatCents(owe)}.` : `${who} calls.`);
      return;
    case 'fold':
      hand.inHand = hand.inHand.filter((x) => x !== id);
      hand.log.push(id === YOU ? 'You fold.' : `${who} folds.`);
      return;
    case 'bet':
    case 'raise': {
      const size = betSize(table, hand, file);
      hand.level += size;
      hand.raises += 1;
      pay(table, hand, player, id, hand.level - (hand.paid[id] ?? 0));
      const verb = action === 'bet' ? 'bets' : 'raises';
      hand.log.push(
        id === YOU ? `You ${action} ${formatCents(size)}.` : `${who} ${verb} ${formatCents(size)}.`,
      );
      // Everyone else still in must answer it, in turn after the bettor.
      const order = hand.inHand;
      const at = order.indexOf(id);
      hand.toAct = [...order.slice(at + 1), ...order.slice(0, at)];
      return;
    }
  }
}

/** A captain's choice by his style, his read, and whether he's tied to a side stake. */
function captainChoice(table: TableState, hand: HandState, id: string, file: PokerFile): BetAction {
  const seat = seatOf(table, id);
  if (!seat) return 'fold';
  const style = file.rules.styles[seat.def.style];
  const s = readHand(table, hand, id, file);
  const owe = hand.level - (hand.paid[id] ?? 0);
  const canRaise = hand.raises < file.rules.raisesPerRound;
  const bluff = table.rng.chance(style.bluff);
  const staked = hand.side?.captain === id;
  if (owe === 0) return canRaise && (s >= style.bet || bluff) ? 'bet' : 'check';
  if (canRaise && (s >= style.raise || (bluff && s >= style.fold))) return 'raise';
  // His marker's on it: he won't throw it away.
  if (s < style.fold && !staked && !bluff) return 'fold';
  return 'call';
}

/** Lets the captains act until it's your turn or the round is done. */
function runCaptains(table: TableState, hand: HandState, file: PokerFile): void {
  const nobody = { purse: 0 };
  while (hand.toAct.length > 0 && hand.toAct[0] !== YOU) {
    const id = hand.toAct[0] as string;
    if (!hand.inHand.includes(id)) {
      hand.toAct.shift();
      continue;
    }
    act(table, hand, nobody, id, captainChoice(table, hand, id, file), file);
    if (hand.inHand.length === 1) break;
  }
  if (hand.inHand.length === 1) {
    showdown(table, hand, file);
    return;
  }
  if (hand.toAct.length === 0) endRound(table, hand, file);
}

function endRound(table: TableState, hand: HandState, file: PokerFile): void {
  if (hand.phase === 'bet1') {
    hand.phase = 'draw';
    // The captains draw at once; you see what they took after your own.
    for (const id of hand.inHand) {
      if (id === YOU) continue;
      const cards = hand.cards[id] ?? [];
      const max = cards.some((c) => c.r === 14) ? file.rules.maxDraw + 1 : file.rules.maxDraw;
      const out = captainDiscards(cards, Math.min(max, 4));
      hand.cards[id] = replace(cards, out, hand.deck);
      hand.drew[id] = out.length;
    }
    // You folded out before the draw and the rest are still in: play it out without you.
    if (!hand.inHand.includes(YOU)) {
      hand.phase = 'bet2';
      startRound(table, hand, file);
    }
    return;
  }
  showdown(table, hand, file);
}

function replace(cards: readonly Card[], out: readonly number[], deck: Card[]): Card[] {
  return cards.map((c, i) => (out.includes(i) ? (deck.shift() as Card) : c));
}

/** You act in the betting: the refusal, or undefined. */
export function yourAction(
  table: TableState,
  player: { purse: number },
  action: BetAction,
  file: PokerFile = gamePoker(),
): string | undefined {
  const hand = table.hand;
  if (!hand) return 'No hand is dealt.';
  if (!yourOptions(table, player, file).includes(action)) return "You can't do that now.";
  act(table, hand, player, YOU, action, file);
  // Folding forfeits the side stake; the rest play the hand out without you.
  if (hand.inHand.length === 1) showdown(table, hand, file);
  else runCaptains(table, hand, file);
  return undefined;
}

/** The chance a palmed card goes unseen now, 0–1. */
export function sleightChance(table: TableState, file: PokerFile = gamePoker()): number {
  const sl = file.rules.sleight;
  const hand = table.hand;
  let p = sl.base - table.cheats * sl.perCheat;
  for (const id of hand?.inHand ?? table.seats.filter((s) => !s.gone).map((s) => s.id)) {
    if (id === YOU) continue;
    p -= (seatOf(table, id)?.def.eye ?? 0) * sl.perEye;
  }
  return Math.max(sl.floor, Math.min(sl.ceiling, p));
}

/** "a fair chance", by the odds of being seen. */
export function riskWord(chance: number): string {
  if (chance >= 0.75) return 'a fair chance';
  if (chance >= 0.55) return 'risky';
  if (chance >= 0.35) return 'very risky';
  return 'reckless';
}

/**
 * Your draw: the cards at `discards` go and new ones come. With `palm`, a sleight of hand
 * first swaps in the best card left in the deck; if a captain sees it, the hand stops
 * there (`caught`). The refusal, or undefined.
 */
export function yourDraw(
  table: TableState,
  discards: readonly number[],
  palm: boolean,
  file: PokerFile = gamePoker(),
): string | undefined {
  const hand = table.hand;
  if (!hand || hand.phase !== 'draw') return 'Not the draw.';
  const mine = hand.cards[YOU] ?? [];
  const uniq = [...new Set(discards)].filter((i) => i >= 0 && i < mine.length);
  const max = mine.some((c, i) => c.r === 14 && !uniq.includes(i))
    ? file.rules.maxDraw + 1
    : file.rules.maxDraw;
  if (uniq.length > max) return `You may draw ${max} at most.`;
  if (palm) {
    const p = sleightChance(table, file);
    table.cheats += 1;
    if (!table.rng.chance(p)) {
      // The sharpest eye still in sees it.
      const eyes = hand.inHand
        .filter((id) => id !== YOU)
        .sort((a, b) => (seatOf(table, b)?.def.eye ?? 0) - (seatOf(table, a)?.def.eye ?? 0));
      hand.caughtBy = eyes[0];
      hand.phase = 'caught';
      hand.log.push(`${shortName(table, eyes[0] ?? '')} catches your wrist under the table.`);
      return undefined;
    }
  }
  hand.cards[YOU] = replace(mine, uniq, hand.deck);
  hand.drew[YOU] = uniq.length;
  if (palm) {
    const best = bestPalm(hand.cards[YOU] ?? [], hand.deck);
    const cards = hand.cards[YOU] ?? [];
    const swapped = cards[best.at] as Card;
    cards[best.at] = hand.deck.splice(best.from, 1)[0] as Card;
    hand.deck.push(swapped);
    hand.palmed = true;
    hand.log.push(`Nobody sees ${cardName(cards[best.at] as Card)} come out of your sleeve.`);
  }
  for (const id of hand.inHand) {
    if (id === YOU) continue;
    const n = hand.drew[id] ?? 0;
    hand.log.push(
      `${shortName(table, id)} ${n === 0 ? 'stands pat' : `draws ${n === 1 ? 'one' : n === 2 ? 'two' : n === 3 ? 'three' : 'four'}`}.`,
    );
  }
  hand.phase = 'bet2';
  startRound(table, hand, file);
  return undefined;
}

function showdown(table: TableState, hand: HandState, file: PokerFile): void {
  const ranks = new Map<string, HandRank>();
  for (const id of hand.inHand) ranks.set(id, rankHand(hand.cards[id] ?? []));
  let best = -1;
  for (const r of ranks.values()) best = Math.max(best, r.score);
  const winners = hand.inHand.filter((id) => ranks.get(id)?.score === best);
  const share = Math.floor(hand.potCents / winners.length);
  let odd = hand.potCents - share * winners.length;
  const shown: Record<string, string> = {};
  const contested = hand.inHand.length > 1;
  if (contested) for (const [id, r] of ranks) shown[id] = r.name;
  let won = 0;
  for (const id of winners) {
    const cents = share + (odd > 0 ? 1 : 0);
    odd = Math.max(0, odd - 1);
    if (id === YOU) {
      won += cents;
      if (table.player) table.player.purse += cents;
    } else {
      const s = seatOf(table, id);
      if (s) s.stack += cents;
    }
  }
  const netCents = won - (hand.put[YOU] ?? 0);
  table.netCents += netCents;
  let side: HandResult['side'];
  if (hand.side) {
    const him = hand.side.captain;
    const youIn = hand.inHand.includes(YOU);
    const himIn = hand.inHand.includes(him);
    if (youIn && !himIn) side = 'you';
    else if (!youIn) side = 'him';
    else {
      const a = ranks.get(YOU)?.score ?? 0;
      const b = ranks.get(him)?.score ?? 0;
      side = a > b ? 'you' : a < b ? 'him' : 'split';
    }
  }
  const names = winners.map((id) => (id === YOU ? 'you' : shortName(table, id)));
  const how = contested ? ` with ${lower(ranks.get(winners[0] as string)?.name ?? '')}` : '';
  const verb = winners.length > 1 ? 'split' : winners[0] === YOU ? 'take' : 'takes';
  const text = `${cap(names.join(' and '))} ${verb} ${formatCents(hand.potCents)}${how}.`;
  hand.result = { winners, potCents: hand.potCents, shown, text, netCents, side };
  hand.log.push(text);
  hand.phase = 'done';
  hand.toAct = [];
  hand.tells = {};
  afterHand(table, file);
}

/** Captains who've had enough leave; the lamps go out after the night's last hand. */
function afterHand(table: TableState, file: PokerFile): void {
  const leave = table.anteCents * Math.max(file.rules.leaveAntes, 1);
  for (const s of table.seats) {
    if (s.gone || s.stack >= leave) continue;
    s.gone = true;
    table.hand?.log.push(`${shortName(table, s.id)} has had enough and goes up to bed.`);
    if (table.offer?.owner === s.id) table.offer = undefined;
  }
  if (table.seats.every((s) => s.gone)) table.over = "You've cleaned out the table.";
  else if (table.hands >= file.rules.handsPerNight) {
    table.over = "The keeper's putting out the lamps. The game's over for tonight.";
  }
}

/**
 * Caught palming a card: `licking` leaves your stake in the pot and the side stake to him,
 * and you're thrown out; `swing` snatches back what you put in and fights your way out
 * (the caller makes that an assault). Either way the table's done with you tonight.
 */
export function settleCaught(
  table: TableState,
  player: { purse: number },
  how: 'licking' | 'swing',
): HandResult | undefined {
  const hand = table.hand;
  if (!hand || hand.phase !== 'caught') return undefined;
  const mine = hand.put[YOU] ?? 0;
  const others = hand.inHand.filter((id) => id !== YOU);
  let pot = hand.potCents;
  if (how === 'swing') {
    player.purse += mine;
    pot -= mine;
  }
  // The captains take back theirs, and split yours if you left it.
  const back = others.length ? Math.floor(pot / others.length) : 0;
  for (const id of others) {
    const s = seatOf(table, id);
    if (s) s.stack += back;
  }
  const netCents = how === 'swing' ? 0 : -mine;
  table.netCents += netCents;
  const text =
    how === 'swing'
      ? 'You come up swinging, snatch back your money and fight your way to the door.'
      : 'They take it out of your hide on the back step, and keep the pot.';
  hand.result = {
    winners: others,
    potCents: hand.potCents,
    shown: {},
    text,
    netCents,
    side: hand.side ? (how === 'swing' ? 'split' : 'him') : undefined,
  };
  hand.log.push(text);
  hand.phase = 'done';
  table.over = "You're thrown out of the game.";
  return hand.result;
}

const lower = (s: string): string => s.charAt(0).toLowerCase() + s.slice(1);
const cap = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);
