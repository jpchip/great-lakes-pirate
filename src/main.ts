import { EventBus } from './core/events';
import { InputMapper } from './core/input';
import { createLoop } from './core/loop';
import { Rng } from './core/rng';
import { openSaveDb } from './core/save/db';
import { createWorkerEncoder } from './core/save/encoder';
import { loadRun } from './core/save/load';
import { RunSaver } from './core/save/run-saver';
import { cloneTransform, createGameWorld } from './gameplay/ecs';
import type { GameContext, GameEvents } from './modes/context';
import { ModeMachine } from './modes/machine';
import { createSailingMode, type SailingView } from './modes/sailing';
import { createTestScene } from './render/test-scene';
import { createWorldState, parseWorldState, type WorldState } from './sim/world-state';

/** Periodic autosave while safe (plan 16 §4.1). */
const AUTOSAVE_INTERVAL_MS = 2 * 60_000;

type SaveStatus = 'created' | 'loaded' | 'recovered' | 'unavailable' | 'error';

interface OpenedRun {
  state: WorldState;
  saver: RunSaver | undefined;
  status: SaveStatus;
}

/** Continue the run in IndexedDB, or start a new one (plan 16 §3, §6.3). */
async function openRun(): Promise<OpenedRun> {
  let db;
  try {
    db = await openSaveDb();
  } catch (err) {
    // Session-only play when IndexedDB is unavailable (plan 16 §8).
    console.warn('IndexedDB unavailable; this run will not be saved', err);
    return {
      state: createWorldState(crypto.randomUUID()),
      saver: undefined,
      status: 'unavailable',
    };
  }

  const encoder = createWorkerEncoder();
  try {
    const loaded = await loadRun(db, parseWorldState);
    if (loaded) {
      const { runId, seed, createdAt, playTimeMs } = loaded.envelope;
      const run = { runId, seed, createdAt, gameVersion: __GAME_VERSION__ };
      return {
        state: loaded.state,
        saver: new RunSaver(db, encoder, run, playTimeMs),
        status: loaded.recovered ? 'recovered' : 'loaded',
      };
    }
  } catch (err) {
    // Never silently delete an unreadable run (plan 16 §6.3); play this session unsaved.
    console.warn('Could not load the saved run', err);
    return { state: createWorldState(crypto.randomUUID()), saver: undefined, status: 'error' };
  }

  const seed = crypto.randomUUID();
  const run = {
    runId: crypto.randomUUID(),
    seed,
    createdAt: new Date().toISOString(),
    gameVersion: __GAME_VERSION__,
  };
  const state = createWorldState(seed);
  const saver = new RunSaver(db, encoder, run);
  await saver.save(state);
  return { state, saver, status: 'created' };
}

async function boot(): Promise<void> {
  const container = document.getElementById('app');
  if (!container) throw new Error('Missing #app container');

  // `?renderer=null` boots without WebGL. CI has no GPU, so its smoke test uses this
  // (plan 01 §9); rendering is checked locally.
  const rendererKind = new URLSearchParams(window.location.search).get('renderer');
  document.body.dataset['renderer'] = rendererKind === 'null' ? 'null' : 'webgl';

  const machine = new ModeMachine();
  machine.onTransition((_, to) => (document.body.dataset['mode'] = to));
  machine.register({ id: 'boot' }).transition('boot');

  const { state, saver, status } = await openRun();
  document.body.dataset['save'] = status;
  if (saver) document.body.dataset['runId'] = saver.run.runId;

  const input = new InputMapper();
  input.attach(window);
  const ctx: GameContext = {
    state,
    world: createGameWorld(),
    rng: Rng.fromState(state.environment.rng),
    input,
    events: new EventBus<GameEvents>(),
  };

  // Placeholder schooner until the ship slice and sailing controller land (plan 02).
  const shipTransform = { position: { x: 0, y: 0, z: 0 }, heading: 0 };
  ctx.world.add({
    id: 'ship.player',
    transform: shipTransform,
    previousTransform: cloneTransform(shipTransform),
    bob: { amplitude: 0.15, frequency: 0.2, phase: 0 },
    model: 'schooner',
    playerControlled: true,
  });

  const view: SailingView | undefined =
    rendererKind === 'null' ? undefined : createTestScene(container, ctx.world);

  machine
    .register({ id: 'mainMenu', enter: () => (input.context = 'menu') })
    .register(createSailingMode(ctx, view));

  const saveNow = (): void => {
    if (!saver) return;
    state.environment.rng = ctx.rng.getState();
    saver.save(state).catch((err: unknown) => console.error('Autosave failed', err));
  };
  // Phase 0 has no danger states yet, so every moment is safe to save (plan 16 §4.2).
  window.setInterval(saveNow, AUTOSAVE_INTERVAL_MS);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') saveNow();
  });
  window.addEventListener('pagehide', saveNow);

  const loop = createLoop({
    tick(dt) {
      machine.update(dt);
      input.endTick();
    },
    frame(alpha, frameSeconds) {
      machine.render(alpha, frameSeconds);
    },
  });

  // No menu UI yet: go straight through the main menu into the saved run.
  machine.transition('mainMenu');
  machine.transition('sailing');
  loop.start();
}

boot().catch((err: unknown) => {
  console.error(err);
  document.body.dataset['boot'] = 'failed';
});
