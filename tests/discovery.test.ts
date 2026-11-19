import { describe, expect, it } from 'vitest';
import discoveriesJson from '../data/discoveries.json';
import curiosJson from '../data/curios.json';
import rumorsJson from '../data/rumors.json';
import { curiosFileSchema, discoveriesFileSchema } from '../data/schemas/discoveries';
import { rumorsFileSchema } from '../data/schemas/rumors';
import { EventBus } from '../src/core/events';
import { attachDiscovery, placeTalk } from '../src/gameplay/discovery';
import { attachEconomy } from '../src/gameplay/economy';
import { attachLaw } from '../src/gameplay/law';
import type { GameContext, GameEvents } from '../src/modes/context';
import {
  addClue,
  chartAround,
  chartFromLogbook,
  chartSurvey,
  closeLead,
  createDiscovery,
  displaySpaces,
  geoDistanceM,
  giveCurio,
  legendLeads,
  lookAround,
  markFound,
  markHeard,
  openLead,
  overChartedShoal,
  placeDef,
  placeDefs,
  placeTargets,
  showCurio,
  sightRangeM,
  type CurioState,
  type Lead,
  type Lookout,
} from '../src/sim/discovery/discovery';
import { buyStores } from '../src/sim/economy/chandlery';
import { LIGHTHOUSES } from '../src/sim/lighthouses';
import { rumorDrafts, type RumorWorld } from '../src/sim/rumors/rumors';
import { createWorldState, parseWorldState, type Rumor } from '../src/sim/world-state';
import { attachEconomy as economyFor } from '../src/gameplay/economy';

const must = <T>(v: T | undefined): T => {
  if (v === undefined) throw new Error('missing');
  return v;
};

const T0 = 10 * 3600;

/** A lookout `m` real meters north of a point, by day in clear weather. */
function lookFrom(at: { lat: number; lon: number }, northM: number, over: Partial<Lookout> = {}) {
  return {
    at: { lat: at.lat + northM / 111_195, lon: at.lon },
    daylight: 1,
    visibilityM: 20_000,
    spyglass: false,
    onFoot: false,
    ...over,
  };
}

describe('discovery data', () => {
  it('validates, and every place lies in reach of the water it is found from', () => {
    const file = discoveriesFileSchema.parse(discoveriesJson);
    expect(file.places.length).toBeGreaterThanOrEqual(20);
    expect(curiosFileSchema.parse(curiosJson).length).toBeGreaterThanOrEqual(6);
    for (const kind of ['poi', 'wonder', 'anchorage', 'shoal'] as const) {
      expect(file.places.some((p) => p.kind === kind)).toBe(true);
    }
    // Every legend told in the saloons has a place its lead circles.
    const legends = rumorsFileSchema.parse(rumorsJson).legends;
    for (const l of legends) expect(file.legends.some((a) => a.id === l.id)).toBe(true);
  });
});

describe('the lookout', () => {
  const caves = must(placeDef('wonder.devils_caves'));
  const quarry = must(placeDef('poi.hermit_quarry'));

  it('sees a point of interest by day within its range, less far at night', () => {
    const d = createDiscovery();
    const t = placeTargets();
    expect(lookAround(d, t, lookFrom(quarry.at, 5000), T0)).toEqual([]);
    expect(lookAround(d, t, lookFrom(quarry.at, 3500), T0)).toContainEqual({
      id: 'poi.hermit_quarry',
      how: 'sight',
    });
    const night = createDiscovery();
    expect(lookAround(night, t, lookFrom(quarry.at, 3500, { daylight: 0 }), T0)).toEqual([]);
    expect(sightRangeM(4000, lookFrom(quarry.at, 0, { daylight: 0 }))).toBeCloseTo(1200);
  });

  it('reaches further through the spyglass, and says so', () => {
    const d = createDiscovery();
    const found = lookAround(d, placeTargets(), lookFrom(caves.at, 9000, { spyglass: true }), T0);
    expect(found).toContainEqual({ id: 'wonder.devils_caves', how: 'spyglass' });
  });

  it('fog limits even the glass', () => {
    const d = createDiscovery();
    const fog = lookFrom(caves.at, 2000, { spyglass: true, visibilityM: 500 });
    expect(lookAround(d, placeTargets(), fog, T0)).toEqual([]);
    expect(lookAround(d, placeTargets(), { ...fog, at: lookFrom(caves.at, 400).at }, T0)).toEqual([
      { id: 'wonder.devils_caves', how: 'sight' },
    ]);
  });

  it('charts a cove or shoal only by sailing into it, not from the shore', () => {
    const julian = must(placeDef('anchorage.julian_bay'));
    const d = createDiscovery();
    const t = placeTargets();
    expect(lookAround(d, t, lookFrom(julian.at, 2500), T0)).toEqual([]);
    expect(lookAround(d, t, lookFrom(julian.at, 300, { onFoot: true }), T0)).toEqual([]);
    expect(lookAround(d, t, lookFrom(julian.at, 300), T0)).toContainEqual({
      id: 'anchorage.julian_bay',
      how: 'visit',
    });
    // Once charted, it isn't found again.
    expect(lookAround(d, t, lookFrom(julian.at, 0), T0)).toEqual([]);
  });

  it('walks up to a point of interest on foot', () => {
    const stockton = must(placeDef('poi.stockton_quarry'));
    const d = createDiscovery();
    const found = lookAround(d, placeTargets(), lookFrom(stockton.at, 300, { onFoot: true }), T0);
    expect(found).toContainEqual({ id: 'poi.stockton_quarry', how: 'foot' });
  });
});

describe('charting from paper and talk', () => {
  it('a survey sheet charts its coves and shoals, and nothing else', () => {
    const d = createDiscovery();
    const ids = chartSurvey(d, 'survey.apostles', T0);
    const expected = placeDefs().filter((p) => p.survey === 'survey.apostles');
    expect(ids.length).toBe(expected.length);
    expect(ids.every((id) => id.startsWith('anchorage.') || id.startsWith('shoal.'))).toBe(true);
    // Bark Point isn't on any sheet.
    expect(d.found['shoal.bark_point']).toBeUndefined();
    expect(chartSurvey(d, 'survey.apostles', T0)).toEqual([]);
  });

  it("a keeper's log charts the shoals and wrecks near his light", () => {
    const d = createDiscovery();
    const michigan = must(LIGHTHOUSES.find((l) => l.id === 'light.michigan'));
    const far = { id: 'wreck-9', at: { lat: 46.7, lon: -92 } };
    const near = { id: 'wreck-1', at: { lat: michigan.at.lat + 0.02, lon: michigan.at.lon } };
    const ids = chartFromLogbook(d, michigan.at, [near, far], T0);
    expect(ids).toContain('shoal.gull_island');
    expect(ids).toContain('wreck-1');
    expect(ids).not.toContain('wreck-9');
    expect(d.found['shoal.gull_island']?.how).toBe('logbook');
  });

  it('a report puts a place on as heard until it is seen', () => {
    const d = createDiscovery();
    expect(markHeard(d, 'shoal.gull_island', 'port.bayfield', T0)).toBe(true);
    expect(markHeard(d, 'shoal.gull_island', 'port.ashland', T0)).toBe(false);
    expect(markFound(d, 'shoal.gull_island', 'visit', T0 + 1)).toBe(true);
    expect(d.heard['shoal.gull_island']).toBeUndefined();
  });

  it('saloons talk of places not yet known, once each', () => {
    const state = createWorldState('place-talk');
    const economy = economyFor(
      { state, events: new EventBus<GameEvents>() } as unknown as GameContext,
      undefined,
    );
    const world: RumorWorld = {
      economy: economy.defs,
      markets: state.markets,
      placeTalk: () => placeTalk(state.discovery),
    };
    const rand = () => 0.5;
    const drafts = rumorDrafts(world, [], 'port.bayfield', T0, rand).filter(
      (d) => d.kind === 'place',
    );
    expect(drafts.map((d) => d.subject)).toContain('anchorage.julian_bay');
    // Ashland talks only of what it knows: Gull Island's shoal.
    const ashland = rumorDrafts(world, [], 'port.ashland', T0, rand).filter(
      (d) => d.kind === 'place',
    );
    expect(ashland.map((d) => d.subject)).toEqual(['shoal.gull_island']);
    // Heard, it isn't told again; found, nobody tells of it.
    const heard = { kind: 'place', draft: 'anchorage.julian_bay' } as Rumor;
    expect(
      rumorDrafts(world, [heard], 'port.bayfield', T0, rand).some(
        (d) => d.subject === 'anchorage.julian_bay',
      ),
    ).toBe(false);
    state.discovery = createDiscovery();
    markFound(state.discovery, 'wonder.devils_caves', 'sight', T0);
    expect(placeTalk(state.discovery).some((p) => p.id === 'wonder.devils_caves')).toBe(false);
  });

  it('an older save charts what it has been near', () => {
    const d = createDiscovery();
    const stockton = must(placeDef('poi.stockton_quarry'));
    const ids = chartAround(d, placeTargets(), [stockton.at], 3000, T0);
    expect(ids).toContain('poi.stockton_quarry');
    expect(ids).toContain('anchorage.quarry_bay');
    expect(ids).not.toContain('wonder.devils_caves');
  });

  it('a charted shoal is known to be under the keel', () => {
    const d = createDiscovery();
    const gull = must(placeDef('shoal.gull_island'));
    expect(overChartedShoal(d, gull.at)).toBe(false);
    markFound(d, gull.id, 'survey', T0);
    expect(overChartedShoal(d, gull.at)).toBe(true);
    expect(overChartedShoal(d, { lat: gull.at.lat + 0.05, lon: gull.at.lon })).toBe(false);
  });
});

describe('leads', () => {
  const lucerne = { lat: 46.7172, lon: -90.77 };
  const input = {
    id: 'legend.lucerne',
    kind: 'legend' as const,
    title: "The Lucerne's Last Cargo",
    where: 'off Long Island',
    center: lucerne,
    radiusM: 5000,
    clue: { text: 'A lantern bobs where she went down.', from: 'saloon talk in Ashland' },
  };

  it('open once, shrink with each new clue toward the spot, never below the floor', () => {
    const leads: Lead[] = [];
    const lead = openLead(leads, input, T0);
    expect(openLead(leads, input, T0 + 5)).toBe(lead);
    expect(leads).toHaveLength(1);
    const spot = { lat: lucerne.lat + 0.03, lon: lucerne.lon + 0.02 };
    const rules = { shrink: 0.5, minRadiusM: 400 };
    expect(
      addClue(lead, { text: 'The wreck lies north.', from: 'a log', toward: spot }, T0, rules),
    ).toBe(true);
    expect(lead.radiusM).toBe(2500);
    // The spot stays inside the circle.
    expect(geoDistanceM(lead.center, spot)).toBeLessThanOrEqual(lead.radiusM);
    expect(addClue(lead, { text: 'The wreck lies north.', from: 'a log' }, T0, rules)).toBe(false);
    for (let k = 0; k < 6; k++)
      addClue(lead, { text: `clue ${k}`, from: 'x', toward: spot }, T0, rules);
    expect(lead.radiusM).toBe(400);
    expect(geoDistanceM(lead.center, spot)).toBeLessThanOrEqual(400);
    expect(closeLead(lead, 'found', T0)).toBe(true);
    expect(addClue(lead, { text: 'late', from: 'x' }, T0, rules)).toBe(false);
  });

  it('legend tales heard (in an old save too) open their leads with the first telling', () => {
    const leads: Lead[] = [];
    const rumors = [
      {
        kind: 'legend',
        draft: 'legend.lucerne',
        text: 'later',
        heardAt: 200,
        port: 'port.bayfield',
      },
      {
        kind: 'legend',
        draft: 'legend.lucerne',
        text: 'first',
        heardAt: 100,
        port: 'port.ashland',
      },
      { kind: 'price', draft: 'x', text: 'no', heardAt: 50 },
    ];
    const names = new Map([['legend.lucerne', "The Lucerne's Last Cargo"]]);
    const opened = legendLeads(leads, rumors, names, (p) => p.replace('port.', ''));
    expect(opened).toHaveLength(1);
    expect(leads[0]?.clues[0]).toEqual({ at: 100, text: 'first', from: 'saloon talk in ashland' });
    expect(leads[0]?.radiusM).toBe(5000);
    expect(legendLeads(leads, rumors, names, (p) => p)).toEqual([]);
  });
});

describe('curios', () => {
  it('one of each, set out and taken back', () => {
    const c: CurioState[] = [];
    expect(giveCurio(c, 'curio.brass_compass', 'a cache', T0)).toBe(true);
    expect(giveCurio(c, 'curio.brass_compass', 'again', T0)).toBe(false);
    expect(giveCurio(c, 'curio.nonsense', 'x', T0)).toBe(false);
    expect(showCurio(c, 'curio.brass_compass', 'hideout.stockton')).toBe(true);
    expect(c[0]?.shownAt).toBe('hideout.stockton');
    showCurio(c, 'curio.brass_compass', undefined);
    expect(c[0]?.shownAt).toBeUndefined();
  });

  it('a hideout shows as many as its shelves, tables and chests hold', () => {
    const piece = (i: number) => [i, 0, 0, 0, 0, 0, 0];
    const layout = {
      palette: ['build.shelving', 'build.table', 'build.floor_plank'],
      built: [...piece(0), ...piece(1), ...piece(2)],
    };
    expect(displaySpaces(layout)).toBe(3);
    expect(displaySpaces({ palette: [], built: [] })).toBe(0);
  });
});

describe('discovery in the game', () => {
  function setup(seed = 'discovery') {
    const state = createWorldState(seed, T0);
    const events = new EventBus<GameEvents>();
    const ctx = { state, events } as unknown as GameContext;
    attachEconomy(ctx, undefined);
    const law = attachLaw(ctx, 'seed');
    const notices: string[] = [];
    let lookout: Lookout | undefined;
    const seen: { type: string; payload: unknown }[] = [];
    events.tap((type, payload) => seen.push({ type, payload }));
    const discovery = attachDiscovery({
      ctx,
      law: law.defs,
      notice: (t) => notices.push(t),
      lookout: () => lookout,
    });
    return {
      state,
      events,
      discovery,
      notices,
      seen,
      setLook: (l: Lookout | undefined) => (lookout = l),
    };
  }

  it('charts your own hideout from the start, and a sighting goes in the logbook', () => {
    const g = setup();
    expect(g.discovery.knows('site.stockton')).toBe(true);
    const caves = must(placeDef('wonder.devils_caves'));
    const fame = g.state.fame.value;
    g.setLook(lookFrom(caves.at, 1000));
    expect(g.discovery.look()).toContain('wonder.devils_caves');
    expect(g.state.fame.value).toBeGreaterThan(fame);
    expect(g.notices).toContain('Charted: The sea caves of Devils Island');
    expect(g.state.logbook?.at(-1)?.text).toBe('Sighted the sea caves of Devils Island.');
    expect(g.seen.some((e) => e.type === 'WonderSeen')).toBe(true);
    const marks = g.discovery.marks();
    expect(marks.find((m) => m.id === 'wonder.devils_caves')?.kind).toBe('wonder');
  });

  it('a place rumor and a survey sheet bought put places on the chart', () => {
    const g = setup();
    const rumor = {
      id: 'r1',
      kind: 'place',
      source: 'saloon',
      port: 'port.bayfield',
      heardAt: T0,
      text: 'Julian Bay',
      reliability: 1,
      truth: true,
      draft: 'anchorage.julian_bay',
      subject: 'anchorage.julian_bay',
    } as Rumor;
    g.events.emit('RumorHeard', { rumor, costCents: 0 });
    expect(g.discovery.marks().find((m) => m.id === 'anchorage.julian_bay')?.kind).toBe('reported');
    const economy = economyFor(
      { state: g.state, events: g.events } as unknown as GameContext,
      undefined,
    );
    g.state.player.purse = 100_000;
    const r = buyStores(economy.defs, g.state.player, 'port.bayfield', 'store.survey_apostles', 1);
    expect(r.ok).toBe(true);
    g.events.emit('StoresBought', {
      port: 'port.bayfield',
      item: 'store.survey_apostles',
      qty: 1,
      totalCents: 0,
    });
    expect(g.discovery.knows('anchorage.julian_bay')).toBe(true);
    expect(g.discovery.knows('shoal.gull_island')).toBe(true);
    // Bought once: the lockers hold one sheet.
    expect(
      buyStores(economy.defs, g.state.player, 'port.bayfield', 'store.survey_apostles', 1).ok,
    ).toBe(false);
  });

  it('a legend tale opens a lead with its circle on the chart, and the journal shows it', () => {
    const g = setup();
    const rumor = {
      id: 'r2',
      kind: 'legend',
      source: 'saloon',
      port: 'port.bayfield',
      heardAt: T0,
      text: 'The Lucerne went down off Long Island with all hands.',
      reliability: 0.3,
      truth: true,
      draft: 'legend.lucerne',
    } as Rumor;
    g.state.knowledge.rumors.unshift(rumor);
    g.events.emit('RumorHeard', { rumor, costCents: 0 });
    expect(g.discovery.leadMarks()).toEqual([
      expect.objectContaining({ id: 'legend.lucerne', radiusM: 5000 }),
    ]);
    const j = g.discovery.journal();
    expect(j.leads[0]?.title).toBe("The Lucerne's Last Cargo");
    expect(j.leads[0]?.clues[0]?.from).toBe('saloon talk in Bayfield');
    const legend = must(j.legends.find((l) => l.id === 'legend.lucerne'));
    expect(legend.status).toBe('Unsolved');
    expect(legend.steps[0]).toEqual({ text: 'Heard the tale', done: true });
    expect(j.legends.filter((l) => !l.status)).toHaveLength(4);
    expect(j.discoveries.find((x) => x.kind === 'site')?.rows[0]?.howText).toBe('Your own');
  });

  it("the Stockton cache's curio is kept and can be set out on the starter shack's shelves", () => {
    const g = setup();
    g.discovery.cacheOpened(
      'cache.stockton_quarry',
      "the quarrymen's cache",
      'curio.brass_compass',
    );
    expect(g.state.curios?.map((c) => c.id)).toEqual(['curio.brass_compass']);
    const hideout = must(Object.keys(g.state.hideouts ?? {})[0]);
    const view = g.discovery.hideoutCurios(hideout);
    expect(view.spaces).toBeGreaterThan(0);
    expect(view.aboard).toHaveLength(1);
    expect(g.discovery.setCurio('curio.brass_compass', hideout)).toBeUndefined();
    expect(g.discovery.hideoutCurios(hideout).shown.map((c) => c.id)).toEqual([
      'curio.brass_compass',
    ]);
    expect(g.discovery.journal().curios[0]?.whereText).toMatch(/^Set out at /);
  });

  it('saves round-trip, and an older save is charted with what it has visited', () => {
    const g = setup();
    g.discovery.chart('poi.hermit_quarry');
    g.discovery.giveCurio('curio.ships_bell', 'test');
    const back = parseWorldState(JSON.parse(JSON.stringify(g.state)));
    expect(back.discovery?.found['poi.hermit_quarry']?.how).toBe('sight');
    expect(back.curios?.[0]?.id).toBe('curio.ships_bell');

    const old = createWorldState('old-save', T0);
    old.knowledge.prices['port.bayfield'] = {};
    old.caches = { 'cache.stockton_quarry': { searched: [0], looted: true } };
    old.wrecks = {
      nextId: 2,
      list: [
        {
          id: 'wreck-1',
          shipId: 's',
          name: 'Ada',
          classId: 'c',
          how: 'foundered',
          byPlayer: false,
          at: { lat: 47, lon: -91 },
          sunkAt: 0,
          drowned: 0,
          cargo: [],
          lore: 'x',
        },
      ],
    };
    const ctx = { state: old, events: new EventBus<GameEvents>() } as unknown as GameContext;
    const law = attachLaw(ctx, 'seed');
    const d = attachDiscovery({ ctx, law: law.defs, notice: () => {}, lookout: () => undefined });
    expect(d.knows('poi.stockton_quarry')).toBe(true);
    expect(d.knows('wreck-1')).toBe(true);
    expect(d.knows('wonder.devils_caves')).toBe(false);
  });
});
