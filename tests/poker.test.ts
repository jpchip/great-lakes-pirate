import { describe, expect, it } from 'vitest';
import { Rng } from '../src/core/rng';
import {
  bestPalm,
  captainDiscards,
  handStrength,
  newDeck,
  rankHand,
  shuffle,
  type Card,
} from '../src/sim/poker/cards';
import {
  dealHand,
  dealRefusal,
  gamePoker,
  maxSpend,
  openTable,
  settleCaught,
  sleightChance,
  yourAction,
  yourDraw,
  yourOptions,
  YOU,
  type Marker,
  type TableState,
} from '../src/sim/poker/table';

/** "AS KH 10D" → cards. */
const hand = (text: string): Card[] =>
  text.split(' ').map((t) => {
    const suit = 'SHDC'.indexOf(t.slice(-1));
    const r = t.slice(0, -1);
    const rank = ({ J: 11, Q: 12, K: 13, A: 14 } as Record<string, number>)[r] ?? Number(r);
    return { r: rank, s: suit };
  });

const MAP: Marker = {
  kind: 'map',
  owner: '',
  valueCents: 5000,
  label: 'a map to a cache',
  cache: 'cache.test',
};

function table(port = 'port.bayfield', night = 3, big = false, seed = 'test'): TableState {
  return openTable({
    port,
    night,
    seed,
    big,
    marker: (kind, owner) => (kind === 'map' ? { ...MAP, owner: owner.id } : undefined),
  });
}

/** Everyone's cash: your purse and every captain's stack, with the pot on the table. */
const money = (t: TableState, purse: number): number =>
  purse +
  t.seats.reduce((n, s) => n + s.stack, 0) +
  (t.hand?.phase === 'done' ? 0 : (t.hand?.potCents ?? 0));

describe('the cards', () => {
  it('ranks hands in the usual order', () => {
    const order = [
      'AS KH 9D 5C 2S', // ace high
      '9S 9H KD 5C 2S', // pair
      '9S 9H 5D 5C 2S', // two pair
      '9S 9H 9D 5C 2S', // trips
      'AS 2H 3D 4C 5S', // the wheel
      '6S 7H 8D 9C 10S', // straight
      'KS 9S 7S 4S 2S', // flush
      '9S 9H 9D 5C 5S', // full house
      '9S 9H 9D 9C 5S', // quads
      '5H 6H 7H 8H 9H', // straight flush
    ].map((h) => rankHand(hand(h)));
    order.forEach((r, i) => {
      if (i > 0) expect(r.score, r.name).toBeGreaterThan((order[i - 1] as typeof r).score);
    });
    expect(order[4]?.name).toBe('A straight, five high');
    expect(order[7]?.name).toBe('A full house, nines full of fives');
  });

  it('settles ties by the kickers', () => {
    const a = rankHand(hand('JS JH AD 7C 2S'));
    const b = rankHand(hand('JD JC KD 7S 2D'));
    expect(a.score).toBeGreaterThan(b.score);
    expect(rankHand(hand('JS JH AD 7C 2S')).score).toBe(rankHand(hand('JD JC AH 7S 2D')).score);
  });

  it('deals hands at the odds of a real deck', () => {
    const rng = Rng.fromSeed('odds');
    const n = 40_000;
    const count = new Array<number>(9).fill(0);
    for (let i = 0; i < n; i++) {
      const deck = shuffle(newDeck(), rng);
      const c = rankHand(deck.slice(0, 5)).category;
      count[c] = (count[c] ?? 0) + 1;
    }
    // High card 50.1%, a pair 42.3%, two pair 4.75%, trips 2.11%.
    const share = (c: number): number => (count[c] ?? 0) / n;
    expect(share(0)).toBeCloseTo(0.501, 1);
    expect(share(1)).toBeCloseTo(0.423, 1);
    expect(Math.abs(share(2) - 0.0475)).toBeLessThan(0.006);
    expect(Math.abs(share(3) - 0.0211)).toBeLessThan(0.004);
  });

  it('places a hand among all hands', () => {
    const weak = handStrength(rankHand(hand('7S 5H 4D 3C 2S')));
    const pair = handStrength(rankHand(hand('QS QH 4D 3C 2S')));
    const trips = handStrength(rankHand(hand('4S 4H 4D 9C 2S')));
    expect(weak).toBeLessThan(0.3);
    expect(pair).toBeGreaterThan(0.5);
    expect(trips).toBeGreaterThan(0.95);
  });

  it("draws to a captain's hand as a sensible man would", () => {
    expect(captainDiscards(hand('9S 9H KD 5C 2S'), 3)).toEqual([2, 3, 4]);
    expect(captainDiscards(hand('9S 9H 5D 5C 2S'), 3)).toEqual([4]);
    expect(captainDiscards(hand('6S 7H 8D 9C 10S'), 3)).toEqual([]);
    expect(captainDiscards(hand('KS 9S 7S 4S 2D'), 3)).toEqual([4]);
    // Nothing: keep the two best.
    expect(captainDiscards(hand('KS 9H 7D 4S 2C'), 3).sort()).toEqual([2, 3, 4]);
  });

  it('palms the card that helps most', () => {
    const mine = hand('9S 9H KD 5C 2S');
    const deck = hand('3D 9D 4C');
    const p = bestPalm(mine, deck);
    expect(p.rank.category).toBe(3);
    expect(deck[p.from]).toEqual({ r: 9, s: 2 });
  });
});

describe('the table', () => {
  it('seats the same captains for the same night and port', () => {
    const a = table();
    const b = table();
    expect(a.seats.map((s) => [s.id, s.stack])).toEqual(b.seats.map((s) => [s.id, s.stack]));
    expect(a.seats.length).toBeGreaterThanOrEqual(2);
    for (const s of a.seats) expect(s.def.ports).toContain('port.bayfield');
  });

  it('raises the stakes on poker night and always brings a marker', () => {
    const t = table('port.bayfield', 4, true);
    expect(t.anteCents).toBe(50);
    expect(t.offer?.kind).toBe('map');
    expect(t.seats.map((s) => s.id)).toContain(t.offer?.owner);
  });

  it('wants enough in your purse to see a hand through', () => {
    const t = table();
    expect(maxSpend(gamePoker().rules, 25)).toBe(25 * 13);
    expect(dealRefusal(t, 100)).toContain('purse');
    expect(dealRefusal(t, 10_000)).toBeUndefined();
  });

  it('plays hands to the showdown with no money made or lost', () => {
    for (let night = 0; night < 30; night++) {
      const t = table('port.duluth', night, false, `conserve${night}`);
      const player = { purse: 20_000 };
      const start = money(t, player.purse);
      let guard = 0;
      while (!t.over && guard++ < 40) {
        const h = dealHand(t, player);
        if (typeof h === 'string') break;
        let steps = 0;
        while (h.phase !== 'done' && steps++ < 20) {
          if (h.phase === 'draw') expect(yourDraw(t, [3, 4], false)).toBeUndefined();
          else {
            const opts = yourOptions(t, player);
            // Call down whatever comes; open the betting now and then.
            const pick = opts.includes('call') ? 'call' : steps % 2 ? 'bet' : 'check';
            expect(
              yourAction(t, player, opts.includes(pick) ? pick : (opts[0] ?? 'check')),
            ).toBeUndefined();
          }
          expect(money(t, player.purse)).toBe(start);
        }
        expect(h.phase).toBe('done');
        expect(h.result?.winners.length).toBeGreaterThan(0);
      }
      expect(t.hands).toBeGreaterThan(0);
      expect(t.hands).toBeLessThanOrEqual(gamePoker().rules.handsPerNight);
    }
  });

  it('forfeits the side stake when you fold, and the staked captain never does', () => {
    const t = table('port.bayfield', 4, true);
    const player = { purse: 20_000 };
    const his = t.offer as Marker;
    const h = dealHand(t, player, {
      his,
      yours: { kind: 'cash', owner: YOU, valueCents: his.valueCents, label: '$50' },
    });
    if (typeof h === 'string') throw new Error(h);
    expect(t.offer).toBeUndefined();
    // Fold at the first chance: if the captains check round, bet then fold to the answer.
    while (h.phase !== 'done') {
      const opts = yourOptions(t, player);
      if (opts.includes('fold')) yourAction(t, player, 'fold');
      else if (opts.length) yourAction(t, player, 'check');
      else if (h.phase === 'draw') yourDraw(t, [], false);
    }
    expect(h.inHand).toContain(his.owner);
    if (!h.inHand.includes(YOU)) expect(h.result?.side).toBe('him');
  });

  it('catches a clumsy sleight of hand, and the swing takes your stake back', () => {
    const t = table('port.bayfield', 5, false, 'caught');
    // Make it certain: every eye at the table is sharp and you've palmed before.
    t.cheats = 10;
    expect(sleightChance(t)).toBe(gamePoker().rules.sleight.floor);
    const player = { purse: 10_000 };
    const before = player.purse;
    let h = dealHand(t, player);
    if (typeof h === 'string') throw new Error(h);
    let tries = 0;
    // Draw with a palmed card until someone sees it (10% unseen at the floor).
    while (h.phase !== 'caught' && tries++ < 20) {
      while (h.phase === 'bet1' || h.phase === 'bet2') {
        const opts = yourOptions(t, player);
        yourAction(t, player, opts.includes('call') ? 'call' : 'check');
      }
      if (h.phase === 'draw') yourDraw(t, [4], true);
      while ((h.phase as string) === 'bet2') {
        const opts = yourOptions(t, player);
        yourAction(t, player, opts.includes('call') ? 'call' : 'check');
      }
      if (h.phase === 'done' && !t.over) {
        const next = dealHand(t, player);
        if (typeof next === 'string') break;
        h = next;
      }
    }
    expect(h.phase).toBe('caught');
    expect(h.caughtBy).toBeDefined();
    const put = h.put[YOU] ?? 0;
    const purseThen = player.purse;
    settleCaught(t, player, 'swing');
    expect(player.purse).toBe(purseThen + put);
    expect(t.over).toContain('thrown out');
    expect(dealHand(t, player)).toBeTypeOf('string');
    expect(player.purse).toBeLessThanOrEqual(before + 100_000);
  });
});
