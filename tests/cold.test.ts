import { describe, expect, it } from 'vitest';
import {
  COLD,
  freshClimbOut,
  freshThinIce,
  holdCmFor,
  iceUnderfoot,
  stepClimbOut,
  stepThinIce,
  weakness,
} from '../src/sim/cold/footing';
import {
  feelsLikeC,
  freshWarmth,
  stepWarmth,
  warmAboard,
  warmthStage,
  coldHealthDrainS,
  type WarmthInput,
} from '../src/sim/cold/warmth';
import {
  loadSled,
  sledFree,
  sledKg,
  sledSpeedMul,
  towSled,
  unloadSled,
} from '../src/sim/cold/sled';
import { TrackLog } from '../src/sim/cold/tracks';
import { layRoad, roadDistance, roadOpen, snowLies } from '../src/sim/cold/road';
import { gameSecondsAt } from '../src/sim/ice/season';
import type { CargoStack } from '../src/sim/economy/hold';

const january: WarmthInput = {
  airC: -12,
  windKn: 0,
  precip01: 0,
  swimming: false,
  waterC: 1,
  heat: false,
  indoors: false,
  running: false,
};

describe('ice underfoot', () => {
  it('stands on closed ice, not on open water, floes or slush', () => {
    expect(iceUnderfoot({ coverage: 1, thicknessCm: 20, kind: 'fast' })).toBe(true);
    expect(iceUnderfoot({ coverage: 0, thicknessCm: 0, kind: 'open' })).toBe(false);
    expect(iceUnderfoot({ coverage: 0.9, thicknessCm: 20, kind: 'floes' })).toBe(false);
    expect(iceUnderfoot({ coverage: 1, thicknessCm: 1, kind: 'forming' })).toBe(false);
  });

  it('needs thicker ice with a load behind you', () => {
    expect(holdCmFor(0)).toBe(COLD.ice.holdCm);
    expect(holdCmFor(250)).toBeGreaterThan(COLD.ice.holdCm + 8);
  });

  it('has weak spots, never thinner than its depth allows', () => {
    let min = 1;
    for (let x = 0; x < 2000; x += 7) min = Math.min(min, weakness(x, x * 0.37, 3));
    expect(min).toBeLessThan(0.9);
    expect(min).toBeGreaterThanOrEqual(1 - COLD.ice.weakSpotDepth - 1e-9);
  });
});

describe('thin ice', () => {
  it('cracks, then groans, then breaks, walking on it', () => {
    const s = freshThinIce();
    const stages: string[] = [];
    for (let t = 0; t < 60 && s.stage !== 'broken'; t += 0.1) {
      const up = stepThinIce(s, { thicknessCm: 5, loadKg: 0, gait: 'walk' }, 0.1);
      if (up) stages.push(up);
    }
    expect(stages).toEqual(['cracking', 'groaning', 'broken']);
  });

  it('gives several seconds of warning before it goes', () => {
    const s = freshThinIce();
    let warnedAt: number | undefined;
    let t = 0;
    for (; t < 60 && s.stage !== 'broken'; t += 0.1) {
      if (stepThinIce(s, { thicknessCm: 5, loadKg: 0, gait: 'walk' }, 0.1) === 'cracking') {
        warnedAt = t;
      }
    }
    expect(warnedAt).toBeDefined();
    expect(t - (warnedAt ?? 0)).toBeGreaterThan(2);
  });

  it('holds on sound ice, eases off when you step back, and a sled makes it worse', () => {
    const s = freshThinIce();
    for (let t = 0; t < 30; t += 0.1)
      stepThinIce(s, { thicknessCm: 25, loadKg: 0, gait: 'run' }, 0.1);
    expect(s.stage).toBe('sound');
    for (let t = 0; t < 1.5; t += 0.1)
      stepThinIce(s, { thicknessCm: 8, loadKg: 0, gait: 'walk' }, 0.1);
    const walking = s.stress;
    expect(walking).toBeGreaterThan(0);
    stepThinIce(s, { thicknessCm: undefined, loadKg: 0, gait: 'walk' }, 2);
    expect(s.stress).toBeLessThan(walking);
    // 12 cm holds a man, not a man and a laden sled.
    const laden = freshThinIce();
    stepThinIce(laden, { thicknessCm: 12, loadKg: 0, gait: 'walk' }, 1);
    expect(laden.stress).toBe(0);
    stepThinIce(laden, { thicknessCm: 12, loadKg: 250, gait: 'walk' }, 1);
    expect(laden.stress).toBeGreaterThan(0);
  });

  it('gives a short chance to haul out, and the cold ends it', () => {
    const c = freshClimbOut();
    let r: string | undefined;
    for (let t = 0; t < 5 && !r; t += 0.1) r = stepClimbOut(c, true, 12, 0.1, 0.1);
    expect(r).toBe('out');
    const thin = freshClimbOut();
    let slipped = 0;
    for (let t = 0; t < 4; t += 0.1)
      if (stepClimbOut(thin, true, 3, 0.9, 0.1) === 'slipped') slipped++;
    expect(slipped).toBeGreaterThan(0);
    const idle = freshClimbOut();
    let end: string | undefined;
    for (let t = 0; t < 30 && !end; t += 0.1) end = stepClimbOut(idle, false, 12, 0, 0.1);
    expect(end).toBe('lost');
    expect(idle.inS).toBeCloseTo(COLD.thin.windowS, 0);
  });
});

describe('warmth', () => {
  it('runs down over minutes in January air, faster in wind and wet', () => {
    const minutesToCold = (input: WarmthInput, wet = 0): number => {
      const w = { ...freshWarmth(), wet };
      let t = 0;
      while (w.value > 0 && t < 3600) {
        stepWarmth(w, input, 1);
        t++;
      }
      return t / 60;
    };
    const calm = minutesToCold(january);
    const windy = minutesToCold({ ...january, windKn: 20 });
    const soaked = minutesToCold(january, 1);
    expect(calm).toBeGreaterThan(4);
    expect(calm).toBeLessThan(12);
    expect(windy).toBeLessThan(calm);
    expect(soaked).toBeLessThan(calm / 2);
    expect(feelsLikeC(-12, 20)).toBeLessThan(-20);
  });

  it('warns three times before it runs out, and only then costs health', () => {
    const w = freshWarmth();
    const warned: string[] = [];
    while (w.value > 0) {
      expect(coldHealthDrainS(w)).toBe(0);
      const s = stepWarmth(w, january, 1);
      if (s) warned.push(s);
    }
    expect(warned).toEqual(['chilled', 'cold', 'freezing', 'frozen']);
    expect(coldHealthDrainS(w)).toBeGreaterThan(0);
  });

  it('a swim soaks you and the water is fastest of all; a fire gives it back and dries you', () => {
    const w = freshWarmth();
    stepWarmth(w, { ...january, swimming: true }, 10);
    expect(w.wet).toBe(1);
    expect(w.value).toBeLessThan(95);
    const before = w.value;
    stepWarmth(w, { ...january, heat: true }, 5);
    expect(w.value).toBeGreaterThan(before);
    expect(w.wet).toBeLessThan(1);
  });

  it('freezing rain wets you; summer air costs nothing; aboard warms you', () => {
    const w = freshWarmth();
    stepWarmth(w, { ...january, airC: -1, precip01: 1 }, 20);
    expect(w.wet).toBeGreaterThan(0.2);
    const s = { value: 50, wet: 0 };
    stepWarmth(s, { ...january, airC: 20 }, 10);
    expect(s.value).toBeGreaterThan(50);
    const a = { value: 10, wet: 1 };
    warmAboard(a, 3600);
    expect(a.value).toBeGreaterThan(60);
    expect(a.wet).toBe(0);
    expect(warmthStage(100)).toBe('warm');
  });
});

describe('the sled', () => {
  const value = (g: string): number => (g === 'good.whiskey' ? 2000 : 300);
  const weight = (): number => 0.7;

  it('loads the dearest CU first up to her capacity, and unloads back into the hold', () => {
    const hold: CargoStack[] = [
      { good: 'good.flour', qty: 5, paidCents: 1000 },
      { good: 'good.whiskey', qty: 2 },
      { good: 'good.coal', qty: 4, contract: 'c1' },
    ];
    const sled = { x: 0, z: 0, heading: 0, load: [] as CargoStack[] };
    expect(loadSled(sled, hold, value)).toBe(COLD.sled.capacityCu);
    expect(sled.load[0]?.good).toBe('good.whiskey');
    expect(sledFree(sled)).toBe(0);
    expect(hold.find((h) => h.good === 'good.flour')?.qty).toBe(4);
    expect(hold.find((h) => h.good === 'good.flour')?.paidCents).toBe(800);
    expect(sledKg(sled, weight)).toBeGreaterThan(150);
    expect(sledSpeedMul(sled, weight)).toBeLessThan(1);
    unloadSled(sled, hold);
    expect(sled.load).toEqual([]);
    expect(hold.find((h) => h.good === 'good.flour')?.qty).toBe(5);
    expect(hold.find((h) => h.good === 'good.whiskey')?.qty).toBe(2);
  });

  it('follows on her rope', () => {
    const sled = { x: 0, z: 0, heading: 0, load: [] };
    towSled(sled, 1, 0);
    expect(sled.x).toBe(0);
    towSled(sled, 10, 0);
    expect(sled.x).toBeCloseTo(10 - COLD.sled.ropeM);
    expect(sled.heading).toBeCloseTo(Math.PI / 2);
  });
});

describe('tracks in the snow', () => {
  it('lays a print a stride on snow, none off it', () => {
    const log = new TrackLog();
    for (let x = 0; x <= 10; x += 0.3) log.step(x, 0, Math.PI / 2, 100, true);
    expect(log.prints.length).toBeGreaterThan(8);
    const n = log.prints.length;
    for (let x = 10; x <= 20; x += 0.3) log.step(x, 0, Math.PI / 2, 100, false);
    expect(log.prints.length).toBe(n);
  });

  it('leads a guard along the trail toward you, and snow fills it', () => {
    const log = new TrackLog();
    for (let x = 0; x <= 40; x += 0.3) log.step(x, 0, Math.PI / 2, 100 + x, true);
    const lead = log.lead(1, 1, 200);
    expect(lead).toBeDefined();
    expect(lead?.x ?? 0).toBeGreaterThan(5);
    // A district's watch ignores honest prints.
    expect(log.lead(1, 1, 200, true)).toBeUndefined();
    // Nothing to see far from the trail, nor once it's old or snowed over.
    expect(log.lead(1, 30, 200)).toBeUndefined();
    expect(log.lead(1, 1, 100 + COLD.tracks.freshS + 100)).toBeUndefined();
    log.snow(1, COLD.tracks.fillS + 1);
    expect(log.lead(1, 1, 200)).toBeUndefined();
    log.prune(200);
    expect(log.prints.length).toBe(0);
  });
});

describe('snow and the ice road', () => {
  it('snow lies in a January and not in July', () => {
    const jan = gameSecondsAt(Date.UTC(1901, 0, 25));
    const jul = gameSecondsAt(Date.UTC(1900, 6, 15));
    expect(snowLies('run-1', jan)).toBe(true);
    expect(snowLies('run-1', jul)).toBe(false);
  });

  it('is marked end to end, and open only where the ice is thick enough', () => {
    const road = layRoad({ x: 0, z: 0 }, { x: 0, z: 300 });
    expect(road.markers.length).toBe(Math.round(300 / COLD.road.markerM) + 1);
    expect(roadDistance(road, { x: 5, z: 150 })).toEqual({ d: 5, t: 0.5 });
    expect(roadOpen(road, () => 30)).toBe(true);
    expect(roadOpen(road, (p) => (p.z > 200 ? 8 : 30))).toBe(false);
  });
});
