import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { migrateSave, SaveMigrationError } from '../src/core/save/migrate';
import { CURRENT_SAVE_VERSION, migrations } from '../src/core/save/migrations';
import { westernSuperiorChart } from '../src/sim/chart/chart-data';
import { toWorldChart } from '../src/sim/chart/geography';
import { restoreVoyage } from '../src/sim/chart/voyage';
import { resolveStart } from '../src/sim/location';
import { APOSTLES_ID, spawnPose, zoneDef } from '../src/sim/terrain/zones';
import { advanceWeather } from '../src/sim/weather/weather';
import { worldStateSchema } from '../src/sim/world-state';

const fixturesDir = join(import.meta.dirname, 'fixtures', 'saves');
const fixtureFiles = readdirSync(fixturesDir).filter((f) => /^v\d+\.json$/.test(f));

interface Fixture {
  saveVersion: number;
  state: Record<string, unknown>;
}

describe('save migrations', () => {
  it('has a fixture for every save version', () => {
    const versions = fixtureFiles.map((f) => Number(f.slice(1, -5))).sort((a, b) => a - b);
    expect(versions).toEqual(Array.from({ length: CURRENT_SAVE_VERSION }, (_, i) => i + 1));
  });

  it('has a migration for every version step', () => {
    for (let v = 1; v < CURRENT_SAVE_VERSION; v++) expect(migrations[v]).toBeTypeOf('function');
  });

  it.each(fixtureFiles)('migrates %s to the current version and validates', (file) => {
    const fixture = JSON.parse(readFileSync(join(fixturesDir, file), 'utf8')) as Fixture;
    const migrated = migrateSave(fixture.state, fixture.saveVersion);
    expect(() => worldStateSchema.parse(migrated)).not.toThrow();
  });

  it('rejects saves from a newer version', () => {
    expect(() => migrateSave({}, CURRENT_SAVE_VERSION + 1)).toThrow(SaveMigrationError);
  });
});

describe('save migrations (properties)', () => {
  it('leaves a current-version payload unchanged', () => {
    fc.assert(
      fc.property(fc.dictionary(fc.string(), fc.jsonValue()), (state) => {
        expect(migrateSave(state, CURRENT_SAVE_VERSION)).toEqual(state);
      }),
    );
  });
});

describe('v1 → v2: weather joins the save (plan 04 §24)', () => {
  const v1 = (): Record<string, unknown> =>
    (JSON.parse(readFileSync(join(fixturesDir, 'v1.json'), 'utf8')) as Fixture).state;

  it("gives a Phase 1 save a weather that catches up to the run's time", () => {
    const state = worldStateSchema.parse(migrateSave(v1(), 1));
    const { weather, clock } = state.environment;
    expect(weather.systems).toEqual([]);
    expect(weather.tickSeconds).toBeLessThan(clock.gameSeconds);
    expect(advanceWeather(weather, clock.gameSeconds)).toBeGreaterThan(200);
    expect(weather.tickSeconds).toBe(clock.gameSeconds);
    expect(weather.systems.length).toBeGreaterThan(0);
  });

  it("leaves the run's own random stream alone and is deterministic", () => {
    const before = v1();
    const a = migrateSave(v1(), 1);
    const b = migrateSave(v1(), 1);
    expect(a).toEqual(b);
    const env = a['environment'] as { rng: unknown };
    expect(env.rng).toEqual((before['environment'] as { rng: unknown }).rng);
  });
});

describe("v2 → v3: the player's location joins the save (plan 03 §20, piece A)", () => {
  const v2 = (): Record<string, unknown> =>
    (JSON.parse(readFileSync(join(fixturesDir, 'v2.json'), 'utf8')) as Fixture).state;

  it('puts a 0.2.0 run at the Apostles spawn and keeps the rest', () => {
    const before = v2();
    const state = worldStateSchema.parse(migrateSave(v2(), 2));
    expect(state.player.location).toEqual({ mode: 'zone', zoneId: 'zone.apostles' });
    expect(state.environment).toEqual(before['environment']);
    expect(resolveStart(state.player.location)).toEqual({
      zoneId: 'zone.apostles',
      pose: spawnPose(zoneDef(APOSTLES_ID)),
      from: 'spawn',
    });
  });

  it('a v3 save comes back where it was saved', () => {
    const fixture = JSON.parse(readFileSync(join(fixturesDir, 'v3.json'), 'utf8')) as Fixture;
    const state = worldStateSchema.parse(migrateSave(fixture.state, 3));
    expect(resolveStart(state.player.location)).toEqual({
      zoneId: 'zone.apostles',
      pose: { x: 1530.25, z: -412.5, heading: 4.712 },
      from: 'saved',
    });
  });
});

describe('v3 → v4: the voyage joins the save (plan 03 §20, piece D)', () => {
  const v3 = (): Record<string, unknown> =>
    (JSON.parse(readFileSync(join(fixturesDir, 'v3.json'), 'utf8')) as Fixture).state;

  it('gives a v3 run no voyage and keeps the rest', () => {
    const before = v3();
    const state = worldStateSchema.parse(migrateSave(v3(), 3));
    expect(state.voyage).toBeNull();
    expect(state.player).toEqual(before['player']);
    expect(state.environment).toEqual(before['environment']);
  });

  it('a v4 save made mid-voyage comes back on its course, where it was', () => {
    const fixture = JSON.parse(readFileSync(join(fixturesDir, 'v4.json'), 'utf8')) as Fixture;
    const state = worldStateSchema.parse(migrateSave(fixture.state, 4));
    const at = state.player.location;
    expect(at.mode).toBe('chart');
    if (at.mode !== 'chart' || !state.voyage) throw new Error('expected a voyage');
    const geo = westernSuperiorChart();
    const voyage = restoreVoyage(geo, state.voyage);
    if (!voyage) throw new Error('the voyage did not plan again');
    expect(voyage.destinationZone?.id).toBe('zone.apostles');
    expect(voyage.leg).toBe(0);
    // The save keeps the world chart frame.
    const p = toWorldChart(geo, voyage.position);
    expect(p.x).toBeCloseTo(at.chartPos.x, 0);
    expect(p.y).toBeCloseTo(at.chartPos.y, 0);
    // The zone behind the chart is the one the voyage left.
    expect(resolveStart(at).zoneId).toBe('zone.twin_ports');
  });
});
