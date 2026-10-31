import { describe, expect, it } from 'vitest';
import {
  ModeMachine,
  ModeTransitionError,
  TRANSITIONS,
  type Mode,
  type ModeId,
} from '../src/modes/machine';

function recorder(log: string[]) {
  return (id: ModeId): Mode => ({
    id,
    enter: (from) => log.push(`enter ${id} from ${from ?? '-'}`),
    exit: (to) => log.push(`exit ${id} to ${to}`),
    update: () => log.push(`update ${id}`),
  });
}

describe('ModeMachine', () => {
  it('runs exit then enter on legal transitions', () => {
    const log: string[] = [];
    const make = recorder(log);
    const m = new ModeMachine().register(make('boot')).register(make('mainMenu'));
    m.transition('boot');
    m.transition('mainMenu');
    expect(log).toEqual(['enter boot from -', 'exit boot to mainMenu', 'enter mainMenu from boot']);
    expect(m.mode).toBe('mainMenu');
  });

  it('rejects transitions the plan does not allow', () => {
    const make = recorder([]);
    const m = new ModeMachine().register(make('boot')).register(make('sailing'));
    m.transition('boot');
    expect(() => m.transition('sailing')).toThrow(ModeTransitionError);
  });

  it('lets every in-game mode reach game over and the main menu', () => {
    for (const id of ['chart', 'sailing', 'onFoot', 'build', 'jail'] as const) {
      expect(TRANSITIONS[id]).toContain('gameOver');
      expect(TRANSITIONS[id]).toContain('mainMenu');
    }
  });

  it('pausing overlays stop the gameplay tick and clear on transition', () => {
    const log: string[] = [];
    const make = recorder(log);
    const m = new ModeMachine().register(make('sailing')).register(make('chart'));
    m.transition('sailing');
    m.pushOverlay('journal', false);
    m.update(1 / 60);
    m.pushOverlay('pause');
    m.update(1 / 60);
    expect(log.filter((l) => l.startsWith('update'))).toHaveLength(1);
    expect(m.topOverlay).toBe('pause');
    m.transition('chart');
    expect(m.gameplayPaused).toBe(false);
  });

  it('keeps the loading fade over a mode change (Phase 3 piece D)', () => {
    const m = new ModeMachine().register({ id: 'sailing' }).register({ id: 'chart' });
    m.transition('chart');
    m.pushOverlay('pause');
    m.pushOverlay('loading');
    m.transition('sailing');
    expect(m.topOverlay).toBe('loading');
    expect(m.gameplayPaused).toBe(true);
    m.removeOverlay('loading');
    expect(m.gameplayPaused).toBe(false);
  });
});
