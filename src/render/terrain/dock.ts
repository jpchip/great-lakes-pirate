import * as THREE from 'three';
import { dockBerths, dockPoint, type Dock } from '../../sim/terrain/test-bay';
import type { ZoneTerrain } from '../../sim/terrain/zone-terrain';

/** Pile spacing along the pier, and how far piles sink below the seabed. */
const PILE_SPACING_M = 6;
const PILE_EMBED_M = 1;

/**
 * A greybox pier (plan 02 §7, Phase 1 piece B): a plank deck on piles down to the real
 * seabed, with a bollard at each berth end. Replaced by the harbor set piece (plan 03 §3.4).
 */
export function createDockMesh(dock: Dock, terrain: ZoneTerrain): THREE.Group {
  const group = new THREE.Group();
  group.name = dock.id;
  const wood = new THREE.MeshLambertMaterial({ color: 0x6b5643 });
  const dark = new THREE.MeshLambertMaterial({ color: 0x3d3229 });
  const yaw = -dock.bearing; // headings are clockwise; three.js yaw is counter-clockwise

  const deckThickness = 0.4;
  const mid = dockPoint(dock, dock.lengthM / 2, 0);
  const deck = new THREE.Mesh(
    new THREE.BoxGeometry(dock.widthM, deckThickness, dock.lengthM),
    wood,
  );
  deck.position.set(mid.x, dock.deckM - deckThickness / 2, mid.z);
  deck.rotation.y = yaw;
  group.add(deck);

  // Piles and bollards are instanced: two draw calls however long the pier.
  const piles: THREE.Matrix4[] = [];
  const at = new THREE.Vector3();
  const size = new THREE.Vector3();
  const noTurn = new THREE.Quaternion();
  for (let along = PILE_SPACING_M / 2; along <= dock.lengthM; along += PILE_SPACING_M) {
    for (const side of [-1, 1]) {
      const p = dockPoint(dock, along, side * (dock.widthM / 2 - 0.2));
      const ground = terrain.heightAt(p.x, p.z);
      if (ground > dock.deckM - 0.5) continue; // still ashore
      const top = dock.deckM - deckThickness;
      const length = top - ground + PILE_EMBED_M;
      at.set(p.x, top - length / 2, p.z);
      piles.push(new THREE.Matrix4().compose(at, noTurn, size.set(1, length, 1)));
    }
  }
  group.add(instanced(new THREE.CylinderGeometry(0.22, 0.22, 1, 8), dark, piles));

  const bollards: THREE.Matrix4[] = [];
  for (const berth of dockBerths(dock)) {
    const side = berth.id.endsWith('north') ? -1 : 1;
    for (const end of [-1, 1]) {
      const along = dock.lengthM - berth.lengthM / 2 + (end * berth.lengthM) / 2.4;
      const p = dockPoint(dock, along, side * (dock.widthM / 2 - 0.45));
      at.set(p.x, dock.deckM + 0.35, p.z);
      bollards.push(new THREE.Matrix4().compose(at, noTurn, size.set(1, 1, 1)));
    }
  }
  group.add(instanced(new THREE.CylinderGeometry(0.25, 0.3, 0.7, 8), dark, bollards));
  return group;
}

function instanced(
  geometry: THREE.BufferGeometry,
  material: THREE.Material,
  matrices: THREE.Matrix4[],
): THREE.InstancedMesh {
  const mesh = new THREE.InstancedMesh(geometry, material, matrices.length);
  matrices.forEach((m, k) => mesh.setMatrixAt(k, m));
  mesh.computeBoundingSphere();
  return mesh;
}
