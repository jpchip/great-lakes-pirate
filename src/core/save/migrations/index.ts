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

export const CURRENT_SAVE_VERSION = 5;

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

/**
 * v2 → v3 (plan 03 §20, Phase 3 piece A): `player.location` joins the save. Every Phase 2
 * run was in the Apostles, and none saved where the ship was, so a migrated run starts
 * at the Apostles spawn, as a reload always did before.
 */
function addLocation(state: SavePayload): SavePayload {
  const player = (state['player'] ?? {}) as SavePayload;
  return { ...state, player: { ...player, location: { mode: 'zone', zoneId: 'zone.apostles' } } };
}

/**
 * v3 → v4 (plan 03 §20, Phase 3 piece D): the `voyage` slice joins the save. A v3 run
 * saved on the chart had no voyage to keep (the chart wasn't in the game yet), so every
 * migrated run has none.
 */
function addVoyage(state: SavePayload): SavePayload {
  return { ...state, voyage: null };
}

/**
 * v4 → v5 (plan 05 §16, Phase 4 piece A): the economy joins the save. A 0.3.0 run gets a
 * default Deckhand captain (plan 12 §2.2: $150 and some rope and canvas) where it was
 * saved, and no market state: the sim fills every port's stock at its seasonal target
 * on load (`syncMarkets`), so this stays plain JSON.
 */
function addEconomy(state: SavePayload): SavePayload {
  const player = (state['player'] ?? {}) as SavePayload;
  return {
    ...state,
    player: {
      ...player,
      captain: { name: 'Captain', shipName: 'Schooner', background: 'deckhand' },
      purse: 15_000,
      cargo: [{ good: 'good.rope_canvas', qty: 5 }],
    },
    markets: {},
  };
}

export const migrations: Readonly<Record<number, Migration>> = {
  1: addWeather,
  2: addLocation,
  3: addVoyage,
  4: addEconomy,
};
