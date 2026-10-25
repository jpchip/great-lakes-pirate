import shipsJson from '../../../data/ships.json';
import { shipsFileSchema, type SailShipRecord } from '../../../data/schemas/ships';

/** Validated ship classes from data/ships.json. */
export const SHIP_RECORDS = shipsFileSchema.parse(shipsJson);

/** The player's starting schooner (plan 02 §10, T1). */
export const T1_SCHOONER_ID = 'ship.t1_schooner';

export function sailShipRecord(id: string): SailShipRecord {
  const record = SHIP_RECORDS.find((s) => s.id === id);
  if (!record || record.propulsion !== 'sail') throw new Error(`No sailing ship class ${id}`);
  return record;
}
