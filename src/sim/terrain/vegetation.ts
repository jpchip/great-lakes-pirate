/**
 * The vegetation density map (plan 03 §8.3, plan 14 §5; Phase 2 piece C): where forest,
 * birch stands and shore rocks grow, from height, slope and a little seeded noise. It is
 * derived from the baked height tiles at runtime rather than baked, so the terrain shader,
 * the tree planting and the geo pipeline's canopy shelter (tools/geo/canopy.ts) all read
 * the same function and can't drift apart.
 *
 * Heights are game meters above lake level (the land curve is already applied); positions
 * are zone meters. Pure and deterministic, with no imports, so the Node geo tools can load
 * this file directly.
 */

/** The heights it reads: a GridField, or the geo tools' own grid. */
export interface HeightSampler {
  /** Sample spacing, meters. */
  readonly step: number;
  /** Bilinear height at (x, z), zone meters. */
  sample(x: number, z: number): number;
}

/** Forest starts this far above the lake; below it is beach and shore ledge. */
export const TREELINE_LOW_M = 1.6;
/** Full forest density from this height up. */
export const TREELINE_FULL_M = 5;
/** Upness (the normal's y) below which no trees grow: about 52°. */
export const STEEP_UPNESS = 0.62;
/** Upness above which slope doesn't thin the forest: about 37°. */
export const GENTLE_UPNESS = 0.8;

/** Sample spacing of the planting grid for trees, meters. One candidate per cell. */
export const TREE_CELL_M = 8;
/** Planting grid for rocks, meters. */
export const ROCK_CELL_M = 12;

/** The flat canopy added to forested land for the shelter bake (plan 03 §14.4), meters. */
export const CANOPY_M = 15;

/** Kinds of planted instance (the `kind` field). */
export const PlantKind = { Pine: 0, Birch: 1, Rock: 2 } as const;

/**
 * One planted instance per `PLANT_STRIDE` floats: x, y, z (zone meters, y the ground),
 * scale, yaw (radians), kind (PlantKind), tint (0–1, per-instance color variation) and
 * rank (0–1). Instances are sorted by rank, so a preset's density d draws the prefix with
 * rank < d and thinning never moves a tree.
 */
export const PLANT_STRIDE = 8;

export interface TilePlants {
  /** Trees (pines and birches), sorted by rank. */
  trees: Float32Array;
  /** Rocks, sorted by rank. */
  rocks: Float32Array;
}

/** A rotated rectangle kept clear of trees and rocks (set-piece footprints). */
export interface Clearing {
  x: number;
  z: number;
  /** Unit vector along the rectangle's long side, in zone x/z. */
  ux: number;
  uz: number;
  halfAlong: number;
  halfAcross: number;
}

// --- Hashing and noise --------------------------------------------------------------

/** An integer hash of a lattice point and a salt, as a float in [0, 1). */
export function hash01(i: number, j: number, salt: number): number {
  let h = Math.imul(i | 0, 0x27d4eb2d) ^ Math.imul(j | 0, 0x165667b1) ^ Math.imul(salt, 0x9e3779b9);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

/** Smooth value noise in [0, 1] with lattice spacing `cell` meters. */
export function valueNoise(x: number, z: number, cell: number, salt: number): number {
  const fx = x / cell;
  const fz = z / cell;
  const i = Math.floor(fx);
  const j = Math.floor(fz);
  const u = fx - i;
  const v = fz - j;
  const su = u * u * (3 - 2 * u);
  const sv = v * v * (3 - 2 * v);
  const a = hash01(i, j, salt);
  const b = hash01(i + 1, j, salt);
  const c = hash01(i, j + 1, salt);
  const d = hash01(i + 1, j + 1, salt);
  return a + (b - a) * su + (c - a) * sv + (a - b - c + d) * su * sv;
}

function smoothstep(a: number, b: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

// --- The density map ----------------------------------------------------------------

/**
 * Upness of the ground at (x, z): the normal's y over an 8 m span, so it doesn't depend on
 * the stride a tile is drawn at.
 */
export function upnessAt(field: HeightSampler, x: number, z: number): number {
  const span = 2 * field.step;
  const gx = (field.sample(x + field.step, z) - field.sample(x - field.step, z)) / span;
  const gz = (field.sample(x, z + field.step) - field.sample(x, z - field.step)) / span;
  return 1 / Math.sqrt(1 + gx * gx + gz * gz);
}

/**
 * Forest density 0–1. None on beaches and below the lake, rising to full a few meters up;
 * thinned on steep ground and gone on cliffs; patchy where 1900's logging and old burns
 * left clearings (two octaves of noise at a few hundred meters).
 */
export function forestDensity(h: number, upness: number, x: number, z: number): number {
  if (h < TREELINE_LOW_M) return 0;
  const shore = smoothstep(TREELINE_LOW_M, TREELINE_FULL_M, h);
  const slope = smoothstep(STEEP_UPNESS, GENTLE_UPNESS, upness);
  const n = 0.65 * valueNoise(x, z, 420, 11) + 0.35 * valueNoise(x, z, 130, 12);
  const open = smoothstep(0.18, 0.36, n);
  return shore * slope * (0.12 + 0.88 * open);
}

/** The share of trees that are birch: stands of them, and more along the shore. */
export function birchShare(h: number, x: number, z: number): number {
  const stands = smoothstep(0.58, 0.78, valueNoise(x, z, 180, 21));
  const shore = 1 - smoothstep(4, 12, h);
  return Math.min(0.8, 0.1 + 0.55 * stands + 0.15 * shore);
}

/** Rock density 0–1: shore ledges and beaches, thickest at the foot of steep bluffs. */
export function rockDensity(h: number, upness: number): number {
  if (h < -0.6) return 0;
  const shore = smoothstep(-0.6, 0.3, h) * (1 - smoothstep(3, 7, h));
  const steep = 1 - smoothstep(0.75, 0.95, upness);
  return shore * (0.22 + 0.6 * steep);
}

/** Canopy height to add to the bare-earth DEM for the shelter bake, meters. */
export function canopyHeight(h: number, upness: number, x: number, z: number): number {
  return CANOPY_M * smoothstep(0.3, 0.6, forestDensity(h, upness, x, z));
}

// --- Planting -----------------------------------------------------------------------

/** Footprints from set pieces: the shore anchor, out to sea along `bearing`. */
export function clearingFromFootprint(
  anchor: { x: number; z: number },
  bearing: number,
  alongM: number,
  inlandM: number,
  seawardM: number,
): Clearing {
  // Seaward unit vector (bearing clockwise from north, north is −z).
  const sx = Math.sin(bearing);
  const sz = -Math.cos(bearing);
  // The center sits midway between the inland and seaward edges.
  const mid = (seawardM - inlandM) / 2;
  return {
    x: anchor.x + sx * mid,
    z: anchor.z + sz * mid,
    ux: -sz,
    uz: sx,
    halfAlong: alongM / 2,
    halfAcross: (seawardM + inlandM) / 2,
  };
}

function cleared(clearings: readonly Clearing[], x: number, z: number): boolean {
  for (const c of clearings) {
    const dx = x - c.x;
    const dz = z - c.z;
    const along = Math.abs(dx * c.ux + dz * c.uz);
    const across = Math.abs(-dx * c.uz + dz * c.ux);
    if (along <= c.halfAlong && across <= c.halfAcross) return true;
  }
  return false;
}

function sortByRank(src: number[]): Float32Array {
  const n = src.length / PLANT_STRIDE;
  const order = Array.from({ length: n }, (_, k) => k);
  order.sort((a, b) => (src[a * PLANT_STRIDE + 7] ?? 0) - (src[b * PLANT_STRIDE + 7] ?? 0));
  const out = new Float32Array(src.length);
  order.forEach((k, m) => {
    for (let f = 0; f < PLANT_STRIDE; f++)
      out[m * PLANT_STRIDE + f] = src[k * PLANT_STRIDE + f] ?? 0;
  });
  return out;
}

/**
 * Plants every tree and rock in the square [minX, minX + size) × [minZ, minZ + size), the
 * same every time: each planting cell is hashed from its zone position, so neighboring
 * tiles never double up or leave a seam.
 */
export function plantTile(
  field: HeightSampler,
  minX: number,
  minZ: number,
  size: number,
  clearings: readonly Clearing[] = [],
): TilePlants {
  const trees: number[] = [];
  const rocks: number[] = [];

  const cells = Math.round(size / TREE_CELL_M);
  const ci0 = Math.round(minX / TREE_CELL_M);
  const cj0 = Math.round(minZ / TREE_CELL_M);
  for (let b = 0; b < cells; b++) {
    for (let a = 0; a < cells; a++) {
      const i = ci0 + a;
      const j = cj0 + b;
      const x = (i + hash01(i, j, 1)) * TREE_CELL_M;
      const z = (j + hash01(i, j, 2)) * TREE_CELL_M;
      const h = field.sample(x, z);
      if (h < TREELINE_LOW_M) continue;
      const density = forestDensity(h, upnessAt(field, x, z), x, z);
      if (hash01(i, j, 3) >= density) continue;
      if (cleared(clearings, x, z)) continue;
      const birch = hash01(i, j, 4) < birchShare(h, x, z);
      trees.push(
        x,
        h,
        z,
        0.78 + 0.44 * hash01(i, j, 5),
        hash01(i, j, 6) * Math.PI * 2,
        birch ? PlantKind.Birch : PlantKind.Pine,
        hash01(i, j, 7),
        hash01(i, j, 8),
      );
    }
  }

  const rockCells = Math.round(size / ROCK_CELL_M);
  const ri0 = Math.round(minX / ROCK_CELL_M);
  const rj0 = Math.round(minZ / ROCK_CELL_M);
  for (let b = 0; b < rockCells; b++) {
    for (let a = 0; a < rockCells; a++) {
      const i = ri0 + a;
      const j = rj0 + b;
      const x = (i + hash01(i, j, 31)) * ROCK_CELL_M;
      const z = (j + hash01(i, j, 32)) * ROCK_CELL_M;
      const h = field.sample(x, z);
      if (h < -0.6 || h > 8) continue;
      if (hash01(i, j, 33) >= rockDensity(h, upnessAt(field, x, z))) continue;
      if (cleared(clearings, x, z)) continue;
      rocks.push(
        x,
        h,
        z,
        0.6 + 1.4 * hash01(i, j, 34) ** 2,
        hash01(i, j, 35) * Math.PI * 2,
        PlantKind.Rock,
        hash01(i, j, 36),
        hash01(i, j, 37),
      );
    }
  }

  return { trees: sortByRank(trees), rocks: sortByRank(rocks) };
}

/** How many of a rank-sorted instance list a density keeps: those with rank < density. */
export function countAtDensity(plants: Float32Array, density: number): number {
  let lo = 0;
  let hi = plants.length / PLANT_STRIDE;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if ((plants[mid * PLANT_STRIDE + 7] ?? 0) < density) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}
