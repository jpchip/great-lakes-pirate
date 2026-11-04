import type { GameContext } from '../modes/context';
import {
  burnLantern,
  CAN_BURN_GAME_S,
  createLantern,
  oilNights,
  toggleLantern,
  type LanternState,
} from '../sim/law/lantern';
import { daylight01 } from '../sim/law/perception';
import { sunAt } from '../sim/weather/celestial';
import type { Entity } from './ecs';

/**
 * The lantern at the helm (plan 02 §2 L, plan 06 §7.1; Phase 5 piece B): L lights the
 * running lights or douses them, the lamps burn the lamp oil in the lockers while lit, and
 * the ship's entity carries the state for the renderer and for detection.
 */

/** Dark running near traffic: a ship this close can't see you to keep clear (§14.5). */
export const DARK_WARNING_M = 450;

export interface LanternControl {
  readonly state: LanternState;
  /** L pressed: the notice to show. */
  toggle(): string;
  /** Burns oil for the game time passed since the last call. */
  step(): void;
  /** Nights of oil aboard, for the HUD. */
  nights(): number;
  /** Dark at night: the HUD shows it, and warns when a ship is near. */
  runningDark(): boolean;
  /** Sets the lantern directly, for dev checks (`?lantern=on`); no oil is used. */
  set(lit: boolean): void;
}

export function attachLantern(ctx: GameContext, ship: Entity): LanternControl {
  const player = ctx.state.player;
  // A ship comes with her lamps filled: a week of nights before the first can is opened.
  player.lantern ??= { ...createLantern(), fuelS: CAN_BURN_GAME_S };
  const state = player.lantern;
  ship.lantern = state;
  let last = ctx.state.environment.clock.gameSeconds;

  return {
    state,
    toggle() {
      const result = toggleLantern(state, player.stores);
      if (result === 'noOil') return 'No lamp oil aboard';
      ctx.events.emit('LanternChanged', { lit: state.lit, reason: 'toggled' });
      return state.lit ? 'Lantern lit' : 'Lantern doused: running dark';
    },
    step() {
      const now = ctx.state.environment.clock.gameSeconds;
      const dt = now - last;
      last = now;
      if (burnLantern(state, player.stores, dt)) {
        ctx.events.emit('LanternChanged', { lit: false, reason: 'outOfOil' });
      }
    },
    nights() {
      return oilNights(state, player.stores);
    },
    runningDark() {
      if (state.lit) return false;
      return daylight01(sunAt(ctx.state.environment.clock.gameSeconds).elevationRad) < 0.5;
    },
    set(lit) {
      state.lit = lit;
      if (lit && state.fuelS <= 0) state.fuelS = CAN_BURN_GAME_S;
    },
  };
}
