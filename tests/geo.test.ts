import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { ChartProjection } from '../src/core/coords';
import { decodeGrid, type GridFormat } from '../src/core/terrain-grid';
import { dredgeCut, flattenFootprint, raiseRock } from '../tools/geo/lib/edits';
import { encode, quantize, tileWindow } from '../tools/geo/lib/encode';
import { labelLand } from '../tools/geo/lib/islands';
import { mergeElevation } from '../tools/geo/lib/merge';
import { downsample, raster } from '../tools/geo/lib/raster';
import { distanceTransform, shorelineSdf } from '../tools/geo/lib/sdf';
import { bakeWindMaps, DEFAULT_WIND } from '../tools/geo/lib/wind';
import {
  chartToZone,
  geoToChart,
  warpExtent,
  zoneConfigFromData,
  zoneGrid,
  type ZoneFrame,
} from '../tools/geo/lib/zone';

describe('geo pipeline projection', () => {
  it('matches the game chart projection', () => {
    const projection = new ChartProjection();
    fc.assert(
      fc.property(
        fc.double({ min: 46, max: 49, noNaN: true }),
        fc.double({ min: -92.2, max: -84.3, noNaN: true }),
        (lat, lon) => {
          const a = geoToChart({ lat, lon });
          const b = projection.geoToChart({ lat, lon });
          expect(a.x).toBeCloseTo(b.x, 6);
          expect(a.y).toBeCloseTo(b.y, 6);
        },
      ),
    );
  });

  it('centers warped pixels on grid samples', () => {
    const frame: ZoneFrame = { origin: { x: 1000, y: 2000 }, compression: 8, sizeX: 64, sizeZ: 32 };
    const grid = zoneGrid(frame, 4);
    expect([grid.width, grid.height]).toEqual([17, 9]);
    const { te, tr } = warpExtent(frame, grid);
    expect(tr).toBe(32);
    // Sample (0, 0) is the zone's north-west corner: chart (1000 − 256, 2000 + 128).
    expect((te[0] ?? 0) + tr / 2).toBe(744);
    expect((te[3] ?? 0) - tr / 2).toBe(2128);
    expect(((te[2] ?? 0) - (te[0] ?? 0)) / tr).toBe(17);
  });
});

describe('grid encoding', () => {
  const formats: [GridFormat, number, number][] = [
    [{ type: 'u16', scale: 1 / 64, offset: -512, encoding: 'delta-deflate' }, -512, 511],
    [{ type: 'u16', scale: 10, offset: 0, encoding: 'deflate' }, 0, 600_000],
    [{ type: 'i16', scale: 0.25, offset: 0, encoding: 'delta-deflate' }, -8000, 8000],
    [{ type: 'u8', scale: 1 / 255, offset: 0, encoding: 'deflate' }, 0, 1],
  ];

  it.each(formats)('round-trips %j within half a step', (format, min, max) => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 9 }),
        fc.integer({ min: 1, max: 9 }),
        fc.array(fc.double({ min, max, noNaN: true }), { minLength: 81, maxLength: 81 }),
        (w, rows, values) => {
          const v = values.slice(0, w * rows);
          const bytes = encode(quantize(v, format), w, format.encoding);
          const out = decodeGrid(bytes, v.length, w, format);
          v.forEach((x, k) =>
            expect(Math.abs((out[k] ?? 0) - x)).toBeLessThanOrEqual(format.scale / 2 + 1e-9),
          );
        },
      ),
    );
  });

  it('shares the edge sample between neighboring tiles', () => {
    const src = raster(9, 9);
    src.data.forEach((_, k) => (src.data[k] = k));
    const a = tileWindow(src, 0, 0, 4);
    const b = tileWindow(src, 4, 0, 4);
    for (let j = 0; j < 5; j++) expect(a[j * 5 + 4]).toBe(b[j * 5]);
    // Past the source edge, samples clamp.
    expect(tileWindow(src, 8, 8, 4)[24]).toBe(80);
  });
});

describe('elevation merge', () => {
  const opts = { lakeLevelM: 183.5, bathyDatumM: 183.2, landThresholdM: 0.5 };
  it('takes land from the DEM and depth from the bathymetry', () => {
    const dem = { width: 4, height: 1, data: Float32Array.from([250, 183.4, 183.4, -9999]) };
    const bathy = { width: 4, height: 1, data: Float32Array.from([60, -20, 3, -9999]) };
    const out = mergeElevation(dem, bathy, opts);
    expect(out.data[0]).toBeCloseTo(66.5);
    // Water: bathymetry relative to lake level (−20 m below LWD → −20.3 m).
    expect(out.data[1]).toBeCloseTo(-20.3);
    // DEM says water but coarse bathymetry says land: a shallow shelf, still below 0.
    expect(out.data[2]).toBeCloseTo(-0.3);
    expect(out.data[3]).toBeLessThan(0);
  });
});

describe('distance transform', () => {
  it('matches brute force', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 12 }),
        fc.integer({ min: 1, max: 12 }),
        fc.array(fc.boolean(), { minLength: 144, maxLength: 144 }),
        (w, h, bits) => {
          const inside = Uint8Array.from(bits.slice(0, w * h), (b) => (b ? 1 : 0));
          if (!inside.some((b) => b)) return;
          const d = distanceTransform(w, h, inside);
          for (let k = 0; k < w * h; k++) {
            let best = Infinity;
            for (let m = 0; m < w * h; m++) {
              if (!inside[m]) continue;
              best = Math.min(
                best,
                Math.hypot((k % w) - (m % w), Math.floor(k / w) - Math.floor(m / w)),
              );
            }
            expect(d[k]).toBeCloseTo(best, 9);
          }
        },
      ),
    );
  });

  it('signs the shoreline SDF: positive over water, negative over land', () => {
    const h = raster(5, 1);
    h.data.set([5, 5, -1, -1, -1]);
    const sdf = shorelineSdf(h, 4);
    expect(Array.from(sdf.data)).toEqual([-6, -2, 2, 6, 10]);
  });
});

describe('rasters and islands', () => {
  it('downsamples a plane to the same plane', () => {
    const src = raster(9, 9);
    src.data.forEach((_, k) => (src.data[k] = (k % 9) * 2 + Math.floor(k / 9)));
    const out = downsample(src, 4);
    expect([out.width, out.height]).toEqual([3, 3]);
    // Interior samples keep the plane (edges are biased by the clipped filter).
    expect(out.data[4]).toBeCloseTo(12);
  });

  it('labels 8-connected land', () => {
    const h = raster(4, 3, -1);
    h.data[0] = 1;
    h.data[5] = 1; // diagonal to 0: same island
    h.data[3] = 1;
    const { sizes } = labelLand(h);
    expect(sizes.slice(1)).toEqual([2, 1]);
  });
});

describe('wind maps', () => {
  // A 640 m zone with a 40 m high, 64 m wide island in the middle, open water all round.
  const frame: ZoneFrame = { origin: { x: 0, y: 0 }, compression: 8, sizeX: 640, sizeZ: 640 };
  const grid = zoneGrid(frame, 4);
  const h = raster(grid.width, grid.height, -10);
  for (let j = 72; j <= 88; j++) for (let i = 72; i <= 88; i++) h.data[j * grid.width + i] = 40;
  // Open water for 1,000 km in every direction past the zone edge.
  const lake = {
    width: 2000,
    height: 2000,
    data: new Float32Array(2000 * 2000).fill(-50),
    xmin: -1_024_000,
    ymax: 1_024_000,
    cellM: 1024,
  };
  const maps = bakeWindMaps(h, grid, frame, 32, lake, { ...DEFAULT_WIND, lakeOffsetM: 0 });
  const n = maps.width * maps.height;
  const at = (map: Float32Array, dir: number, i: number, j: number) =>
    map[dir * n + j * maps.width + i] ?? 0;

  it('puts the lee downwind of the island', () => {
    // North wind (layer 0): sheltered south of the island, open to the north.
    expect(at(maps.shelter, 0, 10, 13)).toBeGreaterThan(0.5);
    expect(at(maps.shelter, 0, 10, 6)).toBe(0);
    // East wind (layer 4): sheltered to the west.
    expect(at(maps.shelter, 4, 7, 10)).toBeGreaterThan(0.5);
  });

  it('measures fetch in real meters up to land', () => {
    // Two cells south of the island's last land cell in a north wind: 64 m game = 512 m real.
    expect(at(maps.fetch, 0, 10, 12)).toBe(512);
    expect(at(maps.fetch, 0, 10, 6)).toBe(DEFAULT_WIND.maxFetchM);
    expect(at(maps.fetch, 0, 10, 10)).toBe(0); // land
  });
});

describe('hand-edit layer', () => {
  // A 201 m square at 1 m around a point at the zone origin: land rising east from x = 0.
  const frame: ZoneFrame = { origin: { x: 0, y: 0 }, compression: 8, sizeX: 200, sizeZ: 200 };
  const grid = zoneGrid(frame, 1);
  const at = { lat: 47.5, lon: -88 }; // the chart reference, so zone (0, 0)
  const slope = () => {
    const r = raster(grid.width, grid.height);
    for (let j = 0; j < grid.height; j++) {
      for (let i = 0; i < grid.width; i++) r.data[j * grid.width + i] = (i - 100) * 0.2;
    }
    return r;
  };
  const h = (r: ReturnType<typeof raster>, x: number, z: number) =>
    r.data[(z + 100) * grid.width + (x + 100)] ?? NaN;

  it('flattens the land in a footprint and leaves the water', () => {
    const r = slope();
    // Facing west (out over the water at x < 0), 30 m inland, 40 m along the shore.
    const fp = {
      id: 'setpiece.test',
      at,
      bearingDeg: 270,
      alongM: 40,
      inlandM: 30,
      seawardM: 20,
      groundM: 2,
      blendM: 10,
    };
    expect(flattenFootprint(r, grid, frame, fp)).toBeGreaterThan(0);
    expect(h(r, 15, 0)).toBeCloseTo(2);
    expect(h(r, 30, 19)).toBeCloseTo(2);
    // Water inside the footprint is untouched.
    expect(h(r, -10, 0)).toBeCloseTo(-2);
    // The blend meets the real slope again past blendM.
    expect(h(r, 45, 0)).toBeCloseTo(9);
    expect(h(r, 15, 35)).toBeCloseTo(3);
    const mid = h(r, 35, 0);
    expect(mid).toBeGreaterThan(2);
    expect(mid).toBeLessThan(7);
  });

  it('dredges a cut through land and water, and only ever lowers', () => {
    const r = slope();
    // An east-west channel along z = 0 from x = -60 to x = 60, 20 m wide, 7 m deep. 1 m
    // of zone is 8 m of chart, so 60 zone meters east is 480 chart meters.
    const D = 180 / Math.PI / 6_371_008.8;
    const east = (m: number) => ({
      lat: 47.5,
      lon: -88 + (m * 8 * D) / Math.cos(47.5 / (180 / Math.PI)),
    });
    const cut = { from: east(-60), to: east(60), widthM: 20, depthM: 7, blendM: 10 };
    expect(dredgeCut(r, grid, frame, cut)).toBeGreaterThan(0);
    expect(h(r, 40, 0)).toBeCloseTo(-7, 1);
    expect(h(r, -40, 9)).toBeCloseTo(-8, 1); // already deeper than the cut: left alone
    expect(h(r, 0, 5)).toBeCloseTo(-7, 1);
    // The bank blends back to the slope past blendM, and past the rounded ends.
    expect(h(r, 40, 25)).toBeCloseTo(8);
    expect(h(r, 40, 15)).toBeLessThan(8);
    expect(h(r, 40, 15)).toBeGreaterThan(-7);
    expect(h(r, 90, 0)).toBeCloseTo(18);
  });

  it('raises a rock where the data has none', () => {
    const r = raster(grid.width, grid.height, -3);
    const island = {
      id: 'island.test',
      name: 'Test',
      ...at,
      rock: { lengthM: 40, widthM: 20, bearingDeg: 90, heightM: 6 },
    };
    raiseRock(r, grid, frame, island);
    expect(h(r, 0, 0)).toBeCloseTo(6);
    // Long axis east–west: land 18 m east, water 12 m north.
    expect(h(r, 18, 0)).toBeGreaterThan(0);
    expect(h(r, 0, -12)).toBe(-3);
    expect(h(r, 25, 0)).toBe(-3);
  });

  it('reads the bake config from data/zones.json and data/islands.json', () => {
    const read = (f: string) =>
      JSON.parse(readFileSync(join(__dirname, '..', 'data', f), 'utf8')) as unknown;
    const config = zoneConfigFromData('zone.apostles', read('zones.json'), read('islands.json'));
    expect(config.tilesX * config.tileSamples * config.sailingSampleM).toBe(7168);
    expect(config.islands).toHaveLength(22);
    expect(config.islands.find((i) => i.id === 'island.long')?.bounds).toBeDefined();
    expect(config.islands.find((i) => i.id === 'island.gull')?.rock).toBeDefined();
    expect(config.setPieces.map((p) => p.id)).toEqual([
      'setpiece.bayfield',
      'setpiece.ashland',
      'setpiece.la_pointe',
      'setpiece.washburn',
    ]);
    const ports = zoneConfigFromData('zone.twin_ports', read('zones.json'), read('islands.json'));
    expect(ports.islands).toEqual([]);
    expect(ports.setPieces.find((p) => p.id === 'setpiece.duluth_canal')?.cuts).toHaveLength(1);
  });
});

describe('baked Apostles zone', () => {
  const dir = join(__dirname, '..', 'public', 'world', 'apostles');
  const manifestPath = join(dir, 'manifest.json');
  // LFS pointer files are ~130 bytes; skip when the bake isn't checked out.
  const baked =
    existsSync(manifestPath) && readFileSync(join(dir, 'height', '0-0.bin')).byteLength > 200;

  it.skipIf(!baked)('has Gull Island and the flattened set pieces', () => {
    const m = JSON.parse(readFileSync(manifestPath, 'utf8'));
    const gull = m.islands.find((i: { id: string }) => i.id === 'island.gull');
    expect(gull.found).toBe('component');
    expect(gull.maxHeightM).toBeGreaterThan(4);
    expect(m.handEdits.map((e: { id: string }) => e.id)).toEqual([
      'island.gull',
      'setpiece.bayfield',
      'setpiece.ashland',
      'setpiece.la_pointe',
      'setpiece.washburn',
    ]);
    for (const e of m.handEdits) expect(e.samples).toBeGreaterThan(500);
    const p = geoToChart({ lat: 46.9065, lon: -90.4435 });
    const z = chartToZone(m.frame, p.x, p.y);
    expect(z.x).toBeGreaterThan(gull.x0);
    expect(z.z).toBeGreaterThan(gull.z0);
  });

  it.skipIf(!baked)('decodes a height tile within the manifest range', () => {
    const m = JSON.parse(readFileSync(manifestPath, 'utf8'));
    expect(m.islands).toHaveLength(22);
    const n = m.heightFormat.tileSamples + 1;
    const tile = decodeGrid(readFileSync(join(dir, 'height', '3-3.bin')), n * n, n, m.heightFormat);
    for (const v of tile) {
      expect(v).toBeGreaterThanOrEqual(m.height.minM - 0.02);
      expect(v).toBeLessThanOrEqual(m.height.maxM + 0.02);
    }
  });
});
