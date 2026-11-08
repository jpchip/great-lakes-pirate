import { describe, expect, it } from 'vitest';
import { EventBus } from '../src/core/events';
import { SECONDS_PER_GAME_DAY, WORLD_TICK_GAME_SECONDS } from '../src/core/time';
import { attachLaw, lawWorld } from '../src/gameplay/law';
import { attachPapers, compassWords, outlookWords } from '../src/gameplay/papers';
import type { GameContext, GameEvents } from '../src/modes/context';
import { gameLaw, fameTier, wantedTier } from '../src/sim/law/defs';
import { heatIn, setHeat, tickLaw } from '../src/sim/law/law';
import { createLawState } from '../src/sim/law/state';
import {
  addStory,
  arrivesAt,
  gameNews,
  goodsText,
  pressDay,
  pressTime,
  printingFame,
  renderStory,
  storiesFor,
  storyDef,
  type PressWorld,
} from '../src/sim/news/papers';
import { freshNews, type NewsState } from '../src/sim/news/state';
import { stormSignalUp } from '../src/sim/news/storm-signal';
import { LAKE_CENTER } from '../src/sim/weather/geography';
import {
  barometerAt,
  createWeatherState,
  type PressureSystem,
  type WeatherState,
} from '../src/sim/weather/weather';
import { createWorldState } from '../src/sim/world-state';
import { papersSnapshot, signalsText } from '../src/ui/port/papers-model';
import { portSnapshot } from '../src/ui/port/model';
import { attachEconomy } from '../src/gameplay/economy';

/**
 * Newspapers v1 and Fame (plan 12 §6, plan 06 §4 and §9; Phase 5 piece F): stories from
 * events, printed a few days late in the papers that cover them, Fame from the printing
 * (exaggerated, capped for honest feats), the papers' extra heat, the WANTED column, storm
 * signals on the forecast rule, the newsstand and the tier-5 front page. Exit criterion 11.
 */

const law = gameLaw();
const news = gameNews();
const CHEQ = 'region.chequamegon';
const DULUTH = 'region.duluth';
const DAY = SECONDS_PER_GAME_DAY;
const BAYFIELD = must(news.paperById.get('paper.bayfield_weekly'));
const LANTERN = must(news.paperById.get('paper.duluth_lantern'));

function must<T>(x: T | undefined | null): T {
  if (x === undefined || x === null) throw new Error('missing');
  return x;
}

function world(fame = 0): PressWorld {
  const state = createLawState('ship.schooner_t1', 'Lark', 0);
  state.fame.value = fame;
  return {
    law,
    lawWorld: { law: state, standing: {}, seed: 'seed' },
    captain: 'Ada Reid',
    ship: 'Lark',
    seed: 'seed',
    goodName: (g) => (g === 'good.untaxed_whiskey' ? 'Untaxed whiskey' : g),
    cutter: () => ['The revenue cutter Morrill is coaling at Duluth.'],
    weather: (p) => ({ text: `For ${p.town} and vicinity: fair.`, signals: [] }),
  };
}

function theft(
  n: NewsState,
  at: number,
  region = CHEQ,
  ident: 'ship' | 'person' | 'schooner' = 'person',
) {
  return addStory(news, n, {
    kind: 'crime',
    key: `crime:${at}`,
    at,
    region,
    port: 'port.bayfield',
    ident,
    crime: 'crime.contract_theft',
    heat: 40,
  });
}

describe('the papers (data)', () => {
  it('has four papers and lines for every Phase 5 crime', () => {
    expect(news.papers.map((p) => p.town)).toEqual(['Duluth', 'Superior', 'Ashland', 'Bayfield']);
    for (const [id, c] of law.crimes) {
      if (c.phase === 5) expect(news.file.stories.crime[id], id).toBeDefined();
    }
    for (const p of news.papers) {
      for (const r of p.covers) expect(law.regionById.has(r), r).toBe(true);
      expect(law.regionById.has(p.region)).toBe(true);
    }
  });

  it('gives the Duluth daily the biggest Fame factor (plan 12 §6.1)', () => {
    const top = Math.max(...news.papers.map((p) => p.fameFactor));
    expect(LANTERN.fameFactor).toBe(top);
  });
});

describe('printing a few days late (plan 06 §9)', () => {
  it('prints a story in the first edition after the news reaches each paper, once', () => {
    const n = freshNews(-1);
    const s = must(theft(n, 10 * 3600));
    // The Bayfield weekly hears of a Chequamegon crime the same day, Ashland's paper later.
    expect(arrivesAt(news, BAYFIELD, s)).toBeLessThan(
      arrivesAt(news, must(news.paperById.get('paper.ashland_gazette')), s),
    );
    const w = world();
    // Day 0's papers went to press at 06:00, before it happened.
    expect(storiesFor(news, n, BAYFIELD, pressTime(news, 0), 0)).toHaveLength(0);
    const day1 = pressDay(news, w, n, 1);
    const weekly = must(day1.editions.find((e) => e.paper === BAYFIELD.id));
    expect(weekly.lead.story).toBe(s.id);
    expect(weekly.lead.headline).toBe(weekly.lead.headline.toUpperCase());
    expect(weekly.lead.body).toContain('Captain Ada Reid of the schooner Lark');
    // Not again the next day.
    const day2 = pressDay(news, w, n, 2);
    expect(must(day2.editions.find((e) => e.paper === BAYFIELD.id)).lead.story).toBeUndefined();
    expect(s.printedIn).toContain(BAYFIELD.id);
  });

  it('leaves Duluth news out of the Bayfield weekly, and Bayfield news out of Duluth until you are Known', () => {
    const n = freshNews(-1);
    const far = must(theft(n, 2 * 3600, DULUTH));
    const near = must(theft(n, 3 * 3600, CHEQ));
    const at = pressTime(news, 2);
    expect(storiesFor(news, n, BAYFIELD, at, 0).map((s) => s.id)).toEqual([near.id]);
    expect(storiesFor(news, n, LANTERN, at, 0).map((s) => s.id)).toEqual([far.id]);
    // A captain the whole lake knows makes the Duluth daily from anywhere.
    expect(
      storiesFor(news, n, LANTERN, at, 2)
        .map((s) => s.id)
        .sort(),
    ).toEqual([far.id, near.id].sort());
  });

  it('drops news gone stale', () => {
    const n = freshNews(-1);
    theft(n, 0);
    expect(storiesFor(news, n, BAYFIELD, pressTime(news, news.file.staleDays + 2), 0)).toEqual([]);
  });

  it('folds two reports on one crime into one story, naming you the better', () => {
    const n = freshNews(-1);
    addStory(news, n, {
      kind: 'crime',
      key: 'crime:x',
      at: 0,
      region: CHEQ,
      ident: 'schooner',
      crime: 'crime.smuggler_deal',
      heat: 0,
    });
    addStory(news, n, {
      kind: 'crime',
      key: 'crime:x',
      at: 60,
      region: CHEQ,
      ident: 'ship',
      crime: 'crime.smuggler_deal',
      heat: 20,
    });
    expect(n.stories).toHaveLength(1);
    expect(n.stories[0]).toMatchObject({ ident: 'ship', heat: 20 });
  });
});

describe('yellow journalism (plan 06 §4.1)', () => {
  it('turns lurid once you are Known, with an epithet and inflated quantities', () => {
    const n = freshNews(-1);
    const s = must(
      addStory(news, n, {
        kind: 'seizure',
        key: 'seizure',
        at: 0,
        region: CHEQ,
        ident: 'ship',
        goods: [{ good: 'good.untaxed_whiskey', qty: 10 }],
      }),
    );
    const plain = renderStory(news, world(0), s, BAYFIELD, 0);
    const lurid = renderStory(news, world(400), s, BAYFIELD, 3);
    expect(plain.body).toContain('10 cases of untaxed whiskey');
    expect(lurid.body).toContain('25 cases of untaxed whiskey');
    expect(lurid.body).toContain('the infamous');
    expect(lurid.headline).not.toBe(plain.headline);
  });

  it('says how many: one good, several, and none', () => {
    const name = (g: string) => g.replace('good.', '');
    expect(goodsText(news, undefined, name, 0)).toBe('a cargo');
    expect(
      goodsText(
        news,
        [
          { good: 'good.untaxed_whiskey', qty: 4 },
          { good: 'good.furs', qty: 2 },
          { good: 'good.untaxed_whiskey', qty: 1 },
        ],
        name,
        0,
      ),
    ).toBe('5 cases of untaxed_whiskey and 2 bales of furs');
  });

  it('names nobody when the witness only saw a schooner', () => {
    const n = freshNews(-1);
    const s = must(
      addStory(news, n, {
        kind: 'crime',
        key: 'k',
        at: 0,
        region: CHEQ,
        ident: 'schooner',
        crime: 'crime.smuggler_deal',
      }),
    );
    const a = renderStory(news, world(), s, BAYFIELD, 0);
    expect(a.aboutYou).toBe(false);
    expect(a.body).not.toContain('Lark');
  });

  it('brings Fame for each printing about you, the most from the Duluth daily', () => {
    const def = must(storyDef(news, { kind: 'crime', crime: 'crime.contract_theft' }));
    const weekly = printingFame(news, def, BAYFIELD, 0, true);
    const daily = printingFame(news, def, LANTERN, 0, true);
    expect(daily).toBeGreaterThan(weekly);
    expect(printingFame(news, def, LANTERN, 3, true)).toBeGreaterThan(daily);
    expect(printingFame(news, def, LANTERN, 0, false)).toBeCloseTo(daily / 2);

    const w = world();
    const n = freshNews(-1);
    theft(n, 3600);
    const { events } = pressDay(news, w, n, 1);
    const fame = events.filter((e) => e.type === 'FameChanged');
    expect(fame.length).toBeGreaterThan(0);
    expect(w.lawWorld.law.fame.value).toBeGreaterThan(0);
    expect(w.lawWorld.law.fame.lastNotableAt).toBe(pressTime(news, 1));
  });

  it('brings no Fame for news that never named you', () => {
    const w = world();
    const n = freshNews(-1);
    theft(n, 3600, CHEQ, 'schooner');
    pressDay(news, w, n, 1);
    expect(w.lawWorld.law.fame.value).toBe(0);
  });

  it("adds the papers' ~10% heat in the crime's region, at the first printing only", () => {
    const w = world();
    const n = freshNews(-1);
    theft(n, 3600);
    pressDay(news, w, n, 1);
    expect(heatIn(w.lawWorld.law, CHEQ)).toBeCloseTo(4);
    pressDay(news, w, n, 2);
    pressDay(news, w, n, 3);
    expect(heatIn(w.lawWorld.law, CHEQ)).toBeCloseTo(4);
  });
});

describe('Respectable Captain (plan 06 §4.3)', () => {
  it('raises Fame for honest feats, but no higher than tier 2', () => {
    const w = world(news.file.feats.fameCap - 1);
    const n = freshNews(-1);
    for (let i = 0; i < 5; i++) {
      addStory(news, n, {
        kind: 'firstBoat',
        key: `fb${i}`,
        at: i * DAY + 3600,
        region: CHEQ,
        port: 'port.bayfield',
        ident: 'person',
      });
      pressDay(news, w, n, i + 1);
    }
    expect(w.lawWorld.law.fame.value).toBeCloseTo(news.file.feats.fameCap);
    expect(fameTier(law, w.lawWorld.law.fame.value)).toBe(2);
  });

  it('lets an honest captain reach Rumored from feats alone', () => {
    const w = world();
    const n = freshNews(-1);
    for (let i = 0; i < 6; i++) {
      addStory(news, n, {
        kind: 'recordRun',
        key: `r${i}`,
        at: i * DAY + 3600,
        region: DULUTH,
        port: 'port.duluth',
        ident: 'person',
      });
      pressDay(news, w, n, i + 1);
    }
    expect(fameTier(law, w.lawWorld.law.fame.value)).toBeGreaterThanOrEqual(1);
  });

  it('lets Fame fade after the grace period with nothing in the papers', () => {
    const l = createLawState('ship.schooner_t1', 'Lark', 0);
    l.fame = { value: 200, lastNotableAt: 0 };
    const lw = { law: l, standing: {}, seed: 's' };
    tickLaw(law, lw, 2 * DAY, 24, undefined);
    expect(l.fame.value).toBe(200);
    for (let d = 4; d <= 10; d++) tickLaw(law, lw, d * DAY, 24, undefined);
    expect(l.fame.value).toBeLessThan(200);
  });
});

describe('the rest of the paper', () => {
  it('prints the WANTED column for the regions it covers, Most Wanted first', () => {
    const w = world();
    setHeat(law, w.lawWorld.law, CHEQ, 120);
    setHeat(law, w.lawWorld.law, 'region.apostles', 1200);
    setHeat(law, w.lawWorld.law, DULUTH, 400);
    const n = freshNews(-1);
    const { editions } = pressDay(news, w, n, 1);
    const weekly = must(editions.find((e) => e.paper === BAYFIELD.id));
    expect(weekly.wanted.map((x) => x.region)).toEqual(['region.apostles', CHEQ]);
    expect(weekly.wanted[0]).toMatchObject({ headline: 'WANTED: DEAD OR ALIVE', tier: 5 });
    expect(must(weekly.wanted[0]).reward).toMatch(/^\$[\d,]+ reward$/);
    expect(weekly.cutter).toEqual(['The revenue cutter Morrill is coaling at Duluth.']);
    expect(weekly.weather.text).toContain('Bayfield');
    // A quiet week leads with local news.
    expect(weekly.lead.aboutYou).toBe(false);
    expect(weekly.lead.headline.length).toBeGreaterThan(0);
    expect(wantedTier(law, heatIn(w.lawWorld.law, 'region.apostles'))).toBe(5);
  });

  it('keeps the last editions of each paper', () => {
    const w = world();
    const n = freshNews(-1);
    for (let d = 1; d <= 5; d++) pressDay(news, w, n, d);
    expect(must(n.editions[BAYFIELD.id]).map((e) => e.day)).toEqual([5, 4]);
    expect(n.printedDay).toBe(5);
  });

  it('words the weather like a paper', () => {
    expect(compassWords(Math.PI * 1.75)).toBe('northwest');
    expect(compassWords(Math.PI * 1.875)).toBe('north-northwest');
    const f = {
      barometer: { hpa: 1000, tendency3h: -4, trend: 'falling fast' as const },
      leadHours: 24,
      windFrom: Math.PI * 1.75,
      windLowKn: 18,
      windHighKn: 26,
      rain: true,
      squall: false,
      visibilityM: 20_000,
    };
    expect(outlookWords(f, 'Duluth')).toBe(
      'For Duluth and vicinity: strong northwest winds, rain. The barometer is falling fast: mariners should be on their guard.',
    );
    expect(signalsText(['Duluth', 'Superior', 'Two Harbors'])).toBe(
      'Storm signals are flying at Duluth, Superior and Two Harbors.',
    );
    expect(signalsText([])).toBeUndefined();
  });
});

describe('port storm signals on the forecast rule (plan 04 §5.4)', () => {
  /** A deep low coming at the lake's middle from the west. */
  function approaching(t: number, peakHpa: number): WeatherState {
    const s = createWeatherState('signal', t);
    s.systems = [];
    s.fogBanks = [];
    const low: PressureSystem = {
      id: 1,
      kind: 'low',
      track: 'pacific',
      x: LAKE_CENTER.x - 450_000,
      y: LAKE_CENTER.y,
      vx: 14,
      vy: 0,
      radius: 400_000,
      peakHpa,
      age: 50 * 3600,
      life: 100 * 3600,
    };
    s.systems.push(low);
    s.tickSeconds = t;
    return s;
  }

  it('flies when the barometer falls fast, and not in settled weather', () => {
    const t = 200 * DAY + 12 * 3600;
    const storm = approaching(t, -30);
    expect(barometerAt(storm, LAKE_CENTER, t).trend).toBe('falling fast');
    expect(stormSignalUp(storm, LAKE_CENTER, t)).toBe(true);
    const calm = createWeatherState('signal', t);
    calm.systems = [];
    calm.tickSeconds = t;
    expect(stormSignalUp(calm, LAKE_CENTER, t)).toBe(false);
  });
});

describe('the papers in the game', () => {
  function setup() {
    const state = createWorldState('papers', 0);
    state.environment.clock.gameSeconds = 7 * 3600;
    const events = new EventBus<GameEvents>();
    const ctx = { state, events } as unknown as GameContext;
    const economy = attachEconomy(ctx, undefined);
    const gameLawCtl = attachLaw(ctx, 'seed');
    const front: string[] = [];
    const papers = attachPapers({
      ctx,
      law: gameLawCtl,
      seed: 'seed',
      goodName: (g) => economy.defs.goods.get(g)?.name ?? g,
      onFrontPage: (p) => front.push(p.region),
    });
    const seen: { type: string; payload: unknown }[] = [];
    events.tap((type, payload) => seen.push({ type, payload }));
    const tickTo = (t: number): void => {
      while (state.environment.clock.gameSeconds < t) {
        state.environment.clock.gameSeconds += WORLD_TICK_GAME_SECONDS;
        events.emit('WorldTick', { gameSeconds: state.environment.clock.gameSeconds });
      }
    };
    return { state, events, papers, law: gameLawCtl, seen, front, tickTo, economy };
  }

  it("has today's papers from the start", () => {
    const { papers } = setup();
    const stand = papers.stand('port.bayfield');
    expect(stand.papers.map((p) => p.id)).toEqual([
      'paper.duluth_lantern',
      'paper.ashland_gazette',
      'paper.bayfield_weekly',
    ]);
    expect(stand.papers.every((p) => p.edition?.day === 0)).toBe(true);
  });

  it('prints a stolen contract in the papers the next morning, and Fame moves (criterion 11)', () => {
    const { state, events, tickTo, seen, papers } = setup();
    events.emit('ContractStolen', {
      contractId: 'c1',
      from: 'port.duluth',
      to: 'port.ashland',
      company: 'company.gogebic',
      port: 'port.bayfield',
      good: 'good.kerosene',
      qty: 5,
    } as unknown as GameEvents['ContractStolen']);
    // The freight agent's report lands within the day; the papers print at 06:00 next day.
    tickTo(DAY + 7 * 3600);
    const printed = seen.filter((e) => e.type === 'NewspaperPrinted');
    expect(printed.some((e) => (e.payload as { aboutYou: boolean }).aboutYou)).toBe(true);
    const weekly = must(must(papers.state.editions['paper.bayfield_weekly'])[0]);
    expect(weekly.lead.aboutYou).toBe(true);
    expect(state.fame.value).toBeGreaterThan(5);
  });

  it('sells a paper for two cents, once an edition, and the paper boy cries it once', () => {
    const { state, papers, seen } = setup();
    const purse = state.player.purse;
    papers.cry('port.bayfield');
    papers.cry('port.bayfield');
    expect(seen.filter((e) => e.type === 'PaperCried')).toHaveLength(1);
    expect(papers.buy('port.bayfield', 'paper.superior_courier')).toBe(
      "That paper isn't sold here.",
    );
    expect(papers.buy('port.bayfield', 'paper.bayfield_weekly')).toBeUndefined();
    expect(state.player.purse).toBe(purse - 2);
    expect(papers.buy('port.bayfield', 'paper.bayfield_weekly')).toBeUndefined();
    expect(state.player.purse).toBe(purse - 2);
    expect(
      must(papers.stand('port.bayfield').papers.find((p) => p.id === 'paper.bayfield_weekly')).read,
    ).toBe(true);
    expect(seen.filter((e) => e.type === 'NewspaperBought')).toHaveLength(1);
  });

  it('shows the Most Wanted front page once per region', () => {
    const { law: l, front, papers } = setup();
    l.setTier('region.apostles', 5);
    expect(front).toEqual(['region.apostles']);
    const page = must(papers.takeFrontPage());
    expect(page.headline).toBe('WANTED: DEAD OR ALIVE');
    expect(page.paper).toBe("The Bayfield Fishermen's Weekly");
    expect(page.body.join(' ')).toContain('capture means the rope');
    l.setTier('region.apostles', 4);
    l.setTier('region.apostles', 5);
    expect(front).toHaveLength(1);
    // Cooled to Hunted, it can make the front page again.
    l.setTier('region.apostles', 3);
    l.setTier('region.apostles', 5);
    expect(front).toHaveLength(2);
  });

  it('turns an escape from the cutter into a story', () => {
    const { events, tickTo, papers, law: l } = setup();
    l.setTier(CHEQ, 3);
    events.emit('CutterHailed', { by: 'law.morrill', intent: 'pursue', arrest: false });
    events.emit('PursuitChanged', { pursued: true, by: 'law.morrill' });
    events.emit('PursuitChanged', { pursued: false, by: 'law.morrill' });
    tickTo(7 * 3600 + 2 * 3600);
    expect(papers.state.stories.some((s) => s.kind === 'escape')).toBe(true);
  });

  it('puts the newsstand on the port screen before the ledger', () => {
    const { state, papers, economy } = setup();
    const snap = portSnapshot({
      defs: economy.defs,
      markets: state.markets,
      knowledge: state.knowledge.prices,
      trader: state.player,
      capacity: 40,
      load01: 0,
      cargoSpeedLoss: 0,
      port: 'port.bayfield',
      gameSeconds: state.environment.clock.gameSeconds,
    });
    const view = papersSnapshot(papers.defs, papers.stand('port.bayfield'), state.player.purse, 0);
    expect(view.papers[0]).toMatchObject({ priceText: '2¢', read: false, affordable: true });
    expect(must(view.papers[0]).edition?.dateline).toMatch(/1900$/);
    expect(snap.tabs.at(-1)).toBe('ledger');
  });

  it('keeps the papers in the save', () => {
    const { state } = setup();
    expect(state.newspapers?.editions['paper.duluth_lantern']).toHaveLength(1);
    const lw = lawWorld(state, 'seed');
    expect(lw.law.fame.value).toBe(0);
  });
});
