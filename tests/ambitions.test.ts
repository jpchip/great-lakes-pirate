import { describe, expect, it } from 'vitest';
import ambitionsJson from '../data/ambitions.json';
import newspapersJson from '../data/newspapers.json';
import { ambitionsFileSchema } from '../data/schemas/ambitions';
import { newspapersFileSchema } from '../data/schemas/newspapers';
import { EventBus } from '../src/core/events';
import { CALENDAR_START_MS, SECONDS_PER_GAME_DAY, WORLD_TICK_GAME_SECONDS } from '../src/core/time';
import { attachAmbitions, type AmbitionsSnapshot } from '../src/gameplay/ambitions';
import { attachEconomy } from '../src/gameplay/economy';
import { attachLaw } from '../src/gameplay/law';
import { attachPapers } from '../src/gameplay/papers';
import type { GameContext, GameEvents } from '../src/modes/context';
import {
  AMBITIONS,
  ambitionDef,
  ambitionProgress,
  checkAmbitions,
  clearMark,
  counterForEvent,
  createAmbitions,
  pinAmbition,
  piecesAt,
  unpinAmbition,
  type AmbitionWorld,
} from '../src/sim/character/ambitions';
import { gameLaw } from '../src/sim/law/defs';
import { renderStory, storyDef, type PressWorld } from '../src/sim/news/papers';
import { createWorldState, worldStateSchema } from '../src/sim/world-state';
import { lawWorld } from '../src/gameplay/law';

/**
 * Ambitions (plan 12 §4.1; Phase 8 piece H, plan 09 §16.4): about twelve goals across the
 * categories the MVP can meet, pinned up to three on the HUD and in the journal, a themed
 * mark in the ledger for each one done, a small reward and a line in the papers.
 */

function must<T>(x: T | undefined | null): T {
  if (x === undefined || x === null) throw new Error('expected a value');
  return x;
}

function world(over: Partial<AmbitionWorld> = {}): AmbitionWorld {
  return {
    now: 0,
    hideoutCashCents: 0,
    fameTier: 0,
    fameTierName: (t) => `tier ${t}`,
    portStanding: [],
    hideouts: 1,
    maxHideoutPieces: 0,
    ...over,
  };
}

/** Game seconds of a week in a month of 1900 (0 = January). */
function inMonth(month: number): number {
  const ms = Date.UTC(1900, month, 10) - CALENDAR_START_MS;
  return Math.floor(ms / (7 * 86_400_000)) * SECONDS_PER_GAME_DAY;
}

describe('the ambitions catalog', () => {
  it('has about twelve goals across the five MVP categories, each with a mark', () => {
    const file = ambitionsFileSchema.parse(ambitionsJson);
    expect(file.ambitions.length).toBeGreaterThanOrEqual(12);
    expect(file.ambitions.length).toBeLessThanOrEqual(20);
    expect(new Set(file.ambitions.map((a) => a.category))).toEqual(
      new Set(['wealth', 'infamy', 'trade', 'seamanship', 'builder']),
    );
    expect(file.maxPinned).toBe(3);
    for (const a of file.ambitions) expect(a.reward.cents + a.reward.fame).toBeGreaterThan(0);
  });

  it('gives every ambition a line in the papers', () => {
    const news = newspapersFileSchema.parse(newspapersJson);
    for (const a of AMBITIONS.ambitions) {
      expect(news.stories.ambition[a.id], a.id).toBeDefined();
    }
    expect(Object.keys(news.stories.ambition).sort()).toEqual(
      AMBITIONS.ambitions.map((a) => a.id).sort(),
    );
  });
});

describe('pinning', () => {
  it('pins up to three and says why not a fourth', () => {
    const s = createAmbitions();
    const ids = AMBITIONS.ambitions.map((a) => a.id);
    for (const id of ids.slice(0, 3)) expect(pinAmbition(s, id)).toBeUndefined();
    expect(pinAmbition(s, must(ids[3]))).toMatch(/3 at a time/);
    expect(s.pinned).toEqual(ids.slice(0, 3));
    // Pinning one already pinned is no change.
    expect(pinAmbition(s, must(ids[0]))).toBeUndefined();
    expect(s.pinned).toHaveLength(3);
    expect(unpinAmbition(s, must(ids[1]))).toBe(true);
    expect(pinAmbition(s, must(ids[3]))).toBeUndefined();
    expect(s.pinned).toEqual([ids[0], ids[2], ids[3]]);
    expect(pinAmbition(s, 'ambition.nope')).toBe('No such ambition.');
  });

  it("won't pin one already done, and a goal met is unpinned", () => {
    const s = createAmbitions();
    pinAmbition(s, 'ambition.nest_egg');
    const done = checkAmbitions(s, world({ hideoutCashCents: 100_000 }));
    expect(done.map((d) => d.id)).toEqual(['ambition.nest_egg']);
    expect(s.pinned).toEqual([]);
    expect(pinAmbition(s, 'ambition.nest_egg')).toBe('Already done.');
  });
});

describe('measuring the goals', () => {
  it('reads cash across the hideouts, Fame, Standing, hideouts and pieces', () => {
    const s = createAmbitions();
    const p = (id: string, w: AmbitionWorld) => ambitionProgress(must(ambitionDef(id)), s, w);
    expect(p('ambition.nest_egg', world({ hideoutCashCents: 42_000 }))).toEqual({
      fraction: 0.42,
      text: '$420 of $1,000',
    });
    expect(p('ambition.infamous', world({ fameTier: 2 })).fraction).toBeCloseTo(2 / 3);
    expect(p('ambition.friend_of_three_ports', world({ portStanding: [95, 90, 40] })).text).toBe(
      '2 of 3 ports',
    );
    expect(p('ambition.two_hideouts', world({ hideouts: 1 })).text).toBe('1 of 2');
    expect(p('ambition.a_proper_place', world({ maxHideoutPieces: 120 })).text).toBe(
      '120 of 500 pieces',
    );
  });

  it('counts the pieces of a hideout from Phase 8 piece A, loosely', () => {
    expect(piecesAt({ siteId: 'site.stockton', storage: {} })).toBe(0);
    expect(piecesAt({ pieces: [1, 2, 3] })).toBe(3);
  });

  it('counts contracts on time, escapes from the Morrill, record runs and November gales', () => {
    expect(counterForEvent('ContractCompleted', { late: false }, 0)).toBe('contractsOnTime');
    expect(counterForEvent('ContractCompleted', { late: true }, 0)).toBeUndefined();
    expect(counterForEvent('FeatAccomplished', { kind: 'escape', by: 'law.morrill' }, 0)).toBe(
      'morrillEscapes',
    );
    expect(counterForEvent('FeatAccomplished', { kind: 'recordRun' }, 0)).toBe('recordRuns');
    expect(counterForEvent('FeatAccomplished', { kind: 'galeRun' }, inMonth(10))).toBe(
      'novemberGales',
    );
    expect(counterForEvent('FeatAccomplished', { kind: 'galeRun' }, inMonth(9))).toBeUndefined();
    expect(counterForEvent('ShipLaunched', { from: 'slipway' }, 0)).toBe('slipwayLaunches');
    expect(
      counterForEvent('IceRoadCrossed', { from: 'port.bayfield', to: 'port.la_pointe' }, 0),
    ).toBe('iceRoadCrossings');
    expect(counterForEvent('TradeCompleted', {}, 0)).toBeUndefined();
  });

  it('clears a mark from the ledger but keeps the deed', () => {
    const s = createAmbitions();
    checkAmbitions(s, world({ hideoutCashCents: 100_000 }));
    expect(clearMark(s, 'ambition.nest_egg')).toBe(true);
    expect(clearMark(s, 'ambition.nest_egg')).toBe(false);
    expect(clearMark(s, 'ambition.infamous')).toBe(false);
    expect(s.done.map((d) => d.id)).toEqual(['ambition.nest_egg']);
  });
});

describe('ambitions in the game', () => {
  function setup() {
    const state = createWorldState('ambitions', 0);
    state.environment.clock.gameSeconds = 7 * 3600;
    const events = new EventBus<GameEvents>();
    const ctx = { state, events } as unknown as GameContext;
    const economy = attachEconomy(ctx, undefined);
    const law = attachLaw(ctx, 'seed');
    const papers = attachPapers({
      ctx,
      law,
      seed: 'seed',
      goodName: (g) => economy.defs.goods.get(g)?.name ?? g,
    });
    const snaps: AmbitionsSnapshot[] = [];
    const amb = attachAmbitions(ctx, law.defs, (s) => snaps.push(s));
    const seen: { type: string; payload: unknown }[] = [];
    events.tap((type, payload) => seen.push({ type, payload }));
    const tickTo = (t: number): void => {
      while (state.environment.clock.gameSeconds < t) {
        state.environment.clock.gameSeconds += WORLD_TICK_GAME_SECONDS;
        events.emit('WorldTick', { gameSeconds: state.environment.clock.gameSeconds });
      }
    };
    const last = () => must(snaps.at(-1));
    return { state, events, amb, papers, law, seen, tickTo, last };
  }

  it('pins to the HUD and pays out with a logbook line, a mark and a story', () => {
    const { state, events, amb, papers, seen, last } = setup();
    expect(amb.pin('ambition.nest_egg')).toBeUndefined();
    expect(last().pinned.map((r) => r.id)).toEqual(['ambition.nest_egg']);
    expect(last().pinned[0]?.progress).toBe('$0 of $1,000');

    const purse = state.player.purse;
    const h = must(Object.values(must(state.hideouts))[0]);
    h.storage.cash += 100_000;
    events.emit('StorageChanged', { hideout: 'hideout.stockton', direction: 'in', cents: 100_000 });

    expect(state.player.purse).toBe(purse + 2_500);
    expect(state.logbook?.at(-1)?.text).toBe('A thousand dollars put by in the strongbox.');
    expect(seen.some((e) => e.type === 'AmbitionCompleted')).toBe(true);
    const snap = last();
    expect(snap.pinned).toEqual([]);
    expect(snap.justDone?.name).toBe('A nest egg');
    expect(snap.marks.map((m) => [m.id, m.markName])).toEqual([
      ['ambition.nest_egg', 'A bank draft'],
    ]);
    const story = must(papers.state.stories.find((s) => s.kind === 'ambition'));
    expect(story.ambition).toBe('ambition.nest_egg');

    amb.clearMark('ambition.nest_egg');
    expect(last().marks).toEqual([]);
    expect(last().doneCount).toBe(1);
  });

  it('prints the story in the papers', () => {
    const { events, state, papers, tickTo } = setup();
    must(Object.values(must(state.hideouts))[0]).storage.cash = 1_000_000;
    events.emit('StorageChanged', { hideout: 'hideout.stockton', direction: 'in', cents: 1 });
    tickTo(state.environment.clock.gameSeconds + 2 * SECONDS_PER_GAME_DAY);
    const heads = Object.values(papers.state.editions)
      .flat()
      .flatMap((e) => [e.lead.headline, ...e.briefs.map((b) => b.headline)]);
    expect(heads.some((h) => /CAPTAIN WHO SAVES|WHERE DOES THE MONEY GO/.test(h))).toBe(true);
  });

  it('counts the Morrill escapes from the papers and is done at three, with Fame', () => {
    const { events, amb, state, tickTo } = setup();
    const fame0 = state.fame.value;
    for (let i = 0; i < 3; i++) {
      events.emit('CutterHailed', { by: 'law.morrill', intent: 'pursue', arrest: false });
      events.emit('PursuitChanged', { pursued: true, by: 'law.morrill' });
      events.emit('PursuitChanged', { pursued: false, by: 'law.morrill' });
      tickTo(state.environment.clock.gameSeconds + 2 * 3600);
    }
    expect(amb.state.counters['morrillEscapes']).toBe(3);
    expect(amb.state.done.map((d) => d.id)).toContain('ambition.slipped_the_morrill');
    expect(state.fame.value).toBeGreaterThan(fame0);
  });

  it('counts a week at large while Most Wanted, and capture starts it again', () => {
    const { events, amb, law, state, tickTo, last } = setup();
    law.setTier('region.apostles', 5);
    // Well inside the top tier, so a day's cooling doesn't take it out.
    must(state.wanted['region.apostles']).heat = 900;
    tickTo(state.environment.clock.gameSeconds + SECONDS_PER_GAME_DAY / 2);
    amb.pin('ambition.most_wanted_at_large');
    expect(last().pinned[0]?.progress).toMatch(/^3 of 7 days at large$/);
    events.emit('PlayerCaptured', {
      by: 'law.morrill',
      region: 'region.apostles',
      how: 'surrender',
      at: { x: 0, y: 0 },
    } as unknown as GameEvents['PlayerCaptured']);
    expect(amb.state.mostWantedSince).toEqual({});
    tickTo(state.environment.clock.gameSeconds + SECONDS_PER_GAME_DAY + WORLD_TICK_GAME_SECONDS);
    expect(amb.state.done.map((d) => d.id)).toContain('ambition.most_wanted_at_large');
  });

  it('is done on load for a goal already met before Ambitions', () => {
    const state = createWorldState('old', 0);
    state.fame.value = 400;
    const events = new EventBus<GameEvents>();
    const ctx = { state, events } as unknown as GameContext;
    const amb = attachAmbitions(ctx, gameLaw(), () => undefined);
    expect(amb.state.done.map((d) => d.id)).toEqual(['ambition.infamous']);
  });

  it('round-trips through the save', () => {
    const { state, amb } = setup();
    amb.pin('ambition.on_time_25');
    amb.state.counters['contractsOnTime'] = 4;
    const back = worldStateSchema.parse(JSON.parse(JSON.stringify(state)));
    expect(back.ambitions).toEqual(state.ambitions);
    // A run from before Ambitions has none.
    const old = JSON.parse(JSON.stringify(state)) as Record<string, unknown>;
    delete old['ambitions'];
    expect(worldStateSchema.parse(old).ambitions).toBeUndefined();
  });
});

describe("the papers' ambition stories", () => {
  it('render for every ambition', () => {
    const defs = must(
      (() => {
        const state = createWorldState('render', 0);
        const events = new EventBus<GameEvents>();
        const ctx = { state, events } as unknown as GameContext;
        const law = attachLaw(ctx, 'seed');
        return attachPapers({ ctx, law, seed: 'seed', goodName: (g) => g }).defs;
      })(),
    );
    const state = createWorldState('render', 0);
    const press: PressWorld = {
      seed: 'seed',
      captain: 'Ada Larsen',
      ship: 'Kingfisher',
      law: gameLaw(),
      lawWorld: lawWorld(state, 'seed'),
      goodName: (g: string) => g,
    } as unknown as PressWorld;
    const paper = must(defs.file.papers[0]);
    for (const a of AMBITIONS.ambitions) {
      const story = {
        id: `story-${a.id}`,
        kind: 'ambition' as const,
        key: a.id,
        at: 0,
        region: 'region.apostles',
        ident: 'person' as const,
        ambition: a.id,
        heat: 0,
        printedIn: [],
        heated: false,
      };
      expect(storyDef(defs, story)).toBeDefined();
      for (const fame of [0, 3]) {
        const art = renderStory(defs, press, story, paper, fame);
        expect(art.headline).not.toMatch(/[{}]/);
        expect(art.body).not.toMatch(/[{}]/);
      }
    }
  });
});
