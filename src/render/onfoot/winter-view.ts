import * as THREE from 'three';

/**
 * Winter on foot, drawn plainly (Phase 9 piece M): the hand sled and her load, your prints
 * in the snow, the evergreen boughs marking the ice road, and the warming fires at its ends.
 * The ice sheet and the snow themselves are piece L's.
 */
export interface WinterFrame {
  sled: { x: number; y: number; z: number; heading: number; cu: number } | undefined;
  /** Five floats a print: x, y, z, heading, sled (1 for runners). Zone meters. */
  prints: readonly number[];
  markers: readonly { x: number; y: number; z: number }[];
  fires: readonly { x: number; y: number; z: number }[];
}

const MAX_PRINTS = 400;
const MAX_MARKERS = 64;
const MAX_FIRES = 4;

export interface WinterView {
  readonly group: THREE.Group;
  update(frame: WinterFrame | undefined, time: number): void;
  dispose(): void;
}

export function createWinterView(): WinterView {
  const group = new THREE.Group();
  group.name = 'winter-foot';
  const disposables: { dispose(): void }[] = [];
  const keep = <T extends { dispose(): void }>(x: T): T => {
    disposables.push(x);
    return x;
  };

  // The sled: two runners, a deck and crates for her load.
  const wood = keep(new THREE.MeshLambertMaterial({ color: 0x7a5636 }));
  const crate = keep(new THREE.MeshLambertMaterial({ color: 0xa47b4b }));
  const sled = new THREE.Group();
  sled.name = 'sled';
  const runnerGeo = keep(new THREE.BoxGeometry(0.06, 0.12, 1.9));
  for (const x of [-0.32, 0.32]) {
    const r = new THREE.Mesh(runnerGeo, wood);
    r.position.set(x, 0.06, 0);
    sled.add(r);
  }
  const deck = new THREE.Mesh(keep(new THREE.BoxGeometry(0.78, 0.06, 1.6)), wood);
  deck.position.set(0, 0.2, 0.05);
  sled.add(deck);
  const crateGeo = keep(new THREE.BoxGeometry(0.6, 0.42, 0.45));
  const crates: THREE.Mesh[] = [];
  for (let k = 0; k < 3; k++) {
    const m = new THREE.Mesh(crateGeo, crate);
    m.position.set(0, 0.44, -0.5 + k * 0.5);
    sled.add(m);
    crates.push(m);
  }
  group.add(sled);

  // Prints: small dark ovals laid flat; runner marks a little longer.
  const printGeo = keep(new THREE.CircleGeometry(0.11, 8));
  printGeo.rotateX(-Math.PI / 2);
  printGeo.scale(1, 1, 2.1);
  const printMat = keep(
    new THREE.MeshBasicMaterial({
      color: 0x8796a8,
      transparent: true,
      opacity: 0.55,
      depthWrite: false,
    }),
  );
  const prints = new THREE.InstancedMesh(printGeo, printMat, MAX_PRINTS);
  prints.name = 'tracks';
  prints.frustumCulled = false;
  group.add(prints);

  // Boughs: a small spruce stuck in the ice.
  const bough = keep(new THREE.ConeGeometry(0.35, 1.4, 6));
  bough.translate(0, 0.7, 0);
  const boughMat = keep(new THREE.MeshLambertMaterial({ color: 0x24452c }));
  const markers = new THREE.InstancedMesh(bough, boughMat, MAX_MARKERS);
  markers.name = 'road-markers';
  markers.frustumCulled = false;
  group.add(markers);

  // Fires: a barrel with a flame over it.
  const barrel = keep(new THREE.CylinderGeometry(0.3, 0.3, 0.8, 10));
  barrel.translate(0, 0.4, 0);
  const barrelMat = keep(new THREE.MeshLambertMaterial({ color: 0x3b3430 }));
  const flame = keep(new THREE.ConeGeometry(0.22, 0.6, 7));
  flame.translate(0, 1.1, 0);
  const flameMat = keep(new THREE.MeshBasicMaterial({ color: 0xffa040 }));
  const fireMeshes: THREE.Group[] = [];
  for (let k = 0; k < MAX_FIRES; k++) {
    const g = new THREE.Group();
    g.add(new THREE.Mesh(barrel, barrelMat));
    const f = new THREE.Mesh(flame, flameMat);
    f.name = 'flame';
    g.add(f);
    g.visible = false;
    group.add(g);
    fireMeshes.push(g);
  }

  const m4 = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const up = new THREE.Vector3(0, 1, 0);
  const pos = new THREE.Vector3();
  const one = new THREE.Vector3(1, 1, 1);
  const runner = new THREE.Vector3(0.6, 1, 1.6);

  return {
    group,
    update(frame, time) {
      group.visible = !!frame;
      if (!frame) return;
      const s = frame.sled;
      sled.visible = !!s;
      if (s) {
        sled.position.set(s.x, s.y + 0.02, s.z);
        sled.rotation.set(0, -s.heading, 0);
        crates.forEach((c, k) => (c.visible = k < s.cu));
      }
      const n = Math.min(MAX_PRINTS, Math.floor(frame.prints.length / 5));
      for (let i = 0; i < n; i++) {
        const o = i * 5;
        pos.set(frame.prints[o] ?? 0, (frame.prints[o + 1] ?? 0) + 0.03, frame.prints[o + 2] ?? 0);
        q.setFromAxisAngle(up, -(frame.prints[o + 3] ?? 0));
        m4.compose(pos, q, frame.prints[o + 4] ? runner : one);
        prints.setMatrixAt(i, m4);
      }
      prints.count = n;
      prints.instanceMatrix.needsUpdate = true;
      const nm = Math.min(MAX_MARKERS, frame.markers.length);
      for (let i = 0; i < nm; i++) {
        const m = frame.markers[i];
        if (!m) continue;
        pos.set(m.x, m.y, m.z);
        m4.compose(pos, q.identity(), one);
        markers.setMatrixAt(i, m4);
      }
      markers.count = nm;
      markers.instanceMatrix.needsUpdate = true;
      fireMeshes.forEach((g, k) => {
        const f = frame.fires[k];
        g.visible = !!f;
        if (!f) return;
        g.position.set(f.x, f.y, f.z);
        const flick = g.getObjectByName('flame');
        if (flick) flick.scale.y = 0.85 + 0.25 * Math.sin(time * 9 + k);
      });
    },
    dispose() {
      prints.dispose();
      markers.dispose();
      for (const d of disposables) d.dispose();
    },
  };
}
