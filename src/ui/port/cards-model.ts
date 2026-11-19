import type { PokerFile } from '../../../data/schemas/poker';
import { cardName, cardText, rankGlyph, rankHand, SUITS, type Card } from '../../sim/poker/cards';
import {
  betNow,
  riskWord,
  sleightChance,
  toCall,
  yourOptions,
  YOU,
  type BetAction,
  type TableState,
} from '../../sim/poker/table';

/**
 * The card table (plan 13 §5 "Poker table"; Phase 9 piece C): what the screen shows of
 * tonight's table, built from the sim's state after every move. The captains' cards stay
 * face down until the showdown; their tells are lines of text, read or not.
 */

export interface CardView {
  rank: string;
  suit: string;
  /** Hearts and diamonds: drawn red, and the suit's glyph says it too. */
  red: boolean;
  /** "Q♥" and "the queen of hearts", for the label. */
  text: string;
  name: string;
}

export interface SeatView {
  id: string;
  name: string;
  ship: string;
  stackCents: number;
  /** In the hand, folded, or gone from the table. */
  status: 'in' | 'folded' | 'gone' | 'idle';
  /** His tell this round, if he gave one. */
  tell?: string | undefined;
  /** Cards he drew. */
  drew?: number | undefined;
  /** At the showdown: his cards and what they made. */
  cards?: CardView[] | undefined;
  shown?: string | undefined;
  /** He won the hand. */
  won?: boolean | undefined;
  /** His marker, offered on the next hand. */
  marker?: string | undefined;
}

/** What you could put up against his marker. */
export interface StakeOption {
  /** `cash`, `cargo:<index>`, `contract:<id>`. */
  key: string;
  label: string;
  refusal?: string | undefined;
}

export interface CardTableSnapshot {
  port: string;
  anteCents: number;
  /** Poker night: the big game. */
  big: boolean;
  /** Hands dealt tonight, and how many the night allows. */
  hands: number;
  handsPerNight: number;
  /** Your cash won and lost tonight. */
  netCents: number;
  purseCents: number;
  seats: SeatView[];
  /** `idle` between hands; the hand's phases; `over` once the table's done tonight. */
  phase: 'idle' | 'bet1' | 'draw' | 'bet2' | 'done' | 'caught' | 'over';
  potCents: number;
  /** The side stake on this hand: his marker and yours. */
  side?: { captain: string; his: string; yours: string } | undefined;
  you: { cards: CardView[]; hand: string | undefined; folded: boolean };
  options: BetAction[];
  callCents: number;
  betCents: number;
  maxDraw: number;
  /** A palmed card's chance of going unseen, and the word for it. */
  sleight: { chance: number; word: string };
  /** A captain's marker on offer for the next hand. */
  offer?:
    { captain: string; label: string; valueCents: number; options: StakeOption[] } | undefined;
  dealRefusal?: string | undefined;
  /** The hand's lines so far. */
  log: string[];
  result?: string | undefined;
  /** Who caught your wrist. */
  caughtBy?: string | undefined;
  over?: string | undefined;
}

export function cardView(c: Card): CardView {
  return {
    rank: rankGlyph(c.r),
    suit: SUITS[c.s] ?? '?',
    red: c.s === 1 || c.s === 2,
    text: cardText(c),
    name: cardName(c),
  };
}

export function cardTableSnapshot(
  t: TableState,
  purseCents: number,
  file: PokerFile,
  extra: {
    stakeOptions: StakeOption[];
    dealRefusal: string | undefined;
    captainName(id: string): string;
  },
): CardTableSnapshot {
  const hand = t.hand;
  const live = hand && hand.phase !== 'done';
  const phase: CardTableSnapshot['phase'] =
    hand?.phase === 'caught' ? 'caught' : t.over && !live ? 'over' : !hand ? 'idle' : hand.phase;
  const showdown = hand?.phase === 'done' ? hand.result : undefined;
  const seats: SeatView[] = t.seats.map((s) => {
    const inHand = !!hand && hand.inHand.includes(s.id);
    const dealt = !!hand && !!hand.cards[s.id];
    const shown = showdown?.shown[s.id];
    return {
      id: s.id,
      name: s.def.name,
      ship: s.def.ship,
      stackCents: s.stack,
      status: s.gone ? 'gone' : !dealt ? 'idle' : inHand ? 'in' : 'folded',
      tell: live ? hand?.tells[s.id] : undefined,
      drew: hand?.drew[s.id],
      cards: shown && hand ? (hand.cards[s.id] ?? []).map(cardView) : undefined,
      shown,
      won: showdown?.winners.includes(s.id),
      marker: t.offer?.owner === s.id ? t.offer.label : undefined,
    };
  });
  const mine = hand?.cards[YOU] ?? [];
  const chance = sleightChance(t, file);
  const offer =
    t.offer && !t.over && (!hand || hand.phase === 'done')
      ? {
          captain: extra.captainName(t.offer.owner),
          label: t.offer.label,
          valueCents: t.offer.valueCents,
          options: extra.stakeOptions,
        }
      : undefined;
  return {
    port: t.port,
    anteCents: t.anteCents,
    big: t.big,
    hands: t.hands,
    handsPerNight: file.rules.handsPerNight,
    netCents: t.netCents,
    purseCents,
    seats,
    phase,
    potCents: hand?.potCents ?? 0,
    side: hand?.side
      ? {
          captain: extra.captainName(hand.side.captain),
          his: hand.side.his.label,
          yours: hand.side.yours.label,
        }
      : undefined,
    you: {
      cards: mine.map(cardView),
      hand: mine.length === 5 ? rankHand(mine).name : undefined,
      folded: !!hand && !hand.inHand.includes(YOU),
    },
    options: yourOptions(t, { purse: purseCents }, file),
    callCents: toCall(t),
    betCents: betNow(t, file),
    maxDraw: file.rules.maxDraw,
    sleight: { chance, word: riskWord(chance) },
    offer,
    dealRefusal: extra.dealRefusal,
    log: hand?.log ?? [],
    result: hand?.result?.text,
    caughtBy: hand?.caughtBy ? extra.captainName(hand.caughtBy) : undefined,
    over: t.over,
  };
}
