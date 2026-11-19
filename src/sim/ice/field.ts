import type { Chart } from '../../core/coords';
import { inRing, isWater, type ChartGeography, type Ring } from '../chart/geography';
import { ICE } from './season';

/**
 * The shelter field (plan 04 §8.1; piece K): how readily each part of the lake freezes,
 * 0 in the deep open lake to 1 in a shallow, enclosed bay, on a grid of chart cells
 * (`field.cellM`, a kilometer). It comes from the chart: the depth from its soundings and
 * the distance from the shore, raised inside the basins and around the harbors that
 * `ice.json` names (Chequamegon Bay, the La Pointe channel, the Twin Ports' harbor).
 * Worked out once per chart, in a few tens of milliseconds.
 */
export interface ShelterField {
  /** The grid's south-west corner on the chart and its cell size, meters. */
  min: Chart;
  cellM: number;
  cols: number;
  rows: number;
  /** Shelter per cell, row-major from the south-west; land cells hold their nearest water's. */
  shelter: Float32Array;
  /** 1 where the cell's center is water. */
  water: Uint8Array;
}

const fields = new WeakMap<ChartGeography, ShelterField>();

/** The chart's shelter field, built on first use. */
export function shelterField(geo: ChartGeography): ShelterField {
  let f = fields.get(geo);
  if (!f) {
    f = buildShelterField(geo);
    fields.set(geo, f);
  }
  return f;
}

export function buildShelterField(geo: ChartGeography): ShelterField {
  const cfg = ICE.field;
  const cellM = cfg.cellM;
  const min = { ...geo.charted.min };
  const cols = Math.ceil((geo.charted.max.x - min.x) / cellM);
  const rows = Math.ceil((geo.charted.max.y - min.y) / cellM);
  const n = cols * rows;
  const water = new Uint8Array(n);
  const center = (i: number): Chart => ({
    x: min.x + ((i % cols) + 0.5) * cellM,
    y: min.y + (Math.floor(i / cols) + 0.5) * cellM,
  });
  for (let i = 0; i < n; i++) water[i] = isWater(geo, center(i)) ? 1 : 0;

  // Distance to the shore in cells: a two-pass chamfer transform from the land cells.
  const INF = 1e9;
  const dist = new Float32Array(n);
  for (let i = 0; i < n; i++) dist[i] = water[i] ? INF : 0;
  const D = Math.SQRT2;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const i = r * cols + c;
      let d = dist[i] as number;
      if (c > 0) d = Math.min(d, (dist[i - 1] as number) + 1);
      if (r > 0) {
        d = Math.min(d, (dist[i - cols] as number) + 1);
        if (c > 0) d = Math.min(d, (dist[i - cols - 1] as number) + D);
        if (c < cols - 1) d = Math.min(d, (dist[i - cols + 1] as number) + D);
      }
      dist[i] = d;
    }
  }
  for (let r = rows - 1; r >= 0; r--) {
    for (let c = cols - 1; c >= 0; c--) {
      const i = r * cols + c;
      let d = dist[i] as number;
      if (c < cols - 1) d = Math.min(d, (dist[i + 1] as number) + 1);
      if (r < rows - 1) {
        d = Math.min(d, (dist[i + cols] as number) + 1);
        if (c < cols - 1) d = Math.min(d, (dist[i + cols + 1] as number) + D);
        if (c > 0) d = Math.min(d, (dist[i + cols - 1] as number) + D);
      }
      dist[i] = d;
    }
  }

  // Depth from the soundings: inverse-distance weights over the nearest few, by bucket.
  const BUCKET = 8;
  const bcols = Math.ceil(cols / BUCKET);
  const brows = Math.ceil(rows / BUCKET);
  const buckets: { pos: Chart; fathoms: number }[][] = Array.from(
    { length: bcols * brows },
    () => [],
  );
  for (const s of geo.soundings) {
    const c = Math.floor((s.pos.x - min.x) / cellM / BUCKET);
    const r = Math.floor((s.pos.y - min.y) / cellM / BUCKET);
    if (c < 0 || r < 0 || c >= bcols || r >= brows) continue;
    buckets[r * bcols + c]?.push(s);
  }
  const depthAt = (p: Chart, shoreCells: number): number => {
    const bc = Math.floor((p.x - min.x) / cellM / BUCKET);
    const br = Math.floor((p.y - min.y) / cellM / BUCKET);
    let wsum = 0;
    let dsum = 0;
    for (let ring = 1; ring <= 3 && wsum === 0; ring++) {
      for (let r = br - ring; r <= br + ring; r++) {
        for (let c = bc - ring; c <= bc + ring; c++) {
          if (r < 0 || c < 0 || r >= brows || c >= bcols) continue;
          for (const s of buckets[r * bcols + c] as { pos: Chart; fathoms: number }[]) {
            const d2 = (s.pos.x - p.x) ** 2 + (s.pos.y - p.y) ** 2 + 1e4;
            const w = 1 / d2;
            wsum += w;
            dsum += w * s.fathoms;
          }
        }
      }
    }
    // Far from any sounding: deepening a fathom per 100 m out from the shore.
    return wsum > 0 ? dsum / wsum : (shoreCells * cellM) / 100;
  };

  const project = (ring: readonly (readonly [number, number])[]): Ring => {
    const points = ring.map(([lon, lat]) => geo.projection.geoToChart({ lat, lon }));
    const xs = points.map((p) => p.x);
    const ys = points.map((p) => p.y);
    return {
      id: 'basin',
      points,
      bounds: {
        min: { x: Math.min(...xs), y: Math.min(...ys) },
        max: { x: Math.max(...xs), y: Math.max(...ys) },
      },
    };
  };
  const basins = ICE.basins.map((b) => ({ shelter: b.shelter, ring: project(b.ring) }));
  const harbors = Object.entries(ICE.harbors).flatMap(([id, h]) => {
    const port = geo.ports.find((p) => p.id === id);
    return port ? [{ ...h, pos: port.pos }] : [];
  });

  const shelter = new Float32Array(n);
  const logDeep = Math.log(1 + cfg.deepFathoms);
  for (let i = 0; i < n; i++) {
    const p = center(i);
    const shoreCells = water[i] ? (dist[i] as number) : 0;
    const fathoms = Math.max(0, depthAt(p, shoreCells));
    const fromDepth = Math.max(0, 1 - Math.log(1 + fathoms) / logDeep);
    const fromShore = Math.exp(-(shoreCells * cellM) / cfg.shoreM);
    let s = cfg.depthWeight * fromDepth + cfg.shoreWeight * fromShore;
    for (const b of basins) if (b.shelter > s && inRing(p, b.ring)) s = b.shelter;
    for (const h of harbors) {
      const d = Math.hypot(p.x - h.pos.x, p.y - h.pos.y);
      if (d < h.radiusM * 1.5) {
        const k = h.shelter * Math.min(1, Math.max(0, (h.radiusM * 1.5 - d) / (h.radiusM * 0.5)));
        if (k > s) s = k;
      }
    }
    shelter[i] = Math.min(1, s);
  }
  return { min, cellM, cols, rows, shelter, water };
}

/** The shelter at a chart point, bilinear between cell centers. */
export function shelterAt(f: ShelterField, p: Chart): number {
  const fx = (p.x - f.min.x) / f.cellM - 0.5;
  const fy = (p.y - f.min.y) / f.cellM - 0.5;
  const c0 = Math.max(0, Math.min(f.cols - 1, Math.floor(fx)));
  const r0 = Math.max(0, Math.min(f.rows - 1, Math.floor(fy)));
  const c1 = Math.min(f.cols - 1, c0 + 1);
  const r1 = Math.min(f.rows - 1, r0 + 1);
  const tx = Math.max(0, Math.min(1, fx - c0));
  const ty = Math.max(0, Math.min(1, fy - r0));
  const v = (r: number, c: number): number => f.shelter[r * f.cols + c] as number;
  return (
    (v(r0, c0) * (1 - tx) + v(r0, c1) * tx) * (1 - ty) +
    (v(r1, c0) * (1 - tx) + v(r1, c1) * tx) * ty
  );
}
