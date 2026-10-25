/**
 * A regular grid of values over the zone's water plane, sampled bilinearly. Used for the
 * baked terrain heights, the shoreline SDF and the wind maps (plan 03 §8.2).
 *
 * Zone coordinates in meters: x east, z south. Sample (i, j) sits at
 * (x0 + i·step, z0 + j·step), row-major. Outside the grid the edge samples extend outward.
 */
export class GridField {
  constructor(
    readonly x0: number,
    readonly z0: number,
    readonly step: number,
    readonly width: number,
    readonly height: number,
    readonly values: Float32Array,
  ) {
    if (values.length !== width * height) {
      throw new RangeError(`grid field: expected ${width * height} values, got ${values.length}`);
    }
  }

  get maxX(): number {
    return this.x0 + (this.width - 1) * this.step;
  }

  get maxZ(): number {
    return this.z0 + (this.height - 1) * this.step;
  }

  /** The sample at column i, row j, clamped to the grid. */
  at(i: number, j: number): number {
    const ci = i < 0 ? 0 : i >= this.width ? this.width - 1 : i;
    const cj = j < 0 ? 0 : j >= this.height ? this.height - 1 : j;
    return this.values[cj * this.width + ci] ?? 0;
  }

  sample(x: number, z: number): number {
    const fx = (x - this.x0) / this.step;
    const fz = (z - this.z0) / this.step;
    const i = Math.floor(fx);
    const j = Math.floor(fz);
    const u = fx - i;
    const v = fz - j;
    const a = this.at(i, j);
    const b = this.at(i + 1, j);
    const c = this.at(i, j + 1);
    const d = this.at(i + 1, j + 1);
    return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
  }

  /** Central-difference gradient (∂/∂x, ∂/∂z) over one step: it points uphill. */
  gradient(x: number, z: number, out: { x: number; z: number }): { x: number; z: number } {
    const h = this.step;
    out.x = (this.sample(x + h, z) - this.sample(x - h, z)) / (2 * h);
    out.z = (this.sample(x, z + h) - this.sample(x, z - h)) / (2 * h);
    return out;
  }

  /** A copy of columns i0…i0+width−1 and rows j0…j0+height−1 (clamped to the grid). */
  crop(i0: number, j0: number, width: number, height: number): GridField {
    const values = new Float32Array(width * height);
    for (let j = 0; j < height; j++) {
      for (let i = 0; i < width; i++) values[j * width + i] = this.at(i0 + i, j0 + j);
    }
    return new GridField(
      this.x0 + i0 * this.step,
      this.z0 + j0 * this.step,
      this.step,
      width,
      height,
      values,
    );
  }
}
