import type { Rng } from '../../core/rng';

/**
 * The cards for poker night (plan 12 §5.3; Phase 9 piece C): a 52-card deck, five-card
 * hands ranked the usual way, and a hand's strength as its place among every five-card
 * hand, which is what the captains bet on. Pure; the shuffle takes the caller's RNG.
 */

/** Rank 2–14 (14 the ace), suit 0–3: spades, hearts, diamonds, clubs. */
export interface Card {
  r: number;
  s: number;
}

export const SUITS = ['♠', '♥', '♦', '♣'] as const;
export const SUIT_NAMES = ['spades', 'hearts', 'diamonds', 'clubs'] as const;
const RANK_GLYPHS: Record<number, string> = { 11: 'J', 12: 'Q', 13: 'K', 14: 'A', 10: '10' };
const RANK_NAMES: Record<number, string> = {
  2: 'two',
  3: 'three',
  4: 'four',
  5: 'five',
  6: 'six',
  7: 'seven',
  8: 'eight',
  9: 'nine',
  10: 'ten',
  11: 'jack',
  12: 'queen',
  13: 'king',
  14: 'ace',
};
const plural = (r: number): string => (r === 6 ? 'sixes' : `${RANK_NAMES[r] ?? r}s`);

export function rankGlyph(r: number): string {
  return RANK_GLYPHS[r] ?? String(r);
}

/** "Q♥". */
export function cardText(c: Card): string {
  return `${rankGlyph(c.r)}${SUITS[c.s] ?? '?'}`;
}

/** "the queen of hearts". */
export function cardName(c: Card): string {
  return `the ${RANK_NAMES[c.r] ?? c.r} of ${SUIT_NAMES[c.s] ?? '?'}`;
}

export function newDeck(): Card[] {
  const deck: Card[] = [];
  for (let s = 0; s < 4; s++) for (let r = 2; r <= 14; r++) deck.push({ r, s });
  return deck;
}

/** Fisher–Yates, in place. */
export function shuffle(deck: Card[], rng: Rng): Card[] {
  for (let i = deck.length - 1; i > 0; i--) {
    const j = rng.int(0, i);
    const t = deck[i] as Card;
    deck[i] = deck[j] as Card;
    deck[j] = t;
  }
  return deck;
}

/** Hand categories, low to high. */
export const CATEGORIES = [
  'High card',
  'A pair',
  'Two pair',
  'Three of a kind',
  'A straight',
  'A flush',
  'A full house',
  'Four of a kind',
  'A straight flush',
] as const;

export interface HandRank {
  /** 0–8, an index into `CATEGORIES`. */
  category: number;
  /** The ranks that settle a tie, most telling first. */
  ranks: number[];
  /** One number that orders every hand: higher wins. */
  score: number;
  /** "A pair of jacks". */
  name: string;
}

/** The share of all five-card hands in each category (2,598,960 of them). */
const CATEGORY_SHARE = [
  0.501177, 0.422569, 0.047539, 0.021128, 0.003925, 0.001965, 0.001441, 0.00024, 0.0000154,
];

/** Ranks a hand of five. */
export function rankHand(cards: readonly Card[]): HandRank {
  const counts = new Map<number, number>();
  for (const c of cards) counts.set(c.r, (counts.get(c.r) ?? 0) + 1);
  // Groups by count, then rank: [3, 9], [2, 4] for nines full of fours.
  const groups = [...counts.entries()].sort((a, b) => b[1] - a[1] || b[0] - a[0]);
  const flush = cards.length === 5 && cards.every((c) => c.s === cards[0]?.s);
  const distinct = [...counts.keys()].sort((a, b) => b - a);
  let straightHigh = 0;
  if (distinct.length === 5) {
    if ((distinct[0] as number) - (distinct[4] as number) === 4)
      straightHigh = distinct[0] as number;
    // The wheel: A-2-3-4-5, five high.
    else if (distinct.join() === '14,5,4,3,2') straightHigh = 5;
  }
  const top = groups[0] as [number, number];
  const second = groups[1];
  let category: number;
  let ranks: number[];
  if (straightHigh && flush) {
    category = 8;
    ranks = [straightHigh];
  } else if (top[1] === 4) {
    category = 7;
    ranks = groups.map((g) => g[0]);
  } else if (top[1] === 3 && second?.[1] === 2) {
    category = 6;
    ranks = groups.map((g) => g[0]);
  } else if (flush) {
    category = 5;
    ranks = distinct;
  } else if (straightHigh) {
    category = 4;
    ranks = [straightHigh];
  } else if (top[1] === 3) {
    category = 3;
    ranks = groups.map((g) => g[0]);
  } else if (top[1] === 2 && second?.[1] === 2) {
    category = 2;
    ranks = groups.map((g) => g[0]);
  } else if (top[1] === 2) {
    category = 1;
    ranks = groups.map((g) => g[0]);
  } else {
    category = 0;
    ranks = distinct;
  }
  let score = category;
  for (let i = 0; i < 5; i++) score = score * 15 + (ranks[i] ?? 0);
  return { category, ranks, score, name: handName(category, ranks) };
}

function handName(category: number, ranks: readonly number[]): string {
  const a = ranks[0] ?? 2;
  const b = ranks[1] ?? 2;
  switch (category) {
    case 0:
      return `${cap(RANK_NAMES[a] ?? '')} high`;
    case 1:
      return `A pair of ${plural(a)}`;
    case 2:
      return `Two pair, ${plural(a)} and ${plural(b)}`;
    case 3:
      return `Three ${plural(a)}`;
    case 4:
      return `A straight, ${RANK_NAMES[a]} high`;
    case 5:
      return `A flush, ${RANK_NAMES[a]} high`;
    case 6:
      return `A full house, ${plural(a)} full of ${plural(b)}`;
    case 7:
      return `Four ${plural(a)}`;
    default:
      return a === 14 ? 'A royal flush' : `A straight flush, ${RANK_NAMES[a]} high`;
  }
}

const cap = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);

/**
 * A hand's place among all five-card hands, 0–1: its category's share below it, plus how
 * far up its own category its leading rank puts it. Close enough to bet on.
 */
export function handStrength(rank: HandRank): number {
  let below = 0;
  for (let i = 0; i < rank.category; i++) below += CATEGORY_SHARE[i] as number;
  const share = CATEGORY_SHARE[rank.category] as number;
  const lead = rank.ranks[0] ?? 2;
  const next = rank.ranks[1] ?? 2;
  // A high-card hand's place is mostly its top card; a pair's, the pair's rank.
  const within = Math.min(1, Math.max(0, (lead - 2 + (next - 2) / 13) / 13));
  return Math.min(1, below + share * within);
}

/** Four cards of one suit: a card from a flush. */
export function fourFlush(cards: readonly Card[]): boolean {
  const n = [0, 0, 0, 0];
  for (const c of cards) n[c.s] = (n[c.s] ?? 0) + 1;
  return n.some((k) => k === 4);
}

/**
 * The cards a sensible captain throws away (indexes into his hand): nothing from a made
 * straight or better, the odd card from two pair or a four-flush, the rest round a pair or
 * trips, and all but the two best from nothing (all but an ace and one more when `max`
 * allows four).
 */
export function captainDiscards(cards: readonly Card[], max: number): number[] {
  const rank = rankHand(cards);
  if (rank.category >= 4 && rank.category !== 7) return [];
  const idx = cards.map((_, i) => i);
  if (rank.category === 0 && fourFlush(cards)) {
    const n = [0, 0, 0, 0];
    for (const c of cards) n[c.s] = (n[c.s] ?? 0) + 1;
    const suit = n.indexOf(4);
    return idx.filter((i) => cards[i]?.s !== suit);
  }
  if (rank.category >= 1) {
    // Keep the made cards: every rank that appears more than once.
    const counts = new Map<number, number>();
    for (const c of cards) counts.set(c.r, (counts.get(c.r) ?? 0) + 1);
    return idx.filter((i) => (counts.get(cards[i]?.r ?? 0) ?? 0) < 2).slice(0, max);
  }
  const byRank = [...idx].sort((a, b) => (cards[b]?.r ?? 0) - (cards[a]?.r ?? 0));
  const keep = max >= 4 && cards[byRank[0] as number]?.r === 14 ? 1 : 2;
  return byRank.slice(keep).slice(0, max);
}

/**
 * The palmed card (the cheat): the one card from what's left of the deck that, swapped for
 * one in the hand, makes the best hand. Returns the hand's index and the deck's.
 */
export function bestPalm(
  hand: readonly Card[],
  deck: readonly Card[],
): { at: number; from: number; rank: HandRank } {
  let best = { at: 0, from: 0, rank: rankHand(hand) };
  for (let at = 0; at < hand.length; at++) {
    for (let from = 0; from < deck.length; from++) {
      const tried = hand.map((c, i) => (i === at ? (deck[from] as Card) : c));
      const rank = rankHand(tried);
      if (rank.score > best.rank.score) best = { at, from, rank };
    }
  }
  return best;
}
