import { Rng } from '../../core/rng';
import type { Transform } from '../../gameplay/ecs';
import { ColliderSet, OccupancyGrid, type Collider } from '../../gameplay/onfoot/colliders';
import type { OnFootZone } from '../../gameplay/onfoot/controller';
import { Heightfield } from '../../gameplay/onfoot/heightfield';

/**
 * Spike S5 test chunk: a 128 m island at 1 m resolution (the on-foot tile size from
 * plan 03 §8) with a beach, a cliff band with one walkable gully, a flattened yard of
 * test props (stairs, a too-tall ledge, a crouch-only overhang, crates, a gridded
 * building), a pier over deep water, trees and boulders. Seeded, so every run matches.
 */

export interface SpikeChunk extends OnFootZone {
  spawn: Transform;
  /** Extra stress props beyond the authored set. */
  stressProps: number;
}

const SIZE = 128;
const HALF = SIZE / 2;

/** Bilinear value noise over a seeded lattice, summed over octaves. */
function valueNoise(rng: Rng, octaves: number): (x: number, z: number) => number {
  const layers = Array.from({ length: octaves }, (_, o) => {
    const n = 4 << o;
    const lattice = Float32Array.from({ length: (n + 1) * (n + 1) }, () => rng.range(-1, 1));
    return { n, lattice, amp: 1 / (1 << o) };
  });
  const smooth = (t: number): number => t * t * (3 - 2 * t);
  return (x, z) => {
    let sum = 0;
    for (const { n, lattice, amp } of layers) {
      const fx = ((x + HALF) / SIZE) * n;
      const fz = ((z + HALF) / SIZE) * n;
      const i = Math.min(Math.max(Math.floor(fx), 0), n - 1);
      const j = Math.min(Math.max(Math.floor(fz), 0), n - 1);
      const u = smooth(fx - i);
      const v = smooth(fz - j);
      const at = (a: number, b: number): number => lattice[b * (n + 1) + a] ?? 0;
      const top = at(i, j) + (at(i + 1, j) - at(i, j)) * u;
      const bottom = at(i, j + 1) + (at(i + 1, j + 1) - at(i, j + 1)) * u;
      sum += (top + (bottom - top) * v) * amp;
    }
    return sum;
  };
}

const smoothstep = (a: number, b: number, t: number): number => {
  const x = Math.min(Math.max((t - a) / (b - a), 0), 1);
  return x * x * (3 - 2 * x);
};

/** The yard: a flat test area at this height. */
const YARD = { minX: -30, maxX: 6, minZ: 4, maxZ: 30, y: 3 };

function islandHeight(noise: (x: number, z: number) => number, x: number, z: number): number {
  // A dome that dips under the lake near the edges, pushed south to make a long beach.
  const r = Math.hypot(x, (z + 6) * 1.1);
  let h = 9 * (1 - (r / 54) ** 2) - 1.5 + noise(x, z) * 2.2;

  // A north-east plateau behind a cliff band, with a gentle gully cut through it.
  const across = (x - z) / Math.SQRT2 - 14;
  const along = (x + z) / Math.SQRT2;
  const gully = Math.abs(along - 2) < 4;
  const band = gully ? 14 : 1.6;
  h += 7 * smoothstep(-band / 2, band / 2, across) * smoothstep(60, 40, r);

  // Flatten the yard, blending over 6 m.
  const dx = Math.max(YARD.minX - x, 0, x - YARD.maxX);
  const dz = Math.max(YARD.minZ - z, 0, z - YARD.maxZ);
  const blend = smoothstep(6, 0, Math.hypot(dx, dz));
  return h + (YARD.y - h) * blend;
}

export function createSpikeChunk(seed = 'spike-s5', stressProps = 0): SpikeChunk {
  const rng = Rng.fromSeed(seed);
  const noise = valueNoise(rng, 4);
  const n = SIZE + 1;
  const heights = new Float32Array(n * n);
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) heights[j * n + i] = islandHeight(noise, i - HALF, j - HALF);
  }
  const ground = new Heightfield(n, n, 1, -HALF, -HALF, heights);
  const colliders = new ColliderSet();
  const y = YARD.y;
  const box = (
    x: number,
    z: number,
    sx: number,
    sz: number,
    y0: number,
    y1: number,
    yaw = 0,
  ): Collider => ({
    kind: 'box',
    x,
    z,
    halfX: sx / 2,
    halfZ: sz / 2,
    yaw,
    minY: y0,
    maxY: y1,
  });

  // Stairs: 0.25 m rises up to a 2 m platform, then a 0.6 m ledge that needs a vault.
  for (let k = 1; k <= 8; k++) colliders.add(box(-24 + k * 0.4, 8, 0.4, 2, y, y + k * 0.25));
  colliders.add(box(-19.1, 8, 3, 4, y, y + 2));
  colliders.add(box(-16.6, 8, 2, 4, y, y + 2.6));

  // Crouch-only overhang: a 1.3 m clearance roof on four posts.
  colliders.add(box(-8, 8, 4, 4, y + 1.3, y + 1.6));
  for (const [px, pz] of [
    [-9.8, 6.2],
    [-6.2, 6.2],
    [-9.8, 9.8],
    [-6.2, 9.8],
  ] as const) {
    colliders.add({ kind: 'cylinder', x: px, z: pz, radius: 0.12, minY: y, maxY: y + 1.3 });
  }

  // Crates: a low one to step on, a waist-high one that blocks, a rotated stack.
  colliders.add(box(-2, 8, 1, 1, y, y + 0.35));
  colliders.add(box(0, 8, 1, 1, y, y + 0.9));
  colliders.add(box(2.5, 9, 1.2, 1.2, y, y + 1.2, 0.5));
  colliders.add(box(2.5, 9, 1.0, 1.0, y + 1.2, y + 2.2, 0.9));

  // A narrow alley between two walls, 0.8 m wide (a capsule is 0.6 m).
  colliders.add(box(-14, 16, 6, 0.5, y, y + 3));
  colliders.add(box(-14, 17.3, 6, 0.5, y, y + 3));

  // A gridded L-shaped building (2 m cells, 4 m tall) with a doorway gap.
  const building = new OccupancyGrid(-28, 20, 2, 6, 4, y);
  for (let c = 0; c < 6; c++) {
    building.set(c, 0, 4);
    if (c !== 2) building.set(c, 3, 4);
  }
  for (let r = 0; r < 4; r++) {
    building.set(0, r, 4);
    building.set(5, r, 4);
  }
  colliders.addGrid(building);

  // A pier from the south beach over deep water: deck at 1.2 m on pilings.
  const pierX = 6;
  let pierStart = 30;
  while (pierStart < HALF - 2 && ground.heightAt(pierX, pierStart) > 0.9) pierStart++;
  const pierEnd = HALF - 2;
  const deckLen = pierEnd - pierStart + 4;
  colliders.add(box(pierX, pierStart - 2 + deckLen / 2, 3, deckLen, 0.9, 1.2));
  for (let pz = pierStart; pz <= pierEnd; pz += 3) {
    for (const side of [-1.3, 1.3]) {
      colliders.add({
        kind: 'cylinder',
        x: pierX + side,
        z: pz,
        radius: 0.15,
        minY: -6,
        maxY: 0.9,
      });
    }
  }

  // Trees and boulders on walkable dry ground outside the yard.
  const scatter = (count: number, place: (x: number, z: number, h: number) => void): void => {
    let placed = 0;
    for (let tries = 0; placed < count && tries < count * 20; tries++) {
      const x = rng.range(-HALF + 4, HALF - 4);
      const z = rng.range(-HALF + 4, HALF - 4);
      const h = ground.heightAt(x, z);
      if (h < 1.2 || ground.slopeAt(x, z) > 0.5) continue;
      if (x > YARD.minX - 4 && x < YARD.maxX + 4 && z > YARD.minZ - 4 && z < YARD.maxZ + 4)
        continue;
      place(x, z, h);
      placed++;
    }
  };
  scatter(140, (x, z, h) =>
    colliders.add({
      kind: 'cylinder',
      x,
      z,
      radius: rng.range(0.2, 0.45),
      minY: h - 0.5,
      maxY: h + 9,
    }),
  );
  scatter(50, (x, z, h) => {
    const s = rng.range(0.8, 2.4);
    colliders.add(
      box(x, z, s, s * rng.range(0.6, 1.2), h - 0.6, h + s * 0.6, rng.range(0, Math.PI)),
    );
  });
  scatter(stressProps, (x, z, h) => {
    const s = rng.range(0.4, 1.2);
    colliders.add(box(x, z, s, s, h - 0.3, h + rng.range(0.2, 1.5), rng.range(0, Math.PI)));
  });

  return {
    ground,
    colliders,
    waterLevel: 0,
    spawn: { position: { x: -12, y: y + 0.5, z: 13 }, heading: 0 },
    stressProps,
  };
}
