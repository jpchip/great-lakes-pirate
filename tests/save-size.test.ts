import { describe, expect, it } from 'vitest';
import { encodeSave, type SaveHeader } from '../src/core/save/envelope';
import { decodeSave } from '../src/core/save/decode';
import { buildWorstCaseState } from '../bench/s6/worst-case';
import { allPortraits } from '../src/sim/character/backgrounds';
import { createNewRun } from '../src/sim/character/new-run';
import { BACKGROUNDS } from '../src/sim/world-state';

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

// Phase 4 criterion 10 (plan 05 §16.3): a new run's save, with the Phase 4 slices filled in
// (markets, ledger, First Week), sits well inside the plan 16 budget.
describe('a new run save size', () => {
  it.each(BACKGROUNDS)('a new %s run compresses under 10 KB', (background) => {
    const state = createNewRun({
      name: 'Ole Haugen',
      shipName: 'Lizzie Bell',
      background,
      portrait: allPortraits()[0]?.id ?? 'portrait.weathered',
      seed: 'size-check',
    });
    const envelope = encodeSave(state, header);
    expect(envelope.payload.length).toBeLessThan(10_000);
  });
});
