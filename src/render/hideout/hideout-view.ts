import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { box } from '../style/parts';
import {
  createStylizedMaterial,
  type LampPoolUniforms,
  type StyleId,
  type StyleLighting,
  type StylizedMaterial,
} from '../style/stylized-material';
import {
  buildExtension,
  buildPiece,
  buildProxy,
  finish,
  pieceDef,
  resolveMaterial,
  type HideoutMaterial,
  type PieceDef,
} from './pieces';

/**
 * A hideout drawn (plan 09 §10; Phase 8 piece B). Up close, one `InstancedMesh` per piece
 * type and material, glass and all (the `glow` attribute), so a full hideout of 1,500
 * pieces is one draw call per kind in use: ≤ 80. Placing or removing a piece writes one
 * instance slot (swap-with-last on removal), never a rebuild. From the ship, a merged
 * low-poly proxy (each piece's bounding box in its average color, roofs as slabs, lit
 * glass still glowing) stands in as a single mesh; it's rebuilt a moment after the last
 * edit rather than on every one.
 *
 * Coordinates are the site's (piece A's layout): meters, y up. Lamps light the shader's
 * pools when the view is given the pool uniforms, as the docks district does.
 */

/** One placed piece, as the grid engine hands it over. */
export interface HideoutPieceInput {
  /** A `build.*` id from data/structures.json. Unknown ids draw as a placeholder crate. */
  id: string;
  material?: string;
  x: number;
  y: number;
  z: number;
  /** 90° steps: 0 faces -z, 1 faces +x (clockwise from above). */
  rot?: number;
  /** Props turn freely, in degrees, the same sense as rot; wins over rot. */
  yawDeg?: number;
  /** Roofs: how far above y this cell's eave sits (the ridge of a wide roof). */
  riseM?: number;
  /** A tint multiplied over the piece's colors (paint variants). */
  paint?: number;
  /** Foundations, pilings and piers: how far below their body they reach. */
  extendM?: number;
}

export interface HideoutViewOptions {
  style?: StyleId;
  pools?: LampPoolUniforms;
  /** The proxy takes over beyond this distance from the hideout's center, meters. */
  proxyBeyondM?: number;
  /** The proxy is rebuilt this long after the last edit, milliseconds. */
  proxyDebounceMs?: number;
  /**
   * Draws every piece in this material instead of the kit's (piece C's ghosts: a flat,
   * see-through tint, the piece's `paint` its color). No glow, pools or proxy then.
   */
  material?: THREE.Material;
}

export interface HideoutLamp {
  x: number;
  y: number;
  z: number;
  radiusM: number;
  color: number;
}

export interface HideoutView {
  readonly group: THREE.Group;
  /** The up-close instanced meshes. */
  readonly near: THREE.Group;
  /** The distant stand-in, once built. */
  readonly proxy: THREE.Mesh | undefined;
  readonly size: number;
  /** Instanced meshes holding at least one piece: the up-close draw calls in view. */
  readonly batches: number;
  /** Triangles drawn up close (every instance). */
  readonly triangles: number;
  readonly proxyTriangles: number;
  /** True when the proxy is drawn instead of the instanced pieces. */
  readonly far: boolean;
  /** Places a piece or moves it (one slot written). */
  set(key: string, piece: HideoutPieceInput): void;
  remove(key: string): boolean;
  has(key: string): boolean;
  /** Replaces everything: a site loaded, a layout undone wholesale. */
  setAll(pieces: Iterable<readonly [string, HideoutPieceInput]>): void;
  clear(): void;
  /** Rebuilds the proxy now (otherwise it waits for the edits to settle). */
  rebuildProxy(): void;
  readonly proxyDirty: boolean;
  lamps(): readonly HideoutLamp[];
  /**
   * Per frame: the camera picks near or far; `night` 0–1 lights the glass and pools.
   * `lightPools` false leaves the shared lamp pools alone (another view has them).
   */
  update(
    camera: THREE.Vector3,
    night: number,
    focus?: THREE.Vector3,
    nowMs?: number,
    lightPools?: boolean,
  ): void;
  dispose(): void;
}

const UNKNOWN: PieceDef = {
  id: 'unknown',
  name: 'Unknown piece',
  category: 'decor',
  placement: 'prop',
  footprint: [1, 1],
  materials: ['plank'],
  build: (s, out) => {
    out.body.push(box(1.6, 1.0, 1.6, 0, 0, 0, s.light));
    out.body.push(box(1.62, 0.1, 1.62, 0, 0.8, 0, s.dark));
  },
};

interface Batch {
  readonly key: string;
  readonly geometry: THREE.BufferGeometry;
  mesh: THREE.InstancedMesh;
  /** Slot → piece key. */
  readonly owners: string[];
  readonly trianglesEach: number;
}

interface Slot {
  batch: Batch;
  index: number;
}

interface Placed {
  piece: HideoutPieceInput;
  def: PieceDef;
  material: HideoutMaterial;
  main: Slot;
  ext: Slot[];
  matrix: THREE.Matrix4;
  extMatrices: THREE.Matrix4[];
}

const POOL_REACH = 1.25;
const POOL_GAIN = 1.05;
const WHITE = new THREE.Color(1, 1, 1);
const UP = new THREE.Vector3(0, 1, 0);

export function createHideoutView(
  lighting: StyleLighting,
  options: HideoutViewOptions = {},
): HideoutView {
  const group = new THREE.Group();
  group.name = 'hideout';
  const near = new THREE.Group();
  near.name = 'hideout:near';
  group.add(near);
  const material: StylizedMaterial | THREE.Material =
    options.material ??
    createStylizedMaterial(options.style ?? 'toon', lighting, {
      vertexColors: true,
      glow: true,
      ...(options.pools ? { pools: options.pools } : {}),
    });
  if (!options.material) material.name = 'hideout-kit';
  const proxyBeyond = options.material ? Infinity : (options.proxyBeyondM ?? 140);
  const debounce = options.proxyDebounceMs ?? 400;

  const batches = new Map<string, Batch>();
  const placed = new Map<string, Placed>();
  const proxies = new Map<string, THREE.BufferGeometry>();
  let proxy: THREE.Mesh | undefined;
  let proxyDirty = false;
  let lastEdit = 0;
  let far = false;
  let triangles = 0;
  const bounds = new THREE.Box3();
  let boundsDirty = false;

  const batchFor = (key: string, make: () => THREE.BufferGeometry): Batch => {
    let b = batches.get(key);
    if (b) return b;
    const geometry = make();
    const mesh = newMesh(geometry, 16, key);
    b = {
      key,
      geometry,
      mesh,
      owners: [],
      trianglesEach: geometry.getAttribute('position').count / 3,
    };
    batches.set(key, b);
    near.add(mesh);
    return b;
  };

  function newMesh(geometry: THREE.BufferGeometry, capacity: number, name: string) {
    const mesh = new THREE.InstancedMesh(geometry, material, capacity);
    mesh.name = name;
    mesh.count = 0;
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.setColorAt(0, WHITE);
    if (mesh.instanceColor) mesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
    mesh.matrixAutoUpdate = false;
    return mesh;
  }

  const grow = (b: Batch): void => {
    const old = b.mesh;
    const next = newMesh(b.geometry, old.instanceMatrix.count * 2, b.key);
    (next.instanceMatrix.array as Float32Array).set(old.instanceMatrix.array as Float32Array);
    if (old.instanceColor && next.instanceColor)
      (next.instanceColor.array as Float32Array).set(old.instanceColor.array as Float32Array);
    next.count = old.count;
    near.remove(old);
    near.add(next);
    old.dispose();
    b.mesh = next;
  };

  const tint = new THREE.Color();
  const write = (b: Batch, index: number, m: THREE.Matrix4, paint: number | undefined): void => {
    b.mesh.setMatrixAt(index, m);
    b.mesh.setColorAt(index, paint === undefined ? WHITE : tint.setHex(paint));
    b.mesh.instanceMatrix.needsUpdate = true;
    if (b.mesh.instanceColor) b.mesh.instanceColor.needsUpdate = true;
    b.mesh.boundingSphere = null;
    b.mesh.boundingBox = null;
  };

  const add = (b: Batch, owner: string, m: THREE.Matrix4, paint: number | undefined): Slot => {
    if (b.owners.length >= b.mesh.instanceMatrix.count) grow(b);
    const index = b.owners.length;
    b.owners.push(owner);
    b.mesh.count = b.owners.length;
    write(b, index, m, paint);
    triangles += b.trianglesEach;
    return { batch: b, index };
  };

  const tmpM = new THREE.Matrix4();
  const tmpC = new THREE.Color();
  const free = (slot: Slot): void => {
    const b = slot.batch;
    const last = b.owners.length - 1;
    if (slot.index !== last) {
      const moved = b.owners[last] as string;
      b.mesh.getMatrixAt(last, tmpM);
      b.mesh.setMatrixAt(slot.index, tmpM);
      if (b.mesh.instanceColor) {
        b.mesh.getColorAt(last, tmpC);
        b.mesh.setColorAt(slot.index, tmpC);
        b.mesh.instanceColor.needsUpdate = true;
      }
      b.owners[slot.index] = moved;
      const p = placed.get(moved);
      if (p) {
        if (p.main.batch === b && p.main.index === last) p.main.index = slot.index;
        else
          for (const e of p.ext)
            if (e.batch === b && e.index === last) {
              e.index = slot.index;
              break;
            }
      }
    }
    b.owners.pop();
    b.mesh.count = b.owners.length;
    b.mesh.instanceMatrix.needsUpdate = true;
    b.mesh.boundingSphere = null;
    b.mesh.boundingBox = null;
    triangles -= b.trianglesEach;
  };

  const q = new THREE.Quaternion();
  const pos = new THREE.Vector3();
  const scl = new THREE.Vector3();
  const yawOf = (p: HideoutPieceInput): number =>
    -((p.yawDeg ?? (p.rot ?? 0) * 90) * Math.PI) / 180;

  const edited = (): void => {
    proxyDirty = true;
    boundsDirty = true;
    lastEdit = performance.now();
  };

  const removeInternal = (key: string): boolean => {
    const p = placed.get(key);
    if (!p) return false;
    // Free the extension from its last slot down: freeing moves the batch's last instance
    // into the hole, which may be one of this piece's own later slots.
    for (let k = p.ext.length - 1; k >= 0; k--) free(p.ext[k] as Slot);
    free(p.main);
    placed.delete(key);
    return true;
  };

  const setInternal = (key: string, piece: HideoutPieceInput): void => {
    removeInternal(key);
    const def = pieceDef(piece.id) ?? UNKNOWN;
    const mat = resolveMaterial(def, piece.material);
    const comboKey = `${def.id}:${mat}`;
    q.setFromAxisAngle(UP, yawOf(piece));
    const matrix = new THREE.Matrix4().compose(
      pos.set(piece.x, piece.y + (piece.riseM ?? 0), piece.z),
      q,
      scl.set(1, 1, 1),
    );
    const main = add(
      batchFor(comboKey, () => buildPiece(def, mat)),
      key,
      matrix,
      piece.paint,
    );
    const rec: Placed = { piece, def, material: mat, main, matrix, ext: [], extMatrices: [] };
    placed.set(key, rec);
    const ext = def.extend;
    const reach = ext?.byRise
      ? (piece.riseM ?? 0)
      : (piece.extendM ?? (def.id === 'build.piling' ? 1 : 0));
    if (ext && reach > 0.01) {
      const geo = (): THREE.BufferGeometry => buildExtension(def, mat) as THREE.BufferGeometry;
      const batch = batchFor(`${comboKey}:ext`, geo);
      const top = piece.y + (ext.byRise ? (piece.riseM ?? 0) : 0) - ext.top;
      const steps = ext.repeatM ? Math.max(1, Math.round(reach / ext.repeatM)) : 1;
      for (let k = 0; k < steps; k++) {
        const m = new THREE.Matrix4().compose(
          pos.set(piece.x, top - k * (ext.repeatM ?? 0), piece.z),
          q,
          scl.set(1, ext.repeatM ? 1 : reach, 1),
        );
        rec.ext.push(add(batch, key, m, piece.paint));
        rec.extMatrices.push(m);
      }
    }
  };

  const proxyOf = (def: PieceDef, mat: HideoutMaterial): THREE.BufferGeometry => {
    const k = `${def.id}:${mat}`;
    let g = proxies.get(k);
    if (!g) proxies.set(k, (g = buildProxy(def, mat)));
    return g;
  };
  const extProxyOf = (def: PieceDef, mat: HideoutMaterial): THREE.BufferGeometry => {
    const k = `${def.id}:${mat}:ext`;
    let g = proxies.get(k);
    if (!g) {
      // The extension's own bounding box: a footing block or a cluster of posts as one.
      const full = buildExtension(def, mat) as THREE.BufferGeometry;
      full.computeBoundingBox();
      const bb = full.boundingBox as THREE.Box3;
      const color = full.getAttribute('color');
      const c = new THREE.Color(color.getX(0), color.getY(0), color.getZ(0));
      const size = bb.getSize(new THREE.Vector3());
      const ctr = bb.getCenter(new THREE.Vector3());
      g = finish({
        body: [box(size.x, size.y, size.z, ctr.x, bb.min.y, ctr.z, c.getHex())],
        lit: [],
      });
      full.dispose();
      proxies.set(k, g);
    }
    return g;
  };

  const rebuildProxy = (): void => {
    proxyDirty = false;
    if (proxy) {
      group.remove(proxy);
      proxy.geometry.dispose();
      proxy = undefined;
    }
    if (placed.size === 0) return;
    const parts: THREE.BufferGeometry[] = [];
    const colorM = new THREE.Color();
    for (const p of placed.values()) {
      const push = (src: THREE.BufferGeometry, m: THREE.Matrix4): void => {
        if (src.getAttribute('position').count === 0) return;
        const g = src.clone().applyMatrix4(m);
        if (p.piece.paint !== undefined) {
          colorM.setHex(p.piece.paint);
          const col = g.getAttribute('color') as THREE.BufferAttribute;
          for (let k = 0; k < col.count; k++)
            col.setXYZ(k, col.getX(k) * colorM.r, col.getY(k) * colorM.g, col.getZ(k) * colorM.b);
        }
        parts.push(g);
      };
      push(proxyOf(p.def, p.material), p.matrix);
      for (const m of p.extMatrices) push(extProxyOf(p.def, p.material), m);
    }
    if (parts.length === 0) return;
    const merged = mergeGeometries(parts, false);
    for (const g of parts) g.dispose();
    if (!merged) return;
    merged.computeBoundingSphere();
    proxy = new THREE.Mesh(merged, material);
    proxy.name = 'hideout:proxy';
    proxy.matrixAutoUpdate = false;
    proxy.visible = far;
    group.add(proxy);
  };

  const center = new THREE.Vector3();
  const updateBounds = (): void => {
    boundsDirty = false;
    bounds.makeEmpty();
    for (const p of placed.values()) bounds.expandByPoint(pos.setFromMatrixPosition(p.matrix));
    if (!bounds.isEmpty()) bounds.getCenter(center);
  };

  const lampList: HideoutLamp[] = [];
  let lampsDirty = true;
  const collectLamps = (): void => {
    lampsDirty = false;
    lampList.length = 0;
    const at = new THREE.Vector3();
    for (const p of placed.values()) {
      const l = p.def.lamp;
      if (!l) continue;
      at.set(l.x, l.y, l.z).applyMatrix4(p.matrix);
      lampList.push({ x: at.x, y: at.y, z: at.z, radiusM: l.radiusM, color: l.color });
    }
  };

  const camLocal = new THREE.Vector3();
  const lampAt = new THREE.Vector3();
  const order: number[] = [];
  const glowColor = new THREE.Color();

  return {
    group,
    near,
    get proxy() {
      return proxy;
    },
    get size() {
      return placed.size;
    },
    get batches() {
      let n = 0;
      for (const b of batches.values()) if (b.owners.length > 0) n++;
      return n;
    },
    get triangles() {
      return triangles;
    },
    get proxyTriangles() {
      return proxy ? proxy.geometry.getAttribute('position').count / 3 : 0;
    },
    get far() {
      return far;
    },
    get proxyDirty() {
      return proxyDirty;
    },
    set(key, piece) {
      setInternal(key, piece);
      lampsDirty = true;
      edited();
    },
    remove(key) {
      const ok = removeInternal(key);
      if (ok) {
        lampsDirty = true;
        edited();
      }
      return ok;
    },
    has(key) {
      return placed.has(key);
    },
    setAll(pieces) {
      for (const k of [...placed.keys()]) removeInternal(k);
      for (const [k, p] of pieces) setInternal(k, p);
      lampsDirty = true;
      edited();
    },
    clear() {
      for (const k of [...placed.keys()]) removeInternal(k);
      lampsDirty = true;
      edited();
    },
    rebuildProxy,
    lamps() {
      if (lampsDirty) collectLamps();
      return lampList;
    },
    update(camera, night, focus, nowMs = performance.now(), lightPools = true) {
      if (boundsDirty) updateBounds();
      if (proxyDirty && nowMs - lastEdit >= debounce && Number.isFinite(proxyBeyond))
        rebuildProxy();
      // Near or far, with a little hysteresis so it doesn't flicker at the line.
      group.updateWorldMatrix(true, false);
      camLocal.copy(camera);
      group.worldToLocal(camLocal);
      const radius = bounds.isEmpty() ? 0 : bounds.getSize(pos).length() / 2;
      const d = camLocal.distanceTo(center) - radius;
      if (!far && d > proxyBeyond * 1.05 && proxy) far = true;
      else if (far && d < proxyBeyond * 0.95) far = false;
      if (far && !proxy) far = false;
      near.visible = !far;
      if (proxy) proxy.visible = far;

      const u = (material as Partial<StylizedMaterial>).uniforms;
      u?.uGlow?.value.copy(glowColor.setScalar(1.15 * night));
      if (u?.uGlowDim) u.uGlowDim.value = 0.32 + 0.68 * night;

      const pools = options.pools;
      if (!pools || !lightPools) return;
      const lamps = this.lamps();
      const f = focus ?? camera;
      camLocal.copy(f);
      group.worldToLocal(camLocal);
      order.length = 0;
      for (let k = 0; k < lamps.length; k++) order.push(k);
      const dist = (k: number): number => {
        const l = lamps[k] as HideoutLamp;
        return (l.x - camLocal.x) ** 2 + (l.z - camLocal.z) ** 2;
      };
      order.sort((a, b) => dist(a) - dist(b));
      const slots = pools.uPoolPosition.value.length;
      for (let s = 0; s < slots; s++) {
        const k = order[s];
        const p = pools.uPoolPosition.value[s];
        const c = pools.uPoolColor.value[s];
        if (!p || !c) continue;
        const l = k === undefined ? undefined : lamps[k];
        if (!l || night <= 0 || far) {
          c.setRGB(0, 0, 0);
          continue;
        }
        lampAt.set(l.x, l.y, l.z).applyMatrix4(group.matrixWorld);
        p.set(lampAt.x, lampAt.y, lampAt.z, l.radiusM * POOL_REACH);
        c.setHex(l.color).multiplyScalar(POOL_GAIN * night * 0.8);
      }
    },
    dispose() {
      for (const b of batches.values()) {
        b.mesh.dispose();
        b.geometry.dispose();
      }
      for (const g of proxies.values()) g.dispose();
      proxy?.geometry.dispose();
      if (!options.material) material.dispose();
    },
  };
}
