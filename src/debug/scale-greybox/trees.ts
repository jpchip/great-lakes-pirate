import * as THREE from 'three';
import type { Heightfield } from '../../gameplay/onfoot/heightfield';
import { mulberry } from './setpieces';

/**
 * 1:1 conifers around the camera (spike S7): the most familiar scale cue on a shore.
 * Trees are planted in fixed 200 m zone tiles with a seeded jitter, so the same tile
 * always grows the same trees; only tiles within RADIUS of the camera are drawn.
 */

const TILE = 200;
const RADIUS = 1400;
const SPACING = 11;
const MAX_TREES = 45_000;

export interface TreeField {
  readonly mesh: THREE.InstancedMesh;
  /** Replant if the camera moved to another tile or the heightfield changed. */
  update(cameraX: number, cameraZ: number, hf: Heightfield): void;
}

export function createTreeField(): TreeField {
  const geo = new THREE.ConeGeometry(2.6, 13, 6);
  geo.translate(0, 6.5 + 1.5, 0);
  const trunk = new THREE.CylinderGeometry(0.35, 0.45, 2.5, 5);
  trunk.translate(0, 1.25, 0);
  const merged = mergeTwo(geo, trunk);
  const mesh = new THREE.InstancedMesh(
    merged,
    new THREE.MeshStandardMaterial({ color: 0x2f4a32, roughness: 0.95, flatShading: true }),
    MAX_TREES,
  );
  mesh.frustumCulled = false;
  mesh.count = 0;

  let lastKey = '';
  let lastHf: Heightfield | undefined;
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const up = new THREE.Vector3(0, 1, 0);
  const v = new THREE.Vector3();
  const s = new THREE.Vector3();

  return {
    mesh,
    update(cx, cz, hf) {
      const ti = Math.floor(cx / TILE);
      const tj = Math.floor(cz / TILE);
      const key = `${ti},${tj}`;
      if (key === lastKey && hf === lastHf) return;
      lastKey = key;
      lastHf = hf;
      const reach = Math.ceil(RADIUS / TILE);
      const perSide = Math.floor(TILE / SPACING);
      let n = 0;
      for (let dj = -reach; dj <= reach && n < MAX_TREES; dj++) {
        for (let di = -reach; di <= reach && n < MAX_TREES; di++) {
          if (Math.hypot(di, dj) * TILE > RADIUS + TILE) continue;
          const i = ti + di;
          const j = tj + dj;
          const rng = mulberry((i * 73856093) ^ (j * 19349663));
          for (let b = 0; b < perSide && n < MAX_TREES; b++) {
            for (let a = 0; a < perSide && n < MAX_TREES; a++) {
              const x = i * TILE + (a + rng()) * SPACING;
              const z = j * TILE + (b + rng()) * SPACING;
              const keep = rng();
              const h = hf.heightAt(x, z);
              // Beaches and cliffs stay bare; thin out toward the shore.
              if (h < 2.5 || keep > Math.min((h - 2.5) / 6, 0.8)) continue;
              if (hf.slopeAt(x, z, 6) > 0.75) continue;
              const k = 0.7 + rng() * 0.7;
              q.setFromAxisAngle(up, rng() * 6.28);
              m.compose(v.set(x, h - 0.3, z), q, s.set(k, k * (0.9 + rng() * 0.4), k));
              mesh.setMatrixAt(n++, m);
            }
          }
        }
      }
      mesh.count = n;
      mesh.instanceMatrix.needsUpdate = true;
    },
  };
}

function mergeTwo(a: THREE.BufferGeometry, b: THREE.BufferGeometry): THREE.BufferGeometry {
  const pa = a.toNonIndexed().getAttribute('position');
  const pb = b.toNonIndexed().getAttribute('position');
  const positions = new Float32Array(pa.count * 3 + pb.count * 3);
  positions.set(pa.array as Float32Array, 0);
  positions.set(pb.array as Float32Array, pa.count * 3);
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  out.computeVertexNormals();
  return out;
}
