import * as THREE from 'three';
import type { GridField } from '../../sim/terrain/grid-field';
import type { TerrainBounds, ZoneTerrain } from '../../sim/terrain/zone-terrain';
import { plantTile, type Clearing, type TilePlants } from '../../sim/terrain/vegetation';
import type { QualityPreset } from '../quality';
import { nextStride, tileDistance, type TerrainLod } from './lod';
import { buildTileArrays, type GridMeshOptions, type TileArrays } from './tile-mesh';
import type { TileWorkerRequest, TileWorkerResponse } from './tile-worker';

/**
 * Whole-zone terrain rendering (plan 03 §8.3, Phase 2 piece B). Every sailing tile near
 * the camera gets its own mesh at a stride picked by distance (render/terrain/lod), with
 * skirts hiding the cracks where neighbors differ. Everything else is one coarse backdrop
 * mesh of the whole zone, which leaves out the cells under drawn tiles, so distant
 * islands always show as silhouettes in the fog.
 *
 * Tile meshes build in a worker (render/terrain/tile-worker), nearest first, a couple
 * of tiles go on screen per frame, and they stay cached for a while; until a tile's mesh
 * is ready the backdrop keeps drawing it. Without workers (tests) tiles build on the
 * main thread within a per-frame budget.
 * Tiles also plant their vegetation in the same worker (`plant`), for render/vegetation.
 * The look is the style B terrain shader (terrain-material.ts, piece C).
 */

/** Milliseconds of main-thread tile building per frame when there's no worker. */
export const BUILD_BUDGET_MS = 4;
/** Tile meshes kept around after they leave the view, so turning back is free. */
const CACHE_TILES = 40;
/** Tile builds out at the worker at once, so the nearest tiles stay first in line. */
const MAX_IN_FLIGHT = 3;
/** Finished tiles put on screen per frame, which spreads their GPU uploads out. */
const MAX_SWAPS_PER_FRAME = 2;

/** A three.js geometry over built arrays, with its bounding sphere from the tile's box. */
export function tileGeometry(
  a: TileArrays,
  o: GridMeshOptions,
  step: number,
  x0: number,
  z0: number,
) {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(a.positions, 3));
  geometry.setAttribute('normal', new THREE.BufferAttribute(a.normals, 3));
  geometry.setAttribute('forest', new THREE.BufferAttribute(a.forest, 1));
  geometry.setIndex(new THREE.BufferAttribute(a.indices, 1));
  const box = new THREE.Box3(
    new THREE.Vector3(x0 + o.i0 * step, a.minY, z0 + o.j0 * step),
    new THREE.Vector3(x0 + o.i1 * step, a.maxY, z0 + o.j1 * step),
  );
  geometry.boundingBox = box;
  geometry.boundingSphere = box.getBoundingSphere(new THREE.Sphere());
  return geometry;
}

/** A terrain patch with positions, normals and forest density, in zone meters. */
export function buildGridGeometry(field: GridField, o: GridMeshOptions): THREE.BufferGeometry {
  return tileGeometry(buildTileArrays(field, o), o, field.step, field.x0, field.z0);
}

/**
 * The whole-zone backdrop: one mesh whose index buffer holds each tile's cells as a
 * run, so the cells under drawn tiles can be left out by rewriting the index alone.
 * Backdrop cells line up with tile edges (32 cells per 1024 m tile).
 */
export interface Backdrop {
  readonly mesh: THREE.Mesh;
  /** Draw the backdrop everywhere except the tiles marked true. */
  hide(covered: readonly boolean[]): void;
}

export function createBackdrop(
  backdrop: GridField,
  tilesX: number,
  tilesY: number,
  material: THREE.Material,
): Backdrop {
  const geometry = buildGridGeometry(backdrop, {
    i0: 0,
    j0: 0,
    i1: backdrop.width - 1,
    j1: backdrop.height - 1,
    stride: 1,
    skirts: false,
  });
  const cellsX = (backdrop.width - 1) / tilesX;
  const cellsY = (backdrop.height - 1) / tilesY;
  if (!Number.isInteger(cellsX) || !Number.isInteger(cellsY)) {
    throw new RangeError('terrain: backdrop cells must line up with the tiles');
  }
  // Regroup the culled quads by tile; quads come in pairs of triangles, top-left first.
  const all = geometry.getIndex()?.array as Uint32Array;
  const runs: number[][] = Array.from({ length: tilesX * tilesY }, () => []);
  const w = backdrop.width;
  for (let q = 0; q < all.length; q += 6) {
    const a = all[q] ?? 0;
    const tx = Math.min(tilesX - 1, Math.floor((a % w) / cellsX));
    const ty = Math.min(tilesY - 1, Math.floor(Math.floor(a / w) / cellsY));
    const run = runs[ty * tilesX + tx] as number[];
    for (let k = 0; k < 6; k++) run.push(all[q + k] ?? 0);
  }
  const tileRuns = runs.map((r) => Uint32Array.from(r));
  const index = new THREE.BufferAttribute(new Uint32Array(all.length), 1);
  index.setUsage(THREE.DynamicDrawUsage);
  geometry.setIndex(index);

  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = 'terrain-backdrop';
  // Sit a hair lower so the tiles' skirts win wherever the two overlap at the seam.
  mesh.position.y = -0.05;

  return {
    mesh,
    hide(covered) {
      const out = index.array as Uint32Array;
      let n = 0;
      tileRuns.forEach((run, t) => {
        if (covered[t]) return;
        out.set(run, n);
        n += run.length;
      });
      geometry.setDrawRange(0, n);
      index.clearUpdateRanges();
      index.addUpdateRange(0, n);
      index.needsUpdate = true;
    },
  };
}

export interface TerrainStats {
  /** Tiles drawn with their own mesh (not counting all-deep tiles, which draw nothing). */
  tiles: number;
  /** Tile meshes plus the backdrop: the most the terrain can add, before frustum culling. */
  drawCalls: number;
  /** Tiles whose mesh isn't at the wanted stride yet. */
  pending: number;
  /** Whether tiles build in the worker or on the main thread. */
  worker: boolean;
  /** Tile meshes built so far, and the slowest build in milliseconds (in the worker or not). */
  builds: number;
  maxBuildMs: number;
  /** Main-thread time in `update`, this frame and the slowest so far. */
  lastUpdateMs: number;
  maxUpdateMs: number;
  /** Tiles drawn at each stride, by stride. */
  strides: Record<number, number>;
}

export interface TerrainView {
  readonly group: THREE.Group;
  readonly stats: TerrainStats;
  /** Each sailing tile's bounds, by tile index (row-major, tilesX per row). */
  readonly tileBounds: readonly TerrainBounds[];
  /**
   * The trees and rocks of tile `t`, planted in the worker (or on the main thread without
   * one). The same tile always gets the same plants.
   */
  plant(t: number, clearings: readonly Clearing[]): Promise<TilePlants>;
  applyPreset(preset: QualityPreset): void;
  /**
   * Picks each tile's stride for a camera at (x, y, z), puts finished tiles on screen and
   * asks for missing ones. Without a worker it builds within `budgetMs` (one tile at
   * least). Call once a frame.
   */
  update(x: number, y: number, z: number, budgetMs?: number): void;
  /** Resets the slowest-build and slowest-update readings. */
  resetStats(): void;
  dispose(): void;
}

/** A preset's terrain LOD settings. */
export function presetLod(preset: QualityPreset): TerrainLod {
  return {
    stride: preset.terrainStride,
    lodM: preset.terrainLodM,
    streamM: preset.terrainStreamM,
  };
}

interface Tile {
  bounds: TerrainBounds;
  i0: number;
  j0: number;
  mesh: THREE.Mesh;
  /** Stride on screen; 0 when the backdrop draws it. */
  shown: number;
  want: number;
  /** The shown geometry has no triangles (deep water). */
  empty: boolean;
  distance: number;
}

interface Built {
  t: number;
  stride: number;
  arrays: TileArrays;
}

/** The tile worker, or undefined where workers can't start (tests, old browsers). */
function startWorker(field: GridField): Worker | undefined {
  if (typeof Worker === 'undefined') return undefined;
  try {
    const worker = new Worker(new URL('./tile-worker.ts', import.meta.url), { type: 'module' });
    // A copy of the heights, once; the sim keeps its own.
    const grid = {
      x0: field.x0,
      z0: field.z0,
      step: field.step,
      width: field.width,
      height: field.height,
      values: field.values.slice(),
    };
    worker.postMessage({ kind: 'grid', grid } satisfies TileWorkerRequest, [grid.values.buffer]);
    return worker;
  } catch {
    return undefined;
  }
}

/**
 * The zone's terrain: tile meshes streamed around the camera over the backdrop.
 * `tileSamples` is the sailing tile size in samples (256), so each mesh matches one baked
 * tile and is culled on its own. `focus` is where the camera starts; the tiles around it
 * are built on the main thread before this returns, so the first frame has no holes.
 * `useWorker: false` keeps all building on the main thread. `material` is the terrain
 * shader (createTerrainMaterial); without one the terrain draws flat greybox green.
 */
export function createTerrainView(
  terrain: ZoneTerrain,
  backdrop: GridField,
  tileSamples: number,
  preset: QualityPreset,
  focus: { x: number; y: number; z: number } = { x: 0, y: 0, z: 0 },
  useWorker = true,
  material: THREE.Material = new THREE.MeshLambertMaterial({
    color: 0x5f7c46,
    side: THREE.DoubleSide,
  }),
): TerrainView {
  const group = new THREE.Group();
  group.name = 'terrain';
  const field = terrain.height;
  const tilesX = (field.width - 1) / tileSamples;
  const tilesY = (field.height - 1) / tileSamples;
  if (!Number.isInteger(tilesX) || !Number.isInteger(tilesY)) {
    throw new RangeError('terrain: the height grid is not a whole number of tiles');
  }

  const back = createBackdrop(backdrop, tilesX, tilesY, material);
  group.add(back.mesh);

  const empty = new THREE.BufferGeometry();
  const tiles: Tile[] = [];
  for (let ty = 0; ty < tilesY; ty++) {
    for (let tx = 0; tx < tilesX; tx++) {
      const i0 = tx * tileSamples;
      const j0 = ty * tileSamples;
      const mesh = new THREE.Mesh(empty, material);
      mesh.name = `terrain-tile-${tx}-${ty}`;
      mesh.visible = false;
      group.add(mesh);
      tiles.push({
        bounds: {
          minX: field.x0 + i0 * field.step,
          minZ: field.z0 + j0 * field.step,
          maxX: field.x0 + (i0 + tileSamples) * field.step,
          maxZ: field.z0 + (j0 + tileSamples) * field.step,
        },
        i0,
        j0,
        mesh,
        shown: 0,
        want: 0,
        empty: false,
        distance: 0,
      });
    }
  }
  const optionsFor = (t: number, stride: number): GridMeshOptions => {
    const tile = tiles[t] as Tile;
    return {
      i0: tile.i0,
      j0: tile.j0,
      i1: tile.i0 + tileSamples,
      j1: tile.j0 + tileSamples,
      stride,
      skirts: true,
    };
  };

  // Built geometries by tile and stride, least recently used first.
  const cache = new Map<string, THREE.BufferGeometry>();
  const keyOf = (t: number, stride: number): string => `${t}:${stride}`;
  const evict = (): void => {
    for (const [key, geometry] of cache) {
      if (cache.size <= CACHE_TILES) return;
      const [t, stride] = key.split(':').map(Number);
      const tile = tiles[t ?? 0];
      if (tile && tile.shown === stride) continue;
      geometry.dispose();
      cache.delete(key);
    }
  };

  const stats: TerrainStats = {
    tiles: 0,
    drawCalls: 1,
    pending: 0,
    worker: false,
    builds: 0,
    maxBuildMs: 0,
    lastUpdateMs: 0,
    maxUpdateMs: 0,
    strides: {},
  };

  let lod = presetLod(preset);
  // Bumped when the preset changes, so builds asked for before it are dropped.
  let generation = 0;
  const covered = tiles.map(() => false);
  const pending: number[] = [];
  const done: Built[] = [];

  const worker = useWorker ? startWorker(field) : undefined;
  stats.worker = worker !== undefined;
  let nextId = 0;
  const inFlight = new Map<number, { t: number; stride: number; generation: number }>();
  const asked = new Set<string>();
  const planting = new Map<number, (plants: TilePlants) => void>();
  if (worker) {
    worker.onmessage = (e: MessageEvent<TileWorkerResponse>) => {
      if (e.data.kind === 'plant') {
        const { id, trees, rocks } = e.data;
        planting.get(id)?.({ trees, rocks });
        planting.delete(id);
        return;
      }
      const { id, buildMs, positions, normals, forest, indices, minY, maxY } = e.data;
      const arrays = { positions, normals, forest, indices, minY, maxY };
      const job = inFlight.get(id);
      inFlight.delete(id);
      if (!job) return;
      asked.delete(keyOf(job.t, job.stride));
      if (job.generation !== generation) return;
      stats.builds++;
      stats.maxBuildMs = Math.max(stats.maxBuildMs, buildMs);
      done.push({ t: job.t, stride: job.stride, arrays });
    };
  }

  const show = (t: number, stride: number, geometry: THREE.BufferGeometry | undefined): void => {
    const tile = tiles[t] as Tile;
    tile.shown = stride;
    tile.empty = !geometry?.index?.count;
    tile.mesh.geometry = geometry ?? empty;
    tile.mesh.visible = stride > 0 && !tile.empty;
  };

  const store = (b: Built): THREE.BufferGeometry => {
    const geometry = tileGeometry(
      b.arrays,
      optionsFor(b.t, b.stride),
      field.step,
      field.x0,
      field.z0,
    );
    cache.set(keyOf(b.t, b.stride), geometry);
    return geometry;
  };

  const update = (x: number, y: number, z: number, budgetMs = BUILD_BUDGET_MS): void => {
    const start = performance.now();

    // Tiles the worker finished: cache them all, show the ones still wanted.
    let swaps = 0;
    while (done.length && swaps < MAX_SWAPS_PER_FRAME) {
      const b = done.shift() as Built;
      const geometry = store(b);
      if ((tiles[b.t] as Tile).want === b.stride) {
        show(b.t, b.stride, geometry);
        swaps++;
      }
    }

    pending.length = 0;
    tiles.forEach((tile, t) => {
      tile.distance = tileDistance(tile.bounds, x, y, z);
      tile.want = nextStride(tile.distance, lod, tile.shown);
      if (tile.want === tile.shown) return;
      if (tile.want === 0) return show(t, 0, undefined);
      const key = keyOf(t, tile.want);
      const cached = cache.get(key);
      if (cached) {
        // Refresh its place in the LRU order.
        cache.delete(key);
        cache.set(key, cached);
        show(t, tile.want, cached);
      } else {
        pending.push(t);
      }
    });

    pending.sort((a, b) => (tiles[a] as Tile).distance - (tiles[b] as Tile).distance);
    if (worker && Number.isFinite(budgetMs)) {
      for (const t of pending) {
        if (inFlight.size >= MAX_IN_FLIGHT) break;
        const stride = (tiles[t] as Tile).want;
        const key = keyOf(t, stride);
        if (asked.has(key)) continue;
        const id = nextId++;
        asked.add(key);
        inFlight.set(id, { t, stride, generation });
        worker.postMessage({
          kind: 'build',
          id,
          options: optionsFor(t, stride),
        } satisfies TileWorkerRequest);
      }
    } else {
      let built = 0;
      for (const t of pending) {
        if (built > 0 && performance.now() - start >= budgetMs) break;
        const stride = (tiles[t] as Tile).want;
        const t0 = performance.now();
        const arrays = buildTileArrays(field, optionsFor(t, stride));
        stats.maxBuildMs = Math.max(stats.maxBuildMs, performance.now() - t0);
        stats.builds++;
        built++;
        show(t, stride, store({ t, stride, arrays }));
      }
    }
    evict();

    let changed = false;
    let drawn = 0;
    stats.strides = {};
    tiles.forEach((tile, t) => {
      const cover = tile.shown > 0;
      if (cover !== covered[t]) changed = true;
      covered[t] = cover;
      if (cover && !tile.empty) {
        drawn++;
        stats.strides[tile.shown] = (stats.strides[tile.shown] ?? 0) + 1;
      }
    });
    if (changed) back.hide(covered);
    stats.tiles = drawn;
    stats.drawCalls = drawn + 1;
    stats.pending = tiles.filter((tile) => tile.want !== tile.shown).length;
    stats.lastUpdateMs = performance.now() - start;
    stats.maxUpdateMs = Math.max(stats.maxUpdateMs, stats.lastUpdateMs);
  };

  back.hide(covered);
  // Everything around the start, on this thread, before the first frame.
  update(focus.x, focus.y, focus.z, Number.POSITIVE_INFINITY);
  // The readings are for streaming; the first build happens behind the load.
  stats.maxBuildMs = 0;
  stats.maxUpdateMs = 0;

  return {
    group,
    stats,
    tileBounds: tiles.map((tile) => tile.bounds),
    update,
    plant(t, clearings) {
      const b = (tiles[t] as Tile).bounds;
      const size = b.maxX - b.minX;
      if (!worker) return Promise.resolve(plantTile(field, b.minX, b.minZ, size, clearings));
      const id = nextId++;
      return new Promise((resolve) => {
        planting.set(id, resolve);
        worker.postMessage({
          kind: 'plant',
          id,
          minX: b.minX,
          minZ: b.minZ,
          size,
          clearings,
        } satisfies TileWorkerRequest);
      });
    },
    applyPreset(p) {
      const next = presetLod(p);
      if (next.stride === lod.stride && next.lodM === lod.lodM && next.streamM === lod.streamM) {
        return;
      }
      lod = next;
      generation++;
      done.length = 0;
      // Strides change meaning with the preset, so start the cache over.
      tiles.forEach((_, t) => show(t, 0, undefined));
      for (const geometry of cache.values()) geometry.dispose();
      cache.clear();
    },
    resetStats() {
      stats.maxBuildMs = 0;
      stats.maxUpdateMs = 0;
    },
    dispose() {
      worker?.terminate();
      for (const geometry of cache.values()) geometry.dispose();
      cache.clear();
      back.mesh.geometry.dispose();
      material.dispose();
    },
  };
}
