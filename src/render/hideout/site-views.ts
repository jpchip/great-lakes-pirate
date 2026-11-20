import * as THREE from 'three';
import type { PlacedRender } from '../../sim/hideouts/placed';
import type { SiteFrame } from '../../sim/hideouts/site-frame';
import { curioSlots } from '../../sim/discovery/discovery';
import {
  createStylizedMaterial,
  type LampPoolUniforms,
  type StyleLighting,
} from '../style/stylized-material';
import { curiosGeometry } from './curios';
import { createHideoutView, type HideoutPieceInput, type HideoutView } from './hideout-view';

/**
 * The hideouts in the loaded zone, drawn where they stand (plan 09 §10; Phase 8 piece C):
 * each site's pieces in piece B's instanced view, turned and set down on the zone by its
 * frame, with the ghosts waiting for a work session drawn see-through over them. In build
 * mode an overlay adds the bounds, the grid on the level being edited, the ghost under
 * the cursor (green, or red with its reason) and what deconstructing would take (red).
 */

/** One site as the game hands it over: its frame and its pieces (built and planned). */
export interface SiteDraw {
  key: string;
  frame: SiteFrame;
  pieces: readonly PlacedRender[];
  /**
   * The curios set out here (Phase 9 piece P), in the order they fill the shelves, tables
   * and sea chests; any past the places there are aren't drawn.
   */
  curios?: readonly string[];
}

/** Build mode's overlay on one site. */
export interface BuildOverlay {
  key: string;
  /**
   * The level being edited: the grid is drawn on its floor. (The game cuts away the levels
   * above it by leaving them out of the site's pieces, plan 09 §9.)
   */
  level: number;
  grid: boolean;
  /** The pieces under the cursor, each green when it can go and red when it can't. */
  ghosts: readonly { piece: PlacedRender; ok: boolean }[];
  /** Pieces deconstructing would take, drawn red over themselves. */
  marked: readonly PlacedRender[];
}

export interface HideoutSitesView {
  readonly group: THREE.Group;
  /** Brings the drawn sites in line with these (by key; unchanged pieces aren't touched). */
  sync(sites: readonly SiteDraw[]): void;
  setOverlay(overlay: BuildOverlay | undefined): void;
  /** Per frame: near or far, the glass at night, and the lamp pools if `lightPools`. */
  update(camera: THREE.Vector3, night: number, lightPools: boolean): void;
  /** For checks: pieces drawn per site, built and ghost. */
  counts(): Record<string, { built: number; ghosts: number }>;
  dispose(): void;
}

export const GHOST_OK = 0x5fe08a;
export const GHOST_BAD = 0xe0533f;
const PLANNED = 0x8fb8e8;
const LEVEL_M = 3;
const CELL_M = 2;
const UP = new THREE.Vector3(0, 1, 0);

function ghostMaterial(opacity: number, onTop: boolean): THREE.MeshBasicMaterial {
  return new THREE.MeshBasicMaterial({
    color: 0xffffff,
    transparent: true,
    opacity,
    depthWrite: false,
    depthTest: !onTop,
  });
}

const inputOf = (r: PlacedRender, paint?: number): HideoutPieceInput => {
  const out: HideoutPieceInput = { id: r.id, material: r.material, x: r.x, y: r.y, z: r.z };
  out.rot = r.rot;
  if (r.yawDeg !== undefined) out.yawDeg = r.yawDeg;
  if (r.riseM !== undefined) out.riseM = r.riseM;
  if (r.extendM !== undefined) out.extendM = r.extendM;
  const tint = paint ?? r.paint;
  if (tint !== undefined) out.paint = tint;
  return out;
};

interface Drawn {
  frame: SiteFrame;
  root: THREE.Group;
  built: HideoutView;
  planned: HideoutView;
  /** Piece key → what it was drawn from, to skip unchanged ones. */
  seen: Map<string, string>;
  /** The curios on display, and what they were drawn from. */
  curios?: THREE.Mesh | undefined;
  curiosSig: string;
}

export function createHideoutSitesView(
  lighting: StyleLighting,
  pools?: LampPoolUniforms,
): HideoutSitesView {
  const group = new THREE.Group();
  group.name = 'hideouts';
  const drawn = new Map<string, Drawn>();
  const plannedMat = ghostMaterial(0.38, false);
  const cursorMat = ghostMaterial(0.55, false);
  const markedMat = ghostMaterial(0.45, true);
  const curioMat = createStylizedMaterial('toon', lighting, { vertexColors: true });

  /** The curios on the site's display pieces, redrawn when they or the pieces change. */
  const drawCurios = (d: Drawn, s: SiteDraw): void => {
    const slots = curioSlots(s.pieces);
    const shown = (s.curios ?? []).slice(0, slots.length).flatMap((id, k) => {
      const slot = slots[k];
      return slot ? [{ id, slot }] : [];
    });
    const sig = JSON.stringify(shown);
    if (sig === d.curiosSig) return;
    d.curiosSig = sig;
    if (d.curios) {
      d.root.remove(d.curios);
      d.curios.geometry.dispose();
      d.curios = undefined;
    }
    const g = curiosGeometry(shown);
    if (!g) return;
    d.curios = new THREE.Mesh(g, curioMat);
    d.curios.name = 'hideout-curios';
    d.root.add(d.curios);
  };

  const placeRoot = (root: THREE.Object3D, f: SiteFrame): void => {
    root.matrixAutoUpdate = false;
    root.matrix.makeBasis(
      new THREE.Vector3(f.along.x, 0, f.along.z),
      UP,
      new THREE.Vector3(f.inland.x, 0, f.inland.z),
    );
    root.matrix.setPosition(f.origin.x, f.baseM, f.origin.z);
    root.updateMatrixWorld(true);
  };

  const make = (key: string, frame: SiteFrame): Drawn => {
    const root = new THREE.Group();
    root.name = `hideout:${key}`;
    const built = createHideoutView(lighting, pools ? { pools } : {});
    const planned = createHideoutView(lighting, { material: plannedMat });
    root.add(built.group, planned.group);
    placeRoot(root, frame);
    group.add(root);
    return { frame, root, built, planned, seen: new Map(), curiosSig: '' };
  };

  // The overlay: its own root, moved to whichever site is being built.
  const overlayRoot = new THREE.Group();
  overlayRoot.name = 'hideout:overlay';
  overlayRoot.visible = false;
  const cursor = createHideoutView(lighting, { material: cursorMat });
  const marked = createHideoutView(lighting, { material: markedMat });
  overlayRoot.add(cursor.group, marked.group);
  const gridMat = new THREE.LineBasicMaterial({
    color: 0xf2ead2,
    transparent: true,
    opacity: 0.35,
    depthWrite: false,
  });
  const boundsMat = new THREE.LineBasicMaterial({
    color: 0xf5c46a,
    transparent: true,
    opacity: 0.85,
    depthWrite: false,
  });
  let gridLines: THREE.LineSegments | undefined;
  let boundsLines: THREE.LineSegments | undefined;
  let gridFor = '';
  group.add(overlayRoot);

  const linesFor = (f: SiteFrame): void => {
    const key = `${f.cols}x${f.rows}`;
    if (gridFor === key) return;
    gridFor = key;
    gridLines?.geometry.dispose();
    boundsLines?.geometry.dispose();
    if (gridLines) overlayRoot.remove(gridLines);
    if (boundsLines) overlayRoot.remove(boundsLines);
    const w = f.cols * CELL_M;
    const d = f.rows * CELL_M;
    const g: number[] = [];
    for (let c = 1; c < f.cols; c++) g.push(c * CELL_M, 0, 0, c * CELL_M, 0, d);
    for (let r = 1; r < f.rows; r++) g.push(0, 0, r * CELL_M, w, 0, r * CELL_M);
    const gg = new THREE.BufferGeometry();
    gg.setAttribute('position', new THREE.Float32BufferAttribute(g, 3));
    gridLines = new THREE.LineSegments(gg, gridMat);
    gridLines.renderOrder = 2;
    const b = [0, 0, 0, w, 0, 0, w, 0, 0, w, 0, d, w, 0, d, 0, 0, d, 0, 0, d, 0, 0, 0];
    const bg = new THREE.BufferGeometry();
    bg.setAttribute('position', new THREE.Float32BufferAttribute(b, 3));
    boundsLines = new THREE.LineSegments(bg, boundsMat);
    boundsLines.renderOrder = 2;
    overlayRoot.add(gridLines, boundsLines);
  };

  let overlay: BuildOverlay | undefined;

  return {
    group,
    sync(sites) {
      const keys = new Set(sites.map((s) => s.key));
      for (const [k, d] of drawn) {
        if (keys.has(k)) continue;
        group.remove(d.root);
        d.built.dispose();
        d.planned.dispose();
        d.curios?.geometry.dispose();
        drawn.delete(k);
      }
      for (const s of sites) {
        let d = drawn.get(s.key);
        if (!d) {
          d = make(s.key, s.frame);
          drawn.set(s.key, d);
        } else if (d.frame !== s.frame) {
          d.frame = s.frame;
          placeRoot(d.root, s.frame);
        }
        const now = new Set<string>();
        for (const r of s.pieces) {
          const k = `${r.built ? 'b' : 'p'}${r.uid}`;
          now.add(k);
          const sig = JSON.stringify(r);
          if (d.seen.get(k) === sig) continue;
          d.seen.set(k, sig);
          if (r.built) {
            d.planned.remove(`p${r.uid}`);
            d.built.set(k, inputOf(r));
          } else {
            d.built.remove(`b${r.uid}`);
            d.planned.set(k, inputOf(r, PLANNED));
          }
        }
        for (const k of [...d.seen.keys()]) {
          if (now.has(k)) continue;
          d.seen.delete(k);
          (k.startsWith('b') ? d.built : d.planned).remove(k);
        }
        drawCurios(d, s);
      }
    },
    setOverlay(next) {
      overlay = next;
      const d = next && drawn.get(next.key);
      if (!next || !d) {
        overlayRoot.visible = false;
        cursor.clear();
        marked.clear();
        return;
      }
      overlayRoot.visible = true;
      overlayRoot.matrixAutoUpdate = false;
      overlayRoot.matrix.copy(d.root.matrix);
      overlayRoot.updateMatrixWorld(true);
      linesFor(d.frame);
      if (gridLines) {
        gridLines.visible = next.grid;
        gridLines.position.y = next.level * LEVEL_M + 0.03;
        gridLines.updateMatrix();
        gridLines.matrixAutoUpdate = true;
      }
      if (boundsLines) boundsLines.position.y = next.level * LEVEL_M + 0.03;
      cursor.setAll(
        next.ghosts.map((g, i) => [`g${i}`, inputOf(g.piece, g.ok ? GHOST_OK : GHOST_BAD)]),
      );
      marked.setAll(next.marked.map((r, i) => [`m${i}`, inputOf(r, GHOST_BAD)]));
    },
    update(camera, night, lightPools) {
      const now = performance.now();
      let nearest: Drawn | undefined;
      let best = Infinity;
      for (const d of drawn.values()) {
        const dx = camera.x - d.frame.origin.x;
        const dz = camera.z - d.frame.origin.z;
        const dist = dx * dx + dz * dz;
        if (dist < best) {
          best = dist;
          nearest = d;
        }
      }
      for (const d of drawn.values()) {
        // Only the nearest hideout lights the shared pools, and only within a short walk.
        const pools = lightPools && d === nearest && best < 250 * 250;
        d.built.update(camera, night, undefined, now, pools);
        d.planned.update(camera, night, undefined, now, false);
      }
      if (overlay) {
        cursor.update(camera, night, undefined, now, false);
        marked.update(camera, night, undefined, now, false);
      }
    },
    counts() {
      const out: Record<string, { built: number; ghosts: number }> = {};
      for (const [k, d] of drawn) out[k] = { built: d.built.size, ghosts: d.planned.size };
      return out;
    },
    dispose() {
      for (const d of drawn.values()) {
        d.built.dispose();
        d.planned.dispose();
        d.curios?.geometry.dispose();
      }
      drawn.clear();
      curioMat.dispose();
      cursor.dispose();
      marked.dispose();
      gridLines?.geometry.dispose();
      boundsLines?.geometry.dispose();
      for (const m of [plannedMat, cursorMat, markedMat, gridMat, boundsMat]) m.dispose();
    },
  };
}
