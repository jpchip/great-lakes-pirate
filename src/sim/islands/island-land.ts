import type { PlacedIsland } from './on-foot';

/**
 * Whose land a landing is on, and where to come ashore on an island (Phase 9 piece R).
 * Pure: the ashore glue, the islands test, the dev hooks and the bench share it.
 *
 * Islands' baked tile boxes overlap (Rocky's holds South Twin, Gull's the tip of Michigan,
 * Oak's a corner of Manitou), so a box alone can't say which island you're landing on.
 * Each island's land is grown from its `anchor` (its `islands.json` point) over the zone's
 * ground, and a landing goes to the island whose land is nearest.
 */

/** An island's land: the cells of ground above the lake joined to its anchor. */
export interface LandMask {
  x0: number;
  z0: number;
  step: number;
  width: number;
  height: number;
  cells: Uint8Array;
}

/** How far from its point the bake looks for an island's land (tools/geo `searchM`). */
const ANCHOR_SEARCH_M = 60;

/**
 * The land joined to `anchor` inside `box`, sampled every `step` m (8-connected, as the bake
 * finds islands). Undefined when there's no land within 60 m of the anchor.
 */
export function growLand(
  heightAt: (x: number, z: number) => number,
  anchor: { x: number; z: number },
  box: { minX: number; minZ: number; maxX: number; maxZ: number },
  step = 4,
): LandMask | undefined {
  const width = Math.max(1, Math.ceil((box.maxX - box.minX) / step) + 1);
  const height = Math.max(1, Math.ceil((box.maxZ - box.minZ) / step) + 1);
  const dry = new Uint8Array(width * height);
  for (let j = 0; j < height; j++) {
    for (let i = 0; i < width; i++) {
      if (heightAt(box.minX + i * step, box.minZ + j * step) > 0) dry[j * width + i] = 1;
    }
  }
  const ai = Math.round((anchor.x - box.minX) / step);
  const aj = Math.round((anchor.z - box.minZ) / step);
  const r = Math.ceil(ANCHOR_SEARCH_M / step);
  let start = -1;
  let best = Number.POSITIVE_INFINITY;
  for (let dj = -r; dj <= r; dj++) {
    for (let di = -r; di <= r; di++) {
      const i = ai + di;
      const j = aj + dj;
      if (i < 0 || j < 0 || i >= width || j >= height || !dry[j * width + i]) continue;
      const d = di * di + dj * dj;
      if (d < best) {
        best = d;
        start = j * width + i;
      }
    }
  }
  if (start < 0) return undefined;
  const cells = new Uint8Array(width * height);
  const stack = [start];
  cells[start] = 1;
  while (stack.length) {
    const k = stack.pop() ?? 0;
    const i = k % width;
    const j = (k - i) / width;
    for (let dj = -1; dj <= 1; dj++) {
      for (let di = -1; di <= 1; di++) {
        const ni = i + di;
        const nj = j + dj;
        if (ni < 0 || nj < 0 || ni >= width || nj >= height) continue;
        const nk = nj * width + ni;
        if (cells[nk] || !dry[nk]) continue;
        cells[nk] = 1;
        stack.push(nk);
      }
    }
  }
  return { x0: box.minX, z0: box.minZ, step, width, height, cells };
}

/**
 * Meters from (x, z) to the nearest cell of the land, searched outward ring by ring up to
 * `maxM`; Infinity if there's none that close.
 */
export function landDistance(mask: LandMask, x: number, z: number, maxM: number): number {
  const ci = Math.round((x - mask.x0) / mask.step);
  const cj = Math.round((z - mask.z0) / mask.step);
  const rings = Math.ceil(maxM / mask.step);
  let best = Number.POSITIVE_INFINITY;
  for (let r = 0; r <= rings; r++) {
    // Once a ring is past the best found, nothing further out can beat it.
    if ((r - 1) * mask.step > best) break;
    for (let dj = -r; dj <= r; dj++) {
      const edge = Math.abs(dj) === r;
      for (let di = -r; di <= r; di += edge ? 1 : 2 * r || 1) {
        const i = ci + di;
        const j = cj + dj;
        if (i < 0 || j < 0 || i >= mask.width || j >= mask.height) continue;
        if (!mask.cells[j * mask.width + i]) continue;
        const d = Math.hypot(mask.x0 + i * mask.step - x, mask.z0 + j * mask.step - z);
        if (d < best) best = d;
      }
    }
  }
  return best <= maxM ? best : Number.POSITIVE_INFINITY;
}

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
  for (const m of island.marks) {
    if (m.kind !== 'landing') continue;
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
