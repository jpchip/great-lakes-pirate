import * as THREE from 'three';

/**
 * The pure parts of the character pipeline (plan 14 §7, plan 08 §20 piece B):
 * skinned geometry moved between skins of the same rig, region classification by texture
 * color, the jacket shell, region splitting, LOD simplification hooks and the animation
 * retarget. build-characters.ts does the I/O.
 */

/** One skinned piece of a body in the body's bind space. */
export interface SkinnedGeo {
  pos: Float32Array;
  nrm: Float32Array;
  /** Empty when the piece has no texture to classify by. */
  uv: Float32Array;
  /** Four joints per vertex, indices into the body's canonical joint list. */
  joints: Uint16Array;
  weights: Float32Array;
  index: Uint32Array;
  /** Per vertex: region index and shade (1 = the region's color as is). */
  look?: Float32Array;
}

export function vertexCount(geo: SkinnedGeo): number {
  return geo.pos.length / 3;
}

export function triangleCount(geo: SkinnedGeo): number {
  return geo.index.length / 3;
}

/**
 * Move vertices bound to a source skin onto the target skin of the same rig: each joint's
 * bind matrix is swapped, so a part modelled on a slightly different body follows the
 * target's bones. Joints are matched by name; a joint missing from the target is an error.
 */
export function rebind(
  geo: SkinnedGeo,
  sourceJoints: readonly string[],
  sourceInverseBind: readonly THREE.Matrix4[],
  targetJoints: readonly string[],
  targetInverseBind: readonly THREE.Matrix4[],
): SkinnedGeo {
  const map = sourceJoints.map((name) => {
    const i = targetJoints.indexOf(name);
    if (i < 0) throw new Error(`joint ${name} missing from the target skin`);
    return i;
  });
  // Per source joint: target bind × source inverse bind.
  const swap = sourceJoints.map((_, s) => {
    const t = map[s] ?? 0;
    const targetInverse = targetInverseBind[t];
    const sourceInverse = sourceInverseBind[s];
    if (!targetInverse || !sourceInverse) throw new Error('missing bind matrix');
    return new THREE.Matrix4().copy(targetInverse).invert().multiply(sourceInverse);
  });
  const n = vertexCount(geo);
  const pos = new Float32Array(geo.pos.length);
  const nrm = new Float32Array(geo.nrm.length);
  const joints = new Uint16Array(geo.joints.length);
  const v = new THREE.Vector3();
  const nv = new THREE.Vector3();
  const accP = new THREE.Vector3();
  const accN = new THREE.Vector3();
  const normalMatrix = new THREE.Matrix3();
  for (let i = 0; i < n; i++) {
    accP.set(0, 0, 0);
    accN.set(0, 0, 0);
    for (let k = 0; k < 4; k++) {
      const w = geo.weights[i * 4 + k] ?? 0;
      const s = geo.joints[i * 4 + k] ?? 0;
      joints[i * 4 + k] = map[s] ?? 0;
      if (w === 0) continue;
      const m = swap[s];
      if (!m) continue;
      v.fromArray(geo.pos, i * 3).applyMatrix4(m);
      accP.addScaledVector(v, w);
      nv.fromArray(geo.nrm, i * 3).applyMatrix3(normalMatrix.getNormalMatrix(m));
      accN.addScaledVector(nv, w);
    }
    accP.toArray(pos, i * 3);
    accN.normalize().toArray(nrm, i * 3);
  }
  return { ...geo, pos, nrm, joints };
}

/** Keep only the triangles `keep` says yes to, and drop vertices no triangle uses. */
export function filterTriangles(
  geo: SkinnedGeo,
  keep: (a: number, b: number, c: number) => boolean,
): SkinnedGeo {
  const kept: number[] = [];
  for (let t = 0; t < geo.index.length; t += 3) {
    const a = geo.index[t] ?? 0;
    const b = geo.index[t + 1] ?? 0;
    const c = geo.index[t + 2] ?? 0;
    if (keep(a, b, c)) kept.push(a, b, c);
  }
  return compact(geo, Uint32Array.from(kept));
}

/** Rebuild vertex arrays so only vertices `index` uses remain, in first-use order. */
export function compact(geo: SkinnedGeo, index: Uint32Array): SkinnedGeo {
  const remap = new Map<number, number>();
  const order: number[] = [];
  const out = new Uint32Array(index.length);
  for (let i = 0; i < index.length; i++) {
    const old = index[i] ?? 0;
    let next = remap.get(old);
    if (next === undefined) {
      next = order.length;
      remap.set(old, next);
      order.push(old);
    }
    out[i] = next;
  }
  return pick(geo, order, out);
}

function pick(geo: SkinnedGeo, order: readonly number[], index: Uint32Array): SkinnedGeo {
  const take = (src: Float32Array | Uint16Array, size: number) => {
    const dst = new (src.constructor as Float32ArrayConstructor)(order.length * size);
    order.forEach((old, i) => {
      for (let k = 0; k < size; k++) dst[i * size + k] = src[old * size + k] ?? 0;
    });
    return dst;
  };
  const out: SkinnedGeo = {
    pos: take(geo.pos, 3),
    nrm: take(geo.nrm, 3),
    uv: geo.uv.length ? take(geo.uv, 2) : new Float32Array(0),
    joints: take(geo.joints, 4) as unknown as Uint16Array,
    weights: take(geo.weights, 4),
    index,
  };
  if (geo.look) out.look = take(geo.look, 2);
  return out;
}

/** Sum of the weights a vertex gives the named joints. */
export function weightOn(
  geo: SkinnedGeo,
  vertex: number,
  jointIndices: ReadonlySet<number>,
): number {
  let sum = 0;
  for (let k = 0; k < 4; k++) {
    if (jointIndices.has(geo.joints[vertex * 4 + k] ?? -1)) sum += geo.weights[vertex * 4 + k] ?? 0;
  }
  return sum;
}

/** An image as raw RGB bytes. */
export interface RgbImage {
  width: number;
  height: number;
  data: Uint8Array;
}

/** Nearest texel at a glTF UV (origin top left, wrapping). */
export function sampleRgb(image: RgbImage, u: number, v: number): [number, number, number] {
  const fu = u - Math.floor(u);
  const fv = v - Math.floor(v);
  const x = Math.min(image.width - 1, Math.floor(fu * image.width));
  const y = Math.min(image.height - 1, Math.floor(fv * image.height));
  const o = (y * image.width + x) * 3;
  return [image.data[o] ?? 0, image.data[o + 1] ?? 0, image.data[o + 2] ?? 0];
}

/** Rec. 709 luma of an sRGB byte triple, 0–1 (good enough to rank cloth tones). */
export function luma([r, g, b]: readonly number[]): number {
  return (0.2126 * (r ?? 0) + 0.7152 * (g ?? 0) + 0.0722 * (b ?? 0)) / 255;
}

/** Texture luma per triangle: the mean of its centroid and its three corners. */
export function triangleLuma(geo: SkinnedGeo, image: RgbImage): Float32Array {
  const out = new Float32Array(geo.index.length / 3);
  for (let t = 0; t < out.length; t++) {
    let sum = 0;
    let cu = 0;
    let cv = 0;
    for (let k = 0; k < 3; k++) {
      const i = geo.index[t * 3 + k] ?? 0;
      const u = geo.uv[i * 2] ?? 0;
      const v = geo.uv[i * 2 + 1] ?? 0;
      cu += u / 3;
      cv += v / 3;
      sum += luma(sampleRgb(image, u, v));
    }
    sum += luma(sampleRgb(image, cu, cv));
    out[t] = sum / 4;
  }
  return out;
}

/**
 * 1-D k-means over luma, centers returned dark to light, with each value's cluster.
 * Deterministic: centers start at evenly spaced quantiles.
 */
export function lumaClusters(
  values: Float32Array,
  k: number,
): { centers: number[]; cluster: Uint8Array } {
  const sorted = Float32Array.from(values).sort();
  let centers = Array.from(
    { length: k },
    (_, j) => sorted[Math.floor(((j + 0.5) / k) * sorted.length)] ?? 0,
  );
  const cluster = new Uint8Array(values.length);
  for (let iteration = 0; iteration < 30; iteration++) {
    for (let i = 0; i < values.length; i++) {
      let best = 0;
      for (let j = 1; j < k; j++) {
        if (
          Math.abs((values[i] ?? 0) - (centers[j] ?? 0)) <
          Math.abs((values[i] ?? 0) - (centers[best] ?? 0))
        )
          best = j;
      }
      cluster[i] = best;
    }
    const sums = new Array<number>(k).fill(0);
    const counts = new Array<number>(k).fill(0);
    values.forEach((value, i) => {
      const c = cluster[i] ?? 0;
      sums[c] = (sums[c] ?? 0) + value;
      counts[c] = (counts[c] ?? 0) + 1;
    });
    centers = centers.map((c, j) => ((counts[j] ?? 0) > 0 ? (sums[j] ?? 0) / (counts[j] ?? 1) : c));
  }
  // Re-rank dark to light.
  const order = centers.map((c, j) => [c, j] as const).sort((a, b) => a[0] - b[0]);
  const rank = new Uint8Array(k);
  order.forEach(([, j], r) => (rank[j] = r));
  for (let i = 0; i < cluster.length; i++) cluster[i] = rank[cluster[i] ?? 0] ?? 0;
  return { centers: order.map(([c]) => c), cluster };
}

/**
 * Give every triangle a region and a shade, splitting vertices where regions meet so each
 * region's edge stays crisp under the toon bands. Shade is the triangle's luma over its
 * cluster's, clamped, so folds and seams keep a little of the texture's painting.
 */
export function assignRegions(
  geo: SkinnedGeo,
  region: (triangle: number) => number,
  shade: (triangle: number) => number = () => 1,
): SkinnedGeo {
  const key = new Map<string, number>();
  const order: number[] = [];
  const looks: number[] = [];
  const shadeSum = new Map<number, number>();
  const shadeCount = new Map<number, number>();
  const index = new Uint32Array(geo.index.length);
  for (let t = 0; t < geo.index.length / 3; t++) {
    const r = region(t);
    const s = shade(t);
    for (let k = 0; k < 3; k++) {
      const old = geo.index[t * 3 + k] ?? 0;
      const id = `${old}:${r}`;
      let next = key.get(id);
      if (next === undefined) {
        next = order.length;
        key.set(id, next);
        order.push(old);
        looks.push(r, 0);
      }
      index[t * 3 + k] = next;
      shadeSum.set(next, (shadeSum.get(next) ?? 0) + s);
      shadeCount.set(next, (shadeCount.get(next) ?? 0) + 1);
    }
  }
  for (let i = 0; i < order.length; i++)
    looks[i * 2 + 1] = (shadeSum.get(i) ?? 1) / (shadeCount.get(i) ?? 1);
  const { look: _drop, ...plain } = geo;
  void _drop;
  const out = pick(plain, order, index);
  out.look = Float32Array.from(looks);
  return out;
}

/** One region and an even shade for every vertex. */
export function solidRegion(geo: SkinnedGeo, region: number, shade = 1): SkinnedGeo {
  const look = new Float32Array(vertexCount(geo) * 2);
  for (let i = 0; i < vertexCount(geo); i++) {
    look[i * 2] = region;
    look[i * 2 + 1] = shade;
  }
  return { ...geo, look };
}

/** Normals averaged over every vertex at the same position, so a shell has no cracks. */
export function weldedNormals(geo: SkinnedGeo, epsilon = 1e-4): Float32Array {
  const bucket = new Map<string, number[]>();
  const keyOf = (i: number) =>
    `${Math.round((geo.pos[i * 3] ?? 0) / epsilon)},${Math.round((geo.pos[i * 3 + 1] ?? 0) / epsilon)},${Math.round((geo.pos[i * 3 + 2] ?? 0) / epsilon)}`;
  const n = vertexCount(geo);
  for (let i = 0; i < n; i++) {
    const k = keyOf(i);
    const list = bucket.get(k);
    if (list) list.push(i);
    else bucket.set(k, [i]);
  }
  // Face normals summed per position (area-weighted).
  const face = new Float32Array(n * 3);
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const c = new THREE.Vector3();
  for (let t = 0; t < geo.index.length; t += 3) {
    const ia = geo.index[t] ?? 0;
    const ib = geo.index[t + 1] ?? 0;
    const ic = geo.index[t + 2] ?? 0;
    a.fromArray(geo.pos, ia * 3);
    b.fromArray(geo.pos, ib * 3).sub(a);
    c.fromArray(geo.pos, ic * 3).sub(a);
    const fn = b.cross(c);
    for (const i of [ia, ib, ic]) {
      face[i * 3] = (face[i * 3] ?? 0) + fn.x;
      face[i * 3 + 1] = (face[i * 3 + 1] ?? 0) + fn.y;
      face[i * 3 + 2] = (face[i * 3 + 2] ?? 0) + fn.z;
    }
  }
  const out = new Float32Array(n * 3);
  const sum = new THREE.Vector3();
  for (const list of bucket.values()) {
    sum.set(0, 0, 0);
    for (const i of list) {
      sum.x += face[i * 3] ?? 0;
      sum.y += face[i * 3 + 1] ?? 0;
      sum.z += face[i * 3 + 2] ?? 0;
    }
    sum.normalize();
    for (const i of list) sum.toArray(out, i * 3);
  }
  return out;
}

/** A copy pushed out along welded normals: the jacket over a shirt, the hat band. */
export function shell(geo: SkinnedGeo, offset: number): SkinnedGeo {
  const normals = weldedNormals(geo);
  const pos = Float32Array.from(geo.pos);
  for (let i = 0; i < pos.length; i++) pos[i] = (pos[i] ?? 0) + (normals[i] ?? 0) * offset;
  return { ...geo, pos, nrm: normals };
}

/** Concatenate pieces into one geometry (same attribute layout). */
export function merge(parts: readonly SkinnedGeo[]): SkinnedGeo {
  const total = (f: (g: SkinnedGeo) => number) => parts.reduce((s, g) => s + f(g), 0);
  const out: SkinnedGeo = {
    pos: new Float32Array(total((g) => g.pos.length)),
    nrm: new Float32Array(total((g) => g.nrm.length)),
    uv: new Float32Array(0),
    joints: new Uint16Array(total((g) => g.joints.length)),
    weights: new Float32Array(total((g) => g.weights.length)),
    index: new Uint32Array(total((g) => g.index.length)),
    look: new Float32Array(total((g) => vertexCount(g) * 2)),
  };
  let v = 0;
  let ix = 0;
  for (const g of parts) {
    out.pos.set(g.pos, v * 3);
    out.nrm.set(g.nrm, v * 3);
    out.joints.set(g.joints, v * 4);
    out.weights.set(g.weights, v * 4);
    out.look?.set(g.look ?? new Float32Array(vertexCount(g) * 2), v * 2);
    for (let i = 0; i < g.index.length; i++) out.index[ix + i] = (g.index[i] ?? 0) + v;
    v += vertexCount(g);
    ix += g.index.length;
  }
  return out;
}

/** Translate every vertex (hair modelled on the male head, fitted to the female one). */
export function translate(
  geo: SkinnedGeo,
  x: number,
  y: number,
  z: number,
  scale = 1,
  pivotY = 0,
): SkinnedGeo {
  const pos = Float32Array.from(geo.pos);
  for (let i = 0; i < pos.length; i += 3) {
    pos[i] = (pos[i] ?? 0) * scale + x;
    pos[i + 1] = ((pos[i + 1] ?? 0) - pivotY) * scale + pivotY + y;
    pos[i + 2] = (pos[i + 2] ?? 0) * scale + z;
  }
  return { ...geo, pos };
}

// ---------------------------------------------------------------------------------------
// Animation retarget

/** A joint of a rig at rest: local TRS and parent index (-1 for the top joint). */
export interface RestJoint {
  name: string;
  parent: number;
  translation: THREE.Vector3;
  rotation: THREE.Quaternion;
}

/** Rest-pose world rotations of a rig, given the rotation above its top joint. */
export function restWorldRotations(
  rig: readonly RestJoint[],
  above: THREE.Quaternion,
): THREE.Quaternion[] {
  const out: THREE.Quaternion[] = [];
  rig.forEach((joint, i) => {
    const parent = joint.parent >= 0 ? out[joint.parent] : above;
    if (!parent) throw new Error(`joint ${i} listed before its parent`);
    out.push(parent.clone().multiply(joint.rotation));
  });
  return out;
}

/**
 * Retarget one frame of local joint rotations from a source rig to a target rig with the
 * same joint names but different rest poses ("world delta"): each joint turns, in world
 * space, by the same amount away from its own rest pose as the source joint does. Both
 * rigs list parents before children. Joints the frame doesn't animate hold the source's
 * rest rotation (so they also hold the target's).
 */
export function retargetFrame(
  source: readonly RestJoint[],
  sourceRestWorld: readonly THREE.Quaternion[],
  target: readonly RestJoint[],
  targetRestWorld: readonly THREE.Quaternion[],
  above: THREE.Quaternion,
  frame: ReadonlyMap<string, THREE.Quaternion>,
): Map<string, THREE.Quaternion> {
  const sourceWorld: THREE.Quaternion[] = [];
  source.forEach((joint, i) => {
    const parent = joint.parent >= 0 ? sourceWorld[joint.parent] : above;
    const local = frame.get(joint.name) ?? joint.rotation;
    sourceWorld[i] = (parent ?? above).clone().multiply(local);
  });
  const byName = new Map(source.map((j, i) => [j.name, i]));
  const targetWorld: THREE.Quaternion[] = [];
  const out = new Map<string, THREE.Quaternion>();
  target.forEach((joint, i) => {
    const s = byName.get(joint.name);
    const parentWorld = joint.parent >= 0 ? targetWorld[joint.parent] : above;
    let world: THREE.Quaternion;
    if (s === undefined) {
      world = (parentWorld ?? above).clone().multiply(joint.rotation);
    } else {
      const sw = sourceWorld[s] ?? above;
      const sr = sourceRestWorld[s] ?? above;
      const tr = targetRestWorld[i] ?? above;
      world = sw.clone().multiply(sr.clone().invert()).multiply(tr);
    }
    targetWorld[i] = world;
    out.set(joint.name, (parentWorld ?? above).clone().invert().multiply(world).normalize());
  });
  return out;
}
