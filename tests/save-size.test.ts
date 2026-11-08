import { describe, expect, it } from 'vitest';
import { encodeSave, type SaveHeader } from '../src/core/save/envelope';
import { decodeSave } from '../src/core/save/decode';
import { buildWorstCaseState } from '../bench/s6/worst-case';
import { EventBus } from '../src/core/events';
import { SECONDS_PER_GAME_DAY, WORLD_TICK_GAME_SECONDS } from '../src/core/time';
import { attachEconomy } from '../src/gameplay/economy';
import { attachLaw, devWitness } from '../src/gameplay/law';
import { attachPapers } from '../src/gameplay/papers';
import type { GameContext, GameEvents } from '../src/modes/context';
import { gameLaw } from '../src/sim/law/defs';
import { LOGBOOK_MAX } from '../src/sim/run/record';
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

// Phase 5 criterion 12 (plan 06 §14.3): a run a game month into a life of crime, with heat
// in every region, reports on their way, the papers' kept editions and a full logbook.
describe('a Phase 5 run save size', () => {
  it('compresses under 20 KB a month into a life of crime', () => {
    const state = createNewRun({
      name: 'Ole Haugen',
      shipName: 'Lizzie Bell',
      background: 'saloon_keeper',
      portrait: allPortraits()[0]?.id ?? 'portrait.weathered',
      seed: 'size-check',
    });
    const events = new EventBus<GameEvents>();
    const ctx = { state, events } as unknown as GameContext;
    const economy = attachEconomy(ctx, undefined);
    const law = attachLaw(ctx, 'size-check');
    attachPapers({
      ctx,
      law,
      seed: 'size-check',
      goodName: (g) => economy.defs.goods.get(g)?.name ?? g,
      onFrontPage: () => undefined,
    });
    const crimes = ['crime.smuggler_deal', 'crime.contraband', 'crime.hot_goods'];
    const start = state.environment.clock.gameSeconds;
    for (let day = 0; day < 30; day++) {
      gameLaw().regions.forEach((r, k) => {
        law.commit({
          crime: crimes[(day + k) % crimes.length] ?? 'crime.contraband',
          region: r.id,
          witnesses: [devWitness('keeper', 'ship'), devWitness('crew', 'schooner')],
        });
      });
      const end = start + (day + 1) * SECONDS_PER_GAME_DAY;
      while (state.environment.clock.gameSeconds < end) {
        state.environment.clock.gameSeconds += WORLD_TICK_GAME_SECONDS;
        events.emit('WorldTick', { gameSeconds: state.environment.clock.gameSeconds });
      }
    }
    state.logbook = Array.from({ length: LOGBOOK_MAX }, (_, i) => ({
      at: i * 3600,
      text: `Made Bayfield's city dock and sold 12 CU of whiskey to the receiver (${i})`,
    }));
    expect(Object.keys(state.newspapers?.editions ?? {}).length).toBeGreaterThan(0);
    const envelope = encodeSave(state, header);
    console.log(`a month of crime: ${(envelope.payload.length / 1024).toFixed(1)} KB compressed`);
    expect(envelope.payload.length).toBeLessThan(20_000);
  });
});
