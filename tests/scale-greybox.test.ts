import { describe, expect, it } from 'vitest';
import { knotsToMs, sceneSpeed, type Chart } from '../src/core/coords';
import {
  chartOf,
  FREIGHTER_ROUTES,
  landHeight,
  landmassAt,
  PLACES,
  REFERENCE_LEGS,
} from '../src/debug/scale-greybox/geography';
import { createFreighters, stepFreighter } from '../src/debug/scale-greybox/freighters';
import {
  beamReachSpeed,
  greyboxDepth,
  steadyWind,
  turningCircle,
} from '../src/debug/scale-greybox/sailing';
import { snapToShore } from '../src/debug/scale-greybox/setpieces';
import { buildTerrain } from '../src/debug/scale-greybox/terrain';
import { createSchooner } from '../src/gameplay/schooner';
import { IDLE_COMMAND, stepSailing } from '../src/sim/sailing/controller';
import { IDLE_MOORING, stepHazards, type HazardEvent } from '../src/sim/sailing/hazards';

const NM = 1852;
const dist = (a: Chart, b: Chart): number => Math.hypot(b.x - a.x, b.y - a.y);

describe('S7 greybox geography', () => {
  it('matches the R1a reference distances within 15%', () => {
    for (const leg of REFERENCE_LEGS) {
      const nm = dist(leg.from, leg.to) / NM;
      expect(nm, leg.name).toBeGreaterThan(leg.r1aNm * 0.85);
      expect(nm, leg.name).toBeLessThan(leg.r1aNm * 1.2);
    }
  });

  it('puts every town and lighthouse within 1.5 km of dry land', () => {
    for (const p of PLACES) {
      const shore = snapToShore(
        p.chart,
        p.kind === 'town' ? 0.8 : 1.5,
        p.kind === 'town' ? 12 : 60,
      );
      expect(landHeight(shore.x, shore.y), p.id).toBeGreaterThan(0.5);
      expect(dist(shore, p.chart), p.id).toBeLessThan(1500);
    }
  });

  it('keeps the steamer lanes in water deeper than a laden freighter draws', () => {
    for (const route of FREIGHTER_ROUTES) {
      for (let i = 1; i < route.length; i++) {
        const a = route[i - 1] as Chart;
        const b = route[i] as Chart;
        const n = Math.ceil(dist(a, b) / 50);
        for (let k = 0; k <= n; k++) {
          const x = a.x + ((b.x - a.x) * k) / n;
          const y = a.y + ((b.y - a.y) * k) / n;
          expect(landHeight(x, y), `lane leg ${i} at ${k}/${n}`).toBeLessThan(-7);
        }
      }
    }
  });

  it('starts the schooner in open water off Bayfield', () => {
    const start = chartOf(46.8, -90.797);
    expect(landHeight(start.x, start.y)).toBeLessThan(-createSchooner(0, 0, 0).record.draftFullM);
    expect(landmassAt(start.x, start.y)).toBeUndefined();
  });
});

describe('S7 scale model', () => {
  const terrain = buildTerrain();

  it('shares one height grid across every C', () => {
    const p = chartOf(46.93, -90.567); // Stockton
    const heights = [6, 8, 10].map((c) => terrain.heightfield(c).heightAt(p.x / c, -p.y / c));
    expect(heights[0]).toBeGreaterThan(5);
    for (const h of heights) expect(h).toBeCloseTo(heights[0] as number, 3);
  });

  const { cls } = createSchooner(0, 0, 0).sailing;

  it('moves the ship at v = v_game × R / C', () => {
    // 8 kn at C = 8, R = 24 is ×3: about 12.3 m/s (plan 02 §3.1).
    expect(sceneSpeed(knotsToMs(8), 24, 8)).toBeCloseTo(12.35, 1);
    expect(sceneSpeed(knotsToMs(8), 24, 6)).toBeCloseTo(16.46, 1);
  });

  it('reaches at a working schooner speed in the default breeze', () => {
    // Plan 03 §3.3: a schooner makes 7–8 kn on a beam reach.
    const kn = beamReachSpeed(cls, steadyWind(315, 12)) / knotsToMs(1);
    expect(kn).toBeGreaterThan(6);
    expect(kn).toBeLessThanOrEqual(8);
  });

  it('keeps real travel time independent of C', () => {
    const leg = REFERENCE_LEGS[1];
    if (!leg) throw new Error('missing leg');
    const times = [6, 8, 10].map((c) => {
      const onScreen = dist(leg.from, leg.to) / c;
      return onScreen / sceneSpeed(knotsToMs(7.65), 24, c);
    });
    for (const t of times) expect(t).toBeCloseTo(times[0] as number, 6);
  });

  it('turns tighter as C grows, at the same game speed', () => {
    const at = (c: number): number =>
      turningCircle(cls, knotsToMs(7.65), { compression: c, rate: 24 });
    expect(at(6)).toBeGreaterThan(at(8));
    expect(at(8)).toBeGreaterThan(at(10));
  });

  it('stops the ship at the greybox shore under the plan 02 hazards', () => {
    const c = 8;
    const hf = terrain.heightfield(c);
    const scale = { compression: c, rate: 24 };
    const env = { terrain: greyboxDepth((x, z) => hf.heightAt(x, z)), docks: [], berths: [] };
    // Off Bayfield, heading straight at the shore (west) on a beam reach.
    const wind = steadyWind(360, 12);
    const start = chartOf(46.811, -90.79);
    const { sailing, hazards } = createSchooner(start.x / c, -start.y / c, -Math.PI / 2);
    const s = sailing.state;
    s.sailLevel = s.sailSetting = 3;
    const events: HazardEvent[] = [];
    for (let i = 0; i < 60 * 60; i++) {
      const prev = { x: s.x, z: s.z, heading: s.heading };
      stepSailing(s, IDLE_COMMAND, sailing.cls, wind, 0, scale, 1 / 60);
      stepHazards(
        s,
        hazards.state,
        hazards.cls,
        IDLE_MOORING,
        env,
        prev,
        wind,
        scale,
        1 / 60,
        events,
      );
      expect(hf.heightAt(s.x, s.z)).toBeLessThan(0);
    }
    // Compressed 8×, the Bayfield shore is steep enough to count as rock.
    const hit = events.find((e) => e.kind === 'grounded' || e.kind === 'struck');
    expect(hit).toBeDefined();
    expect(hazards.state.hull).toBeLessThan(hazards.cls.hullHP);
  });

  it('steams freighters along their lanes at R × 9 kn', () => {
    const [f] = createFreighters();
    if (!f) throw new Error('no freighter');
    const before = { ...f.chart };
    stepFreighter(f, 10, 24);
    const moved = dist(before, f.chart);
    expect(moved).toBeCloseTo(9 * (NM / 3600) * 24 * 10, 0);
  });
});
