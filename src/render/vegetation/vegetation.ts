import * as THREE from 'three';
import {
  countAtDensity,
  PLANT_STRIDE,
  PlantKind,
  type Clearing,
  type TilePlants,
} from '../../sim/terrain/vegetation';
import type { QualityPreset } from '../quality';
import { createStylizedMaterial, type StyleLighting } from '../style/stylized-material';
import type { TerrainView } from '../terrain/terrain-mesh';
import {
  bakeImpostors,
  createImpostorGeometry,
  createImpostorMaterial,
  type ImpostorAtlas,
  type ImpostorUniforms,
} from './impostors';
import { createBirch, createPine, createRock, type PlantModel } from './plant-models';

/**
 * The zone's trees and rocks (plan 03 §8.3, plan 14 §5; Phase 2 piece C), planted per
 * sailing tile in the terrain worker from the vegetation density map:
 *
 * - **Near:** instanced pine, birch and rock meshes within the preset's mesh distance, one
 *   draw call per kind, refilled from the tiles' plantings as the camera moves.
 * - **Far:** one instanced draw of camera-facing impostors per tile out to the preset's
 *   far distance, culled with the tile's box; the tile's planting array is the instance
 *   buffer as it is. Rocks have no impostor; they're too small to see that far.
 *
 * Meshes and impostors dither across a band at the hand-over, so each pixel is drawn by
 * exactly one of them, and the impostors dither out at the far end over the terrain
 * shader's canopy color. Presets set the density (a prefix of each rank-sorted planting)
 * and both distances.
 */

/** Plantings are asked for this far beyond the impostors' reach, so they're ready in time. */
const PREFETCH_M = 600;
/** Plantings out at the worker at once. */
const MAX_IN_FLIGHT = 2;
/** The near meshes are refilled when the camera has moved half this far. */
const REFILL_MARGIN_M = 48;
/** Rocks fade out by this share of the mesh distance (they have no impostors). */
const ROCK_REACH = 0.8;
/** Tallest a planted tree can be: the pine's height times the largest scale. */
const TALLEST_M = 13.8 * 1.25;

/** Where the LODs hand over for a preset: meshes fade out as impostors fade in, then out. */
export function vegetationFades(preset: QualityPreset): {
  meshStart: number;
  meshEnd: number;
  farStart: number;
  farEnd: number;
} {
  return {
    meshStart: preset.vegetationMeshM * 0.75,
    meshEnd: preset.vegetationMeshM,
    farStart: preset.vegetationFarM * 0.75,
    farEnd: preset.vegetationFarM,
  };
}

export interface VegetationStats {
  /** Tiles planted so far. */
  planted: number;
  /** Tiles with impostors in reach (before frustum culling) and their impostors. */
  impostorTiles: number;
  impostors: number;
  /** Instances in the near meshes. */
  pines: number;
  birches: number;
  rocks: number;
  /** The most draw calls vegetation can add this frame, before frustum culling. */
  drawCalls: number;
  /** Main-thread time of the last near-mesh refill, ms. */
  lastFillMs: number;
}

export interface VegetationView {
  readonly group: THREE.Group;
  readonly stats: VegetationStats;
  applyPreset(preset: QualityPreset): void;
  /** Call once a frame with the camera position. */
  update(x: number, y: number, z: number): void;
  dispose(): void;
}

/** The three models, baked to impostors with `renderer`. */
export function createPlantModels(renderer: THREE.WebGLRenderer): {
  pine: PlantModel;
  birch: PlantModel;
  rock: PlantModel;
  atlas: ImpostorAtlas;
} {
  const pine = createPine();
  const birch = createBirch();
  const rock = createRock();
  // Atlas cells follow PlantKind: pine, then birch.
  return { pine, birch, rock, atlas: bakeImpostors(renderer, [pine, birch]) };
}

/** An instanced mesh of one kind that grows when a fill needs more room. */
class NearLayer {
  mesh: THREE.InstancedMesh;

  constructor(
    private readonly group: THREE.Group,
    private readonly geometry: THREE.BufferGeometry,
    private readonly material: THREE.Material,
    private readonly name: string,
  ) {
    this.mesh = this.make(1024);
  }

  private make(capacity: number): THREE.InstancedMesh {
    const mesh = new THREE.InstancedMesh(this.geometry, this.material, capacity);
    mesh.name = this.name;
    mesh.count = 0;
    // The instances ring the camera, so the whole set is nearly always in view.
    mesh.frustumCulled = false;
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.setColorAt(0, new THREE.Color(1, 1, 1));
    this.group.add(mesh);
    return mesh;
  }

  /** Room for `n` instances, keeping nothing (the caller refills them all). */
  reserve(n: number): void {
    if (n <= this.mesh.instanceMatrix.count) return;
    this.group.remove(this.mesh);
    this.mesh.dispose();
    this.mesh = this.make(2 ** Math.ceil(Math.log2(n)));
  }
}

interface TileState {
  requested: boolean;
  plants: TilePlants | undefined;
  impostors: THREE.Mesh | undefined;
}

export function createVegetationView(
  terrain: TerrainView,
  models: ReturnType<typeof createPlantModels>,
  lighting: StyleLighting,
  preset: QualityPreset,
  clearings: readonly Clearing[] = [],
): VegetationView {
  const group = new THREE.Group();
  group.name = 'vegetation';

  const fades: Pick<ImpostorUniforms, 'uNearStart' | 'uNearEnd' | 'uFarStart' | 'uFarEnd'> = {
    uNearStart: { value: 0 },
    uNearEnd: { value: 0 },
    uFarStart: { value: 0 },
    uFarEnd: { value: 0 },
  };
  const rockFade = { start: { value: 0 }, end: { value: 0 } };
  const impostorMaterial = createImpostorMaterial(models.atlas, lighting, fades);
  const meshMaterial = createStylizedMaterial('toon', lighting, {
    vertexColors: true,
    fade: { start: fades.uNearStart, end: fades.uNearEnd },
  });
  const rockMaterial = createStylizedMaterial('toon', lighting, {
    vertexColors: true,
    fade: rockFade,
  });
  const pines = new NearLayer(group, models.pine.geometry, meshMaterial, 'pines');
  const birches = new NearLayer(group, models.birch.geometry, meshMaterial, 'birches');
  const rocks = new NearLayer(group, models.rock.geometry, rockMaterial, 'rocks');

  const tiles: TileState[] = terrain.tileBounds.map(() => ({
    requested: false,
    plants: undefined,
    impostors: undefined,
  }));
  const stats: VegetationStats = {
    planted: 0,
    impostorTiles: 0,
    impostors: 0,
    pines: 0,
    birches: 0,
    rocks: 0,
    drawCalls: 0,
    lastFillMs: 0,
  };

  let density = preset.vegetationDensity;
  let far = preset.vegetationFarM;
  let meshEnd = preset.vegetationMeshM;
  let inFlight = 0;
  let disposed = false;
  // Where the near meshes were last filled from; NaN forces a refill.
  let fillX = Number.NaN;
  let fillZ = Number.NaN;

  const applyFades = (p: QualityPreset): void => {
    const f = vegetationFades(p);
    fades.uNearStart.value = f.meshStart;
    fades.uNearEnd.value = f.meshEnd;
    fades.uFarStart.value = f.farStart;
    fades.uFarEnd.value = f.farEnd;
    rockFade.start.value = f.meshStart * ROCK_REACH;
    rockFade.end.value = f.meshEnd * ROCK_REACH;
  };
  applyFades(preset);

  const distance2d = (t: number, x: number, z: number): number => {
    const b = terrain.tileBounds[t] as (typeof terrain.tileBounds)[number];
    return Math.hypot(Math.max(b.minX - x, 0, x - b.maxX), Math.max(b.minZ - z, 0, z - b.maxZ));
  };

  const addImpostors = (t: number, plants: TilePlants): void => {
    const n = plants.trees.length / PLANT_STRIDE;
    if (n === 0) return;
    const b = terrain.tileBounds[t] as (typeof terrain.tileBounds)[number];
    let minY = Number.POSITIVE_INFINITY;
    let maxY = Number.NEGATIVE_INFINITY;
    for (let k = 0; k < n; k++) {
      const y = plants.trees[k * PLANT_STRIDE + 1] ?? 0;
      minY = Math.min(minY, y);
      maxY = Math.max(maxY, y);
    }
    const box = new THREE.Box3(
      new THREE.Vector3(b.minX, minY - 1, b.minZ),
      new THREE.Vector3(b.maxX, maxY + TALLEST_M, b.maxZ),
    );
    const geometry = createImpostorGeometry(plants.trees, box);
    geometry.instanceCount = countAtDensity(plants.trees, density);
    const mesh = new THREE.Mesh(geometry, impostorMaterial);
    mesh.name = `impostors-${t}`;
    group.add(mesh);
    (tiles[t] as TileState).impostors = mesh;
  };

  const request = (t: number): void => {
    const tile = tiles[t] as TileState;
    tile.requested = true;
    inFlight++;
    void terrain.plant(t, clearings).then((plants) => {
      inFlight--;
      if (disposed) return;
      tile.plants = plants;
      stats.planted++;
      addImpostors(t, plants);
      // A tile inside the near ring changes what the meshes should hold.
      fillX = Number.NaN;
    });
  };

  const layers = [pines, birches, rocks];

  /** Calls `visit` with every drawn plant near (x, z): its list and offset. */
  const forEachNear = (
    x: number,
    z: number,
    visit: (list: Float32Array, o: number, kind: number) => void,
  ): void => {
    const reach = meshEnd + REFILL_MARGIN_M;
    const limits = [reach * reach, (meshEnd * ROCK_REACH + REFILL_MARGIN_M) ** 2];
    tiles.forEach((tile, t) => {
      if (!tile.plants || distance2d(t, x, z) > reach) return;
      [tile.plants.trees, tile.plants.rocks].forEach((list, l) => {
        const limit2 = limits[l] ?? 0;
        const n = countAtDensity(list, density);
        for (let k = 0; k < n; k++) {
          const o = k * PLANT_STRIDE;
          const dx = (list[o] ?? 0) - x;
          const dz = (list[o + 2] ?? 0) - z;
          if (dx * dx + dz * dz <= limit2) visit(list, o, list[o + 5] ?? 0);
        }
      });
    });
  };

  const fill = (x: number, z: number): void => {
    const start = performance.now();
    const counts = [0, 0, 0];
    forEachNear(x, z, (_, __, kind) => (counts[kind] = (counts[kind] ?? 0) + 1));
    layers.forEach((layer, kind) => layer.reserve(counts[kind] ?? 0));
    counts.fill(0);
    forEachNear(x, z, (list, o, kind) => {
      const layer = layers[kind] as NearLayer;
      const i = counts[kind] ?? 0;
      counts[kind] = i + 1;
      // Yaw about y, uniform scale, standing 0.3 m into the ground (column-major).
      const s = list[o + 3] ?? 1;
      const yaw = list[o + 4] ?? 0;
      const c = Math.cos(yaw) * s;
      const sn = Math.sin(yaw) * s;
      const y = (list[o + 1] ?? 0) - 0.3;
      const m = layer.mesh.instanceMatrix.array as Float32Array;
      m.set([c, 0, -sn, 0, 0, s, 0, 0, sn, 0, c, 0, list[o] ?? 0, y, list[o + 2] ?? 0, 1], i * 16);
      const tint = 0.85 + 0.3 * (list[o + 6] ?? 0);
      (layer.mesh.instanceColor?.array as Float32Array | undefined)?.set([tint, tint, tint], i * 3);
    });
    layers.forEach((layer, kind) => {
      layer.mesh.count = counts[kind] ?? 0;
      layer.mesh.instanceMatrix.needsUpdate = true;
      if (layer.mesh.instanceColor) layer.mesh.instanceColor.needsUpdate = true;
    });
    stats.pines = counts[PlantKind.Pine] ?? 0;
    stats.birches = counts[PlantKind.Birch] ?? 0;
    stats.rocks = counts[PlantKind.Rock] ?? 0;
    fillX = x;
    fillZ = z;
    stats.lastFillMs = performance.now() - start;
  };

  const update = (x: number, _y: number, z: number): void => {
    const wanted: number[] = [];
    let impostorTiles = 0;
    let impostors = 0;
    tiles.forEach((tile, t) => {
      const d = distance2d(t, x, z);
      if (!tile.requested && d < far + PREFETCH_M) wanted.push(t);
      const mesh = tile.impostors;
      if (!mesh) return;
      mesh.visible = d < far;
      if (mesh.visible) {
        impostorTiles++;
        impostors += (mesh.geometry as THREE.InstancedBufferGeometry).instanceCount;
      }
    });
    wanted.sort((a, b) => distance2d(a, x, z) - distance2d(b, x, z));
    for (const t of wanted) {
      if (inFlight >= MAX_IN_FLIGHT) break;
      request(t);
    }
    if (!(Math.hypot(x - fillX, z - fillZ) < REFILL_MARGIN_M / 2)) fill(x, z);
    stats.impostorTiles = impostorTiles;
    stats.impostors = impostors;
    stats.drawCalls = impostorTiles + layers.filter((layer) => layer.mesh.count > 0).length;
  };

  return {
    group,
    stats,
    update,
    applyPreset(p) {
      density = p.vegetationDensity;
      far = p.vegetationFarM;
      meshEnd = p.vegetationMeshM;
      applyFades(p);
      for (const tile of tiles) {
        if (tile.impostors && tile.plants) {
          (tile.impostors.geometry as THREE.InstancedBufferGeometry).instanceCount = countAtDensity(
            tile.plants.trees,
            density,
          );
        }
      }
      fillX = Number.NaN;
    },
    dispose() {
      disposed = true;
      for (const tile of tiles) tile.impostors?.geometry.dispose();
      for (const layer of layers) layer.mesh.dispose();
      impostorMaterial.dispose();
      meshMaterial.dispose();
      rockMaterial.dispose();
      models.atlas.dispose();
    },
  };
}
