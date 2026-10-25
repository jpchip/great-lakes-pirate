import { DEFAULT_COMPRESSION } from '../core/coords';
import type { InputMapper } from '../core/input';
import { dayAndHour, advanceClock, R_SAILING } from '../core/time';
import { buoyancySystem } from '../gameplay/buoyancy';
import { bobSystem, snapshotTransforms, velocitySystem, type Entity } from '../gameplay/ecs';
import { heelSystem, sailingSystem, type WindSampler } from '../gameplay/sailing';
import { IDLE_COMMAND, type SailingCommand } from '../sim/sailing/controller';
import type { GameContext } from './context';
import type { Mode } from './machine';

export interface SailingView {
  /** `seaTime` is the wave clock at this frame, between the last two ticks. */
  render(alpha: number, seaTime: number, frameSeconds: number): void;
}

export interface SailingModeOptions {
  view?: SailingView | undefined;
  /** The wind at a zone point. Until the weather lands (piece D), a dev-panel wind. */
  wind: WindSampler;
}

/** The player's helm orders from the plan 02 §2 bindings. */
export function playerCommand(input: InputMapper, out: SailingCommand): SailingCommand {
  out.steer = (input.isDown('SteerStarboard') ? 1 : 0) - (input.isDown('SteerPort') ? 1 : 0);
  out.raiseSail = input.pressed('RaiseSail');
  out.lowerSail = input.pressed('LowerSail');
  out.trimIn = input.isDown('TrimIn');
  out.trimOut = input.isDown('TrimOut');
  out.toggleSweeps = input.pressed('Sweeps');
  return out;
}

/**
 * Sailing mode: runs the clock at R = 24, the world tick and the entity systems, with
 * the player's schooner on the plan 02 sailing model.
 */
export function createSailingMode(ctx: GameContext, options: SailingModeOptions): Mode {
  let elapsed = 0;
  let lastDt = 0;
  const scale = { rate: R_SAILING, compression: DEFAULT_COMPRESSION };
  const helm: SailingCommand = { ...IDLE_COMMAND };
  const commandFor = (e: Entity): SailingCommand =>
    e.playerControlled ? playerCommand(ctx.input, helm) : IDLE_COMMAND;

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

      sailingSystem(ctx.world, commandFor, options.wind, ctx.sea, scale, dt, (e, ev) => {
        if (ev.kind === 'tack') ctx.events.emit('ShipTacked', { shipId: e.id });
        else ctx.events.emit('ShipJibed', { shipId: e.id, uncontrolled: ev.uncontrolled });
      });
      velocitySystem(ctx.world, dt);
      bobSystem(ctx.world, elapsed);
      buoyancySystem(ctx.world, ctx.sea, dt);
      heelSystem(ctx.world);
    },
    render(alpha, frameSeconds) {
      options.view?.render(alpha, ctx.sea.time - (1 - alpha) * lastDt, frameSeconds);
    },
  };
}
