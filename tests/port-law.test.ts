import { describe, expect, it } from 'vitest';
import { EventBus } from '../src/core/events';
import { WORLD_TICK_GAME_SECONDS } from '../src/core/time';
import { attachEconomy } from '../src/gameplay/economy';
import { attachLaw } from '../src/gameplay/law';
import { attachPortLaw } from '../src/gameplay/port-law';
import type { GameContext, GameEvents } from '../src/modes/context';
import { gameEconomy } from '../src/sim/economy/defs';
import { offerLot, type MerchantMemory } from '../src/sim/economy/contraband';
import { compileLaw, gameLaw, wantedTier } from '../src/sim/law/defs';
import { commitCrime, heatIn, setHeat, setTier } from '../src/sim/law/law';
import {
  harborTerms,
  holdChecked,
  informChance,
  payHarborMaster,
  posterFor,
  searchFactor,
} from '../src/sim/law/port-law';
import { createLawState } from '../src/sim/law/state';
import { createWorldState } from '../src/sim/world-state';
import {
  harborSnapshot,
  ledgerLawSnapshot,
  reportSnapshot,
  wantedSnapshot,
} from '../src/ui/port/harbor-model';
import { portSnapshot } from '../src/ui/port/model';

/**
 * Port law (plan 06 §3.3, §5.2; Phase 5 piece E): the harbor master's fines and bribes,
 * the search of the hold on docking at tier 2+, posters, receivers who inform, and the
 * law's lines for the HUD, the ledger and the chart.
 */

const defs = gameLaw();
const CHEQ = 'region.chequamegon';
const NOON = 12 * 3600;

function law() {
  return createLawState('ship.schooner_t1', 'Lark', 0);
}

describe('the harbor master (plan 06 §3.3)', () => {
  it('has nothing to say to a clean captain', () => {
    const t = harborTerms(defs, law(), CHEQ);
    expect(t.tier).toBe(0);
    expect(t.quote).toBeUndefined();
    expect(t.refusal).toBe('clean');
  });

  it('takes a fine at tiers 1–2 that clears the region', () => {
    const l = law();
    setHeat(defs, l, CHEQ, 40);
    const t = harborTerms(defs, l, CHEQ);
    expect(t.quote).toMatchObject({ kind: 'fine', cents: 40 * 150, toHeat: 0, toTier: 0 });
    setHeat(defs, l, CHEQ, 100);
    expect(harborTerms(defs, l, CHEQ).quote).toMatchObject({ kind: 'fine', cents: 15_000 });
    const purse = { purse: 20_000 };
    const r = payHarborMaster(defs, l, purse, CHEQ, 'fine');
    expect(r.ok).toBe(true);
    expect(purse.purse).toBe(5_000);
    expect(heatIn(l, CHEQ)).toBe(0);
    expect(r.ok && r.events.map((e) => e.type)).toContain('WantedTierChanged');
  });

  it('takes a bribe at tiers 3–4 for a tier down, and nothing at tier 5', () => {
    const l = law();
    setHeat(defs, l, CHEQ, 200);
    const t3 = harborTerms(defs, l, CHEQ);
    expect(t3.quote).toMatchObject({ kind: 'bribe', toHeat: 60, toTier: 2, cents: 140 * 300 });
    setHeat(defs, l, CHEQ, 400);
    const t4 = harborTerms(defs, l, CHEQ);
    expect(t4.quote).toMatchObject({ kind: 'bribe', toHeat: 150, toTier: 3 });
    const purse = { purse: 1_000_000 };
    expect(payHarborMaster(defs, l, purse, CHEQ, 'fine')).toEqual({
      ok: false,
      reason: 'notOffered',
    });
    expect(payHarborMaster(defs, l, purse, CHEQ, 'bribe').ok).toBe(true);
    // A bribe from tier 4 lifts the floor too: decay can take it on down from here.
    expect(heatIn(l, CHEQ)).toBe(150);
    expect(l.wanted[CHEQ]?.floor ?? 0).toBeLessThan(150);
    setTier(defs, l, CHEQ, 5);
    const t5 = harborTerms(defs, l, CHEQ);
    expect(t5.quote).toBeUndefined();
    expect(t5.refusal).toBe('tooNotorious');
    expect(payHarborMaster(defs, l, purse, CHEQ, 'bribe')).toEqual({
      ok: false,
      reason: 'tooNotorious',
    });
  });

  it("asks the Saloon Keeper a quarter less, and won't take what you haven't got", () => {
    const l = law();
    setHeat(defs, l, CHEQ, 40);
    expect(harborTerms(defs, l, CHEQ, true).quote?.cents).toBe(4_500);
    const purse = { purse: 100 };
    expect(payHarborMaster(defs, l, purse, CHEQ, 'fine')).toEqual({ ok: false, reason: 'noMoney' });
    expect(purse.purse).toBe(100);
    expect(heatIn(l, CHEQ)).toBe(40);
  });

  it('clears petty heat end to end: a crime, a report, a fine (criterion 10)', () => {
    const w = { law: law(), standing: {}, seed: 's' };
    commitCrime(
      defs,
      w,
      {
        crime: 'crime.contraband',
        region: CHEQ,
        witnesses: [
          { id: 'h', kind: 'harborMaster', name: 'the harbor master', identification: 'person' },
        ],
      },
      NOON,
    );
    expect(wantedTier(defs, heatIn(w.law, CHEQ))).toBe(1);
    expect(payHarborMaster(defs, w.law, { purse: 10_000 }, CHEQ, 'fine').ok).toBe(true);
    expect(heatIn(w.law, CHEQ)).toBe(0);
  });
});

describe('the search, informants and posters by tier', () => {
  it('searches the hold from tier 2, harder as it climbs', () => {
    expect(holdChecked(defs, 1)).toBe(false);
    expect(holdChecked(defs, 2)).toBe(true);
    const f = [2, 3, 4, 5].map((t) => searchFactor(defs, t));
    expect(f).toEqual([...f].sort((a, b) => a - b));
  });

  it('lets receivers and the smuggler inform from tier 2', () => {
    expect(informChance(defs, 0)).toBe(0);
    expect(informChance(defs, 1)).toBe(0);
    expect(informChance(defs, 2)).toBeGreaterThan(0);
    expect(informChance(defs, 5)).toBeGreaterThan(informChance(defs, 3));
  });

  it('puts up a poster at tier 2, with a reward from tier 3 and the rope at 5', () => {
    const l = law();
    setTier(defs, l, CHEQ, 1);
    expect(posterFor(defs, l, CHEQ)).toBeUndefined();
    setTier(defs, l, CHEQ, 2);
    expect(posterFor(defs, l, CHEQ)).toMatchObject({ headline: 'WANTED', rewardCents: 0 });
    setTier(defs, l, CHEQ, 3);
    expect(posterFor(defs, l, CHEQ)?.headline).toBe('WANTED: REWARD');
    expect(posterFor(defs, l, CHEQ)?.rewardCents).toBeGreaterThan(0);
    setTier(defs, l, CHEQ, 5);
    expect(posterFor(defs, l, CHEQ)?.headline).toBe('WANTED: DEAD OR ALIVE');
    // Heat set outright carries no ship share: the poster names the captain.
    expect(posterFor(defs, l, CHEQ)?.subject).toBe('person');
    const w = l.wanted[CHEQ];
    if (w) w.shipHeat = w.heat;
    expect(posterFor(defs, l, CHEQ)?.subject).toBe('ship');
  });
});

describe('a receiver who informs (plan 05 §23.4)', () => {
  const econ = gameEconomy();
  const lot = () => ({
    purse: 0,
    cargo: [{ good: 'good.untaxed_whiskey', qty: 12 }],
  });

  it('takes the lot without a word below tier 2', () => {
    const trader = lot();
    const memory: MerchantMemory = { refusals: {}, receivers: ['port.bayfield'] };
    const r = offerLot(econ, {}, trader, memory, 'port.bayfield', 0, NOON, 'seed', undefined, 0);
    expect(r).toMatchObject({ ok: true, outcome: 'sold', receiver: 'known' });
  });

  it('turns you in, and is your receiver no more, when the odds say so', () => {
    const trader = lot();
    const memory: MerchantMemory = { refusals: {}, receivers: ['port.bayfield'] };
    const r = offerLot(econ, {}, trader, memory, 'port.bayfield', 0, NOON, 'seed', undefined, 1);
    expect(r).toMatchObject({ ok: true, outcome: 'confiscated', event: { informed: true } });
    expect(trader.cargo).toHaveLength(0);
    expect(memory.receivers).toEqual([]);
    expect(Object.keys(memory.refusals)).toEqual(['port.bayfield']);
  });
});

describe('port law in the running game', () => {
  const setup = (lawDefs = defs) => {
    const state = createWorldState('port-law', NOON);
    const events = new EventBus<GameEvents>();
    const ctx = { state, events } as unknown as GameContext;
    const economy = attachEconomy(ctx, undefined);
    const law = attachLaw(ctx, 'seed', lawDefs);
    const portLaw = attachPortLaw(ctx, law, economy);
    const seen: string[] = [];
    events.tap((type) => seen.push(type));
    return { state, events, economy, law, portLaw, seen };
  };

  it('leaves the hold alone below tier 2, and says nothing', () => {
    const { state, portLaw, law, seen } = setup();
    law.setTier(CHEQ, 1);
    state.player.cargo = [{ good: 'good.untaxed_whiskey', qty: 12 }];
    expect(portLaw.dockCheck('port.bayfield')).toEqual([]);
    expect(state.player.cargo).toHaveLength(1);
    expect(seen).not.toContain('HoldSearched');
  });

  it('searches at tier 2+, takes what it finds, and the harbor master files at once', () => {
    // A harbor master who never misses, so the test doesn't hang on a roll.
    const sure = compileLaw([...defs.crimes.values()], defs.wanted, defs.fame, [...defs.regions], {
      ...defs.actors,
      harborMaster: { ...defs.actors.harborMaster, searchByTier: [0, 0, 100, 100, 100, 100] },
    });
    const { state, portLaw, law, seen } = setup(sure);
    law.setTier(CHEQ, 2);
    const before = heatIn(state, CHEQ);
    state.player.cargo = [
      { good: 'good.untaxed_whiskey', qty: 12 },
      { good: 'good.flour', qty: 5 },
    ];
    const notes = portLaw.dockCheck('port.bayfield');
    expect(notes[0]).toMatch(/took 12 CU of untaxed whiskey/);
    expect(state.player.cargo.map((s) => s.good)).toEqual(['good.flour']);
    expect(seen).toContain('HoldSearched');
    expect(seen).toContain('ReportFiled');
    expect(heatIn(state, CHEQ)).toBeGreaterThan(before);
    // Docking again the same day finds nothing new.
    expect(portLaw.dockCheck('port.bayfield')[0]).toMatch(/found nothing/);
  });

  it('pays the harbor master from the purse and raises the event', () => {
    const { state, portLaw, law, seen } = setup();
    law.setHeat(CHEQ, 30);
    state.player.purse = 10_000;
    expect(portLaw.pay('port.bayfield', 'fine')).toMatch(/Fine paid, \$45/);
    expect(state.player.purse).toBe(10_000 - 4_500);
    expect(seen).toContain('HarborMasterPaid');
    expect(portLaw.pay('port.bayfield', 'fine')).toMatch(/nothing against you/);
  });

  it('reads the region tier for receivers, and knows a Most Wanted harbor', () => {
    const { economy, portLaw, law } = setup();
    expect(economy.informChance('port.bayfield')).toBe(0);
    law.setTier(CHEQ, 3);
    expect(economy.informChance('port.bayfield')).toBe(informChance(defs, 3));
    expect(economy.informChance('port.duluth')).toBe(0);
    expect(portLaw.topTierAt('port.bayfield')).toBe(false);
    law.setTier(CHEQ, 5);
    expect(portLaw.topTierAt('port.bayfield')).toBe(true);
    expect(portLaw.topTierAt('port.washburn')).toBe(true);
    expect(portLaw.marks()).toEqual([
      { region: CHEQ, tier: 5, label: 'Chequamegon Bay: MOST WANTED' },
    ]);
  });

  it('lets the smuggler sell you out at tier 2+ in her waters', () => {
    const always = compileLaw(
      [...defs.crimes.values()],
      defs.wanted,
      defs.fame,
      [...defs.regions],
      {
        ...defs.actors,
        harborMaster: { ...defs.actors.harborMaster, informByTier: [0, 0, 1, 1, 1, 1] },
      },
    );
    const { state, events, law } = setup(always);
    const deal = () =>
      events.emit('SmugglerDealt', {
        smuggler: 'smuggler.whippoorwill',
        side: 'buy',
        good: 'good.untaxed_whiskey',
        qty: 1,
        totalCents: 3000,
        hot: false,
      });
    deal();
    expect(state.reports.inProgress).toHaveLength(0);
    law.setTier('region.apostles', 2);
    state.environment.clock.gameSeconds += 24 * 3600;
    deal();
    expect(state.reports.inProgress[0]?.witness).toMatchObject({
      kind: 'informant',
      name: 'the smuggler',
    });
  });

  it('turns an informing receiver into a crime with him as the witness', () => {
    const { state, events } = setup();
    events.emit('HotGoodsDetected', {
      port: 'port.bayfield',
      region: CHEQ,
      good: 'good.untaxed_whiskey',
      qty: 12,
      kind: 'contraband',
      outcome: 'confiscated',
      heat: 0,
      informed: true,
    });
    expect(state.reports.inProgress[0]?.witness).toMatchObject({
      kind: 'informant',
      name: 'your receiver',
    });
  });
});

describe("the law's lines for the screens", () => {
  const view = (l = law()) => ({
    defs,
    law: l,
    gameSeconds: NOON,
    shipName: 'Lark',
    captainName: 'Ada Reid',
  });

  it('builds the harbor tab with the deal, the poster and the notes', () => {
    const l = law();
    setTier(defs, l, CHEQ, 3);
    const h = harborSnapshot(view(l), CHEQ, 100, false);
    expect(h).toMatchObject({
      regionName: 'Chequamegon Bay',
      tierName: 'Hunted',
      holdChecked: true,
      quote: { kind: 'bribe', label: 'Grease his palm', affordable: false },
    });
    expect(h.quote?.effect).toMatch(/down to Wanted/);
    expect(h.poster).toMatchObject({ headline: 'WANTED: REWARD', subject: 'Captain Ada Reid' });
    expect(h.informRisk).toBeTruthy();
    setTier(defs, l, CHEQ, 5);
    expect(harborSnapshot(view(l), CHEQ, 0, false).refusalText).toMatch(/rope/);
  });

  it('gives the HUD its tier and the soonest report with a timer', () => {
    const w = { law: law(), standing: {}, seed: 's' };
    expect(wantedSnapshot(defs, w.law, CHEQ)).toMatchObject({ tier: 0, tierName: 'Clean' });
    expect(reportSnapshot(defs, w.law, NOON)).toBeUndefined();
    commitCrime(
      defs,
      w,
      {
        crime: 'crime.smuggler_deal',
        region: 'region.apostles',
        witnesses: [{ id: 'k', kind: 'keeper', name: 'Raspberry keeper', identification: 'ship' }],
      },
      NOON,
    );
    const r = reportSnapshot(defs, w.law, NOON);
    expect(r).toMatchObject({ by: 'Raspberry keeper', regionName: 'Apostle Islands', more: 0 });
    expect(r?.etaText).toMatch(/\d+ h \d\d m|\d+ m/);
    setTier(defs, w.law, CHEQ, 5);
    expect(wantedSnapshot(defs, w.law, CHEQ)).toMatchObject({ top: true });
    const ledger = ledgerLawSnapshot(defs, w.law, NOON);
    expect(ledger.fameTierName).toBe('Unknown');
    expect(ledger.wanted[0]).toMatchObject({ name: 'Chequamegon Bay', tierName: 'Most Wanted' });
    expect(ledger.reports[0]?.text).toMatch(/^Raspberry keeper, to Apostle Islands: in /);
  });

  it('puts a harbor master tab before the ledger on the port screen', () => {
    const state = createWorldState('tab', NOON);
    const events = new EventBus<GameEvents>();
    const ctx = { state, events } as unknown as GameContext;
    const economy = attachEconomy(ctx, undefined);
    const portLaw = attachPortLaw(ctx, attachLaw(ctx, 'seed'), economy);
    const snap = portSnapshot({
      defs: economy.defs,
      markets: state.markets,
      knowledge: state.knowledge.prices,
      trader: state.player,
      capacity: 40,
      load01: 0,
      cargoSpeedLoss: 0,
      port: 'port.bayfield',
      gameSeconds: NOON,
    });
    // The game adds it (gameplay/port.ts); the model knows the tab.
    snap.harbor = portLaw.harbor('port.bayfield');
    expect(snap.harbor?.refusalText).toMatch(/nods you through/);
    events.emit('WorldTick', { gameSeconds: NOON + WORLD_TICK_GAME_SECONDS });
  });
});
