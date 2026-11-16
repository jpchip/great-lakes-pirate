import structuresJson from '../../../data/structures.json';
import startersJson from '../../../data/starters.json';
import {
  startersFileSchema,
  structuresFileSchema,
  type StarterDef,
  type StructureDef,
} from '../../../data/schemas/structures';

/**
 * The hideout builder's catalog (plan 09 §5, §12; Phase 8 piece A): every piece from
 * data/structures.json and the pre-built hideouts from data/starters.json, validated at
 * load. Geometry lives with the renderer (piece B); this side knows footprints, costs,
 * support and functions.
 */

export const STRUCTURES: readonly StructureDef[] = structuresFileSchema.parse(structuresJson);
export const STARTERS: readonly StarterDef[] = startersFileSchema.parse(startersJson);

const BY_ID = new Map(STRUCTURES.map((s) => [s.id, s]));

export function structure(id: string): StructureDef {
  const s = BY_ID.get(id);
  if (!s) throw new Error(`structures: no piece ${id}`);
  return s;
}

export function findStructure(id: string): StructureDef | undefined {
  return BY_ID.get(id);
}

export function starter(id: string): StarterDef {
  const s = STARTERS.find((x) => x.id === id);
  if (!s) throw new Error(`starters: no ${id}`);
  return s;
}

/** The grid (plan 09 §4.1): 2 m cells and 3 m levels. */
export const CELL_M = 2;
export const LEVEL_M = 3;
/** Floors on two levels in the MVP (plan 09 §14 cut #3, §16.5); roofs go one above. */
export const FLOOR_LEVELS = 2;
/** Props snap to a 0.25 m sub-grid and turn in 15° steps (plan 09 §4.2). */
export const PROP_STEP_M = 0.25;
export const PROP_TURN_DEG = 15;
export const PROP_TURNS = 360 / PROP_TURN_DEG;
/** How many cells a floor or roof reaches out from the walls that carry it. */
export const SPAN_CELLS = 2;
/** A roof rises this much per cell in from its eave (piece B's pitch, 0.6 m per m). */
export const ROOF_RISE_M = 1.2;
/** The soft cap on pieces per hideout (plan 09 §10): the palette warns past it. */
export const PIECE_SOFT_CAP = 1500;
/** Deconstructing refunds this share of a piece's materials (plan 09 §6.3). */
export const REFUND_SHARE = 0.75;
/** A mooring post needs water at least this deep beside it (a T1's draft and some). */
export const MOORING_MIN_DEPTH_M = 1.5;
/** Ground that rises more than this above the floor datum is a cliff to build into. */
export const CLIFF_M = 0.25;
/** Bare ground steeper than this across a cell can't take a fence or a well. */
export const GROUND_SLOPE_M = 1;
