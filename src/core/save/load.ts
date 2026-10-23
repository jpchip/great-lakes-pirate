import { readRunSlot, type GlpDatabase, type RunKey } from './db';
import { decodeSave } from './decode';
import type { SaveEnvelope } from './envelope';
import { migrateSave } from './migrate';
import type { SavePayload } from './migrations';

/**
 * Load with recovery (plan 16 §6.3): danger snapshot first, then current; on a bad
 * checksum, migration or validation failure, fall back to backup.
 */

export interface LoadedRun<S> {
  state: S;
  envelope: SaveEnvelope;
  /** Which slot the run came from. */
  source: RunKey;
  /** True when the primary slot was bad and the backup was used. */
  recovered: boolean;
}

export class SaveLoadError extends Error {
  override name = 'SaveLoadError';
  constructor(
    message: string,
    /** Raw slot contents, for the "download raw save for bug report" button. */
    readonly raw: Partial<Record<RunKey, unknown>>,
    readonly failures: Partial<Record<RunKey, unknown>>,
  ) {
    super(message);
  }
}

/**
 * `validate` parses the migrated payload into WorldState and throws if it's invalid.
 * It's injected because core/ may not import sim/ types.
 */
export async function loadRun<S>(
  db: GlpDatabase,
  validate: (state: SavePayload) => S,
): Promise<LoadedRun<S> | undefined> {
  const danger = await readRunSlot(db, 'danger');
  const current = await readRunSlot(db, 'current');
  const primary: RunKey | undefined = danger ? 'danger' : current ? 'current' : undefined;
  if (!primary) return undefined;

  const raw: Partial<Record<RunKey, unknown>> = {
    [primary]: primary === 'danger' ? danger : current,
  };
  const failures: Partial<Record<RunKey, unknown>> = {};

  const attempt = (key: RunKey, slot: unknown): LoadedRun<S> | undefined => {
    try {
      const { envelope, state } = decodeSave(slot);
      const migrated = migrateSave(state, envelope.saveVersion);
      return { state: validate(migrated), envelope, source: key, recovered: key !== primary };
    } catch (err) {
      failures[key] = err;
      return undefined;
    }
  };

  const loaded = attempt(primary, raw[primary]);
  if (loaded) return loaded;

  // A bad danger snapshot falls back to current before backup.
  if (primary === 'danger' && current) {
    raw.current = current;
    const fromCurrent = attempt('current', current);
    if (fromCurrent) return { ...fromCurrent, recovered: true };
  }

  const backup = await readRunSlot(db, 'backup');
  if (backup) {
    raw.backup = backup;
    const fromBackup = attempt('backup', backup);
    if (fromBackup) return fromBackup;
  }
  throw new SaveLoadError('No readable save: every slot failed to load', raw, failures);
}
