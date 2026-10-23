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

export const CURRENT_SAVE_VERSION = 1;

export const migrations: Readonly<Record<number, Migration>> = {
  // 1: (state) => ({ ...state, newSlice: {} }),  // v1 → v2
};
