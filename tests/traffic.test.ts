import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { beforeAll, describe, expect, it } from 'vitest';
import { chartToZone } from '../src/core/coords';
import { EventBus } from '../src/core/events';
import { InputMapper } from '../src/core/input';
import { Rng } from '../src/core/rng';
import { SECONDS_PER_GAME_DAY, WORLD_TICK_GAME_SECONDS } from '../src/core/time';
import { createGameWorld } from '../src/gameplay/ecs';
import { attachTraffic, type TrafficZone } from '../src/gameplay/traffic';
import type { GameContext, GameEvents } from '../src/modes/context';
import { westernSuperiorChart } from '../src/sim/chart/chart-data';
import { toWorldChart } from '../src/sim/chart/geography';
import { lanePlace, westernSuperiorRoutes } from '../src/sim/chart/routes';
import { createContacts, stepContacts, type Contact } from '../src/sim/chart/traffic';
import { cargoCapacity, gameEconomy } from '../src/sim/economy/defs';
import { EconomySim, marketViolations, passageTable, runTrader } from '../src/sim/economy/harness';
import { createMarkets, unitPrices, type MarketsState } from '../src/sim/economy/market';
import { HARBORS, layoutHarbors } from '../src/sim/harbors';
import { SHIP_RECORDS } from '../src/sim/sailing/ships';
import { loadZoneTerrain, type LoadedZone } from '../src/sim/terrain/load';
import { manifestFrame } from '../src/sim/terrain/zones';
import { assignBerths, harborForPort, sideOfBerth } from '../src/sim/traffic/berths';
import {
  applyCall,
  callsBetween,
  currentManifest,
  gameTraffic,
  holdCu,
  manifestFor,
  runTraffic,
} from '../src/sim/traffic/cargo';
import { hail } from '../src/sim/traffic/news';
import { createWorldState, parseWorldState } from '../src/sim/world-state';
import { createSea } from '../src/sim/weather/waves';
import { createLocalWeather } from '../src/sim/weather/local-weather';
import { shipCard } from '../src/ui/hud/ship-card';

/** Phase 4 piece D: cargo on the lake's traffic (plan 05 §8, §16.3 criteria 4, 5, 11). */

const geo = westernSuperiorChart();
const graph = westernSuperiorRoutes();
const defs = gameTraffic();
const economy = gameEconomy();
const DAY = SECONDS_PER_GAME_DAY;

function must<T>(v: T | undefined | null): T {
  if (v === undefined || v === null) throw new Error('missing value');
  return v;
}

const fleet = (seed = 'run-1'): Contact[] =>
  createContacts(geo.projection, `${seed}-traffic`, 0).filter((c) => c.schedule);

describe('the flows and the companies', () => {
  it('gives every trade lane a flow out of its port end, and every lane its owners', () => {
    for (const lane of graph.lanes) {
      expect(defs.owners.get(lane.id), lane.id).toBeDefined();
      if (lane.use !== 'trade') continue;
      const ports = [lane.from, lane.to].filter((n) => graph.nodes.get(n)?.port);
      expect(
        ports.some((n) => defs.byLeg.has(`${lane.id}|${n}`)),
        `${lane.id} carries nothing from its port`,
      ).toBe(true);
    }
  });

  it('only sends goods a port trades into or out of it', () => {
    for (const f of defs.flows) {
      for (const node of [f.from, f.to]) {
        const port = defs.portOf.get(node);
        if (!port || f.impact === 0) continue;
        const pm = must(economy.markets.get(port));
        for (const line of f.cargo) {
          expect(pm.goods.has(line.good), `${f.id}: ${port} doesn't trade ${line.good}`).toBe(true);
        }
      }
    }
  });

  it('keeps the company names fictional and unique (plan 05 §10)', () => {
    const names = [...defs.factions.values()].map((f) => f.name);
    expect(new Set(names).size).toBe(names.length);
    // Zenith Transit Co. was a real Duluth fleet in 1895–1901: never use it.
    expect(names.some((n) => /zenith/i.test(n))).toBe(false);
  });
});

describe('manifests', () => {
  const ships = fleet();

  it('are the same for the same run, passage and ship, and differ by passage', () => {
    const a = fleet('run-7');
    const b = fleet('run-7');
    for (let i = 0; i < a.length; i++) {
      const ma = manifestFor(defs, economy, must(a[i]), 5, true);
      const mb = manifestFor(defs, economy, must(b[i]), 5, true);
      expect(ma).toEqual(mb);
    }
    const ore = must(ships.find((c) => c.schedule?.laneId === 'lane.duluth_ore'));
    const qty = [1, 2, 3, 4].map((k) => manifestFor(defs, economy, ore, k, true)?.cargo[0]?.qty);
    expect(new Set(qty).size).toBeGreaterThan(1);
  });

  it('fit the hold, carry the flow’s goods, and name an owner from the fleet', () => {
    for (const c of ships) {
      for (let k = 0; k < 6; k++) {
        for (const outbound of [true, false]) {
          const m = must(manifestFor(defs, economy, c, k, outbound));
          const total = m.cargo.reduce((n, l) => n + l.qty, 0);
          expect(total, c.id).toBeLessThanOrEqual(holdCu(c));
          const flow = defs.byLeg.get(`${must(c.schedule).laneId}|${m.from}`);
          if (!flow) {
            expect(m.cargo, `${c.id} sails in ballast`).toEqual([]);
            continue;
          }
          expect(m.cargo.length).toBeLessThanOrEqual(flow.mixed ? 3 : 1);
          for (const l of m.cargo) expect(flow.cargo.map((x) => x.good)).toContain(l.good);
          expect(must(defs.owners.get(must(c.schedule).laneId))).toContain(m.owner);
        }
      }
    }
  });

  it('carries plausible cargo by class (criterion 5)', () => {
    const at = 17 * DAY; // early September (a game day is a week)
    stepContacts(ships, at);
    const goodsBy = (classId: string): Set<string> =>
      new Set(
        ships
          .filter((c) => c.classId === classId)
          .flatMap((c) => currentManifest(defs, economy, c, at)?.cargo.map((l) => l.good) ?? []),
      );
    expect(
      [...goodsBy('ship.ore_freighter')].every((g) =>
        ['good.iron_ore', 'good.grain', 'good.coal', 'good.brownstone'].includes(g),
      ),
    ).toBe(true);
    expect(
      [...goodsBy('ship.schooner_barge')].every((g) =>
        ['good.lumber', 'good.provisions', 'good.dry_goods', 'good.hardware'].includes(g),
      ),
    ).toBe(true);
    const ore = must(ships.find((c) => c.classId === 'ship.ore_freighter'));
    // An ore boat's papers: a few thousand CU worth thousands of dollars, and a crew.
    const m = must(manifestFor(defs, economy, ore, 3, true));
    expect(must(m.cargo[0]).qty).toBeGreaterThan(3000);
    expect(m.valueCents).toBeGreaterThan(500_000);
    expect(m.crew).toBeGreaterThan(10);
  });

  it('are loading at the port a ship lies in, laid up or between passages', () => {
    const ships = fleet('run-16');
    let checked = 0;
    for (let t = 0; t < 20 * DAY; t += 3600) {
      stepContacts(ships, t);
      for (const c of ships) {
        const s = must(c.schedule);
        const lane = must(c.lane);
        if (!c.inPort) continue;
        const node = lane.leg === 0 && lane.progressM === 0 ? s.homeNode : s.awayNode;
        expect(must(currentManifest(defs, economy, c, t)).from, `${c.id} at ${t}`).toBe(node);
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(1000);
  });

  it('give the cutter no cargo and an armed crew', () => {
    const cutter = must(ships.find((c) => c.classId === 'ship.cutter_morrill'));
    const m = must(manifestFor(defs, economy, cutter, 2, true));
    expect(m.cargo).toEqual([]);
    expect(m.armed).toBe(true);
    expect(m.owner).toBe('company.revenue_service');
  });
});

describe('calls and deliveries (criterion 5)', () => {
  it('match the timetable: arrivals and departures where lanePlace changes', () => {
    const ships = fleet('run-3');
    for (const c of ships.slice(0, 12)) {
      const s = must(c.schedule);
      for (const call of callsBetween(s, c.id, 0, 30 * DAY)) {
        const before = lanePlace(s, call.at - 60);
        const after = lanePlace(s, call.at + 60);
        if (call.kind === 'depart') {
          expect(before.underWay, `${c.id} ${call.at}`).toBe(false);
          expect(after.underWay).toBe(true);
        } else {
          expect(before.underWay).toBe(true);
          expect(after.underWay).toBe(false);
        }
      }
    }
  });

  it('splits a span into ticks without losing or doubling a call', () => {
    const s = must(fleet('run-4')[0]?.schedule);
    const whole = callsBetween(s, 'x', 0, 20 * DAY, 100);
    const parts = [];
    for (let t = 0; t < 20 * DAY; t += WORLD_TICK_GAME_SECONDS) {
      parts.push(...callsBetween(s, 'x', t, t + WORLD_TICK_GAME_SECONDS));
    }
    expect(parts).toEqual(whole);
  });

  it('a collier arriving at Duluth adds coal, and an ore boat leaving takes ore', () => {
    const ships = fleet('run-5');
    const markets: MarketsState = createMarkets(economy, 0);
    const ore = must(ships.find((c) => c.schedule?.laneId === 'lane.duluth_ore'));
    const s = must(ore.schedule);
    // Find a cycle she sails, from Duluth (her home or her far end).
    const calls = callsBetween(s, ore.id, 0, 60 * DAY, 100);
    const arrive = must(calls.find((c) => c.kind === 'arrive' && c.node === 'node.duluth'));
    const depart = must(calls.find((c) => c.kind === 'depart' && c.node === 'node.duluth'));
    const m = must(manifestFor(defs, economy, ore, arrive.cycle, arrive.outbound));
    const coalBefore = must(markets['port.duluth']?.['good.coal']).stock;
    const priceBefore = must(unitPrices(economy, markets, 'port.duluth', 'good.coal', arrive.at));
    const done = must(applyCall(defs, economy, markets, ore, arrive));
    expect(done.cargo.map((l) => l.good)).toEqual(m.cargo.map((l) => l.good));
    expect(must(markets['port.duluth']?.['good.coal']).stock).toBeGreaterThan(coalBefore);
    const priceAfter = must(unitPrices(economy, markets, 'port.duluth', 'good.coal', arrive.at));
    expect(priceAfter.sellCents).toBeLessThan(priceBefore.sellCents);

    const loaded = must(manifestFor(defs, economy, ore, depart.cycle, depart.outbound));
    const good = must(loaded.cargo[0]).good;
    const stockBefore = must(markets['port.duluth']?.[good]).stock;
    applyCall(defs, economy, markets, ore, depart);
    expect(must(markets['port.duluth']?.[good]).stock).toBeLessThan(stockBefore);
  });

  it('moves every port’s stock over a busy month, and leaves the lower lakes alone', () => {
    const ships = fleet('run-6');
    const markets = createMarkets(economy, 0);
    const done = runTraffic(defs, economy, markets, ships, 16 * DAY, 21 * DAY);
    const ports = new Set(done.map((d) => d.port));
    for (const p of [
      'port.duluth',
      'port.superior',
      'port.ashland',
      'port.washburn',
      'port.bayfield',
    ]) {
      expect(ports.has(p), p).toBe(true);
    }
    expect(done.every((d) => d.port.startsWith('port.'))).toBe(true);
  });
});

describe('the economy with the traffic (criteria 4 and 11)', () => {
  it('keeps every price inside its clamp through two seasons of traffic', () => {
    const sim = new EconomySim(economy, 0, { defs, contacts: fleet('run-8') });
    for (let d = 0; d < 26; d++) {
      sim.advance(DAY);
      expect(marketViolations(sim), `day ${d}`).toEqual([]);
    }
    expect(sim.calls).toBeGreaterThan(100);
  });

  it('still lets an honest trader turn a profit, and prints no money', () => {
    const sim = new EconomySim(economy, 6 * 3600, { defs, contacts: fleet('run-9') });
    const run = runTrader(sim, passageTable(), {
      start: 'port.bayfield',
      purse: 15_000,
      cargo: [{ good: 'good.rope_canvas', qty: 5 }],
      capacity: cargoCapacity(),
      realMinutes: 60,
    });
    expect(run.endNetWorth).toBeGreaterThan(run.startNetWorth);
    // Plan 05 §5.3's pace: a T1 makes tens of dollars an hour, not hundreds.
    expect(run.endNetWorth - run.startNetWorth).toBeLessThan(40_000);
  });

  it('runs a world tick of 100+ voyages in well under a millisecond', () => {
    // Five runs' fleets at once: over a hundred abstract voyages.
    const ships = ['a', 'b', 'c', 'd', 'e'].flatMap((s) => fleet(s));
    expect(ships.length).toBeGreaterThan(100);
    const markets = createMarkets(economy, 0);
    let t = 16 * DAY;
    // Warm up, then time a game week of ticks.
    for (let i = 0; i < 200; i++, t += WORLD_TICK_GAME_SECONDS) {
      runTraffic(defs, economy, markets, ships, t, t + WORLD_TICK_GAME_SECONDS);
    }
    const n = 144;
    const start = performance.now();
    for (let i = 0; i < n; i++, t += WORLD_TICK_GAME_SECONDS) {
      runTraffic(defs, economy, markets, ships, t, t + WORLD_TICK_GAME_SECONDS);
    }
    const msPerTick = (performance.now() - start) / n;
    expect(msPerTick).toBeLessThan(1);
  });
});

describe('hailing (plan 05 §9)', () => {
  const ships = fleet('run-10');
  const markets = createMarkets(economy, 0);
  const at = 15 * DAY + 12 * 3600; // August, at noon
  stepContacts(ships, at);

  it('brings her last port’s prices and a tip about a real ship, in daylight', () => {
    const ore = must(
      ships.find((c) => {
        const m = currentManifest(defs, economy, c, at);
        return c.classId === 'ship.ore_freighter' && m?.fromPort;
      }),
    );
    const news = must(hail(defs, economy, markets, ships, ore, at, 12));
    const m = must(currentManifest(defs, economy, ore, at));
    expect(news.prices?.port).toBe(m.fromPort);
    expect(news.prices?.prices.length).toBeGreaterThan(0);
    expect(news.prices?.seenAt).toBeLessThanOrEqual(at);
    const tip = must(news.tip);
    expect(ships.map((c) => c.id)).toContain(tip.shipId);
    expect(tip.at).toBeGreaterThan(at);
    expect(news.rumor).toContain(must(ships.find((c) => c.id === tip.shipId)).name);
  });

  it('goes unanswered after dark', () => {
    const c = must(ships[0]);
    expect(hail(defs, economy, markets, ships, c, at, 23)).toBeUndefined();
  });
});

describe('the ship card', () => {
  it('reads her owner, passage, hold and news', () => {
    const ships = fleet('run-11');
    const c = must(ships.find((x) => x.schedule?.laneId === 'lane.lumber'));
    const m = must(manifestFor(defs, economy, c, 3, true));
    const card = shipCard({
      shipId: c.id,
      name: c.name,
      className: 'Schooner-barge',
      manifest: m,
      owner: defs.factions.get(must(m.owner)),
      nodes: graph.nodes,
      goodNames: (id) => must(economy.goods.get(id)).name.toLowerCase(),
    });
    expect(card.title).toBe(c.name);
    expect(card.subtitle).toMatch(/Schooner-barge · (Whitlock|Siskiwit)/);
    expect(card.route).toMatch(/Washburn → Duluth|Duluth → Washburn/);
    expect(card.cargo[0]).toMatch(/CU (lumber|salt pork & provisions|dry goods|hardware)$/);
    expect(card.value).toMatch(/^Cargo worth about \$/);
  });
});

describe('the save', () => {
  it('starts a new run with an empty traffic slice, and fills one an early v5 save lacks', () => {
    const fresh = createWorldState('t');
    expect(fresh.traffic).toEqual({ deliveredTo: 0, ships: {} });
    const old = JSON.parse(JSON.stringify(fresh)) as Record<string, unknown>;
    delete old['traffic'];
    const parsed = parseWorldState(old);
    expect(parsed.traffic).toEqual({ deliveredTo: 0, ships: {} });
    const hailed = {
      ...fresh,
      traffic: { deliveredTo: 900, ships: { 'ship.x': { hailedAt: 5 } } },
    };
    expect(parseWorldState(JSON.parse(JSON.stringify(hailed))).traffic).toEqual(hailed.traffic);
  });
});

function testContext(): GameContext {
  const state = createWorldState('ctx');
  return {
    state,
    world: createGameWorld(),
    rng: Rng.fromSeed('ctx'),
    input: new InputMapper(),
    events: new EventBus<GameEvents>(),
    sea: createSea(),
    weather: createLocalWeather(),
  };
}

describe('the traffic in the game', () => {
  it('moves the markets on the world tick, once per span, and raises CargoDelivered', () => {
    const ctx = testContext();
    const traffic = attachTraffic(ctx, fleet('run-12'));
    const seen: string[] = [];
    ctx.events.on('CargoDelivered', (d) => seen.push(`${d.shipId}@${d.at}`));
    for (let t = WORLD_TICK_GAME_SECONDS; t <= 10 * DAY; t += WORLD_TICK_GAME_SECONDS) {
      ctx.events.emit('WorldTick', { gameSeconds: t });
      // A batch of ticks repeats the same time: nothing runs twice.
      ctx.events.emit('WorldTick', { gameSeconds: t });
    }
    expect(seen.length).toBeGreaterThan(5);
    expect(new Set(seen).size).toBe(seen.length);
    expect(ctx.state.traffic?.deliveredTo).toBe(10 * DAY);
    traffic.dispose();
  });

  it('tells a ship’s news once a passage', () => {
    const ctx = testContext();
    ctx.state.environment.clock.gameSeconds = 8 * DAY + 11 * 3600;
    const ships = fleet('run-13');
    const traffic = attachTraffic(ctx, ships);
    traffic.step(undefined);
    const c = must(ships.find((x) => x.classId === 'ship.package_steamer'));
    const first = traffic.hail(c.id);
    expect(first.news?.rumor).toBeDefined();
    expect(first.news?.rumor).not.toBe('"Nothing new since we spoke."');
    expect(traffic.hail(c.id).news?.rumor).toBe('"Nothing new since we spoke."');
    expect(ctx.state.traffic?.ships[c.id]?.hailedAt).toBe(ctx.state.environment.clock.gameSeconds);
  });
});

const zoneDir = (id: string): string | undefined => {
  const dir = join('public/world', id);
  return existsSync(join(dir, 'height', '0-0.bin')) &&
    readFileSync(join(dir, 'height', '0-0.bin')).length > 200
    ? dir
    : undefined;
};

describe.each(['apostles', 'twin_ports', 'two_harbors'])('ships in the %s zone', (id) => {
  const dir = zoneDir(id);
  let zone: LoadedZone;
  let tz: TrafficZone;
  beforeAll(async () => {
    if (!dir) return;
    zone = await loadZoneTerrain(async (p) => new Uint8Array(readFileSync(join(dir, p))));
    const frame = manifestFrame(zone.manifest);
    tz = {
      frame,
      toWorld: (p) => toWorldChart(geo, p),
      terrain: zone.terrain,
      harbors: layoutHarbors(frame, zone.terrain, zone.manifest.zone),
    };
  });

  it.skipIf(!dir)('sail lanes deep enough for them nearly everywhere the zone covers', () => {
    const ships = fleet('run-14');
    let inZone = 0;
    let deep = 0;
    for (let t = 10 * DAY; t < 25 * DAY; t += 900) {
      stepContacts(ships, t);
      for (const c of ships) {
        if (c.inPort) continue;
        const p = chartToZone(toWorldChart(geo, c.pos), tz.frame);
        if (!zone.terrain.contains(p.x, p.z)) continue;
        inZone++;
        const r = must(SHIP_RECORDS.find((x) => x.id === c.classId));
        if (zone.terrain.depthAt(p.x, p.z) >= r.draftFullM + 0.5) deep++;
      }
    }
    expect(inZone).toBeGreaterThan(50);
    expect(deep / inZone).toBeGreaterThan(0.9);
  });

  it.skipIf(!dir)('find a berth for each class that calls at a port here', () => {
    for (const lane of graph.lanes) {
      for (const node of [lane.from, lane.to]) {
        const port = graph.nodes.get(node)?.port;
        const harbor = port ? harborForPort(tz.harbors, port) : undefined;
        if (!harbor) continue;
        for (const entry of lane.fleet) {
          const record = must(SHIP_RECORDS.find((r) => r.id === entry.classId));
          const b = assignBerths(harbor, [{ id: 'x', record }], zone.terrain);
          expect(b.get('x'), `${record.id} at ${harbor.def.id}`).toBeDefined();
        }
      }
    }
  });

  it.skipIf(!dir)(
    'materialize and collapse as the clock runs, keeping the city dock’s north side free',
    () => {
      const ctx = testContext();
      const ships = fleet('run-15');
      const traffic = attachTraffic(ctx, ships);
      traffic.setZone(tz);
      let most = 0;
      let berthed = 0;
      for (let t = 12 * DAY; t < 15 * DAY; t += 1800) {
        ctx.state.environment.clock.gameSeconds = t;
        traffic.step(undefined);
        most = Math.max(most, traffic.shown.size);
        for (const s of traffic.shown.values()) if (s.berthed) berthed++;
        for (const key of traffic.takenSides) {
          const city = tz.harbors.flatMap((h) => h.piers).find((p) => p.kind === 'city');
          expect(key).not.toBe(`${city?.id}|-1`);
        }
        expect(ctx.world.entities.length).toBe(traffic.shown.size);
      }
      expect(most).toBeGreaterThan(0);
      expect(berthed).toBeGreaterThan(0);
      traffic.setZone(undefined);
      expect(ctx.world.entities.length).toBe(0);
    },
  );
});

describe('berths', () => {
  it('reads a pier side from a player berth id', () => {
    expect(sideOfBerth('pier.bayfield_city.north')).toEqual({
      pierId: 'pier.bayfield_city',
      side: -1,
    });
    expect(sideOfBerth('pier.bayfield_city.south3')).toEqual({
      pierId: 'pier.bayfield_city',
      side: 1,
    });
    expect(HARBORS.length).toBeGreaterThan(0);
  });
});
