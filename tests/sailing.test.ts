import { describe, expect, it } from 'vitest';
import { knotsToMs } from '../src/core/coords';
import {
  createSailingState,
  headSeaAmplitude,
  IDLE_COMMAND,
  speedKn,
  stepSailing,
  type SailingCommand,
  type SailingEvent,
  type SailingState,
  type SailingWind,
} from '../src/sim/sailing/controller';
import { createCurve, sampleCurve } from '../src/sim/sailing/curve';
import { defaultHandling } from '../src/sim/sailing/handling';
import { parsePreset, serializePreset } from '../src/sim/sailing/preset';
import { compileSailingClass } from '../src/sim/sailing/ship-class';
import { sailShipRecord, T1_SCHOONER_ID, T2_SCHOONER_ID } from '../src/sim/sailing/ships';
import { createSea } from '../src/sim/weather/waves';

const DEG = Math.PI / 180;
const DT = 1 / 30;
const SCALE = { rate: 24, compression: 8 };
const t1 = (): ReturnType<typeof compileSailingClass> =>
  compileSailingClass(sailShipRecord(T1_SCHOONER_ID), defaultHandling());
const north = (speedKn: number, gust01 = 0): SailingWind => ({ fromRad: 0, speedKn, gust01 });

function ship(headingDeg: number, sail = 3): SailingState {
  const s = createSailingState(0, 0, headingDeg * DEG);
  s.sailLevel = sail;
  s.sailSetting = sail;
  return s;
}

function run(
  s: SailingState,
  seconds: number,
  wind: SailingWind,
  cmd: Partial<SailingCommand> = {},
  c = t1(),
  events: SailingEvent[] = [],
): SailingState {
  const command = { ...IDLE_COMMAND, ...cmd };
  for (let i = 0; i < Math.round(seconds / DT); i++) {
    stepSailing(s, command, c, wind, 0, SCALE, DT, events);
  }
  return s;
}

const steady = (headingDeg: number, windKn = 14, sail = 3): number =>
  speedKn(run(ship(headingDeg, sail), 60, north(windKn)));

describe('curves', () => {
  it('passes through every point, holds the ends and never overshoots', () => {
    const c = createCurve([
      [0, 0],
      [40, 0],
      [45, 0.6],
      [120, 1],
      [135, 1],
      [180, 0.75],
    ]);
    expect(sampleCurve(c, 45)).toBeCloseTo(0.6, 9);
    expect(sampleCurve(c, -10)).toBe(0);
    expect(sampleCurve(c, 999)).toBe(0.75);
    for (let x = 0; x <= 180; x += 0.5) {
      const y = sampleCurve(c, x);
      expect(y).toBeGreaterThanOrEqual(0);
      expect(y).toBeLessThanOrEqual(1 + 1e-12);
      if (x <= 40) expect(y).toBe(0);
    }
  });

  it('rejects unsorted points', () => {
    expect(() =>
      createCurve([
        [1, 0],
        [1, 1],
      ]),
    ).toThrow();
  });
});

describe('ship data', () => {
  it('compiles the T1 record to SI with its no-go zone', () => {
    const c = t1();
    expect(c.hullMaxSpeed).toBeCloseTo(knotsToMs(8), 9);
    expect(c.noGo).toBeCloseTo(40 * DEG, 9);
    expect(c.sweeps).toBe(true);
  });

  it('round-trips a tuning preset through JSON', () => {
    const ship = sailShipRecord(T1_SCHOONER_ID);
    const handling = defaultHandling();
    const back = parsePreset(serializePreset(ship, handling));
    expect(back.ship).toEqual(ship);
    expect(back.handling).toEqual(handling);
    expect(() => parsePreset('{"kind":"sailing-tuning","version":1}')).toThrow(/preset/);
  });
});

describe('speed model (plan 02 §3)', () => {
  it('is fastest on a broad reach and slowest close-hauled', () => {
    const close = steady(45);
    const beam = steady(90);
    const broad = steady(130);
    const run180 = steady(180);
    expect(broad).toBeGreaterThan(beam);
    expect(beam).toBeGreaterThan(run180);
    expect(run180).toBeGreaterThan(close);
    // Hull speed × polar × wind × auto-trim, so never above the hull's 8 kn.
    expect(broad).toBeLessThan(8);
    expect(broad).toBeGreaterThan(6.5);
  });

  it('is the same on either tack', () => {
    expect(steady(-100)).toBeCloseTo(steady(100), 6);
  });

  it('makes beating upwind clearly slower than reaching', () => {
    // Velocity made good to windward at the best close-hauled angle vs. a beam reach.
    let bestVmg = 0;
    for (let a = 42; a <= 80; a += 2) bestVmg = Math.max(bestVmg, steady(a) * Math.cos(a * DEG));
    expect(bestVmg).toBeLessThan(0.6 * steady(90));
  });

  it('scales with sail level and stays near zero when becalmed', () => {
    expect(steady(90, 14, 1)).toBeLessThan(steady(90, 14, 2));
    expect(steady(90, 14, 2)).toBeLessThan(steady(90, 14, 3));
    expect(steady(90, 14, 0)).toBe(0);
    expect(steady(90, 1)).toBeLessThan(0.6);
  });

  it('adds gusts on top of the sustained wind', () => {
    const calm = speedKn(run(ship(90), 60, north(6)));
    const gusty = speedKn(run(ship(90), 60, north(6, 1)));
    expect(gusty).toBeGreaterThan(calm * 1.1);
  });

  it('takes the plan 02 §3.2 change time per sail step', () => {
    const s = ship(90, 0);
    run(s, 0.1, north(14), { raiseSail: true });
    run(s, 0.1, north(14), { raiseSail: true });
    run(s, 0.1, north(14), { raiseSail: true });
    expect(s.sailLevel).toBe(3);
    run(s, 11, north(14));
    expect(s.sailSetting).toBeLessThan(3);
    run(s, 1.5, north(14));
    expect(s.sailSetting).toBe(3);
  });

  it('carries way after the sails come down', () => {
    const s = ship(90);
    run(s, 60, north(14));
    const before = speedKn(s);
    s.sailLevel = 0;
    s.sailSetting = 0;
    run(s, 5, north(14));
    expect(speedKn(s)).toBeGreaterThan(before * 0.4);
  });

  it('pays about 8% for auto-trim against a well-trimmed sheet', () => {
    const auto = steady(90);
    const s = ship(90);
    s.manualTrim = true;
    run(s, 1, north(14));
    s.trim = s.idealTrim;
    run(s, 60, north(14));
    expect(s.trimFactor).toBe(1);
    expect(speedKn(s) / auto).toBeCloseTo(1 / 0.92, 3);

    const off = ship(90);
    off.manualTrim = true;
    off.trim = 0;
    run(off, 60, north(14));
    expect(speedKn(off)).toBeLessThan(auto);
  });

  it('moves the sheets with Q and E only under manual trim', () => {
    const s = ship(90);
    run(s, 1, north(14), { trimOut: true });
    expect(s.trim).toBe(0.5);
    s.manualTrim = true;
    run(s, 0.5, north(14), { trimOut: true });
    expect(s.trim).toBeCloseTo(0.75, 2);
  });

  it('slows into head seas, not following ones', () => {
    // testBaySea travels from the northwest toward the southeast.
    const sea = createSea();
    const intoSeas = headSeaAmplitude(sea.waves, 315 * DEG);
    expect(intoSeas).toBeGreaterThan(1);
    expect(headSeaAmplitude(sea.waves, 135 * DEG)).toBe(0);
    expect(headSeaAmplitude(sea.waves, 315 * DEG, 0.25)).toBeCloseTo(intoSeas / 4, 9);

    const c = t1();
    const s = ship(90);
    for (let i = 0; i < 1800; i++) stepSailing(s, IDLE_COMMAND, c, north(14), intoSeas, SCALE, DT);
    expect(s.seaStateFactor).toBeLessThan(0.9);
    expect(s.seaStateFactor).toBeGreaterThanOrEqual(0.8);
  });
});

describe('turning and tacking (plan 02 §4)', () => {
  it('turns slowly at a standstill and best at moderate speed', () => {
    const turned = (sail: number): number => {
      const s = ship(90, sail);
      run(s, 60, north(14));
      const h = s.heading;
      run(s, 2, north(14), { steer: 1 });
      return s.heading - h;
    };
    expect(turned(0)).toBeLessThan(turned(3) / 3);
  });

  it('ramps the rudder over and back', () => {
    const s = ship(90);
    run(s, 0.3, north(14), { steer: 1 });
    expect(s.rudder).toBeGreaterThan(0.4);
    expect(s.rudder).toBeLessThan(0.6);
    run(s, 0.5, north(14), { steer: 1 });
    expect(s.rudder).toBe(1);
    run(s, 0.4, north(14));
    expect(s.rudder).toBe(0);
  });

  it('tacks cleanly in 6–10 s, losing 30–40% of the speed', () => {
    for (const start of [50, 55]) {
      const s = run(ship(start), 60, north(14));
      const v0 = speedKn(s);
      const events: SailingEvent[] = [];
      let t = 0;
      while (s.heading > -start * DEG && t < 20) {
        run(s, DT, north(14), { steer: -1 }, undefined, events);
        t += DT;
      }
      expect(t).toBeGreaterThan(6);
      expect(t).toBeLessThan(10);
      const loss = 1 - speedKn(s) / v0;
      expect(loss).toBeGreaterThan(0.3);
      expect(loss).toBeLessThan(0.4);
      expect(events).toEqual([{ kind: 'tack' }]);
      expect(s.stalled).toBe(false);
    }
  });

  it('stalls in irons without way on, drifts back and falls off', () => {
    const s = ship(10, 1);
    run(s, 4, north(14));
    expect(s.inIrons).toBe(true);
    expect(s.stalled).toBe(true);
    expect(s.speed).toBeLessThan(0);
    // The bow falls off away from the wind, which is on its port side.
    run(s, 20, north(14));
    expect(s.inIrons).toBe(false);
    expect(s.heading).toBeGreaterThan(40 * DEG);
  });

  it('jibes with little speed loss, uncontrolled in strong wind at Full sail', () => {
    const jibe = (windKn: number, sail: number): [SailingEvent[], number, number] => {
      const s = run(ship(160, sail), 60, north(windKn));
      const v0 = speedKn(s);
      const events: SailingEvent[] = [];
      while (s.heading > 0 || s.heading < -160 * DEG) {
        run(s, DT, north(windKn), { steer: 1 }, undefined, events);
      }
      return [events, v0, speedKn(s)];
    };
    const [calm, v0, v1] = jibe(12, 3);
    expect(calm).toEqual([{ kind: 'jibe', uncontrolled: false }]);
    expect(v1).toBeGreaterThan(v0 * 0.8);
    expect(jibe(24, 3)[0]).toEqual([{ kind: 'jibe', uncontrolled: true }]);
    expect(jibe(24, 1)[0]).toEqual([{ kind: 'jibe', uncontrolled: false }]);
  });

  it('moves in the scene at v × R / C along the heading', () => {
    const s = run(ship(90), 60, north(14));
    const x = s.x;
    const v = s.speed;
    run(s, 1, north(14));
    expect(s.x - x).toBeCloseTo((v * 24) / 8, 1);
    expect(Math.abs(s.z)).toBeLessThan(1e-6 + Math.abs(s.x) * Math.tan(4 * DEG));
  });
});

describe('sweeps (plan 02 §3.6)', () => {
  it('row at about 1.5 kn in a calm and turn slowly', () => {
    const s = ship(90, 0);
    run(s, 0.1, north(0), { toggleSweeps: true });
    expect(s.sweepsOut).toBe(true);
    run(s, 60, north(0));
    expect(speedKn(s)).toBeCloseTo(1.5, 1);
    const h = s.heading;
    run(s, 5, north(0), { steer: 1 });
    expect(s.heading - h).toBeGreaterThan(5 * DEG);
  });

  it('row a stalled ship out of irons', () => {
    const s = ship(0, 0);
    run(s, 0.1, north(10), { toggleSweeps: true });
    run(s, 30, north(10));
    expect(s.stalled).toBe(false);
    expect(speedKn(s)).toBeGreaterThan(1);
  });

  it('only on ships that carry them', () => {
    const c = t1();
    c.sweeps = false;
    const s = ship(90, 0);
    run(s, 0.1, north(0), { toggleSweeps: true }, c);
    expect(s.sweepsOut).toBe(false);
  });
});

describe('heel and leeway (plan 02 §3.3, §5.1)', () => {
  it('heels to leeward, more in strong wind and with more sail', () => {
    // Heading west, a north wind is on the starboard side: starboard rises.
    const w = run(ship(-90), 30, north(14));
    expect(w.heel).toBeGreaterThan(0);
    const e = run(ship(90), 30, north(14));
    expect(e.heel).toBeCloseTo(-w.heel, 6);
    expect(run(ship(-90), 30, north(24)).heel).toBeGreaterThan(w.heel);
    expect(run(ship(-90, 1), 30, north(24)).heel).toBeLessThan(w.heel * 1.5);
    expect(run(ship(-90), 30, north(24)).heel).toBeLessThanOrEqual(14 * DEG + 1e-9);
    expect(Math.abs(run(ship(0), 5, north(14)).heel)).toBeLessThan(1e-9);
  });

  it('slips a few degrees to leeward close-hauled, none on a run', () => {
    const close = run(ship(50), 30, north(14));
    // Wind on the port bow pushes the ship to starboard: course is right of heading.
    expect(close.course - close.heading).toBeGreaterThan(1 * DEG);
    expect(close.course - close.heading).toBeLessThan(5 * DEG);
    const free = run(ship(150), 30, north(14));
    expect(free.course).toBeCloseTo(free.heading, 9);
  });
});

describe('T2 schooner tuning (plan 02 §10, plan 10 §2; Phase 4 piece G)', () => {
  const t2 = (): ReturnType<typeof compileSailingClass> =>
    compileSailingClass(sailShipRecord(T2_SCHOONER_ID), defaultHandling());
  const steadyOn = (c: ReturnType<typeof compileSailingClass>, headingDeg: number): number =>
    speedKn(run(ship(headingDeg), 60, north(14), {}, c));

  it('is faster than the T1 on every point of sail, under its 9 kn hull speed', () => {
    for (const a of [45, 90, 130, 180]) {
      expect(steadyOn(t2(), a)).toBeGreaterThan(steadyOn(t1(), a) * 1.08);
      expect(steadyOn(t2(), a)).toBeLessThan(9);
    }
    expect(steadyOn(t2(), 130)).toBeGreaterThan(7.5);
  });

  it('gathers way more slowly than the T1', () => {
    const toNinety = (c: ReturnType<typeof compileSailingClass>): number => {
      const target = steadyOn(c, 90) * 0.9;
      const s = ship(90);
      let t = 0;
      while (speedKn(s) < target && t < 60) {
        run(s, DT, north(14), {}, c);
        t += DT;
      }
      return t;
    };
    expect(toNinety(t2())).toBeGreaterThan(toNinety(t1()) * 1.3);
  });

  it('tacks inside plan 02 §4, but slower than the T1', () => {
    const tack = (c: ReturnType<typeof compileSailingClass>, start: number): [number, number] => {
      const s = run(ship(start), 60, north(14), {}, c);
      const v0 = speedKn(s);
      let t = 0;
      while (s.heading > -start * DEG && t < 20) {
        run(s, DT, north(14), { steer: -1 }, c);
        t += DT;
      }
      return [t, 1 - speedKn(s) / v0];
    };
    for (const start of [50, 55]) {
      const [t, loss] = tack(t2(), start);
      expect(t).toBeGreaterThan(tack(t1(), start)[0]);
      expect(t).toBeLessThan(10);
      expect(loss).toBeGreaterThan(0.3);
      expect(loss).toBeLessThan(0.4);
    }
  });

  it('changes sail faster with a crew of four', () => {
    expect(t2().sailChangeTimeS).toBeLessThan(t1().sailChangeTimeS);
    expect(sailShipRecord(T2_SCHOONER_ID).draftEmptyM).toBe(2.5);
    expect(sailShipRecord(T2_SCHOONER_ID).draftFullM).toBe(3.2);
  });
});
