import * as THREE from 'three';

/**
 * A vertex-colored triangle soup for code-built meshes. Non-indexed, so the style pass
 * can crease its normals (style/outline.ts `creaseNormals`).
 */
export class TriangleSoup {
  private readonly positions: number[] = [];
  private readonly colors: number[] = [];

  get triangles(): number {
    return this.positions.length / 9;
  }

  tri(a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3, color: THREE.Color): void {
    this.positions.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z);
    for (let i = 0; i < 3; i++) this.colors.push(color.r, color.g, color.b);
  }

  /** a-b-c-d counter-clockwise seen from the front face. */
  quad(
    a: THREE.Vector3,
    b: THREE.Vector3,
    c: THREE.Vector3,
    d: THREE.Vector3,
    color: THREE.Color,
  ): void {
    this.tri(a, b, c, color);
    this.tri(a, c, d, color);
  }

  /** A tapered spar from `from` to `to`, `sides`-sided, capped at both ends. */
  spar(
    from: THREE.Vector3,
    to: THREE.Vector3,
    radius: number,
    color: THREE.Color,
    topRadius = radius * 0.7,
    sides = 6,
  ): void {
    const axis = new THREE.Vector3().subVectors(to, from).normalize();
    const side = Math.abs(axis.y) > 0.9 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0);
    const u = new THREE.Vector3().crossVectors(axis, side).normalize();
    const v = new THREE.Vector3().crossVectors(axis, u).normalize();
    const ring = (center: THREE.Vector3, r: number): THREE.Vector3[] =>
      Array.from({ length: sides }, (_, i) => {
        const angle = (i / sides) * Math.PI * 2;
        return center
          .clone()
          .addScaledVector(u, Math.cos(angle) * r)
          .addScaledVector(v, Math.sin(angle) * r);
      });
    const bottom = ring(from, radius);
    const top = ring(to, topRadius);
    for (let i = 0; i < sides; i++) {
      const j = (i + 1) % sides;
      const b0 = bottom[i] as THREE.Vector3;
      const b1 = bottom[j] as THREE.Vector3;
      const t0 = top[i] as THREE.Vector3;
      const t1 = top[j] as THREE.Vector3;
      this.quad(b0, b1, t1, t0, color);
      this.tri(to, t0, t1, color);
      this.tri(from, b1, b0, color);
    }
  }

  /** An axis-aligned box from `min` to `max`, without its bottom face. */
  box(min: THREE.Vector3, max: THREE.Vector3, color: THREE.Color, topColor = color): void {
    const p = (x: number, y: number, z: number): THREE.Vector3 =>
      new THREE.Vector3(x ? max.x : min.x, y ? max.y : min.y, z ? max.z : min.z);
    this.quad(p(0, 1, 0), p(0, 1, 1), p(1, 1, 1), p(1, 1, 0), topColor);
    this.quad(p(0, 0, 1), p(1, 0, 1), p(1, 1, 1), p(0, 1, 1), color); // +z
    this.quad(p(1, 0, 0), p(0, 0, 0), p(0, 1, 0), p(1, 1, 0), color); // -z
    this.quad(p(1, 0, 1), p(1, 0, 0), p(1, 1, 0), p(1, 1, 1), color); // +x
    this.quad(p(0, 0, 0), p(0, 0, 1), p(0, 1, 1), p(0, 1, 0), color); // -x
  }

  build(): THREE.BufferGeometry {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(this.positions, 3));
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(this.colors, 3));
    geometry.computeVertexNormals();
    return geometry;
  }
}
