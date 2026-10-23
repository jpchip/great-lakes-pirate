import { CURRENT_SAVE_VERSION, migrations, type SavePayload } from './migrations';

export class SaveMigrationError extends Error {
  override name = 'SaveMigrationError';
}

/** Run every migration from `fromVersion` up to the current save version, in order. */
export function migrateSave(
  state: SavePayload,
  fromVersion: number,
  toVersion: number = CURRENT_SAVE_VERSION,
): SavePayload {
  if (!Number.isInteger(fromVersion) || fromVersion < 1) {
    throw new SaveMigrationError(`Invalid saveVersion ${fromVersion}`);
  }
  if (fromVersion > toVersion) {
    throw new SaveMigrationError(
      `Save is from a newer version (${fromVersion}) than this build supports (${toVersion})`,
    );
  }

  let current = state;
  for (let v = fromVersion; v < toVersion; v++) {
    const step = migrations[v];
    if (!step) throw new SaveMigrationError(`Missing migration v${v} → v${v + 1}`);
    current = step(current);
  }
  return current;
}
