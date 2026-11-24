import { describe, expect, it } from 'vitest';
import { madeCards, type Card } from '../src/sim/poker/cards';
import {
  dealHand,
  gamePoker,
  openTable,
  yourAction,
  yourDraw,
  yourOptions,
  YOU,
  type TableState,
} from '../src/sim/poker/table';
import { cardTableSnapshot, type CardTableSnapshot } from '../src/ui/port/cards-model';

/**
 * The hand's result made plain (the card table's banner): the cards that made the winning
 * hand lit, and whose pot it was, what took it and what it did to your purse.
 */

const hand = (text: string): Card[] =>
  text.split(' ').map((t) => {
    const suit = 'SHDC'.indexOf(t.slice(-1));
    const r = t.slice(0, -1);
    const rank = ({ J: 11, Q: 12, K: 13, A: 14 } as Record<string, number>)[r] ?? Number(r);
    return { r: rank, s: suit };
  });

describe('the cards that make a hand', () => {
  it('lights the pairs, trips and fours, and leaves the kickers dark', () => {
    expect(madeCards(hand('5S AD JH 5C JS'))).toEqual([0, 2, 3, 4]);
    expect(madeCards(hand('8H 5H 8S 6D AS'))).toEqual([0, 2]);
    expect(madeCards(hand('9S 9H 2D 9C KS'))).toEqual([0, 1, 3]);
    expect(madeCards(hand('QS QH QD QC 3S'))).toEqual([0, 1, 2, 3]);
  });

  it('lights all five of a straight, a flush or a full house', () => {
    expect(madeCards(hand('5S 6D 7H 8C 9S'))).toEqual([0, 1, 2, 3, 4]);
    expect(madeCards(hand('2H 9H JH 4H KH'))).toEqual([0, 1, 2, 3, 4]);
    expect(madeCards(hand('7S 7H 4D 4C 7D'))).toEqual([0, 1, 2, 3, 4]);
  });

  it('lights the top card of nothing at all', () => {
    expect(madeCards(hand('2S 9D KH 4C 7S'))).toEqual([2]);
  });
});

function snap(t: TableState, purse: number): CardTableSnapshot {
  return cardTableSnapshot(t, purse, gamePoker(), {
    stakeOptions: [],
    dealRefusal: undefined,
    captainName: (id) => id,
  });
}

/** Plays hands until `want` says the result's the one to look at. */
function playUntil(want: (s: CardTableSnapshot) => boolean, fold = false): CardTableSnapshot {
  for (let night = 0; night < 60; night++) {
    const t = openTable({
      port: 'port.duluth',
      night,
      seed: `result${night}`,
      big: false,
      marker: () => undefined,
    });
    const player = { purse: 20_000 };
    while (!t.over) {
      const h = dealHand(t, player);
      if (typeof h === 'string') break;
      for (let steps = 0; h.phase !== 'done' && steps < 20; steps++) {
        if (h.phase === 'draw') yourDraw(t, [3, 4], false);
        else {
          const opts = yourOptions(t, player);
          const pick =
            fold && opts.includes('fold') ? 'fold' : opts.includes('call') ? 'call' : 'check';
          yourAction(t, player, opts.includes(pick) ? pick : (opts[0] ?? 'check'));
        }
        // No banner while the hand's still being played.
        if ((h.phase as string) !== 'done') expect(snap(t, player.purse).outcome).toBeUndefined();
      }
      const s = snap(t, player.purse);
      if (want(s)) return s;
    }
  }
  throw new Error('no such hand in 60 nights');
}

describe("the hand's result", () => {
  it('says the pot is yours, with what, and lights the cards that took it', () => {
    const s = playUntil((s) => s.outcome?.kind === 'won' && !!s.you.made);
    expect(s.outcome?.title).toBe('The pot is yours');
    expect(s.outcome?.how).toMatch(/^With /);
    expect(s.outcome?.winners).toEqual([YOU]);
    expect(s.outcome?.netCents).toBeGreaterThan(0);
    expect(s.you.won).toBe(true);
    expect(s.you.made?.length).toBeGreaterThan(0);
  });

  it("says whose it is when it isn't yours, and lights his cards instead", () => {
    const s = playUntil((s) => s.outcome?.kind === 'lost' && s.seats.some((x) => x.made));
    const winner = s.seats.find((x) => x.won);
    expect(s.outcome?.title).toMatch(/takes the pot$/);
    expect(s.outcome?.netCents).toBeLessThan(0);
    expect(winner?.made?.length).toBeGreaterThan(0);
    expect(s.you.made).toBeUndefined();
  });

  it('tells a fold for what it is', () => {
    const s = playUntil((s) => s.outcome?.kind === 'lost' && s.you.folded, true);
    expect(s.outcome?.how).toMatch(/^You folded/);
  });
});
