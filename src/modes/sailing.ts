import { dayAndHour, advanceClock, R_SAILING } from '../core/time';
import { bobSystem, snapshotTransforms, velocitySystem } from '../gameplay/ecs';
import type { GameContext } from './context';
import type { Mode } from './machine';

export interface SailingView {
  render(alpha: number): void;
}

/**
 * Sailing mode (Phase 0 placeholder): runs the clock at R = 24, the world tick and the
 * entity systems. The real sailing controller lands with plan 02.
 */
export function createSailingMode(ctx: GameContext, view?: SailingView): Mode {
  let elapsed = 0;

  return {
    id: 'sailing',
    enter() {
      ctx.input.context = 'sailing';
    },
    update(dt) {
      snapshotTransforms(ctx.world);
      elapsed += dt;

      const clock = ctx.state.environment.clock;
      const dayBefore = dayAndHour(clock.gameSeconds).day;
      const worldTicks = advanceClock(clock, dt, R_SAILING);
      for (let i = 0; i < worldTicks; i++) {
        ctx.events.emit('WorldTick', { gameSeconds: clock.gameSeconds });
      }
      const dayAfter = dayAndHour(clock.gameSeconds).day;
      if (dayAfter !== dayBefore) ctx.events.emit('DayChanged', { day: dayAfter });

      velocitySystem(ctx.world, dt);
      bobSystem(ctx.world, elapsed);
    },
    render(alpha) {
      view?.render(alpha);
    },
  };
}
