import * as THREE from 'three';
import { box, frustum, merged, part, place } from '../style/parts';

/**
 * The island's animals, drawn plainly (Phase 9 piece V; plan 14 §3's low-poly animals until
 * CC0 rigs arrive): a deer, a black bear and a timber wolf built from boxes and capsules in
 * the toon style, one mesh each, posed by state (a deer's head up when alert, a bear reared
 * on its hind legs to threaten, any of them on its side when dead). A carcass rides across
 * the captain's shoulders; deer sign lies on the ground as dark prints; a trap spot is a
 * blazed stake, and a set trap a dark ring of steel at its foot.
 */

export interface WildlifeFrameView {
  animals: readonly {
    id: string;
    species: string;
    state: string;
    x: number;
    y: number;
    z: number;
    heading: number;
    moving: number;
  }[];
  sign: readonly { x: number; y: number; z: number; heading: number }[];
  traps: readonly { x: number; y: number; z: number; set: boolean }[];
  carrying: boolean;
}

export interface WildlifeView {
  readonly group: THREE.Group;
  /** `captain` is where the carcass rides, zone meters. */
  update(
    frame: WildlifeFrameView | undefined,
    captain: { x: number; y: number; z: number; heading: number },
    time: number,
  ): void;
  dispose(): void;
}

const DEER_COAT = 0x8a6440;
const DEER_BELLY = 0xd9cbb0;
const BEAR_COAT = 0x1c1a19;
const BEAR_SNOUT = 0x6b5440;
const WOLF_COAT = 0x77756f;
const WOLF_PALE = 0xb8b3a6;
const HOOF = 0x2a2420;
const ANTLER = 0xcab79a;
const SIGN = 0x3b2c1f;
const STAKE = 0x8a6a45;
const RAG = 0xb33a2a;
const STEEL = 0x34363a;

const MAX_SIGN = 24;
const MAX_TRAPS = 32;

/** A capsule lying along z (the animal's length), its middle at (0, y, z). */
function barrel(r: number, len: number, y: number, z: number, color: number): THREE.BufferGeometry {
  const g = part(new THREE.CapsuleGeometry(r, len, 3, 8), color);
  g.rotateX(Math.PI / 2);
  return g.translate(0, y, z);
}

function legs(
  w: number,
  h: number,
  across: number,
  fore: number,
  hind: number,
  color: number,
  hoof = HOOF,
): THREE.BufferGeometry[] {
  const out: THREE.BufferGeometry[] = [];
  for (const x of [-across, across]) {
    for (const z of [fore, hind]) {
      out.push(box(w, h, w, x, 0.06, z, color));
      out.push(box(w * 1.05, 0.06, w * 1.1, x, 0, z, hoof));
    }
  }
  return out;
}

/** Facing -z, as every figure ashore does. */
function deerGeometry(): THREE.BufferGeometry {
  const p: THREE.BufferGeometry[] = [];
  p.push(barrel(0.24, 0.8, 0.86, 0, DEER_COAT));
  p.push(box(0.36, 0.08, 0.9, 0, 0.66, 0, DEER_BELLY));
  p.push(...legs(0.08, 0.66, 0.13, -0.42, 0.42, DEER_COAT));
  // Neck up and forward, the head at its top.
  const neck = part(new THREE.BoxGeometry(0.16, 0.5, 0.18), DEER_COAT);
  neck.rotateX(0.45);
  p.push(place(neck, 0, 1.12, -0.56));
  p.push(box(0.17, 0.18, 0.34, 0, 1.28, -0.78, DEER_COAT));
  p.push(box(0.1, 0.1, 0.1, 0, 1.28, -0.97, HOOF));
  for (const s of [-1, 1]) {
    const ear = part(new THREE.BoxGeometry(0.05, 0.16, 0.08), DEER_COAT);
    ear.rotateZ(s * 0.6);
    p.push(place(ear, s * 0.12, 1.5, -0.68));
    // A small rack: a buck's spikes.
    const tine = part(new THREE.CylinderGeometry(0.015, 0.025, 0.28, 4), ANTLER);
    tine.rotateZ(s * 0.35);
    p.push(place(tine, s * 0.08, 1.56, -0.72));
  }
  // The white flag of a tail.
  p.push(box(0.1, 0.16, 0.06, 0, 0.92, 0.56, DEER_BELLY));
  return merged(p);
}

function bearGeometry(): THREE.BufferGeometry {
  const p: THREE.BufferGeometry[] = [];
  p.push(barrel(0.38, 0.62, 0.66, 0.05, BEAR_COAT));
  // The hump over the shoulders.
  p.push(barrel(0.3, 0.2, 0.84, -0.22, BEAR_COAT));
  p.push(...legs(0.17, 0.44, 0.2, -0.36, 0.42, BEAR_COAT, BEAR_COAT));
  const head = part(new THREE.SphereGeometry(0.22, 10, 8), BEAR_COAT);
  p.push(place(head, 0, 0.78, -0.66));
  p.push(box(0.14, 0.13, 0.2, 0, 0.66, -0.88, BEAR_SNOUT));
  p.push(box(0.07, 0.06, 0.05, 0, 0.74, -0.98, HOOF));
  for (const s of [-1, 1]) p.push(frustum(0.04, 0.06, 0.08, 6, s * 0.15, 0.95, -0.6, BEAR_COAT));
  return merged(p);
}

function wolfGeometry(): THREE.BufferGeometry {
  const p: THREE.BufferGeometry[] = [];
  p.push(barrel(0.19, 0.62, 0.62, 0, WOLF_COAT));
  p.push(box(0.26, 0.08, 0.66, 0, 0.47, -0.02, WOLF_PALE));
  p.push(...legs(0.07, 0.5, 0.1, -0.32, 0.34, WOLF_COAT, WOLF_PALE));
  p.push(barrel(0.15, 0.08, 0.76, -0.42, WOLF_COAT));
  p.push(box(0.2, 0.18, 0.22, 0, 0.72, -0.58, WOLF_COAT));
  p.push(box(0.11, 0.1, 0.2, 0, 0.7, -0.76, WOLF_PALE));
  p.push(box(0.05, 0.05, 0.04, 0, 0.77, -0.87, HOOF));
  for (const s of [-1, 1]) {
    p.push(frustum(0, 0.045, 0.12, 4, s * 0.07, 0.9, -0.55, WOLF_COAT));
  }
  const tail = part(new THREE.CylinderGeometry(0.04, 0.07, 0.48, 6), WOLF_COAT);
  tail.rotateX(-0.9);
  p.push(place(tail, 0, 0.55, 0.52));
  return merged(p);
}

/** The animal's half-width: how high it lies off the ground on its side. */
const SIDE_Y: Record<string, number> = {
  'animal.deer': 0.22,
  'animal.bear': 0.36,
  'animal.wolf': 0.18,
};

export function createWildlifeView(material: THREE.Material): WildlifeView {
  const group = new THREE.Group();
  group.name = 'wildlife';
  const geos: Record<string, THREE.BufferGeometry> = {
    'animal.deer': deerGeometry(),
    'animal.bear': bearGeometry(),
    'animal.wolf': wolfGeometry(),
  };
  const meshes = new Map<string, THREE.Mesh>();
  const carcass = new THREE.Mesh(geos['animal.deer'], material);
  carcass.name = 'carcass';
  carcass.scale.setScalar(0.85);
  carcass.visible = false;
  group.add(carcass);

  const plain = new THREE.MeshLambertMaterial({ vertexColors: true });
  const signGeo = merged([
    place(part(new THREE.CircleGeometry(0.06, 6).rotateX(-Math.PI / 2), SIGN), -0.08, 0.03, 0),
    place(part(new THREE.CircleGeometry(0.06, 6).rotateX(-Math.PI / 2), SIGN), 0.08, 0.03, -0.35),
    place(part(new THREE.CircleGeometry(0.06, 6).rotateX(-Math.PI / 2), SIGN), -0.08, 0.03, -0.7),
    place(part(new THREE.SphereGeometry(0.035, 5, 4), SIGN), 0.2, 0.02, -0.15),
    place(part(new THREE.SphereGeometry(0.035, 5, 4), SIGN), 0.24, 0.02, -0.1),
  ]);
  const signs = new THREE.InstancedMesh(signGeo, plain, MAX_SIGN);
  signs.name = 'deer-sign';
  signs.count = 0;
  signs.frustumCulled = false;
  group.add(signs);
  const stakeGeo = merged([
    box(0.07, 1.1, 0.07, 0, 0, 0, STAKE),
    box(0.1, 0.16, 0.02, 0.04, 0.8, 0, RAG),
  ]);
  const stakes = new THREE.InstancedMesh(stakeGeo, plain, MAX_TRAPS);
  stakes.name = 'trap-stakes';
  stakes.count = 0;
  stakes.frustumCulled = false;
  group.add(stakes);
  const trapGeo = part(new THREE.TorusGeometry(0.18, 0.025, 4, 10).rotateX(-Math.PI / 2), STEEL);
  trapGeo.translate(0.35, 0.04, 0);
  const traps = new THREE.InstancedMesh(trapGeo, plain, MAX_TRAPS);
  traps.name = 'traps-set';
  traps.count = 0;
  traps.frustumCulled = false;
  group.add(traps);

  const m4 = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const e = new THREE.Euler(0, 0, 0, 'YXZ');
  const v = new THREE.Vector3();
  const one = new THREE.Vector3(1, 1, 1);

  return {
    group,
    update(frame, captain, time) {
      group.visible = !!frame;
      if (!frame) return;
      const seen = new Set<string>();
      for (const a of frame.animals) {
        const geo = geos[a.species];
        if (!geo) continue;
        seen.add(a.id);
        let m = meshes.get(a.id);
        if (!m) {
          m = new THREE.Mesh(geo, material);
          m.name = `animal:${a.id}`;
          m.rotation.order = 'YXZ';
          group.add(m);
          meshes.set(a.id, m);
        }
        m.visible = true;
        const dead = a.state === 'dead' || a.state === 'dressed';
        // A trot's bob, quicker as it runs.
        const bob = a.moving > 0.2 ? Math.abs(Math.sin(time * (4 + a.moving))) * 0.05 : 0;
        m.position.set(a.x, a.y + bob + (dead ? (SIDE_Y[a.species] ?? 0.2) - 0.05 : 0), a.z);
        // Reared up (a bear threatening), head up and still (alert), or on its side.
        const rear = a.state === 'threaten' && a.species === 'animal.bear' ? 1.05 : 0;
        m.rotation.set(rear, -a.heading, dead ? Math.PI / 2 : 0);
        if (rear) m.position.y += 0.25;
      }
      for (const [id, m] of meshes) if (!seen.has(id)) m.visible = false;

      carcass.visible = frame.carrying;
      if (frame.carrying) {
        // Across the shoulders, legs to one side.
        carcass.position.set(captain.x, captain.y + 1.05, captain.z);
        carcass.rotation.set(0, -captain.heading + Math.PI / 2, Math.PI / 2, 'YXZ');
      }

      let n = 0;
      for (const s of frame.sign) {
        if (n >= MAX_SIGN) break;
        e.set(0, -s.heading, 0);
        q.setFromEuler(e);
        m4.compose(v.set(s.x, s.y, s.z), q, one);
        signs.setMatrixAt(n++, m4);
      }
      signs.count = n;
      signs.instanceMatrix.needsUpdate = true;
      let k = 0;
      let set = 0;
      for (const t of frame.traps) {
        if (k >= MAX_TRAPS) break;
        e.set(0, 0, 0);
        q.setFromEuler(e);
        m4.compose(v.set(t.x, t.y, t.z), q, one);
        stakes.setMatrixAt(k++, m4);
        if (t.set) traps.setMatrixAt(set++, m4);
      }
      stakes.count = k;
      traps.count = set;
      stakes.instanceMatrix.needsUpdate = true;
      traps.instanceMatrix.needsUpdate = true;
    },
    dispose() {
      for (const g of Object.values(geos)) g.dispose();
      signGeo.dispose();
      stakeGeo.dispose();
      trapGeo.dispose();
      plain.dispose();
    },
  };
}
