import { describe, expect, it } from 'vitest';
import { EventBus } from '../src/core/events';
import { Rng } from '../src/core/rng';
import { SECONDS_PER_GAME_DAY } from '../src/core/time';
import { attachEconomy } from '../src/gameplay/economy';
import { attachPorts } from '../src/gameplay/port';
import { attachRumors } from '../src/gameplay/rumors';
import { createSchooner } from '../src/gameplay/schooner';
import type { GameContext, GameEvents } from '../src/modes/context';
import { westernSuperiorChart } from '../src/sim/chart/chart-data';
import { createContacts } from '../src/sim/chart/traffic';
import { gameEconomy } from '../src/sim/economy/defs';
import { recordPrices, type PriceKnowledge } from '../src/sim/economy/knowledge';
import {
  addRumor,
  hailRumor,
  isStale,
  knowsRumor,
  noteHeardPrices,
  rumorDefs,
  rumorDrafts,
  saloonTerms,
  tellRumor,
  type RumorWorld,
} from '../src/sim/rumors/rumors';
import { placeholderSmugglerAnchorage } from '../src/sim/rumors/sources';
import { gameTraffic } from '../src/sim/traffic/cargo';
import { upcomingSailings } from '../src/sim/traffic/news';
import { createWorldState, parseWorldState, type Rumor } from '../src/sim/world-state';
import { portSnapshot, type PortSnapshot } from '../src/ui/port/model';

/** Phase 4 piece K: rumors and price news (plan 05 §4.3, §9). */

const DAY = SECONDS_PER_GAME_DAY;
const economy = gameEconomy();
const geo = westernSuperiorChart();
const tdefs = gameTraffic();
const contacts = createContacts(geo.projection, 'rumors-traffic', 0).filter((c) => c.schedule);
const T0 = 3 * DAY + 13 * 3600;

const world = (state = createWorldState('rumors')): RumorWorld => ({
  economy,
  markets: state.markets,
  traffic: { defs: tdefs, contacts },
  weather: { state: state.environment.weather, geo },
  smugglerAnchorage: placeholderSmugglerAnchorage,
});

const rng = (seed: string) => {
  const r = Rng.fromSeed(seed);
  return () => r.next();
};

/** Tells `n` rumors in a row at one port, as a captain buying rounds would. */
function tellMany(port: string, n: number, seed: string, bonus = 0): Rumor[] {
  const w = world();
  const heard: Rumor[] = [];
  const rand = rng(seed);
  for (let i = 0; i < n; i++) {
    const t = tellRumor(w, heard, port, T0 + i * DAY, rand, { reliabilityBonus: bonus });
    if (t) addRumor(heard, t.rumor);
  }
  return heard;
}

describe('rumors.json', () => {
  it('prices a round between $0.25 and $2 (plan 05 §9)', () => {
    const d = rumorDefs();
    for (const c of Object.values(d.roundCents)) {
      expect(c).toBeGreaterThanOrEqual(25);
      expect(c).toBeLessThanOrEqual(200);
    }
  });

  it('tells each legend in saloons that exist, and names real islands', () => {
    const ports = new Set(economy.markets.keys());
    for (const l of rumorDefs().legends)
      for (const p of l.ports) expect(ports.has(p), l.id).toBe(true);
  });
});

describe('what the saloon can tell', () => {
  it('draws shipment tips from the real timetable, from this port or its zone', () => {
    const drafts = rumorDrafts(world(), [], 'port.ashland', T0, rng('a'));
    const ships = drafts.filter((d) => d.kind === 'shipment');
    expect(ships.length).toBeGreaterThan(0);
    const sailings = upcomingSailings(tdefs, economy, contacts, T0, 2);
    for (const d of ships) {
      expect(sailings.some((s) => `${s.shipId}@${Math.round(s.at)}` === d.subject)).toBe(true);
    }
  });

  it('talks of the smuggler only in the Apostles and Chequamegon saloons', () => {
    const kinds = (port: string) => rumorDrafts(world(), [], port, T0, rng('s')).map((d) => d.kind);
    expect(kinds('port.bayfield')).toContain('smuggler');
    expect(kinds('port.la_pointe')).toContain('smuggler');
    expect(kinds('port.duluth')).not.toContain('smuggler');
    expect(kinds('port.two_harbors')).not.toContain('smuggler');
  });

  it('tells every kind over a season, and every true tip names what the sim holds', () => {
    const heard = tellMany('port.bayfield', 60, 'season');
    const kinds = new Set(heard.map((r) => r.kind));
    for (const k of ['shipment', 'price', 'weather', 'smuggler', 'legend'] as const) {
      expect(kinds, k).toContain(k);
    }
    for (const r of heard) {
      expect(r.text.length).toBeGreaterThan(20);
      expect(r.text).not.toMatch(/[{}]/);
      expect(r.reliability).toBeGreaterThan(0);
      expect(r.reliability).toBeLessThan(1);
    }
  });

  it('is false about as often as its reliability says', () => {
    const heard: Rumor[] = [];
    for (let s = 0; s < 40; s++) heard.push(...tellMany('port.ashland', 3, `rel-${s}`));
    const told = heard.filter((r) => r.kind !== 'legend');
    const expected = told.reduce((sum, r) => sum + r.reliability, 0) / told.length;
    const actual = told.filter((r) => r.truth).length / told.length;
    expect(Math.abs(actual - expected)).toBeLessThan(0.1);
  });

  it('gives the Saloon Keeper truer talk (plan 12 §2.2)', () => {
    const mean = (bonus: number) => {
      const all: Rumor[] = [];
      for (let s = 0; s < 20; s++) all.push(...tellMany('port.duluth', 3, `sk-${s}`, bonus));
      return all.reduce((sum, r) => sum + r.reliability, 0) / all.length;
    };
    expect(mean(rumorDefs().saloonKeeper.reliabilityBonus) - mean(0)).toBeGreaterThan(0.1);
  });

  it("doesn't tell the same legend or a known smuggler twice", () => {
    const w = world();
    const heard: Rumor[] = [];
    const rand = rng('dedupe');
    for (let i = 0; i < 80; i++) {
      const t = tellRumor(w, heard, 'port.la_pointe', T0, rand);
      if (!t) break;
      heard.push(t.rumor);
    }
    const legends = heard.filter((r) => r.kind === 'legend').map((r) => r.draft);
    expect(new Set(legends).size).toBe(legends.length);
    const trueSmuggler = heard.filter((r) => r.kind === 'smuggler' && r.truth);
    expect(trueSmuggler.length).toBeLessThanOrEqual(1);
  });

  it("marks the smuggler's spot known only from a true rumor", () => {
    const base: Rumor = {
      id: 'r1',
      kind: 'smuggler',
      source: 'saloon',
      heardAt: 0,
      text: 'x',
      reliability: 0.8,
      truth: false,
      draft: 'anchorage.oak_lee',
      subject: 'anchorage.sand_east',
    };
    expect(knowsRumor([base], 'smuggler')).toBe(false);
    expect(knowsRumor([{ ...base, truth: true, subject: 'anchorage.oak_lee' }], 'smuggler')).toBe(
      true,
    );
  });

  it('goes stale when the sailing or the weather has come', () => {
    const ship = tellMany('port.ashland', 40, 'stale').find((r) => r.kind === 'shipment');
    expect(ship?.expiresAt).toBeDefined();
    if (!ship?.expiresAt) return;
    expect(isStale(ship, ship.expiresAt - 1)).toBe(false);
    expect(isStale(ship, ship.expiresAt + 1)).toBe(true);
  });
});

describe('price news in the ledger (plan 05 §4.3)', () => {
  it('writes heard prices only over older ones, marked heard', () => {
    const state = createWorldState('heard');
    const k: PriceKnowledge = {};
    recordPrices(k, economy, state.markets, 'port.duluth', 2 * DAY);
    const seen = k['port.duluth']?.['good.flour'];
    expect(
      noteHeardPrices(
        k,
        'port.duluth',
        [{ good: 'good.flour', buyCents: 1, sellCents: 1 }],
        DAY,
        'rumor',
      ),
    ).toBe(0);
    expect(k['port.duluth']?.['good.flour']).toEqual(seen);
    expect(
      noteHeardPrices(
        k,
        'port.duluth',
        [{ good: 'good.flour', buyCents: 9, sellCents: 8 }],
        3 * DAY,
        'hail',
      ),
    ).toBe(1);
    expect(k['port.duluth']?.['good.flour']).toEqual({
      buyCents: 9,
      sellCents: 8,
      seenAt: 3 * DAY,
      heard: 'hail',
    });
  });

  it('turns a hail into a shipment rumor the hailed ship vouches for', () => {
    const r = hailRumor(
      {
        shipId: 'ship.a',
        prices: undefined,
        rumor: '"Gogebic is loading iron ore at Ashland, sailing tomorrow."',
        tip: {
          shipId: 'ship.b',
          good: 'good.iron_ore',
          fromPort: 'port.ashland',
          toPort: undefined,
          at: DAY,
        },
      },
      'Wren',
      0,
    );
    expect(r).toMatchObject({ kind: 'shipment', source: 'hail', truth: true, teller: 'the Wren' });
    expect(r?.text).toBe('Gogebic is loading iron ore at Ashland, sailing tomorrow.');
  });
});

describe('the saloon at the pier', () => {
  const setup = (background: 'deckhand' | 'saloon_keeper' = 'deckhand') => {
    const state = createWorldState('saloon');
    state.player.captain.background = background;
    state.environment.clock.gameSeconds = T0;
    const ctx = {
      state,
      events: new EventBus<GameEvents>(),
      rng: Rng.fromSeed('saloon'),
    } as unknown as GameContext;
    const { hazards } = createSchooner(0, 0, 0);
    const econ = attachEconomy(ctx, hazards);
    const rumors = attachRumors({
      ctx,
      economy: econ.defs,
      traffic: { defs: tdefs, contacts },
      smugglerAnchorage: placeholderSmugglerAnchorage,
    });
    const shown: (PortSnapshot | undefined)[] = [];
    const ports = attachPorts({
      ctx,
      economy: econ,
      hazards,
      rumors,
      berthPier: () => undefined,
      showPort: (s) => shown.push(s),
      showJournal: () => undefined,
      onOpen: () => undefined,
      castOff: () => undefined,
    });
    return { ctx, ports, shown, rumors };
  };

  it('shows a saloon tab where the port has a tavern', () => {
    const { ports, shown } = setup();
    ports.open('port.bayfield');
    expect(shown.at(-1)?.tabs).toContain('saloon');
    expect(shown.at(-1)?.saloon?.roundCents).toBe(rumorDefs().roundCents.medium);
    const snap = portSnapshot({
      defs: economy,
      markets: createWorldState('x').markets,
      knowledge: {},
      trader: { purse: 0, cargo: [], stores: {} },
      capacity: 20,
      load01: 0,
      cargoSpeedLoss: 0.2,
      port: 'port.bayfield',
      gameSeconds: 0,
    });
    expect(snap.tabs).not.toContain('saloon');
  });

  it('sells rounds for rumors until the bar is talked out, and puts them in the ledger', () => {
    const { ctx, ports, shown } = setup();
    const heard: GameEvents['RumorHeard'][] = [];
    ctx.events.on('RumorHeard', (e) => heard.push(e));
    ports.open('port.duluth');
    const purse = ctx.state.player.purse;
    const n = rumorDefs().roundsPerDay;
    for (let i = 0; i < n; i++) expect(ports.actions.buyRound()).toBeUndefined();
    expect(ports.actions.buyRound()).toBe("The bar's talked out for today.");
    expect(ctx.state.player.purse).toBe(purse - n * rumorDefs().roundCents.huge);
    expect(heard).toHaveLength(n);
    expect(ctx.state.knowledge.rumors).toHaveLength(n);
    const last = shown.at(-1);
    expect(last?.saloon?.heard).toHaveLength(n);
    expect(last?.saloon?.roundsLeft).toBe(0);
    expect(last?.ledger.rumors).toHaveLength(n);
    // A price tip went in the ledger as heard.
    const priceTip = ctx.state.knowledge.rumors.find((r) => r.kind === 'price');
    if (priceTip) {
      const heardPrices = Object.values(ctx.state.knowledge.prices).flatMap((b) =>
        Object.values(b).filter((p) => p.heard === 'rumor'),
      );
      expect(heardPrices.length).toBeGreaterThan(0);
    }
    // The next day there's new talk.
    ctx.state.environment.clock.gameSeconds += DAY;
    expect(ports.actions.buyRound()).toBeUndefined();
  });

  it('stands the Saloon Keeper the first round', () => {
    const { ctx, ports } = setup('saloon_keeper');
    const purse = ctx.state.player.purse;
    ports.open('port.bayfield');
    expect(saloonTerms(economy, [], 'port.bayfield', T0, 'saloon_keeper').free).toBe(true);
    ports.actions.buyRound();
    expect(ctx.state.player.purse).toBe(purse);
    ports.actions.buyRound();
    expect(ctx.state.player.purse).toBe(purse - rumorDefs().roundCents.medium);
  });

  it('refuses a round with an empty purse', () => {
    const { ctx, ports } = setup();
    ctx.state.player.purse = 0;
    ports.open('port.bayfield');
    expect(ports.actions.buyRound()).toBe("You haven't the money.");
  });

  it('keeps rumors through a save and load, and an old save starts with none', () => {
    const { ctx, ports } = setup();
    ports.open('port.bayfield');
    ports.actions.buyRound();
    const loaded = parseWorldState(JSON.parse(JSON.stringify(ctx.state)));
    expect(loaded.knowledge.rumors).toEqual(ctx.state.knowledge.rumors);
    const old = JSON.parse(JSON.stringify(createWorldState('old'))) as {
      knowledge: { rumors?: unknown };
    };
    delete old.knowledge.rumors;
    expect(parseWorldState(old).knowledge.rumors).toEqual([]);
  });

  it("writes a hailed ship's prices and tip into the ledger", () => {
    const { ctx } = setup();
    ctx.events.emit('ShipHailed', {
      shipId: contacts[0]?.id ?? 'x',
      news: {
        shipId: contacts[0]?.id ?? 'x',
        prices: {
          port: 'port.ashland',
          seenAt: T0 - DAY,
          prices: [{ good: 'good.iron_ore', buyCents: 300, sellCents: 280 }],
        },
        rumor: '"Something is sailing tomorrow."',
        tip: {
          shipId: 'ship.b',
          good: 'good.iron_ore',
          fromPort: 'port.ashland',
          toPort: undefined,
          at: T0 + DAY,
        },
      },
    });
    expect(ctx.state.knowledge.prices['port.ashland']?.['good.iron_ore']?.heard).toBe('hail');
    expect(ctx.state.knowledge.rumors[0]?.source).toBe('hail');
  });
});
