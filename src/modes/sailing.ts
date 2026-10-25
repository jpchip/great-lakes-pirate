import { dayAndHour, advanceClock, R_SAILING } from '../core/time';
import { buoyancySystem } from '../gameplay/buoyancy';
import { bobSystem, snapshotTransforms, velocitySystem } from '../gameplay/ecs';
import type { GameContext } from './context';
import type { Mode } from './machine';

const ORIGIN = { x: 0, z: 0 };

export interface SailingView {
  /** `seaTime` is the wave clock at this frame, between the last two ticks. */
  render(alpha: number, seaTime: number, frameSeconds: number): void;
}

/**
 * Sailing mode (Phase 0 placeholder): runs the clock at R = 24, the world tick and the
 * entity systems. The real sailing controller lands with plan 02.
 */
export function createSailingMode(ctx: GameContext, view?: SailingView): Mode {
  let elapsed = 0;
  let lastDt = 0;

  return {
    id: 'sailing',
    enter() {
      ctx.input.context = 'sailing';
    },
    update(dt) {
      snapshotTransforms(ctx.world);
      elapsed += dt;
      lastDt = dt;
      ctx.sea.time += dt;

      const clock = ctx.state.environment.clock;
      const dayBefore = dayAndHour(clock.gameSeconds).day;
      const worldTicks = advanceClock(clock, dt, R_SAILING);
      for (let i = 0; i < worldTicks; i++) {
        ctx.events.emit('WorldTick', { gameSeconds: clock.gameSeconds });
      }
      const dayAfter = dayAndHour(clock.gameSeconds).day;
      if (dayAfter !== dayBefore) ctx.events.emit('DayChanged', { day: dayAfter });

      // The sea follows the wind; anchor it on the player so the surface never jumps there.
      const player = ctx.world.with('playerControlled', 'transform').first;
      ctx.weather.tick(clock.gameSeconds, player?.transform.position ?? ORIGIN, ctx.sea);

      velocitySystem(ctx.world, dt);
      bobSystem(ctx.world, elapsed);
      buoyancySystem(ctx.world, ctx.sea, dt);
    },
    render(alpha, frameSeconds) {
      view?.render(alpha, ctx.sea.time - (1 - alpha) * lastDt, frameSeconds);
    },
  };
}
