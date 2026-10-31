// Step 7 of plan 03 §8.2, the hand-edit layer: changes to the merged elevation that the
// public data can't give, kept as vector data in data/zones.json and data/islands.json
// so every bake repeats them. They run on the 1 m grid before anything is derived from
// it, so the sailing tiles, SDF, wind maps and on-foot tiles all agree.
//
// - Set-piece footprints: land inside is flattened to the set piece's ground height,
//   blending back to the real terrain outside. Water is left alone.
// - Cuts: channels dredged through a set piece (the Duluth Ship Canal at 1:1), lowering
//   land and water to a depth. They also clear the compressed modern piers in the DEM.
// - Rocks: islands too small for the data (Gull Island) raised as a rounded mound.

import type { Raster } from './raster.ts';
import {
  chartToZone,
  geoToChart,
  type Geo,
  type GridFrame,
  type IslandConfig,
  type Cut,
  type SetPieceFootprint,
  type ZoneFrame,
} from './zone.ts';

const DEG = Math.PI / 180;

export interface EditReport {
  id: string;
  kind: 'flatten' | 'cut' | 'rock';
  /** Samples changed. */
  samples: number;
}

function smoothstep(a: number, b: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

/** A point's zone coordinates and the sample-index box of a radius around it. */
function locate(frame: ZoneFrame, grid: GridFrame, at: Geo, radiusM: number) {
  const c = geoToChart(at);
  const p = chartToZone(frame, c.x, c.y);
  const clampI = (i: number) => Math.min(grid.width - 1, Math.max(0, i));
  const clampJ = (j: number) => Math.min(grid.height - 1, Math.max(0, j));
  return {
    x: p.x,
    z: p.z,
    i0: clampI(Math.floor((p.x - radiusM - grid.x0) / grid.step)),
    i1: clampI(Math.ceil((p.x + radiusM - grid.x0) / grid.step)),
    j0: clampJ(Math.floor((p.z - radiusM - grid.z0) / grid.step)),
    j1: clampJ(Math.ceil((p.z + radiusM - grid.z0) / grid.step)),
  };
}

/** Flattens the land in a set piece's footprint (see data/schemas/zones.ts). */
export function flattenFootprint(
  height: Raster,
  grid: GridFrame,
  frame: ZoneFrame,
  fp: SetPieceFootprint,
): number {
  const halfAlong = fp.alongM / 2;
  const reach = Math.hypot(Math.max(fp.inlandM, fp.seawardM), halfAlong) + fp.blendM;
  const box = locate(frame, grid, fp.at, reach);
  // Out over the water, and along the shore to its right (x east, z south).
  const ox = Math.sin(fp.bearingDeg * DEG);
  const oz = -Math.cos(fp.bearingDeg * DEG);
  let changed = 0;
  for (let j = box.j0; j <= box.j1; j++) {
    for (let i = box.i0; i <= box.i1; i++) {
      const k = j * height.width + i;
      const h = height.data[k] ?? 0;
      if (h <= 0) continue;
      const dx = grid.x0 + i * grid.step - box.x;
      const dz = grid.z0 + j * grid.step - box.z;
      const out = dx * ox + dz * oz;
      const along = -dx * oz + dz * ox;
      // Distance outside the rectangle, 0 inside.
      const du = Math.max(-fp.inlandM - out, out - fp.seawardM, 0);
      const dv = Math.max(Math.abs(along) - halfAlong, 0);
      const d = Math.hypot(du, dv);
      if (d >= fp.blendM && d > 0) continue;
      const w = fp.blendM > 0 ? 1 - smoothstep(0, fp.blendM, d) : 1;
      height.data[k] = h + (fp.groundM - h) * w;
      changed++;
    }
  }
  return changed;
}

/** Dredges a cut (see data/schemas/zones.ts). Only lowers; returns the samples changed. */
export function dredgeCut(height: Raster, grid: GridFrame, frame: ZoneFrame, cut: Cut): number {
  const a = locate(frame, grid, cut.from, 0);
  const b = locate(frame, grid, cut.to, 0);
  const reach = cut.widthM / 2 + cut.blendM;
  const clampI = (i: number) => Math.min(grid.width - 1, Math.max(0, i));
  const clampJ = (j: number) => Math.min(grid.height - 1, Math.max(0, j));
  const i0 = clampI(Math.floor((Math.min(a.x, b.x) - reach - grid.x0) / grid.step));
  const i1 = clampI(Math.ceil((Math.max(a.x, b.x) + reach - grid.x0) / grid.step));
  const j0 = clampJ(Math.floor((Math.min(a.z, b.z) - reach - grid.z0) / grid.step));
  const j1 = clampJ(Math.ceil((Math.max(a.z, b.z) + reach - grid.z0) / grid.step));
  const ux = b.x - a.x;
  const uz = b.z - a.z;
  const len2 = ux * ux + uz * uz || 1;
  let changed = 0;
  for (let j = j0; j <= j1; j++) {
    for (let i = i0; i <= i1; i++) {
      const px = grid.x0 + i * grid.step - a.x;
      const pz = grid.z0 + j * grid.step - a.z;
      const t = Math.min(1, Math.max(0, (px * ux + pz * uz) / len2));
      // Distance outside the channel's sides (0 inside); the ends are rounded.
      const d = Math.max(0, Math.hypot(px - t * ux, pz - t * uz) - cut.widthM / 2);
      if (d >= cut.blendM && d > 0) continue;
      const w = cut.blendM > 0 ? 1 - smoothstep(0, cut.blendM, d) : 1;
      const k = j * height.width + i;
      const h = height.data[k] ?? 0;
      const target = h + (-cut.depthM - h) * w;
      if (target < h) {
        height.data[k] = target;
        changed++;
      }
    }
  }
  return changed;
}

/** Raises an island's rock: a mound whose shore is the ellipse of its length and width. */
export function raiseRock(
  height: Raster,
  grid: GridFrame,
  frame: ZoneFrame,
  island: IslandConfig,
): number {
  const rock = island.rock;
  if (!rock) return 0;
  const a = rock.lengthM / 2;
  const b = rock.widthM / 2;
  const box = locate(frame, grid, island, Math.max(a, b));
  const lx = Math.sin(rock.bearingDeg * DEG);
  const lz = -Math.cos(rock.bearingDeg * DEG);
  let changed = 0;
  for (let j = box.j0; j <= box.j1; j++) {
    for (let i = box.i0; i <= box.i1; i++) {
      const dx = grid.x0 + i * grid.step - box.x;
      const dz = grid.z0 + j * grid.step - box.z;
      const u = (dx * lx + dz * lz) / a;
      const v = (-dx * lz + dz * lx) / b;
      const r2 = u * u + v * v;
      if (r2 >= 1) continue;
      // Steep at the waterline, rounded on top, like the Apostles' sandstone ledges.
      const top = rock.heightM * Math.pow(1 - r2, 0.6);
      const k = j * height.width + i;
      if (top > (height.data[k] ?? 0)) {
        height.data[k] = top;
        changed++;
      }
    }
  }
  return changed;
}

/** Applies a zone's whole hand-edit layer in place. */
export function applyHandEdits(
  height: Raster,
  grid: GridFrame,
  frame: ZoneFrame,
  islands: IslandConfig[],
  setPieces: SetPieceFootprint[],
): EditReport[] {
  const report: EditReport[] = [];
  for (const island of islands) {
    if (island.rock) {
      report.push({ id: island.id, kind: 'rock', samples: raiseRock(height, grid, frame, island) });
    }
  }
  for (const fp of setPieces) {
    report.push({ id: fp.id, kind: 'flatten', samples: flattenFootprint(height, grid, frame, fp) });
    fp.cuts?.forEach((cut, n) => {
      report.push({
        id: `${fp.id}#cut${n + 1}`,
        kind: 'cut',
        samples: dredgeCut(height, grid, frame, cut),
      });
    });
  }
  return report;
}
