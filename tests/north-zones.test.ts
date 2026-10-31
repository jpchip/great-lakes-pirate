// The Phase 3 zones (plan 03 §20, piece C): the Twin Ports and Two Harbors bakes. Like the
// Apostles checks, these skip when the bake isn't checked out (LFS pointers only).

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { ChartProjection, chartToZone, type Zone } from '../src/core/coords';
import { QUALITY_PRESETS } from '../src/render/quality';
import { strideAt, tileDistance } from '../src/render/terrain/lod';
import { buildGridGeometry, presetLod } from '../src/render/terrain/terrain-mesh';
import { loadZoneTerrain, type LoadedZone } from '../src/sim/terrain/load';
import { edgeFactor } from '../src/sim/terrain/zone-edge';
import type { ZoneTerrain } from '../src/sim/terrain/zone-terrain';
import {
  manifestFrame,
  setPieceFootprint,
  spawnPose,
  zoneDef,
  type SetPieceFootprint,
} from '../src/sim/terrain/zones';

const projection = new ChartProjection();
/** The T1 schooner draws about 2 m (plan 02); leave half a meter under the keel. */
const SAILABLE_M = 2.5;

function bakedDir(slug: string): { dir: string; baked: boolean } {
  const dir = join(__dirname, '..', 'public', 'world', slug);
  const baked =
    existsSync(join(dir, 'manifest.json')) &&
    readFileSync(join(dir, 'height', '0-0.bin')).byteLength > 200;
  return { dir, baked };
}

async function load(dir: string): Promise<LoadedZone> {
  return loadZoneTerrain(async (path) => new Uint8Array(readFileSync(join(dir, path))));
}

/** A point `seaward` meters out from a footprint's anchor (negative is inland). */
function out(fp: SetPieceFootprint, seaward: number): Zone {
  return {
    x: fp.anchor.x + Math.sin(fp.bearing) * seaward,
    z: fp.anchor.z - Math.cos(fp.bearing) * seaward,
  };
}

function footprints(zone: LoadedZone): Map<string, SetPieceFootprint> {
  const frame = manifestFrame(zone.manifest);
  return new Map(
    zoneDef(zone.manifest.zone).setPieces.map((d) => [d.id, setPieceFootprint(d, frame)]),
  );
}

/**
 * Water a T1 can sail, flood-filled on an 8 m grid from `from`. `blocked` takes cells
 * out, to prove a route needs a given entry.
 */
function sailable(
  terrain: ZoneTerrain,
  from: Zone,
  blocked: (x: number, z: number) => boolean = () => false,
): (p: Zone) => boolean {
  const step = 8;
  const { minX, minZ, maxX, maxZ } = terrain.bounds;
  const w = Math.floor((maxX - minX) / step) + 1;
  const h = Math.floor((maxZ - minZ) / step) + 1;
  const seen = new Uint8Array(w * h);
  const cell = (p: Zone) => [Math.round((p.x - minX) / step), Math.round((p.z - minZ) / step)];
  const ok = (i: number, j: number) => {
    const x = minX + i * step;
    const z = minZ + j * step;
    return terrain.heightAt(x, z) <= -SAILABLE_M && !blocked(x, z);
  };
  const [si = 0, sj = 0] = cell(from);
  const stack = [sj * w + si];
  seen[sj * w + si] = 1;
  while (stack.length) {
    const k = stack.pop() ?? 0;
    const i = k % w;
    const j = (k - i) / w;
    for (const [di, dj] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ] as const) {
      const ni = i + di;
      const nj = j + dj;
      if (ni < 0 || nj < 0 || ni >= w || nj >= h) continue;
      const nk = nj * w + ni;
      if (seen[nk] || !ok(ni, nj)) continue;
      seen[nk] = 1;
      stack.push(nk);
    }
  }
  return (p) => {
    const [i = 0, j = 0] = cell(p);
    return seen[j * w + i] === 1;
  };
}

/** Distance from (x, z) to the segment a–b. */
function segmentDistance(a: Zone, b: Zone, x: number, z: number): number {
  const ux = b.x - a.x;
  const uz = b.z - a.z;
  const t = Math.min(1, Math.max(0, ((x - a.x) * ux + (z - a.z) * uz) / (ux * ux + uz * uz)));
  return Math.hypot(x - a.x - t * ux, z - a.z - t * uz);
}

function cutSegment(zone: LoadedZone, pieceId: string, n = 0): { a: Zone; b: Zone } {
  const frame = manifestFrame(zone.manifest);
  const cut = zoneDef(zone.manifest.zone).setPieces.find((p) => p.id === pieceId)?.cuts?.[n];
  if (!cut) throw new Error(`${pieceId} has no cut ${n}`);
  return {
    a: chartToZone(projection.geoToChart(cut.from), frame),
    b: chartToZone(projection.geoToChart(cut.to), frame),
  };
}

/** The most terrain draw calls on a preset from a chase camera anywhere in the zone. */
function worstDrawCalls(zone: LoadedZone, preset: keyof typeof QUALITY_PRESETS): number {
  const field = zone.terrain.height;
  const { tilesX, tilesY } = zone.manifest.height;
  const size = zone.manifest.heightFormat.tileSamples;
  const tileM = size * field.step;
  const drawable = new Map<string, boolean>();
  const hasTriangles = (tx: number, ty: number, stride: number): boolean => {
    const key = `${tx}:${ty}:${stride}`;
    let v = drawable.get(key);
    if (v === undefined) {
      const g = buildGridGeometry(field, {
        i0: tx * size,
        j0: ty * size,
        i1: tx * size + size,
        j1: ty * size + size,
        stride,
        skirts: true,
      });
      v = (g.index?.count ?? 0) > 0;
      drawable.set(key, v);
    }
    return v;
  };
  const lod = presetLod(QUALITY_PRESETS[preset]);
  let most = 0;
  for (let z = field.z0; z <= field.maxZ; z += 128) {
    for (let x = field.x0; x <= field.maxX; x += 128) {
      let calls = 1; // the backdrop
      for (let ty = 0; ty < tilesY; ty++) {
        for (let tx = 0; tx < tilesX; tx++) {
          const b = {
            minX: field.x0 + tx * tileM,
            minZ: field.z0 + ty * tileM,
            maxX: field.x0 + (tx + 1) * tileM,
            maxZ: field.z0 + (ty + 1) * tileM,
          };
          const stride = strideAt(Math.max(0, tileDistance(b, x, 15, z) - 64), lod);
          if (stride && hasTriangles(tx, ty, stride)) calls++;
        }
      }
      most = Math.max(most, calls);
    }
  }
  return most;
}

/** Shared checks: size, spawn, soft edge open to the lake, draw calls. */
function zoneBasics(slug: string, id: string, tiles: [number, number], get: () => LoadedZone) {
  const { baked } = bakedDir(slug);

  it.skipIf(!baked)('loads the whole zone at the configured size', () => {
    const { terrain, manifest } = get();
    expect(terrain.zoneId).toBe(id);
    expect([manifest.height.tilesX, manifest.height.tilesY]).toEqual(tiles);
    expect(terrain.bounds).toEqual({
      minX: -tiles[0] * 512,
      minZ: -tiles[1] * 512,
      maxX: tiles[0] * 512,
      maxZ: tiles[1] * 512,
    });
  });

  it.skipIf(!baked)('spawns in deep open water, clear of the edge fog', () => {
    const { terrain } = get();
    const def = zoneDef(id);
    const spawn = spawnPose(def);
    expect(terrain.depthAt(spawn.x, spawn.z)).toBeGreaterThan(15);
    expect(terrain.shoreDistanceAt(spawn.x, spawn.z)).toBeGreaterThan(60);
    expect(edgeFactor(terrain.bounds, def.edge, spawn.x, spawn.z)).toBe(0);
  });

  it.skipIf(!baked)('meets the open lake at its edge, for arrivals from the chart', () => {
    const { terrain } = get();
    const spawn = spawnPose(zoneDef(id));
    const reach = sailable(terrain, spawn);
    const { minX, minZ, maxX, maxZ } = terrain.bounds;
    let open = 0;
    let total = 0;
    for (let t = minX; t <= maxX; t += 64) {
      for (const p of [
        { x: t, z: minZ + 24 },
        { x: t, z: maxZ - 24 },
      ]) {
        total++;
        if (reach(p)) open++;
      }
    }
    for (let t = minZ; t <= maxZ; t += 64) {
      for (const p of [
        { x: minX + 24, z: t },
        { x: maxX - 24, z: t },
      ]) {
        total++;
        if (reach(p)) open++;
      }
    }
    // The Twin Ports are mostly land on three sides; the lake side is what matters.
    expect(open / total).toBeGreaterThan(0.15);
  });

  it.skipIf(!baked)('stays within 40 terrain draw calls on Medium anywhere in the zone', () => {
    const medium = worstDrawCalls(get(), 'medium');
    expect(medium).toBeLessThanOrEqual(40);
    expect(worstDrawCalls(get(), 'low')).toBeLessThanOrEqual(medium);
  });
}

describe('the Twin Ports zone', () => {
  const { dir, baked } = bakedDir('twin_ports');
  let zone: LoadedZone;
  beforeAll(async () => {
    if (baked) zone = await load(dir);
  });

  zoneBasics('twin_ports', 'zone.twin_ports', [4, 4], () => zone);

  it.skipIf(!baked)('reads as the Twin Ports: the two points, the harbor and St. Louis Bay', () => {
    const { terrain } = zone;
    // Minnesota Point between the harbor basin and the lake, south of the canal.
    expect(terrain.heightAt(-127, 9)).toBeGreaterThan(0);
    expect(terrain.heightAt(-200, -10)).toBeLessThan(-SAILABLE_M);
    expect(terrain.heightAt(-50, 30)).toBeLessThan(-SAILABLE_M);
    // Wisconsin Point east of Superior Entry, with the lake past it.
    expect(terrain.heightAt(700, 950)).toBeGreaterThan(0);
    expect(terrain.heightAt(900, 1000)).toBeLessThan(-SAILABLE_M);
    // St. Louis Bay, west of Rice's Point, is open water.
    expect(terrain.heightAt(-600, 300)).toBeLessThan(0);
    // Duluth's hillside rises behind the town, flattened by the soft knee to tens of meters.
    expect(terrain.heightAt(-1000, -200)).toBeGreaterThan(25);
    expect(zone.manifest.height.maxM).toBeLessThan(60);
  });

  it.skipIf(!baked)('opens the Duluth Ship Canal and Superior Entry at 1:1 width', () => {
    const { terrain } = zone;
    for (const [id, width] of [
      ['setpiece.duluth_canal', 90],
      ['setpiece.superior_entry', 140],
    ] as const) {
      const { a, b } = cutSegment(zone, id);
      const ux = b.x - a.x;
      const uz = b.z - a.z;
      const len = Math.hypot(ux, uz);
      // The whole channel, from the harbor to the lake and 10 m in from each side, is
      // dredged.
      for (let t = 0; t <= 1; t += 0.05) {
        for (const side of [-1, 0, 1]) {
          const off = side * (width / 2 - 10);
          const x = a.x + ux * t + (-uz / len) * off;
          const z = a.z + uz * t + (ux / len) * off;
          expect(terrain.heightAt(x, z), `${id} t=${t} side=${side}`).toBeLessThan(-7);
        }
      }
    }
  });

  it.skipIf(!baked)('flattens the Duluth and Superior waterfronts above the water', () => {
    const fps = footprints(zone);
    for (const id of ['setpiece.duluth', 'setpiece.superior']) {
      const fp = fps.get(id);
      if (!fp) throw new Error(id);
      const town = out(fp, -40);
      expect(zone.terrain.heightAt(town.x, town.z), id).toBeCloseTo(fp.def.groundM, 0);
      const berth = out(fp, 40);
      expect(zone.terrain.heightAt(berth.x, berth.z), id).toBeLessThan(-SAILABLE_M);
    }
  });

  it.skipIf(!baked)('lets a schooner reach both waterfronts by either entry', () => {
    const { terrain } = zone;
    const spawn = spawnPose(zoneDef('zone.twin_ports'));
    const fps = footprints(zone);
    const duluth = out(fps.get('setpiece.duluth') as SetPieceFootprint, 40);
    const superior = out(fps.get('setpiece.superior') as SetPieceFootprint, 40);
    const canal = cutSegment(zone, 'setpiece.duluth_canal');
    const entry = cutSegment(zone, 'setpiece.superior_entry');
    // Closing an entry takes out its channel and a margin past the dredged width.
    const near = (s: { a: Zone; b: Zone }, r: number) => (x: number, z: number) =>
      segmentDistance(s.a, s.b, x, z) < r;

    const either = sailable(terrain, spawn);
    expect(either(duluth)).toBe(true);
    expect(either(superior)).toBe(true);
    // With Superior Entry closed, the canal still gets you in, and the other way round.
    for (const [name, closed] of [
      ['entry', near(entry, 100)],
      ['canal', near(canal, 60)],
    ] as const) {
      const one = sailable(terrain, spawn, closed);
      expect(one(duluth), `${name} closed`).toBe(true);
      expect(one(superior), `${name} closed`).toBe(true);
    }
    // With both closed, the harbor is cut off from the lake.
    const neither = sailable(
      terrain,
      spawn,
      (x, z) => near(entry, 100)(x, z) || near(canal, 60)(x, z),
    );
    expect(neither(duluth)).toBe(false);
    expect(neither(superior)).toBe(false);
  });
});

describe('the Two Harbors zone', () => {
  const { dir, baked } = bakedDir('two_harbors');
  let zone: LoadedZone;
  beforeAll(async () => {
    if (baked) zone = await load(dir);
  });

  zoneBasics('two_harbors', 'zone.two_harbors', [3, 3], () => zone);

  it.skipIf(!baked)('dredges Agate Bay into a basin a schooner can reach', () => {
    const { terrain } = zone;
    const fp = footprints(zone).get('setpiece.two_harbors');
    if (!fp) throw new Error('setpiece.two_harbors');
    const { a, b } = cutSegment(zone, 'setpiece.two_harbors');
    for (const p of [a, b, { x: (a.x + b.x) / 2, z: (a.z + b.z) / 2 }]) {
      expect(terrain.heightAt(p.x, p.z)).toBeLessThan(-7);
    }
    const reach = sailable(terrain, spawnPose(zoneDef('zone.two_harbors')));
    expect(reach(a)).toBe(true);
    // Lighthouse Point, east of the bay, is still there.
    expect(terrain.heightAt(-120, -190)).toBeGreaterThan(0);
    // The town behind the docks stands on the footprint's flattened ground.
    // North-east of the basin, 100 m inland.
    const town = {
      x: out(fp, -100).x - Math.sin(fp.bearing + Math.PI / 2) * 110,
      z: out(fp, -100).z + Math.cos(fp.bearing + Math.PI / 2) * 110,
    };
    expect(terrain.heightAt(town.x, town.z)).toBeCloseTo(fp.def.groundM, 0);
  });

  it.skipIf(!baked)('keeps the North Shore bluffs under the soft knee', () => {
    // Over 300 m of real relief inland, squeezed by the soft knee to under 60 m.
    expect(zone.manifest.height.maxM).toBeGreaterThan(40);
    expect(zone.manifest.height.maxM).toBeLessThan(60);
  });
});
