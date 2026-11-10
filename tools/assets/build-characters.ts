#!/usr/bin/env node
// Builds the humanoid bodies the player and every NPC wear (plan 08 §20 piece B, plan 14
// §5, §7–§9) from the CC0 Quaternius parts in raw-assets/characters/quaternius/
// (fetch them with tools/assets/fetch-quaternius.ts).
//
//   node tools/assets/build-characters.ts            # writes public/assets/characters/
//
// Per body (male, female) one GLB holds:
// - the skeleton (the outfit's, the Quaternius universal humanoid rig: 65 joints);
// - pieces, each at three LODs: head (with eyes and brows), hands, shirt, jacket (a shell
//   pushed out from the shirt and hips), legs, boots, and the hair and beard styles. The
//   game merges the pieces a look needs into one skinned mesh, so a character is one draw
//   call plus its outline;
// - the clip set, retargeted from the Universal Animation Libraries onto this skeleton.
// Textures are gone: every vertex carries a color region and a shade (`_LOOK`), and the
// toon material colors regions from the character's palette (src/render/characters/).

import { mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as THREE from 'three';
import {
  Document,
  NodeIO,
  type Animation,
  type Node as GltfNode,
  type Primitive,
  type Skin,
} from '@gltf-transform/core';
import { ALL_EXTENSIONS, EXTMeshoptCompression } from '@gltf-transform/extensions';
import { dedup, prune, quantize, reorder, resample } from '@gltf-transform/functions';
import { MeshoptDecoder, MeshoptEncoder, MeshoptSimplifier } from 'meshoptimizer';
import sharp from 'sharp';
import { REGION } from '../../src/render/characters/regions.ts';
import {
  CLIPS,
  LOD_COUNT,
  PIECE_NAMES,
  type BodyId,
  type PieceName,
} from '../../src/render/characters/humanoid-spec.ts';
import {
  assignRegions,
  compact,
  filterTriangles,
  lumaClusters,
  merge,
  rebind,
  restWorldRotations,
  retargetFrame,
  shell,
  solidRegion,
  translate,
  weldedNormals,
  triangleCount,
  triangleLuma,
  weightOn,
  type RestJoint,
  type RgbImage,
  type SkinnedGeo,
} from './lib/humanoid.ts';
import {
  assetHintsSchema,
  provenanceSchema,
  shippedProvenance,
  withManifestEntry,
  type ManifestLike,
} from './lib/hull.ts';

const PIPELINE_STEPS = [
  'tools/assets/build-characters.ts: parts rebound onto the outfit skeleton; the head cut from the base body by head and neck weights',
  'textures replaced by color regions and shades per vertex (luma clusters of the base color texture)',
  'jacket built as a shell 12 mm out from the shirt, hips and forearms',
  'meshopt simplification to three LODs (plan 14 §8)',
  'Universal Animation Library clips retargeted onto the skeleton (world-delta), resampled at 30 fps',
  'gltf-transform resample, dedup, prune, quantize (normals, weights), EXT_meshopt_compression',
];

const ROOT = resolve(fileURLToPath(import.meta.url), '..', '..', '..');
const RAW = join(ROOT, 'raw-assets', 'characters', 'quaternius');
const OUT = join(ROOT, 'public', 'assets', 'characters');
const FPS = 30;

const io = new NodeIO()
  .registerExtensions(ALL_EXTENSIONS)
  .registerDependencies({ 'meshopt.decoder': MeshoptDecoder, 'meshopt.encoder': MeshoptEncoder });

// ---------------------------------------------------------------------------------------
// Reading

interface SourceSkin {
  joints: string[];
  inverseBind: THREE.Matrix4[];
}

function readSkin(skin: Skin): SourceSkin {
  const ibm = skin.getInverseBindMatrices();
  if (!ibm) throw new Error('skin without inverse bind matrices');
  return {
    joints: skin.listJoints().map((j) => j.getName()),
    inverseBind: skin
      .listJoints()
      .map((_, i) => new THREE.Matrix4().fromArray(ibm.getElement(i, []))),
  };
}

async function readImage(prim: Primitive): Promise<RgbImage | null> {
  const texture = prim.getMaterial()?.getBaseColorTexture();
  const image = texture?.getImage();
  if (!image) return null;
  const { data, info } = await sharp(Buffer.from(image))
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  return { width: info.width, height: info.height, data: new Uint8Array(data) };
}

function readPrimitive(prim: Primitive): SkinnedGeo {
  const array = (semantic: string): Float32Array => {
    const accessor = prim.getAttribute(semantic);
    if (!accessor) return new Float32Array(0);
    const out = new Float32Array(accessor.getCount() * accessor.getElementSize());
    const el: number[] = [];
    for (let i = 0; i < accessor.getCount(); i++)
      out.set(accessor.getElement(i, el), i * el.length);
    return out;
  };
  const indices = prim.getIndices();
  if (!indices) throw new Error('unindexed primitive');
  const weights = array('WEIGHTS_0');
  // Normalize weights (some exports sum to 0.999).
  for (let i = 0; i < weights.length; i += 4) {
    const sum =
      (weights[i] ?? 0) + (weights[i + 1] ?? 0) + (weights[i + 2] ?? 0) + (weights[i + 3] ?? 0);
    for (let k = 0; k < 4; k++) weights[i + k] = (weights[i + k] ?? 0) / (sum || 1);
  }
  return {
    pos: array('POSITION'),
    nrm: array('NORMAL'),
    uv: array('TEXCOORD_0'),
    joints: Uint16Array.from(array('JOINTS_0')),
    weights,
    index: Uint32Array.from(indices.getArray() ?? []),
  };
}

interface LoadedPart {
  geo: SkinnedGeo;
  image: RgbImage | null;
}

/** Every primitive of a file, keyed "<mesh name>/<material name>", on the target skin. */
async function loadParts(file: string, target: SourceSkin): Promise<Map<string, LoadedPart>> {
  const doc = await io.read(join(RAW, file));
  const out = new Map<string, LoadedPart>();
  for (const node of doc.getRoot().listNodes()) {
    const mesh = node.getMesh();
    const skin = node.getSkin();
    if (!mesh || !skin) continue;
    const source = readSkin(skin);
    for (const prim of mesh.listPrimitives()) {
      const raw = readPrimitive(prim);
      const geo = rebind(raw, source.joints, source.inverseBind, target.joints, target.inverseBind);
      out.set(`${mesh.getName()}/${prim.getMaterial()?.getName() ?? ''}`, {
        geo,
        image: await readImage(prim),
      });
    }
  }
  return out;
}

function part(parts: Map<string, LoadedPart>, key: string): LoadedPart {
  const found = parts.get(key);
  if (!found) throw new Error(`no part ${key} (have ${[...parts.keys()].join(', ')})`);
  return found;
}

// ---------------------------------------------------------------------------------------
// Coloring

/** Luma clusters → regions, dark to light; shade is luma over the cluster's center. */
function byLuma(p: LoadedPart, regions: readonly number[]): SkinnedGeo {
  if (!p.image) return solidRegion(p.geo, regions[regions.length - 1] ?? 0);
  const lumas = triangleLuma(p.geo, p.image);
  const { centers, cluster } = lumaClusters(lumas, regions.length);
  return assignRegions(
    p.geo,
    (t) => regions[cluster[t] ?? 0] ?? 0,
    (t) => {
      const c = centers[cluster[t] ?? 0] ?? 1;
      return THREE.MathUtils.clamp((lumas[t] ?? c) / Math.max(c, 0.02), 0.82, 1.15);
    },
  );
}

/** One region, shaded by the texture's luma relative to its mean. */
function solidShaded(p: LoadedPart, region: number): SkinnedGeo {
  return byLuma(p, [region]);
}

// ---------------------------------------------------------------------------------------
// Simplification

/** Each vertex index replaced by the first vertex at the same position. */
function weldByPosition(geo: SkinnedGeo): Uint32Array {
  const first = new Map<string, number>();
  const remap = new Uint32Array(geo.pos.length / 3);
  for (let v = 0; v < remap.length; v++) {
    const key = `${geo.pos[v * 3]?.toFixed(5)},${geo.pos[v * 3 + 1]?.toFixed(5)},${geo.pos[v * 3 + 2]?.toFixed(5)}`;
    const seen = first.get(key);
    remap[v] = seen ?? v;
    if (seen === undefined) first.set(key, v);
  }
  return geo.index.map((i) => remap[i] ?? i);
}

async function simplifyTo(geo: SkinnedGeo, targetTriangles: number): Promise<SkinnedGeo> {
  if (targetTriangles <= 0) return { ...geo, index: new Uint32Array(0) };
  if (triangleCount(geo) <= targetTriangles) return geo;
  await MeshoptSimplifier.ready;
  // The source meshes split vertices along UV seams, which the edge collapse treats as
  // borders it must keep, so it stalls and the sloppy fallback tears the mesh into shards.
  // Collapse on a position-welded index instead; the survivors keep one side's UVs.
  const welded = weldByPosition(geo);
  const [index] = MeshoptSimplifier.simplify(
    welded,
    geo.pos,
    3,
    Math.floor(targetTriangles) * 3,
    1, // error bound as a fraction of the mesh size: let the count decide
    ['Permissive', 'Prune'],
  );
  if (index.length / 3 <= targetTriangles * 1.25) {
    // Fresh normals from the reduced surface: the survivors' original normals no longer
    // match the bigger faces, and at grazing angles that lit whole faces with rim light.
    const out = compact(geo, index);
    return { ...out, nrm: weldedNormals(out) };
  }
  // Layered or open meshes (hair cards, sleeves over sleeves) stall the edge collapse; the
  // sloppy simplifier clusters vertices instead and always reaches the count.
  // It overshoots on small meshes, so ask for more until it lands near the target.
  let ask = Math.floor(targetTriangles);
  let best = index;
  for (let attempt = 0; attempt < 12; attempt++) {
    const [sloppy] = MeshoptSimplifier.simplifySloppy(geo.index, geo.pos, 3, null, ask * 3, 1);
    if (sloppy.length / 3 > targetTriangles * 1.1) break;
    best = sloppy;
    if (sloppy.length / 3 >= targetTriangles * 0.8) break;
    ask = Math.ceil(ask * 1.4);
  }
  return compact(geo, best);
}

// ---------------------------------------------------------------------------------------
// Bodies

interface BodySpec {
  id: BodyId;
  outfit: string;
  base: string;
  /** "<mesh>/<material>" keys in the files. */
  keys: {
    head: string;
    eyes: string;
    brows: string;
    hands: string;
    torso: string[];
    legs: string;
    boots: string;
  };
  /** Cloth regions dark → light for the torso pieces. */
  torsoRegions: Record<string, readonly number[]>;
  /** Hair files and how to fit them (modelled on the male head). */
  hair: Partial<Record<PieceName, string>>;
  hairFit?: { dy: number; dz: number; scale: number };
}

const BODIES: BodySpec[] = [
  {
    id: 'male',
    outfit: 'outfit-peasant-male.glb',
    base: 'base-male.glb',
    keys: {
      head: 'Sphere.005_Retopology.004/MI_Superhero_Male',
      eyes: 'Face.001/MI_Eyes',
      brows: 'Face/MI_Hair_1',
      hands: 'Male_Peasant_Arms/MI_Regular_Male',
      torso: ['Male_Peasant_Body/MI_Peasant', 'Male_Peasant_Arms/MI_Peasant'],
      legs: 'Male_Peasant_Legs/MI_Peasant',
      boots: 'Male_Peasant_Feet/MI_Peasant',
    },
    torsoRegions: {
      'Male_Peasant_Body/MI_Peasant': [REGION.leather, REGION.shirt],
      'Male_Peasant_Arms/MI_Peasant': [REGION.leather, REGION.shirt],
    },
    hair: {
      'hair.short': 'hair-simpleparted.glb',
      'hair.cropped': 'hair-buzzed.glb',
      'hair.long': 'hair-long.glb',
      'beard.full': 'hair-beard.glb',
    },
  },
  {
    id: 'female',
    outfit: 'outfit-peasant-female.glb',
    base: 'base-female.glb',
    keys: {
      head: 'Superhero_Female/MI_Superhero_Female',
      eyes: 'Eyes/MI_Eyes',
      brows: 'Eyebrows/MI_Hair_2',
      // The female peasant's arms are all sleeve; her hands come from the base body.
      hands: 'Superhero_Female/MI_Superhero_Female',
      torso: ['Female_Peasant_Body/MI_Peasant', 'Female_Peasant_Arms/MI_Peasant'],
      legs: 'Female_Peasant_Legs/MI_Peasant',
      boots: 'Female_Peasant_Feet/MI_Peasant',
    },
    torsoRegions: {
      'Female_Peasant_Body/MI_Peasant': [REGION.leather, REGION.vest, REGION.shirt],
      'Female_Peasant_Arms/MI_Peasant': [REGION.leather, REGION.shirt],
    },
    hair: {
      'hair.short': 'hair-simpleparted.glb',
      'hair.cropped': 'hair-buzzed.glb',
      'hair.long': 'hair-long.glb',
      'hair.buns': 'hair-buns.glb',
    },
    // The rebind already moves the hair from the male head bone to hers; it only needs to
    // shrink a little to her smaller skull.
    hairFit: { dy: 0, dz: 0, scale: 0.96 },
  },
];

/** Triangle targets per piece and LOD (plan 14 §8: 3–5k, 1.5k, 500 for a dressed body). */
const LOD_TRIANGLES: Record<PieceName, readonly [number, number, number]> = {
  head: [1100, 380, 150],
  hands: [320, 120, 40],
  shirt: [1100, 420, 130],
  jacket: [1100, 400, 120],
  legs: [420, 160, 60],
  boots: [420, 160, 50],
  'hair.short': [360, 130, 40],
  'hair.cropped': [260, 100, 30],
  'hair.long': [420, 150, 50],
  'hair.buns': [420, 150, 50],
  'beard.full': [320, 110, 30],
};

function jointSet(skin: SourceSkin, names: readonly string[]): Set<number> {
  return new Set(names.map((n) => skin.joints.indexOf(n)).filter((i) => i >= 0));
}

/**
 * One source mesh of a piece. Simplification runs on the textured source (meshopt keeps
 * UV seams closed); coloring runs after, on whatever triangles survive.
 */
interface Component {
  part: LoadedPart;
  color: (p: LoadedPart) => SkinnedGeo;
  /** Fixed triangle targets per LOD (eyes, brows); others share what's left. */
  fixed?: readonly [number, number, number];
}

async function buildPieces(spec: BodySpec, skin: SourceSkin): Promise<Map<PieceName, Component[]>> {
  const outfit = await loadParts(spec.outfit, skin);
  const base = await loadParts(spec.base, skin);
  const pieces = new Map<PieceName, Component[]>();
  const headJoints = jointSet(skin, ['Head', 'neck_01']);
  const handJoints = jointSet(
    skin,
    skin.joints.filter((j) => /^(hand|index|middle|pinky|ring|thumb)_/.test(j)),
  );
  const solid = (region: number) => (p: LoadedPart) => solidShaded(p, region);
  const noInk = (color: (p: LoadedPart) => SkinnedGeo) => (p: LoadedPart) => {
    const geo = color(p);
    const look = Float32Array.from(geo.look ?? []);
    for (let i = 1; i < look.length; i += 2) look[i] = -Math.abs(look[i] ?? 1);
    return { ...geo, look };
  };
  const clusters = (regions: readonly number[]) => (p: LoadedPart) => byLuma(p, regions);

  // Head: the base body's triangles that mostly follow the head and neck.
  const headPart = part(base, spec.keys.head);
  const head = filterTriangles(headPart.geo, (a, b, c) =>
    [a, b, c].every((v) => weightOn(headPart.geo, v, headJoints) > 0.5),
  );
  pieces.set('head', [
    { part: { geo: head, image: headPart.image }, color: solid(REGION.skin) },
    // Eyes and brows carry no ink line (a negative shade): at game distance an outline
    // round them turns the face into a black band.
    {
      part: part(base, spec.keys.eyes),
      color: noInk(clusters([REGION.iris, REGION.eyeWhite])),
      fixed: [120, 48, 0],
    },
    { part: part(base, spec.keys.brows), color: noInk(solid(REGION.hair)), fixed: [140, 48, 0] },
  ]);

  // Hands: male from the outfit's arms; female from the base body's wrists down.
  const handsPart =
    spec.id === 'male' ? part(outfit, spec.keys.hands) : part(base, spec.keys.hands);
  const hands =
    spec.id === 'male'
      ? handsPart.geo
      : filterTriangles(handsPart.geo, (a, b, c) =>
          [a, b, c].every((v) => weightOn(handsPart.geo, v, handJoints) > 0.5),
        );
  pieces.set('hands', [
    { part: { geo: hands, image: handsPart.image }, color: solid(REGION.skin) },
  ]);

  const torsoParts = spec.keys.torso.map((k) => part(outfit, k));
  pieces.set(
    'shirt',
    spec.keys.torso.map((k, i) => ({
      part: torsoParts[i] as LoadedPart,
      color: clusters(spec.torsoRegions[k] ?? [REGION.shirt]),
    })),
  );
  const legs = part(outfit, spec.keys.legs);
  pieces.set('legs', [{ part: legs, color: solid(REGION.trousers) }]);
  pieces.set('boots', [
    { part: part(outfit, spec.keys.boots), color: clusters([REGION.leather, REGION.boots]) },
  ]);

  // Jacket: the shirt and the hips under it, pushed out; it replaces the shirt when worn.
  const hipY = spec.id === 'male' ? 0.8 : 0.82;
  const hips = filterTriangles(legs.geo, (a, b, c) =>
    [a, b, c].every((v) => (legs.geo.pos[v * 3 + 1] ?? 0) > hipY),
  );
  // Sleeves to the wrist: the forearm skin the shirt leaves bare goes under the jacket.
  const arms = spec.id === 'male' ? handsPart.geo : handsPart.geo;
  const lowerArms = jointSet(skin, ['lowerarm_l', 'lowerarm_r', 'upperarm_l', 'upperarm_r']);
  const forearms = filterTriangles(arms, (a, b, c) =>
    [a, b, c].every(
      (v) => weightOn(arms, v, lowerArms) > 0.5 && weightOn(arms, v, handJoints) < 0.3,
    ),
  );
  const jacket = shell(merge([...torsoParts.map((p) => p.geo), hips, forearms]), 0.012);
  pieces.set('jacket', [
    { part: { geo: jacket, image: null }, color: (p) => solidRegion(p.geo, REGION.coat) },
  ]);

  // Hair and beards: modelled on the male head.
  for (const [name, file] of Object.entries(spec.hair) as [PieceName, string][]) {
    const loaded = [...(await loadParts(file, skin)).values()][0];
    if (!loaded) throw new Error(`empty ${file}`);
    let geo = loaded.geo;
    if (spec.hairFit) {
      const headIndex = skin.joints.indexOf('Head');
      const headPos = new THREE.Vector3().setFromMatrixPosition(
        new THREE.Matrix4().copy(skin.inverseBind[headIndex] ?? new THREE.Matrix4()).invert(),
      );
      geo = translate(
        geo,
        0,
        spec.hairFit.dy,
        spec.hairFit.dz,
        spec.hairFit.scale,
        headPos.y - spec.hairFit.dy,
      );
    }
    pieces.set(name, [{ part: { geo, image: loaded.image }, color: solid(REGION.hair) }]);
  }
  return pieces;
}

/** A piece at one LOD: each component simplified to its share, then colored and merged. */
async function pieceAtLod(
  components: readonly Component[],
  target: number,
  lod: number,
): Promise<SkinnedGeo> {
  const fixedTotal = components.reduce((s, c) => s + (c.fixed?.[lod] ?? 0), 0);
  const freeTotal = components.reduce((s, c) => s + (c.fixed ? 0 : triangleCount(c.part.geo)), 0);
  const out: SkinnedGeo[] = [];
  for (const c of components) {
    const share = c.fixed
      ? (c.fixed[lod] ?? 0)
      : Math.max(0, target - fixedTotal) * (triangleCount(c.part.geo) / Math.max(1, freeTotal));
    const geo = await simplifyTo(c.part.geo, share);
    if (triangleCount(geo) > 0) out.push(c.color({ geo, image: c.part.image }));
  }
  return merge(out);
}

// ---------------------------------------------------------------------------------------
// Animation

interface SourceClip {
  name: string;
  duration: number;
  rotations: Map<string, { times: Float32Array; values: Float32Array }>;
  translations: Map<string, { times: Float32Array; values: Float32Array }>;
}

function readRig(skin: Skin): { rig: RestJoint[]; above: THREE.Quaternion } {
  const joints = skin.listJoints();
  const rig = joints.map((j) => ({
    name: j.getName(),
    parent: joints.indexOf(j.getParentNode() as GltfNode),
    translation: new THREE.Vector3().fromArray(j.getTranslation()),
    rotation: new THREE.Quaternion().fromArray(j.getRotation()),
  }));
  // World rotation above the top joint (the Armature node's chain).
  const above = new THREE.Quaternion();
  let node = joints[0]?.getParentNode() ?? null;
  const chain: THREE.Quaternion[] = [];
  while (node) {
    chain.unshift(new THREE.Quaternion().fromArray(node.getRotation()));
    node = node.getParentNode();
  }
  for (const q of chain) above.multiply(q);
  return { rig, above };
}

function readClips(anim: Animation[]): Map<string, SourceClip> {
  const out = new Map<string, SourceClip>();
  for (const a of anim) {
    const clip: SourceClip = {
      name: a.getName(),
      duration: 0,
      rotations: new Map(),
      translations: new Map(),
    };
    for (const channel of a.listChannels()) {
      const sampler = channel.getSampler();
      const node = channel.getTargetNode();
      if (!sampler || !node) continue;
      const input = sampler.getInput()?.getArray();
      const output = sampler.getOutput()?.getArray();
      if (!input || !output) continue;
      const track = { times: Float32Array.from(input), values: Float32Array.from(output) };
      clip.duration = Math.max(clip.duration, track.times[track.times.length - 1] ?? 0);
      if (channel.getTargetPath() === 'rotation') clip.rotations.set(node.getName(), track);
      if (channel.getTargetPath() === 'translation') clip.translations.set(node.getName(), track);
    }
    out.set(clip.name, clip);
  }
  return out;
}

function sampleTrack(
  track: { times: Float32Array; values: Float32Array },
  size: number,
  t: number,
): number[] {
  const { times, values } = track;
  let i = 0;
  while (i < times.length - 1 && (times[i + 1] ?? 0) <= t) i++;
  const j = Math.min(i + 1, times.length - 1);
  const t0 = times[i] ?? 0;
  const t1 = times[j] ?? 0;
  const f = t1 > t0 ? THREE.MathUtils.clamp((t - t0) / (t1 - t0), 0, 1) : 0;
  const a = Array.from(values.subarray(i * size, i * size + size));
  const b = Array.from(values.subarray(j * size, j * size + size));
  if (size === 4) {
    const qa = new THREE.Quaternion().fromArray(a);
    return qa.slerp(new THREE.Quaternion().fromArray(b), f).toArray();
  }
  return a.map((v, k) => v + ((b[k] ?? v) - v) * f);
}

interface BakedClip {
  name: string;
  times: Float32Array;
  rotations: Map<string, Float32Array>;
  pelvis: Float32Array;
}

function retargetClip(
  clip: SourceClip,
  source: { rig: RestJoint[]; above: THREE.Quaternion },
  target: { rig: RestJoint[]; above: THREE.Quaternion },
  rename: string,
): BakedClip {
  const sourceRest = restWorldRotations(source.rig, source.above);
  const targetRest = restWorldRotations(target.rig, target.above);
  const frames = Math.max(2, Math.round(clip.duration * FPS) + 1);
  const times = Float32Array.from({ length: frames }, (_, f) => Math.min(clip.duration, f / FPS));
  const rotations = new Map<string, Float32Array>(
    target.rig.map((j) => [j.name, new Float32Array(frames * 4)]),
  );
  const pelvis = new Float32Array(frames * 3);
  const sourcePelvis = source.rig.find((j) => j.name === 'pelvis');
  const targetPelvis = target.rig.find((j) => j.name === 'pelvis');
  if (!sourcePelvis || !targetPelvis) throw new Error('rig without a pelvis');
  // Hips move by the same share of leg length.
  const legRatio = targetPelvis.translation.length() / sourcePelvis.translation.length();
  const pelvisTrack = clip.translations.get('pelvis');
  for (let f = 0; f < frames; f++) {
    const t = times[f] ?? 0;
    const frame = new Map<string, THREE.Quaternion>();
    for (const [name, track] of clip.rotations)
      frame.set(name, new THREE.Quaternion().fromArray(sampleTrack(track, 4, t)));
    const local = retargetFrame(
      source.rig,
      sourceRest,
      target.rig,
      targetRest,
      target.above,
      frame,
    );
    for (const [name, q] of local) {
      const out = rotations.get(name);
      // Keep quaternions in one hemisphere so interpolation takes the short way.
      if (out && f > 0) {
        const prev = new THREE.Quaternion().fromArray(out, (f - 1) * 4);
        if (prev.dot(q) < 0) q.set(-q.x, -q.y, -q.z, -q.w);
      }
      out?.set(q.toArray(), f * 4);
    }
    const p = pelvisTrack
      ? new THREE.Vector3().fromArray(sampleTrack(pelvisTrack, 3, t))
      : sourcePelvis.translation.clone();
    p.sub(sourcePelvis.translation).multiplyScalar(legRatio).add(targetPelvis.translation);
    pelvis.set(p.toArray(), f * 3);
  }
  return { name: rename, times, rotations, pelvis };
}

// ---------------------------------------------------------------------------------------
// Writing

async function writeBody(
  spec: BodySpec,
  outfitDoc: Document,
  pieces: Map<PieceName, Component[]>,
  clips: BakedClip[],
): Promise<{ file: string; bytes: number; triangles: Record<string, number[]> }> {
  const sourceSkin = outfitDoc.getRoot().listSkins()[0];
  if (!sourceSkin) throw new Error('outfit without a skin');
  const doc = new Document();
  const buffer = doc.createBuffer();
  const scene = doc.createScene(spec.id);

  // Copy the armature and joints.
  const map = new Map<GltfNode, GltfNode>();
  const copyNode = (src: GltfNode): GltfNode => {
    const dst = doc
      .createNode(src.getName())
      .setTranslation(src.getTranslation())
      .setRotation(src.getRotation())
      .setScale(src.getScale());
    map.set(src, dst);
    for (const child of src.listChildren()) if (!child.getMesh()) dst.addChild(copyNode(child));
    return dst;
  };
  const sourceJoints = sourceSkin.listJoints();
  let top: GltfNode = sourceJoints[0] as GltfNode;
  while (top.getParentNode()) top = top.getParentNode() as GltfNode;
  const armature = copyNode(top);
  armature.setName('Armature');
  scene.addChild(armature);
  const joints = sourceJoints.map((j) => {
    const copy = map.get(j);
    if (!copy) throw new Error(`joint ${j.getName()} not under the armature`);
    return copy;
  });
  const ibmSource = sourceSkin.getInverseBindMatrices();
  if (!ibmSource) throw new Error('skin without inverse bind matrices');
  const ibm = doc
    .createAccessor()
    .setType('MAT4')
    .setArray(Float32Array.from(ibmSource.getArray() ?? []))
    .setBuffer(buffer);
  const skin = doc
    .createSkin('body')
    .setInverseBindMatrices(ibm)
    .setSkeleton(joints[0] as GltfNode);
  for (const j of joints) skin.addJoint(j);

  const triangles: Record<string, number[]> = {};
  const material = doc.createMaterial('character').setBaseColorFactor([1, 1, 1, 1]);
  for (const name of PIECE_NAMES) {
    const components = pieces.get(name);
    if (!components) continue;
    triangles[name] = [];
    for (let lod = 0; lod < LOD_COUNT; lod++) {
      const target = LOD_TRIANGLES[name][lod] ?? 0;
      // Small detail drops out at the far LOD: eyes and brows are part of the head.
      const geo = await pieceAtLod(components, target, lod);
      triangles[name].push(triangleCount(geo));
      if (triangleCount(geo) === 0) continue;
      const acc = (
        type: 'VEC2' | 'VEC3' | 'VEC4' | 'SCALAR',
        array: Float32Array | Uint8Array | Uint16Array,
      ) => doc.createAccessor().setType(type).setArray(array).setBuffer(buffer);
      const prim = doc
        .createPrimitive()
        .setMaterial(material)
        .setIndices(acc('SCALAR', Uint16Array.from(geo.index)))
        .setAttribute('POSITION', acc('VEC3', geo.pos))
        .setAttribute('NORMAL', acc('VEC3', geo.nrm))
        .setAttribute('JOINTS_0', acc('VEC4', Uint8Array.from(geo.joints)))
        .setAttribute('WEIGHTS_0', acc('VEC4', geo.weights))
        .setAttribute('_LOOK', acc('VEC2', geo.look ?? new Float32Array((geo.pos.length / 3) * 2)));
      const mesh = doc.createMesh(`${name}.lod${lod}`).addPrimitive(prim);
      const node = doc.createNode(`${name}.lod${lod}`).setMesh(mesh).setSkin(skin);
      scene.addChild(node);
    }
  }

  // Clips: rotations for every joint that moves, and the pelvis translation.
  const byName = new Map(joints.map((j) => [j.getName(), j]));
  for (const clip of clips) {
    const anim = doc.createAnimation(clip.name);
    const input = doc.createAccessor().setType('SCALAR').setArray(clip.times).setBuffer(buffer);
    for (const [name, values] of clip.rotations) {
      const node = byName.get(name);
      if (!node) continue;
      const sampler = doc
        .createAnimationSampler()
        .setInput(input)
        .setOutput(doc.createAccessor().setType('VEC4').setArray(values).setBuffer(buffer))
        .setInterpolation('LINEAR');
      anim
        .addSampler(sampler)
        .addChannel(
          doc
            .createAnimationChannel()
            .setTargetNode(node)
            .setTargetPath('rotation')
            .setSampler(sampler),
        );
    }
    const pelvis = byName.get('pelvis');
    if (pelvis) {
      const sampler = doc
        .createAnimationSampler()
        .setInput(input)
        .setOutput(doc.createAccessor().setType('VEC3').setArray(clip.pelvis).setBuffer(buffer))
        .setInterpolation('LINEAR');
      anim
        .addSampler(sampler)
        .addChannel(
          doc
            .createAnimationChannel()
            .setTargetNode(pelvis)
            .setTargetPath('translation')
            .setSampler(sampler),
        );
    }
  }

  await MeshoptEncoder.ready;
  await doc.transform(
    resample({ tolerance: 2e-4 }),
    dedup(),
    prune({ keepLeaves: true }),
    reorder({ encoder: MeshoptEncoder, target: 'size' }),
    // Positions stay float: quantizing them moves the dequantize transform into the
    // skin's bind matrices, and the game merges pieces and code-built hats on one skin.
    quantize({
      pattern: /^(NORMAL|JOINTS_0|WEIGHTS_0|_LOOK)$/,
      quantizeNormal: 10,
      quantizeWeight: 8,
    }),
  );
  doc
    .createExtension(EXTMeshoptCompression)
    .setRequired(true)
    .setEncoderOptions({ method: EXTMeshoptCompression.EncoderMethod.QUANTIZE });
  mkdirSync(OUT, { recursive: true });
  const file = join(OUT, `${spec.id}.glb`);
  await io.write(file, doc);
  return { file, bytes: statSync(file).size, triangles };
}

async function main(): Promise<void> {
  const anims = [
    await io.read(join(RAW, 'anim-ual1.glb')),
    await io.read(join(RAW, 'anim-ual2.glb')),
  ];
  const animSkin = anims[0]?.getRoot().listSkins()[0];
  if (!animSkin) throw new Error('animation library without a skin');
  const sourceRig = readRig(animSkin);
  const sourceClips = new Map<string, SourceClip>();
  for (const doc of anims)
    for (const [k, v] of readClips(doc.getRoot().listAnimations())) sourceClips.set(k, v);

  const report: Record<string, unknown> = {};
  for (const spec of BODIES) {
    const outfitDoc = await io.read(join(RAW, spec.outfit));
    const outfitSkin = outfitDoc.getRoot().listSkins()[0];
    if (!outfitSkin) throw new Error(`${spec.outfit} without a skin`);
    const skin = readSkin(outfitSkin);
    const pieces = await buildPieces(spec, skin);
    const targetRig = readRig(outfitSkin);
    const clips = Object.entries(CLIPS).map(([name, source]) => {
      const clip = sourceClips.get(source);
      if (!clip) throw new Error(`no clip ${source} in the animation libraries`);
      return retargetClip(clip, sourceRig, targetRig, name);
    });
    const result = await writeBody(spec, outfitDoc, pieces, clips);
    report[spec.id] = { bytes: result.bytes, triangles: result.triangles, clips: clips.length };
    console.log(`${spec.id}: ${(result.bytes / 1024).toFixed(0)} KB, ${clips.length} clips`);
    for (const [piece, counts] of Object.entries(result.triangles))
      console.log(`  ${piece.padEnd(13)} ${counts.join(' / ')}`);
  }
  // What was built, for review: sizes and triangles per piece and LOD.
  writeFileSync(join(RAW, '..', 'build-report.json'), `${JSON.stringify(report, null, 2)}\n`);

  // Provenance next to each GLB (plan 14 §6) and the manifest entries.
  const raw = provenanceSchema.parse(
    JSON.parse(readFileSync(join(RAW, 'provenance.json'), 'utf8')),
  );
  const manifestPath = join(ROOT, 'public', 'assets', 'manifest.json');
  let manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as ManifestLike;
  for (const spec of BODIES) {
    writeFileSync(
      join(OUT, `${spec.id}.provenance.json`),
      `${JSON.stringify(shippedProvenance(raw, PIPELINE_STEPS), null, 2)}\n`,
    );
    const bytes = statSync(join(OUT, `${spec.id}.glb`)).size;
    manifest = withManifestEntry(
      manifest,
      assetHintsSchema.parse({
        id: `character.${spec.id}`,
        category: 'characters',
        name: spec.id,
        source: spec.outfit,
        lengthM: 1.8,
        draftM: 1,
        maxTriangles: 5000,
        bundles: ['on-foot'],
      }),
      bytes,
    );
  }
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
}

await main();
