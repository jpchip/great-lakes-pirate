import { advanceClock, dayAndHour, R_ON_FOOT } from '../core/time';
import type { Transform } from '../gameplay/ecs';
import {
  createCharacter,
  stepCharacter,
  type CharacterState,
  type ControllerParams,
  DEFAULT_CONTROLLER,
  type OnFootZone,
} from '../gameplay/onfoot/controller';
import type { GameContext } from './context';
import type { Mode } from './machine';

export interface OnFootView {
  render(alpha: number, frameSeconds: number): void;
}

export interface OnFootMode extends Mode {
  readonly character: CharacterState;
  /** The character's transform at the previous tick, for render interpolation. */
  readonly previous: Transform;
  /** CPU time of the last controller step, in milliseconds (dev overlay). */
  readonly lastStepMs: number;
}

/**
 * On-foot mode (spike S5): runs the clock at R = 6, reads the onFoot input context and
 * steps the hand-rolled character controller. `viewYaw` gives the camera heading that
 * WASD is relative to.
 */
export function createOnFootMode(
  ctx: GameContext,
  zone: OnFootZone,
  spawn: Transform,
  viewYaw: () => number,
  view?: OnFootView,
  params: ControllerParams = DEFAULT_CONTROLLER,
): OnFootMode {
  const character = createCharacter(spawn.position, spawn.heading);
  const previous: Transform = { position: { ...spawn.position }, heading: spawn.heading };
  let lastStepMs = 0;

  return {
    id: 'onFoot',
    character,
    previous,
    get lastStepMs() {
      return lastStepMs;
    },
    enter() {
      ctx.input.context = 'onFoot';
    },
    update(dt) {
      previous.position.x = character.position.x;
      previous.position.y = character.position.y;
      previous.position.z = character.position.z;
      previous.heading = character.heading;

      const clock = ctx.state.environment.clock;
      const dayBefore = dayAndHour(clock.gameSeconds).day;
      const worldTicks = advanceClock(clock, dt, R_ON_FOOT);
      for (let i = 0; i < worldTicks; i++) {
        ctx.events.emit('WorldTick', { gameSeconds: clock.gameSeconds });
      }
      const dayAfter = dayAndHour(clock.gameSeconds).day;
      if (dayAfter !== dayBefore) ctx.events.emit('DayChanged', { day: dayAfter });

      const input = ctx.input;
      const t0 = performance.now();
      stepCharacter(
        character,
        {
          forward: (input.isDown('MoveForward') ? 1 : 0) - (input.isDown('MoveBack') ? 1 : 0),
          right: (input.isDown('MoveRight') ? 1 : 0) - (input.isDown('MoveLeft') ? 1 : 0),
          run: input.isDown('Sprint'),
          crouch: input.isDown('Crouch'),
        },
        viewYaw(),
        zone,
        dt,
        params,
      );
      lastStepMs = performance.now() - t0;
    },
    render(alpha, frameSeconds) {
      view?.render(alpha, frameSeconds);
    },
  };
}
