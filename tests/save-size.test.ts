import { describe, expect, it } from 'vitest';
import { encodeSave, type SaveHeader } from '../src/core/save/envelope';
import { decodeSave } from '../src/core/save/decode';
import { buildWorstCaseState } from '../bench/s6/worst-case';

const header: SaveHeader = {
  gameVersion: '0.0.0',
  runId: 'run-s6',
  seed: 's6-worst-case',
  createdAt: '1900-05-07T00:00:00.000Z',
  savedAt: '1900-05-07T00:00:00.000Z',
  playTimeMs: 0,
  kind: 'current',
};

// Spike S6 size target (plan 16 §5.4 and its S6 results). Timings live in
// `npm run bench:save`; only the deterministic size is checked here.
describe('worst-case save size', () => {
  it('compresses within the 250 KB target with packed hideout pieces', () => {
    const envelope = encodeSave(buildWorstCaseState(), header);
    expect(envelope.payload.length).toBeLessThan(250_000);
  });

  it('round-trips the worst-case state', () => {
    const state = buildWorstCaseState();
    expect(decodeSave(encodeSave(state, header)).state).toEqual(JSON.parse(JSON.stringify(state)));
  });
});
