import * as THREE from 'three';

/**
 * Wrecks lying on the bottom (plan 11 §6; Phase 9 piece U): a broken hull settled into the
 * sand, her ribs showing, a fallen mast across her, and for one of the run's wrecks her
 * mast still standing out of the water. Superior's water is clear: in a calm, by day, you
 * can see them from the deck. The game passes where each lies and how deep; this only draws.
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

  const make = (id: string, mast: boolean): THREE.Group => {
    const root = new THREE.Group();
    root.name = `wreck-${id}`;
    const hull = new THREE.Mesh(hullGeo, dark);
    hull.position.y = 0.4;
    hull.rotation.z = 0.12;
    root.add(hull);
    for (let i = -5; i <= 5; i++) {
      for (const side of [-1, 1]) {
        const rib = new THREE.Mesh(ribGeo, wood);
        rib.position.set(side * 3, 1.4, i * 2.2);
        rib.rotation.z = side * -0.25;
        root.add(rib);
      }
    }
    const m = new THREE.Mesh(mastGeo, wood);
    if (mast) {
      m.position.y = 9;
      m.rotation.z = 0.15;
    } else {
      // Fallen across her and over the side.
      m.position.set(2, 1.2, 2);
      m.rotation.set(Math.PI / 2, 0, 0.6);
    }
    root.add(m);
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
      wood.dispose();
      dark.dispose();
      hullGeo.dispose();
      ribGeo.dispose();
      mastGeo.dispose();
    },
  };
}
