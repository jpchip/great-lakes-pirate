import { knotsToMs } from '../../core/coords';
import type { ShelterField } from './shelter';
import {
  GRAVITY,
  SEA_SCALE_BYTE,
  packWaves,
  setSeaWaves,
  type GerstnerWave,
  type Sea,
  type SeaScaleGrid,
} from './waves';

/**
 * From wind to waves (plan 04 §6): the zone's sea state follows the wind with a lag, maps
 * to one global Gerstner set, and a local scale grid calms it in the lee and over short
 * fetch. Phase 1 drives it from the dev-panel wind; Phase 2 feeds it the S9 sim.
 */

export interface SeaShape {
  /** Significant wave height, meters. */
  hsM: number;
  /** Wavelength of the peak (first) wave, meters. */
  peakWavelengthM: number;
  /** Mean direction the waves travel, radians clockwise from north. */
  towardRad: number;
}

/** Lake waves are shorter than the open-ocean fit for the same height (plan 04 §6.1). */
export const LAKE_WAVELENGTH = 0.85;
/** A flat calm still has a cat's-paw ripple, so the water never turns to glass. */
export const MIN_HS_M = 0.05;
export const MIN_PEAK_WAVELENGTH_M = 4;

/**
 * Fetch-limited wind sea from the JONSWAP fits, capped at a fully developed sea:
 * gHs/U² = 1.6e-3 √(gF/U²) ≤ 0.243 and gTp/U = 0.286 (gF/U²)^⅓ ≤ 8.13.
 * Superior is mostly fetch-limited: 20 kn over 60 km gives about 1.3 m at 5.3 s.
 */
export function windSea(speedKn: number, fetchM: number): { hsM: number; peakPeriodS: number } {
  const u = knotsToMs(Math.max(speedKn, 0));
  if (u < 0.1 || fetchM <= 0) return { hsM: 0, peakPeriodS: 0 };
  const g = GRAVITY;
  const fetchless = (g * fetchM) / (u * u);
  const hsM = Math.min(1.6e-3 * Math.sqrt(fetchless), 0.243) * ((u * u) / g);
  const peakPeriodS = Math.min(0.286 * Math.cbrt(fetchless), 8.13) * (u / g);
  return { hsM, peakPeriodS };
}

/** The sea a steady wind would raise, before lag. `gain` is the dev panel's sea multiplier. */
export function targetSeaShape(
  speedKn: number,
  windFromRad: number,
  fetchM: number,
  gain = 1,
): SeaShape {
  const { hsM, peakPeriodS } = windSea(speedKn, fetchM);
  const deepWavelength = (GRAVITY * peakPeriodS * peakPeriodS) / (2 * Math.PI);
  return {
    hsM: Math.max(hsM * gain, MIN_HS_M),
    peakWavelengthM: Math.max(deepWavelength * LAKE_WAVELENGTH, MIN_PEAK_WAVELENGTH_M),
    towardRad: wrapAngle(windFromRad + Math.PI),
  };
}

/**
 * The spectrum as 8 waves relative to the peak, ordered by size so the first 4 carry the
 * motion buoyancy feels (plan 04 §6.2). Ratios come from the S2 test-bay sea, which the
 * S2 and S7 playtests liked.
 */
const SPECTRUM: readonly {
  wavelength: number;
  amplitude: number;
  offsetDeg: number;
  phase: number;
}[] = [
  { wavelength: 1, amplitude: 1, offsetDeg: 0, phase: 0 },
  { wavelength: 0.65, amplitude: 0.64, offsetDeg: -25, phase: 1.7 },
  { wavelength: 0.44, amplitude: 0.45, offsetDeg: 25, phase: 4.1 },
  { wavelength: 0.26, amplitude: 0.25, offsetDeg: -15, phase: 2.6 },
  { wavelength: 0.18, amplitude: 0.15, offsetDeg: -55, phase: 0.9 },
  { wavelength: 0.13, amplitude: 0.11, offsetDeg: 40, phase: 5.3 },
  { wavelength: 0.09, amplitude: 0.07, offsetDeg: 5, phase: 3.3 },
  { wavelength: 0.068, amplitude: 0.055, offsetDeg: -35, phase: 1.1 },
];

/** Hs = 4σ and σ² = Σ A² / 2, so the peak amplitude for a given Hs is fixed. */
const SPECTRUM_SIGMA = Math.sqrt(SPECTRUM.reduce((s, w) => s + w.amplitude ** 2, 0) / 2);

/**
 * Crest sharpness relative to k·A. Lake chop is short and steep, so this runs well above
 * the 1.0 of a plain Gerstner wave; packWaves caps the total.
 */
export const LAKE_STEEPNESS = 2.6;
export const MAX_WAVE_STEEPNESS = 0.32;

export function waveSet(shape: SeaShape): GerstnerWave[] {
  const peakAmplitude = shape.hsM / (4 * SPECTRUM_SIGMA);
  return SPECTRUM.map((s) => {
    const wavelength = shape.peakWavelengthM * s.wavelength;
    const amplitude = peakAmplitude * s.amplitude;
    const k = (2 * Math.PI) / wavelength;
    return {
      amplitude,
      wavelength,
      direction: wrapAngle(shape.towardRad + (s.offsetDeg * Math.PI) / 180),
      steepness: Math.min(LAKE_STEEPNESS * k * amplitude, MAX_WAVE_STEEPNESS),
      phase: s.phase,
    };
  });
}

/**
 * Swaps a new wave set into the sea without the surface jumping. A wave's phase at a
 * point is k·(d·p) − ω·t + φ; when k, d or ω change, φ is solved so the phase at the
 * anchor (the player) is unchanged. Far from the anchor the pattern slides a little per
 * change, which slow, small, per-tick changes keep invisible.
 */
export function retuneSea(sea: Sea, next: readonly GerstnerWave[], ax: number, az: number): void {
  const packed = packWaves(next);
  const t = sea.time;
  packed.forEach((w, i) => {
    const old = sea.waves[i];
    if (!old) return;
    const before = old.k * (old.dx * ax + old.dz * az) - old.omega * t + old.phase;
    const after = w.k * (w.dx * ax + w.dz * az) - w.omega * t;
    w.phase = wrapAngle(before - after);
  });
  setSeaWaves(sea, packed);
}

/** Eases the current shape toward the target. `tauS` is the e-folding time, game seconds. */
export function easeSeaShape(
  current: SeaShape,
  target: SeaShape,
  dtGameS: number,
  tauS: number,
): SeaShape {
  if (tauS <= 0) return { ...target };
  const a = 1 - Math.exp(-dtGameS / tauS);
  // Direction turns faster than height builds: a new wind sea starts on the new heading.
  const turn = 1 - Math.exp((-2 * dtGameS) / tauS);
  let dDir = wrapAngle(target.towardRad - current.towardRad);
  if (dDir > Math.PI) dDir -= 2 * Math.PI;
  return {
    hsM: current.hsM + (target.hsM - current.hsM) * a,
    peakWavelengthM:
      current.peakWavelengthM + (target.peakWavelengthM - current.peakWavelengthM) * a,
    towardRad: wrapAngle(current.towardRad + dDir * turn),
  };
}

export function seaShapeChanged(a: SeaShape, b: SeaShape): boolean {
  let dDir = Math.abs(wrapAngle(a.towardRad - b.towardRad));
  dDir = Math.min(dDir, 2 * Math.PI - dDir);
  return (
    Math.abs(a.hsM - b.hsM) > 1e-4 * Math.max(a.hsM, 0.1) ||
    Math.abs(a.peakWavelengthM - b.peakWavelengthM) > 1e-4 * a.peakWavelengthM ||
    dDir > 1e-5
  );
}

// ---------------------------------------------------------------------------------
// Local scale: shelter and fetch

/** How much of the sea a fully sheltered spot loses (plan 02 §11: the lee is a refuge). */
export const SHELTER_WAVE_DAMPING = 0.8;
export const MIN_FETCH_SCALE = 0.15;
export const MAX_SEA_SCALE = 1.25;
/** The most cells along a side of the scale grid; the cell grows for larger zones. */
export const SEA_GRID_MAX_CELLS = 256;
export const SEA_GRID_MIN_CELL_M = 16;

/**
 * The local sea scale at one spot. Hs grows with √fetch when fetch-limited, so short
 * fetch scales by √(fetch / reference); the lee takes up to SHELTER_WAVE_DAMPING more off.
 */
export function localSeaScale(shelter01: number, fetchM: number, referenceFetchM: number): number {
  const fetch = Math.sqrt(Math.max(fetchM, 0) / Math.max(referenceFetchM, 1));
  const clamped = Math.min(Math.max(fetch, MIN_FETCH_SCALE), MAX_SEA_SCALE);
  return clamped * (1 - SHELTER_WAVE_DAMPING * Math.min(Math.max(shelter01, 0), 1));
}

export interface SeaScaleBake {
  grid: SeaScaleGrid;
  /** The fetch the global set is built for: the 90th percentile over the zone, real meters. */
  referenceFetchM: number;
}

/** Fetch histogram bins (log-spaced, 100 m to 1000 km) for the reference percentile. */
const FETCH_BINS = 128;
const FETCH_LOG_MIN = Math.log(100);
const FETCH_LOG_MAX = Math.log(1_000_000);

export interface SeaScaleBaker {
  /** Bakes up to `rows` more rows; returns the finished bake on the last one. */
  step(rows: number): SeaScaleBake | undefined;
}

/**
 * Bakes the scale grid for one wind direction, a few rows per tick so a wind shift never
 * costs a frame: one shelter and one fetch lookup per cell. The reference fetch is the
 * 90th percentile over the zone's water, from a log histogram.
 */
export function createSeaScaleBaker(field: ShelterField, fromRad: number): SeaScaleBaker {
  const { minX, minZ, maxX, maxZ } = field.bounds;
  const extent = Math.max(maxX - minX, maxZ - minZ);
  const cellM = Math.max(SEA_GRID_MIN_CELL_M, extent / SEA_GRID_MAX_CELLS);
  const width = Math.max(1, Math.ceil((maxX - minX) / cellM));
  const height = Math.max(1, Math.ceil((maxZ - minZ) / cellM));
  const shelter = new Float32Array(width * height);
  const fetch = new Float32Array(width * height);
  const histogram = new Uint32Array(FETCH_BINS);
  let water = 0;
  let row = 0;

  const finish = (): SeaScaleBake => {
    let referenceFetchM = 1000;
    let seen = 0;
    for (let b = 0; b < FETCH_BINS; b++) {
      seen += histogram[b] ?? 0;
      if (seen >= water * 0.9 && water > 0) {
        const upper = FETCH_LOG_MIN + ((b + 1) / FETCH_BINS) * (FETCH_LOG_MAX - FETCH_LOG_MIN);
        referenceFetchM = Math.max(Math.exp(upper), 1000);
        break;
      }
    }
    const data = new Uint8Array(width * height);
    for (let c = 0; c < data.length; c++) {
      const s = localSeaScale(shelter[c] ?? 0, fetch[c] ?? 0, referenceFetchM);
      data[c] = Math.min(255, Math.round(s * SEA_SCALE_BYTE));
    }
    return { grid: { minX, minZ, cellM, width, height, data }, referenceFetchM };
  };

  return {
    step(rows) {
      const last = Math.min(height, row + rows);
      for (; row < last; row++) {
        const z = minZ + (row + 0.5) * cellM;
        for (let i = 0; i < width; i++) {
          const x = minX + (i + 0.5) * cellM;
          const c = row * width + i;
          shelter[c] = field.shelterAt(x, z, fromRad);
          const f = field.fetchAt(x, z, fromRad);
          fetch[c] = f;
          if (f > 0) {
            water++;
            const t =
              (Math.log(Math.max(f, 100)) - FETCH_LOG_MIN) / (FETCH_LOG_MAX - FETCH_LOG_MIN);
            const bin = Math.min(FETCH_BINS - 1, Math.max(0, Math.floor(t * FETCH_BINS)));
            histogram[bin] = (histogram[bin] ?? 0) + 1;
          }
        }
      }
      return row >= height ? finish() : undefined;
    },
  };
}

/** The whole bake at once (start-up, tests). */
export function bakeSeaScale(field: ShelterField, fromRad: number): SeaScaleBake {
  const baker = createSeaScaleBaker(field, fromRad);
  let bake: SeaScaleBake | undefined;
  while (!bake) bake = baker.step(SEA_GRID_MAX_CELLS);
  return bake;
}

export function wrapAngle(rad: number): number {
  const twoPi = 2 * Math.PI;
  return ((rad % twoPi) + twoPi) % twoPi;
}
