import { Heightfield } from '../../gameplay/onfoot/heightfield';
import { landHeight } from './geography';

/**
 * The greybox terrain as one true-scale grid in chart meters, sampled once. Every C
 * shares it: the zone heightfield is the same heights with a cell size of CELL / C,
 * and the render mesh is the same grid scaled by 1/C horizontally. Heights stay 1:1.
 */

/** Chart meters between samples (15.6 m in the zone at C = 8). */
export const CELL = 125;
/** Chart-space extent, roughly 30 × 33 nm around the zone reference. */
export const MIN_X = -29_000;
export const MAX_Y = 30_000;
export const SAMPLES_X = 457;
export const SAMPLES_Y = 497;

export interface GreyboxTerrain {
  /** Row j runs south from MAX_Y (zone +z); column i runs east from MIN_X. */
  readonly heights: Float32Array;
  /** The on-foot and grounding heightfield in zone meters for compression `c`. */
  heightfield(c: number): Heightfield;
}

export function chartAtSample(i: number, j: number): { x: number; y: number } {
  return { x: MIN_X + i * CELL, y: MAX_Y - j * CELL };
}

export function buildTerrain(): GreyboxTerrain {
  const heights = new Float32Array(SAMPLES_X * SAMPLES_Y);
  for (let j = 0; j < SAMPLES_Y; j++) {
    for (let i = 0; i < SAMPLES_X; i++) {
      const { x, y } = chartAtSample(i, j);
      heights[j * SAMPLES_X + i] = landHeight(x, y);
    }
  }
  const cache = new Map<number, Heightfield>();
  return {
    heights,
    heightfield(c) {
      let hf = cache.get(c);
      if (!hf) {
        hf = new Heightfield(SAMPLES_X, SAMPLES_Y, CELL / c, MIN_X / c, -MAX_Y / c, heights);
        cache.set(c, hf);
      }
      return hf;
    },
  };
}
