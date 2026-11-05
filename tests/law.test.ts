import { describe, expect, it } from 'vitest';
import { ChartProjection } from '../src/core/coords';
import { EventBus } from '../src/core/events';
import { SECONDS_PER_GAME_DAY, WORLD_TICK_GAME_SECONDS } from '../src/core/time';
import { attachLaw } from '../src/gameplay/law';
import type { GameContext, GameEvents } from '../src/modes/context';
import { portInfo } from '../src/sim/economy/defs';
import { gameSmuggler } from '../src/sim/economy/smuggler';
import { gameLaw, wantedTier } from '../src/sim/law/defs';
import {
  commitCrime,
  heatIn,
  interceptReport,
  replaceShip,
  setHeat,
  tickLaw,
  type LawEvent,
  type LawWorld,
} from '../src/sim/law/law';
import { playerRegion, regionAtChart, regionAtGeo, regionAtZone } from '../src/sim/law/regions';
import { createLawState } from '../src/sim/law/state';
import type { Witness } from '../src/sim/law/witness';
import { ZONE_DEFS } from '../src/sim/terrain/zones';
import { createWorldState } from '../src/sim/world-state';

const defs = gameLaw();

function must<T>(x: T | undefined): T {
  if (x === undefined) throw new Error('missing');
  return x;
}
const HOUR = 3600;
/** Noon on the first day: a keeper rows at once. */
const NOON = 12 * HOUR;
/** Midnight into the second day: a slow keeper waits for dawn. */
const MIDNIGHT = SECONDS_PER_GAME_DAY + 0.5 * HOUR;
const APOSTLES = 'region.apostles';
const CHEQUAMEGON = 'region.chequamegon';

function world(): LawWorld {
  return { law: createLawState('ship.t1_schooner', 'Wren', 0), standing: {}, seed: 'test' };
}

const keeper = (
  identification: Witness['identification'],
  reporting: Witness['reporting'] = 'slow',
): Witness => ({
  id: 'light.raspberry',
  kind: 'keeper',
  name: 'the Raspberry keeper',
  identification,
  reporting,
});

/** Runs world ticks from `from` to `to`, collecting events. */
function run(w: LawWorld, from: number, to: number, here?: string): LawEvent[] {
  const events: LawEvent[] = [];
  for (let t = from + WORLD_TICK_GAME_SECONDS; t <= to; t += WORLD_TICK_GAME_SECONDS) {
    events.push(...tickLaw(defs, w, t, WORLD_TICK_GAME_SECONDS / HOUR, here));
  }
  return events;
}

describe('the crime pipeline (plan 06 §2.1)', () => {
  it('a crime with no witnesses produces no Wanted (criterion 1)', () => {
    const w = world();
    const events = commitCrime(
      defs,
      w,
      { crime: 'crime.smuggler_deal', region: APOSTLES, witnesses: [] },
      NOON,
    );
    expect(events.map((e) => e.type)).toEqual(['CrimeCommitted']);
    run(w, NOON, NOON + 2 * SECONDS_PER_GAME_DAY);
    expect(heatIn(w.law, APOSTLES)).toBe(0);
    expect(w.law.reports.inProgress).toEqual([]);
    expect(w.law.reports.crimes).toEqual([]);
  });

  it('in view of a keeper, the heat lands only when the report does (criterion 2)', () => {
    const w = world();
    const events = commitCrime(
      defs,
      w,
      { crime: 'crime.smuggler_deal', region: APOSTLES, witnesses: [keeper('ship')] },
      MIDNIGHT,
    );
    const seen = events.find((e) => e.type === 'Witnessed');
    expect(seen?.type).toBe('Witnessed');
    const eta = must(w.law.reports.inProgress[0]).eta;
    // A slow keeper rows to town at dawn (06:00), then takes 1–3 hours.
    const dawn = SECONDS_PER_GAME_DAY + 6 * HOUR;
    expect(eta).toBeGreaterThanOrEqual(dawn + HOUR);
    expect(eta).toBeLessThanOrEqual(dawn + 3 * HOUR);
    run(w, MIDNIGHT, eta - WORLD_TICK_GAME_SECONDS);
    expect(heatIn(w.law, APOSTLES)).toBe(0);
    const later = run(w, eta - WORLD_TICK_GAME_SECONDS, eta + WORLD_TICK_GAME_SECONDS);
    expect(later.find((e) => e.type === 'ReportFiled')).toMatchObject({
      heatAdded: 20,
      identification: 'ship',
    });
    expect(later.find((e) => e.type === 'WantedTierChanged')).toMatchObject({
      region: APOSTLES,
      from: 0,
      to: 1,
    });
    expect(wantedTier(defs, heatIn(w.law, APOSTLES))).toBe(1);
    expect(w.law.wanted[APOSTLES]?.shipHeat).toBe(20);
  });

  it('intercepting the report before it lands prevents the heat (criterion 2)', () => {
    const w = world();
    commitCrime(
      defs,
      w,
      { crime: 'crime.smuggler_deal', region: APOSTLES, witnesses: [keeper('ship')] },
      MIDNIGHT,
    );
    const r = must(w.law.reports.inProgress[0]);
    expect(interceptReport(w, r.id)).toMatchObject({ type: 'ReportIntercepted', reportId: r.id });
    run(w, MIDNIGHT, MIDNIGHT + SECONDS_PER_GAME_DAY);
    expect(heatIn(w.law, APOSTLES)).toBe(0);
    expect(w.law.reports.crimes).toEqual([]);
    expect(interceptReport(w, r.id)).toBeUndefined();
  });

  it('gives the same delays for the same crime after a reload', () => {
    const a = world();
    const b = world();
    commitCrime(
      defs,
      a,
      { crime: 'crime.smuggler_deal', region: APOSTLES, witnesses: [keeper('ship', 'medium')] },
      NOON,
    );
    commitCrime(
      defs,
      b,
      { crime: 'crime.smuggler_deal', region: APOSTLES, witnesses: [keeper('ship', 'medium')] },
      NOON,
    );
    expect(must(a.law.reports.inProgress[0]).eta).toBe(must(b.law.reports.inProgress[0]).eta);
    expect(must(a.law.reports.inProgress[0]).eta - NOON).toBeGreaterThanOrEqual(1.5 * HOUR);
  });

  it('counts two witnesses of one crime once, at the best identification', () => {
    const w = world();
    const crew: Witness = {
      id: 'ship.hiawatha',
      kind: 'crew',
      name: 'the Hiawatha',
      identification: 'schooner',
    };
    commitCrime(
      defs,
      w,
      { crime: 'crime.smuggler_deal', region: APOSTLES, witnesses: [keeper('ship', 'fast'), crew] },
      NOON,
    );
    run(w, NOON, NOON + 3 * SECONDS_PER_GAME_DAY + HOUR);
    // Decay starts after the grace period, so read the heat straight after both land.
    const w2 = world();
    commitCrime(
      defs,
      w2,
      { crime: 'crime.smuggler_deal', region: APOSTLES, witnesses: [crew, keeper('ship', 'fast')] },
      NOON,
    );
    for (const r of w2.law.reports.inProgress) r.eta = NOON + HOUR;
    const events = tickLaw(defs, w2, NOON + HOUR, 1 / 6, undefined);
    expect(heatIn(w2.law, APOSTLES)).toBe(20);
    expect(
      events
        .filter((e) => e.type === 'ReportFiled')
        .map((e) => (e as { heatAdded: number }).heatAdded)
        .sort(),
    ).toEqual([10, 10]);
  });

  it('only raises alertness when nobody could say who it was', () => {
    const w = world();
    commitCrime(
      defs,
      w,
      { crime: 'crime.smuggler_deal', region: APOSTLES, witnesses: [keeper('unknown', 'fast')] },
      NOON,
    );
    must(w.law.reports.inProgress[0]).eta = NOON;
    tickLaw(defs, w, NOON, 0, undefined);
    expect(heatIn(w.law, APOSTLES)).toBe(0);
    expect(w.law.wanted[APOSTLES]?.alert).toBe(5);
  });

  it('a traced crime is named to you whatever the witness saw, and costs Standing and brings Fame', () => {
    const w = world();
    w.standing['port.bayfield'] = 40;
    const agent: Witness = {
      id: 'agent.x',
      kind: 'freightAgent',
      name: 'the agent',
      identification: 'unknown',
    };
    commitCrime(
      defs,
      w,
      {
        crime: 'crime.contract_theft',
        region: CHEQUAMEGON,
        port: 'port.bayfield',
        witnesses: [agent],
      },
      NOON,
    );
    expect(w.law.reports.inProgress[0]?.identification).toBe('person');
    run(w, NOON, NOON + 13 * HOUR);
    expect(heatIn(w.law, CHEQUAMEGON)).toBe(40);
    expect(w.law.fame.value).toBe(5);
    // Contract theft's Standing hit is the contracts' own (plan 05 §5.2).
    expect(w.standing['port.bayfield']).toBe(40);
    const w2 = world();
    w2.standing['port.bayfield'] = 40;
    const merchant: Witness = {
      id: 'm',
      kind: 'merchant',
      name: 'a merchant',
      identification: 'person',
    };
    commitCrime(
      defs,
      w2,
      {
        crime: 'crime.hot_goods',
        region: CHEQUAMEGON,
        port: 'port.bayfield',
        witnesses: [merchant],
      },
      NOON,
    );
    run(w2, NOON, NOON + 2 * HOUR);
    expect(heatIn(w2.law, CHEQUAMEGON)).toBe(15);
    expect(w2.standing['port.bayfield']).toBe(35);
  });

  it('the cutter files at once', () => {
    const w = world();
    const cutter: Witness = {
      id: 'law.morrill',
      kind: 'cutter',
      name: 'the Morrill',
      identification: 'ship',
    };
    const events = commitCrime(
      defs,
      w,
      { crime: 'crime.contraband', region: APOSTLES, witnesses: [cutter] },
      NOON,
    );
    expect(events.some((e) => e.type === 'ReportFiled')).toBe(true);
    expect(heatIn(w.law, APOSTLES)).toBe(20);
  });
});

describe('heat over time (plan 06 §3.3–3.4)', () => {
  const merchant: Witness = {
    id: 'm',
    kind: 'merchant',
    name: 'a merchant',
    identification: 'person',
  };
  const agent: Witness = {
    id: 'a',
    kind: 'freightAgent',
    name: 'the agent',
    identification: 'person',
  };

  it('fleeing escapes petty heat, but contract theft spreads to the neighbors (criterion 3)', () => {
    const w = world();
    commitCrime(
      defs,
      w,
      {
        crime: 'crime.hot_goods',
        region: CHEQUAMEGON,
        port: 'port.bayfield',
        witnesses: [merchant],
      },
      NOON,
    );
    run(w, NOON, NOON + 3 * SECONDS_PER_GAME_DAY, 'region.duluth');
    for (const n of must(defs.regionById.get(CHEQUAMEGON)).neighbors)
      expect(heatIn(w.law, n), n).toBe(0);

    const t = world();
    commitCrime(
      defs,
      t,
      {
        crime: 'crime.contract_theft',
        region: CHEQUAMEGON,
        port: 'port.bayfield',
        witnesses: [agent],
      },
      NOON,
    );
    const events = run(t, NOON, NOON + 12 * HOUR + 12 * HOUR + HOUR, 'region.duluth');
    const spread = events.find((e) => e.type === 'HeatSpread');
    expect(spread).toMatchObject({ from: CHEQUAMEGON, heat: 12 });
    for (const n of must(defs.regionById.get(CHEQUAMEGON)).neighbors) {
      expect(heatIn(t.law, n), n).toBeGreaterThan(10);
    }
    expect(heatIn(t.law, 'region.duluth')).toBe(0);
    expect(t.law.reports.crimes).toEqual([]);
  });

  it('decay brings petty heat back to Clean over a few game days away (criterion 10)', () => {
    const w = world();
    setHeat(defs, w.law, APOSTLES, 59);
    must(w.law.wanted[APOSTLES]).lastCrimeAt = 0;
    run(w, 0, 12 * HOUR, 'region.duluth');
    expect(heatIn(w.law, APOSTLES)).toBeLessThan(59);
    const end = 4 * SECONDS_PER_GAME_DAY;
    const events = run(w, 12 * HOUR, end, 'region.duluth');
    expect(wantedTier(defs, heatIn(w.law, APOSTLES))).toBe(0);
    expect(events.some((e) => e.type === 'WantedTierChanged' && e.to === 0)).toBe(true);
  });

  it('decays more slowly while you stay, and not during the grace period', () => {
    const away = world();
    const here = world();
    for (const w of [away, here]) {
      setHeat(defs, w.law, APOSTLES, 50);
      must(w.law.wanted[APOSTLES]).lastCrimeAt = 0;
    }
    run(away, 0, 6 * HOUR, 'region.duluth');
    expect(heatIn(away.law, APOSTLES)).toBe(50);
    run(away, 6 * HOUR, 24 * HOUR, 'region.duluth');
    run(here, 0, 24 * HOUR, APOSTLES);
    expect(heatIn(here.law, APOSTLES)).toBeGreaterThan(heatIn(away.law, APOSTLES));
    expect(here.law.wanted[APOSTLES]?.lastSeenAt).toBe(24 * HOUR);
  });

  it('tier 4 never drops below tier 3 by decay alone', () => {
    const w = world();
    setHeat(defs, w.law, APOSTLES, 320);
    run(w, 0, 60 * SECONDS_PER_GAME_DAY, 'region.duluth');
    expect(heatIn(w.law, APOSTLES)).toBe(150);
    expect(wantedTier(defs, heatIn(w.law, APOSTLES))).toBe(3);
  });

  it('Fame fades after a grace period', () => {
    const w = world();
    w.law.fame = { value: 100, lastNotableAt: 0 };
    run(w, 0, 3 * SECONDS_PER_GAME_DAY - WORLD_TICK_GAME_SECONDS);
    expect(w.law.fame.value).toBe(100);
    run(w, 3 * SECONDS_PER_GAME_DAY - WORLD_TICK_GAME_SECONDS, 4 * SECONDS_PER_GAME_DAY);
    expect(w.law.fame.value).toBeCloseTo(98, 1);
  });
});

describe('the ship profile (plan 06 §2.3: no disguise)', () => {
  it('a new hull sheds the heat tied to the old ship, but not the personal record', () => {
    const w = world();
    const cutter: Witness = {
      id: 'c',
      kind: 'cutter',
      name: 'the Morrill',
      identification: 'ship',
    };
    const merchant: Witness = {
      id: 'm',
      kind: 'merchant',
      name: 'a merchant',
      identification: 'person',
    };
    commitCrime(
      defs,
      w,
      { crime: 'crime.contraband', region: APOSTLES, witnesses: [cutter] },
      NOON,
    );
    commitCrime(
      defs,
      w,
      { crime: 'crime.hot_goods', region: APOSTLES, witnesses: [merchant] },
      NOON,
    );
    run(w, NOON, NOON + 2 * HOUR);
    expect(heatIn(w.law, APOSTLES)).toBe(35);
    const events = replaceShip(defs, w.law, 'ship.t2_schooner', 'Wren', NOON + 2 * HOUR);
    expect(events.find((e) => e.type === 'ProfileChanged')).toMatchObject({ hull: 2, shed: 20 });
    expect(heatIn(w.law, APOSTLES)).toBe(15);
    expect(w.law.profiles.ship).toMatchObject({ hull: 2, classId: 'ship.t2_schooner' });
  });

  it('a report on the old ship still on its way only describes a schooner', () => {
    const w = world();
    commitCrime(
      defs,
      w,
      { crime: 'crime.smuggler_deal', region: APOSTLES, witnesses: [keeper('ship', 'fast')] },
      NOON,
    );
    replaceShip(defs, w.law, 'ship.t2_schooner', 'Wren', NOON);
    const events = run(w, NOON, NOON + 2 * HOUR);
    expect(events.find((e) => e.type === 'ReportFiled')).toMatchObject({
      identification: 'schooner',
      heatAdded: 10,
    });
    expect(w.law.wanted[APOSTLES]?.shipHeat).toBe(0);
  });
});

describe('Wanted regions (plan 06 §3.1)', () => {
  const projection = new ChartProjection();

  it('puts every port in its own region', () => {
    for (const port of [
      'port.bayfield',
      'port.washburn',
      'port.ashland',
      'port.la_pointe',
      'port.duluth',
      'port.superior',
      'port.two_harbors',
    ]) {
      const region = must(portInfo(port)).wantedRegion;
      expect(defs.regionById.has(region), port).toBe(true);
    }
    expect(portInfo('port.ashland')?.wantedRegion).toBe('region.ashland');
  });

  it("finds each port's region from where it lies, too", () => {
    const at: Record<string, [number, number]> = {
      'port.duluth': [-92.098, 46.787],
      'port.superior': [-92.03, 46.718],
      'port.two_harbors': [-91.672, 47.018],
      'port.bayfield': [-90.822, 46.812],
      'port.la_pointe': [-90.788, 46.775],
      'port.washburn': [-90.898, 46.672],
      'port.ashland': [-90.884, 46.592],
    };
    for (const [port, [lon, lat]] of Object.entries(at)) {
      expect(regionAtGeo(defs, { lat, lon }), port).toBe(must(portInfo(port)).wantedRegion);
    }
    // Port Wing and Cornucopia lie in South Shore West; the smuggler, Stockton and Raspberry in the islands.
    expect(regionAtGeo(defs, { lat: 46.78, lon: -91.39 })).toBe('region.south_shore_west');
    expect(regionAtGeo(defs, { lat: 46.864, lon: -91.103 })).toBe('region.south_shore_west');
    expect(regionAtGeo(defs, gameSmuggler().anchorage.at)).toBe(gameSmuggler().anchorage.region);
    expect(regionAtGeo(defs, { lat: 46.92, lon: -90.55 })).toBe(APOSTLES);
    expect(regionAtGeo(defs, { lat: 46.97, lon: -90.8 })).toBe(APOSTLES);
    // Open lake far out goes to the nearest region.
    expect(regionAtGeo(defs, { lat: 47.4, lon: -91.6 })).toBe('region.north_shore');
  });

  it('gives chart and zone positions a region', () => {
    const chart = projection.geoToChart({ lat: 46.592, lon: -90.884 });
    expect(regionAtChart(defs, chart)).toBe('region.ashland');
    for (const z of ZONE_DEFS)
      expect(regionAtZone(defs, z.id, { x: z.spawn.x, z: z.spawn.z }), z.id).toBeTruthy();
    expect(regionAtZone(defs, 'zone.nowhere', { x: 0, z: 0 })).toBeUndefined();
    const state = createWorldState('regions');
    expect(defs.regionById.has(playerRegion(defs, state) ?? '')).toBe(true);
    state.player.location = { mode: 'chart', chartPos: chart, heading: 0 };
    expect(playerRegion(defs, state)).toBe('region.ashland');
  });
});

describe('the law in the running game (Phase 4 crimes become crimes)', () => {
  const setup = () => {
    const state = createWorldState('law-game', NOON);
    const events = new EventBus<GameEvents>();
    const ctx = { state, events } as unknown as GameContext;
    const law = attachLaw(ctx, 'seed');
    const seen: string[] = [];
    events.tap((type) => seen.push(type));
    return { state, events, law, seen };
  };

  it('turns a detected hot lot into a crime named to you at that port', () => {
    const { state, events, seen } = setup();
    events.emit('HotGoodsDetected', {
      port: 'port.bayfield',
      region: 'region.chequamegon',
      good: 'good.copper',
      qty: 2,
      kind: 'hot',
      outcome: 'refused',
      heat: 1,
    });
    expect(seen).toContain('CrimeCommitted');
    expect(state.reports.inProgress[0]).toMatchObject({
      identification: 'person',
      witness: { kind: 'merchant' },
    });
    for (let i = 0; i < 12; i++) {
      state.environment.clock.gameSeconds += WORLD_TICK_GAME_SECONDS;
      events.emit('WorldTick', { gameSeconds: state.environment.clock.gameSeconds });
    }
    expect(heatIn(state, CHEQUAMEGON)).toBe(15);
    // 15 heat: still Clean, one more like it and the region's Suspicious.
    expect(seen).toContain('ReportFiled');
    expect(seen).not.toContain('WantedTierChanged');
  });

  it('turns contraband offered into smuggling, and a stolen contract into theft', () => {
    const { state, events } = setup();
    events.emit('HotGoodsDetected', {
      port: 'port.ashland',
      region: 'region.ashland',
      good: 'good.untaxed_whiskey',
      qty: 4,
      kind: 'contraband',
      outcome: 'confiscated',
      heat: 0,
    });
    events.emit('ContractStolen', {
      contractId: 'c1',
      from: 'port.duluth',
      to: 'port.bayfield',
      company: 'company.x',
      port: 'port.ashland',
      good: 'good.lumber',
      qty: 10,
      totalCents: 1000,
    });
    expect(state.reports.crimes.map((c) => c.crime)).toEqual([
      'crime.contraband',
      'crime.contract_theft',
    ]);
    expect(state.reports.crimes.every((c) => c.region === 'region.ashland')).toBe(true);
  });

  it('a smuggler deal unseen is nothing; seen, it is one crime a night', () => {
    const { state, events, law } = setup();
    const deal = () =>
      events.emit('SmugglerDealt', {
        smuggler: 'smuggler.island',
        side: 'buy',
        good: 'good.untaxed_whiskey',
        qty: 1,
        totalCents: 100,
        hot: false,
      });
    deal();
    expect(state.reports.crimes).toEqual([]);
    state.environment.clock.gameSeconds += SECONDS_PER_GAME_DAY;
    law.witnesses = { witnesses: () => [keeper('ship')] };
    deal();
    deal();
    expect(state.reports.crimes.length).toBe(1);
    expect(state.reports.crimes[0]?.region).toBe(gameSmuggler().anchorage.region);
  });

  it('a new hull from the shipyard sheds the old ship record', () => {
    const { state, events, law } = setup();
    law.setHeat(APOSTLES, 40);
    must(state.wanted[APOSTLES]).shipHeat = 30;
    events.emit('ShipPurchased', {
      port: 'port.duluth',
      classId: 'ship.t2_schooner',
      fromClassId: 'ship.t1_schooner',
      priceCents: 0,
      tradeInCents: 0,
      autoSold: [],
      autoSoldCents: 0,
      moved: [],
    });
    expect(heatIn(state, APOSTLES)).toBe(10);
    expect(state.profiles.ship.hull).toBe(2);
  });
});
