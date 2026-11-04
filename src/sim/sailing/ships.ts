import shipsJson from '../../../data/ships.json';
import { shipsFileSchema, type SailShipRecord, type ShipRecord } from '../../../data/schemas/ships';

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

/**
 * A class's service speed, game knots: a steamer's engine speed, or a sailing hull's top
 * speed (a schooner-barge under tow keeps her consort's pace). Traffic, the chart's route
 * schedules and the dev encounters all read it, so a retune in ships.json lands everywhere.
 */
export function serviceSpeedKn(record: ShipRecord): number {
  return record.propulsion === 'steam' ? record.engineSpeedKn : record.hullMaxSpeedKn;
}

/** The service speed of the class `id`. */
export function classServiceSpeedKn(id: string): number {
  const record = SHIP_RECORDS.find((r) => r.id === id);
  if (!record) throw new Error(`No ship class ${id} in ships.json`);
  return serviceSpeedKn(record);
}
