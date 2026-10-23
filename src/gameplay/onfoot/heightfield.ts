/**
 * Ground collision for on-foot areas (plan 01 §2.2, plan 11 §3.1): a regular grid of
 * terrain heights, sampled bilinearly. Islands use the 1 m on-foot tiles from the geo
 * pipeline (plan 03 §8); the spike builds one procedurally.
 *
 * Zone coordinates in meters: x east, y up, z south. Sample (i, j) sits at
 * (originX + i·cellSize, originZ + j·cellSize).
 */
export class Heightfield {
  constructor(
    readonly samplesX: number,
    readonly samplesZ: number,
    readonly cellSize: number,
    readonly originX: number,
    readonly originZ: number,
    readonly heights: Float32Array,
  ) {
    if (heights.length !== samplesX * samplesZ) {
      throw new RangeError(`Expected ${samplesX * samplesZ} heights, got ${heights.length}`);
    }
  }

  get width(): number {
    return (this.samplesX - 1) * this.cellSize;
  }

  get depth(): number {
    return (this.samplesZ - 1) * this.cellSize;
  }

  sample(i: number, j: number): number {
    const ci = Math.min(Math.max(i, 0), this.samplesX - 1);
    const cj = Math.min(Math.max(j, 0), this.samplesZ - 1);
    return this.heights[cj * this.samplesX + ci] ?? 0;
  }

  /** Terrain height at (x, z). Outside the grid the edge samples extend outward. */
  heightAt(x: number, z: number): number {
    const { i, j, u, v } = this.cell(x, z);
    const h00 = this.sample(i, j);
    const h10 = this.sample(i + 1, j);
    const h01 = this.sample(i, j + 1);
    const h11 = this.sample(i + 1, j + 1);
    return h00 + (h10 - h00) * u + (h01 - h00) * v + (h00 - h10 - h01 + h11) * u * v;
  }

  /** Height gradient (∂h/∂x, ∂h/∂z) at (x, z): it points uphill. */
  gradientAt(x: number, z: number, out: { x: number; z: number }): { x: number; z: number } {
    const { i, j, u, v } = this.cell(x, z);
    const h00 = this.sample(i, j);
    const h10 = this.sample(i + 1, j);
    const h01 = this.sample(i, j + 1);
    const h11 = this.sample(i + 1, j + 1);
    out.x = ((h10 - h00) * (1 - v) + (h11 - h01) * v) / this.cellSize;
    out.z = ((h01 - h00) * (1 - u) + (h11 - h10) * u) / this.cellSize;
    return out;
  }

  /**
   * Gradient by central differences `span` meters wide. Wider than a cell, it smooths
   * the sawtooth that bilinear cells give a diagonal cliff edge.
   */
  smoothGradientAt(
    x: number,
    z: number,
    span: number,
    out: { x: number; z: number },
  ): { x: number; z: number } {
    const h = span / 2;
    out.x = (this.heightAt(x + h, z) - this.heightAt(x - h, z)) / span;
    out.z = (this.heightAt(x, z + h) - this.heightAt(x, z - h)) / span;
    return out;
  }

  /** Slope angle in radians (0 = flat), optionally smoothed over `span` meters. */
  slopeAt(x: number, z: number, span = 0): number {
    const g =
      span > 0 ? this.smoothGradientAt(x, z, span, scratch) : this.gradientAt(x, z, scratch);
    return Math.atan(Math.hypot(g.x, g.z));
  }

  private cell(x: number, z: number): { i: number; j: number; u: number; v: number } {
    const fx = Math.min(Math.max((x - this.originX) / this.cellSize, 0), this.samplesX - 1);
    const fz = Math.min(Math.max((z - this.originZ) / this.cellSize, 0), this.samplesZ - 1);
    const i = Math.min(Math.floor(fx), this.samplesX - 2);
    const j = Math.min(Math.floor(fz), this.samplesZ - 2);
    cellOut.i = i;
    cellOut.j = j;
    cellOut.u = fx - i;
    cellOut.v = fz - j;
    return cellOut;
  }
}

const scratch = { x: 0, z: 0 };
const cellOut = { i: 0, j: 0, u: 0, v: 0 };
