import * as THREE from 'three';
import { createStylizedMaterial, type StyleLighting } from '../style/stylized-material';

/**
 * Ice floes at the break-up (plan 04 §8.3; plan 11 §18.4 piece L): instanced low-poly
 * slabs near the camera, one draw call, riding the (ice-calmed) swell. Floes are laid on a
 * grid of cells around the camera, each cell's floe a pure function of its indices, so a
 * floe stays put as the camera moves: a cell holds one where its hash is under the floe
 * cover there. The water shader draws the far floes; `nearM` is where it hands over.
 */

const CELL_M = 11;

export interface Floes {
  readonly mesh: THREE.InstancedMesh;
  /** Floes drawn last update. */
  readonly drawn: number;
  /** Where the meshes end and the shader's floes begin, meters from the camera. */
  readonly nearM: number;
  setCapacity(n: number): void;
  /**
   * `cover(x, z)` the floe cover at a zone point (0 where there are none), `height(x, z)`
   * the water surface, `snow01` the snow lying on them.
   */
  update(
    camera: THREE.Vector3,
    cover: (x: number, z: number) => number,
    height: (x: number, z: number) => number,
    snow01: number,
  ): void;
  dispose(): void;
}

function hash(i: number, j: number, k: number): number {
  let h = Math.imul(i, 0x27d4eb2d) ^ Math.imul(j, 0x165667b1) ^ Math.imul(k, 0x9e3779b9);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** A rough nine-sided slab a meter across: a snowy top and blue-white sides. */
export function floeGeometry(): THREE.BufferGeometry {
  const sides = 9;
  const top = 0.14;
  const bottom = -0.3;
  const ring: [number, number][] = [];
  for (let k = 0; k < sides; k++) {
    const a = (k / sides) * Math.PI * 2;
    const r = 0.78 + 0.25 * hash(k, 3, 7);
    ring.push([Math.cos(a) * r, Math.sin(a) * r]);
  }
  const pos: number[] = [];
  const col: number[] = [];
  const topC = new THREE.Color(0xeef3f7);
  const sideC = new THREE.Color(0x9fc0d2);
  const push = (x: number, y: number, z: number, c: THREE.Color): void => {
    pos.push(x, y, z);
    col.push(c.r, c.g, c.b);
  };
  for (let k = 0; k < sides; k++) {
    const [ax, az] = ring[k] as [number, number];
    const [bx, bz] = ring[(k + 1) % sides] as [number, number];
    // Top, wound counter-clockwise seen from above.
    push(0, top + 0.03, 0, topC);
    push(bx, top, bz, topC);
    push(ax, top, az, topC);
    // Side.
    push(ax, top, az, sideC);
    push(bx, top, bz, sideC);
    push(bx * 0.9, bottom, bz * 0.9, sideC);
    push(ax, top, az, sideC);
    push(bx * 0.9, bottom, bz * 0.9, sideC);
    push(ax * 0.9, bottom, az * 0.9, sideC);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.computeVertexNormals();
  return g;
}

export function createFloes(lighting: StyleLighting, capacity: number): Floes {
  const geometry = floeGeometry();
  const material = createStylizedMaterial('flat', lighting, { vertexColors: true });
  const MAX = 512;
  const mesh = new THREE.InstancedMesh(geometry, material, MAX);
  mesh.name = 'ice-floes';
  mesh.count = 0;
  mesh.frustumCulled = false;
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  const color = new THREE.Color();
  mesh.setColorAt(0, color.setRGB(1, 1, 1));
  let cap = Math.min(capacity, MAX);
  let side = Math.ceil(Math.sqrt(cap));
  let drawn = 0;
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const e = new THREE.Euler();
  const p = new THREE.Vector3();
  const s = new THREE.Vector3();

  return {
    mesh,
    get drawn() {
      return drawn;
    },
    get nearM() {
      return cap > 0 ? (side * CELL_M) / 2 : 0;
    },
    setCapacity(n) {
      cap = Math.min(Math.max(0, n), MAX);
      side = Math.ceil(Math.sqrt(cap));
    },
    update(camera, cover, height, snow01) {
      drawn = 0;
      if (cap > 0) {
        const ci = Math.floor(camera.x / CELL_M) - Math.floor(side / 2);
        const cj = Math.floor(camera.z / CELL_M) - Math.floor(side / 2);
        for (let j = cj; j < cj + side && drawn < cap; j++) {
          for (let i = ci; i < ci + side && drawn < cap; i++) {
            const x = (i + 0.15 + 0.7 * hash(i, j, 1)) * CELL_M;
            const z = (j + 0.15 + 0.7 * hash(i, j, 2)) * CELL_M;
            const c = cover(x, z);
            if (c <= 0.01 || hash(i, j, 3) >= c) continue;
            const r = 1.2 + 4.2 * hash(i, j, 4) ** 1.6;
            const y = height(x, z);
            e.set((hash(i, j, 6) - 0.5) * 0.06, hash(i, j, 5) * Math.PI * 2, 0);
            q.setFromEuler(e);
            m.compose(p.set(x, y, z), q, s.set(r, r, r));
            mesh.setMatrixAt(drawn, m);
            const shade = 0.92 + 0.1 * hash(i, j, 7);
            color.setRGB(shade, shade, Math.min(1, shade * (1.04 - 0.04 * snow01)));
            mesh.setColorAt(drawn, color);
            drawn++;
          }
        }
      }
      mesh.count = drawn;
      mesh.visible = drawn > 0;
      if (drawn > 0) {
        mesh.instanceMatrix.needsUpdate = true;
        if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      }
    },
    dispose() {
      geometry.dispose();
      material.dispose();
    },
  };
}
