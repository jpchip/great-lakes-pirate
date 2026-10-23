import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import fc from 'fast-check';
import { beforeEach, describe, expect, it } from 'vitest';
import { crc32Hex } from '../src/core/save/checksum';
import {
  clearDanger,
  deleteRun,
  hasRun,
  openSaveDb,
  readRunSlot,
  writeCurrent,
  type GlpDatabase,
} from '../src/core/save/db';
import { encodeInline } from '../src/core/save/encoder';
import { decodeSave, SaveCorruptError } from '../src/core/save/decode';
import { encodeSave, type SaveEnvelope, type SaveHeader } from '../src/core/save/envelope';
import { loadRun, SaveLoadError } from '../src/core/save/load';
import { CURRENT_SAVE_VERSION } from '../src/core/save/migrations';
import { RunSaver } from '../src/core/save/run-saver';
import { createWorldState, parseWorldState } from '../src/sim/world-state';

const header: SaveHeader = {
  gameVersion: '0.0.0',
  runId: 'run-1',
  seed: 'seed-1',
  createdAt: '1900-05-07T00:00:00.000Z',
  savedAt: '1900-05-07T00:00:00.000Z',
  playTimeMs: 0,
  kind: 'current',
};

function withGameSeconds(gameSeconds: number) {
  const state = createWorldState('seed-1');
  state.environment.clock.gameSeconds = gameSeconds;
  return state;
}

function corrupt(envelope: SaveEnvelope): SaveEnvelope {
  const payload = envelope.payload.slice();
  payload[payload.length >> 1] = (payload[payload.length >> 1] as number) ^ 0xff;
  return { ...envelope, payload };
}

describe('save envelope', () => {
  it('round-trips any JSON state', () => {
    fc.assert(
      fc.property(fc.dictionary(fc.string(), fc.jsonValue()), (state) => {
        const envelope = encodeSave(state, header);
        expect(envelope.magic).toBe('GLP1');
        expect(envelope.saveVersion).toBe(CURRENT_SAVE_VERSION);
        // JSON drops -0 and the like, so compare against the JSON form.
        expect(decodeSave(envelope).state).toEqual(JSON.parse(JSON.stringify(state)));
      }),
    );
  });

  it('is stable: save(load(save(s))) equals save(s)', () => {
    const once = encodeSave(withGameSeconds(1234), header);
    const twice = encodeSave(decodeSave(once).state, header);
    expect(twice.checksum).toBe(once.checksum);
    expect(twice.payload).toEqual(once.payload);
  });

  it('detects any single-byte corruption of the payload', () => {
    const envelope = encodeSave(withGameSeconds(42), header);
    fc.assert(
      fc.property(
        fc.nat(envelope.payload.length - 1),
        fc.integer({ min: 1, max: 255 }),
        (i, flip) => {
          const payload = envelope.payload.slice();
          payload[i] = (payload[i] as number) ^ flip;
          expect(() => decodeSave({ ...envelope, payload })).toThrow(SaveCorruptError);
        },
      ),
    );
  });

  it('rejects truncation, bad magic and non-envelopes', () => {
    const envelope = encodeSave(withGameSeconds(1), header);
    const truncated = envelope.payload.slice(0, 5);
    expect(() =>
      decodeSave({ ...envelope, payload: truncated, checksum: crc32Hex(truncated) }),
    ).toThrow(SaveCorruptError);
    expect(() => decodeSave({ ...envelope, magic: 'NOPE' })).toThrow(SaveCorruptError);
    expect(() => decodeSave('hello')).toThrow(SaveCorruptError);
  });

  it('computes the standard CRC-32', () => {
    expect(crc32Hex(new TextEncoder().encode('123456789'))).toBe('cbf43926');
  });
});

describe('IndexedDB run store', () => {
  let db: GlpDatabase;

  beforeEach(async () => {
    // A fresh database per test.
    globalThis.indexedDB = new IDBFactory();
    db = await openSaveDb();
  });

  it('round-trips a WorldState through IndexedDB', async () => {
    expect(await loadRun(db, parseWorldState)).toBeUndefined();
    const saver = new RunSaver(db, encodeInline, { ...header });
    const state = withGameSeconds(3600);
    await saver.save(state);

    const loaded = await loadRun(db, parseWorldState);
    expect(loaded?.state).toEqual(state);
    expect(loaded).toMatchObject({ source: 'current', recovered: false });
    expect(loaded?.envelope.runId).toBe('run-1');
    expect(await hasRun(db)).toBe(true);
  });

  it('moves the previous current to backup in the same write', async () => {
    const saver = new RunSaver(db, encodeInline, { ...header });
    await saver.save(withGameSeconds(1));
    await saver.save(withGameSeconds(2));
    const backup = decodeSave(await readRunSlot(db, 'backup'));
    expect(backup.envelope.kind).toBe('backup');
    expect(backup.state).toEqual(withGameSeconds(1));
  });

  it('writes saves in the order they were requested', async () => {
    const saver = new RunSaver(db, encodeInline, { ...header });
    await Promise.all([1, 2, 3].map((s) => saver.save(withGameSeconds(s))));
    expect((await loadRun(db, parseWorldState))?.state.environment.clock.gameSeconds).toBe(3);
  });

  it('recovers from a corrupt current save using the backup', async () => {
    const saver = new RunSaver(db, encodeInline, { ...header });
    await saver.save(withGameSeconds(10));
    await saver.save(withGameSeconds(20));
    const current = (await readRunSlot(db, 'current')) as SaveEnvelope;
    await db.put('run', corrupt(current), 'current');

    const loaded = await loadRun(db, parseWorldState);
    expect(loaded).toMatchObject({ source: 'backup', recovered: true });
    expect(loaded?.state.environment.clock.gameSeconds).toBe(10);
  });

  it('falls back to backup when the current save fails validation', async () => {
    await writeCurrent(db, encodeSave(withGameSeconds(5), header));
    await writeCurrent(db, encodeSave({ player: 'not an object' }, header));
    expect(await loadRun(db, parseWorldState)).toMatchObject({ source: 'backup' });
  });

  it('throws with the raw slots when nothing is readable', async () => {
    const current = encodeSave(withGameSeconds(1), header);
    await db.put('run', corrupt(current), 'current');
    const err = await loadRun(db, parseWorldState).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(SaveLoadError);
    expect((err as SaveLoadError).raw.current).toBeDefined();
    // The run is never silently deleted.
    expect(await readRunSlot(db, 'current')).toBeDefined();
  });

  it('resumes from the danger snapshot until it is cleared', async () => {
    const saver = new RunSaver(db, encodeInline, { ...header });
    await saver.save(withGameSeconds(100));
    await saver.save(withGameSeconds(200), 'danger');
    expect(await loadRun(db, parseWorldState)).toMatchObject({ source: 'danger' });

    await clearDanger(db);
    expect(await loadRun(db, parseWorldState)).toMatchObject({ source: 'current' });
  });

  it('deletes every run slot at run end', async () => {
    const saver = new RunSaver(db, encodeInline, { ...header });
    await saver.save(withGameSeconds(1));
    await saver.save(withGameSeconds(2));
    await saver.save(withGameSeconds(3), 'danger');
    await deleteRun(db);
    expect(await hasRun(db)).toBe(false);
    expect(await readRunSlot(db, 'backup')).toBeUndefined();
  });

  it('carries play time across sessions', async () => {
    let now = 1_000;
    const saver = new RunSaver(db, encodeInline, { ...header }, 5_000, () => now);
    now += 2_000;
    const envelope = await saver.save(withGameSeconds(1));
    expect(envelope.playTimeMs).toBe(7_000);
  });
});
