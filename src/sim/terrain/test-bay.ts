/**
 * The Phase 1 test bay's greybox pier (plan 02 §14.1). Phase 1 loaded a 3 × 3 km slice of
 * the Apostles bake around Bayfield; Phase 2 loads the whole zone (data/zones.json has
 * the spawn), and the Bayfield and Ashland harbor set pieces replace this pier.
 */

const DEG = Math.PI / 180;

export interface Pose {
  x: number;
  z: number;
  /** Radians clockwise from north. */
  heading: number;
}

/**
 * A greybox pier (plan 02 §7): a straight deck from `root` (just ashore) out along
 * `bearing`. Docks and berths are 1:1 like ships (plan 03 §3.4).
 */
export interface Dock {
  id: string;
  name: string;
  root: { x: number; z: number };
  /** Direction the pier runs out from shore, radians clockwise from north. */
  bearing: number;
  lengthM: number;
  widthM: number;
  /** Deck height above mean lake level. */
  deckM: number;
}

/** Where a ship lies alongside a dock: its center and heading, and the berth zone length. */
export interface Berth {
  id: string;
  dockId: string;
  pose: Pose;
  lengthM: number;
  /** Half the berth zone's width across the ship, meters. */
  halfWidthM: number;
}

export const TEST_BAY = {
  zone: 'zone.apostles',
  /**
   * Bayfield city dock, from the foot of the town straight out to 25 m of water. The
   * shoreline here runs NNE, so the pier points ESE along the SDF normal.
   */
  docks: [
    {
      id: 'dock.bayfield',
      name: 'Bayfield',
      root: { x: -880, z: 338 },
      bearing: 112 * DEG,
      lengthM: 56,
      widthM: 6,
      deckM: 1.6,
    },
  ] satisfies Dock[],
} as const;

/** Clearance between the pier and a ship's side, plus half a T1 beam (~6 m). */
const BERTH_OFFSET_M = 3 + 0.5 + 3;
const BERTH_LENGTH_M = 34;

/** Unit vector for a bearing on the water plane (x east, z south). */
export function bearingVector(bearing: number): { x: number; z: number } {
  return { x: Math.sin(bearing), z: -Math.cos(bearing) };
}

/** A point `along` meters out the pier's axis and `across` meters to its right. */
export function dockPoint(dock: Dock, along: number, across: number): { x: number; z: number } {
  const f = bearingVector(dock.bearing);
  return {
    x: dock.root.x + f.x * along - f.z * across,
    z: dock.root.z + f.z * along + f.x * across,
  };
}

/**
 * The two berths along the outer part of the pier, bow out so casting off is a straight
 * run to open water. Auto-dock (piece E) snaps a ship into one of these.
 */
export function dockBerths(dock: Dock): Berth[] {
  const along = dock.lengthM - BERTH_LENGTH_M / 2;
  return (['north', 'south'] as const).map((side) => {
    const p = dockPoint(dock, along, side === 'north' ? -BERTH_OFFSET_M : BERTH_OFFSET_M);
    return {
      id: `${dock.id}.${side}`,
      dockId: dock.id,
      pose: { x: p.x, z: p.z, heading: dock.bearing },
      lengthM: BERTH_LENGTH_M,
      halfWidthM: 6,
    };
  });
}
