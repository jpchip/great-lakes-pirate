/**
 * The seam between detection (piece B) and the law (piece A): who saw the player, and
 * how well (plan 06 §2.3, §7.1). Piece B's observers fill a `WitnessSource`; the law
 * asks it when a crime is committed at sea. An empty source means nobody saw.
 */

/** Who can witness a crime (plan 06 §2.4, §5.5). */
export type WitnessKind =
  | 'keeper'
  | 'crew'
  | 'cutter'
  | 'townsfolk'
  | 'merchant'
  | 'freightAgent'
  | 'harborMaster'
  | 'informant';

/** Plan 06 §2.3: nobody, "a schooner", your ship's profile, or you. Factors 0.25/0.5/1/1. */
export type Identification = 'unknown' | 'schooner' | 'ship' | 'person';

/** How fast a keeper's report goes (`lighthouses.json` `reporting`). */
export type Reporting = 'fast' | 'medium' | 'slow';

export interface Witness {
  /** Stable for the observer: a lighthouse id, a traffic ship id, `law.morrill`. */
  id: string;
  kind: WitnessKind;
  /** For the report eye and the papers: "the Raspberry keeper", "the steamer Hiawatha". */
  name: string;
  zoneId?: string;
  identification: Identification;
  /** A keeper's reporting speed; other kinds leave it out. */
  reporting?: Reporting;
  distanceM?: number;
}

/** Who sees the player right now, at spotted or better. */
export interface WitnessSource {
  witnesses(): readonly Witness[];
}

/** Nobody's watching: the source until piece B wires its observers in. */
export const NO_WITNESSES: WitnessSource = { witnesses: () => [] };

/** Identifications from weakest to strongest. */
export const IDENTIFICATION_ORDER: readonly Identification[] = [
  'unknown',
  'schooner',
  'ship',
  'person',
];
