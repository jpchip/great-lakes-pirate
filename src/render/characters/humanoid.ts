import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import type { OutlineSettings } from '../style/outline';
import type { StyleId, StyleLighting } from '../style/stylized-material';
import {
  beardGeometry,
  hatGeometry,
  propGeometry,
  type HeadFrame,
  type JointFrame,
} from './accessories';
import {
  createCharacterMaterial,
  createCharacterOutlineMaterial,
  setPalette,
  type CharacterMaterial,
} from './character-material';
import {
  bodyUrl,
  CLIPS,
  LOD_COUNT,
  LOOPING_CLIPS,
  PIECE_NAMES,
  type BodyId,
  type ClipName,
  type PieceName,
} from './humanoid-spec';
import { lookPalette, lookPieces, lookShapeKey, type Look } from './looks';
import { REGION } from './regions';

/**
 * The humanoid (plan 08 §13, §14, §20 piece B; plan 14 §9): one skeleton per body, every
 * character one skinned mesh merged from the look's pieces plus code-built hats and props,
 * one draw call plus its outline. Geometry is shared between characters with the same
 * shape; only the palette differs. Animation runs on the GPU-skinned skeleton through a
 * three.js mixer, updated less often with distance (animation LOD).
 */

/** One body's parsed GLB. */
export interface BodyAsset {
  id: BodyId;
  /** The armature to clone per character. */
  armature: THREE.Object3D;
  jointNames: string[];
  boneInverses: THREE.Matrix4[];
  /** `<piece>.lod<n>` → geometry. */
  pieces: Map<string, THREE.BufferGeometry>;
  clips: Map<ClipName, THREE.AnimationClip>;
  head: HeadFrame;
  joints: { hand: JointFrame; pelvis: JointFrame; chest: JointFrame };
}

function jointFrame(
  names: readonly string[],
  inverses: readonly THREE.Matrix4[],
  name: string,
  child: string,
): JointFrame {
  const index = names.indexOf(name);
  const childIndex = names.indexOf(child);
  const at = (i: number) =>
    new THREE.Vector3().setFromMatrixPosition(
      new THREE.Matrix4().copy(inverses[i] ?? new THREE.Matrix4()).invert(),
    );
  const position = at(index);
  const along = at(childIndex).sub(position).normalize();
  return { index, position, along };
}

/** Skull top, width and face front from the head piece's skin and eyes. */
export function measureHead(geometry: THREE.BufferGeometry): HeadFrame {
  const pos = geometry.getAttribute('position');
  const look = geometry.getAttribute('_look');
  let top = -Infinity;
  let frontZ = -Infinity;
  let eyeY = 0;
  let eyes = 0;
  for (let i = 0; i < pos.count; i++) {
    const region = Math.round(look.getX(i));
    const y = pos.getY(i);
    if (region === REGION.skin) {
      top = Math.max(top, y);
      frontZ = Math.max(frontZ, pos.getZ(i));
    } else if (region === REGION.iris || region === REGION.eyeWhite) {
      eyeY += y;
      eyes++;
    }
  }
  eyeY = eyes ? eyeY / eyes : top - 0.11;
  // The skull above the brow, as the ellipse (about the vertical axis) a hat must clear:
  // width and depth over all of it, so the bulge of the forehead is inside, then the
  // radius grown until every vertex is. The skull is much longer than wide (about 1.3).
  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  const above: number[] = [];
  for (let i = 0; i < pos.count; i++) {
    if (Math.round(look.getX(i)) !== REGION.skin || pos.getY(i) < eyeY + 0.03) continue;
    above.push(i);
    minX = Math.min(minX, pos.getX(i));
    maxX = Math.max(maxX, pos.getX(i));
    minZ = Math.min(minZ, pos.getZ(i));
    maxZ = Math.max(maxZ, pos.getZ(i));
  }
  const centerZ = (minZ + maxZ) / 2;
  const scaleZ = (maxZ - minZ) / Math.max(maxX - minX, 1e-6);
  let radius = (maxX - minX) / 2;
  for (const i of above) {
    radius = Math.max(radius, Math.hypot(pos.getX(i), (pos.getZ(i) - centerZ) / scaleZ));
  }
  return { top, eyeY, frontZ, radius, centerZ, scaleZ };
}

/** Pull a body out of its loaded GLB. */
export function parseBody(id: BodyId, gltf: GLTF): BodyAsset {
  const found = new Map<string, THREE.BufferGeometry>();
  let skeleton: THREE.Skeleton | undefined;
  gltf.scene.traverse((node) => {
    if (node instanceof THREE.SkinnedMesh) {
      found.set(node.name, node.geometry);
      skeleton ??= node.skeleton;
    }
  });
  // The loader sanitizes node names ("head.lod0" → "head_lod0"); key by the GLB's names.
  const pieces = new Map<string, THREE.BufferGeometry>();
  for (const piece of PIECE_NAMES) {
    for (let lod = 0; lod < LOD_COUNT; lod++) {
      const name = `${piece}.lod${lod}`;
      const geometry = found.get(THREE.PropertyBinding.sanitizeNodeName(name)) ?? found.get(name);
      if (geometry) pieces.set(name, geometry);
    }
  }
  if (!skeleton) throw new Error(`${id}.glb has no skinned mesh`);
  const armature = gltf.scene.getObjectByName('Armature');
  if (!armature) throw new Error(`${id}.glb has no Armature`);
  const jointNames = skeleton.bones.map((b) => b.name);
  const boneInverses = skeleton.boneInverses.map((m) => m.clone());
  const clips = new Map<ClipName, THREE.AnimationClip>();
  for (const name of Object.keys(CLIPS) as ClipName[]) {
    const clip = gltf.animations.find((c) => c.name === name);
    if (clip) clips.set(name, clip);
  }
  const headGeo = pieces.get('head.lod0');
  if (!headGeo) throw new Error(`${id}.glb has no head`);
  return {
    id,
    armature,
    jointNames,
    boneInverses,
    pieces,
    clips,
    head: measureHead(headGeo),
    joints: {
      hand: jointFrame(jointNames, boneInverses, 'hand_r', 'middle_01_r'),
      pelvis: jointFrame(jointNames, boneInverses, 'pelvis', 'spine_01'),
      chest: jointFrame(jointNames, boneInverses, 'spine_03', 'neck_01'),
    },
  };
}

/** Same attribute types everywhere, so pieces and code-built parts merge. */
function normalizeAttributes(geometry: THREE.BufferGeometry): THREE.BufferGeometry {
  const out = new THREE.BufferGeometry();
  const take = (name: string, size: number, type: 'f32' | 'u16') => {
    const src = geometry.getAttribute(name);
    const n = geometry.getAttribute('position').count;
    const dst = type === 'f32' ? new Float32Array(n * size) : new Uint16Array(n * size);
    for (let i = 0; i < n; i++) {
      for (let k = 0; k < size; k++) dst[i * size + k] = src ? (src.getComponent(i, k) ?? 0) : 0;
    }
    out.setAttribute(
      name,
      type === 'f32'
        ? new THREE.BufferAttribute(dst, size)
        : new THREE.Uint16BufferAttribute(dst, size),
    );
  };
  take('position', 3, 'f32');
  take('normal', 3, 'f32');
  take('skinIndex', 4, 'u16');
  take('skinWeight', 4, 'f32');
  take('_look', 2, 'f32');
  const index = geometry.getIndex();
  if (index) out.setIndex(Array.from(index.array as ArrayLike<number>));
  return out;
}

/** Loaded bodies plus a cache of merged geometries by shape and LOD. */
export class HumanoidLibrary {
  private readonly geometries = new Map<string, THREE.BufferGeometry>();

  constructor(readonly bodies: ReadonlyMap<BodyId, BodyAsset>) {}

  body(id: BodyId): BodyAsset {
    const body = this.bodies.get(id) ?? this.bodies.values().next().value;
    if (!body) throw new Error('no bodies loaded');
    return body;
  }

  /** The look's merged geometry at a LOD (0 nearest). Shared; don't dispose it. */
  geometry(look: Look, lod: number): THREE.BufferGeometry {
    const key = `${lookShapeKey(look)}#${lod}`;
    const cached = this.geometries.get(key);
    if (cached) return cached;
    const body = this.body(look.body);
    const parts: THREE.BufferGeometry[] = [];
    for (const piece of lookPieces(look) as PieceName[]) {
      const g = body.pieces.get(`${piece}.lod${lod}`);
      if (g) parts.push(normalizeAttributes(g));
    }
    const headJoint = body.jointNames.indexOf('Head');
    // Hats and the mustache at every LOD (they're the silhouette); props too.
    for (const extra of [
      hatGeometry(look.hat, body.head, headJoint),
      lod < 2 ? beardGeometry(look.beard, body.head, headJoint) : null,
      propGeometry(look.held, body.joints.hand, body.joints.pelvis, body.joints.chest),
    ]) {
      if (extra) parts.push(normalizeAttributes(extra));
    }
    const merged = mergeGeometries(parts, false);
    if (!merged) throw new Error(`could not merge look ${key}`);
    merged.computeBoundingSphere();
    // Skinned bounds move with the bones; pad so frustum culling never clips a limb.
    if (merged.boundingSphere) merged.boundingSphere.radius += 0.6;
    for (const p of parts) p.dispose();
    this.geometries.set(key, merged);
    return merged;
  }

  /** Triangles in a look at a LOD (for the budget test and the HUD). */
  triangles(look: Look, lod: number): number {
    const index = this.geometry(look, lod).getIndex();
    return index ? index.count / 3 : 0;
  }

  dispose(): void {
    for (const g of this.geometries.values()) g.dispose();
    this.geometries.clear();
  }
}

/** Distances (m) where a character drops to LOD 1 and 2. */
export const LOD_DISTANCES: readonly [number, number] = [14, 32];

/** Mixer updates: every frame near, then every 2nd and every 4th frame (animation LOD). */
export const ANIMATION_STRIDE_DISTANCES: readonly [number, number] = [18, 40];

export function lodForDistance(distance: number): number {
  return distance < LOD_DISTANCES[0]
    ? 0
    : distance < LOD_DISTANCES[1]
      ? 1
      : Math.min(2, LOD_COUNT - 1);
}

export function animationStride(distance: number): number {
  return distance < ANIMATION_STRIDE_DISTANCES[0]
    ? 1
    : distance < ANIMATION_STRIDE_DISTANCES[1]
      ? 2
      : 4;
}

export interface CharacterOptions {
  style: StyleId;
  lighting: StyleLighting;
  outline?: OutlineSettings;
}

/**
 * One character in the scene. `root` stands at the feet facing −Z (north at heading 0,
 * like the controller's capsule); set its position and rotation from the sim.
 */
export class Character {
  readonly root = new THREE.Group();
  readonly mesh: THREE.SkinnedMesh;
  readonly outline: THREE.SkinnedMesh | null;
  readonly mixer: THREE.AnimationMixer;
  readonly material: CharacterMaterial;
  private readonly model = new THREE.Group();
  private readonly actions = new Map<ClipName, THREE.AnimationAction>();
  private current: THREE.AnimationAction | null = null;
  private currentName: ClipName | null = null;
  private lod = -1;
  private pendingSeconds = 0;
  private frame = 0;
  private look: Look;

  constructor(
    private readonly library: HumanoidLibrary,
    look: Look,
    options: CharacterOptions,
  ) {
    this.look = look;
    const body = library.body(look.body);
    const armature = body.armature.clone(true);
    const bones = body.jointNames.map((name) => {
      const bone = armature.getObjectByName(name);
      if (!(bone instanceof THREE.Bone)) throw new Error(`bone ${name} missing`);
      return bone;
    });
    const skeleton = new THREE.Skeleton(bones, body.boneInverses);
    this.material = createCharacterMaterial(options.style, options.lighting, lookPalette(look));
    this.mesh = new THREE.SkinnedMesh(library.geometry(look, 0), this.material);
    this.mesh.name = 'character';
    this.mesh.bind(skeleton, new THREE.Matrix4());
    this.outline = options.outline
      ? new THREE.SkinnedMesh(this.mesh.geometry, createCharacterOutlineMaterial(options.outline))
      : null;
    if (this.outline) {
      this.outline.name = 'character-outline';
      this.outline.bind(skeleton, new THREE.Matrix4());
      this.outline.userData['outline'] = true;
    }
    // The rig faces +Z; the sim's heading 0 faces −Z.
    this.model.rotation.y = Math.PI;
    this.model.add(armature, this.mesh);
    if (this.outline) this.model.add(this.outline);
    this.root.add(this.model);
    this.mixer = new THREE.AnimationMixer(armature);
    this.setLod(0);
    this.play('idle', 0);
  }

  get lookValue(): Look {
    return this.look;
  }

  /** Recolor in place; a change of shape swaps the shared geometry. */
  setLook(look: Look): void {
    const shapeChanged =
      lookShapeKey(look) !== lookShapeKey(this.look) || look.body !== this.look.body;
    if (look.body !== this.look.body) throw new Error('a character keeps its body; make a new one');
    this.look = look;
    setPalette(this.material, lookPalette(look));
    if (shapeChanged) {
      const lod = this.lod;
      this.lod = -1;
      this.setLod(lod);
    }
  }

  setLod(lod: number): void {
    if (lod === this.lod) return;
    this.lod = lod;
    const geometry = this.library.geometry(this.look, lod);
    this.mesh.geometry = geometry;
    if (this.outline) {
      this.outline.geometry = geometry;
      // No ink at the far LOD: a 2 px line on a 40 px figure reads as a smudge.
      this.outline.visible = lod < 2;
    }
  }

  get currentLod(): number {
    return this.lod;
  }

  get clip(): ClipName | null {
    return this.currentName;
  }

  /**
   * Cross-fade to a clip. Loops loop; one-shots play once and hold their last frame.
   * `timeScale` matches a gait's clip to the controller's speed.
   */
  play(name: ClipName, fadeSeconds = 0.2, timeScale = 1): void {
    const body = this.library.body(this.look.body);
    let action = this.actions.get(name);
    if (!action) {
      const clip = body.clips.get(name);
      if (!clip) return;
      action = this.mixer.clipAction(clip);
      if (!LOOPING_CLIPS.has(name)) {
        action.setLoop(THREE.LoopOnce, 1);
        action.clampWhenFinished = true;
      }
      this.actions.set(name, action);
    }
    action.timeScale = timeScale;
    if (this.current === action) return;
    action.reset().setEffectiveWeight(1).play();
    if (this.current && fadeSeconds > 0) action.crossFadeFrom(this.current, fadeSeconds, false);
    else this.current?.stop();
    this.current = action;
    this.currentName = name;
  }

  /** Lantern glass light (night). */
  setGlow(color: THREE.Color): void {
    this.material.uniforms.uGlow.value.copy(color);
  }

  /**
   * Advance the animation. `cameraDistance` picks the mesh LOD and how often the mixer
   * runs: far characters animate at a quarter rate, which nobody can see at that size.
   */
  update(dt: number, cameraDistance: number): void {
    this.setLod(lodForDistance(cameraDistance));
    this.pendingSeconds += dt;
    this.frame++;
    if (this.frame % animationStride(cameraDistance) !== 0) return;
    this.mixer.update(this.pendingSeconds);
    this.pendingSeconds = 0;
  }

  dispose(): void {
    this.mixer.stopAllAction();
    this.material.dispose();
    (this.outline?.material as THREE.Material | undefined)?.dispose();
    this.root.removeFromParent();
  }
}

/** Load both bodies (or the ones asked for) from public/assets/characters/. */
export async function loadHumanoids(
  baseUrl: string,
  bodies: readonly BodyId[] = ['male', 'female'],
): Promise<HumanoidLibrary> {
  const [{ GLTFLoader }, { MeshoptDecoder }] = await Promise.all([
    import('three/examples/jsm/loaders/GLTFLoader.js'),
    import('three/examples/jsm/libs/meshopt_decoder.module.js'),
  ]);
  const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
  const loaded = await Promise.all(
    bodies.map(
      async (id) =>
        [id, parseBody(id, await loader.loadAsync(new URL(bodyUrl(id), baseUrl).href))] as const,
    ),
  );
  return new HumanoidLibrary(new Map(loaded));
}
