import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import curiosJson from '../data/curios.json';
import discoveriesJson from '../data/discoveries.json';
import fencesJson from '../data/fences.json';
import lighthousesJson from '../data/lighthouses.json';
import newspapersJson from '../data/newspapers.json';
import rumorsJson from '../data/rumors.json';
import salvageJson from '../data/salvage.json';
import { curiosFileSchema, discoveriesFileSchema } from '../data/schemas/discoveries';
import { ChartProjection, zoneToChart } from '../src/core/coords';
import { EventBus } from '../src/core/events';
import { attachDiscovery } from '../src/gameplay/discovery';
import { attachEconomy } from '../src/gameplay/economy';
import { attachLaw } from '../src/gameplay/law';
import { attachLegends, type GameLegends } from '../src/gameplay/legends';
import { attachPapers } from '../src/gameplay/papers';
import type { GameContext, GameEvents } from '../src/modes/context';
import { placeZoneCaves, CAVES } from '../src/sim/caves/caves';
import { geoDistanceM } from '../src/sim/discovery/discovery';
import {
  ISLANDS,
  placeZoneIslands,
  rollCache,
  type PlacedIsland,
} from '../src/sim/islands/on-foot';
import {
  cacheNote,
  CLUES,
  documentClue,
  HOARD_LEGEND,
  LEGEND_RULES,
  LEGENDS,
  landNear,
  logbookClues,
  mapRefusal,
  placeLegends,
  SEEDED_CACHES,
  stockedCaches,
  type PlacedLegends,
} from '../src/sim/legends/legends';
import { RIVALS } from '../src/sim/rivals/rivals';
import { loadZoneTerrain, type LoadedZone } from '../src/sim/terrain/load';
import { manifestFrame } from '../src/sim/terrain/zones';
import { createWorldState } from '../src/sim/world-state';

/**
 * Plan 11 §7–9, §18.3 criterion 13 ("each of the six legends can be finished from its
 * first clue to its payoff; caches differ by seed; three clues make a map"), §18.4 piece T.
 */

const must = <T>(v: T | undefined): T => {
  if (v === undefined) throw new Error('missing');
  return v;
};

describe('legends.json, clues.json and caches.json', () => {
  const curios = new Set(curiosFileSchema.parse(curiosJson).map((c) => c.id));
  const areas = discoveriesFileSchema.parse(discoveriesJson).legends;
  const lights = new Set((lighthousesJson as { id: string }[]).map((l) => l.id));
  const fences = new Set((fencesJson as { id: string }[]).map((f) => f.id));
  const tales = (rumorsJson as { legends: { id: string }[] }).legends.map((l) => l.id);

  it('has the six legends, each told in the saloons but the copycat', () => {
    expect(LEGENDS.map((l) => l.id).sort()).toEqual(
      [
        'legend.copycat_hoard',
        'legend.dark_light',
        'legend.devils_grotto',
        'legend.ghost_net',
        'legend.lucerne',
        'legend.quarry_payroll',
      ].sort(),
    );
    for (const id of tales) {
      expect(
        LEGENDS.some((l) => l.id === id),
        id,
      ).toBe(true);
      expect(
        areas.some((a) => a.id === id),
        id,
      ).toBe(true);
    }
  });

  it('ties every legend to its curio, fence and story', () => {
    const stories = (newspapersJson as { stories: { legend: Record<string, unknown> } }).stories
      .legend;
    for (const l of LEGENDS) {
      if (l.curio) expect(curios.has(l.curio), l.id).toBe(true);
      if (l.fence) expect(fences.has(l.fence), l.id).toBe(true);
      expect(stories[l.id], l.id).toBeDefined();
      expect(l.found).toContain('{cash}');
    }
  });

  it('gives every told legend enough clues for a map, the tale counting as one', () => {
    const papers = (
      salvageJson as { historical: { papers?: { lead?: string } }[] }
    ).historical.flatMap((w) => (w.papers?.lead ? [w.papers.lead] : []));
    for (const id of tales) {
      const clues =
        CLUES.filter((c) => c.lead === id).length + papers.filter((p) => p === id).length;
      expect(1 + clues, id).toBeGreaterThanOrEqual(LEGEND_RULES.mapClues);
    }
  });

  it('ties every clue to a lead, a light, a cave and a curio that exist', () => {
    const caches = new Set(SEEDED_CACHES.map((c) => c.id));
    for (const c of CLUES) {
      expect(LEGENDS.some((l) => l.id === c.lead) || caches.has(c.lead), c.id).toBe(true);
      if (c.source.kind === 'logbook') expect(lights.has(c.source.light), c.id).toBe(true);
      if (c.source.kind === 'caveMark') {
        const src = c.source;
        const cave = CAVES.find((k) => k.id === src.cave);
        expect(
          cave?.marks.some((m) => m.id === src.mark),
          c.id,
        ).toBe(true);
      }
      if (c.curio) expect(curios.has(c.curio), c.id).toBe(true);
    }
  });

  it('keeps the seeded caches apart from the islands', () => {
    const ids = [
      ...SEEDED_CACHES.map((c) => c.id),
      ...ISLANDS.flatMap((i) => i.onFoot?.caches.map((k) => k.id) ?? []),
      ...CAVES.flatMap((c) => c.caches.map((k) => k.id)),
    ];
    expect(new Set(ids).size).toBe(ids.length);
    for (const c of SEEDED_CACHES) {
      const island = ISLANDS.find((i) => i.id === c.island);
      for (const s of c.spots) {
        expect(
          island?.onFoot?.pois.some((p) => p.id === s.poi),
          `${c.id} ${s.poi}`,
        ).toBe(true);
      }
    }
  });

  it('stocks different caches, spots and sums by seed', () => {
    const a = stockedCaches(1);
    const b = [2, 3, 4, 5, 6].map((s) => [...stockedCaches(s)].sort().join());
    expect(a.size).toBe(Math.round(SEEDED_CACHES.length * 0.6));
    expect(b.some((x) => x !== [...a].sort().join())).toBe(true);
    const otter = must(SEEDED_CACHES.find((c) => c.id === 'cache.otter_trapper'));
    const def = {
      id: otter.id,
      name: otter.name,
      spots: otter.spots.map((s) => ({ name: s.name, x: 0, z: 0 })),
      cashCents: otter.cashCents,
      found: otter.found,
    };
    const rolls = [1, 2, 3, 4, 5, 6, 7, 8].map((s) => rollCache(def, s));
    expect(new Set(rolls.map((r) => r.spot)).size).toBe(2);
    expect(new Set(rolls.map((r) => r.cents)).size).toBeGreaterThan(4);
  });

  it('turns up the districts and the logbooks in order, and notes by the seed', () => {
    expect(documentClue('district.bayfield', [])?.id).toBe('clue.lucerne_letter');
    expect(documentClue('district.bayfield', ['clue.lucerne_letter'])?.id).toBe(
      'clue.payroll_ledger',
    );
    expect(documentClue('district.duluth', [])?.id).toBe('clue.dark_light_note');
    expect(logbookClues('light.devils').map((c) => c.id)).toEqual(['clue.grotto_logbook']);
    const notes = Array.from({ length: 60 }, (_, k) => cacheNote(7, `box${k}`, []));
    const some = notes.filter(Boolean).length;
    expect(some).toBeGreaterThan(5);
    expect(some).toBeLessThan(45);
    expect(notes.every((n) => !n || stockedCaches(7).has(n.id))).toBe(true);
  });

  it('asks three clues of a map', () => {
    expect(mapRefusal({ id: 'legend.x', clues: [1, 2] }, {})).toMatch(/2 of 3/);
    expect(mapRefusal({ id: 'legend.x', clues: [1, 2, 3] }, {})).toBeUndefined();
    expect(mapRefusal({ id: 'legend.x', clues: [1, 2, 3] }, { 'legend.x': 1 })).toMatch(/already/);
  });
});

// --- On the baked Apostles zone.

const dir = join(__dirname, '..', 'public', 'world', 'apostles');
const baked =
  existsSync(join(dir, 'manifest.json')) &&
  existsSync(join(dir, 'height', '0-0.bin')) &&
  readFileSync(join(dir, 'height', '0-0.bin')).byteLength > 200;

describe.skipIf(!baked)('the legends on the islands', () => {
  let zone: LoadedZone;
  let placed: PlacedIsland[] = [];
  let legends: PlacedLegends = { spots: [], marks: [], pads: [] };
  const geo = new ChartProjection();
  const heightAt = (x: number, z: number): number => zone.terrain.heightAt(x, z);

  beforeAll(async () => {
    const read = async (path: string) => new Uint8Array(readFileSync(join(dir, path)));
    zone = await loadZoneTerrain(read);
    const frame = manifestFrame(zone.manifest);
    placed = placeZoneIslands(zone.manifest.zone, zone.manifest.islands ?? [], heightAt, frame);
    const caves = placeZoneCaves(zone.manifest.zone, zone.manifest.islands ?? [], placed, frame);
    legends = placeLegends(
      zone.manifest.zone,
      placed,
      caves,
      frame,
      heightAt,
      RIVALS.camps.map((c) => ({ id: c.id, island: c.island, at: c.at })),
    );
  }, 120_000);

  it("finds every island legend's spot, and its chart point is the mark's", () => {
    const frame = manifestFrame(zone.manifest);
    for (const def of LEGENDS) {
      const s = def.spot;
      if (s.kind !== 'poi' && s.kind !== 'cave') continue;
      const spot = must(legends.spots.find((k) => k.legend === def.id));
      const at = geo.chartToGeo(zoneToChart(spot, frame));
      expect(geoDistanceM(at, s.at), def.id).toBeLessThan(60);
    }
  });

  it('draws dug ground at a dig, and puts every mark and seeded cache on its island', () => {
    const hermit = must(placed.find((i) => i.id === 'island.hermit'));
    expect(hermit.pieces.some((p) => p.kind === 'dig' && p.poi === 'legend.quarry_payroll')).toBe(
      true,
    );
    for (const c of CLUES) {
      if (c.source.kind === 'mark' || c.source.kind === 'caveMark') {
        expect(
          legends.marks.some((m) => m.clue === c.id),
          c.id,
        ).toBe(true);
      }
    }
    for (const c of SEEDED_CACHES) {
      const island = must(placed.find((i) => i.id === c.island));
      const cache = must(island.caches.find((k) => k.def.id === c.id));
      expect(cache.seeded).toBe(true);
      expect(cache.spots.length).toBe(c.spots.length);
    }
  });

  it("digs a copycat's hoard on land above each camp on these islands", () => {
    const camps = RIVALS.camps.filter((c) => placed.some((i) => i.id === c.island));
    expect(camps.length).toBeGreaterThan(3);
    for (const c of camps) {
      const spot = legends.spots.find((s) => s.lead === c.id);
      expect(spot, c.id).toBeDefined();
      expect(must(spot).y, c.id).toBeGreaterThan(0.9);
      expect(must(spot).legend).toBe(HOARD_LEGEND);
    }
    expect(landNear(0, 0, () => -5, 1, 20)).toBeUndefined();
  });
});

// --- In the game.

describe('legends in the game', () => {
  function setup(opts: { spots?: PlacedLegends; dark?: boolean; ice?: boolean } = {}) {
    const state = createWorldState('legends', 0);
    state.environment.clock.gameSeconds = 10 * 3600;
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
    const discovery = attachDiscovery({
      ctx,
      law: law.defs,
      notice: () => {},
      lookout: () => undefined,
    });
    const notices: string[] = [];
    const seen: { type: string; payload: unknown }[] = [];
    events.tap((type, payload) => seen.push({ type, payload }));
    let hoardTaken = false;
    let passed = 0;
    const legends: GameLegends = attachLegends({
      ctx,
      discovery,
      runSeed: () => 42,
      notice: (t) => notices.push(t),
      placed: () => opts.spots,
      wreckAt: () => ({ lat: 46.7172, lon: -90.77 }),
      cacheGeo: () => ({ lat: 46.99, lon: -90.69 }),
      iceTop: () => (opts.ice ? 0.04 : undefined),
      sky: () => (opts.dark ? { moon: 0.05, sunEl: -0.4 } : { moon: 0.9, sunEl: -0.4 }),
      hoard: (camp) =>
        camp === 'camp.otter' && !hoardTaken
          ? {
              lead: 'stash.rival_1',
              rival: 'Black-Sail Nolan',
              cents: 45_000,
              goods: [],
              take: () => (hoardTaken = true),
            }
          : undefined,
      passTime: (s) => {
        passed += s;
        state.environment.clock.gameSeconds += s;
      },
    });
    return { state, discovery, legends, notices, seen, papers, passed: () => passed };
  }

  const spotSet = (
    legend: string,
    kind: 'dig' | 'search' | 'cave',
    lead = legend,
  ): PlacedLegends => ({
    spots: [
      { lead, legend, name: 'the spot', kind, x: 10, y: 2, z: 10, cave: 'cave.devils_grotto' },
    ],
    marks: [{ clue: 'clue.payroll_carving', name: 'the carving', x: 30, y: 5, z: 30 }],
    pads: [],
  });

  it('opens a lead from a clue alone, shrinks it with the next, and maps it at three', () => {
    const { legends, discovery, state, passed } = setup();
    expect(legends.giveClue('clue.payroll_ledger')).toBeUndefined();
    const lead = must(discovery.leads.find((l) => l.id === 'legend.quarry_payroll'));
    const r0 = lead.radiusM;
    expect(lead.clues.length).toBe(1);
    expect(legends.giveClue('clue.payroll_ledger')).toBe('Found already');
    expect(legends.maps()[0]?.refusal).toMatch(/1 of 3/);
    legends.giveClue('clue.payroll_carving');
    expect(lead.radiusM).toBeLessThan(r0);
    // The tale heard is the third clue.
    discovery.lead({ ...lead, clue: { text: 'The tale.', from: 'saloon talk in Bayfield' } });
    expect(lead.clues.length).toBe(3);
    expect(legends.maps().find((m) => m.lead === lead.id)?.refusal).toBeUndefined();
    expect(legends.drawMap(lead.id)).toBeUndefined();
    expect(lead.radiusM).toBe(LEGEND_RULES.mapRadiusM);
    expect(geoDistanceM(lead.center, { lat: 46.88707, lon: -90.68264 })).toBeLessThan(1);
    expect(passed()).toBe(LEGEND_RULES.mapHours * 3600);
    expect(discovery.leadMarks().find((m) => m.id === lead.id)?.mapped).toBe(true);
    expect(state.legends?.maps[lead.id]).toBeDefined();
    expect(legends.drawMap(lead.id)).toMatch(/already/);
    const steps = legends.steps(lead.id);
    expect(steps.filter((s) => s.done).length).toBe(3);
  });

  it('reads a mark with F, and digs at the spot with F held, paying out', () => {
    const spots = spotSet('legend.quarry_payroll', 'dig');
    const { legends, state, notices, seen, papers, discovery } = setup({ spots });
    const read = must(legends.prompt({ x: 30, y: 5, z: 30 }));
    expect(read.holdS).toBeUndefined();
    read.act();
    expect(state.legends?.clues).toContain('clue.payroll_carving');
    expect(legends.prompt({ x: 30, y: 5, z: 30 })).toBeUndefined();

    const dig = must(legends.prompt({ x: 11, y: 2, z: 10 }));
    expect(dig.holdS).toBe(LEGEND_RULES.digHoldS);
    expect(dig.text).toMatch(/^Dig /);
    const purse = state.player.purse;
    dig.act();
    const got = state.player.purse - purse;
    expect(got).toBeGreaterThanOrEqual(120_000);
    expect(got).toBeLessThanOrEqual(180_000);
    expect(notices.at(-1)).toMatch(/payroll/);
    expect(state.curios?.some((c) => c.id === 'curio.quarry_pick')).toBe(true);
    expect(seen.some((e) => e.type === 'LegendCompleted')).toBe(true);
    expect(
      papers.state.stories.some((s) => s.kind === 'legend' && s.legend === 'legend.quarry_payroll'),
    ).toBe(true);
    expect(discovery.leads.find((l) => l.id === 'legend.quarry_payroll')?.closed?.outcome).toBe(
      'found',
    );
    expect(legends.prompt({ x: 11, y: 2, z: 10 })).toBeUndefined();
  });

  it("finds the Grotto's ledge only at the dark of the moon, or on the ice", () => {
    const spots = spotSet('legend.devils_grotto', 'cave');
    const bright = setup({ spots });
    must(bright.legends.prompt({ x: 10, y: 2, z: 10 })).act();
    expect(bright.state.legends?.done['legend.devils_grotto']).toBeUndefined();
    expect(bright.notices.at(-1)).toMatch(/moon/);
    const dark = setup({ spots, dark: true });
    must(dark.legends.prompt({ x: 10, y: 2, z: 10 })).act();
    expect(dark.state.legends?.done['legend.devils_grotto']).toBeDefined();
    const ice = setup({ spots, ice: true });
    must(ice.legends.prompt({ x: 10, y: 2, z: 10 })).act();
    expect(ice.state.legends?.done['legend.devils_grotto']).toBeDefined();
  });

  it("brings up the Lucerne's strongbox once the lead has three clues", () => {
    const { legends, state, discovery } = setup();
    expect(legends.wreckHooked('wreck.lucerne')).toBeUndefined();
    legends.giveClue('clue.lucerne_logbook');
    legends.giveClue('clue.lucerne_letter');
    expect(legends.wreckHooked('wreck.lucerne')).toBeUndefined();
    const lead = must(discovery.leads.find((l) => l.id === 'legend.lucerne'));
    discovery.lead({ ...lead, clue: { text: 'Her log.', from: 'the wreck' } });
    const purse = state.player.purse;
    expect(legends.wreckHooked('wreck.lucerne')).toMatch(/strongbox/);
    expect(state.player.purse).toBeGreaterThan(purse + 80_000);
    expect(state.curios?.some((c) => c.id === 'curio.captains_watch')).toBe(true);
    expect(legends.wreckHooked('wreck.lucerne')).toBeUndefined();
  });

  it("introduces you to Mr. Carrow with the Dark Light's chest", () => {
    const spots = spotSet('legend.dark_light', 'dig');
    const { legends } = setup({ spots });
    expect(legends.contact('fence.duluth')).toBe(false);
    must(legends.prompt({ x: 10, y: 2, z: 10 })).act();
    expect(legends.contact('fence.duluth')).toBe(true);
  });

  it("digs a beaten copycat's hoard above his camp, and nothing at an empty one", () => {
    const spots: PlacedLegends = {
      spots: [
        {
          lead: 'camp.otter',
          legend: HOARD_LEGEND,
          name: 'the hoard',
          kind: 'dig',
          x: 0,
          y: 1,
          z: 0,
        },
        {
          lead: 'camp.cat',
          legend: HOARD_LEGEND,
          name: 'the hoard',
          kind: 'dig',
          x: 50,
          y: 1,
          z: 0,
        },
      ],
      marks: [],
      pads: [],
    };
    const { legends, state, notices } = setup({ spots });
    const purse = state.player.purse;
    must(legends.prompt({ x: 50, y: 1, z: 0 })).act();
    expect(notices.at(-1)).toMatch(/Nothing/);
    must(legends.prompt({ x: 0, y: 1, z: 0 })).act();
    expect(state.player.purse - purse).toBe(45_000);
    expect(state.legends?.done['stash.rival_1']).toBeDefined();
    expect(state.legends?.done[HOARD_LEGEND]).toBeDefined();
    expect(state.curios?.some((c) => c.id === 'curio.nameboard')).toBe(true);
  });

  it('gives a logbook clue once, and a district clue or a cache note from papers', () => {
    const { legends, discovery } = setup();
    expect(legends.logbook('light.outer')).toMatch(/clue/);
    expect(legends.logbook('light.outer')).toBeUndefined();
    let clue = 0;
    let note = 0;
    for (let k = 0; k < 40; k++) {
      const text = legends.papers('district.bayfield', `desk:${k}`);
      if (text?.startsWith('a paper that bears')) clue++;
      if (text?.startsWith('a note about a cache')) note++;
    }
    expect(clue).toBe(2);
    expect(note).toBeGreaterThan(0);
    expect(discovery.leads.some((l) => l.kind === 'cache')).toBe(true);
  });
});
