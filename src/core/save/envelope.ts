import { strToU8, zlibSync } from 'fflate';
import { crc32Hex } from './checksum';
import { CURRENT_SAVE_VERSION, type SavePayload } from './migrations';

/**
 * The save envelope (plan 16 §5.1): metadata around an fflate-compressed JSON payload
 * of WorldState, with a checksum so corruption is caught before the payload is parsed.
 *
 * Encoding stays free of zod so the save worker bundle stays small; decode.ts validates.
 */

export const SAVE_MAGIC = 'GLP1';

export type SaveKind = 'current' | 'backup' | 'danger';

export interface SaveEnvelope {
  magic: typeof SAVE_MAGIC;
  /** Schema version of the WorldState payload. */
  saveVersion: number;
  gameVersion: string;
  runId: string;
  seed: string;
  /** ISO timestamps. */
  createdAt: string;
  savedAt: string;
  playTimeMs: number;
  kind: SaveKind;
  /** CRC-32 of `payload`, 8 hex digits. */
  checksum: string;
  /** zlib-compressed JSON of WorldState. */
  payload: Uint8Array;
}

/** The run metadata the caller supplies; the rest is computed when encoding. */
export type SaveHeader = Pick<
  SaveEnvelope,
  'gameVersion' | 'runId' | 'seed' | 'createdAt' | 'savedAt' | 'playTimeMs' | 'kind'
>;

/** Stringify, compress and checksum. Pure, so it runs in the save worker (plan 16 §6.2). */
export function encodeSave(state: SavePayload, header: SaveHeader): SaveEnvelope {
  const payload = zlibSync(strToU8(JSON.stringify(state)), { level: 6 });
  return {
    magic: SAVE_MAGIC,
    saveVersion: CURRENT_SAVE_VERSION,
    ...header,
    checksum: crc32Hex(payload),
    payload,
  };
}
