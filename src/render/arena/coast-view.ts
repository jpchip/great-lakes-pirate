import * as THREE from 'three';
import type { CoastRun } from '../../sim/arena/coast';

/**
 * The coast seen from an arena (plan 03 §6.3, Phase 3 piece G): one low, flat-shaded
 * mesh of shore silhouettes from the chart's coastline, a beach rising to a crest a
 * little inland and a long back slope behind it. Fog does the rest: at these distances
 * only the skyline reads. One draw call.
 */

/** Crest this many crest-heights inland of the shore, and the back slope's foot further. */
const CREST_INLAND = 8;
const BACK_INLAND = 40;

const LAND_COLOR = 0x46553f;

export function createCoastMesh(runs: readonly CoastRun[]): THREE.Mesh {
  const positions: number[] = [];
  const indices: number[] = [];
  for (const run of runs) {
    const base = positions.length / 3;
    for (const p of run.points) {
      const h = p.heightM;
      positions.push(p.x, -4, p.z);
      positions.push(p.x + p.nx * h * CREST_INLAND, h, p.z + p.nz * h * CREST_INLAND);
      positions.push(p.x + p.nx * h * BACK_INLAND, h * 0.6, p.z + p.nz * h * BACK_INLAND);
    }
    for (let i = 0; i + 1 < run.points.length; i++) {
      const a = base + i * 3;
      const b = a + 3;
      for (let r = 0; r < 2; r++) {
        indices.push(a + r, b + r, a + r + 1, b + r, b + r + 1, a + r + 1);
      }
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  const mesh = new THREE.Mesh(
    geometry,
    // Double-sided: the strip is seen from the water and, past a headland, from behind.
    new THREE.MeshLambertMaterial({ color: LAND_COLOR, flatShading: true, side: THREE.DoubleSide }),
  );
  mesh.name = 'arena-coast';
  return mesh;
}

export function disposeCoastMesh(mesh: THREE.Mesh): void {
  mesh.geometry.dispose();
  (mesh.material as THREE.Material).dispose();
}
