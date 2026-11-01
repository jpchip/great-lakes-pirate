import shipsJson from '../../../data/ships.json';
import { shipsFileSchema, type SailShipRecord } from '../../../data/schemas/ships';

/** Validated ship classes from data/ships.json. */
export const SHIP_RECORDS = shipsFileSchema.parse(shipsJson);

/** The player's starting schooner (plan 02 §10, T1). */
export const T1_SCHOONER_ID = 'ship.t1_schooner';

/** The 100 ft schooner the shipyards sell (plan 10 §2, T2; Phase 4 piece G). */
export const T2_SCHOONER_ID = 'ship.t2_schooner';

/** The player's classes by tier, for the dev `?ship=` switch. */
export const PLAYER_SHIP_IDS: Readonly<Record<string, string>> = {
  t1: T1_SCHOONER_ID,
  t2: T2_SCHOONER_ID,
};

export function sailShipRecord(id: string): SailShipRecord {
  const record = SHIP_RECORDS.find((s) => s.id === id);
  if (!record || record.propulsion !== 'sail') throw new Error(`No sailing ship class ${id}`);
  return record;
}
