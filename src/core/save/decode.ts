import { strFromU8, unzlibSync } from 'fflate';
import { z } from 'zod';
import { crc32Hex } from './checksum';
import { SAVE_MAGIC, type SaveEnvelope } from './envelope';
import type { SavePayload } from './migrations';

export class SaveCorruptError extends Error {
  override name = 'SaveCorruptError';
}

export const saveEnvelopeSchema: z.ZodType<SaveEnvelope> = z.object({
  magic: z.literal(SAVE_MAGIC),
  saveVersion: z.number().int().min(1),
  gameVersion: z.string(),
  runId: z.string().min(1),
  seed: z.string(),
  createdAt: z.iso.datetime(),
  savedAt: z.iso.datetime(),
  playTimeMs: z.number().nonnegative(),
  kind: z.enum(['current', 'backup', 'danger']),
  checksum: z.string().regex(/^[0-9a-f]{8}$/),
  payload: z.instanceof(Uint8Array),
});

/**
 * Check the envelope, the checksum and the JSON. Throws SaveCorruptError on any failure.
 * Migration and schema validation happen afterwards (see load.ts).
 */
export function decodeSave(raw: unknown): { envelope: SaveEnvelope; state: SavePayload } {
  const parsed = saveEnvelopeSchema.safeParse(raw);
  if (!parsed.success) throw new SaveCorruptError(`Bad save envelope: ${parsed.error.message}`);
  const envelope = parsed.data;
  if (crc32Hex(envelope.payload) !== envelope.checksum) {
    throw new SaveCorruptError('Save checksum mismatch');
  }
  let state: unknown;
  try {
    state = JSON.parse(strFromU8(unzlibSync(envelope.payload)));
  } catch (err) {
    throw new SaveCorruptError(`Save payload unreadable: ${String(err)}`);
  }
  if (typeof state !== 'object' || state === null || Array.isArray(state)) {
    throw new SaveCorruptError('Save payload is not an object');
  }
  return { envelope, state: state as SavePayload };
}
