import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { QUALITY_PRESETS } from '../src/render/quality';
import { LOD_HYSTERESIS_M, nextStride, strideAt, tileDistance } from '../src/render/terrain/lod';
import {
  buildGridGeometry,
  createTerrainView,
  presetLod,
} from '../src/render/terrain/terrain-mesh';
import { GridField } from '../src/sim/terrain/grid-field';
import { loadZoneTerrain, type LoadedZone } from '../src/sim/terrain/load';
import {
  edgeDistance,
  edgeFactor,
  edgeVisibility,
  EDGE_HOLD_M,
  holdInside,
} from '../src/sim/terrain/zone-edge';
import { APOSTLES_ID, spawnPose, zoneDef } from '../src/sim/terrain/zones';

const MEDIUM = presetLod(QUALITY_PRESETS.medium);

describe('terrain LOD', () => {
  it('doubles the stride every lodM and leaves far tiles to the backdrop', () => {
    expect(MEDIUM).toEqual({ stride: 2, lodM: 1000, streamM: 2000 });
    expect(strideAt(0, MEDIUM)).toBe(2);
    expect(strideAt(999, MEDIUM)).toBe(2);
    expect(strideAt(1001, MEDIUM)).toBe(4);
    // Stride 8 would match the 32 m backdrop, so the backdrop draws it.
    expect(strideAt(1999, MEDIUM)).toBe(4);
    expect(strideAt(2001, MEDIUM)).toBe(0);
    const low = presetLod(QUALITY_PRESETS.low);
    expect(strideAt(500, low)).toBe(4);
    expect(strideAt(1300, low)).toBe(0);
    const high = presetLod(QUALITY_PRESETS.high);
    expect([0, 900, 1700, 2500].map((d) => strideAt(d, high))).toEqual([1, 2, 4, 0]);
  });

  it('keeps a stride until the camera is past the boundary by the hysteresis', () => {
    const edge = MEDIUM.lodM;
    expect(nextStride(edge + LOD_HYSTERESIS_M / 2, MEDIUM, 2)).toBe(2);
    expect(nextStride(edge + LOD_HYSTERESIS_M + 1, MEDIUM, 2)).toBe(4);
    expect(nextStride(edge - LOD_HYSTERESIS_M / 2, MEDIUM, 4)).toBe(4);
    expect(nextStride(edge - LOD_HYSTERESIS_M - 1, MEDIUM, 4)).toBe(2);
    // A new tile takes the plain answer.
    expect(nextStride(edge + 10, MEDIUM, 0)).toBe(4);
    expect(nextStride(MEDIUM.streamM + 10, MEDIUM, 4)).toBe(4);
    expect(nextStride(MEDIUM.streamM + LOD_HYSTERESIS_M + 1, MEDIUM, 4)).toBe(0);
  });

  it('measures from the camera to the nearest point of the tile', () => {
    const b = { minX: 0, minZ: 0, maxX: 1024, maxZ: 1024 };
    expect(tileDistance(b, 500, 0, 500)).toBe(0);
    expect(tileDistance(b, -300, 0, 500)).toBe(300);
    expect(tileDistance(b, -300, 400, 1424)).toBeCloseTo(Math.hypot(300, 400, 400));
  });
});

describe('soft zone edge', () => {
  const b = { minX: -1000, minZ: -1000, maxX: 1000, maxZ: 1000 };
  const edge = { fogFadeM: 400, edgeVisibilityM: 300 };

  it('closes the fog in over the fade', () => {
    expect(edgeDistance(b, 0, 0)).toBe(1000);
    expect(edgeDistance(b, 900, 0)).toBe(100);
    expect(edgeFactor(b, edge, 0, 0)).toBe(0);
    expect(edgeVisibility(b, edge, 0, 0, 6000)).toBe(Infinity);
    expect(edgeVisibility(b, edge, 1000, 0, 6000)).toBeCloseTo(300);
    const v = [700, 800, 900, 1000].map((x) => edgeVisibility(b, edge, x, 0, 6000));
    for (let k = 1; k < v.length; k++) expect(v[k]).toBeLessThan(v[k - 1] ?? 0);
  });

  it('holds a ship just inside the edge', () => {
    const p = { x: 1100, z: -5 };
    expect(holdInside(b, p)).toBe(true);
    expect(p).toEqual({ x: 1000 - EDGE_HOLD_M, z: -5 });
    expect(holdInside(b, p)).toBe(false);
  });
});

describe('terrain streaming on a synthetic zone', () => {
  // 4 × 4 tiles of 64 samples at 4 m: an island in each tile so none are all deep.
  const n = 64;
  const size = 4 * n + 1;
  const values = new Float32Array(size * size);
  for (let j = 0; j < size; j++) {
    for (let i = 0; i < size; i++) {
      values[j * size + i] = 10 * Math.cos(((i % n) / n) * 2 * Math.PI) - 5;
    }
  }
  const height = new GridField(0, 0, 4, size, size, values);
  const terrain = { height, bounds: { minX: 0, minZ: 0, maxX: 1024, maxZ: 1024 } };
  const backdrop = new GridField(0, 0, 32, 33, 33, new Float32Array(33 * 33).fill(5));
  const preset = { ...QUALITY_PRESETS.medium, terrainLodM: 300, terrainStreamM: 500 };

  it('streams tiles around the camera and hides the backdrop under them', () => {
    const view = createTerrainView(
      terrain as unknown as Parameters<typeof createTerrainView>[0],
      backdrop,
      n,
      preset,
      { x: 0, y: 0, z: 0 },
    );
    const back = view.group.getObjectByName('terrain-backdrop') as THREE_Mesh;
    const full = 32 * 32 * 6;
    // From the corner: the four tiles within 500 m (256 m tiles), stride 2 out to 300 m.
    expect(view.stats.tiles).toBe(4);
    expect(view.stats.strides).toEqual({ 2: 3, 4: 1 });
    expect(back.geometry.drawRange.count).toBe(full - 4 * 8 * 8 * 6);
    // Across the zone, built within the budget a tile at a time.
    for (let k = 0; k < 20; k++) view.update(1000, 0, 1000, 0);
    expect(view.stats.pending).toBe(0);
    expect(view.stats.tiles).toBe(4);
    expect(back.geometry.drawRange.count).toBe(full - 4 * 8 * 8 * 6);
    const builds = view.stats.builds;
    // Coming back is served from the cache.
    view.update(0, 0, 0, 0);
    expect(view.stats.builds).toBe(builds);
    expect(view.stats.pending).toBe(0);
    view.update(1000, 0, 1000, 0);
    expect(view.stats.builds).toBe(builds);
  });

  it('starts over when the preset changes', () => {
    const view = createTerrainView(
      terrain as unknown as Parameters<typeof createTerrainView>[0],
      backdrop,
      n,
      preset,
    );
    view.applyPreset({ ...preset, terrainStride: 1 });
    view.update(0, 0, 0, Infinity);
    expect(view.stats.strides).toEqual({ 1: 3, 2: 1 });
  });
});

type THREE_Mesh = import('three').Mesh;

describe('the Apostles zone on each preset', () => {
  const dir = join(__dirname, '..', 'public', 'world', 'apostles');
  const baked =
    existsSync(join(dir, 'manifest.json')) &&
    readFileSync(join(dir, 'height', '0-0.bin')).byteLength > 200;
  let zone: LoadedZone;
  beforeAll(async () => {
    if (!baked) return;
    zone = await loadZoneTerrain(async (path) => new Uint8Array(readFileSync(join(dir, path))));
  });

  it.skipIf(!baked)('stays within 40 terrain draw calls on Medium anywhere in the zone', () => {
    const field = zone.terrain.height;
    const tileM = 256 * field.step;
    // Which tiles have any terrain to draw at each stride (all-deep tiles draw nothing).
    const drawable = new Map<string, boolean>();
    const hasTriangles = (tx: number, ty: number, stride: number): boolean => {
      const key = `${tx}:${ty}:${stride}`;
      let v = drawable.get(key);
      if (v === undefined) {
        const g = buildGridGeometry(field, {
          i0: tx * 256,
          j0: ty * 256,
          i1: tx * 256 + 256,
          j1: ty * 256 + 256,
          stride,
          skirts: true,
        });
        v = (g.index?.count ?? 0) > 0;
        drawable.set(key, v);
      }
      return v;
    };
    const worst: Record<string, number> = {};
    for (const id of ['low', 'medium', 'high'] as const) {
      const lod = presetLod(QUALITY_PRESETS[id]);
      let most = 0;
      for (let z = field.z0; z <= field.maxZ; z += 128) {
        for (let x = field.x0; x <= field.maxX; x += 128) {
          let calls = 1; // the backdrop
          for (let ty = 0; ty < 8; ty++) {
            for (let tx = 0; tx < 7; tx++) {
              const b = {
                minX: field.x0 + tx * tileM,
                minZ: field.z0 + ty * tileM,
                maxX: field.x0 + (tx + 1) * tileM,
                maxZ: field.z0 + (ty + 1) * tileM,
              };
              // A chase camera 15 m up; the hysteresis can keep a tile 64 m longer.
              const stride = strideAt(Math.max(0, tileDistance(b, x, 15, z) - 64), lod);
              if (stride && hasTriangles(tx, ty, stride)) calls++;
            }
          }
          most = Math.max(most, calls);
        }
      }
      worst[id] = most;
    }
    expect(worst['medium']).toBeLessThanOrEqual(40);
    expect(worst['low']).toBeLessThanOrEqual(worst['medium'] ?? 0);
  });

  it.skipIf(!baked)('builds the spawn view and streams to Ashland', () => {
    const spawn = spawnPose(zoneDef(APOSTLES_ID));
    const view = createTerrainView(zone.terrain, zone.backdrop, 256, QUALITY_PRESETS.medium, {
      x: spawn.x,
      y: 15,
      z: spawn.z,
    });
    expect(view.stats.pending).toBe(0);
    expect(view.stats.drawCalls).toBeLessThanOrEqual(40);
    const tiles = (x: number, z: number) =>
      view.group.children.filter((m) => m.visible && m.name === `terrain-tile-${x}-${z}`).length;
    // The spawn's own tile (2, 4) is drawn; Ashland's (2, 7) is not yet.
    expect(tiles(2, 4)).toBe(1);
    expect(tiles(2, 7)).toBe(0);
    for (let k = 0; k < 40; k++) view.update(-1540, 15, 3300, 4);
    expect(view.stats.pending).toBe(0);
    expect(tiles(2, 7)).toBe(1);
    expect(tiles(2, 4)).toBe(0);
  });
});
