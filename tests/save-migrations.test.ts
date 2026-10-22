import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { migrateSave, SaveMigrationError } from '../src/core/save/migrate';
import { CURRENT_SAVE_VERSION, migrations } from '../src/core/save/migrations';
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
