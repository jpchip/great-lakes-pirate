/**
 * Seeded RNG (plan 01 §8). The only randomness allowed in sim/. The state is four
 * uint32 words and is saved with the run, so a reload continues the same sequence
 * (plan 16 §4.4).
 */

export type RngState = [number, number, number, number];

/** cyrb128: hash a string seed into four 32-bit words. */
function hashSeed(seed: string): RngState {
  let h1 = 1779033703;
  let h2 = 3144134277;
  let h3 = 1013904242;
  let h4 = 2773480762;
  for (let i = 0; i < seed.length; i++) {
    const k = seed.charCodeAt(i);
    h1 = h2 ^ Math.imul(h1 ^ k, 597399067);
    h2 = h3 ^ Math.imul(h2 ^ k, 2869860233);
    h3 = h4 ^ Math.imul(h3 ^ k, 951274213);
    h4 = h1 ^ Math.imul(h4 ^ k, 2716044179);
  }
  h1 = Math.imul(h3 ^ (h1 >>> 18), 597399067);
  h2 = Math.imul(h4 ^ (h2 >>> 22), 2869860233);
  h3 = Math.imul(h1 ^ (h3 >>> 17), 951274213);
  h4 = Math.imul(h2 ^ (h4 >>> 19), 2716044179);
  h1 ^= h2 ^ h3 ^ h4;
  h2 ^= h1;
  h3 ^= h1;
  h4 ^= h1;
  return [h1 >>> 0, h2 >>> 0, h3 >>> 0, h4 >>> 0];
}

/** sfc32: small, fast, passes PractRand; plenty for gameplay. */
export class Rng {
  private s: RngState;

  private constructor(state: RngState) {
    this.s = [...state];
  }

  static fromSeed(seed: string): Rng {
    const rng = new Rng(hashSeed(seed));
    // Discard the first outputs; sfc32 mixes poorly for the first few steps.
    for (let i = 0; i < 12; i++) rng.nextUint32();
    return rng;
  }

  static fromState(state: Readonly<RngState>): Rng {
    return new Rng([state[0] >>> 0, state[1] >>> 0, state[2] >>> 0, state[3] >>> 0]);
  }

  getState(): RngState {
    return [...this.s];
  }

  nextUint32(): number {
    let [a, b, c, d] = this.s;
    const t = (((a + b) | 0) + d) | 0;
    d = (d + 1) | 0;
    a = b ^ (b >>> 9);
    b = (c + (c << 3)) | 0;
    c = (c << 21) | (c >>> 11);
    c = (c + t) | 0;
    this.s = [a >>> 0, b >>> 0, c >>> 0, d >>> 0];
    return t >>> 0;
  }

  /** Uniform float in [0, 1). */
  next(): number {
    return this.nextUint32() / 4294967296;
  }

  /** Uniform float in [min, max). */
  range(min: number, max: number): number {
    return min + (max - min) * this.next();
  }

  /** Uniform integer in [min, max] (inclusive). */
  int(min: number, max: number): number {
    if (!Number.isInteger(min) || !Number.isInteger(max) || max < min) {
      throw new RangeError(`Invalid int range [${min}, ${max}]`);
    }
    return min + Math.floor(this.next() * (max - min + 1));
  }

  chance(p: number): boolean {
    return this.next() < p;
  }

  pick<T>(items: readonly T[]): T {
    if (items.length === 0) throw new RangeError('Cannot pick from an empty list');
    return items[this.int(0, items.length - 1)] as T;
  }
}
