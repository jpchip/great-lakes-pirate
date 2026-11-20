import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

/**
 * Wrecks lying on the bottom (plan 11 §6; Phase 9 piece U): a broken hull settled into the
 * sand, her ribs showing, a fallen mast across her, and for one of the run's wrecks her
 * mast still standing out of the water. Superior's water is clear: in a calm, by day, you
 * can see them from the deck. The game passes where each lies and how deep; this only draws.
 * Each wreck is two meshes, her hull and her timbers merged (Phase 9 piece R: twenty-four
 * apiece put a landing in sight of them over the island frame's draw calls).
 */

export interface WreckHullView {
  readonly group: THREE.Group;
  sync(
    wrecks: readonly { id: string; x: number; z: number; bottomY: number; mast: boolean }[],
  ): void;
  dispose(): void;
}

function headingOf(id: string): number {
  let h = 0;
  for (const ch of id) h = (h * 31 + ch.charCodeAt(0)) % 3607;
  return (h / 3607) * Math.PI * 2;
}

export function createWreckHulls(): WreckHullView {
  const group = new THREE.Group();
  group.name = 'wreck-hulls';
  const wood = new THREE.MeshLambertMaterial({ color: 0x3a2c20 });
  const dark = new THREE.MeshLambertMaterial({ color: 0x241a12 });
  const hullGeo = new THREE.BoxGeometry(6, 1.6, 26);
  const ribGeo = new THREE.BoxGeometry(0.35, 2.4, 0.35);
  const mastGeo = new THREE.CylinderGeometry(0.18, 0.26, 18, 6);
  const shown = new Map<string, THREE.Group>();

  /** A copy of `geo` moved and turned into place, for merging. */
  const placed = (
    geo: THREE.BufferGeometry,
    pos: [number, number, number],
    rot: [number, number, number],
  ): THREE.BufferGeometry => {
    const m = new THREE.Matrix4().compose(
      new THREE.Vector3(...pos),
      new THREE.Quaternion().setFromEuler(new THREE.Euler(...rot)),
      new THREE.Vector3(1, 1, 1),
    );
    return geo.clone().applyMatrix4(m);
  };
  const owned: THREE.BufferGeometry[] = [];

  const make = (id: string, mast: boolean): THREE.Group => {
    const root = new THREE.Group();
    root.name = `wreck-${id}`;
    const hull = new THREE.Mesh(placed(hullGeo, [0, 0.4, 0], [0, 0, 0.12]), dark);
    owned.push(hull.geometry);
    root.add(hull);
    const timbers: THREE.BufferGeometry[] = [];
    for (let i = -5; i <= 5; i++) {
      for (const side of [-1, 1]) {
        timbers.push(placed(ribGeo, [side * 3, 1.4, i * 2.2], [0, 0, side * -0.25]));
      }
    }
    timbers.push(
      mast
        ? placed(mastGeo, [0, 9, 0], [0, 0, 0.15])
        : // Fallen across her and over the side.
          placed(mastGeo, [2, 1.2, 2], [Math.PI / 2, 0, 0.6]),
    );
    const merged = mergeGeometries(timbers, false);
    for (const g of timbers) g.dispose();
    if (merged) {
      owned.push(merged);
      root.add(new THREE.Mesh(merged, wood));
    }
    root.rotation.y = headingOf(id);
    group.add(root);
    return root;
  };

  return {
    group,
    sync(list) {
      const keep = new Set(list.map((w) => w.id));
      for (const [id, g] of shown) {
        if (keep.has(id)) continue;
        group.remove(g);
        shown.delete(id);
      }
      for (const w of list) {
        const g = shown.get(w.id) ?? make(w.id, w.mast);
        shown.set(w.id, g);
        g.position.set(w.x, w.bottomY, w.z);
      }
    },
    dispose() {
      shown.clear();
      group.clear();
      for (const g of owned) g.dispose();
      wood.dispose();
      dark.dispose();
      hullGeo.dispose();
      ribGeo.dispose();
      mastGeo.dispose();
    },
  };
}
