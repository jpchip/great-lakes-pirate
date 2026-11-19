import * as THREE from 'three';

/**
 * False lights burning at the wrecking marks (plan 06 §6.2, plan 11 §18.4 piece I): a
 * lantern on a tall pole stuck in the headland, its pane of colored glass throwing a warm
 * light to seaward, and a glare that carries across the water as a real light's would.
 * The game passes where each rig stands and the ground there; this only draws them.
 */

export interface FalseLightView {
  readonly group: THREE.Group;
  /** The rigs burning now, zone meters with the ground height there. */
  sync(rigs: readonly { id: string; x: number; z: number; groundM: number }[]): void;
  /** Flickers the flame (real seconds) and dims the glare by day (0 day … 1 night). */
  update(seconds: number, night01: number): void;
  dispose(): void;
}

const POLE_M = 5;
/** The kerosene flame through tinted glass: warmer and redder than a lighthouse lens. */
const FLAME = new THREE.Color(1, 0.62, 0.3);

/** A soft round glow, built without a canvas (as the lighthouses' glare). */
function glowTexture(): THREE.DataTexture {
  const size = 64;
  const data = new Uint8Array(size * size * 4);
  for (let j = 0; j < size; j++) {
    for (let i = 0; i < size; i++) {
      const r = Math.hypot((i + 0.5) / size - 0.5, (j + 0.5) / size - 0.5) * 2;
      const core = Math.max(0, 1 - r / 0.18);
      const halo = Math.max(0, 1 - r) ** 2.4 * 0.75;
      const k = (j * size + i) * 4;
      data[k] = data[k + 1] = data[k + 2] = 255;
      data[k + 3] = Math.round(Math.min(1, core + halo) * 255);
    }
  }
  const t = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  t.colorSpace = THREE.SRGBColorSpace;
  t.magFilter = THREE.LinearFilter;
  t.minFilter = THREE.LinearFilter;
  t.needsUpdate = true;
  return t;
}

export function createFalseLights(): FalseLightView {
  const group = new THREE.Group();
  group.name = 'false-lights';
  const texture = glowTexture();
  const poleGeo = new THREE.CylinderGeometry(0.07, 0.1, POLE_M, 6);
  poleGeo.translate(0, POLE_M / 2, 0);
  const poleMat = new THREE.MeshLambertMaterial({ color: 0x3b2a1c });
  const lampGeo = new THREE.BoxGeometry(0.34, 0.46, 0.34);
  const lampMat = new THREE.MeshBasicMaterial({ color: FLAME, toneMapped: false });
  const rigs = new Map<string, { root: THREE.Group; glare: THREE.Sprite; seed: number }>();

  const make = (id: string): { root: THREE.Group; glare: THREE.Sprite; seed: number } => {
    const root = new THREE.Group();
    root.name = `false-light-${id}`;
    const pole = new THREE.Mesh(poleGeo, poleMat);
    const lamp = new THREE.Mesh(lampGeo, lampMat);
    lamp.position.y = POLE_M + 0.1;
    const glare = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: texture,
        color: FLAME.clone(),
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        transparent: true,
        fog: false,
        toneMapped: false,
      }),
    );
    glare.position.y = POLE_M + 0.1;
    glare.renderOrder = 3;
    root.add(pole, lamp, glare);
    group.add(root);
    let seed = 0;
    for (const ch of id) seed = (seed * 31 + ch.charCodeAt(0)) % 997;
    return { root, glare, seed };
  };

  return {
    group,
    sync(list) {
      const keep = new Set(list.map((r) => r.id));
      for (const [id, r] of rigs) {
        if (keep.has(id)) continue;
        group.remove(r.root);
        r.glare.material.dispose();
        rigs.delete(id);
      }
      for (const r of list) {
        const v = rigs.get(r.id) ?? make(r.id);
        rigs.set(r.id, v);
        v.root.position.set(r.x, r.groundM, r.z);
      }
    },
    update(seconds, night01) {
      for (const r of rigs.values()) {
        // A kerosene flame breathes and gutters in the wind.
        const flicker =
          0.85 + 0.1 * Math.sin(seconds * 7.3 + r.seed) + 0.05 * Math.sin(seconds * 17.1 + r.seed);
        const k = (0.25 + 0.75 * night01) * flicker;
        r.glare.material.opacity = Math.min(1, k);
        r.glare.scale.setScalar(5 + 9 * night01 * flicker);
      }
    },
    dispose() {
      for (const r of rigs.values()) r.glare.material.dispose();
      rigs.clear();
      group.clear();
      texture.dispose();
      poleGeo.dispose();
      poleMat.dispose();
      lampGeo.dispose();
      lampMat.dispose();
    },
  };
}
