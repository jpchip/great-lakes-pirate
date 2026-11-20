import { calendarMs, iceForShelter, type IceSample } from './season';

/**
 * The ice in a zone, for drawing it (plan 04 §8.3; plan 11 §18.4 piece L). Piece K's ice
 * at a place is a function of its shelter and the date alone, so the zone needs only two
 * things: its shelter on a grid (once per zone) and the day's ice for each shelter (once a
 * calendar day). The water shader reads the first as a texture and the second as a
 * lookup strip; the sea's calm under the ice comes from the same pair, so the waves the
 * ship rides and the waves drawn agree.
 */

/** Entries in the day's lookup strip, shelter 0 to 1. */
export const ICE_LUT_SIZE = 64;
/** Thickness that reads as full in the strip's thickness channel, cm. */
export const ICE_LUT_CM = 50;

/**
 * The day's ice by shelter, RGBA bytes per entry: R the cover of ice in a sheet (forming,
 * fast or pack), G its thickness over `ICE_LUT_CM`, B the cover of floes at the break-up,
 * A how fast the sheet is (255 fast, 0 pack or thin ice still forming).
 */
export interface IceLut {
  /** Changes once a calendar day. */
  key: string;
  data: Uint8Array;
  /** The samples behind each entry. */
  samples: IceSample[];
  /** The most ice anywhere on the strip: 0 means a summer zone with nothing to draw. */
  maxCover: number;
}

const byte = (v: number): number => Math.round(Math.max(0, Math.min(1, v)) * 255);

/** The calendar day a game time falls in, as the lookup's key. */
export function iceDayKey(seed: string, gameSeconds: number): string {
  return `${seed}|${Math.floor(calendarMs(gameSeconds) / 86_400_000)}`;
}

export function buildIceLut(seed: string, gameSeconds: number, size = ICE_LUT_SIZE): IceLut {
  const data = new Uint8Array(size * 4);
  const samples: IceSample[] = [];
  let maxCover = 0;
  for (let i = 0; i < size; i++) {
    const s = iceForShelter(seed, i / (size - 1), gameSeconds);
    samples.push(s);
    const floes = s.kind === 'floes';
    const sheet = floes || s.kind === 'open' ? 0 : s.coverage;
    data[i * 4] = byte(sheet);
    data[i * 4 + 1] = byte(s.thicknessCm / ICE_LUT_CM);
    data[i * 4 + 2] = byte(floes ? s.coverage : 0);
    data[i * 4 + 3] = s.kind === 'fast' ? 255 : 0;
    maxCover = Math.max(maxCover, s.kind === 'open' ? 0 : s.coverage);
  }
  return { key: iceDayKey(seed, gameSeconds), data, samples, maxCover };
}

/** The strip's sample for a shelter, the nearer entry. */
export function lutSample(lut: IceLut, shelter: number): IceSample {
  const n = lut.samples.length;
  const i = Math.round(Math.max(0, Math.min(1, shelter)) * (n - 1));
  return lut.samples[i] as IceSample;
}

/**
 * How much of the sea's motion is left under ice, 0–1: a sheet stills it, floes damp it.
 * Thin ice still forming lets a little swell through.
 */
export function iceCalm(s: IceSample): number {
  if (s.kind === 'open') return 1;
  if (s.kind === 'floes') return 1 - 0.6 * s.coverage;
  const firm = Math.min(1, s.thicknessCm / 6);
  return Math.max(0.04, 1 - s.coverage * (0.55 + 0.41 * firm));
}

/** A zone's shelter on a regular grid (texel centers at (i + 0.5) · cellM), bytes 0–255. */
export interface ShelterGrid {
  minX: number;
  minZ: number;
  cellM: number;
  width: number;
  height: number;
  data: Uint8Array;
}

/**
 * Samples a zone's shelter over its bounds. `shelterAt` takes zone meters; the grid is
 * capped at `maxCells` a side (a 7 km zone at 32 m texels is about 220).
 */
export function buildShelterGrid(
  bounds: { minX: number; maxX: number; minZ: number; maxZ: number },
  shelterAt: (x: number, z: number) => number,
  cellM = 32,
  maxCells = 384,
): ShelterGrid {
  const extent = Math.max(bounds.maxX - bounds.minX, bounds.maxZ - bounds.minZ);
  const cell = Math.max(cellM, extent / maxCells);
  const width = Math.max(1, Math.ceil((bounds.maxX - bounds.minX) / cell));
  const height = Math.max(1, Math.ceil((bounds.maxZ - bounds.minZ) / cell));
  const data = new Uint8Array(width * height);
  for (let j = 0; j < height; j++) {
    const z = bounds.minZ + (j + 0.5) * cell;
    for (let i = 0; i < width; i++) {
      data[j * width + i] = byte(shelterAt(bounds.minX + (i + 0.5) * cell, z));
    }
  }
  return { minX: bounds.minX, minZ: bounds.minZ, cellM: cell, width, height, data };
}

/** The grid's shelter at a zone point, bilinear between texel centers, clamped at the edges. */
export function sampleShelterGrid(g: ShelterGrid, x: number, z: number): number {
  const fx = Math.min(Math.max((x - g.minX) / g.cellM - 0.5, 0), g.width - 1);
  const fz = Math.min(Math.max((z - g.minZ) / g.cellM - 0.5, 0), g.height - 1);
  const i0 = Math.floor(fx);
  const j0 = Math.floor(fz);
  const i1 = Math.min(i0 + 1, g.width - 1);
  const j1 = Math.min(j0 + 1, g.height - 1);
  const tx = fx - i0;
  const tz = fz - j0;
  const at = (i: number, j: number): number => (g.data[j * g.width + i] as number) / 255;
  const top = at(i0, j0) + (at(i1, j0) - at(i0, j0)) * tx;
  const bottom = at(i0, j1) + (at(i1, j1) - at(i0, j1)) * tx;
  return top + (bottom - top) * tz;
}
