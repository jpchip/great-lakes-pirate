import * as THREE from 'three';
import { BACK_INLAND, CREST_INLAND, type CoastRun } from '../../sim/arena/coast';

/**
 * The coast seen from an arena (plan 03 §6.3, Phase 3 piece G): one low, flat-shaded
 * mesh of shore silhouettes from the chart's coastline, a beach rising to a crest a
 * little inland and a long back slope behind it. Fog does the rest: at these distances
 * only the skyline reads. One draw call.
 *
 * Where the land is narrower than that profile (a spit, a point, a small island) the
 * profile shrinks to fit inside it, lower and shorter, so it never stands out over the
 * water on the far side as a wall the ship sails into.
 */

const LAND_COLOR = 0x46553f;

export function createCoastMesh(runs: readonly CoastRun[]): THREE.Mesh {
  const positions: number[] = [];
  const indices: number[] = [];
  for (const run of runs) {
    const base = positions.length / 3;
    for (const p of run.points) {
      const { heightM: h } = p;
      // 1 where the whole profile fits; less on narrow land, which gets a smaller hill.
      const fit = Math.min(1, p.inlandM / (h * BACK_INLAND));
      const crestH = h * Math.max(fit, 0.3);
      const crest = h * CREST_INLAND * fit;
      positions.push(p.x, -4, p.z);
      positions.push(p.x + p.nx * crest, crestH, p.z + p.nz * crest);
      positions.push(p.x + p.nx * p.inlandM, crestH * 0.6, p.z + p.nz * p.inlandM);
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
