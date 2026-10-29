import type { SailShipRecord } from '../../data/schemas/ships';
import { createSailingState } from '../sim/sailing/controller';
import { defaultHandling, type HandlingRecord } from '../sim/sailing/handling';
import { defaultHazardRules, type HazardRules } from '../sim/sailing/hazard-rules';
import { compileHazardClass, createHazardState } from '../sim/sailing/hazards';
import { compileSailingClass } from '../sim/sailing/ship-class';
import { sailShipRecord, T1_SCHOONER_ID } from '../sim/sailing/ships';
import { createBuoyancy, type Buoyancy } from './buoyancy';
import type { ShipHazards } from './hazards';
import type { SailingShip } from './sailing';

/**
 * The player's T1 schooner on the plan 02 model: the components a ship entity needs,
 * plus the record, handling and hazard rules it was built from (the dev panels reset
 * to them). The game, the S7 greybox and the S8 arena all start from this.
 */
export interface Schooner {
  record: SailShipRecord;
  handling: HandlingRecord;
  hazardRules: HazardRules;
  sailing: SailingShip;
  hazards: ShipHazards;
  buoyancy: Buoyancy;
}

export function createSchooner(x: number, z: number, heading: number): Schooner {
  const record = sailShipRecord(T1_SCHOONER_ID);
  const handling = defaultHandling();
  const hazardRules = defaultHazardRules();
  const hazardClass = compileHazardClass(record, hazardRules);
  return {
    record,
    handling,
    hazardRules,
    sailing: {
      cls: compileSailingClass(record, handling),
      state: createSailingState(x, z, heading),
    },
    hazards: { cls: hazardClass, state: createHazardState(hazardClass) },
    buoyancy: createBuoyancy(record.buoyancy),
  };
}
