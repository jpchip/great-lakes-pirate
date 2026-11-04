/**
 * The seam between detection (plan 06 §7, Phase 5 piece B) and the law core (piece A):
 * who saw the player, and how well. Detection fills a `WitnessSource` from the keepers,
 * the traffic's crews and the cutter's lookout; the crime pipeline (§2.1) asks it who
 * saw a crime the moment one is committed. Types only, so either side can build on it.
 */

/** Who the witness is (§2.4 sets each kind's report delay). */
export type WitnessKind = 'keeper' | 'crew' | 'cutter' | 'townsfolk' | 'merchant' | 'freightAgent';

/**
 * How well they saw (§2.3): `unknown` saw a light or a shape ("someone"), `schooner` a
 * vague vessel, `ship` matched your ship's profile, `person` knew you by sight.
 * Identification factors: 0.25, 0.5, 1, 1.
 */
export type Identification = 'unknown' | 'schooner' | 'ship' | 'person';

/** §2.3's identification factors: what share of a crime's heat a report carries. */
export const IDENTIFICATION_FACTOR: Readonly<Record<Identification, number>> = {
  unknown: 0.25,
  schooner: 0.5,
  ship: 1,
  person: 1,
};

export interface Witness {
  /** Stable id: the lighthouse id, the traffic ship's id, `cutter.morrill`. */
  id: string;
  kind: WitnessKind;
  /** For the HUD and the report: "Raspberry Island Light", "the Hesper". */
  name: string;
  /** The zone they watch from, when they're in one. */
  zoneId?: string;
  identification: Identification;
  /** A keeper's reporting speed from lighthouses.json (§6.1). */
  reporting?: 'fast' | 'medium' | 'slow';
  /** How far off they were, zone meters. */
  distanceM?: number;
}

/** Who sees the player right now, at spotted or better. Empty means nobody. */
export interface WitnessSource {
  witnesses(): readonly Witness[];
}

/** No eyes anywhere: for tests and before detection is attached. */
export const NO_WITNESSES: WitnessSource = { witnesses: () => [] };
