import upgradesJson from '../../../data/upgrades.json';
import type { SailShipRecord } from '../../../data/schemas/ships';
import {
  upgradesFileSchema,
  type Upgrade,
  type UpgradeCategory,
} from '../../../data/schemas/upgrades';
import type { HazardRules } from '../sailing/hazard-rules';

/**
 * A ship's fit (plan 10 §4–5, §11; Phase 4 piece G): her class with the upgrades she
 * carries folded in. Upgrades change the class record (speed, hull, hold, draft, sail
 * changes) and the hazard rules (strain, anchor holding, leaks, the depth warning), so
 * the controller and hazards run on the fitted numbers with no upgrade logic of their
 * own. Instruments that live outside the sailing sim come back as `instruments`.
 */

let cached: ReadonlyMap<string, Upgrade> | undefined;

/** Every upgrade by id, in data order. */
export function upgradeDefs(): ReadonlyMap<string, Upgrade> {
  cached ??= new Map(upgradesFileSchema.parse(upgradesJson).map((u) => [u.id, u]));
  return cached;
}

export function upgradeDef(id: string): Upgrade | undefined {
  return upgradeDefs().get(id);
}

/** What the instruments aboard give, outside the sailing sim. */
export interface Instruments {
  /** How far ahead the chart forecasts, game hours (plan 04 §5.4). */
  forecastHours: number;
  /** Spyglass field of view multiplier. */
  spyglassFovMul: number;
  /** Range multiplier for looking a ship over. */
  lookRangeMul: number;
}

/** The plain barometer and spyglass every ship has. */
export const BASE_INSTRUMENTS: Readonly<Instruments> = {
  forecastHours: 12,
  spyglassFovMul: 1,
  lookRangeMul: 1,
};

export interface ShipFit {
  record: SailShipRecord;
  rules: HazardRules;
  instruments: Instruments;
}

/** Slots a class has in a category (plan 10 §4). */
export function slotsOf(record: SailShipRecord, category: UpgradeCategory): number {
  return record.slots?.[category] ?? 0;
}

/** Slots in a category the fitted upgrades take. */
export function slotsUsed(upgrades: readonly string[], category: UpgradeCategory): number {
  return upgrades.filter((id) => upgradeDef(id)?.category === category).length;
}

/** Whether one more upgrade of this category fits the class. */
export function hasSlot(
  record: SailShipRecord,
  upgrades: readonly string[],
  category: UpgradeCategory,
): boolean {
  return slotsUsed(upgrades, category) < slotsOf(record, category);
}

/** The class record and rules with the upgrades folded in. Unknown ids are ignored. */
export function fitShip(
  base: SailShipRecord,
  baseRules: HazardRules,
  upgrades: readonly string[],
): ShipFit {
  let speedMul = 1;
  let speedKn = 0;
  let hullHpMul = 1;
  let cargoMul = 1;
  let draftFullM = 0;
  let sailChangeMul = 1;
  let anchorHoldMul = 1;
  let leakMul = 1;
  const safe = [0, 0, 0, 0];
  let shallowWarnDrafts = baseRules.shallowWarnDrafts;
  const instruments: Instruments = { ...BASE_INSTRUMENTS };
  for (const id of upgrades) {
    const e = upgradeDef(id)?.effects;
    if (!e) continue;
    speedMul *= e.speedMul ?? 1;
    speedKn += e.speedKn ?? 0;
    hullHpMul *= e.hullHpMul ?? 1;
    cargoMul *= e.cargoMul ?? 1;
    draftFullM += e.draftFullM ?? 0;
    sailChangeMul *= e.sailChangeMul ?? 1;
    anchorHoldMul *= e.anchorHoldMul ?? 1;
    leakMul *= e.leakMul ?? 1;
    e.safeWindKn?.forEach((kn, i) => (safe[i] = (safe[i] ?? 0) + kn));
    if (e.shallowWarnDrafts) shallowWarnDrafts = Math.max(shallowWarnDrafts, e.shallowWarnDrafts);
    if (e.forecastHours)
      instruments.forecastHours = Math.max(instruments.forecastHours, e.forecastHours);
    instruments.spyglassFovMul *= e.spyglassFovMul ?? 1;
    instruments.lookRangeMul *= e.lookRangeMul ?? 1;
  }
  const record: SailShipRecord = {
    ...base,
    hullMaxSpeedKn: Math.max(1, base.hullMaxSpeedKn * speedMul + speedKn),
    hullHP: base.hullHP * hullHpMul,
    cargoCapacity: Math.floor(base.cargoCapacity * cargoMul),
    draftFullM: base.draftFullM + draftFullM,
    sailChangeTimeS: base.sailChangeTimeS * sailChangeMul,
  };
  const s = baseRules.safeWindKn;
  const rules: HazardRules = {
    ...baseRules,
    anchorHoldKn: baseRules.anchorHoldKn * anchorHoldMul,
    leakSpeedLoss: baseRules.leakSpeedLoss * leakMul,
    leakSinkM: baseRules.leakSinkM * leakMul,
    safeWindKn: [
      s[0] + (safe[0] ?? 0),
      s[1] + (safe[1] ?? 0),
      s[2] + (safe[2] ?? 0),
      s[3] + (safe[3] ?? 0),
    ],
    shallowWarnDrafts,
  };
  return { record, rules, instruments };
}
