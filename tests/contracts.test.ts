import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { EventBus } from '../src/core/events';
import { migrateSave } from '../src/core/save/migrate';
import { attachContracts } from '../src/gameplay/contracts';
import { attachEconomy } from '../src/gameplay/economy';
import { attachPorts } from '../src/gameplay/port';
import { createSchooner } from '../src/gameplay/schooner';
import type { GameContext, GameEvents } from '../src/modes/context';
import {
  abandonContract,
  acceptContract,
  arriveAt,
  boardOffers,
  createContractsState,
  depositCredit,
  expireContracts,
  gameContracts,
  knockFragile,
  shipyardDiscount,
  stealContract,
  type BoardSources,
  type ContractCaptain,
  type ContractsState,
  type ContractTerms,
} from '../src/sim/economy/contracts';
import { gameEconomy, portInfo, seasonAt } from '../src/sim/economy/defs';
import { createMarkets, quote, type MarketsState } from '../src/sim/economy/market';
import { passageTable } from '../src/sim/economy/passages';
import { sell } from '../src/sim/economy/trade';
import { createWorldState, parseWorldState, worldStateSchema } from '../src/sim/world-state';
import type { PortSnapshot } from '../src/ui/port/model';

/** Phase 4 piece F: freight contracts and Standing (plan 05 §5.2; §16.3 criterion 9). */

const defs = gameContracts();
const econ = gameEconomy();
const passages = passageTable();
const DAY = 24 * 3600;
const T1 = 20;

const must = <T>(v: T | undefined | null): T => {
  if (v === undefined || v === null) throw new Error('missing');
  return v;
};

interface World {
  state: ContractsState;
  captain: ContractCaptain;
  markets: MarketsState;
  src(gameSeconds: number): BoardSources;
}

function world(seed = 'contracts', purse = 100_000): World {
  const state = createContractsState();
  const captain: ContractCaptain = { purse, cargo: [], standing: {} };
  return {
    state,
    captain,
    markets: createMarkets(econ, 0),
    src: (gameSeconds) => ({
      defs,
      econ,
      passages,
      seed,
      state,
      standing: captain.standing,
      gameSeconds,
    }),
  };
}

/** The first open offer on a port's board at a time, or after scanning later boards. */
function findOffer(
  w: World,
  port: string,
  from: number,
  test: (t: ContractTerms) => boolean = () => true,
): { terms: ContractTerms; at: number } {
  for (let at = from; at < from + 200 * DAY; at += DAY) {
    const o = boardOffers(w.src(at), port).find((b) => !b.locked && test(b.terms));
    if (o) return { terms: o.terms, at };
  }
  throw new Error(`No offer at ${port}`);
}

describe('the freight agent and its templates', () => {
  it('has a freight agent at every port with a market but La Pointe', () => {
    for (const port of econ.markets.keys()) {
      expect(portInfo(port)?.services.includes('freight'), port).toBe(port !== 'port.la_pointe');
    }
  });

  it('gives every company but the Revenue Service some business, and every agent a board', () => {
    const shippers = new Set(defs.templates.map((t) => t.company));
    for (const [id, f] of defs.companies) {
      expect(shippers.has(id), id).toBe(f.kind === 'company');
    }
    for (const port of econ.markets.keys()) {
      if (port === 'port.la_pointe') continue;
      expect(defs.byOrigin.get(port)?.length ?? 0, port).toBeGreaterThan(0);
    }
  });

  it('posts the same board for the same run, port and week, and a new one each week', () => {
    const a = boardOffers(world('run-1').src(DAY / 2), 'port.duluth').map((o) => o.terms);
    const b = boardOffers(world('run-1').src(DAY - 1), 'port.duluth').map((o) => o.terms);
    expect(a).toEqual(b);
    expect(a).toHaveLength(defs.rules.offersBySize.huge);
    const next = boardOffers(world('run-1').src(DAY), 'port.duluth').map((o) => o.terms.id);
    expect(next).not.toEqual(a.map((t) => t.id));
    expect(boardOffers(world().src(0), 'port.la_pointe')).toEqual([]);
  });

  it('keeps to the seasons: no fresh fish in winter, maple sugar only in spring', () => {
    const w = world('seasons');
    for (let day = 0; day < 52; day++) {
      const season = seasonAt(day * DAY);
      for (const o of boardOffers(w.src(day * DAY), 'port.bayfield')) {
        if (o.terms.good === 'good.fresh_fish') expect(season).not.toBe('winter');
        if (o.terms.good === 'good.maple_sugar') expect(season).toBe('spring');
        expect(o.terms.to).not.toBe('port.bayfield');
      }
    }
  });

  it('pays more for a longer passage, and for rush, mail and fragile cargo', () => {
    const r = defs.rules;
    const perCu = (to: string) =>
      r.payBaseCentsPerCu + r.payCentsPerCuRealMinute * passages('port.duluth', to).realMinutes;
    expect(perCu('port.bayfield')).toBeGreaterThan(perCu('port.superior'));
    expect(r.kindPay.rush).toBeGreaterThan(1);
    expect(r.kindPay.mail).toBeGreaterThan(r.kindPay.rush);
    expect(r.kindPay.fragile).toBeGreaterThan(1);
    const w = world('pay');
    for (let day = 0; day < 20; day++) {
      for (const o of boardOffers(w.src(day * DAY), 'port.duluth')) {
        const t = o.terms;
        expect(t.depositCents).toBeLessThanOrEqual(t.payCents / 2);
        expect(t.allowSeconds).toBeGreaterThan(passages(t.from, t.to).gameSeconds);
      }
    }
  });
});

describe('taking and delivering a contract', () => {
  it('loads marked cargo and takes the deposit; the offer leaves the board', () => {
    const w = world();
    const { terms, at } = findOffer(w, 'port.superior', 0, (t) => t.depositCents > 0);
    const r = acceptContract(w.src(at), w.captain, T1, 'port.superior', terms.id);
    expect(r.ok).toBe(true);
    expect(w.captain.purse).toBe(100_000 - terms.depositCents);
    expect(w.captain.cargo).toEqual([{ good: terms.good, qty: terms.qty, contract: terms.id }]);
    expect(boardOffers(w.src(at), 'port.superior').map((o) => o.terms.id)).not.toContain(terms.id);
    // An ordinary sale leaves it alone.
    if (econ.markets.get('port.superior')?.goods.has(terms.good)) {
      const s = sell(econ, w.markets, w.captain, 'port.superior', terms.good, 1, at);
      expect(s.ok).toBe(false);
    }
  });

  it('refuses without room, the deposit, or the Standing', () => {
    const full = world('refuse', 100_000);
    full.captain.cargo.push({ good: 'good.coal', qty: T1 });
    const { terms, at } = findOffer(full, 'port.duluth', 0);
    expect(acceptContract(full.src(at), full.captain, T1, 'port.duluth', terms.id)).toEqual({
      ok: false,
      reason: 'noRoom',
    });
    const poor = world('refuse', 0);
    const d = findOffer(poor, 'port.duluth', 0, (t) => t.depositCents > 0);
    expect(acceptContract(poor.src(d.at), poor.captain, T1, 'port.duluth', d.terms.id)).toEqual({
      ok: false,
      reason: 'noMoney',
    });
    const w = world('locked');
    for (let at = 0; at < 300 * DAY; at += DAY) {
      const locked = boardOffers(w.src(at), 'port.duluth').find((o) => o.locked);
      if (!locked) continue;
      expect(locked.terms.tier).toBe('company');
      const r = acceptContract(w.src(at), w.captain, T1, 'port.duluth', locked.terms.id);
      expect(r).toEqual({ ok: false, reason: 'locked' });
      return;
    }
    throw new Error('No locked offer found');
  });

  it('pays on time with the deposit back, and raises Standing with both ports and the shipper', () => {
    const w = world();
    const { terms, at } = findOffer(w, 'port.duluth', 0, (t) => t.kind === 'freight');
    acceptContract(w.src(at), w.captain, T1, 'port.duluth', terms.id);
    const purse = w.captain.purse;
    const a = arriveAt(defs, w.state, w.captain, terms.to, at + terms.allowSeconds - 1);
    expect(a.delivered).toHaveLength(1);
    expect(a.events[0]).toMatchObject({
      contractId: terms.id,
      late: false,
      payCents: terms.payCents,
    });
    expect(w.captain.purse).toBe(purse + terms.payCents + terms.depositCents);
    expect(w.captain.cargo).toEqual([]);
    const s = defs.rules.standing.onTime;
    expect(w.captain.standing).toEqual({
      'port.duluth': s.port,
      [terms.to]: s.destination,
      [terms.company]: s.company,
    });
    expect(w.state.active).toEqual([]);
    expect(w.state.history[0]?.outcome).toBe('delivered');
  });

  it("doesn't deliver at the wrong port", () => {
    const w = world();
    const { terms, at } = findOffer(w, 'port.duluth', 0, (t) => t.to !== 'port.superior');
    acceptContract(w.src(at), w.captain, T1, 'port.duluth', terms.id);
    expect(arriveAt(defs, w.state, w.captain, 'port.superior', at + 3600).delivered).toEqual([]);
    expect(w.state.active).toHaveLength(1);
  });

  it('pays half late, and fails past the late window: deposit lost, cargo handed back', () => {
    const late = world('late');
    const a = findOffer(late, 'port.duluth', 0);
    acceptContract(late.src(a.at), late.captain, T1, 'port.duluth', a.terms.id);
    const due = a.at + a.terms.allowSeconds;
    const r = arriveAt(defs, late.state, late.captain, a.terms.to, due + 60);
    expect(r.events[0]?.late).toBe(true);
    expect(r.events[0]?.payCents).toBe(Math.round(a.terms.payCents * defs.rules.latePay));
    expect(late.captain.standing['port.duluth'] ?? 0).toBe(0);

    const fail = world('fail');
    const f = findOffer(fail, 'port.duluth', 0, (t) => t.depositCents > 0);
    acceptContract(fail.src(f.at), fail.captain, T1, 'port.duluth', f.terms.id);
    fail.captain.standing['port.duluth'] = 20;
    const purse = fail.captain.purse;
    const end = f.at + f.terms.allowSeconds + f.terms.lateSeconds + 1;
    const failed = expireContracts(defs, fail.state, fail.captain.standing, end);
    expect(failed).toEqual([
      expect.objectContaining({ contractId: f.terms.id, reason: 'expired' }),
    ]);
    expect(fail.captain.standing['port.duluth']).toBe(20 + defs.rules.standing.failed.port);
    // Docking at the destination now delivers nothing: the agent takes the cargo back.
    const back = arriveAt(defs, fail.state, fail.captain, f.terms.to, end + 3600);
    expect(back.delivered).toEqual([]);
    expect(back.returned).toHaveLength(1);
    expect(fail.captain.cargo).toEqual([]);
    expect(fail.captain.purse).toBe(purse);
    expect(fail.state.active).toEqual([]);
  });

  it('costs fragile cargo a quarter of its pay for each hard knock', () => {
    const w = world('fragile');
    const { terms, at } = findOffer(w, 'port.duluth', 0, (t) => t.kind === 'fragile');
    acceptContract(w.src(at), w.captain, T1, 'port.duluth', terms.id);
    expect(knockFragile(w.state, w.captain.cargo)).toHaveLength(1);
    knockFragile(w.state, w.captain.cargo);
    const r = arriveAt(defs, w.state, w.captain, terms.to, at + 3600);
    expect(r.events[0]?.payCents).toBe(Math.round(terms.payCents * 0.5));
  });

  it('can be handed back at a freight agent, losing the deposit: no money in a take-and-return loop', () => {
    const w = world('loop');
    const start = w.captain.purse;
    let at = 0;
    for (let i = 0; i < 20; i++) {
      const o = findOffer(w, 'port.duluth', at);
      at = o.at;
      acceptContract(w.src(at), w.captain, T1, 'port.duluth', o.terms.id);
      expect(abandonContract(defs, w.state, w.captain, o.terms.id, 'port.duluth', at).ok).toBe(
        true,
      );
    }
    expect(w.captain.purse).toBeLessThan(start);
    expect(w.captain.cargo).toEqual([]);
    expect(w.state.tally.abandoned).toBe(20);
    expect(abandonContract(defs, w.state, w.captain, 'x', 'port.la_pointe', at)).toEqual({
      ok: false,
      reason: 'unknown',
    });
  });
});

describe('the Seavey temptation (criterion 9)', () => {
  it('pays the market once, zeroes the shipper for good, and it never offers again', () => {
    const w = world('theft');
    // Earn some Standing with Hollister first.
    w.captain.standing['company.hollister_fish'] = 40;
    const { terms, at } = findOffer(
      w,
      'port.bayfield',
      0,
      (t) => t.company === 'company.hollister_fish' && t.good === 'good.salted_fish',
    );
    acceptContract(w.src(at), w.captain, T1, 'port.bayfield', terms.id);
    const port = terms.to === 'port.ashland' ? 'port.duluth' : 'port.ashland';
    const expected = quote(econ, w.markets, port, terms.good, terms.qty, 'sell', at).totalCents;
    const purse = w.captain.purse;
    const r = stealContract(defs, econ, w.markets, w.state, w.captain, terms.id, port, at + 3600);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.event).toMatchObject({
      contractId: terms.id,
      company: 'company.hollister_fish',
      port,
    });
    expect(w.captain.purse - purse).toBe(expected);
    expect(w.captain.cargo).toEqual([]);
    expect(w.captain.standing['company.hollister_fish']).toBe(0);
    expect(w.state.burned).toEqual(['company.hollister_fish']);
    // Once only: nothing left to sell.
    expect(stealContract(defs, econ, w.markets, w.state, w.captain, terms.id, port, at)).toEqual({
      ok: false,
      reason: 'unknown',
    });
    // Never another offer from Hollister, on any board, and its Standing never comes back.
    for (let day = 0; day < 104; day++) {
      for (const p of econ.markets.keys()) {
        for (const o of boardOffers(w.src(day * DAY), p)) {
          expect(o.terms.company).not.toBe('company.hollister_fish');
        }
      }
    }
    const other = findOffer(w, 'port.duluth', at);
    acceptContract(w.src(other.at), w.captain, T1, 'port.duluth', other.terms.id);
    arriveAt(defs, w.state, w.captain, other.terms.to, other.at + 3600);
    expect(w.captain.standing['company.hollister_fish']).toBe(0);
  });

  it("can't sell the mail, or where nobody buys the good", () => {
    const w = world('mail');
    const { terms, at } = findOffer(w, 'port.duluth', 0, (t) => t.good === 'parcel.mail');
    acceptContract(w.src(at), w.captain, T1, 'port.duluth', terms.id);
    expect(
      stealContract(defs, econ, w.markets, w.state, w.captain, terms.id, 'port.superior', at),
    ).toEqual({ ok: false, reason: 'notTraded' });
  });
});

describe('what Standing opens (plan 05 §5.2)', () => {
  it('gives deposit credit, more pay, and a shipyard discount up to 15%', () => {
    const r = defs.rules;
    expect(depositCredit(r, 0)).toBe(1);
    expect(depositCredit(r, r.depositHalfAt)).toBe(0.5);
    expect(depositCredit(r, r.depositWaivedAt)).toBe(0);
    expect(shipyardDiscount(0)).toBe(0);
    expect(shipyardDiscount(100)).toBeCloseTo(0.15);
    const low = world('perks');
    const high = world('perks');
    high.captain.standing['port.duluth'] = 100;
    const a = boardOffers(low.src(0), 'port.duluth').filter((o) => o.terms.tier === 'open');
    const b = boardOffers(high.src(0), 'port.duluth').filter((o) => o.terms.tier === 'open');
    expect(a.length).toBeGreaterThan(0);
    for (const [i, o] of a.entries()) {
      const h = must(b[i]);
      expect(h.terms.payCents).toBeGreaterThan(o.terms.payCents);
      expect(h.terms.depositCents).toBe(0);
    }
  });
});

describe('contracts in the game', () => {
  const setup = () => {
    const state = createWorldState('contracts-game');
    const ctx = { state, events: new EventBus<GameEvents>() } as unknown as GameContext;
    const { hazards } = createSchooner(0, 0, 0);
    const economy = attachEconomy(ctx, hazards);
    const contracts = attachContracts(ctx, economy, 'run-test');
    const shown: (PortSnapshot | undefined)[] = [];
    const ports = attachPorts({
      ctx,
      economy,
      contracts,
      hazards,
      berthPier: (id) => id.replace(/\.(north|south)\d*$/, ''),
      showPort: (s) => shown.push(s),
      showJournal: () => undefined,
      onOpen: () => undefined,
      castOff: () => undefined,
    });
    const events: string[] = [];
    for (const k of [
      'ContractAccepted',
      'ContractCompleted',
      'ContractFailed',
      'ContractStolen',
    ] as const) {
      ctx.events.on(k, () => events.push(k));
    }
    return { ctx, hazards, contracts, ports, shown, events };
  };

  it('takes an offer on the freight tab and delivers on docking at its destination', () => {
    const { ctx, hazards, contracts, ports, shown, events } = setup();
    ports.open('port.duluth');
    const snap = must(shown.at(-1));
    expect(snap.tabs).toContain('freight');
    const offer = must(must(snap.freight).offers.find((o) => !o.blocked));
    expect(ports.actions.acceptContract(offer.id)).toBeUndefined();
    expect(hazards.state.cargo01).toBeGreaterThan(0);
    expect(must(shown.at(-1)?.freight).held[0]?.id).toBe(offer.id);
    expect(must(shown.at(-1)).hold.some((h) => h.contractId === offer.id)).toBe(true);
    ports.close();
    const to = must(contracts.state.active[0]).to;
    ports.open(to);
    expect(must(shown.at(-1)).notices[0]).toMatch(/^Delivered/);
    expect(events).toEqual(['ContractAccepted', 'ContractCompleted']);
    expect(ctx.state.player.standing?.['port.duluth']).toBeGreaterThan(0);
    // The ledger lists it as done, and Standing with the ports.
    const ledger = must(shown.at(-1)).ledger;
    expect(ledger.contracts[0]?.done).toBe(true);
    expect(ledger.standing.map((s) => s.id)).toContain('port.duluth');
  });

  it('fails a contract on the world tick, and counts hard knocks on fragile cargo', () => {
    const { ctx, contracts, events } = setup();
    const w = { state: contracts.state };
    const o = must(contracts.board('port.duluth').find((b) => !b.locked));
    expect(contracts.accept('port.duluth', o.terms.id).ok).toBe(true);
    const c = must(w.state.active[0]);
    ctx.events.emit('ShipStruck', { shipId: 'ship.player', what: 'rock', speedKn: 4, damage: 1 });
    expect(c.hits).toBe(c.kind === 'fragile' ? 1 : 0);
    ctx.events.emit('WorldTick', { gameSeconds: c.expiresAt + 1 });
    expect(c.status).toBe('failed');
    expect(events).toEqual(['ContractAccepted', 'ContractFailed']);
  });

  it('steals from the hold on the market tab, raising ContractStolen and a trade', () => {
    const { ctx, ports, shown, events } = setup();
    ports.open('port.bayfield');
    const offer = must(
      must(shown.at(-1)?.freight).offers.find((o) => !o.blocked && o.cargo !== 'Mail sacks'),
    );
    ports.actions.acceptContract(offer.id);
    ports.close();
    const trades: string[] = [];
    ctx.events.on('TradeCompleted', (t) => trades.push(t.good));
    // Find a port that buys it and isn't its destination.
    for (const p of econ.markets.keys()) {
      ports.open(p);
      const row = must(shown.at(-1)).hold.find((h) => h.contractId === offer.id);
      if (row?.stealCents !== undefined) {
        expect(ports.actions.stealContract(offer.id)).toBeUndefined();
        break;
      }
      ports.close();
    }
    expect(events).toContain('ContractStolen');
    expect(trades).toHaveLength(1);
  });
});

describe('the contracts slice in the save', () => {
  it('fills an empty slice and Standing for a save from before piece F', () => {
    const fixture = JSON.parse(
      readFileSync(join(import.meta.dirname, 'fixtures', 'saves', 'v6.json'), 'utf8'),
    ) as { saveVersion: number; state: Record<string, unknown> };
    const parsed = parseWorldState(migrateSave(fixture.state, fixture.saveVersion));
    expect(parsed.contracts).toEqual(createContractsState());
    expect(parsed.player.standing).toEqual({});
  });

  it('round-trips a run with a contract in hand', () => {
    const state = createWorldState('save');
    const w = world('save');
    const { terms, at } = findOffer(w, 'port.duluth', 0);
    acceptContract(w.src(at), w.captain, T1, 'port.duluth', terms.id);
    state.contracts = w.state;
    state.player.cargo = w.captain.cargo;
    state.player.standing = { 'port.duluth': 12 };
    const back = worldStateSchema.parse(JSON.parse(JSON.stringify(state)));
    expect(back.contracts).toEqual(w.state);
    expect(back.player.cargo[0]?.contract).toBe(terms.id);
  });
});
