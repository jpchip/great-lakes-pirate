import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

/**
 * Building blocks for procedural props (the lighthouse kit, harbor buildings and piers):
 * non-indexed parts with positions, normals and a vertex color, merged into one mesh per
 * prop so a whole station or waterfront is a draw call. Sizes in meters, y up.
 */

/** A solid part: non-indexed, positions and normals only, painted one color. */
export function part(geometry: THREE.BufferGeometry, color: number): THREE.BufferGeometry {
  const g = geometry.index ? geometry.toNonIndexed() : geometry;
  g.deleteAttribute('uv');
  const count = g.getAttribute('position').count;
  const c = new THREE.Color(color);
  const colors = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) c.toArray(colors, i * 3);
  g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  return g;
}

/** Moves a part: position, then yaw about y. */
export function place(
  g: THREE.BufferGeometry,
  x: number,
  y: number,
  z: number,
  yaw = 0,
): THREE.BufferGeometry {
  if (yaw) g.rotateY(yaw);
  return g.translate(x, y, z);
}

export function box(
  w: number,
  h: number,
  d: number,
  x: number,
  y: number,
  z: number,
  color: number,
): THREE.BufferGeometry {
  // `y` is the bottom of the box.
  return place(part(new THREE.BoxGeometry(w, h, d), color), x, y + h / 2, z);
}

export function frustum(
  rTop: number,
  rBottom: number,
  h: number,
  sides: number,
  x: number,
  y: number,
  z: number,
  color: number,
): THREE.BufferGeometry {
  return place(
    part(new THREE.CylinderGeometry(rTop, rBottom, h, sides, 1), color),
    x,
    y + h / 2,
    z,
  );
}

/** A gable roof over a w × d footprint, ridge along x, its eave at `y`. */
export function gable(
  w: number,
  d: number,
  rise: number,
  x: number,
  y: number,
  z: number,
  color: number,
): THREE.BufferGeometry {
  const shape = new THREE.Shape([
    new THREE.Vector2(-d / 2 - 0.3, 0),
    new THREE.Vector2(d / 2 + 0.3, 0),
    new THREE.Vector2(0, rise),
  ]);
  const prism = new THREE.ExtrudeGeometry(shape, { depth: w + 0.6, bevelEnabled: false });
  prism.translate(0, 0, -(w + 0.6) / 2);
  prism.rotateY(Math.PI / 2);
  return place(part(prism, color), x, y, z);
}

/** A thin strut between two points. */
export function strut(
  a: THREE.Vector3,
  b: THREE.Vector3,
  r: number,
  color: number,
): THREE.BufferGeometry {
  const length = a.distanceTo(b);
  const g = new THREE.CylinderGeometry(r, r, length, 4, 1);
  g.rotateX(Math.PI / 2);
  const m = new THREE.Matrix4().lookAt(a, b, new THREE.Vector3(0, 1, 0));
  const q = new THREE.Quaternion().setFromRotationMatrix(m);
  g.applyQuaternion(q);
  const mid = a.clone().add(b).multiplyScalar(0.5);
  return part(g.translate(mid.x, mid.y, mid.z), color);
}

/** Merges parts into one geometry and frees them. */
export function merged(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const g = mergeGeometries(parts, false);
  if (!g) throw new Error('parts: could not merge');
  for (const p of parts) p.dispose();
  return g;
}
