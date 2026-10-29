import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import * as THREE from 'three';
import { beforeAll, describe, expect, it } from 'vitest';
import { QUALITY_IDS, QUALITY_PRESETS } from '../src/render/quality';
import { createTerrainView } from '../src/render/terrain/terrain-mesh';
import { buildTileArrays } from '../src/render/terrain/tile-mesh';
import { createBirch, createPine, createRock } from '../src/render/vegetation/plant-models';
import { createVegetationView, vegetationFades } from '../src/render/vegetation/vegetation';
import { GridField } from '../src/sim/terrain/grid-field';
import { loadZoneTerrain, type LoadedZone } from '../src/sim/terrain/load';
import {
  CANOPY_M,
  canopyHeight,
  clearingFromFootprint,
  countAtDensity,
  forestDensity,
  hash01,
  plantTile,
  PLANT_STRIDE,
  PlantKind,
  rockDensity,
  TREELINE_LOW_M,
  valueNoise,
  type TilePlants,
} from '../src/sim/terrain/vegetation';
import { withCanopy } from '../tools/geo/lib/wind';

/** A 512 m island: a dome rising to 30 m, so it has beach, forest and steep sides. */
function island(): GridField {
  const size = 257;
  const values = new Float32Array(size * size);
  for (let j = 0; j < size; j++) {
    for (let i = 0; i < size; i++) {
      const r = Math.hypot(i - 128, j - 128) * 4;
      values[j * size + i] = 34 * Math.max(0, 1 - (r / 400) ** 2) - 4;
    }
  }
  return new GridField(-512, -512, 4, size, size, values);
}

const positions = (plants: Float32Array): string[] => {
  const out: string[] = [];
  for (let k = 0; k < plants.length; k += PLANT_STRIDE) {
    out.push(`${plants[k]?.toFixed(3)},${plants[k + 2]?.toFixed(3)}`);
  }
  return out.sort();
};

describe('vegetation density map', () => {
  it('hashes and noise are deterministic and in range', () => {
    expect(hash01(3, -7, 1)).toBe(hash01(3, -7, 1));
    expect(hash01(3, -7, 1)).not.toBe(hash01(3, -7, 2));
    for (let k = 0; k < 200; k++) {
      const v = valueNoise(k * 37.1, -k * 11.3, 100, 5);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
    }
  });

  it('grows no forest on beaches or cliffs, and full forest on gentle high ground somewhere', () => {
    expect(forestDensity(TREELINE_LOW_M - 0.1, 1, 0, 0)).toBe(0);
    expect(forestDensity(20, 0.55, 0, 0)).toBe(0);
    let most = 0;
    for (let x = 0; x < 5000; x += 50) most = Math.max(most, forestDensity(20, 1, x, 0));
    expect(most).toBeGreaterThan(0.99);
    // The clearings thin the forest but never take it all.
    for (let x = 0; x < 5000; x += 50) expect(forestDensity(20, 1, x, 0)).toBeGreaterThan(0.1);
  });

  it('puts rocks on the shore and steep ground, not up in the woods', () => {
    expect(rockDensity(-2, 1)).toBe(0);
    expect(rockDensity(20, 1)).toBe(0);
    expect(rockDensity(1, 0.6)).toBeGreaterThan(rockDensity(1, 1));
  });

  it('gives forested land the 15 m canopy for the shelter bake', () => {
    let x = 0;
    while (forestDensity(20, 1, x, 0) < 0.99) x += 50;
    expect(canopyHeight(20, 1, x, 0)).toBe(CANOPY_M);
    expect(canopyHeight(1, 1, x, 0)).toBe(0);
  });
});

describe('planting', () => {
  const field = island();

  it('plants the same trees every time, sorted by rank', () => {
    const a = plantTile(field, -512, -512, 1024);
    const b = plantTile(field, -512, -512, 1024);
    expect(a.trees).toEqual(b.trees);
    expect(a.trees.length).toBeGreaterThan(0);
    expect(a.rocks.length).toBeGreaterThan(0);
    for (let k = PLANT_STRIDE; k < a.trees.length; k += PLANT_STRIDE) {
      expect(a.trees[k + 7]).toBeGreaterThanOrEqual(a.trees[k - PLANT_STRIDE + 7] ?? 0);
    }
    for (let k = 0; k < a.trees.length; k += PLANT_STRIDE) {
      expect(a.trees[k + 1]).toBeGreaterThanOrEqual(TREELINE_LOW_M);
      expect([PlantKind.Pine, PlantKind.Birch]).toContain(a.trees[k + 5]);
    }
  });

  it('has no seams: four tiles plant exactly what one big square does', () => {
    const whole = plantTile(field, -512, -512, 1024);
    const parts = [
      [-512, -512],
      [0, -512],
      [-512, 0],
      [0, 0],
    ].map(([x, z]) => plantTile(field, x ?? 0, z ?? 0, 512));
    const joined = (key: keyof TilePlants) => parts.flatMap((p) => positions(p[key])).sort();
    expect(joined('trees')).toEqual(positions(whole.trees));
    expect(joined('rocks')).toEqual(positions(whole.rocks));
  });

  it('thins by taking a prefix, so a lower density keeps a subset', () => {
    const { trees } = plantTile(field, -512, -512, 1024);
    const n = trees.length / PLANT_STRIDE;
    expect(countAtDensity(trees, 1)).toBe(n);
    expect(countAtDensity(trees, 0)).toBe(0);
    const half = countAtDensity(trees, 0.5);
    expect(half / n).toBeGreaterThan(0.4);
    expect(half / n).toBeLessThan(0.6);
    expect(trees[(half - 1) * PLANT_STRIDE + 7]).toBeLessThan(0.5);
    expect(trees[half * PLANT_STRIDE + 7]).toBeGreaterThanOrEqual(0.5);
  });

  it('keeps set-piece footprints clear', () => {
    // A 200 × 200 m footprint on the island's east side, facing east.
    const clearing = clearingFromFootprint({ x: 300, z: 0 }, Math.PI / 2, 200, 200, 0);
    expect(clearing.x).toBeCloseTo(200);
    const { trees, rocks } = plantTile(field, -512, -512, 1024, [clearing]);
    for (const list of [trees, rocks]) {
      for (let k = 0; k < list.length; k += PLANT_STRIDE) {
        const x = list[k] ?? 0;
        const z = list[k + 2] ?? 0;
        expect(x >= 100 && x <= 300 && Math.abs(z) <= 100).toBe(false);
      }
    }
  });

  it('marks forest on the terrain mesh for the shader', () => {
    const a = buildTileArrays(field, { i0: 0, j0: 0, i1: 256, j1: 256, stride: 4, skirts: true });
    expect(a.forest.length).toBe(a.positions.length / 3);
    expect(Math.max(...a.forest)).toBeGreaterThan(0.5);
    // The sea floor around the island has none.
    expect(a.forest[0]).toBe(0);
  });

  it('raises forested land by the canopy for the wind bake, and only land', () => {
    const grid = { width: 257, height: 257, step: 4, x0: -512, z0: -512 };
    const raised = withCanopy({ width: 257, height: 257, data: field.values }, grid);
    let lifted = 0;
    for (let k = 0; k < field.values.length; k++) {
      const before = field.values[k] ?? 0;
      const after = raised.data[k] ?? 0;
      if (before <= 0) expect(after).toBe(before);
      expect(after - before).toBeLessThanOrEqual(CANOPY_M + 1e-4);
      if (after - before > CANOPY_M - 1e-4) lifted++;
    }
    expect(lifted).toBeGreaterThan(1000);
  });
});

describe('plant models', () => {
  it('stay far under the 300–800 triangle budget for a tree (plan 14 §9)', () => {
    for (const m of [createPine(), createBirch(), createRock()]) {
      const tris = m.geometry.getAttribute('position').count / 3;
      expect(tris).toBeLessThan(150);
      expect(m.geometry.getAttribute('color')).toBeDefined();
      m.geometry.computeBoundingBox();
      expect(m.geometry.boundingBox?.max.y).toBeLessThanOrEqual(m.height + 0.01);
      expect(m.geometry.boundingBox?.max.x).toBeLessThanOrEqual(m.radius + 0.01);
    }
  });
});

describe('the vegetation view', () => {
  const field = island();
  const terrain = { height: field, bounds: { minX: -512, minZ: -512, maxX: 512, maxZ: 512 } };
  const backdrop = new GridField(-512, -512, 32, 33, 33, new Float32Array(33 * 33).fill(-20));
  const models = () => {
    const pine = createPine();
    const birch = createBirch();
    const atlas = {
      albedo: new THREE.Texture(),
      normal: new THREE.Texture(),
      sizes: [pine, birch].map((m) => ({ halfWidth: m.radius, height: m.height })),
      dispose() {},
    };
    return { pine, birch, rock: createRock(), atlas };
  };
  const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

  it('fills the near meshes, draws one impostor call per tile, and follows the preset', async () => {
    const preset = QUALITY_PRESETS.medium;
    const view = createTerrainView(
      terrain as unknown as Parameters<typeof createTerrainView>[0],
      backdrop,
      64,
      preset,
      { x: 0, y: 15, z: 0 },
      false,
    );
    const plants = createVegetationView(view, models(), { uniforms: {} } as never, preset);
    // Two plantings are out at a time; on the main thread they finish by the next tick.
    for (let k = 0; k < 10; k++) {
      plants.update(0, 15, 0);
      await settle();
    }
    plants.update(0, 15, 0);
    // 16 tiles of 256 m, all within the impostors' reach.
    expect(plants.stats.planted).toBe(16);
    expect(plants.stats.impostorTiles).toBeGreaterThan(0);
    expect(plants.stats.impostorTiles).toBeLessThanOrEqual(16);
    expect(plants.stats.pines + plants.stats.birches).toBeGreaterThan(0);
    // Plus one call for each near mesh with anything in it (pines, birches, rocks).
    expect(plants.stats.drawCalls).toBeGreaterThan(plants.stats.impostorTiles);
    expect(plants.stats.drawCalls).toBeLessThanOrEqual(plants.stats.impostorTiles + 3);
    // Every near instance is within the mesh distance plus the refill margin.
    const pines = plants.group.getObjectByName('pines') as THREE.InstancedMesh;
    const m = new THREE.Matrix4();
    const p = new THREE.Vector3();
    for (let k = 0; k < pines.count; k++) {
      pines.getMatrixAt(k, m);
      p.setFromMatrixPosition(m);
      expect(Math.hypot(p.x, p.z)).toBeLessThanOrEqual(preset.vegetationMeshM + 48);
    }
    const medium = plants.stats.impostors;
    plants.applyPreset(QUALITY_PRESETS.high);
    plants.update(0, 15, 0);
    expect(plants.stats.impostors).toBeGreaterThan(medium);
    plants.applyPreset(QUALITY_PRESETS.low);
    plants.update(0, 15, 0);
    expect(plants.stats.impostors).toBeLessThan(medium);
  });

  it('hands meshes to impostors inside the impostors’ reach on every preset', () => {
    for (const id of QUALITY_IDS) {
      const f = vegetationFades(QUALITY_PRESETS[id]);
      expect(f.meshStart).toBeLessThan(f.meshEnd);
      expect(f.meshEnd).toBeLessThan(f.farStart);
      expect(f.farStart).toBeLessThan(f.farEnd);
    }
  });
});

describe('vegetation on the Apostles zone', () => {
  const dir = join(__dirname, '..', 'public', 'world', 'apostles');
  const baked =
    existsSync(join(dir, 'manifest.json')) &&
    readFileSync(join(dir, 'height', '0-0.bin')).byteLength > 200;
  let zone: LoadedZone;
  const tiles: TilePlants[] = [];
  beforeAll(async () => {
    if (!baked) return;
    zone = await loadZoneTerrain(async (path) => new Uint8Array(readFileSync(join(dir, path))));
    const f = zone.terrain.height;
    for (let ty = 0; ty < 8; ty++) {
      for (let tx = 0; tx < 7; tx++) {
        tiles.push(plantTile(f, f.x0 + tx * 1024, f.z0 + ty * 1024, 1024));
      }
    }
  });

  it.skipIf(!baked)('fits its share of the frame budget anywhere in the zone', () => {
    const f = zone.terrain.height;
    const tris = {
      [PlantKind.Pine]: createPine().geometry.getAttribute('position').count / 3,
      [PlantKind.Birch]: createBirch().geometry.getAttribute('position').count / 3,
      [PlantKind.Rock]: createRock().geometry.getAttribute('position').count / 3,
    };
    const worst: Record<string, { calls: number; triangles: number }> = {};
    for (const id of QUALITY_IDS) {
      const preset = QUALITY_PRESETS[id];
      const far = preset.vegetationFarM;
      const near = preset.vegetationMeshM + 48;
      let calls = 0;
      let triangles = 0;
      for (let z = f.z0; z <= f.maxZ; z += 512) {
        for (let x = f.x0; x <= f.maxX; x += 512) {
          let c = 3;
          let t = 0;
          tiles.forEach((p, k) => {
            const bx = f.x0 + (k % 7) * 1024;
            const bz = f.z0 + Math.floor(k / 7) * 1024;
            const d = Math.hypot(
              Math.max(bx - x, 0, x - bx - 1024),
              Math.max(bz - z, 0, z - bz - 1024),
            );
            const n = countAtDensity(p.trees, preset.vegetationDensity);
            if (d < far && n > 0) {
              c++;
              t += 2 * n;
            }
            for (const list of [p.trees, p.rocks]) {
              const m = countAtDensity(list, preset.vegetationDensity);
              for (let i = 0; i < m; i++) {
                const o = i * PLANT_STRIDE;
                if (Math.hypot((list[o] ?? 0) - x, (list[o + 2] ?? 0) - z) <= near) {
                  t += tris[list[o + 5] as 0 | 1 | 2];
                }
              }
            }
          });
          calls = Math.max(calls, c);
          triangles = Math.max(triangles, t);
        }
      }
      worst[id] = { calls, triangles };
    }
    // Before frustum culling. Medium's frame is 150 calls and 600k triangles (01 §5), and
    // terrain takes up to 40 calls. Measured: Medium 24 calls and 237k triangles at worst.
    expect(worst['medium']?.calls).toBeLessThanOrEqual(30);
    expect(worst['medium']?.triangles).toBeLessThanOrEqual(270_000);
    expect(worst['low']?.triangles).toBeLessThan(worst['medium']?.triangles ?? 0);
  });
});
