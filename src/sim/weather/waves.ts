/**
 * The shared Gerstner wave set (plan 01 §4.1, plan 04 §6.2). This module is the CPU half;
 * render/water/water-material.ts evaluates the same packed parameters in GLSL. Keep the
 * two in step: any change to the formula here must be mirrored in the shader.
 *
 * Coordinates are zone meters on the water plane (x east, z south). Time is seconds.
 */

export const GRAVITY = 9.81;

/** The most waves any preset draws (High). The uniform arrays are sized to this. */
export const MAX_WAVES = 8;

/** Gameplay always samples the first 4 waves, so buoyancy is identical on every preset. */
export const GAMEPLAY_WAVES = 4;

/** The summed steepness cap. At 1 the sharpest crests just touch; above it they loop. */
export const MAX_TOTAL_STEEPNESS = 0.9;

export interface GerstnerWave {
  /** Crest height above mean level, meters. */
  amplitude: number;
  /** Crest-to-crest distance, meters. */
  wavelength: number;
  /** Direction of travel, radians clockwise from north (same as headings). */
  direction: number;
  /**
   * Share of the crest-pinching budget, 0–1. Horizontal displacement is
   * steepness / k, so the sum over all waves must stay under 1 to avoid loops.
   */
  steepness: number;
  /** Phase offset, radians. */
  phase: number;
}

/** A packed wave, ready for the CPU sampler and the shader uniforms. */
export interface PackedWave {
  /** Unit direction of travel on the water plane. */
  dx: number;
  dz: number;
  /** Wavenumber 2π / wavelength. */
  k: number;
  amplitude: number;
  /** Angular frequency from deep-water dispersion, √(g·k). */
  omega: number;
  phase: number;
  steepness: number;
}

export function packWave(w: GerstnerWave): PackedWave {
  const k = (2 * Math.PI) / w.wavelength;
  return {
    // Clockwise from north with north = -z: east is +x, south is +z.
    dx: Math.sin(w.direction),
    dz: -Math.cos(w.direction),
    k,
    amplitude: w.amplitude,
    omega: Math.sqrt(GRAVITY * k),
    phase: w.phase,
    steepness: w.steepness,
  };
}

/** Packs a set and scales the steepness down if the set would loop. */
export function packWaves(waves: readonly GerstnerWave[]): PackedWave[] {
  if (waves.length > MAX_WAVES) {
    throw new RangeError(`At most ${MAX_WAVES} waves, got ${waves.length}`);
  }
  const packed = waves.map(packWave);
  const total = packed.reduce((sum, w) => sum + w.steepness, 0);
  if (total > MAX_TOTAL_STEEPNESS) {
    const scale = MAX_TOTAL_STEEPNESS / total;
    for (const w of packed) w.steepness *= scale;
  }
  return packed;
}

/**
 * Writes the set into two vec4 arrays for the shader:
 * a = (dx, dz, k, amplitude), b = (omega, phase, steepness, 0).
 */
export function writeWaveUniforms(
  waves: readonly PackedWave[],
  a: Float32Array,
  b: Float32Array,
): void {
  a.fill(0);
  b.fill(0);
  waves.forEach((w, i) => {
    a.set([w.dx, w.dz, w.k, w.amplitude], i * 4);
    b.set([w.omega, w.phase, w.steepness, 0], i * 4);
  });
}

export interface WaveSample {
  /** Surface displacement of the point that rests at (x0, z0). */
  dx: number;
  dy: number;
  dz: number;
}

/**
 * Gerstner displacement of the surface point whose rest position is (x0, z0). This is
 * what the vertex shader does to each water vertex.
 */
export function displacementAt(
  waves: readonly PackedWave[],
  count: number,
  x0: number,
  z0: number,
  t: number,
  out: WaveSample = { dx: 0, dy: 0, dz: 0 },
  scale = 1,
): WaveSample {
  out.dx = 0;
  out.dy = 0;
  out.dz = 0;
  const n = Math.min(count, waves.length);
  for (let i = 0; i < n; i++) {
    const w = waves[i] as PackedWave;
    const theta = w.k * (w.dx * x0 + w.dz * z0) - w.omega * t + w.phase;
    const c = Math.cos(theta);
    const horizontal = ((w.steepness * scale) / w.k) * c;
    out.dx += w.dx * horizontal;
    out.dz += w.dz * horizontal;
    out.dy += w.amplitude * scale * Math.sin(theta);
  }
  return out;
}

/**
 * Water height at a fixed world point. Gerstner waves move points sideways, so this
 * first finds the rest position that lands on (x, z), with Newton steps on the 2×2
 * Jacobian of the horizontal displacement. Three steps keep the error to millimeters
 * at the steepness cap; plain fixed-point iteration needed more than six for 1 cm.
 *
 * `scale` is the local sea scale (shelter and fetch, see SeaScaleGrid). It multiplies
 * amplitude and steepness alike, as the shader does at each rest position.
 */
export function heightAt(
  waves: readonly PackedWave[],
  count: number,
  x: number,
  z: number,
  t: number,
  iterations = 3,
  scale = 1,
): number {
  const n = Math.min(count, waves.length);
  let x0 = x;
  let z0 = z;
  for (let step = 0; step < iterations; step++) {
    // f(rest) = rest + horizontal(rest) − target, and its Jacobian J = I − Σ s·sinθ·d·dᵀ.
    let fx = x0 - x;
    let fz = z0 - z;
    let jxx = 1;
    let jxz = 0;
    let jzz = 1;
    for (let i = 0; i < n; i++) {
      const w = waves[i] as PackedWave;
      const theta = w.k * (w.dx * x0 + w.dz * z0) - w.omega * t + w.phase;
      const horizontal = ((w.steepness * scale) / w.k) * Math.cos(theta);
      fx += w.dx * horizontal;
      fz += w.dz * horizontal;
      const bend = w.steepness * scale * Math.sin(theta);
      jxx -= bend * w.dx * w.dx;
      jxz -= bend * w.dx * w.dz;
      jzz -= bend * w.dz * w.dz;
    }
    // The steepness cap keeps J positive definite, so it always inverts.
    const det = jxx * jzz - jxz * jxz;
    x0 -= (jzz * fx - jxz * fz) / det;
    z0 -= (jxx * fz - jxz * fx) / det;
  }
  let height = 0;
  for (let i = 0; i < n; i++) {
    const w = waves[i] as PackedWave;
    height += w.amplitude * Math.sin(w.k * (w.dx * x0 + w.dz * z0) - w.omega * t + w.phase);
  }
  return height * scale;
}

/**
 * The test bay's sea state for Phase 0: a moderate lake chop, short and steep
 * (plan 04 §6.1), out of the northwest. Waves are ordered by importance so the first 4
 * carry the motion that buoyancy feels; 5–8 add visual detail on Medium and High.
 * Plan 04 replaces this with the weather-to-waves mapping.
 */
export function testBaySea(scale = 1): GerstnerWave[] {
  const from = (deg: number): number => ((deg + 180) * Math.PI) / 180;
  const base: GerstnerWave[] = [
    { amplitude: 0.55, wavelength: 34, direction: from(315), steepness: 0.28, phase: 0 },
    { amplitude: 0.35, wavelength: 22, direction: from(290), steepness: 0.22, phase: 1.7 },
    { amplitude: 0.25, wavelength: 15, direction: from(340), steepness: 0.18, phase: 4.1 },
    { amplitude: 0.14, wavelength: 9, direction: from(300), steepness: 0.12, phase: 2.6 },
    { amplitude: 0.08, wavelength: 6.2, direction: from(260), steepness: 0.06, phase: 0.9 },
    { amplitude: 0.06, wavelength: 4.4, direction: from(355), steepness: 0.04, phase: 5.3 },
    { amplitude: 0.04, wavelength: 3.1, direction: from(320), steepness: 0.03, phase: 3.3 },
    { amplitude: 0.03, wavelength: 2.3, direction: from(280), steepness: 0.02, phase: 1.1 },
  ];
  return base.map((w) => ({
    ...w,
    amplitude: w.amplitude * scale,
    // Bigger seas are also steeper; packWaves enforces the cap.
    steepness: w.steepness * Math.min(scale, 1.6),
  }));
}

/**
 * How much of the zone's wave set reaches each spot: shelter and short fetch calm the
 * sea locally (plan 02 §11, plan 04 §6.1) while the set itself stays global. A byte grid
 * over the zone, value / SEA_SCALE_BYTE, sampled bilinearly with texel centers at
 * (i + 0.5) · cellM and clamped at the edges. The water shader reads the same bytes as
 * an R8 texture with linear filtering, so the CPU and GPU agree.
 */
export interface SeaScaleGrid {
  minX: number;
  minZ: number;
  cellM: number;
  width: number;
  height: number;
  data: Uint8Array;
}

/** The byte for a scale of 1. 255 caps the scale at 1.275. */
export const SEA_SCALE_BYTE = 200;

/** A one-cell grid: the full sea everywhere. */
export function uniformSeaScale(): SeaScaleGrid {
  return {
    minX: -1,
    minZ: -1,
    cellM: 2,
    width: 1,
    height: 1,
    data: new Uint8Array([SEA_SCALE_BYTE]),
  };
}

export function sampleSeaScale(grid: SeaScaleGrid, x: number, z: number): number {
  const fx = Math.min(Math.max((x - grid.minX) / grid.cellM - 0.5, 0), grid.width - 1);
  const fz = Math.min(Math.max((z - grid.minZ) / grid.cellM - 0.5, 0), grid.height - 1);
  const ix = Math.min(Math.floor(fx), grid.width - 2);
  const iz = Math.min(Math.floor(fz), grid.height - 2);
  if (ix < 0 || iz < 0) {
    // One row or column: interpolate along the other axis only.
    const i = Math.round(fz) * grid.width + Math.round(fx);
    return (grid.data[i] ?? SEA_SCALE_BYTE) / SEA_SCALE_BYTE;
  }
  const tx = fx - ix;
  const tz = fz - iz;
  const at = (cx: number, cz: number): number => grid.data[cz * grid.width + cx] ?? 0;
  const top = at(ix, iz) + (at(ix + 1, iz) - at(ix, iz)) * tx;
  const bottom = at(ix, iz + 1) + (at(ix + 1, iz + 1) - at(ix, iz + 1)) * tx;
  return (top + (bottom - top) * tz) / SEA_SCALE_BYTE;
}

/**
 * The live sea of the active zone: one wave set and its clock, read by buoyancy every
 * tick and by the water shader every frame. Not saved; the weather rebuilds it each
 * tick (sim/weather/sea-state.ts), so read `waves` fresh rather than caching it.
 */
export interface Sea {
  waves: PackedWave[];
  /** Seconds of wave time at the latest gameplay tick. */
  time: number;
  /** Local calming by shelter and fetch. */
  scale: SeaScaleGrid;
  /** Bumped whenever `waves` changes, so the water re-uploads its uniforms. */
  wavesVersion: number;
  /** Bumped whenever `scale` changes, so the water re-uploads its texture. */
  scaleVersion: number;
}

export function createSea(waves: readonly GerstnerWave[] = testBaySea()): Sea {
  return {
    waves: packWaves(waves),
    time: 0,
    scale: uniformSeaScale(),
    wavesVersion: 0,
    scaleVersion: 0,
  };
}

/** The local sea scale under (x, z). */
export function seaScaleAt(sea: Sea, x: number, z: number): number {
  return sampleSeaScale(sea.scale, x, z);
}

/** Swap in a new wave set (dev panel, weather) and tell the water. */
export function setSeaWaves(sea: Sea, waves: PackedWave[]): void {
  sea.waves = waves;
  sea.wavesVersion++;
}
