import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { SaveCorruptError } from '../src/core/save/decode';
import { encodeSave, type SaveHeader } from '../src/core/save/envelope';
import {
  parseRunFile,
  RUN_FILE_EXTENSION,
  runFileName,
  serializeRunFile,
} from '../src/core/save/transfer';
import { createWorldState, parseWorldState } from '../src/sim/world-state';

const header: SaveHeader = {
  gameVersion: '0.9.0',
  runId: 'run-abc',
  seed: 'seed-1',
  createdAt: '2026-11-24T10:00:00.000Z',
  savedAt: '2026-11-24T11:00:00.000Z',
  playTimeMs: 3_600_000,
  kind: 'current',
};

describe('save export and import (plan 16 §9)', () => {
  it('round-trips a run through the export file', () => {
    const state = createWorldState('seed-1');
    const envelope = encodeSave(state, header);
    const text = serializeRunFile(envelope);
    expect(typeof text).toBe('string');
    const back = parseRunFile(text, parseWorldState);
    expect(back.envelope.runId).toBe('run-abc');
    expect(back.envelope.checksum).toBe(envelope.checksum);
    expect(Array.from(back.envelope.payload)).toEqual(Array.from(envelope.payload));
    expect(back.state.player.cargo).toEqual(state.player.cargo);
  });

  it('exports a danger snapshot as a plain current save', () => {
    const envelope = encodeSave(createWorldState('seed-1'), { ...header, kind: 'danger' });
    const back = parseRunFile(serializeRunFile(envelope), parseWorldState);
    expect(back.envelope.kind).toBe('current');
  });

  it('migrates a run exported by an older build', () => {
    const fixture = JSON.parse(
      readFileSync(join(import.meta.dirname, 'fixtures', 'saves', 'v1.json'), 'utf8'),
    ) as { saveVersion: number; state: Record<string, unknown> };
    const envelope = { ...encodeSave(fixture.state as never, header), saveVersion: 1 };
    const back = parseRunFile(serializeRunFile(envelope), parseWorldState);
    expect(back.envelope.saveVersion).toBe(1);
    expect(back.state.player).toBeDefined();
  });

  it('rejects files that are not runs, damaged runs and runs from a newer file format', () => {
    const good = JSON.parse(serializeRunFile(encodeSave(createWorldState('s'), header))) as {
      version: number;
      envelope: { payload: string; checksum: string };
    };
    expect(() => parseRunFile('not json', parseWorldState)).toThrow(SaveCorruptError);
    expect(() => parseRunFile('{"hello":1}', parseWorldState)).toThrow(SaveCorruptError);
    const flipped = {
      ...good,
      envelope: {
        ...good.envelope,
        checksum: good.envelope.checksum === '00000000' ? '00000001' : '00000000',
      },
    };
    expect(() => parseRunFile(JSON.stringify(flipped), parseWorldState)).toThrow(
      'That run file is damaged.',
    );
    const truncated = {
      ...good,
      envelope: { ...good.envelope, payload: good.envelope.payload.slice(0, 40) },
    };
    expect(() => parseRunFile(JSON.stringify(truncated), parseWorldState)).toThrow(
      SaveCorruptError,
    );
    expect(() => parseRunFile(JSON.stringify({ ...good, version: 99 }), parseWorldState)).toThrow(
      'newer version',
    );
  });

  it('names the file after the captain, the ship and the date', () => {
    expect(runFileName('Ole Haugen', 'Lizzie Bell', 'June 12, 1900')).toBe(
      `Captain-Ole-Haugen_Lizzie-Bell_June-12-1900${RUN_FILE_EXTENSION}`,
    );
    expect(runFileName('Ida "Bloody" Berg/q', '', '')).toBe(
      `Captain-Ida-Bloody-Bergq_run_run${RUN_FILE_EXTENSION}`,
    );
  });
});
