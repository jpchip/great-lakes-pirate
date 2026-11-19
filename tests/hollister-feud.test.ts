import { describe, expect, it } from 'vitest';
import feudsJson from '../data/feuds.json';
import { feudsFileSchema } from '../data/schemas/feuds';
import { EventBus } from '../src/core/events';
import { Rng } from '../src/core/rng';
import {
  CALENDAR_DAYS_PER_GAME_DAY,
  CALENDAR_START_MS,
  SECONDS_PER_GAME_DAY,
  WORLD_TICK_GAME_SECONDS,
} from '../src/core/time';
import { attachContracts } from '../src/gameplay/contracts';
import { attachEconomy } from '../src/gameplay/economy';
import { attachEvents } from '../src/gameplay/events';
import { attachFeuds } from '../src/gameplay/feuds';
import { attachLaw } from '../src/gameplay/law';
import { attachPapers } from '../src/gameplay/papers';
import type { GameContext, GameEvents } from '../src/modes/context';
import { addToHold } from '../src/sim/economy/hold';
import { unitPrices } from '../src/sim/economy/market';
import { candidates, createEventsState, eventDef, EVENTS } from '../src/sim/events/events';
import {
  createFeud,
  dueBeat,
  enterBeat,
  FEUDS,
  noteCrime,
  noteSale,
  pressureOf,
  sellFactor,
  shunsYou,
  yieldFeud,
  type FeudState,
} from '../src/sim/events/feuds';
import { fameTier, gameLaw } from '../src/sim/law/defs';
import { createWorldState, worldStateSchema } from '../src/sim/world-state';

/**
 * The Hollister feud (plan 12 §5.2; plan 11 §18.4 piece D): started by selling fish in
 * Bayfield often, Hollister's undercut and refusals, escalation by its sheds, its tugs or
 * out-trading it, and how it ends either way, with the papers.
 */

function must<T>(x: T | undefined | null): T {
  if (x === undefined || x === null) throw new Error('expected a value');
  return x;
}

const DAY = SECONDS_PER_GAME_DAY;
const BAY = 'port.bayfield';
const FISH = 'good.salted_fish';
const def = must(FEUDS[0]);

/** Game seconds at a calendar date (1 game day = 1 week). */
function at(month: number, day: number, hour = 12): number {
  const ms = Date.UTC(1900, month, day) - CALENDAR_START_MS;
  const days = Math.floor(ms / 86_400_000 / CALENDAR_DAYS_PER_GAME_DAY);
  return days * DAY + hour * 3600;
}

/** A feud already started at `t`. */
function started(t = 0, standing = 0): FeudState {
  const f = createFeud(t);
  enterBeat(f, { kind: 'undercut' }, t, standing);
  return f;
}

describe('feuds.json', () => {
  it('validates, and every beat is a feud event fired only by the feud', () => {
    const file = feudsFileSchema.parse(feudsJson);
    expect(file.map((f) => f.id)).toEqual(['feud.hollister']);
    const e = def.events;
    const ids = [e.undercut, e.refuses, e.reward, e.terms, e.yielded, ...Object.values(e.gives)];
    const s = createEventsState(0);
    s.graceUntil = undefined;
    for (const id of ids) {
      const ev = must(eventDef(id));
      expect(ev.type, id).toBe('feud');
      expect(ev.draw, id).toBe(false);
      for (const m of ['tick', 'voyage', 'dock'] as const) {
        expect(
          candidates(
            ev,
            s,
            {
              now: at(6, 1),
              fameTier: 3,
              topWanted: { tier: 3, region: 'region.apostles' },
              regionOf: () => 'region.apostles',
              standing: () => 50,
              gale: () => true,
              hideouts: [],
              hereRegion: 'region.apostles',
              dockedPort: BAY,
            },
            m,
          ),
        ).toEqual([]);
      }
    }
    expect(must(eventDef(e.terms)).choices?.map((c) => c.id)).toContain(e.acceptChoice);
    // The crimes it counts are real crimes.
    for (const crime of Object.keys(def.pressure.crimes)) {
      expect(gameLaw().crimes.has(crime), crime).toBe(true);
    }
  });
});

describe('the feud, pure', () => {
  it('starts once you sell fish in Bayfield often, not now and then', () => {
    const f = createFeud(0);
    noteSale(def, f, BAY, FISH, 4, 0);
    noteSale(def, f, BAY, FISH, 4, DAY);
    expect(dueBeat(def, f, DAY, 0)).toBeUndefined();
    // Elsewhere, or another good, doesn't count.
    noteSale(def, f, 'port.duluth', FISH, 4, DAY);
    noteSale(def, f, BAY, 'good.lumber', 4, DAY);
    expect(dueBeat(def, f, DAY, 0)).toBeUndefined();
    noteSale(def, f, BAY, FISH, 1, 2 * DAY);
    expect(dueBeat(def, f, 2 * DAY, 0)).toEqual({ kind: 'undercut' });

    const slow = createFeud(0);
    for (let i = 0; i < 6; i++) noteSale(def, slow, BAY, FISH, 4, i * 4 * DAY);
    expect(dueBeat(def, slow, 24 * DAY, 0)).toBeUndefined();
  });

  it('undercuts, then turns your fish away after more sales or days, then offers terms', () => {
    const f = started(0);
    expect(sellFactor(def, f, BAY, FISH)).toBe(def.undercut);
    expect(sellFactor(def, f, 'port.duluth', FISH)).toBe(1);
    expect(sellFactor(def, f, BAY, 'good.lumber')).toBe(1);
    noteSale(def, f, BAY, FISH, 2, DAY / 2);
    expect(dueBeat(def, f, DAY / 2, 0)).toBeUndefined();
    noteSale(def, f, BAY, FISH, 2, DAY / 2);
    expect(dueBeat(def, f, DAY / 2, 0)).toEqual({ kind: 'refuses' });
    // Or the days run out.
    const idle = started(0);
    expect(dueBeat(def, idle, def.refuse.afterDays * DAY, 0)).toEqual({ kind: 'refuses' });

    enterBeat(f, { kind: 'refuses' }, DAY, 0);
    expect(sellFactor(def, f, BAY, FISH)).toBe(0);
    expect(shunsYou(f)).toBe(true);
    expect(dueBeat(def, f, DAY + def.terms.afterDays * DAY - 1, 0)).toBeUndefined();
    const t1 = DAY + def.terms.afterDays * DAY;
    expect(dueBeat(def, f, t1, 0)).toEqual({ kind: 'terms' });
    enterBeat(f, { kind: 'terms' }, t1, 0);
    expect(dueBeat(def, f, t1 + DAY, 0)).toBeUndefined();
    expect(dueBeat(def, f, t1 + def.terms.againDays * DAY, 0)).toEqual({ kind: 'terms' });

    yieldFeud(f, t1 + DAY);
    expect(f.stage).toBe('yielded');
    expect(sellFactor(def, f, BAY, FISH)).toBe(def.ends.yielded.factor);
    expect(shunsYou(f)).toBe(false);
    expect(dueBeat(def, f, t1 + 30 * DAY, 0)).toBeUndefined();
  });

  it('builds pressure by the sheds, the tugs and out-trading, and gives by the leader', () => {
    const f = started(0, 10);
    // A crime against them before the feud is nothing to it.
    const quiet = createFeud(0);
    expect(noteCrime(def, quiet, 'crime.burglary')).toBeUndefined();
    expect(noteCrime(def, f, 'crime.sabotage')).toBe('sheds');
    expect(noteCrime(def, f, 'crime.piracy')).toBe('tugs');
    expect(noteCrime(def, f, 'crime.assault')).toBeUndefined();
    noteSale(def, f, 'port.duluth', FISH, 10, 1);
    const p = pressureOf(def, f, 14);
    expect(p).toMatchObject({ sheds: 40, tugs: 35, trade: 10 + 4 * def.pressure.perStanding });
    expect(p.total).toBe(p.sheds + p.tugs + p.trade);
    // Crime past the mark: a reward with the law, once.
    expect(dueBeat(def, f, 1, 10)).toEqual({ kind: 'reward' });
    enterBeat(f, { kind: 'reward' }, 1, 10);
    expect(dueBeat(def, f, 1, 10)).toBeUndefined();
    noteCrime(def, f, 'crime.sinking');
    expect(dueBeat(def, f, 2, 10)).toEqual({ kind: 'gives', method: 'tugs' });
    enterBeat(f, { kind: 'gives', method: 'tugs' }, 2, 10);
    expect(f.stage).toBe('won');
    expect(sellFactor(def, f, BAY, FISH)).toBe(def.ends.won.factor);
    // Done: nothing more counts.
    expect(noteCrime(def, f, 'crime.piracy')).toBeUndefined();
    expect(dueBeat(def, f, 100 * DAY, 0)).toBeUndefined();

    const trader = started(0, 0);
    noteSale(def, trader, 'port.superior', FISH, 30, 1);
    expect(dueBeat(def, trader, 1, 14)).toEqual({ kind: 'gives', method: 'trade' });
  });
});

describe('the feud in the game', () => {
  function setup(seed = 'feud') {
    const state = createWorldState(seed, at(5, 7));
    state.environment.clock.gameSeconds = at(6, 4, 10);
    const events = new EventBus<GameEvents>();
    const ctx = { state, events, rng: Rng.fromSeed(seed) } as unknown as GameContext;
    const economy = attachEconomy(ctx, undefined);
    const law = attachLaw(ctx, 'seed');
    const papers = attachPapers({ ctx, law, seed, goodName: (g) => g });
    const game = attachEvents({
      ctx,
      law: law.defs,
      economy: economy.defs,
      papers,
      gale: () => false,
      onVoyage: () => false,
      showScene: () => undefined,
      onSceneOpen: () => undefined,
    });
    const feuds = attachFeuds({ ctx, events: game, companyName: () => 'Hollister' });
    economy.sellFactor = (port, good) => feuds.sellTerms(port, good)?.factor ?? 1;
    const contracts = attachContracts(ctx, economy, seed);
    const seen: { type: string; payload: unknown }[] = [];
    events.tap((type, payload) => seen.push({ type, payload }));
    const hold = (qty: number, good = FISH): void =>
      addToHold(state.player.cargo, { good, qty, paidCents: 0 });
    const days = (n: number): void => {
      const steps = Math.round((n * DAY) / WORLD_TICK_GAME_SECONDS);
      for (let i = 0; i < steps; i++) {
        state.environment.clock.gameSeconds += WORLD_TICK_GAME_SECONDS;
        events.emit('WorldTick', { gameSeconds: state.environment.clock.gameSeconds });
      }
    };
    /** Sells fish at Bayfield three weeks running: Hollister notices. */
    const provoke = (): void => {
      for (let i = 0; i < 3; i++) {
        hold(2);
        expect(economy.sell(BAY, FISH, 2).ok).toBe(true);
        days(0.5);
      }
    };
    const crime = (crime: string): void =>
      events.emit('CrimeCommitted', {
        crimeId: `c${seen.length}`,
        crime,
        region: 'region.apostles',
        port: BAY,
        witnesses: 0,
        at: state.environment.clock.gameSeconds,
        company: def.company,
      });
    const letters = (): string[] => game.letters().map((l) => l.subject);
    const story = (event: string) =>
      state.newspapers?.stories.find((s) => s.kind === 'event' && s.event === event);
    return {
      state,
      economy,
      game,
      feuds,
      contracts,
      seen,
      hold,
      days,
      provoke,
      crime,
      letters,
      story,
    };
  }

  it("sells in Bayfield bring Hollister's letter, and its buyers pay you 60%", () => {
    const { state, economy, feuds, provoke, letters, hold, seen, game } = setup();
    provoke();
    expect(feuds.state().stage).toBe('undercut');
    expect(letters()).toContain('Your fish');
    expect(game.talk().some((t) => t.lines.some((l) => l.includes('sixty cents')))).toBe(true);
    expect(seen.some((e) => e.type === 'FeudChanged')).toBe(true);
    const market = must(
      unitPrices(economy.defs, state.markets, BAY, FISH, state.environment.clock.gameSeconds),
    );
    const listed = must(economy.prices(BAY).find((p) => p.good === FISH));
    expect(listed.sellCents).toBe(Math.floor(market.sellCents * def.undercut));
    expect(feuds.sellTerms(BAY, FISH)?.note).toBe('Hollister pays you 60%');
    expect(feuds.sellTerms('port.duluth', FISH)).toBeUndefined();
    hold(1);
    const purse = state.player.purse;
    const q = economy.quote(BAY, FISH, 1, 'sell').totalCents;
    expect(economy.sell(BAY, FISH, 1).ok).toBe(true);
    expect(state.player.purse - purse).toBe(q);
    expect(q).toBe(Math.floor(market.sellCents * def.undercut));
  });

  it('then turns your catch away, shuts you out of its contracts, and offers terms', () => {
    const { state, economy, feuds, contracts, provoke, hold, days, letters, story, game } = setup();
    const hollisters = () =>
      contracts.board(BAY).filter((o) => o.terms.company === def.company).length;
    // A day when Hollister's agent has something on the board.
    for (let i = 0; i < 40 && hollisters() === 0; i++)
      state.environment.clock.gameSeconds += DAY / 4;
    expect(hollisters()).toBeGreaterThan(0);
    provoke();
    hold(4);
    economy.sell(BAY, FISH, 2);
    economy.sell(BAY, FISH, 2);
    expect(feuds.state().stage).toBe('refused');
    expect(feuds.sellTerms(BAY, FISH)?.refused).toMatch(/won't take your fish/);
    expect(feuds.shunned()).toEqual([def.company]);
    expect(story(def.events.refuses)?.ident).toBe('person');
    expect(hollisters()).toBe(0);
    days(def.terms.afterDays + 0.1);
    expect(letters()).toContain('Terms');
    const terms = must(game.letters().find((l) => l.subject === 'Terms'));
    expect(game.answer(terms.key, def.events.acceptChoice)).toMatch(/you accept/);
    expect(feuds.state().stage).toBe('yielded');
    expect(story(def.events.yielded)).toBeDefined();
    expect(feuds.sellTerms(BAY, FISH)?.factor).toBe(def.ends.yielded.factor);
    expect(feuds.shunned()).toEqual([]);
    expect((state.logbook ?? []).some((l) => l.text.includes('Came to terms'))).toBe(true);
  });

  it('an unanswered offer is torn up, and offered again later', () => {
    const { feuds, provoke, days, game } = setup('torn');
    provoke();
    days(def.refuse.afterDays + 0.1);
    expect(feuds.state().stage).toBe('refused');
    days(def.terms.afterDays + 2.2);
    const first = must(game.letters().find((l) => l.subject === 'Terms'));
    expect(first.result).toMatch(/tear the letter/);
    expect(feuds.state().stage).toBe('refused');
    days(def.terms.againDays);
    expect(game.letters().filter((l) => l.subject === 'Terms').length).toBe(2);
  });

  it('robbing its tugs posts a reward, then makes Hollister give, with Fame and the papers', () => {
    const { state, feuds, provoke, crime, letters, story } = setup('tugs');
    provoke();
    const heat = state.wanted['region.chequamegon']?.heat ?? 0;
    crime('crime.piracy');
    crime('crime.piracy');
    expect(feuds.state().reward).toBe(true);
    expect(story(def.events.reward)).toBeDefined();
    expect(state.wanted['region.chequamegon']?.heat ?? 0).toBeGreaterThan(heat);
    const fame = state.fame.value;
    crime('crime.sinking');
    expect(feuds.state()).toMatchObject({ stage: 'won', method: 'tugs' });
    expect(letters()).toContain('Enough');
    expect(story(def.events.gives.tugs)?.ident).toBe('person');
    expect(state.fame.value).toBeGreaterThan(fame);
    expect(feuds.sellTerms(BAY, FISH)?.factor).toBe(def.ends.won.factor);
    expect(fameTier(gameLaw(), state.fame.value)).toBeGreaterThanOrEqual(0);
  });

  it('sabotage at its sheds counts for the sheds', () => {
    const { feuds, provoke, crime } = setup('sheds');
    provoke();
    crime('crime.sabotage');
    crime('crime.burglary');
    crime('crime.sabotage');
    expect(feuds.state()).toMatchObject({ stage: 'won', method: 'sheds' });
  });

  it('out-trading it: fish sold elsewhere and Standing won in Bayfield', () => {
    const { state, economy, feuds, provoke, hold, letters, story } = setup('trade');
    provoke();
    (state.player.standing ??= {})[BAY] = (state.player.standing[BAY] ?? 0) + 12;
    hold(40);
    expect(economy.sell('port.duluth', FISH, 40).ok).toBe(true);
    expect(feuds.state()).toMatchObject({ stage: 'won', method: 'trade' });
    expect(letters()).toContain('A proposal');
    expect(story(def.events.gives.trade)).toBeDefined();
  });

  it('saves with the run, and a run from before it loads with none', () => {
    const { state, provoke, crime } = setup('save');
    provoke();
    crime('crime.piracy');
    const round = worldStateSchema.parse(JSON.parse(JSON.stringify(state)));
    expect(round.feuds?.['feud.hollister']).toMatchObject({ stage: 'undercut', tugs: 35 });
    const old = JSON.parse(JSON.stringify(state)) as Record<string, unknown>;
    delete old['feuds'];
    expect(worldStateSchema.parse(old).feuds).toBeUndefined();
  });

  it('none of its events turns up in a seeded year of draws', () => {
    expect(EVENTS.events.filter((e) => e.type === 'feud').every((e) => e.draw === false)).toBe(
      true,
    );
  });
});
