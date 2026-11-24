import { strFromU8, strToU8 } from 'fflate';
import { decodeSave, SaveCorruptError } from './decode';
import type { SaveEnvelope } from './envelope';
import { migrateSave } from './migrate';
import type { SavePayload } from './migrations';

/**
 * Player save export and import (plan 16 §9). The file is the save envelope (§5.1) with its
 * checksum, as JSON with the compressed payload in base64, so it survives being mailed or
 * copied between machines. Import checks the envelope and the checksum, migrates a save from
 * an older build and validates it before anything is written; a run brought in this way is
 * marked "Transferred" (see db.ts `markTransferred`).
 */

export const RUN_FILE_FORMAT = 'glp-run';
export const RUN_FILE_VERSION = 1;
export const RUN_FILE_EXTENSION = '.glprun';

interface RunFile {
  format: typeof RUN_FILE_FORMAT;
  version: number;
  envelope: Omit<SaveEnvelope, 'payload'> & { payload: string };
}

function toBase64(bytes: Uint8Array): string {
  return btoa(strFromU8(bytes, true));
}

function fromBase64(text: string): Uint8Array {
  return strToU8(atob(text), true);
}

/** The export file's text for a saved run. */
export function serializeRunFile(envelope: SaveEnvelope): string {
  const file: RunFile = {
    format: RUN_FILE_FORMAT,
    version: RUN_FILE_VERSION,
    envelope: { ...envelope, kind: 'current', payload: toBase64(envelope.payload) },
  };
  return JSON.stringify(file);
}

/**
 * Reads an export file back into a save envelope and its WorldState, migrated and validated.
 * Throws SaveCorruptError (or the migration's or `validate`'s error) on anything wrong, with
 * a message for the player.
 */
export function parseRunFile<S>(
  text: string,
  validate: (state: SavePayload) => S,
): { envelope: SaveEnvelope; state: S } {
  let file: unknown;
  try {
    file = JSON.parse(text);
  } catch {
    throw new SaveCorruptError("That file isn't a Great Lakes Pirate run.");
  }
  if (
    typeof file !== 'object' ||
    file === null ||
    (file as Partial<RunFile>).format !== RUN_FILE_FORMAT ||
    typeof (file as Partial<RunFile>).envelope !== 'object'
  ) {
    throw new SaveCorruptError("That file isn't a Great Lakes Pirate run.");
  }
  const f = file as RunFile;
  if (typeof f.version !== 'number' || f.version > RUN_FILE_VERSION) {
    throw new SaveCorruptError('That run was exported by a newer version of the game.');
  }
  let payload: Uint8Array;
  try {
    payload = fromBase64(String(f.envelope.payload));
  } catch {
    throw new SaveCorruptError('That run file is damaged.');
  }
  let decoded;
  try {
    decoded = decodeSave({ ...f.envelope, kind: 'current', payload });
  } catch {
    throw new SaveCorruptError('That run file is damaged.');
  }
  const migrated = migrateSave(decoded.state, decoded.envelope.saveVersion);
  return { envelope: decoded.envelope, state: validate(migrated) };
}

/** `Captain-Ole-Haugen_Lizzie-Bell_1900-06-12.glprun`, safe on every file system. */
export function runFileName(captain: string, shipName: string, gameDate: string): string {
  const clean = (s: string): string =>
    s
      .normalize('NFKD')
      .replace(/[^\w\s-]/g, '')
      .trim()
      .replace(/\s+/g, '-')
      .slice(0, 40) || 'run';
  return `Captain-${clean(captain)}_${clean(shipName)}_${clean(gameDate)}${RUN_FILE_EXTENSION}`;
}
