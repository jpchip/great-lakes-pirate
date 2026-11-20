import type { PlacedIsland } from './on-foot';

/**
 * Where to come ashore on an island (Phase 9 piece R). Pure: the islands test, the dev
 * hooks and the bench share it. Which island a point is on is piece Q's `islandLand`.
 */

/** Where to come ashore on an island: the boat's water, the beach and the way inland. */
export interface IslandLanding {
  island: string;
  /** Water deep enough to lie in the rowboat (or anchor just beyond), zone meters. */
  boat: { x: number; z: number };
  /** Dry ground just up from the water's edge. */
  shore: { x: number; z: number };
  /** The bearing inland from the shore, radians clockwise from north. */
  inland: number;
  /** A prefab's landing mark (a dock's end, a wreck's beach) or the gentlest shore found. */
  by: 'mark' | 'shore';
}

/** The boat lies in water this deep. */
const BOAT_DEPTH_M = 1.2;
/** The shore point stands on ground at least this high. */
const SHORE_DRY_M = 0.3;

const dirOf = (bearing: number): { dx: number; dz: number } => ({
  dx: Math.sin(bearing),
  dz: -Math.cos(bearing),
});

/** Steeper than this at the water's edge and you can't step out of the boat (`beachStep`). */
const STEP_SLOPE = (32 * Math.PI) / 180;

/** The slope of the ground at (x, z), radians. */
function slopeAt(heightAt: (x: number, z: number) => number, x: number, z: number): number {
  const g =
    Math.hypot(heightAt(x + 1, z) - heightAt(x - 1, z), heightAt(x, z + 1) - heightAt(x, z - 1)) /
    2;
  return Math.atan(g);
}

/** Can you step out of a boat at the water's edge here, going `bearing` inland? */
function steppable(
  heightAt: (x: number, z: number) => number,
  x: number,
  z: number,
  bearing: number,
): boolean {
  const { dx, dz } = dirOf(bearing);
  for (let d = 0; d <= 10; d += 0.5) {
    const px = x + dx * d;
    const pz = z + dz * d;
    if (heightAt(px, pz) < 0.15) continue;
    return slopeAt(heightAt, px, pz) <= STEP_SLOPE;
  }
  return false;
}

/**
 * From a point at the water's edge going out along `bearing`: the first water deep enough
 * for the boat (within `reachM`), and back the other way the first dry ground.
 */
function landingAlong(
  heightAt: (x: number, z: number) => number,
  x: number,
  z: number,
  bearing: number,
  reachM = 90,
): { boat: { x: number; z: number }; shore: { x: number; z: number } } | undefined {
  const { dx, dz } = dirOf(bearing);
  let boat: { x: number; z: number } | undefined;
  for (let s = 0; s <= reachM; s += 1) {
    if (heightAt(x + dx * s, z + dz * s) < -BOAT_DEPTH_M) {
      boat = { x: x + dx * (s + 4), z: z + dz * (s + 4) };
      break;
    }
  }
  let shore: { x: number; z: number } | undefined;
  for (let s = 0; s <= 40; s += 0.5) {
    if (heightAt(x - dx * s, z - dz * s) > SHORE_DRY_M) {
      shore = { x: x - dx * (s + 1), z: z - dz * (s + 1) };
      break;
    }
  }
  return boat && shore ? { boat, shore } : undefined;
}

/**
 * Where to land on a placed island: a prefab's `landing` mark first (the fish camp's dock
 * end, the beach under a wreck), else, round the island from its anchor, the shore with the
 * lowest bank behind the water's edge that has water for the boat off it.
 */
export function findLanding(
  island: PlacedIsland,
  heightAt: (x: number, z: number) => number,
): IslandLanding | undefined {
  // The island's own landings (piece Q's beaches and docks): out to the nearest water.
  for (const l of island.landings) {
    let best: { s: number; bearing: number } | undefined;
    for (let k = 0; k < 32; k++) {
      const bearing = (k / 32) * Math.PI * 2;
      const { dx, dz } = dirOf(bearing);
      for (let s = 0; s <= 40; s += 0.5) {
        if (heightAt(l.x + dx * s, l.z + dz * s) < 0) {
          if (!best || s < best.s) best = { s, bearing };
          break;
        }
      }
    }
    if (!best) continue;
    const { dx, dz } = dirOf(best.bearing);
    const ex = l.x + dx * best.s;
    const ez = l.z + dz * best.s;
    const along = landingAlong(heightAt, ex, ez, best.bearing);
    if (along && steppable(heightAt, ex + dx, ez + dz, best.bearing + Math.PI)) {
      return { island: island.id, ...along, inland: best.bearing + Math.PI, by: 'mark' };
    }
  }
  for (const m of island.marks) {
    if (m.kind !== 'landing') continue;
    // A cave mouth's landing is for the boat into the cave (piece S), not the shore.
    if (island.pieces.some((p) => p.poi === m.poi && p.kind === 'cave_mouth')) continue;
    // Out from the mark to the water's edge (a dock's end is already over it).
    const { dx, dz } = dirOf(m.facing);
    let s = 0;
    while (s < 30 && heightAt(m.x + dx * s, m.z + dz * s) > 0) s += 0.5;
    const along = landingAlong(heightAt, m.x + dx * s, m.z + dz * s, m.facing);
    if (along && steppable(heightAt, m.x + dx * (s + 1), m.z + dz * (s + 1), m.facing + Math.PI)) {
      return { island: island.id, ...along, inland: m.facing + Math.PI, by: 'mark' };
    }
  }
  const anchor = island.anchor;
  if (!anchor) return undefined;
  let best: (IslandLanding & { bank: number }) | undefined;
  const RAYS = 32;
  for (let k = 0; k < RAYS; k++) {
    const bearing = (k / RAYS) * Math.PI * 2;
    const { dx, dz } = dirOf(bearing);
    // Out from the anchor to the first water.
    let s = 0;
    while (s < 2500 && heightAt(anchor.x + dx * s, anchor.z + dz * s) > 0) s += 1;
    if (s >= 2500) continue;
    const ex = anchor.x + dx * s;
    const ez = anchor.z + dz * s;
    const along = landingAlong(heightAt, ex, ez, bearing, 60);
    if (!along) continue;
    // The bank: how high the ground stands 8 m in from the edge, and a shore too steep to
    // step out onto only if there's nothing better.
    const bank =
      heightAt(ex - dx * 8, ez - dz * 8) +
      (steppable(heightAt, ex + dx, ez + dz, bearing + Math.PI) ? 0 : 1000);
    if (!best || bank < best.bank) {
      best = { island: island.id, ...along, inland: bearing + Math.PI, by: 'shore', bank };
    }
  }
  if (!best) return undefined;
  return {
    island: best.island,
    boat: best.boat,
    shore: best.shore,
    inland: best.inland,
    by: best.by,
  };
}
