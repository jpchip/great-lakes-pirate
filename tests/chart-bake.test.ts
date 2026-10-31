import { describe, expect, it } from 'vitest';
import { ZONE_DEFS, zoneGeoBounds } from '../src/sim/terrain/zones';
import { westernSuperiorChart } from '../src/sim/chart/chart-data';
import { inRing, isWater, zoneAt, zoneById } from '../src/sim/chart/geography';
import {
  crossingRings,
  lakeMask,
  pointInRing,
  signedArea,
  simplifyRings,
  traceRings,
  type CellGrid,
} from '../tools/geo/lib/coast';

/**
 * The chart bake (plan 03 §8.2 step 9, §20 piece B): the ring tracing in
 * tools/geo/lib/coast.ts on small grids, and the baked western Superior chart in
 * data/chart-coast.json against what the S3 bake and the gazetteer say.
 */

const grid = (rows: string[]): { g: CellGrid; land: (k: number) => boolean } => {
  const height = rows.length;
  const width = (rows[0] as string).length;
  const g: CellGrid = { width, height, cellM: 1, x0: 0, y1: height };
  const cells = rows.join('');
  return { g, land: (k) => cells[k] === '#' };
};

const field = (g: CellGrid, land: (k: number) => boolean): Float32Array =>
  Float32Array.from({ length: g.width * g.height }, (_, k) => (land(k) ? 1 : -1));

describe('coast tracing', () => {
  it('traces the lake as one clockwise ring and each island counter-clockwise', () => {
    const { g, land } = grid([
      '........',
      '.##.....',
      '.##...#.',
      '........',
      '...###..',
      '........',
    ]);
    const rings = traceRings(g, field(g, land), 1);
    const lakes = rings.filter((r) => signedArea(r) < 0);
    const islands = rings.filter((r) => signedArea(r) > 0);
    expect(lakes).toHaveLength(1);
    expect(islands).toHaveLength(3);
    // The lake ring closes along the grid edge, half a cell out.
    const lake = lakes[0] ?? [];
    expect(Math.min(...lake.map((p) => p.x))).toBeCloseTo(0, 5);
    expect(Math.max(...lake.map((p) => p.y))).toBeCloseTo(g.height, 5);
    // Every island sits inside the lake ring.
    for (const island of islands) {
      for (const p of island) expect(pointInRing(p, lake)).toBe(true);
    }
  });

  it('keeps islands that touch only at a corner apart, as the 4-connected water does', () => {
    const { g, land } = grid(['.....', '.#...', '..#..', '.....']);
    const islands = traceRings(g, field(g, land), 1).filter((r) => signedArea(r) > 0);
    expect(islands).toHaveLength(2);
  });

  it('fills inland lakes and sinks specks smaller than the minimum', () => {
    const { g, land } = grid([
      '#########',
      '#.......#',
      '#.###...#',
      '#.#.#.#.#',
      '#.###...#',
      '#.......#',
      '#########',
    ]);
    const mask = lakeMask(g, (k) => !land(k), { i: 1, j: 1 }, 2);
    // The pond inside the island is land now; the one-cell speck has sunk.
    expect(mask[3 * g.width + 3]).toBe(1);
    expect(mask[3 * g.width + 6]).toBe(0);
    expect(mask[3 * g.width + 2]).toBe(1);
  });

  it('simplifies rings without letting them cross', () => {
    // A narrow channel between a long island and the shore: a coarse tolerance would
    // let the two outlines cross, so the bake tightens it.
    const rows = ['..................', '.################.', '..................'];
    for (let i = 0; i < 3; i++) rows.push('.#.#.#.#.#.#.#.#..');
    rows.push('..................');
    const { g, land } = grid(rows);
    const rings = traceRings(g, field(g, land), 1);
    const { rings: simple } = simplifyRings(rings, 3);
    expect(crossingRings(simple).size).toBe(0);
    expect(simple.reduce((s, r) => s + r.length, 0)).toBeLessThan(
      rings.reduce((s, r) => s + r.length, 0),
    );
  });
});

describe('the baked western Superior chart', () => {
  const geo = westernSuperiorChart();
  const at = (lat: number, lon: number) => geo.projection.geoToChart({ lat, lon });
  const area = (id: string) => {
    const ring = geo.islands.find((i) => i.id === id);
    if (!ring) throw new Error(`no ${id}`);
    let s = 0;
    const pts = ring.points;
    for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
      const a = pts[j] as { x: number; y: number };
      const b = pts[i] as { x: number; y: number };
      s += a.x * b.y - b.x * a.y;
    }
    return Math.abs(s / 2) / 1e6;
  };

  it('has the Apostle Islands at their published sizes, within 6%', () => {
    // NPS figures, as in the S3 bake report (plan 03 §14.2).
    const published: Record<string, number> = {
      'island.madeline': 62.2,
      'island.stockton': 40.7,
      'island.outer': 32.4,
      'island.oak': 20.6,
      'island.sand': 11.9,
    };
    for (const [id, km2] of Object.entries(published)) {
      expect(Math.abs(area(id) / km2 - 1), id).toBeLessThan(0.06);
    }
  });

  it('reads the Twin Ports: the canal makes Minnesota Point an island', () => {
    expect(geo.islands.some((i) => i.id === 'island.minnesota_point')).toBe(true);
    expect(isWater(geo, at(46.75, -92.12))).toBe(true); // St. Louis Bay
    expect(isWater(geo, at(46.73, -92.0515))).toBe(false); // on the Point
  });

  it('keeps every island inside the lake ring', () => {
    for (const island of geo.islands) {
      expect(inRing(island.points[0] as { x: number; y: number }, geo.water), island.id).toBe(true);
    }
  });

  it('has soundings over water only, deepest off the North Shore', () => {
    expect(geo.soundings.length).toBeGreaterThan(2000);
    for (const s of geo.soundings) expect(isWater(geo, s.pos)).toBe(true);
    const deepest = geo.soundings.reduce((a, b) => (b.fathoms > a.fathoms ? b : a));
    // Western Superior bottoms out around 150 fathoms north-east of Two Harbors.
    expect(deepest.fathoms).toBeGreaterThan(120);
    expect(deepest.pos.y).toBeGreaterThan(at(46.9, -91).y);
    expect(geo.depths.map((d) => d.fathoms)).toEqual([3, 10, 30]);
  });

  it('draws every baked zone at its bake bounds', () => {
    for (const def of ZONE_DEFS) {
      const zone = zoneById(geo, def.id);
      const b = zoneGeoBounds(def);
      const sw = at(b.south, b.west);
      const ne = at(b.north, b.east);
      expect(zone?.min.x).toBeCloseTo(sw.x, 3);
      expect(zone?.min.y).toBeCloseTo(sw.y, 3);
      expect(zone?.max.x).toBeCloseTo(ne.x, 3);
      expect(zone?.max.y).toBeCloseTo(ne.y, 3);
    }
  });

  it('puts every port in its own zone, and no two zones overlap', () => {
    for (const port of geo.ports) expect(zoneAt(geo, port.pos)?.id, port.id).toBe(port.zoneId);
    for (const a of geo.zones) {
      for (const b of geo.zones) {
        if (a === b) continue;
        const overlap =
          a.min.x < b.max.x && a.max.x > b.min.x && a.min.y < b.max.y && a.max.y > b.min.y;
        expect(overlap, `${a.id}/${b.id}`).toBe(false);
      }
    }
  });
});
