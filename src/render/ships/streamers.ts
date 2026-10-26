import * as THREE from 'three';

/**
 * The masthead pennant and the wool telltales on the shrouds (plan 02 §9): ribbons that
 * stream along the apparent wind and flutter faster as it rises, sagging when it drops.
 * All of them are one small mesh (one draw call), rewritten on the CPU each frame; a few
 * dozen vertices, so it costs nothing against a vertex shader. Tagged `noOutline`.
 */

export interface StreamerSpec {
  /** Where it's made fast, in the ship's frame. */
  anchor: THREE.Vector3;
  length: number;
  /** Width at the anchor. */
  width: number;
  /** 1 tapers to a point (a pennant), 0 keeps the width (a ribbon). */
  taper: number;
}

const SEGMENTS = 10;

export class Streamers {
  readonly mesh: THREE.Mesh;
  private readonly positions: Float32Array;

  constructor(
    color: THREE.Color,
    private readonly specs: readonly StreamerSpec[],
  ) {
    const count = specs.length * (SEGMENTS + 1) * 2;
    this.positions = new Float32Array(count * 3);
    const colors = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) colors.set([color.r, color.g, color.b], i * 3);
    const index: number[] = [];
    specs.forEach((_, k) => {
      const base = k * (SEGMENTS + 1) * 2;
      for (let s = 0; s < SEGMENTS; s++) {
        const a = base + s * 2;
        index.push(a, a + 2, a + 3, a, a + 3, a + 1);
      }
    });
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(this.positions, 3));
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geometry.setIndex(index);
    this.mesh = new THREE.Mesh(
      geometry,
      new THREE.MeshStandardMaterial({
        vertexColors: true,
        roughness: 0.9,
        side: THREE.DoubleSide,
      }),
    );
    this.mesh.name = 'streamers';
    this.mesh.userData['noOutline'] = true;
    this.mesh.frustumCulled = false;
  }

  /** `flow` is the apparent wind in the ship's frame, knots; `time` in seconds. */
  update(flow: { x: number; z: number }, time: number): void {
    const speed = Math.hypot(flow.x, flow.z);
    const dx = speed > 1e-3 ? flow.x / speed : 0;
    const dz = speed > 1e-3 ? flow.z / speed : 1;
    // Light air lets them hang; from about 8 knots they stand straight out.
    const stand = Math.min(speed / 8, 1);
    const omega = 6 + 0.5 * Math.min(speed, 30);
    const amplitude = 0.08 + 0.12 * Math.min(speed / 15, 1);
    // The cloth's width runs up and down when it streams, across when it hangs.
    const wy = stand;
    const wx = -dz * (1 - stand);
    const wz = dx * (1 - stand);
    const wl = Math.hypot(wx, wy, wz) || 1;
    let i = 0;
    this.specs.forEach((spec, k) => {
      const phase = k * 1.7;
      for (let s = 0; s <= SEGMENTS; s++) {
        const f = s / SEGMENTS;
        const along = f * spec.length;
        // Out along the wind, down by gravity, and a wave running toward the free end.
        const wave = Math.sin(omega * time - 9 * f + phase) * amplitude * f * spec.length;
        const lift = Math.cos(omega * 1.3 * time - 7 * f + phase) * 0.4 * amplitude * f;
        const out = along * (0.15 + 0.85 * stand);
        const down = along * (1 - stand) * 0.9 + 0.12 * spec.length * f * f * (1 - stand * 0.7);
        const x = spec.anchor.x + dx * out - dz * wave;
        const y = spec.anchor.y - down + lift * spec.length;
        const z = spec.anchor.z + dz * out + dx * wave;
        const half = (spec.width * (1 - spec.taper * f)) / 2 / wl;
        this.positions.set(
          [
            x + wx * half,
            y + wy * half,
            z + wz * half,
            x - wx * half,
            y - wy * half,
            z - wz * half,
          ],
          i,
        );
        i += 6;
      }
    });
    const geometry = this.mesh.geometry;
    geometry.getAttribute('position').needsUpdate = true;
    geometry.computeVertexNormals();
  }
}
