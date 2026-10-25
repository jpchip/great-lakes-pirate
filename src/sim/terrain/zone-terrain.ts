import type { GridField } from './grid-field';

/**
 * Runtime terrain queries for the loaded part of a coastal zone (plan 03 §8.3): heights
 * and depth for grounding, the shoreline SDF for push-back, and the baked shelter, fetch
 * and funneling maps that windAt and waveParams sample (plan 02 §11).
 *
 * Zone coordinates in meters, x east, z south. Directions are radians clockwise from
 * north, the same as headings. Outside the loaded bounds every query clamps to the edge.
 */

export interface TerrainBounds {
  minX: number;
  minZ: number;
  maxX: number;
  maxZ: number;
}

const TWO_PI = Math.PI * 2;

/**
 * The 16-direction wind maps on 32 m cells. Layer k is wind FROM bearing k × 360°/16.
 * Land cells hold 0 in every map, so sampling weights only the water cells around a
 * point; otherwise shelter would dip toward "full wind" along every shore.
 */
export class WindMaps {
  /** Per-cell weight: 1 over water, 0 on land. */
  private readonly water: Float32Array;
  private readonly weights = new Float32Array(4);
  private readonly cells = new Int32Array(4);

  /**
   * `shelter`, `fetch` and `funnel` hold one grid per direction, sharing one frame whose
   * samples sit at the cell centers.
   */
  constructor(
    readonly shelter: readonly GridField[],
    readonly fetch: readonly GridField[],
    readonly funnel: readonly GridField[],
  ) {
    const first = fetch[0];
    if (!first || shelter.length !== fetch.length || funnel.length !== fetch.length) {
      throw new RangeError('wind maps: need the same number of shelter, fetch and funnel layers');
    }
    // Fetch is at least one cell of open water everywhere off the shore, and 0 on land.
    this.water = first.values.map((v) => (v > 0 ? 1 : 0));
  }

  get directions(): number {
    return this.fetch.length;
  }

  /** Map value at (x, z) for wind from `fromRad`, blended between the two nearest layers. */
  sample(maps: readonly GridField[], x: number, z: number, fromRad: number): number {
    if (!this.spatialWeights(x, z)) return 0;
    const n = maps.length;
    const turns = (((fromRad % TWO_PI) + TWO_PI) % TWO_PI) / TWO_PI;
    const f = turns * n;
    const k0 = Math.floor(f) % n;
    const k1 = (k0 + 1) % n;
    const t = f - Math.floor(f);
    const a = this.weighted(maps[k0]);
    if (t === 0) return a;
    return a + (this.weighted(maps[k1]) - a) * t;
  }

  /** Bilinear weights over the water cells around (x, z); false when they're all land. */
  private spatialWeights(x: number, z: number): boolean {
    const grid = this.fetch[0] as GridField;
    const { width, height } = grid;
    const fx = Math.min(Math.max((x - grid.x0) / grid.step, 0), width - 1);
    const fz = Math.min(Math.max((z - grid.z0) / grid.step, 0), height - 1);
    const i = Math.min(Math.floor(fx), width - 2);
    const j = Math.min(Math.floor(fz), height - 2);
    const u = fx - i;
    const v = fz - j;
    const c = this.cells;
    c[0] = j * width + i;
    c[1] = c[0] + 1;
    c[2] = c[0] + width;
    c[3] = c[2] + 1;
    const w = this.weights;
    w[0] = (1 - u) * (1 - v) * (this.water[c[0]] ?? 0);
    w[1] = u * (1 - v) * (this.water[c[1]] ?? 0);
    w[2] = (1 - u) * v * (this.water[c[2]] ?? 0);
    w[3] = u * v * (this.water[c[3]] ?? 0);
    const sum = w[0] + w[1] + w[2] + w[3];
    if (sum <= 1e-6) return false;
    for (let k = 0; k < 4; k++) w[k] = (w[k] ?? 0) / sum;
    return true;
  }

  private weighted(map: GridField | undefined): number {
    if (!map) return 0;
    const { values } = map;
    let out = 0;
    for (let k = 0; k < 4; k++) out += (this.weights[k] ?? 0) * (values[this.cells[k] ?? 0] ?? 0);
    return out;
  }
}

export class ZoneTerrain {
  readonly bounds: TerrainBounds;
  private readonly grad = { x: 0, z: 0 };

  /**
   * @param height meters above mean lake level (negative is the lake bottom), 4 m samples
   * @param sdf    meters to the shoreline, positive over water
   */
  constructor(
    readonly zoneId: string,
    readonly height: GridField,
    readonly sdf: GridField,
    readonly wind: WindMaps,
  ) {
    this.bounds = { minX: height.x0, minZ: height.z0, maxX: height.maxX, maxZ: height.maxZ };
  }

  contains(x: number, z: number): boolean {
    const b = this.bounds;
    return x >= b.minX && x <= b.maxX && z >= b.minZ && z <= b.maxZ;
  }

  /** Ground height above mean lake level, meters (negative under water). */
  heightAt(x: number, z: number): number {
    return this.height.sample(x, z);
  }

  /** Water depth below mean lake level, meters; 0 on land. Aground when depth < draft. */
  depthAt(x: number, z: number): number {
    return Math.max(0, -this.height.sample(x, z));
  }

  /** Signed distance to the shoreline, meters: positive over water, negative on land. */
  shoreDistanceAt(x: number, z: number): number {
    return this.sdf.sample(x, z);
  }

  /**
   * Unit vector on the water plane pointing away from the nearest shore (toward open
   * water): the push-back direction for rock and shore collisions.
   */
  shoreNormalAt(x: number, z: number, out: { x: number; z: number }): { x: number; z: number } {
    this.sdf.gradient(x, z, this.grad);
    const len = Math.hypot(this.grad.x, this.grad.z);
    if (len < 1e-6) {
      out.x = 0;
      out.z = 0;
    } else {
      out.x = this.grad.x / len;
      out.z = this.grad.z / len;
    }
    return out;
  }

  /** Wind shelter at (x, z) for wind from `fromRad`: 0 = full wind, 1 = fully blocked. */
  shelterAt(x: number, z: number, fromRad: number): number {
    return this.wind.sample(this.wind.shelter, x, z, fromRad);
  }

  /** Open water upwind of (x, z), in REAL meters (the weather sim's units; plan 03 §14.2). */
  fetchAt(x: number, z: number, fromRad: number): number {
    return this.wind.sample(this.wind.fetch, x, z, fromRad);
  }

  /**
   * Channel funneling strength at (x, z), 0–1 (0 = none). windAt turns it into a speed
   * factor (plan 02 §11).
   */
  funnelAt(x: number, z: number, fromRad: number): number {
    return this.wind.sample(this.wind.funnel, x, z, fromRad);
  }
}
