import * as THREE from 'three';
import type { Chart, Zone } from '../../core/coords';
import type { Heightfield } from '../../gameplay/onfoot/heightfield';
import { landHeight, PLACES, type Place } from './geography';

/**
 * 1:1 scale references for spike S7: town set pieces (houses and a pier, plus Ashland's
 * ore dock) and lighthouses. Their anchors follow the compressed geography; the
 * buildings themselves never shrink (plan 03 §3.4). Three instanced meshes in all.
 */

const MAX_HOUSES = 800;
const MAX_TOWERS = 16;

/** The dry-land chart point nearest `anchor` (searched outward in 25 m rings). */
export function snapToShore(anchor: Chart, minH = 0.8, maxH = 12, radius = 2000): Chart {
  if (landHeight(anchor.x, anchor.y) >= minH && landHeight(anchor.x, anchor.y) <= maxH) {
    return anchor;
  }
  for (let r = 25; r <= radius; r += 25) {
    const steps = Math.max(8, Math.round((2 * Math.PI * r) / 25));
    for (let k = 0; k < steps; k++) {
      const a = (k / steps) * Math.PI * 2;
      const x = anchor.x + Math.cos(a) * r;
      const y = anchor.y + Math.sin(a) * r;
      const h = landHeight(x, y);
      if (h >= minH && h <= maxH) return { x, y };
    }
  }
  return anchor;
}

/** Unit direction (zone x/z) from `p` toward the nearest deep water. */
export function seaward(hf: Heightfield, p: Zone): Zone {
  let best = { x: 0, z: -1 };
  let bestD = Infinity;
  for (let k = 0; k < 32; k++) {
    const a = (k / 32) * Math.PI * 2;
    const dx = Math.sin(a);
    const dz = -Math.cos(a);
    for (let d = 5; d < Math.min(bestD, 1500); d += 5) {
      if (hf.heightAt(p.x + dx * d, p.z + dz * d) < -2) {
        bestD = d;
        best = { x: dx, z: dz };
        break;
      }
    }
  }
  return best;
}

export interface SetPieces {
  readonly group: THREE.Group;
  /** Re-lay every set piece on the heightfield for compression `c`. */
  layout(c: number, hf: Heightfield): void;
  /** Where each place ended up in zone meters (for the HUD and teleports). */
  readonly positions: Map<string, Zone>;
}

export function createSetPieces(): SetPieces {
  const group = new THREE.Group();
  group.name = 'set-pieces';
  const unitBox = new THREE.BoxGeometry(1, 1, 1);
  unitBox.translate(0, 0.5, 0);
  const houses = new THREE.InstancedMesh(
    unitBox,
    new THREE.MeshStandardMaterial({ roughness: 0.85, flatShading: true }),
    MAX_HOUSES,
  );
  const towerGeo = new THREE.CylinderGeometry(0.62, 1, 1, 10);
  towerGeo.translate(0, 0.5, 0);
  const towers = new THREE.InstancedMesh(
    towerGeo,
    new THREE.MeshStandardMaterial({ color: 0xf2efe6, roughness: 0.7, flatShading: true }),
    MAX_TOWERS,
  );
  const lanterns = new THREE.InstancedMesh(
    unitBox,
    new THREE.MeshStandardMaterial({ color: 0x8a2b20, roughness: 0.6, emissive: 0x3a0d08 }),
    MAX_TOWERS,
  );
  for (const m of [houses, towers, lanterns]) {
    m.frustumCulled = false;
    group.add(m);
  }

  // Shore points are fixed in chart space, so find them once.
  const shores = new Map<string, Chart>(
    PLACES.map((p) => [
      p.id,
      p.kind === 'town' ? snapToShore(p.chart) : snapToShore(p.chart, 1.5, 60),
    ]),
  );
  const positions = new Map<string, Zone>();

  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const up = new THREE.Vector3(0, 1, 0);
  const color = new THREE.Color();
  const v = new THREE.Vector3();
  const s = new THREE.Vector3();

  let houseCount = 0;
  const addBox = (
    x: number,
    z: number,
    y0: number,
    w: number,
    h: number,
    d: number,
    yaw: number,
    hex: number,
  ): void => {
    if (houseCount >= MAX_HOUSES) return;
    q.setFromAxisAngle(up, yaw);
    m.compose(v.set(x, y0, z), q, s.set(w, h, d));
    houses.setMatrixAt(houseCount, m);
    houses.setColorAt(houseCount, color.set(hex));
    houseCount++;
  };

  const layoutTown = (p: Place, at: Zone, hf: Heightfield): void => {
    const out = seaward(hf, at);
    // three.js yaw for a long axis pointing along `out`.
    const yaw = Math.atan2(-out.x, -out.z);
    // Walk out to the waterline, then build the pier from there.
    let sx = at.x;
    let sz = at.z;
    for (let d = 0; d < 300 && hf.heightAt(sx, sz) > 0.3; d += 2) {
      sx += out.x * 2;
      sz += out.z * 2;
    }
    const pier = p.pierM ?? 60;
    const width = p.oreDock ? 18 : 5;
    const top = p.oreDock ? 24 : 2.2;
    addBox(
      sx + (out.x * pier) / 2,
      sz + (out.z * pier) / 2,
      -2,
      width,
      top + 2,
      pier + 4,
      yaw,
      p.oreDock ? 0x5e4a3a : 0x7a5a3a,
    );

    const rng = mulberry(p.id.length * 7919 + Math.round(at.x));
    const { along, rows } = p.houses ?? { along: 2, rows: 1 };
    const ax = -out.z;
    const az = out.x;
    for (let r = 0; r < rows; r++) {
      for (let a = -along; a <= along; a++) {
        const inland = 22 + r * 18 + rng() * 4;
        const x = at.x - out.x * inland + ax * (a * 16 + rng() * 4);
        const z = at.z - out.z * inland + az * (a * 16 + rng() * 4);
        const h = hf.heightAt(x, z);
        if (h < 0.6 || hf.slopeAt(x, z, 8) > 0.5) continue;
        const shade = [0xd9d2c0, 0xc9b79c, 0xb04a3a, 0x8e9aa3][Math.floor(rng() * 4)] as number;
        addBox(x, z, h - 1.5, 7 + rng() * 4, 6 + rng() * 4 + 1.5, 9 + rng() * 4, yaw, shade);
      }
    }
  };

  return {
    group,
    positions,
    layout(c, hf) {
      houseCount = 0;
      let towerCount = 0;
      for (const p of PLACES) {
        const shore = shores.get(p.id) as Chart;
        const at = { x: shore.x / c, z: -shore.y / c };
        positions.set(p.id, at);
        if (p.kind === 'town') {
          layoutTown(p, at, hf);
          continue;
        }
        const ground = hf.heightAt(at.x, at.z);
        const height = p.towerM ?? 15;
        m.compose(v.set(at.x, ground - 0.5, at.z), q.identity(), s.set(2.6, height + 0.5, 2.6));
        towers.setMatrixAt(towerCount, m);
        m.compose(v.set(at.x, ground + height, at.z), q.identity(), s.set(3.2, 3.4, 3.2));
        lanterns.setMatrixAt(towerCount, m);
        towerCount++;
        // The keeper's house beside the tower.
        addBox(at.x + 8, at.z + 4, hf.heightAt(at.x + 8, at.z + 4) - 1, 9, 8, 8, 0, 0xc9b79c);
      }
      houses.count = houseCount;
      towers.count = towerCount;
      lanterns.count = towerCount;
      houses.instanceMatrix.needsUpdate = true;
      if (houses.instanceColor) houses.instanceColor.needsUpdate = true;
      towers.instanceMatrix.needsUpdate = true;
      lanterns.instanceMatrix.needsUpdate = true;
    },
  };
}

/** Tiny seeded PRNG for layout jitter (render-only, so it needn't be core/rng). */
export function mulberry(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
