/**
 * Hull lines for the parametric hull generator (plan 14 §5), shared by the player's
 * schooners and the NPC classes. Meters, in the ship's local frame: bow toward -z,
 * starboard +x, waterline at y = 0, amidships at z = 0.
 *
 * The optional shape fields default to the T1 schooner's sharp, round-bilged hull, so a
 * schooner record needs none of them; a laker sets a long parallel midbody, a nearly
 * plumb stem and a box section.
 */
export interface HullLines {
  /** On deck, stem head to the taffrail. */
  length: number;
  beam: number;
  /** Keel below the waterline amidships. */
  draft: number;
  /** Sheer (top of the rail) above the waterline amidships. */
  freeboard: number;
  /** Extra sheer height at the bow and the stern. */
  sheerBow: number;
  sheerStern: number;
  /** Deck below the rail top (bulwark height). */
  bulwark: number;
  /** How far the stem head overhangs the forefoot, forward. */
  stemRake: number;
  /** How far the taffrail overhangs the bottom of the transom, aft. */
  transomRake: number;
  /** Transom half-width at the rail, as a fraction of the half-beam. */
  transomWidth: number;
  shape?: HullShapeParams;
  paint: HullPaint;
}

export interface HullShapeParams {
  /** Where the run (narrowing toward the stern) ends, 0 transom … 1 stem. Default 0.42. */
  runEnd?: number;
  /** Where the entrance (narrowing toward the stem) starts. Default 0.42 (no midbody). */
  entranceStart?: number;
  /** Section fullness: lower is boxier. Default 0.42 (round bilge). */
  sectionPower?: number;
  /** Where the forefoot starts rounding up toward the stem. Default 0.7. */
  forefootStart?: number;
  /** Fixed level heights between the keel and the sheer, meters above the waterline. */
  levels?: readonly number[];
  /** The boot top's lower and upper edges, meters above the waterline. */
  bootBottom?: number;
  bootTop?: number;
}

export interface HullPaint {
  topsides: number;
  boot: number;
  bottom: number;
  rail: number;
  bulwarkInside: number;
  deck: number;
}

/** The T1 schooner's hull shape; every field of `HullShapeParams` filled. */
export const SCHOONER_HULL_SHAPE: Required<HullShapeParams> = {
  runEnd: 0.42,
  entranceStart: 0.42,
  sectionPower: 0.42,
  forefootStart: 0.7,
  levels: [-1.1, -0.6, -0.22, 0.1, 0.32, 0.75],
  bootBottom: -0.22,
  bootTop: 0.32,
};

export function hullShapeParams(l: HullLines): Required<HullShapeParams> {
  return { ...SCHOONER_HULL_SHAPE, ...l.shape };
}

/**
 * Level heights for a hull of any size: evenly down to the keel and up to the sheer, with
 * the boot top's edges among them so the paint bands run straight.
 */
export function hullLevels(
  draft: number,
  freeboard: number,
  bootBottom: number,
  bootTop: number,
): number[] {
  const below = [-draft * 0.7, -draft * 0.4, bootBottom];
  const above = [bootTop, bootTop + (freeboard - bootTop) * 0.45];
  return [...below, (bootBottom + bootTop) / 2, ...above];
}
