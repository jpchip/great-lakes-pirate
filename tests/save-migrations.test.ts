import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { migrateSave, SaveMigrationError } from '../src/core/save/migrate';
import { CURRENT_SAVE_VERSION, migrations } from '../src/core/save/migrations';
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

describe('v1 → v2: weather joins the save (plan 04 §23)', () => {
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
