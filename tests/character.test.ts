import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { EventBus } from '../src/core/events';

import { attachCaptain } from '../src/gameplay/captain';
import type { GameContext, GameEvents } from '../src/modes/context';
import {
  allBackgrounds,
  allPortraits,
  backgroundDef,
  hasPerk,
} from '../src/sim/character/backgrounds';
import {
  createFirstWeek,
  firstWeekLines,
  stepForEvent,
  FIRST_WEEK_STEPS,
} from '../src/sim/character/first-week';
import {
  checkSetup,
  createNewRun,
  dawnSeconds,
  firstWeekContext,
  startingPort,
  type NewRunSetup,
} from '../src/sim/character/new-run';
import {
  forecastSkill,
  QUICK_HANDS_SAIL_TIME,
  SAIL_TRIMMER_BONUS,
  WEATHER_EYE_SKILL,
  withSailingPerks,
} from '../src/sim/character/perks';
import { forecastSpreadM, forecastWindSpread } from '../src/sim/chart/chart-weather';
import { gameEconomy } from '../src/sim/economy/defs';
import { layoutHarbors } from '../src/sim/harbors';
import { trimFactorAt } from '../src/sim/sailing/controller';
import { mooringBerths } from '../src/sim/sailing/hazards';
import { createSchooner } from '../src/gameplay/schooner';
import { loadZoneTerrain } from '../src/sim/terrain/load';
import { manifestFrame, zoneDef } from '../src/sim/terrain/zones';
import { sunAt } from '../src/sim/weather/celestial';
import { BACKGROUNDS, createWorldState, parseWorldState } from '../src/sim/world-state';
import { backgroundCards, randomSeed, savedRunSummary } from '../src/ui/menu/model';

/** Phase 4 piece C: character creation, the new run, perks and the First Week. */

const setup = (over: Partial<NewRunSetup> = {}): NewRunSetup => ({
  name: 'Ida Bergquist',
  shipName: 'Kittiwake',
  background: 'deckhand',
  portrait: 'portrait.weathered',
  seed: 'abc12345',
  ...over,
});

describe('backgrounds', () => {
  it('has plan 12’s six, each with two perks and a starting port with a market', () => {
    const list = allBackgrounds();
    expect(list.map((b) => b.key)).toEqual([...BACKGROUNDS]);
    const markets = gameEconomy().markets;
    for (const b of list) {
      expect(b.perks).toHaveLength(2);
      const start = startingPort(b.key);
      expect(markets.has(start.port), b.key).toBe(true);
      for (const c of b.cargo) expect(gameEconomy().goods.has(c.good), c.good).toBe(true);
      // Every starting cargo can be sold in the starting port (First Week step 1).
      for (const c of b.cargo) {
        expect(markets.get(start.port)?.goods.has(c.good), `${b.key} ${c.good}`).toBe(true);
      }
    }
  });

  it('starts each background in its plan 12 port, Duluth and Two Harbors as harder starts', () => {
    const ports = Object.fromEntries(BACKGROUNDS.map((k) => [k, startingPort(k).portName]));
    expect(ports).toEqual({
      deckhand: 'Bayfield',
      fisherman: 'Bayfield',
      lumberjack: 'Washburn',
      saloon_keeper: 'Duluth',
      ex_navy: 'Two Harbors',
      poacher: 'Bayfield',
    });
    expect(BACKGROUNDS.filter((k) => backgroundDef(k).harderStart)).toEqual([
      'saloon_keeper',
      'ex_navy',
    ]);
    // The Deckhand keeps piece A's start: $150 and 5 CU of rope and canvas.
    expect(backgroundDef('deckhand').purseCents).toBe(15_000);
  });

  it('builds a card per background for the picker, with later perks marked', () => {
    const cards = backgroundCards();
    expect(cards).toHaveLength(6);
    const navy = cards.find((c) => c.key === 'ex_navy');
    expect(navy?.harderStart).toBe(true);
    expect(navy?.perks.every((p) => p.later)).toBe(true);
    expect(cards.find((c) => c.key === 'deckhand')?.perks.some((p) => p.later)).toBe(false);
  });

  it('has portrait presets with unique ids', () => {
    const ids = allPortraits().map((p) => p.id);
    expect(ids.length).toBeGreaterThanOrEqual(6);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('a new run', () => {
  it('checks the names and the seed, trimming them', () => {
    const ok = checkSetup(setup({ name: '  Ida   Bergquist ', shipName: ' Kittiwake' }));
    expect(ok.problems).toEqual([]);
    expect(ok.setup.name).toBe('Ida Bergquist');
    expect(ok.setup.shipName).toBe('Kittiwake');
    expect(checkSetup(setup({ name: ' ', shipName: '', seed: '' })).problems).toEqual([
      'name',
      'shipName',
      'seed',
    ]);
    expect(checkSetup(setup({ portrait: 'portrait.nobody' })).problems).toEqual(['portrait']);
  });

  it('opens on May 7, 1900 at dawn', () => {
    const t = dawnSeconds();
    expect(t / 3600).toBeGreaterThan(4);
    expect(t / 3600).toBeLessThan(5.5);
    expect(sunAt(t).elevationRad).toBeGreaterThanOrEqual(0);
    expect(sunAt(t - 60).elevationRad).toBeLessThan(0);
  });

  it('gives the captain the background’s money, cargo, port and the First Week', () => {
    const state = createNewRun(setup({ background: 'saloon_keeper', portrait: 'portrait.woman' }));
    expect(state.player.captain).toEqual({
      name: 'Ida Bergquist',
      shipName: 'Kittiwake',
      background: 'saloon_keeper',
      portrait: 'portrait.woman',
    });
    expect(state.player.purse).toBe(18_000);
    expect(state.player.cargo).toEqual([{ good: 'good.whiskey', qty: 2 }]);
    expect(state.player.location).toEqual({ mode: 'zone', zoneId: 'zone.twin_ports' });
    expect(state.environment.clock.gameSeconds).toBe(dawnSeconds());
    expect(state.firstWeek).toEqual({ done: [], hidden: false });
    // It saves and loads like any run.
    const back = parseWorldState(JSON.parse(JSON.stringify(state)));
    expect(back.player.captain.portrait).toBe('portrait.woman');
    expect(back.firstWeek).toEqual({ done: [], hidden: false });
  });

  it('loads a run from before piece C without a portrait or a checklist', () => {
    const old = JSON.parse(JSON.stringify(createWorldState('x')));
    delete old.firstWeek;
    const state = parseWorldState(old);
    expect(state.firstWeek).toBeUndefined();
    expect(state.player.captain.portrait).toBeUndefined();
    expect(savedRunSummary(state).background).toBe('Deckhand');
  });

  it('makes shareable seeds', () => {
    let i = 0;
    const seq = [0, 0.5, 0.99];
    expect(randomSeed(() => seq[i++ % 3] as number)).toMatch(/^[a-z2-9]{8}$/);
  });

  it('sums up a saved run for Continue', () => {
    const s = savedRunSummary(createNewRun(setup()));
    expect(s.captain).toBe('Ida Bergquist');
    expect(s.shipName).toBe('Kittiwake');
    expect(s.where).toBe('Apostle Islands');
    expect(s.when).toMatch(/^Wk of May 7, 1900, 0[45]:\d\d$/);
    expect(s.purse).toBe('$150');
  });
});

describe('the starting piers', () => {
  const dirs: Record<string, string> = {
    'zone.apostles': 'apostles',
    'zone.twin_ports': 'twin_ports',
    'zone.two_harbors': 'two_harbors',
  };
  const baked = Object.values(dirs).every((d) => {
    const dir = join(__dirname, '..', 'public', 'world', d);
    return (
      existsSync(join(dir, 'manifest.json')) &&
      readFileSync(join(dir, 'height', '0-0.bin')).byteLength > 200
    );
  });

  it.skipIf(!baked)('gives every background a berth at its starting pier', async () => {
    for (const key of BACKGROUNDS) {
      const start = startingPort(key);
      const dir = join(__dirname, '..', 'public', 'world', dirs[start.zoneId] ?? '');
      const zone = await loadZoneTerrain(
        async (path) => new Uint8Array(readFileSync(join(dir, path))),
      );
      expect(zone.manifest.zone).toBe(zoneDef(start.zoneId).id);
      const piers = layoutHarbors(
        manifestFrame(zone.manifest),
        zone.terrain,
        zone.manifest.zone,
      ).flatMap((l) => l.piers);
      const berths = mooringBerths(piers, zone.terrain).filter((b) => b.dockId === start.pier);
      expect(berths.length, key).toBeGreaterThan(0);
    }
  });
});

describe('perks', () => {
  const t1 = createSchooner(0, 0, 0).sailing.cls;

  it('gives the Deckhand quicker sail changes and a wider, faster trim', () => {
    const deck = withSailingPerks(t1, { background: 'deckhand' });
    expect(deck.sailChangeTimeS).toBeCloseTo(t1.sailChangeTimeS * QUICK_HANDS_SAIL_TIME);
    expect(deck.trimSweetSpot).toBeGreaterThan(t1.trimSweetSpot);
    // Trimmed right by hand: 5% over a plain captain's.
    expect(trimFactorAt(deck, true, 0.5, 0.5)).toBeCloseTo(1 + SAIL_TRIMMER_BONUS);
    expect(trimFactorAt(t1, true, 0.5, 0.5)).toBe(1);
    // Just outside a plain captain's sweet spot is still inside the Deckhand's.
    const off = 0.5 + t1.trimSweetSpot * 1.2;
    expect(trimFactorAt(t1, true, off, 0.5)).toBeLessThan(1);
    expect(trimFactorAt(deck, true, off, 0.5)).toBeCloseTo(1 + SAIL_TRIMMER_BONUS);
    // Auto-trim is unchanged, and the class it was built from isn't touched.
    expect(trimFactorAt(deck, false, 0, 0.5)).toBe(t1.autoTrimFactor);
    expect(createSchooner(0, 0, 0).sailing.cls.sailChangeTimeS).toBe(t1.sailChangeTimeS);
    expect(withSailingPerks(t1, { background: 'fisherman' })).toEqual(t1);
  });

  it('tightens the Fisherman’s forecasts', () => {
    expect(forecastSkill({ background: 'fisherman' })).toBe(WEATHER_EYE_SKILL);
    expect(forecastSkill({ background: 'deckhand' })).toBe(1);
    expect(forecastSpreadM(12, WEATHER_EYE_SKILL)).toBeLessThan(forecastSpreadM(12));
    expect(forecastWindSpread(12, WEATHER_EYE_SKILL)).toBeLessThan(forecastWindSpread(12));
  });

  it('writes the fish prices of every port into the Fisherman’s ledger, and only his', () => {
    const fisher = createNewRun(setup({ background: 'fisherman' }));
    const fishPorts = [...gameEconomy().markets]
      .filter(([, m]) => m.goods.has('good.salted_fish'))
      .map(([id]) => id);
    expect(fishPorts.length).toBeGreaterThan(4);
    for (const port of fishPorts) {
      expect(fisher.knowledge.prices[port]?.['good.salted_fish']?.seenAt).toBe(dawnSeconds());
      expect(fisher.knowledge.prices[port]?.['good.flour']).toBeUndefined();
    }
    expect(createNewRun(setup()).knowledge.prices).toEqual({});
  });

  it('keeps the Saloon Keeper’s rumors perk for the saloon to read', () => {
    expect(hasPerk({ background: 'saloon_keeper' }, 'perk.saloon_talk')).toBe(true);
    expect(hasPerk({ background: 'deckhand' }, 'perk.saloon_talk')).toBe(false);
  });
});

describe('the First Week', () => {
  const c = firstWeekContext('fisherman');

  it('adapts its steps to the starting port, cargo and hideout', () => {
    const lines = firstWeekLines(createFirstWeek(), c);
    expect(lines.map((l) => l.step)).toEqual([...FIRST_WEEK_STEPS]);
    expect(lines[0]?.text).toBe('Sell your salted fish in Bayfield');
    expect(lines[2]?.text).toBe('Stash goods at Stockton Island');
    expect(lines.every((l) => !l.done)).toBe(true);
  });

  it('matches the events that tick each step', () => {
    const fish = { cargoGood: 'good.salted_fish' };
    expect(stepForEvent('TradeCompleted', { side: 'sell', good: 'good.salted_fish' }, fish)).toBe(
      'sell',
    );
    expect(stepForEvent('TradeCompleted', { side: 'buy', good: 'good.salted_fish' }, fish)).toBe(
      undefined,
    );
    expect(stepForEvent('TradeCompleted', { side: 'sell', good: 'good.flour' }, fish)).toBe(
      undefined,
    );
    expect(stepForEvent('ContractCompleted', { late: true }, fish)).toBe('contract');
    expect(stepForEvent('StorageChanged', { direction: 'in', good: 'good.salt' }, fish)).toBe(
      'stash',
    );
    expect(stepForEvent('StorageChanged', { direction: 'in', cents: 500 }, fish)).toBe(undefined);
    expect(stepForEvent('StorageChanged', { direction: 'out', good: 'good.salt' }, fish)).toBe(
      undefined,
    );
    expect(stepForEvent('RumorHeard', { source: 'saloon' }, fish)).toBe('rumor');
    expect(stepForEvent('RumorHeard', { source: 'hail' }, fish)).toBe(undefined);
    expect(stepForEvent('VoyageStarted', {}, fish)).toBe('voyage');
  });

  it('ticks off from the game’s bus, even events it has no type for', () => {
    const state = createNewRun(setup({ background: 'fisherman' }));
    const events = new EventBus<GameEvents>();
    const ctx = { state, events } as unknown as GameContext;
    const seen: (number | undefined)[] = [];
    const captain = attachCaptain(ctx, gameEconomy(), (w) =>
      seen.push(w?.lines.filter((l) => l.done).length),
    );
    expect(seen).toEqual([0]);
    events.emit('TradeCompleted', {
      port: 'port.bayfield',
      good: 'good.salted_fish',
      side: 'sell',
      qty: 8,
      totalCents: 9000,
      nextUnitCents: 1000,
    });
    // Piece E's event, raised by name before its types are merged.
    (events as unknown as EventBus<Record<string, unknown>>).emit('StorageChanged', {
      hideout: 'hideout.stockton',
      direction: 'in',
      good: 'good.salt',
      qty: 1,
    });
    events.emit('VoyageStarted', { legs: 1, lengthM: 1000, destinationZoneId: undefined });
    events.emit('VoyageStarted', { legs: 1, lengthM: 1000, destinationZoneId: undefined });
    expect(state.firstWeek?.done).toEqual(['sell', 'stash', 'voyage']);
    expect(seen).toEqual([0, 1, 2, 3]);
    expect(captain.firstWeek()?.justDone).toBe('voyage');
    captain.setHidden(true);
    expect(state.firstWeek?.hidden).toBe(true);
    // The Fisherman's fish prices follow the world tick.
    state.environment.clock.gameSeconds += 600;
    events.emit('WorldTick', { gameSeconds: state.environment.clock.gameSeconds });
    expect(state.knowledge.prices['port.duluth']?.['good.salted_fish']?.seenAt).toBe(
      state.environment.clock.gameSeconds,
    );
    captain.dispose();
  });

  it('has no checklist for a run made without character creation', () => {
    const state = createWorldState('x');
    const events = new EventBus<GameEvents>();
    const shown: unknown[] = [];
    attachCaptain({ state, events } as unknown as GameContext, gameEconomy(), (w) => shown.push(w));
    events.emit('VoyageStarted', { legs: 1, lengthM: 1000, destinationZoneId: undefined });
    expect(shown).toEqual([undefined]);
    expect(state.firstWeek).toBeUndefined();
  });
});
