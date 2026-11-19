import { describe, expect, it } from 'vitest';
import eventsJson from '../data/events.json';
import { eventsFileSchema, type EventsFile } from '../data/schemas/events';
import { EventBus } from '../src/core/events';
import { Rng } from '../src/core/rng';
import {
  CALENDAR_DAYS_PER_GAME_DAY,
  CALENDAR_START_MS,
  SECONDS_PER_GAME_DAY,
  WORLD_TICK_GAME_SECONDS,
} from '../src/core/time';
import { attachEconomy } from '../src/gameplay/economy';
import { attachEvents, type EventSceneView } from '../src/gameplay/events';
import { attachLaw } from '../src/gameplay/law';
import { attachPapers } from '../src/gameplay/papers';
import type { GameContext, GameEvents } from '../src/modes/context';
import { unitPrices } from '../src/sim/economy/market';
import {
  candidates,
  createEventsState,
  crewsIdle,
  cutterOrdered,
  drawEvent,
  eventDef,
  EVENTS,
  eventTalk,
  expireEvents,
  fireEvent,
  payrollCents,
  postLetter,
  type EventMoment,
  type EventWorld,
  type Letter,
} from '../src/sim/events/events';
import { gameLaw } from '../src/sim/law/defs';
import { addStory, gameNews, renderStory, storyDef, type PressWorld } from '../src/sim/news/papers';
import { freshNews } from '../src/sim/news/state';
import { rumorDefs, tellRumor, type RumorWorld } from '../src/sim/rumors/rumors';
import { createWorldState, worldStateSchema } from '../src/sim/world-state';
import { gameEconomy } from '../src/sim/economy/defs';
import { lawWorld } from '../src/gameplay/law';

/**
 * Sandbox events and letters (plan 12 §5; plan 11 §18.4 piece A, exit criteria 1 and 2):
 * the data, the triggers, the draw, cooldowns, the sim each one changes, the channels, and
 * a letter waiting at the harbor master's with a choice.
 */

function must<T>(x: T | undefined | null): T {
  if (x === undefined || x === null) throw new Error('expected a value');
  return x;
}

/** Game seconds at a calendar date (1 game day = 1 week). */
function at(month: number, day: number, hour = 12): number {
  const ms = Date.UTC(1900, month, day) - CALENDAR_START_MS;
  const days = Math.floor(ms / 86_400_000 / CALENDAR_DAYS_PER_GAME_DAY);
  return days * SECONDS_PER_GAME_DAY + hour * 3600;
}

function fakeWorld(over: Partial<EventWorld> = {}): EventWorld {
  return {
    now: at(5, 1),
    fameTier: 0,
    topWanted: { tier: 0, region: undefined },
    regionOf: (p) =>
      ({
        'port.bayfield': 'region.chequamegon',
        'port.washburn': 'region.chequamegon',
        'port.ashland': 'region.ashland',
        'port.duluth': 'region.duluth',
        'port.superior': 'region.superior',
        'port.red_cliff': 'region.apostles',
      })[p],
    standing: () => 0,
    gale: () => false,
    hideouts: [],
    hereRegion: 'region.apostles',
    dockedPort: undefined,
    sailingFrom: (port) => ({
      ship: `ship.${port}`,
      name: 'Steamer Hesper',
      at: at(5, 1) + 20 * 3600,
    }),
    ...over,
  };
}

const seq = (...xs: number[]): (() => number) => {
  let i = 0;
  return () => xs[i++ % xs.length] ?? 0;
};

describe('events.json', () => {
  it('validates, with the ten events of piece A and the moon-cussing night of piece I', () => {
    const file = eventsFileSchema.parse(eventsJson);
    expect(file.events.map((e) => e.id).sort()).toEqual(
      [
        'event.camp_demand',
        'event.coal_shortage',
        'event.herring_run',
        'event.informant',
        'event.mill_fire',
        'event.moon_cussing_night',
        'event.morrill_arrives',
        'event.payroll_run',
        'event.storm_bound',
        'event.whiskey_hijack',
        'event.wreck_survivors',
      ].sort(),
    );
  });

  it('refuses a channel without its text and a choice without a place to take it', () => {
    const base = structuredClone(eventsJson) as unknown as EventsFile;
    const ev = must(base.events.find((e) => e.id === 'event.mill_fire'));
    ev.channels = ['letter'];
    expect(eventsFileSchema.safeParse(base).success).toBe(false);
    const again = structuredClone(eventsJson) as unknown as EventsFile;
    const herring = must(again.events.find((e) => e.id === 'event.herring_run'));
    herring.choices = [{ id: 'x', label: 'X', result: 'Y', outcomes: [] }];
    expect(eventsFileSchema.safeParse(again).success).toBe(false);
  });

  it('names only goods the markets of its ports trade', () => {
    const economy = gameEconomy();
    for (const e of EVENTS.events) {
      for (const o of e.outcomes) {
        if (o.kind !== 'price') continue;
        const ports = [...(e.ports ?? []), ...(o.ports ?? [])];
        const traded = ports.filter((p) => economy.markets.get(p)?.goods.has(o.good));
        expect(traded.length, `${e.id} ${o.good}`).toBeGreaterThan(0);
      }
    }
  });
});

describe('triggers and the draw', () => {
  it('reads months, Wanted, the hideout and the gale', () => {
    const s = createEventsState(0);
    const herring = must(eventDef('event.herring_run'));
    expect(candidates(herring, s, fakeWorld({ now: at(5, 1) }), 'tick')).toEqual([]);
    expect(candidates(herring, s, fakeWorld({ now: at(9, 15) }), 'tick').length).toBe(2);

    const morrill = must(eventDef('event.morrill_arrives'));
    expect(candidates(morrill, s, fakeWorld(), 'tick')).toEqual([]);
    expect(
      candidates(
        morrill,
        s,
        fakeWorld({ topWanted: { tier: 2, region: 'region.duluth' } }),
        'tick',
      ),
    ).toEqual([{ port: undefined, region: 'region.duluth' }]);

    const informant = must(eventDef('event.informant'));
    const hot = { topWanted: { tier: 1, region: 'region.apostles' } };
    expect(candidates(informant, s, fakeWorld(hot), 'tick')).toEqual([]);
    expect(
      candidates(
        informant,
        s,
        fakeWorld({
          ...hot,
          hideouts: [{ id: 'hideout.stockton', name: 'Stockton', region: 'region.apostles' }],
        }),
        'tick',
      ),
    ).toEqual([{ port: undefined, region: 'region.apostles' }]);

    const storm = must(eventDef('event.storm_bound'));
    expect(candidates(storm, s, fakeWorld(), 'tick')).toEqual([]);
    expect(candidates(storm, s, fakeWorld({ gale: (p) => p === 'port.bayfield' }), 'tick')).toEqual(
      [{ port: 'port.bayfield', region: 'region.chequamegon' }],
    );
  });

  it('draws each event at its own moment: a voyage, docking, or the tick', () => {
    const s = createEventsState(0);
    const wreck = must(eventDef('event.wreck_survivors'));
    expect(candidates(wreck, s, fakeWorld(), 'tick')).toEqual([]);
    expect(candidates(wreck, s, fakeWorld(), 'voyage').length).toBe(1);
    const hijack = must(eventDef('event.whiskey_hijack'));
    const evening = at(5, 1, 18);
    expect(candidates(hijack, s, fakeWorld({ now: evening }), 'dock')).toEqual([]);
    expect(
      candidates(hijack, s, fakeWorld({ now: evening, dockedPort: 'port.bayfield' }), 'dock'),
    ).toEqual([{ port: 'port.bayfield', region: 'region.chequamegon' }]);
    // Not at noon: the crew's at work.
    expect(
      candidates(hijack, s, fakeWorld({ now: at(5, 1, 12), dockedPort: 'port.bayfield' }), 'dock'),
    ).toEqual([]);
  });

  it('keeps a cooldown and a cap on events standing at once', () => {
    const s = createEventsState(0);
    const w = fakeWorld({ now: at(9, 15) });
    const herring = must(eventDef('event.herring_run'));
    const ev = fireEvent(
      s,
      w,
      herring,
      { port: 'port.bayfield', region: 'region.chequamegon' },
      seq(0.5),
    );
    expect(ev.until - ev.at).toBe(herring.hours * 3600);
    // Standing: not again.
    expect(candidates(herring, s, w, 'tick')).toEqual([]);
    expireEvents(s, ev.until);
    expect(s.active).toEqual([]);
    // Over, but cooling down.
    expect(candidates(herring, s, { ...w, now: ev.until }, 'tick')).toEqual([]);
    const later = ev.at + herring.cooldownDays * SECONDS_PER_GAME_DAY;
    expect(candidates(herring, s, { ...w, now: later }, 'tick').length).toBe(2);

    s.active = [0, 1, 2].map((i) => ({ key: `x${i}`, id: `event.x${i}`, at: 0, until: 1e12 }));
    expect(drawEvent(s, { ...w, now: later }, 'tick', seq(0.1))).toBeUndefined();
  });

  it('draws by weight among what can fire', () => {
    const s = createEventsState(0);
    const w = fakeWorld({ now: at(6, 1) });
    const counts = new Map<string, number>();
    const rng = Rng.fromSeed('weights');
    for (let i = 0; i < 2000; i++) {
      const d = must(drawEvent(s, w, 'tick', () => rng.next()));
      counts.set(d.def.id, (counts.get(d.def.id) ?? 0) + 1);
    }
    // July, nobody wanted, no gale: the payroll (1.2) and the mill fire (0.8) only.
    expect([...counts.keys()].sort()).toEqual(['event.mill_fire', 'event.payroll_run']);
    expect(must(counts.get('event.payroll_run')) / 2000).toBeCloseTo(0.6, 1);
  });

  it('fires every event in a seeded year, each within its cooldown', () => {
    const s = createEventsState(0);
    const rng = Rng.fromSeed('a year');
    const fires: { id: string; at: number }[] = [];
    const hideouts = [
      { id: 'hideout.stockton', name: 'Presque Isle bay', region: 'region.apostles' },
    ];
    const start = at(4, 7);
    const end = at(11, 31);
    for (let t = start; t < end; t += 6 * 3600) {
      for (const ev of expireEvents(s, t)) expect(ev.until).toBeLessThanOrEqual(t);
      const moment: EventMoment =
        (['tick', 'voyage', 'dock'] as const)[Math.floor(rng.next() * 3)] ?? 'tick';
      const w = fakeWorld({
        now: t + (moment === 'dock' ? 19 * 3600 - (t % SECONDS_PER_GAME_DAY) : 0),
        topWanted: { tier: 2, region: 'region.chequamegon' },
        hideouts,
        gale: () => rng.next() < 0.2,
        dockedPort: moment === 'dock' ? 'port.bayfield' : undefined,
        // A dark, stormy night with a ship due past a wrecking mark, now and then (piece I).
        wreckingNight: () =>
          rng.next() < 0.15
            ? {
                ship: 'ship.x',
                name: 'Steamer X',
                at: t + 6 * 3600,
                mark: 'Sand Island shoal',
                region: 'region.apostles',
              }
            : undefined,
      });
      if (rng.next() > 0.5) continue;
      const d = drawEvent(s, w, moment, () => rng.next());
      if (!d) continue;
      fireEvent(s, w, d.def, d, () => rng.next());
      fires.push({ id: d.def.id, at: w.now });
    }
    for (const e of EVENTS.events) {
      const mine = fires.filter((f) => f.id === e.id);
      expect(mine.length, e.id).toBeGreaterThan(0);
      for (let i = 1; i < mine.length; i++) {
        const gap = must(mine[i]).at - must(mine[i - 1]).at;
        expect(gap).toBeGreaterThanOrEqual(e.cooldownDays * SECONDS_PER_GAME_DAY);
      }
    }
  });
});

describe('what a standing event does to the sim', () => {
  it('puts a payroll in her strongbox until she is well on her way', () => {
    const s = createEventsState(0);
    const w = fakeWorld();
    const ev = fireEvent(
      s,
      w,
      must(eventDef('event.payroll_run')),
      { port: 'port.duluth', region: 'region.duluth' },
      seq(0.5),
    );
    expect(ev.ship).toBe('ship.port.duluth');
    expect(ev.cents).toBe(62_500 - (62_500 % 100));
    expect(payrollCents(s, 'ship.port.duluth', w.now + 3600)).toBe(ev.cents);
    expect(payrollCents(s, 'ship.other', w.now + 3600)).toBe(0);
    expect(payrollCents(s, 'ship.port.duluth', ev.until)).toBe(0);
    expect(ev.until).toBeGreaterThanOrEqual(must(ev.sailsAt) + SECONDS_PER_GAME_DAY);
  });

  it('orders the cutter to a region, and idles the crews at a port', () => {
    const s = createEventsState(0);
    const w = fakeWorld({ topWanted: { tier: 2, region: 'region.duluth' } });
    fireEvent(
      s,
      w,
      must(eventDef('event.morrill_arrives')),
      { port: undefined, region: 'region.duluth' },
      seq(0),
    );
    expect(cutterOrdered(s, 'region.duluth', w.now + 1)).toBe(true);
    expect(cutterOrdered(s, 'region.apostles', w.now + 1)).toBe(false);

    const hijack = fireEvent(
      s,
      w,
      must(eventDef('event.whiskey_hijack')),
      { port: 'port.bayfield', region: 'region.chequamegon' },
      seq(0),
    );
    // Only once the round's been stood.
    expect(crewsIdle(s, 'port.bayfield', w.now + 1)).toBe(false);
    hijack.chosen = 'stand';
    expect(crewsIdle(s, 'port.bayfield', w.now + 1)).toBe(true);
    expect(crewsIdle(s, 'port.washburn', w.now + 1)).toBe(false);
  });

  it('gives the saloons of its region talk, filled', () => {
    const s = createEventsState(0);
    const w = fakeWorld({ now: at(9, 20) });
    fireEvent(
      s,
      w,
      must(eventDef('event.herring_run')),
      { port: 'port.bayfield', region: 'region.chequamegon' },
      seq(0),
    );
    const talk = eventTalk(s, w.now + 1, (_ev, t) => t.replace('{port}', 'Bayfield'));
    expect(talk).toHaveLength(1);
    expect(must(talk[0]).lines[0]).toContain('off Bayfield');

    const world: RumorWorld = {
      economy: gameEconomy(),
      markets: createWorldState('talk', w.now).markets,
      eventTalk: () => talk,
    };
    // Bayfield's saloon tells it; Duluth's doesn't.
    const rng = Rng.fromSeed('talk');
    const told = new Set<string>();
    for (let i = 0; i < 60; i++) {
      const r = tellRumor(world, [], 'port.bayfield', w.now + 1, () => rng.next());
      if (r) told.add(r.rumor.kind);
      const d = tellRumor(world, [], 'port.duluth', w.now + 1, () => rng.next());
      expect(d?.rumor.kind).not.toBe('event');
    }
    expect(told.has('event')).toBe(true);
    expect(rumorDefs().kinds.event.label).toBe('Talk of the town');
  });

  it('prints its item in the papers that cover its region, naming nobody', () => {
    const defs = gameNews();
    const news = freshNews(0);
    const story = must(
      addStory(defs, news, {
        kind: 'event',
        event: 'event.mill_fire',
        key: 'ev.1',
        at: 0,
        region: 'region.ashland',
        port: 'port.ashland',
        ident: 'unknown',
      }),
    );
    expect(must(storyDef(defs, story)).fame).toBe(0);
    const law = gameLaw();
    const state = createWorldState('press', 0);
    const world: PressWorld = {
      law,
      lawWorld: lawWorld(state, 'press'),
      captain: 'Nell Hardy',
      ship: 'Kestrel',
      seed: 'press',
      goodName: (g) => g,
      cutter: () => [],
      weather: () => ({ text: '', signals: [] }),
    };
    const paper = must(defs.papers.find((p) => p.covers.includes('region.ashland')));
    const article = renderStory(defs, world, story, paper, 0);
    expect(article.headline).toBe('MILL BURNED AT ASHLAND');
    expect(article.aboutYou).toBe(false);
  });

  it('keeps the newest letters and never drops one still open', () => {
    const mail: Letter[] = [];
    const letter = (i: number, open = false): Letter => ({
      key: `ev.${i}`,
      event: 'event.camp_demand',
      at: i,
      from: 'x',
      subject: 's',
      body: 'b',
      read: !open,
      open,
    });
    postLetter(mail, letter(0, true));
    for (let i = 1; i <= 20; i++) postLetter(mail, letter(i));
    expect(mail).toHaveLength(EVENTS.rules.keepLetters);
    expect(mail.some((l) => l.key === 'ev.0')).toBe(true);
  });
});

describe('events in the game', () => {
  function setup(seed = 'events') {
    const state = createWorldState(seed, at(9, 3));
    state.environment.clock.gameSeconds = at(9, 3, 18);
    const events = new EventBus<GameEvents>();
    const ctx = { state, events, rng: Rng.fromSeed(seed) } as unknown as GameContext;
    const economy = attachEconomy(ctx, undefined);
    const law = attachLaw(ctx, 'seed');
    const papers = attachPapers({ ctx, law, seed, goodName: (g) => g });
    const scenes: (EventSceneView | undefined)[] = [];
    let voyage = false;
    const game = attachEvents({
      ctx,
      law: law.defs,
      economy: economy.defs,
      papers,
      gale: () => false,
      onVoyage: () => voyage,
      showScene: (s) => scenes.push(s),
      onSceneOpen: () => undefined,
    });
    const seen: { type: string; payload: unknown }[] = [];
    events.tap((type, payload) => seen.push({ type, payload }));
    const tick = (n = 1): void => {
      for (let i = 0; i < n; i++) {
        state.environment.clock.gameSeconds += WORLD_TICK_GAME_SECONDS;
        events.emit('WorldTick', { gameSeconds: state.environment.clock.gameSeconds });
      }
    };
    return {
      state,
      ctx,
      economy,
      game,
      scenes,
      seen,
      tick,
      setVoyage: (v: boolean) => (voyage = v),
    };
  }

  it('moves a price and saves the event and its letter with the run', () => {
    const { state, economy, game, seen } = setup();
    const before = must(
      unitPrices(
        economy.defs,
        state.markets,
        'port.ashland',
        'good.provisions',
        state.environment.clock.gameSeconds,
      ),
    );
    const ev = game.fire('event.camp_demand', 'port.ashland');
    expect(typeof ev).not.toBe('string');
    const after = must(
      unitPrices(
        economy.defs,
        state.markets,
        'port.ashland',
        'good.provisions',
        state.environment.clock.gameSeconds,
      ),
    );
    expect(after.sellCents).toBeGreaterThan(before.sellCents);
    expect(seen.some((e) => e.type === 'PriceShock')).toBe(true);
    expect(seen.some((e) => e.type === 'LetterReceived')).toBe(true);
    expect(game.unread()).toBe(1);
    const letter = must(game.letters()[0]);
    expect(letter.subject).toBe('Provisions wanted');
    expect(letter.body).toContain('Ashland');
    game.readLetter(letter.key);
    expect(game.unread()).toBe(0);
    const round = worldStateSchema.parse(JSON.parse(JSON.stringify(state)));
    expect(round.events?.active).toHaveLength(1);
    expect(round.mail).toHaveLength(1);
  });

  it('answers an informant by letter: paying keeps him quiet', () => {
    const { state, game } = setup();
    state.player.purse = 10_000;
    state.wanted['region.apostles'] = { heat: 30 } as (typeof state.wanted)[string];
    const ev = game.fire('event.informant');
    if (typeof ev === 'string') throw new Error(ev);
    expect(ev.hideout).toBe('hideout.stockton');
    const letter = must(game.letters()[0]);
    expect(letter.body).toContain('$40');
    expect(letter.choices.map((c) => c.id)).toEqual(['pay', 'ignore']);
    expect(game.answer(letter.key, 'pay')).toContain('plain envelope');
    expect(state.player.purse).toBe(6_000);
    expect(must(game.letters()[0]).choices).toEqual([]);
    expect(game.answer(letter.key, 'ignore')).toBe('That letter needs no answer.');
    expect(state.hideouts?.['hideout.stockton']?.spotted).toBeUndefined();
  });

  it('takes the default when a letter goes unanswered: the informant talks', () => {
    const { state, game, tick } = setup();
    state.wanted['region.apostles'] = { heat: 30 } as (typeof state.wanted)[string];
    const heat = state.wanted['region.apostles']?.heat ?? 0;
    game.fire('event.informant');
    tick((48 * 3600) / WORLD_TICK_GAME_SECONDS + 1);
    expect(state.hideouts?.['hideout.stockton']?.spotted?.by).toBe('an informant');
    expect(state.wanted['region.apostles']?.heat ?? 0).toBeGreaterThan(heat);
    expect(must(game.letters()[0]).result).toContain('burn the letter');
  });

  it('meets wreck survivors on a voyage, and a rescue raises Standing', () => {
    const { state, game, scenes, setVoyage } = setup();
    setVoyage(true);
    const ev = game.fire('event.wreck_survivors');
    if (typeof ev === 'string') throw new Error(ev);
    const shown = must(scenes.at(-1));
    expect(shown.kind).toBe('chart');
    expect(shown.choices.map((c) => c.id)).toEqual(['rescue', 'rob', 'sail_on']);
    const seat = must(gameLaw().regionById.get(must(ev.region))?.seat);
    const before = state.player.standing?.[seat] ?? 0;
    expect(game.choose('rescue')).toBeUndefined();
    expect(must(scenes.at(-1)).result).toContain('blankets');
    expect(state.player.standing?.[seat]).toBe(before + 6);
    game.closeScene();
    expect(scenes.at(-1)).toBeUndefined();
    expect(state.events?.flags).toContain('rescued_survivors');
  });

  it('holds a meeting at sea until the next voyage', () => {
    const { game, scenes, setVoyage, tick } = setup();
    game.fire('event.wreck_survivors');
    expect(scenes).toEqual([]);
    setVoyage(true);
    tick();
    expect(must(scenes.at(-1)).title).toBe('A lifeboat adrift');
    // Put away unanswered: you sailed on.
    game.closeScene();
    expect(game.state.active[0]?.chosen).toBe('sail_on');
  });

  it('plays a scene on docking at its port, and a round stood idles the crews', () => {
    const { state, game, scenes } = setup();
    state.player.purse = 1_000;
    // Not in the run's first week.
    game.docked('port.bayfield');
    expect(game.scene()).toBeUndefined();
    game.state.graceUntil = 0;
    // Docked at Bayfield at six in the evening, again and again until it plays.
    for (let i = 0; i < 20 && !game.scene(); i++) {
      game.docked('port.bayfield');
      if (!game.scene()) game.state.cooldowns = {};
    }
    const shown = must(scenes.at(-1));
    expect(shown.kind).toBe('scene');
    expect(shown.title).toBe('Idle hands on the pier');
    expect(game.choose('stand')).toBeUndefined();
    expect(state.player.purse).toBe(800);
    expect(crewsIdle(state.events, 'port.bayfield', state.environment.clock.gameSeconds)).toBe(
      true,
    );
  });

  it('puts the storm-bound fleet in the papers and the district warehouses full', () => {
    const { state, game, ctx } = setup();
    (state.districts ??= {})['district.bayfield'] = {
      containers: {
        a: {
          taken: { 'good.lumber': 3 },
          cash: true,
          documents: false,
          opened: true,
          restockAt: 1e12,
        },
      },
      doors: {},
    };
    game.fire('event.storm_bound', 'port.bayfield');
    expect(state.districts['district.bayfield']?.containers).toEqual({});
    expect(
      state.newspapers?.stories.some((s) => s.kind === 'event' && s.event === 'event.storm_bound'),
    ).toBe(true);
    expect(game.talk()[0]?.lines[0]).toMatch(/Bayfield/);
    expect(
      crewsIdle(ctx.state.events, 'port.bayfield', state.environment.clock.gameSeconds + 1),
    ).toBe(true);
  });

  it('draws on the world tick once the grace days are past', () => {
    const { game, tick, seen } = setup('draws');
    tick((SECONDS_PER_GAME_DAY * 4) / WORLD_TICK_GAME_SECONDS);
    expect(seen.filter((e) => e.type === 'EventTriggered').length).toBeGreaterThan(0);
    expect(Object.keys(game.state.fired).length).toBeGreaterThan(0);
  });
});
