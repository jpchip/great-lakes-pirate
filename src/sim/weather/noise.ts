/**
 * Stateless, seeded 1D value noise for slow wind drift and gusts. It's a pure function
 * of (seed, t), so queries at any time are deterministic and nothing extra is saved.
 */

function hash(seed: number, i: number): number {
  let h = Math.imul(seed ^ Math.imul(i, 0x27d4eb2d), 0x165667b1);
  h ^= h >>> 15;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

/** Smooth noise in [-1, 1] with one feature per unit of `t`. */
export function valueNoise(seed: number, t: number): number {
  const i = Math.floor(t);
  const f = t - i;
  const s = f * f * (3 - 2 * f);
  const a = hash(seed, i);
  const b = hash(seed, i + 1);
  return (a + (b - a) * s) * 2 - 1;
}

/** Two octaves, still in [-1, 1]. */
export function fractalNoise(seed: number, t: number): number {
  return (valueNoise(seed, t) * 2 + valueNoise(seed + 1, t * 2.7)) / 3;
}
