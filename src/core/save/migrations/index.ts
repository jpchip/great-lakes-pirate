import { Rng, type RngState } from '../../rng';

/**
 * Save migrations (plan 16 §7).
 *
 * `migrations[n]` upgrades a WorldState payload from saveVersion n to n + 1.
 * Bump CURRENT_SAVE_VERSION on any WorldState schema change, add the migration
 * here, and add a fixture at tests/fixtures/saves/v<n+1>.json.
 *
 * Migrations work on plain JSON so core/ stays independent of sim/ types.
 */

export type SavePayload = Record<string, unknown>;
export type Migration = (state: SavePayload) => SavePayload;

export const CURRENT_SAVE_VERSION = 2;

/** Hours of weather a migrated save catches up on at load, like a new run's spin-up. */
const WEATHER_SPIN_UP_HOURS = 48;

/**
 * v1 → v2 (plan 04 §24): the S9 weather joins `environment`. A Phase 1 save has no
 * weather, so it gets an empty sky set two game days in the past, with its own random
 * stream derived from the run's. The game brings it up to the present on load, so the
 * player sails into weather that formed while they were away.
 */
function addWeather(state: SavePayload): SavePayload {
  const env = state['environment'] as SavePayload & {
    clock: { gameSeconds: number };
    rng: RngState;
  };
  // A copy of the run's stream: the run's own sequence is left exactly where it was.
  const weatherRng = Rng.fromSeed(`weather:${Rng.fromState(env.rng).nextUint32()}`);
  const noiseSeed = weatherRng.nextUint32();
  return {
    ...state,
    environment: {
      ...env,
      weather: {
        rng: weatherRng.getState(),
        noiseSeed,
        nextId: 1,
        tickSeconds: env.clock.gameSeconds - WEATHER_SPIN_UP_HOURS * 3600,
        systems: [],
        fogBanks: [],
      },
    },
  };
}

export const migrations: Readonly<Record<number, Migration>> = {
  1: addWeather,
};
