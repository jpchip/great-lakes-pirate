import { buildTileArrays, gridField, type GridMeshOptions, type HeightGrid } from './tile-mesh';
import type { GridField } from '../../sim/terrain/grid-field';
import { plantTile, type Clearing } from '../../sim/terrain/vegetation';

/**
 * Terrain tile worker (plan 03 §8.3): builds tile meshes and plants tile vegetation off
 * the main thread, so streaming never stalls a frame. The main thread sends the zone's
 * height grid once, then asks for tiles; the arrays come back transferred, not copied.
 */

export type TileWorkerRequest =
  | { kind: 'grid'; grid: HeightGrid }
  | { kind: 'build'; id: number; options: GridMeshOptions }
  | {
      kind: 'plant';
      id: number;
      minX: number;
      minZ: number;
      size: number;
      clearings: readonly Clearing[];
    };

export type TileWorkerResponse =
  | {
      kind: 'build';
      id: number;
      positions: Float32Array;
      normals: Float32Array;
      forest: Float32Array;
      indices: Uint32Array;
      minY: number;
      maxY: number;
      buildMs: number;
    }
  | { kind: 'plant'; id: number; trees: Float32Array; rocks: Float32Array; buildMs: number };

// The DOM and WebWorker libs can't share one tsconfig, so type just what's used.
const scope = self as unknown as {
  onmessage: ((e: MessageEvent<TileWorkerRequest>) => void) | null;
  postMessage(message: TileWorkerResponse, transfer?: Transferable[]): void;
};

let field: GridField | undefined;

scope.onmessage = (e) => {
  const msg = e.data;
  if (msg.kind === 'grid') {
    field = gridField(msg.grid);
    return;
  }
  if (!field) return;
  const t0 = performance.now();
  if (msg.kind === 'plant') {
    const p = plantTile(field, msg.minX, msg.minZ, msg.size, msg.clearings);
    scope.postMessage({ kind: 'plant', id: msg.id, ...p, buildMs: performance.now() - t0 }, [
      p.trees.buffer,
      p.rocks.buffer,
    ]);
    return;
  }
  const a = buildTileArrays(field, msg.options);
  scope.postMessage({ kind: 'build', id: msg.id, ...a, buildMs: performance.now() - t0 }, [
    a.positions.buffer,
    a.normals.buffer,
    a.forest.buffer,
    a.indices.buffer,
  ]);
};
