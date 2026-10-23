import { describe, expect, it } from 'vitest';
import type { Chart } from '../src/core/coords';
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
  DEFAULT_HELM,
  stepHelm,
  turningCircle,
  visualSpeed,
  type ShipState,
} from '../src/debug/scale-greybox/helm';
import { snapToShore } from '../src/debug/scale-greybox/setpieces';
import { buildTerrain } from '../src/debug/scale-greybox/terrain';

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
    expect(landHeight(start.x, start.y)).toBeLessThan(-DEFAULT_HELM.draftM);
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

  it('moves the ship at v = v_game × R / C', () => {
    // 8 kn at C = 8, R = 24 is ×3: about 12.3 m/s (plan 02 §3.1).
    expect(visualSpeed(8, { compression: 8, rate: 24 })).toBeCloseTo(12.35, 1);
    expect(visualSpeed(8, { compression: 6, rate: 24 })).toBeCloseTo(16.46, 1);
  });

  it('keeps real travel time independent of C', () => {
    const leg = REFERENCE_LEGS[1];
    if (!leg) throw new Error('missing leg');
    const times = [6, 8, 10].map((c) => {
      const onScreen = dist(leg.from, leg.to) / c;
      return onScreen / visualSpeed(7.65, { compression: c, rate: 24 });
    });
    for (const t of times) expect(t).toBeCloseTo(times[0] as number, 6);
  });

  it('turns tighter as C grows, at the same game speed', () => {
    const at = (c: number): number =>
      turningCircle(7.65, DEFAULT_HELM, { compression: c, rate: 24 });
    expect(at(6)).toBeGreaterThan(at(8));
    expect(at(8)).toBeGreaterThan(at(10));
  });

  it('runs aground instead of sailing onto land', () => {
    const c = 8;
    const hf = terrain.heightfield(c);
    // Off Bayfield, heading straight at the shore (west).
    const start = chartOf(46.811, -90.79);
    const ship: ShipState = {
      x: start.x / c,
      z: -start.y / c,
      heading: -Math.PI / 2,
      speedKn: 7,
      sailLevel: 3,
      aground: false,
    };
    const input = { steer: 0, raise: false, lower: false, astern: false };
    for (let i = 0; i < 60 * 120 && !ship.aground; i++) {
      stepHelm(
        ship,
        input,
        DEFAULT_HELM,
        { compression: c, rate: 24 },
        (x, z) => hf.heightAt(x, z),
        1 / 60,
      );
    }
    expect(ship.aground).toBe(true);
    expect(hf.heightAt(ship.x, ship.z)).toBeLessThan(0);
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
