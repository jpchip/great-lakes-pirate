import { readFileSync } from 'node:fs';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptDecoder } from 'meshoptimizer';
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import portraitsJson from '../data/portraits.json';
import { portraitsFileSchema } from '../data/schemas/backgrounds';
import { beardGeometry, hatGeometry, propGeometry } from '../src/render/characters/accessories';
import { gaitClip } from '../src/render/characters/gait';
import {
  BODY_IDS,
  CLIPS,
  LOD_COUNT,
  LOOPING_CLIPS,
  PIECE_NAMES,
} from '../src/render/characters/humanoid-spec';
import { animationStride, lodForDistance } from '../src/render/characters/humanoid';
import {
  lookFromPortrait,
  lookPalette,
  lookPieces,
  lookShapeKey,
  NPC_ROLES,
  npcLook,
  type HatStyle,
} from '../src/render/characters/looks';
import { REGION, REGION_COUNT } from '../src/render/characters/regions';
import {
  restWorldRotations,
  retargetFrame,
  shell,
  type RestJoint,
} from '../tools/assets/lib/humanoid';

const portraits = portraitsFileSchema.parse(portraitsJson);

describe('looks (plan 08 §20 piece B)', () => {
  it('dresses every portrait preset, women in the female body', () => {
    for (const p of portraits) {
      const look = lookFromPortrait(p);
      expect(look.body).toBe(p.id.includes('woman') ? 'female' : 'male');
      expect(look.jacket).toBe(true);
      const pieces = lookPieces(look);
      expect(pieces).toContain('head');
      expect(pieces).toContain('jacket');
      expect(pieces).not.toContain('shirt');
      if (look.body === 'female') expect(pieces).not.toContain('beard.full');
      expect(lookPalette(look)).toHaveLength(REGION_COUNT);
      expect(lookPalette(look)[REGION.coat]).toBe(Number.parseInt(p.coat.slice(1), 16));
      expect(lookPalette(look)[REGION.skin]).toBe(Number.parseInt(p.skin.slice(1), 16));
    }
  });

  it('gives each NPC role its silhouette, varied by seed but repeatable', () => {
    for (const role of NPC_ROLES) {
      expect(npcLook(role, 7)).toEqual(npcLook(role, 7));
      const pieces = lookPieces(npcLook(role, 7));
      for (const piece of pieces) expect(PIECE_NAMES).toContain(piece);
    }
    expect(npcLook('watchman', 1).held).toBe('lantern');
    expect(npcLook('constable', 1).hat).toBe('helmet');
    expect(npcLook('marshal', 1).held).toBe('rifle');
    expect(npcLook('townswoman', 1).body).toBe('female');
    const faces = new Set(Array.from({ length: 12 }, (_, i) => lookShapeKey(npcLook('sailor', i))));
    expect(faces.size).toBeGreaterThan(1);
  });

  it('crops parted hair under close hats so it cannot poke through', () => {
    const look = { ...npcLook('constable', 2), hair: 'short' as const };
    expect(lookPieces(look)).toContain('hair.cropped');
  });
});

describe('gait to clip', () => {
  it('maps every controller gait and keeps the feet at the controller speed', () => {
    expect(gaitClip({ gait: 'idle', speed: 0 }).clip).toBe('idle');
    expect(gaitClip({ gait: 'idle', speed: 0, lantern: true }).clip).toBe('lanternIdle');
    expect(gaitClip({ gait: 'walk', speed: 1.6 })).toEqual({ clip: 'walk', timeScale: 1 });
    expect(gaitClip({ gait: 'walk', speed: 2.4 }).timeScale).toBeCloseTo(1.5);
    expect(gaitClip({ gait: 'run', speed: 5.2 }).clip).toBe('sprint');
    expect(gaitClip({ gait: 'run', speed: 3.5 }).clip).toBe('run');
    expect(gaitClip({ gait: 'sneak', speed: 1.3 }).clip).toBe('sneak');
    expect(gaitClip({ gait: 'sneak', speed: 0 }).clip).toBe('sneakIdle');
    expect(gaitClip({ gait: 'walk', speed: 1.3, carrying: true }).clip).toBe('carry');
    expect(gaitClip({ gait: 'swim', speed: 0 }).clip).toBe('swimIdle');
    expect(gaitClip({ gait: 'fall', speed: 3 }).clip).toBe('fall');
    for (const gait of ['idle', 'sneak', 'walk', 'run', 'swim', 'fall', 'slide'] as const) {
      expect(Object.keys(CLIPS)).toContain(gaitClip({ gait, speed: 1 }).clip);
    }
  });

  it('drops LOD and animation rate with distance (plan 08 §14)', () => {
    expect(lodForDistance(5)).toBe(0);
    expect(lodForDistance(20)).toBe(1);
    expect(lodForDistance(60)).toBe(2);
    expect(animationStride(5)).toBe(1);
    expect(animationStride(30)).toBe(2);
    expect(animationStride(80)).toBe(4);
  });
});

describe('retarget (tools/assets/lib/humanoid.ts)', () => {
  const q = (x: number, y: number, z: number) =>
    new THREE.Quaternion().setFromEuler(new THREE.Euler(x, y, z));
  const rig = (spine: THREE.Quaternion): RestJoint[] => [
    {
      name: 'root',
      parent: -1,
      translation: new THREE.Vector3(),
      rotation: new THREE.Quaternion(),
    },
    { name: 'spine', parent: 0, translation: new THREE.Vector3(0, 1, 0), rotation: spine },
    { name: 'head', parent: 1, translation: new THREE.Vector3(0, 0.5, 0), rotation: q(0.1, 0, 0) },
  ];
  const above = new THREE.Quaternion();

  it('is the identity between identical rigs', () => {
    const a = rig(q(0.2, 0, 0));
    const rest = restWorldRotations(a, above);
    const frame = new Map([
      ['spine', q(0.5, 0.3, 0)],
      ['head', q(-0.2, 0, 0.1)],
    ]);
    const out = retargetFrame(a, rest, a, rest, above, frame);
    for (const [name, rot] of frame) expect(out.get(name)?.angleTo(rot)).toBeLessThan(1e-5);
  });

  it('turns each joint away from its own rest pose by the source joint’s world turn', () => {
    const source = rig(q(0.2, 0, 0));
    const target = rig(q(0.5, 0, 0)); // a more hunched rest posture
    const sr = restWorldRotations(source, above);
    const tr = restWorldRotations(target, above);
    // At rest, the target stays at its own rest.
    const atRest = retargetFrame(source, sr, target, tr, above, new Map());
    expect(atRest.get('spine')?.angleTo(target[1]?.rotation ?? above)).toBeLessThan(1e-5);
    // A 0.4 rad bend of the source spine bends the target spine 0.4 rad too.
    const bend = retargetFrame(source, sr, target, tr, above, new Map([['spine', q(0.6, 0, 0)]]));
    expect(bend.get('spine')?.angleTo(q(0.9, 0, 0))).toBeLessThan(1e-5);
    // The head keeps its rest relation to the spine.
    expect(bend.get('head')?.angleTo(q(0.1, 0, 0))).toBeLessThan(1e-5);
  });

  it('pushes a shell out along welded normals without cracks', () => {
    const box = new THREE.BoxGeometry(1, 1, 1);
    const pos = Float32Array.from(box.getAttribute('position').array);
    const geo = {
      pos,
      nrm: Float32Array.from(box.getAttribute('normal').array),
      uv: new Float32Array(0),
      joints: new Uint16Array((pos.length / 3) * 4),
      weights: new Float32Array((pos.length / 3) * 4),
      index: Uint32Array.from(box.getIndex()?.array ?? []),
    };
    const out = shell(geo, 0.1);
    // Corners shared by three faces move together along the diagonal.
    const corners = new Map<string, string>();
    for (let i = 0; i < pos.length / 3; i++) {
      const key = [pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]].join(',');
      const moved = [0, 1, 2].map((k) => (out.pos[i * 3 + k] ?? 0).toFixed(5)).join(',');
      expect(corners.get(key) ?? moved).toBe(moved);
      corners.set(key, moved);
    }
  });
});

describe('accessories', () => {
  const head = { top: 1.81, centerZ: 0.01, radius: 0.08, eyeY: 1.7, frontZ: 0.12 };
  it('builds every hat on the head joint, small enough for the budget', () => {
    const hats: HatStyle[] = [
      'cap',
      'peaked',
      'bowler',
      'souwester',
      'wool',
      'bonnet',
      'helmet',
      'slouch',
    ];
    for (const hat of hats) {
      const g = hatGeometry(hat, head, 6);
      expect(g, hat).not.toBeNull();
      if (!g) continue;
      expect((g.getIndex()?.count ?? 0) / 3, hat).toBeLessThan(500);
      expect(g.getAttribute('skinIndex').getX(0)).toBe(6);
      expect(g.getAttribute('skinWeight').getX(0)).toBe(1);
      g.computeBoundingBox();
      // Sits on the head, not floating above or swallowing it.
      expect(g.boundingBox?.min.y ?? 0, hat).toBeGreaterThan(head.top - 0.16);
      expect(g.boundingBox?.min.y ?? 0, hat).toBeLessThan(head.top);
    }
    expect(hatGeometry('none', head, 6)).toBeNull();
    expect(beardGeometry('mustache', head, 6)).not.toBeNull();
    expect(beardGeometry('full', head, 6)).toBeNull();
  });

  it('builds the carried props on their joints', () => {
    const frame = (index: number) => ({
      index,
      position: new THREE.Vector3(0, 1.2, 0),
      along: new THREE.Vector3(-1, 0, 0),
    });
    const lantern = propGeometry('lantern', frame(30), frame(1), frame(4));
    expect(lantern?.getAttribute('skinIndex').getX(0)).toBe(30);
    const looks = lantern?.getAttribute('_look');
    const glass = Array.from({ length: looks?.count ?? 0 }, (_, i) => looks?.getX(i)).filter(
      (r) => r === REGION.lampGlass,
    );
    expect(glass.length).toBeGreaterThan(0);
    expect(
      propGeometry('rifle', frame(30), frame(1), frame(4))?.getAttribute('skinIndex').getX(0),
    ).toBe(4);
    expect(propGeometry('none', frame(30), frame(1), frame(4))).toBeNull();
  });
});

describe('the body GLBs (public/assets/characters/)', async () => {
  await MeshoptDecoder.ready;
  const io = new NodeIO()
    .registerExtensions(ALL_EXTENSIONS)
    .registerDependencies({ 'meshopt.decoder': MeshoptDecoder });
  const docs = await Promise.all(
    BODY_IDS.map(
      async (id) =>
        [
          id,
          await io.readBinary(new Uint8Array(readFileSync(`public/assets/characters/${id}.glb`))),
        ] as const,
    ),
  );
  const triangles = (doc: (typeof docs)[number][1], name: string): number => {
    const mesh = doc
      .getRoot()
      .listMeshes()
      .find((m) => m.getName() === name);
    return (mesh?.listPrimitives()[0]?.getIndices()?.getCount() ?? 0) / 3;
  };

  it('holds one 65-joint skeleton, every piece at every LOD, and every clip', () => {
    for (const [id, doc] of docs) {
      const skins = doc.getRoot().listSkins();
      expect(skins, id).toHaveLength(1);
      expect(skins[0]?.listJoints()).toHaveLength(65);
      const names = doc
        .getRoot()
        .listAnimations()
        .map((a) => a.getName());
      for (const clip of Object.keys(CLIPS)) expect(names, `${id} ${clip}`).toContain(clip);
      for (const piece of ['head', 'hands', 'shirt', 'jacket', 'legs', 'boots', 'hair.short']) {
        for (let lod = 0; lod < LOD_COUNT; lod++)
          expect(triangles(doc, `${piece}.lod${lod}`), `${id} ${piece}.lod${lod}`).toBeGreaterThan(
            0,
          );
      }
      for (const prim of doc
        .getRoot()
        .listMeshes()
        .flatMap((m) => m.listPrimitives())) {
        expect(prim.getAttribute('_LOOK')).not.toBeNull();
        expect(prim.getAttribute('JOINTS_0')).not.toBeNull();
      }
    }
    expect(LOOPING_CLIPS.has('walk')).toBe(true);
    expect(LOOPING_CLIPS.has('knockedDown')).toBe(false);
  });

  it('keeps the heaviest dressed look inside plan 14 §8 (5k / 1.5k / 500, hat aside)', () => {
    const budgets = [5000, 1500, 500];
    for (const [id, doc] of docs) {
      const hair = id === 'male' ? ['hair.long', 'beard.full'] : ['hair.buns'];
      for (let lod = 0; lod < LOD_COUNT; lod++) {
        const total = ['head', 'hands', 'jacket', 'legs', 'boots', ...hair].reduce(
          (sum, piece) => sum + triangles(doc, `${piece}.lod${lod}`),
          0,
        );
        expect(total, `${id} lod${lod}`).toBeLessThanOrEqual(budgets[lod] ?? 0);
      }
    }
  });
});
