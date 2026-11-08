import * as THREE from 'three';

/**
 * Shot in the air (Phase 6 piece A): a small dark ball for every round in flight, drawn
 * where the combat core has it. Piece B adds the muzzle smoke, splashes and splinters.
 */

/** Balls drawn at once; a T2's two broadsides and the cutter's gun fit easily. */
const CAPACITY = 64;

export interface ShotPoint {
  pos: { x: number; y: number; z: number };
}

export interface ShotView {
  readonly mesh: THREE.InstancedMesh;
  /** Where the balls are; none until combat is attached. */
  source: (() => readonly ShotPoint[]) | undefined;
  update(): void;
}

export function createShotView(): ShotView {
  const geometry = new THREE.SphereGeometry(0.35, 8, 6);
  const material = new THREE.MeshBasicMaterial({ color: 0x1a1a1a });
  const mesh = new THREE.InstancedMesh(geometry, material, CAPACITY);
  mesh.frustumCulled = false;
  mesh.count = 0;
  const m = new THREE.Matrix4();
  const view: ShotView = {
    mesh,
    source: undefined,
    update() {
      const shots = view.source?.() ?? [];
      const n = Math.min(CAPACITY, shots.length);
      for (let i = 0; i < n; i++) {
        const p = (shots[i] as ShotPoint).pos;
        m.makeTranslation(p.x, p.y, p.z);
        mesh.setMatrixAt(i, m);
      }
      mesh.count = n;
      mesh.instanceMatrix.needsUpdate = true;
    },
  };
  return view;
}
