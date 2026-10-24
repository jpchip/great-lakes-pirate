// Finds each named island in the sailing heightmap and works out its on-foot footprint.

import type { Raster } from './raster.ts';
import {
  chartToZone,
  geoToChart,
  type GridFrame,
  type IslandConfig,
  type ZoneFrame,
} from './zone.ts';

export interface Footprint {
  island: IslandConfig;
  /** Sample-index box on the grid that was searched, inclusive. */
  i0: number;
  j0: number;
  i1: number;
  j1: number;
  /** Land samples in the island's component (or in its clip box). */
  landSamples: number;
  maxHeight: number;
  /** How the island was found, for the build report. */
  method: 'component' | 'bounds' | 'nearest' | 'missing';
}

/** 8-connected land components. Returns a label per sample (0 = water) and component sizes. */
export function labelLand(height: Raster): { labels: Int32Array; sizes: number[] } {
  const { width, height: h, data } = height;
  const labels = new Int32Array(width * h);
  const sizes = [0];
  const stack = new Int32Array(width * h);
  for (let start = 0; start < labels.length; start++) {
    if (labels[start] || (data[start] ?? 0) <= 0) continue;
    const label = sizes.length;
    let size = 0;
    let top = 0;
    stack[top++] = start;
    labels[start] = label;
    while (top) {
      const k = stack[--top] ?? 0;
      size++;
      const x = k % width;
      const y = (k - x) / width;
      for (let dy = -1; dy <= 1; dy++) {
        const ny = y + dy;
        if (ny < 0 || ny >= h) continue;
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx;
          if (nx < 0 || nx >= width) continue;
          const nk = ny * width + nx;
          if (labels[nk] || (data[nk] ?? 0) <= 0) continue;
          labels[nk] = label;
          stack[top++] = nk;
        }
      }
    }
    sizes.push(size);
  }
  return { labels, sizes };
}

/**
 * Matches each configured island to a land component: the one under its point, else the
 * nearest within `searchM` game meters. A component touching the zone edge is the mainland,
 * so an island joined to it (Long Island) needs a `bounds` clip box in the config.
 */
export function findIslands(
  height: Raster,
  grid: GridFrame,
  frame: ZoneFrame,
  islands: IslandConfig[],
  searchM = 60,
): Footprint[] {
  const { labels, sizes } = labelLand(height);
  const { width, height: h } = height;
  const edge = new Set<number>();
  for (let x = 0; x < width; x++) {
    edge.add(labels[x] ?? 0);
    edge.add(labels[(h - 1) * width + x] ?? 0);
  }
  for (let y = 0; y < h; y++) {
    edge.add(labels[y * width] ?? 0);
    edge.add(labels[y * width + width - 1] ?? 0);
  }

  const toSample = (lat: number, lon: number) => {
    const c = geoToChart({ lat, lon });
    const z = chartToZone(frame, c.x, c.y);
    return {
      i: Math.round((z.x - grid.x0) / grid.step),
      j: Math.round((z.z - grid.z0) / grid.step),
    };
  };
  const clampI = (i: number) => Math.min(width - 1, Math.max(0, i));
  const clampJ = (j: number) => Math.min(h - 1, Math.max(0, j));

  return islands.map((island): Footprint => {
    if (island.bounds) {
      const a = toSample(island.bounds.north, island.bounds.west);
      const b = toSample(island.bounds.south, island.bounds.east);
      const box = { i0: clampI(a.i), j0: clampJ(a.j), i1: clampI(b.i), j1: clampJ(b.j) };
      return { island, ...box, ...measure(height, box), method: 'bounds' };
    }
    const p = toSample(island.lat, island.lon);
    const r = Math.ceil(searchM / grid.step);
    let label = 0;
    let best = Infinity;
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        const x = p.i + dx;
        const y = p.j + dy;
        if (x < 0 || y < 0 || x >= width || y >= h) continue;
        const l = labels[y * width + x] ?? 0;
        const d = dx * dx + dy * dy;
        if (l && !edge.has(l) && d < best) {
          best = d;
          label = l;
        }
      }
    }
    if (!label) {
      // Too small or too low to show up at this resolution: keep a minimal footprint.
      const box = {
        i0: clampI(p.i - 2),
        j0: clampJ(p.j - 2),
        i1: clampI(p.i + 2),
        j1: clampJ(p.j + 2),
      };
      return { island, ...box, landSamples: 0, maxHeight: 0, method: 'missing' };
    }
    let i0 = width;
    let j0 = h;
    let i1 = 0;
    let j1 = 0;
    let maxHeight = 0;
    for (let k = 0; k < labels.length; k++) {
      if (labels[k] !== label) continue;
      const x = k % width;
      const y = (k - x) / width;
      i0 = Math.min(i0, x);
      i1 = Math.max(i1, x);
      j0 = Math.min(j0, y);
      j1 = Math.max(j1, y);
      maxHeight = Math.max(maxHeight, height.data[k] ?? 0);
    }
    return {
      island,
      i0,
      j0,
      i1,
      j1,
      landSamples: sizes[label] ?? 0,
      maxHeight,
      method: best === 0 ? 'component' : 'nearest',
    };
  });
}

function measure(
  height: Raster,
  box: { i0: number; j0: number; i1: number; j1: number },
): { landSamples: number; maxHeight: number } {
  let landSamples = 0;
  let maxHeight = 0;
  for (let y = box.j0; y <= box.j1; y++) {
    for (let x = box.i0; x <= box.i1; x++) {
      const v = height.data[y * height.width + x] ?? 0;
      if (v > 0) landSamples++;
      maxHeight = Math.max(maxHeight, v);
    }
  }
  return { landSamples, maxHeight };
}
