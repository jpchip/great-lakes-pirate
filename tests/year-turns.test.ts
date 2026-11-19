import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { EventBus } from '../src/core/events';
import { migrateSave } from '../src/core/save/migrate';
import type { SavePayload } from '../src/core/save/migrations';
import { westernSuperiorChart } from '../src/sim/chart/chart-data';
import { createContacts } from '../src/sim/chart/traffic';
import { cycleStartS, iceKeepsIn, sailsInCycle } from '../src/sim/chart/routes';
import { planCourse } from '../src/sim/chart/voyage';
import { gameEconomy } from '../src/sim/economy/defs';
import { createMarkets, tickMarkets } from '../src/sim/economy/market';
import { firstArrivalAfter } from '../src/sim/ice/first-boat';
import {
  closesHull,
  hullInIce,
  ICE,
  LakeIce,
  lakeIceFor,
  stopCmFor,
  type IceSample,
} from '../src/sim/ice/ice';
import { calendarMs, gameSecondsAt, winterOf } from '../src/sim/ice/season';
import { iceStateSchema } from '../src/sim/ice/state';
import { gameLaw } from '../src/sim/law/defs';
import { createGameWorld } from '../src/gameplay/ecs';
import { iceSailingSystem } from '../src/gameplay/ice-sailing';
import { attachIce } from '../src/gameplay/ice';
import { createSailingState } from '../src/sim/sailing/controller';
import { compileHazardClass, createHazardState } from '../src/sim/sailing/hazards';
import { defaultHazardRules } from '../src/sim/sailing/hazard-rules';
import { sailShipRecord, T1_SCHOONER_ID } from '../src/sim/sailing/ships';
import {
  advanceWeather,
  createWeatherState,
  mataafa,
  pressureAt,
  windAt,
} from '../src/sim/weather/weather';
import { WORLD_PROJECTION_REF } from '../src/sim/weather/world-ref';
import { createWorldState, parseWorldState, worldStateSchema } from '../src/sim/world-state';
import type { GameContext, GameEvents } from '../src/modes/context';

const geo = westernSuperiorChart();
const at = (y: number, m: number, d: number): number => gameSecondsAt(Date.UTC(y, m, d));
const port = (id: string) => {
  const p = geo.ports.find((x) => x.id === id);
  if (!p) throw new Error(id);
  return p.pos;
};
const lonLat = (lon: number, lat: number) => geo.projection.geoToChart({ lat, lon });
/** Open lake well off the North Shore, 50 fathoms and more. */
const OPEN_LAKE = lonLat(-91.2, 47.25);
const iso = (t: number | undefined): string =>
  t === undefined ? '—' : new Date(calendarMs(t)).toISOString().slice(0, 10);

describe('the year turns (plan 04 §8, plan 11 §18.4 piece K)', () => {
  const ice = new LakeIce('run-k', geo);

  it('leaves the summer open and the same run always the same', () => {
    expect(ice.at(port('port.ashland'), at(1900, 6, 15)).kind).toBe('open');
    const again = new LakeIce('run-k', geo);
    const t = at(1901, 1, 1);
    expect(again.at(OPEN_LAKE, t)).toEqual(ice.at(OPEN_LAKE, t));
    expect(again.harborSeason('port.duluth', t)).toEqual(ice.harborSeason('port.duluth', t));
  });

  it('freezes the sheltered bays first and the open lake late or not at all', () => {
    const mid = at(1901, 0, 15);
    const bay = ice.harborSeason('port.ashland', mid);
    const twoHarbors = ice.harborSeason('port.two_harbors', mid);
    expect(bay.closeAt).toBeDefined();
    expect(twoHarbors.closeAt ?? Infinity).toBeGreaterThan(bay.closeAt as number);
    // Midwinter: Chequamegon Bay fast and thick, the open lake beyond the islands open.
    const feb = at(1901, 1, 10);
    const ashland = ice.at(port('port.ashland'), feb);
    expect(ashland.kind).toBe('fast');
    expect(ashland.thicknessCm).toBeGreaterThan(25);
    expect(ice.at(OPEN_LAKE, feb).coverage).toBeLessThan(0.5);
  });

  it('rolls freeze-up in December and January and ice-out in April or early May, varying by winter', () => {
    const closes: number[] = [];
    const opens: number[] = [];
    const severities: number[] = [];
    for (let i = 0; i < 24; i++) {
      const lake = new LakeIce(`run-${i}`, geo);
      const s = lake.harborSeason('port.duluth', at(1901, 0, 15));
      severities.push(lake.winter(at(1901, 0, 15)).severity);
      expect(s.closeAt, `run-${i}`).toBeDefined();
      expect(s.openAt, `run-${i}`).toBeDefined();
      closes.push(new Date(calendarMs(s.closeAt as number)).getUTCMonth());
      opens.push(new Date(calendarMs(s.openAt as number)).getUTCMonth());
    }
    for (const m of closes) expect([10, 11, 0]).toContain(m);
    for (const m of opens) expect([2, 3, 4]).toContain(m);
    expect(Math.min(...severities)).toBeLessThan(-0.5);
    expect(Math.max(...severities)).toBeGreaterThan(0.5);
  });

  it('closes earlier and opens later in a hard winter than a mild one', () => {
    const runs = Array.from({ length: 24 }, (_, i) => new LakeIce(`run-${i}`, geo));
    const t = at(1901, 0, 15);
    const sorted = runs.sort((a, b) => a.winter(t).severity - b.winter(t).severity);
    const mild = (sorted[0] as LakeIce).harborSeason('port.bayfield', t);
    const hard = (sorted.at(-1) as LakeIce).harborSeason('port.bayfield', t);
    expect(hard.closeAt as number).toBeLessThan(mild.closeAt as number);
    expect(hard.openAt as number).toBeGreaterThan(mild.openAt as number);
  });

  it('breaks the ice into floes at ice-out before the water clears', () => {
    const s = ice.harborSeason('port.bayfield', at(1901, 0, 15));
    const open = s.openAt as number;
    const kinds = new Set<string>();
    for (let d = -20; d <= 0; d++) kinds.add(ice.at(port('port.bayfield'), open + d * 12_343).kind);
    expect(kinds.has('floes')).toBe(true);
    expect(ice.harborClosed('port.bayfield', open)).toBe(false);
  });

  it("works out a winter's ice in a few milliseconds", () => {
    const t0 = performance.now();
    winterOf('timing', 1907);
    expect(performance.now() - t0).toBeLessThan(50);
  });
});

describe('ice and a hull (plan 02 §5.2, plan 10 §5.1)', () => {
  const thick: IceSample = { coverage: 1, thicknessCm: 15, kind: 'fast' };
  const thin: IceSample = { coverage: 1, thicknessCm: 4, kind: 'forming' };
  const floes: IceSample = { coverage: 0.6, thicknessCm: 20, kind: 'floes' };

  it('stops a plain hull at 8 cm and an ice bow at 20; floes never stop her', () => {
    expect(closesHull(thick, stopCmFor(false))).toBe(true);
    expect(closesHull(thick, stopCmFor(true))).toBe(false);
    expect(closesHull(thin, stopCmFor(false))).toBe(false);
    expect(closesHull(floes, stopCmFor(false))).toBe(false);
  });

  it('drags and holes her, and the ice bow takes 70% off the damage', () => {
    // Ice past what either hull can break: hardness the same, the bow's own numbers tell.
    const hard: IceSample = { coverage: 1, thicknessCm: 30, kind: 'fast' };
    const plain = hullInIce(hard, false);
    const bow = hullInIce(hard, true);
    expect(plain.drag).toBeLessThan(1);
    expect(bow.drag).toBeGreaterThan(plain.drag);
    expect(bow.damagePerKn).toBeCloseTo(plain.damagePerKn * 0.3);
    // In thin ice the bow, rated for thicker, finds it softer still.
    expect(hullInIce(thin, true).damagePerKn).toBeLessThan(
      hullInIce(thin, false).damagePerKn * 0.3,
    );
    expect(hullInIce(floes, false).damagePerKn).toBeGreaterThan(0);
    expect(hullInIce({ coverage: 0, thicknessCm: 0, kind: 'open' }, false)).toEqual({
      drag: 1,
      damagePerKn: 0,
      fromKn: 0,
    });
  });

  it("stops her at the edge of ice she can't break, and grinds her hull in ice she can", () => {
    const world = createGameWorld();
    const record = sailShipRecord(T1_SCHOONER_ID);
    const cls = compileHazardClass(record, defaultHazardRules());
    const s = createSailingState(0, 0, 0);
    s.speed = 2.5;
    const e = world.add({
      transform: { position: { x: 0, y: 0, z: 0 }, heading: 0 },
      previousTransform: { position: { x: 0, y: 0, z: 0 }, heading: 0 },
      sailing: { cls: {} as never, state: s },
      hazards: { cls, state: createHazardState(cls) },
      playerControlled: true,
    });
    // Ice to the north (negative z) of z = -5; the bow probe reaches it after a step.
    let edge = -5;
    const sample = (_x: number, z: number): IceSample => (z < edge ? thick : thin);
    const events: string[] = [];
    s.z = -1;
    e.transform.position.z = -1;
    iceSailingSystem(
      world,
      { sample, iceBow: () => false, onEvent: (_e, ev) => events.push(ev.kind) },
      0.1,
      0,
    );
    expect(s.z).toBe(0);
    expect(s.speed).toBe(0);
    expect(events).toContain('stopped');
    // In thin ice short of the edge she makes way slowly and loses hull.
    edge = -1000;
    s.speed = 2.5;
    const hull = e.hazards.state.hull;
    iceSailingSystem(world, { sample, iceBow: () => false }, 1, 10);
    expect(s.iceFactor).toBeLessThan(1);
    expect(e.hazards.state.hull).toBeLessThan(hull);
  });
});

describe('winter on the lake (plan 05 §3, plan 06 §5.1)', () => {
  const seed = 'run-k';
  const contacts = createContacts(geo.projection, `${seed}-traffic`, 0);
  const ice = lakeIceFor(seed);

  it('keeps every ship in while an end of her lane is frozen in', () => {
    const duluth = ice.harborSeason('port.duluth', at(1901, 0, 15));
    let checked = 0;
    for (const c of contacts) {
      const sch = c.schedule;
      if (!sch?.ice) continue;
      const touches = sch.ice.ends.some((e) => e.port === 'port.duluth');
      if (!touches) continue;
      for (let k = 0; k < 400; k++) {
        const t0 = cycleStartS(sch, k);
        if (t0 < (duluth.closeAt as number) || t0 > (duluth.openAt as number) - 86_400) continue;
        checked++;
        expect(iceKeepsIn(sch, k), c.id).toBe(true);
        expect(sailsInCycle(sch, k)).toBe(false);
      }
    }
    expect(checked).toBeGreaterThan(0);
  });

  it('brings the first boat into Duluth only after its ice-out', () => {
    const duluth = ice.harborSeason('port.duluth', at(1901, 0, 15));
    const open = duluth.openAt as number;
    const first = firstArrivalAfter(
      contacts,
      'port.duluth',
      duluth.closeAt as number,
      open + 30 * 86_400,
    );
    expect(first).toBeDefined();
    expect((first as { at: number }).at).toBeGreaterThanOrEqual(open);
  });

  it("runs a frozen port's imports short and piles up its exports", () => {
    const defs = gameEconomy();
    const t = at(1901, 0, 15);
    const markets = createMarkets(defs, t);
    const open = createMarkets(defs, t);
    for (let i = 0; i < 1500; i++) {
      tickMarkets(defs, markets, t + i * 600, 600, (p) => p === 'port.duluth');
      tickMarkets(defs, open, t + i * 600, 600);
    }
    const role = (g: string) => defs.markets.get('port.duluth')?.goods.get(g)?.role;
    const imp = 'good.salted_fish';
    expect(role(imp)).toBe('import');
    expect(markets['port.duluth']?.[imp]?.stock).toBeLessThan(
      (open['port.duluth']?.[imp]?.stock as number) * 0.6,
    );
  });

  it('lays the Morrill up December to March', () => {
    expect(gameLaw().actors.cutter.winterMonths).toEqual([11, 0, 1, 2]);
  });

  it('refuses a course into ice she cannot break', () => {
    const t = at(1901, 1, 10);
    // Out of the open lake for Duluth: the western arm's ice stops her short of the shore.
    const from = OPEN_LAKE;
    const course = planCourse(geo, from, [port('port.duluth')], (p) =>
      closesHull(ice.at(p, t), ICE.hull.stopCm),
    );
    expect(course.problem).toBe('ice');
    expect(course.legs[0]?.iceAt).toBeGreaterThan(0);
    expect(course.legs[0]?.iceAt).toBeLessThan(course.legs[0]?.landAt ?? 1);
    const summer = planCourse(geo, from, [OPEN_LAKE], (p) =>
      closesHull(ice.at(p, at(1901, 6, 1)), ICE.hull.stopCm),
    );
    expect(summer.problem).not.toBe('ice');
  });
});

describe('the Mataafa storm (November 27–28, 1905)', () => {
  it('blows a north-east gale down the lake onto Duluth at its height', () => {
    const { peakAt } = mataafa();
    expect(iso(peakAt)).toBe('1905-11-28');
    const w = createWeatherState('mataafa', peakAt - 30 * 3600);
    advanceWeather(w, peakAt);
    const duluth = WORLD_PROJECTION_REF.duluth;
    expect(pressureAt(w, duluth, peakAt)).toBeLessThan(1000);
    const wind = windAt(w, duluth, peakAt);
    expect(wind.speedKn).toBeGreaterThanOrEqual(28);
    // From the north-east quarter.
    const fromDeg = ((((wind.fromRad * 180) / Math.PI) % 360) + 360) % 360;
    expect(fromDeg).toBeGreaterThan(0);
    expect(fromDeg).toBeLessThan(110);
  });
});

describe('the game side: freeze-up, ice-out and the first boat in', () => {
  const setup = (startAt: number) => {
    const state = createWorldState('ice-game', startAt);
    const events = new EventBus<GameEvents>();
    const ctx = { state, events } as unknown as GameContext;
    const seed = `run-${state.environment.weather.noiseSeed}`;
    const contacts = createContacts(geo.projection, `${seed}-traffic`, startAt);
    const fired: string[] = [];
    const game = attachIce({
      ctx,
      seed,
      contacts: () => contacts,
      economy: gameEconomy(),
      fire: (id, p) => fired.push(`${id}@${p}`),
    });
    return { state, events, game, fired, seed, contacts };
  };

  it('tells freeze-up and ice-out once each, and takes a winter save as it stands', () => {
    const start = at(1900, 10, 1);
    const { state, events, game, fired } = setup(start);
    const seen: string[] = [];
    events.on('HarborFrozen', (e) => seen.push(`frozen ${e.port}`));
    events.on('HarborOpened', (e) => seen.push(`open ${e.port}`));
    for (let t = start; t < at(1901, 5, 1); t += 3600 * 6) {
      state.environment.clock.gameSeconds = t;
      game.check();
    }
    expect(seen.filter((s) => s === 'frozen port.duluth')).toHaveLength(1);
    expect(seen.filter((s) => s === 'open port.duluth')).toHaveLength(1);
    expect(fired).toContain('event.freeze_up@port.duluth');
    expect(fired).toContain('event.ice_out@port.bayfield');
    // A run from before the ice, loaded in January, doesn't announce what's already frozen.
    const mid = setup(at(1901, 0, 20));
    expect(mid.state.ice?.frozen).toContain('port.duluth');
    expect(mid.fired).toHaveLength(0);
  });

  it('gives you the first boat in if you tie up at Duluth before the traffic, at a premium', () => {
    const { state, events, game, seed } = setup(at(1900, 10, 1));
    const ice = lakeIceFor(seed);
    const season = ice.harborSeason('port.duluth', at(1901, 0, 15));
    const open = season.openAt as number;
    state.environment.clock.gameSeconds = open + 60;
    const fish = () => state.markets['port.duluth']?.['good.salted_fish']?.stock as number;
    const before = fish();
    const won: { you: boolean }[] = [];
    events.on('FirstBoatIn', (e) => won.push(e));
    events.emit('PortVisited', { port: 'port.duluth' });
    expect(won).toEqual([expect.objectContaining({ you: true })]);
    expect(fish()).toBeLessThan(before);
    expect(Object.values(game.state.firstBoat)[0]?.you).toBe(true);
    // Once a spring.
    events.emit('PortVisited', { port: 'port.duluth' });
    expect(won).toHaveLength(1);
  });

  it('gives it to the traffic when you come later', () => {
    const { state, events, game, seed, contacts } = setup(at(1900, 10, 1));
    const ice = lakeIceFor(seed);
    const season = ice.harborSeason('port.duluth', at(1901, 0, 15));
    const first = firstArrivalAfter(contacts, 'port.duluth', season.openAt as number, Infinity);
    state.environment.clock.gameSeconds = (first?.at as number) + 3600;
    const won: { you: boolean; ship: string }[] = [];
    events.on('FirstBoatIn', (e) => won.push(e));
    game.check();
    events.emit('PortVisited', { port: 'port.duluth' });
    expect(won).toEqual([{ port: 'port.duluth', you: false, ship: first?.ship }]);
  });
});

describe('saves (plan 16 §12)', () => {
  it('round-trips the ice slice', () => {
    const state = createWorldState('ice-save');
    state.ice = {
      frozen: ['port.duluth'],
      firstBoat: { '1901': { ship: 'Lark', you: true, at: 12 } },
      mataafaAt: 99,
    };
    const back = worldStateSchema.parse(JSON.parse(JSON.stringify(state)));
    expect(back.ice).toEqual(state.ice);
    expect(iceStateSchema.parse(back.ice)).toEqual(state.ice);
  });

  it('carries an autumn 0.8 (v10) save on into winter', () => {
    const fixture = JSON.parse(
      readFileSync(join(import.meta.dirname, 'fixtures', 'saves', 'v10.json'), 'utf8'),
    ) as { saveVersion: number; state: SavePayload };
    const state = parseWorldState(migrateSave(fixture.state, fixture.saveVersion));
    expect(state.ice).toBeUndefined();
    // Late October of its year: the run sails on, and the winter comes to it.
    state.environment.clock.gameSeconds = at(1900, 9, 25);
    const events = new EventBus<GameEvents>();
    const ctx = { state, events } as unknown as GameContext;
    const seed = `run-${state.environment.weather.noiseSeed}`;
    const game = attachIce({ ctx, seed, contacts: () => [], economy: gameEconomy() });
    expect(game.state.frozen).toEqual([]);
    const frozen: string[] = [];
    events.on('HarborFrozen', (e) => frozen.push(e.port));
    for (let t = at(1900, 9, 25); t < at(1901, 1, 1); t += 6 * 3600) {
      state.environment.clock.gameSeconds = t;
      game.check();
    }
    expect(frozen).toContain('port.bayfield');
    expect(worldStateSchema.parse(JSON.parse(JSON.stringify(state))).ice?.frozen).toContain(
      'port.bayfield',
    );
  });
});
