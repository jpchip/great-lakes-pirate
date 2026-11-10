import kitJson from '../../../data/kit.json';
import { kitFileSchema, type KitPiece } from '../../../data/schemas/districts';

/**
 * The docks district kit (plan 08 §13; Phase 7 piece C): every piece the placement editor
 * can lay, validated from data/kit.json. Geometry lives with the renderer
 * (render/district/kit-meshes.ts); this side knows sizes, colliders, surfaces and lights.
 */

export const KIT: readonly KitPiece[] = kitFileSchema.parse(kitJson);

const BY_ID = new Map(KIT.map((p) => [p.id, p]));

export function kitPiece(id: string): KitPiece {
  const p = BY_ID.get(id);
  if (!p) throw new Error(`kit: no piece ${id}`);
  return p;
}

export function findKitPiece(id: string): KitPiece | undefined {
  return BY_ID.get(id);
}

/** The grid (plan 09 §4.1): 2 m cells. */
export const CELL_M = 2;
/** Props snap to this sub-grid and turn in these steps (plan 09 §4.2). */
export const PROP_SNAP_M = 0.25;
export const PROP_TURN_DEG = 15;
/** Wall thickness, meters, centered on the cell edge. */
export const WALL_M = 0.2;
/** Clear height under a door's lintel. */
export const DOOR_HEIGHT_M = 2.2;
/** A deck's planking and stringers, meters below its top. */
export const DECK_THICK_M = 0.35;
