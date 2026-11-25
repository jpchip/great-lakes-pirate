import * as THREE from 'three';
import type { FigureClip } from '../characters/figure-clips';
import { Character, loadHumanoids, type HumanoidLibrary } from '../characters/humanoid';
import { npcLook, npcRoleFor, type Look } from '../characters/looks';
import type { OutlineSettings } from '../style/outline';
import type { LampPoolUniforms, StyleLighting } from '../style/stylized-material';

/**
 * The people ashore on piece B's humanoid (plan 08 §20): the captain and every NPC the
 * foot view draws, one skinned mesh and its ink each. The bodies load the first time you
 * step ashore; until they're in (or if they fail to load) the foot view keeps its capsule
 * stand-ins. NPCs are kept by id, so a constable keeps his face as he walks his beat.
 */

/** A lantern's glass by night, as the capsule watchman's lamp was. */
const LANTERN_GLOW = new THREE.Color(0xffc46b);
const NO_GLOW = new THREE.Color(0, 0, 0);

export interface FigurePose {
  x: number;
  y: number;
  z: number;
  /** Clockwise from north, radians. */
  heading: number;
  clip: FigureClip;
  /** Bumped to play the same one-shot again (a second blow). */
  restart?: number | undefined;
  /** Lantern glass lit. */
  glow?: boolean;
}

interface Npc {
  character: Character;
  seen: boolean;
  type: string;
  glow: boolean;
}

export interface Figures {
  readonly group: THREE.Group;
  /** The bodies are loaded: draw people, not capsules. */
  readonly ready: boolean;
  /** Starts loading the bodies (once). */
  load(): void;
  /** The captain in a look, or undefined until the bodies are in. */
  captain(look: Look): Character | undefined;
  /** Starts a frame: every NPC not posed in it is hidden at `end`. */
  begin(): void;
  /** Places an NPC by id, made the first time it's seen. */
  npc(id: string, type: string, pose: FigurePose): void;
  /** Ends a frame: hides the NPCs not posed and runs everyone's animation. */
  end(dt: number, camera: THREE.Vector3): void;
  dispose(): void;
}

export function pose(
  character: Character,
  p: FigurePose,
  last: { restart?: number | undefined },
): void {
  character.root.position.set(p.x, p.y, p.z);
  character.root.rotation.set(0, -p.heading, 0);
  const restart = p.restart !== undefined && p.restart !== last.restart;
  last.restart = p.restart;
  character.play(p.clip.clip, 0.2, p.clip.timeScale, p.clip.loop ?? false, restart);
  character.setGlow(p.glow ? LANTERN_GLOW : NO_GLOW);
}

export function createFigures(options: {
  lighting: StyleLighting;
  outline: OutlineSettings;
  pools: LampPoolUniforms;
  baseUrl?: () => string;
}): Figures {
  const group = new THREE.Group();
  group.name = 'figures';
  let library: HumanoidLibrary | undefined;
  let loading = false;
  let you: Character | undefined;
  const npcs = new Map<string, Npc & { last: { restart?: number | undefined } }>();
  const make = (look: Look): Character => {
    if (!library) throw new Error('bodies not loaded');
    return new Character(library, look, {
      style: 'toon',
      lighting: options.lighting,
      outline: options.outline,
      pools: options.pools,
    });
  };

  return {
    group,
    get ready() {
      return !!library;
    },
    load() {
      if (loading) return;
      loading = true;
      const base = options.baseUrl?.() ?? new URL('./', document.baseURI).href;
      loadHumanoids(base, ['male', 'female']).then(
        (lib) => {
          library = lib;
        },
        (err: unknown) => {
          // The capsules stay: the game is playable without the bodies.
          console.warn('[figures] the character bodies did not load', err);
        },
      );
    },
    captain(look) {
      if (!library) return undefined;
      if (you && you.lookValue.body !== look.body) {
        you.dispose();
        you = undefined;
      }
      if (!you) {
        you = make(look);
        you.root.name = 'captain-body';
        group.add(you.root);
      } else if (you.lookValue !== look) {
        you.setLook(look);
      }
      return you;
    },
    begin() {
      for (const n of npcs.values()) n.seen = false;
    },
    npc(id, type, p) {
      if (!library) return;
      let n = npcs.get(id);
      if (n && n.type !== type) {
        n.character.dispose();
        npcs.delete(id);
        n = undefined;
      }
      if (!n) {
        const character = make(npcLook(npcRoleFor(type, id), id));
        character.root.name = `npc:${id}`;
        group.add(character.root);
        n = { character, seen: true, type, glow: false, last: {} };
        npcs.set(id, n);
      }
      n.seen = true;
      n.glow = !!p.glow;
      n.character.root.visible = true;
      pose(n.character, p, n.last);
    },
    end(dt, camera) {
      const near: { n: Npc; d: number }[] = [];
      const key = options.lighting.uniforms.uKeyColor.value;
      const dark = 0.2126 * key.r + 0.7152 * key.g + 0.0722 * key.b < DARK_KEY;
      for (const n of npcs.values()) {
        const d = camera.distanceTo(n.character.root.position);
        // After dark a far figure without a lit lantern is black on black: not drawn, so
        // a tier 5 watch stays inside the frame's calls. A lit lantern always shows.
        if (!n.seen || (dark && !n.glow && d > FAR_IN_THE_DARK_M)) {
          n.character.root.visible = false;
          continue;
        }
        near.push({ n, d });
      }
      // Ink costs a draw call a figure: only the nearest few keep it (the on-foot frame's
      // 150 calls, plan 01 §5), the rest are a flat silhouette that far off anyway.
      near.sort((a, b) => a.d - b.d);
      near.forEach(({ n, d }, k) => n.character.update(dt, d, k < INKED_NPCS));
      if (you?.root.visible) {
        you.update(dt, camera.distanceTo(you.root.getWorldPosition(scratch)));
      }
    },
    dispose() {
      for (const n of npcs.values()) n.character.dispose();
      npcs.clear();
      you?.dispose();
      library?.dispose();
    },
  };
}

const scratch = new THREE.Vector3();

/** NPCs drawn with their ink outline, nearest first. */
export const INKED_NPCS = 4;

/** After dark (the key light under this luminance), unlit NPCs past this aren't drawn, m. */
export const FAR_IN_THE_DARK_M = 90;
const DARK_KEY = 0.15;
