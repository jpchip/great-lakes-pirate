import { performance } from 'node:perf_hooks';
import { expect, it } from 'vitest';
import { LIGHTHOUSES, type PlacedLight } from '../../src/sim/lighthouses';
import { keeperObservers, shipObserver, type Observer } from '../../src/sim/law/observers';
import {
  createMeter,
  landBetween,
  sight,
  stepMeter,
  SPOTTED,
  type Conditions,
  type SkyLight,
  type Target,
} from '../../src/sim/law/perception';

/**
 * The detection bench (plan 06 §14.3 criterion 4): how far each kind of watcher makes out
 * the T1, and how long they take to spot her 1 km off, across the moon's phases with the
 * lantern lit and doused, by day, and in fog. Then what a look costs. Prints one table.
 */

const DEG = Math.PI / 180;
const night = (illum: number, cloud01 = 0): SkyLight => ({
  sunElevationRad: -30 * DEG,
  moonElevationRad: illum > 0 ? 35 * DEG : -20 * DEG,
  moonIllumination01: illum,
  cloud01,
});
const SKIES: [string, SkyLight, number][] = [
  [
    'noon',
    { sunElevationRad: 50 * DEG, moonElevationRad: -20 * DEG, moonIllumination01: 0, cloud01: 0 },
    25_000,
  ],
  [
    'dusk (sun -6°)',
    { sunElevationRad: -6 * DEG, moonElevationRad: -20 * DEG, moonIllumination01: 0, cloud01: 0 },
    25_000,
  ],
  ['new moon', night(0), 25_000],
  ['quarter moon', night(0.5), 25_000],
  ['full moon', night(1), 25_000],
  ['full moon, overcast', night(1, 1), 25_000],
  ['full moon, fog 600 m', night(1), 600],
];

const def = LIGHTHOUSES.find((l) => l.id === 'light.raspberry');
if (!def) throw new Error('no Raspberry light');
const placed: PlacedLight = { def, x: 0, z: 0, groundM: 12, seaward: 0 };

function watchers(hour: number, day: number): [string, Observer][] {
  const [keeper] = keeperObservers([placed], hour, day);
  if (!keeper) throw new Error('no keeper');
  return [
    ['Raspberry keeper', keeper],
    [
      'freighter crew',
      shipObserver({ id: 'f', classId: 'ship.ore_freighter', name: 'f', x: 0, z: 0 }, day),
    ],
    [
      'cutter lookout',
      shipObserver({ id: 'c', classId: 'ship.cutter_morrill', name: 'c', x: 0, z: 0 }, day),
    ],
  ];
}

function toSpot(target: Target, cond: Conditions, o: Observer, d: number): number {
  const m = createMeter();
  const s = sight(target, cond, o, 'sky', d);
  for (let t = 0; t < 300; t += 0.25) {
    stepMeter(m, s, o.vigilance, 0.25);
    if (m.value >= SPOTTED) return t + 0.25;
  }
  return Infinity;
}

it('detection bench', () => {
  const rows: Record<string, string | number>[] = [];
  for (const [skyName, sky, fogM] of SKIES) {
    const day = sky.sunElevationRad > 0 ? 1 : 0;
    const cond: Conditions = { sky, fogM, rain01: 0 };
    for (const [who, o] of watchers(day ? 12 : 23, day)) {
      for (const lit of [false, true]) {
        if (day && lit) continue;
        const target: Target = { tier: 1, sails01: 1, lanternLit: lit };
        const s = sight(target, cond, o, 'sky', 1000);
        const t1 = toSpot(target, cond, o, 1000);
        rows.push({
          sky: skyName,
          watcher: who,
          lantern: lit ? 'lit' : 'dark',
          'hull m': Math.round(s.hullM),
          'lantern m': Math.round(s.lanternM),
          'spot @1 km s': Number.isFinite(t1) ? t1 : 'never',
        });
      }
    }
  }
  console.table(rows);

  // §14.3 criterion 4: dark on a moonless night vs. lit under a full moon, past the light.
  const keeper = watchers(23, 0)[0]?.[1];
  if (!keeper) throw new Error('no keeper');
  const dark = sight(
    { tier: 1, sails01: 1, lanternLit: false },
    { sky: night(0), fogM: 25_000, rain01: 0 },
    keeper,
    'sky',
    0,
  );
  const lit = sight(
    { tier: 1, sails01: 1, lanternLit: true },
    { sky: night(1), fogM: 25_000, rain01: 0 },
    keeper,
    'sky',
    0,
  );
  console.log(
    `criterion 4: dark new moon seen at ${Math.round(dark.rangeM)} m, lit full moon at ${Math.round(lit.rangeM)} m`,
  );
  expect(lit.rangeM / dark.rangeM).toBeGreaterThan(5);

  // What a look costs: 7 keepers and 5 ships, with a line-of-sight walk each, 10k times.
  const heightAt = (x: number, z: number) => Math.sin(x / 300) * Math.cos(z / 300) * 30 - 10;
  const obs = [...Array(12).keys()].map((k) => ({
    ...keeper,
    x: Math.cos(k) * 3000,
    z: Math.sin(k) * 3000,
  }));
  const cond: Conditions = { sky: night(0.5), fogM: 25_000, rain01: 0 };
  const meters = obs.map(() => createMeter());
  const N = 10_000;
  const t0 = performance.now();
  for (let i = 0; i < N; i++) {
    obs.forEach((o, k) => {
      const blocked = landBetween(heightAt, { x: o.x, y: o.eyeM, z: o.z }, { x: 0, y: 6, z: 0 });
      const s = sight({ tier: 1, sails01: 1, lanternLit: true }, cond, o, 'sky', 3000);
      const m = meters[k];
      if (m && !blocked) stepMeter(m, s, o.vigilance, 0.25);
    });
  }
  const perLookMs = (performance.now() - t0) / N;
  console.log(`one look at 12 watchers: ${perLookMs.toFixed(4)} ms (4 looks a second)`);
  expect(perLookMs).toBeLessThan(0.5);
});
