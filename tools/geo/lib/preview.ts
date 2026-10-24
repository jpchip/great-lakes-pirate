// Preview images for checking a bake by eye (not shipped to the game).

import type { Raster } from './raster.ts';
import type { Footprint } from './islands.ts';

type RGB = [number, number, number];

const lerp = (a: RGB, b: RGB, t: number): RGB => [
  a[0] + (b[0] - a[0]) * t,
  a[1] + (b[1] - a[1]) * t,
  a[2] + (b[2] - a[2]) * t,
];

function ramp(stops: [number, RGB][], v: number): RGB {
  let prev: [number, RGB] | undefined;
  for (const stop of stops) {
    if (v <= stop[0])
      return prev ? lerp(prev[1], stop[1], (v - prev[0]) / (stop[0] - prev[0])) : stop[1];
    prev = stop;
  }
  return prev ? prev[1] : [0, 0, 0];
}

const DEPTH: [number, RGB][] = [
  [-120, [12, 38, 78]],
  [-40, [28, 78, 130]],
  [-10, [70, 140, 185]],
  [-2, [150, 205, 220]],
  [0, [190, 228, 232]],
];
const LAND: [number, RGB][] = [
  [0, [214, 200, 150]],
  [4, [120, 150, 90]],
  [60, [80, 120, 70]],
  [150, [140, 120, 90]],
  [300, [235, 230, 225]],
];

/**
 * Shaded relief: depth tint over water, elevation tint over land, lit from the north-west.
 * `stepReal` is real meters between samples, so the shading isn't flattened by compression.
 */
export function relief(
  height: Raster,
  stepReal: number,
  every = 1,
): { rgb: Uint8Array; width: number; height: number } {
  const w = Math.floor((height.width - 1) / every) + 1;
  const h = Math.floor((height.height - 1) / every) + 1;
  const rgb = new Uint8Array(w * h * 3);
  const at = (x: number, y: number) =>
    height.data[
      Math.min(height.height - 1, Math.max(0, y)) * height.width +
        Math.min(height.width - 1, Math.max(0, x))
    ] ?? 0;
  const light = [-0.5, -0.5, 0.707];
  for (let j = 0; j < h; j++) {
    for (let i = 0; i < w; i++) {
      const x = i * every;
      const y = j * every;
      const v = at(x, y);
      const dx = (at(x + 1, y) - at(x - 1, y)) / (2 * stepReal);
      const dy = (at(x, y + 1) - at(x, y - 1)) / (2 * stepReal);
      const n = [-dx * 3, -dy * 3, 1];
      const len = Math.hypot(n[0] ?? 0, n[1] ?? 0, n[2] ?? 0);
      const shade = Math.max(
        0,
        ((n[0] ?? 0) * (light[0] ?? 0) +
          (n[1] ?? 0) * (light[1] ?? 0) +
          (n[2] ?? 0) * (light[2] ?? 0)) /
          len,
      );
      const base = v > 0 ? ramp(LAND, v) : ramp(DEPTH, v);
      const k = v > 0 ? 0.35 + 0.75 * shade : 0.85 + 0.2 * shade;
      const o = (j * w + i) * 3;
      rgb[o] = Math.min(255, base[0] * k);
      rgb[o + 1] = Math.min(255, base[1] * k);
      rgb[o + 2] = Math.min(255, base[2] * k);
    }
  }
  return { rgb, width: w, height: h };
}

/** Draws each footprint's box (in `every`-scaled sample units) in red. */
export function drawFootprints(
  img: { rgb: Uint8Array; width: number; height: number },
  prints: Footprint[],
  every: number,
): void {
  const put = (x: number, y: number) => {
    if (x < 0 || y < 0 || x >= img.width || y >= img.height) return;
    const o = (y * img.width + x) * 3;
    img.rgb[o] = 230;
    img.rgb[o + 1] = 40;
    img.rgb[o + 2] = 40;
  };
  for (const p of prints) {
    const x0 = Math.floor(p.i0 / every);
    const x1 = Math.ceil(p.i1 / every);
    const y0 = Math.floor(p.j0 / every);
    const y1 = Math.ceil(p.j1 / every);
    for (let x = x0; x <= x1; x++) {
      put(x, y0);
      put(x, y1);
    }
    for (let y = y0; y <= y1; y++) {
      put(x0, y);
      put(x1, y);
    }
  }
}

/** A single-direction wind map layer as a grayscale-on-blue image, land in tan. */
export function windLayer(
  values: Float32Array,
  layer: number,
  width: number,
  height: number,
  max: number,
): { rgb: Uint8Array; width: number; height: number } {
  const rgb = new Uint8Array(width * height * 3);
  const n = width * height;
  for (let k = 0; k < n; k++) {
    const v = Math.min(1, (values[layer * n + k] ?? 0) / max);
    const c = ramp(
      [
        [0, [20, 30, 60]],
        [0.5, [60, 160, 170]],
        [1, [250, 240, 180]],
      ],
      v,
    );
    rgb[k * 3] = c[0];
    rgb[k * 3 + 1] = c[1];
    rgb[k * 3 + 2] = c[2];
  }
  return { rgb, width, height };
}
