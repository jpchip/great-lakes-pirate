import * as THREE from 'three';
import type {
  DistrictBuildingDef,
  DistrictDef,
  DistrictMark,
  KitPiece,
} from '../../../data/schemas/districts';
import {
  districtBuildingKindSchema,
  districtMarkSchema,
  portTabSchema,
} from '../../../data/schemas/districts';
import type { DistrictModel } from '../../sim/district/district';
import { CELL_M, KIT, kitPiece, PROP_TURN_DEG } from '../../sim/district/kit';
import {
  buildingAtCell,
  buildingFits,
  cellAt,
  cellPieceAt,
  compactPalette,
  edgeSegment,
  layoutHash,
  nearestEdge,
  parseLayout,
  pieceId,
  placeCell,
  placeEdge,
  placeProp,
  propNear,
  removeCell,
  removeEdge,
  snapProp,
  type DistrictLayout,
} from '../../sim/district/layout';
import type { NavMesh, NavMeshData } from '../../sim/district/navmesh';
import type { DistrictScene } from './scene';

/**
 * The dev placement editor (plan 08 §13, plan 09 §11; Phase 7 piece C). A top-down camera
 * over the district, a palette of kit pieces, a ghost under the cursor, and plan 09's
 * controls: LMB place (drag to paint cells and edges), R / Shift+R turn a prop, X delete
 * under the cursor, Q pick the piece under the cursor, Ctrl+Z / Ctrl+Y undo and redo. The
 * building tool drags out a rectangle; clicking a building selects it for its inspector,
 * and an edge piece laid on its wall becomes that wall's door or window. Marks place the
 * named spots the later pieces use.
 *
 * Save writes data/districts/<layout>.json through the dev server; Bake reruns
 * `npm run district:bake` for this district and reloads the navmesh. Dev only.
 */

export interface EditorHost {
  container: HTMLElement;
  scene: DistrictScene;
  def: DistrictDef;
  readonly layout: DistrictLayout;
  readonly model: DistrictModel;
  readonly nav: NavMesh | undefined;
  onChange(layout: DistrictLayout): void;
  onNav(data: NavMeshData | undefined): void;
}

export interface Editor {
  readonly active: boolean;
  readonly target: THREE.Vector3;
  readonly help: string;
  enter(at: { x: number; y: number; z: number }): void;
  exit(): void;
  frame(dt: number): void;
}

type Tool =
  | { kind: 'piece'; piece: KitPiece }
  | { kind: 'building' }
  | { kind: 'mark'; markKind: DistrictMark['kind'] }
  | { kind: 'select' };

const HELP =
  'LMB place/select · drag paints · R/Shift+R turn · X delete · Q pick · Ctrl+Z/Y undo/redo · WASD pan · wheel zoom · RMB drag orbit · Tab walk';

export function createEditor(host: EditorHost): Editor {
  const { scene, container } = host;
  let active = false;
  const target = new THREE.Vector3();
  let yaw = 0;
  let pitch = 1.0;
  let distance = 70;
  let tool: Tool = { kind: 'select' };
  let propYaw = 0;
  let selected: string | undefined;
  const undo: string[] = [];
  const redo: string[] = [];
  const keys = new Set<string>();
  const mouse = new THREE.Vector2();
  let mouseIn = false;
  let painting = false;
  let dragFrom: { col: number; row: number } | undefined;
  let orbiting = false;
  let lastX = 0;
  let lastY = 0;
  const raycaster = new THREE.Raycaster();

  // --- Ghost and grid -------------------------------------------------------------------------
  const ghostMat = new THREE.MeshBasicMaterial({ color: 0x40c0ff, transparent: true, opacity: 0.45, depthWrite: false });
  const badMat = new THREE.MeshBasicMaterial({ color: 0xff5040, transparent: true, opacity: 0.45, depthWrite: false });
  const ghost = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), ghostMat);
  ghost.visible = false;
  ghost.renderOrder = 10;
  const selBox = new THREE.Box3Helper(new THREE.Box3(), 0xffd040);
  selBox.visible = false;
  const grid = new THREE.GridHelper(400, 200, 0x335566, 0x223344);
  grid.material.transparent = true;
  (grid.material as THREE.Material).opacity = 0.35;
  grid.visible = false;
  scene.scene.add(ghost, selBox, grid);

  // --- Panel ----------------------------------------------------------------------------------
  const panel = document.createElement('div');
  panel.id = 'editor';
  panel.style.cssText =
    'position:fixed;top:8px;right:8px;bottom:8px;width:250px;overflow:auto;background:rgb(0 0 0/70%);color:#e8eef2;font:12px/1.35 ui-monospace,monospace;padding:8px;display:none;z-index:10;';
  document.body.appendChild(panel);
  const status = document.createElement('div');
  status.style.cssText = 'margin:6px 0;white-space:pre-wrap;color:#ffd890;';
  const inspector = document.createElement('div');

  const button = (label: string, onClick: () => void, title = ''): HTMLButtonElement => {
    const b = document.createElement('button');
    b.textContent = label;
    b.title = title;
    b.style.cssText = 'margin:2px;font:inherit;padding:2px 6px;cursor:pointer;';
    b.addEventListener('click', (e) => {
      e.stopPropagation();
      onClick();
      refreshPanel();
    });
    return b;
  };

  function buildPanel(): void {
    panel.replaceChildren();
    const head = document.createElement('div');
    head.append(
      button('Undo', doUndo),
      button('Redo', doRedo),
      button('Save', () => void save(), 'Write data/districts/<layout>.json'),
      button('Bake', () => void bake(), 'Rebake the ground and navmesh'),
      button('Grid', () => (grid.visible = !grid.visible)),
      button('Nav', () => scene.showNav((navOn = !navOn))),
    );
    panel.append(head, status);
    const tools = document.createElement('div');
    tools.append(
      button('Select', () => setTool({ kind: 'select' })),
      button('Building ▭', () => setTool({ kind: 'building' }), 'Drag out a new building'),
    );
    const markSel = document.createElement('select');
    for (const k of districtMarkSchema.shape.kind.options) markSel.append(new Option(`mark: ${k}`, k));
    markSel.addEventListener('change', () => setTool({ kind: 'mark', markKind: markSel.value as DistrictMark['kind'] }));
    tools.append(markSel);
    panel.append(tools, inspector);
    const cats = new Map<string, KitPiece[]>();
    for (const p of KIT) {
      if (p.id === 'kit.none') continue;
      const list = cats.get(p.category) ?? [];
      list.push(p);
      cats.set(p.category, list);
    }
    for (const [cat, pieces] of cats) {
      const h = document.createElement('div');
      h.textContent = cat;
      h.style.cssText = 'margin-top:8px;color:#9fd0ff;text-transform:uppercase;';
      panel.append(h);
      for (const p of pieces) {
        const b = button(p.name, () => setTool({ kind: 'piece', piece: p }), `${p.id} (${p.placement})`);
        b.dataset['piece'] = p.id;
        panel.append(b);
      }
    }
  }
  let navOn = false;

  function refreshPanel(): void {
    for (const b of panel.querySelectorAll<HTMLButtonElement>('button[data-piece]')) {
      b.style.outline = tool.kind === 'piece' && tool.piece.id === b.dataset['piece'] ? '2px solid #40c0ff' : '';
    }
    const nav = host.nav;
    const hash = layoutHash(host.layout);
    const toolName =
      tool.kind === 'piece' ? `${tool.piece.name} (${tool.piece.placement})` : tool.kind === 'mark' ? `mark: ${tool.markKind}` : tool.kind;
    status.textContent = [
      `tool: ${toolName}${tool.kind === 'piece' && tool.piece.placement === 'prop' ? ` · yaw ${propYaw}°` : ''}`,
      `layout ${hash}${undo.length ? ` · ${undo.length} edits` : ''}`,
      nav ? (nav.data.layoutHash === hash ? 'navmesh up to date' : 'navmesh STALE: Save, then Bake') : 'no navmesh: Save, then Bake',
    ].join('\n');
    renderInspector();
  }

  function renderInspector(): void {
    inspector.replaceChildren();
    const b = host.layout.buildings.find((k) => k.id === selected);
    if (!b) return;
    inspector.style.cssText = 'border:1px solid #556;padding:4px;margin:6px 0;';
    const row = (label: string, el: HTMLElement): void => {
      const r = document.createElement('label');
      r.style.cssText = 'display:flex;justify-content:space-between;gap:4px;margin:2px 0;';
      r.append(label, el);
      inspector.append(r);
    };
    const text = (key: 'id' | 'name', value: string): void => {
      const i = document.createElement('input');
      i.value = value;
      i.style.width = '130px';
      i.addEventListener('change', () =>
        edit(() => {
          if (key === 'id') {
            const next = i.value.replace(/[^a-z0-9_]/g, '_');
            if (host.layout.buildings.some((o) => o.id === next)) return;
            b.id = next;
            selected = next;
          } else if (i.value) b.name = i.value;
          else delete b.name;
        }),
      );
      row(key, i);
    };
    const choose = <T extends string>(label: string, options: readonly T[], value: string, set: (v: T) => void): void => {
      const s = document.createElement('select');
      for (const o of options) s.append(new Option(o, o, false, o === value));
      s.addEventListener('change', () => edit(() => set(s.value as T)));
      row(label, s);
    };
    const num = (label: string, value: number, set: (v: number) => void, step = 0.1): void => {
      const i = document.createElement('input');
      i.type = 'number';
      i.step = String(step);
      i.value = String(value);
      i.style.width = '70px';
      i.addEventListener('change', () => edit(() => set(Number(i.value))));
      row(label, i);
    };
    text('id', b.id);
    text('name', b.name ?? '');
    choose('kind', districtBuildingKindSchema.options, b.kind, (v) => (b.kind = v));
    const walls = KIT.filter((p) => p.placement === 'edge' && (p.collider === 'wall' || p.collider === 'window')).map((p) => p.id);
    choose('wall', walls, b.wall, (v) => (b.wall = v));
    const floors = KIT.filter((p) => p.placement === 'cell' && p.collider === 'floor').map((p) => p.id);
    choose('floor', floors, b.floor, (v) => (b.floor = v));
    choose('roof', ['gable', 'flat', 'falseFront'] as const, b.roof, (v) => (b.roof = v));
    choose('ridge', ['x', 'z'] as const, b.ridge, (v) => (b.ridge = v));
    num('eaves m', b.wallHeightM, (v) => (b.wallHeightM = Math.min(12, Math.max(2.4, v))));
    num('paint', b.paint, (v) => (b.paint = Math.max(0, Math.round(v))), 1);
    choose('opens', ['', ...portTabSchema.options] as const, b.opens ?? '', (v) => {
      if (v) b.opens = v;
      else delete b.opens;
    });
    inspector.append(
      button('Delete building', () =>
        edit(() => {
          host.layout.buildings = host.layout.buildings.filter((k) => k.id !== b.id);
          selected = undefined;
        }),
      ),
    );
  }

  function setTool(t: Tool): void {
    tool = t;
    if (t.kind !== 'select') selected = undefined;
  }

  // --- Edits ----------------------------------------------------------------------------------
  let rebuildTimer = 0;
  function edit(change: () => void): void {
    const before = JSON.stringify(host.layout);
    change();
    if (JSON.stringify(host.layout) === before) return;
    undo.push(before);
    if (undo.length > 200) undo.shift();
    redo.length = 0;
    scheduleRebuild();
  }
  function scheduleRebuild(): void {
    window.clearTimeout(rebuildTimer);
    rebuildTimer = window.setTimeout(() => {
      host.onChange(host.layout);
      refreshPanel();
    }, 60);
  }
  function restore(json: string): void {
    host.onChange(parseLayout(JSON.parse(json)));
    refreshPanel();
  }
  function doUndo(): void {
    const prev = undo.pop();
    if (!prev) return;
    redo.push(JSON.stringify(host.layout));
    restore(prev);
  }
  function doRedo(): void {
    const next = redo.pop();
    if (!next) return;
    undo.push(JSON.stringify(host.layout));
    restore(next);
  }

  async function save(): Promise<void> {
    compactPalette(host.layout);
    host.onChange(host.layout);
    status.textContent = 'saving…';
    const r = await fetch(`/__district/save?file=${encodeURIComponent(host.def.layout)}`, {
      method: 'POST',
      body: JSON.stringify(host.layout),
    });
    status.textContent = r.ok ? `saved data/districts/${host.def.layout}` : `save failed: ${await r.text()}`;
  }

  async function bake(): Promise<void> {
    status.textContent = 'baking… (npm run district:bake)';
    const r = await fetch(`/__district/bake?bake=${encodeURIComponent(host.def.bake)}`, { method: 'POST' });
    const text = await r.text();
    if (!r.ok) {
      status.textContent = `bake failed:\n${text.slice(-600)}`;
      return;
    }
    const nav = (await (await fetch(`districts/${host.def.bake}/navmesh.json?t=${Date.now()}`)).json()) as NavMeshData;
    host.onNav(nav);
    refreshPanel();
  }

  // --- Picking --------------------------------------------------------------------------------
  /** Where the cursor ray meets the walkable top (ground, decks, floors). */
  function pick(): THREE.Vector3 | undefined {
    if (!mouseIn) return undefined;
    raycaster.setFromCamera(mouse, scene.camera);
    const { origin, direction } = raycaster.ray;
    if (direction.y > -0.01) return undefined;
    let y = 1.8;
    const p = new THREE.Vector3();
    for (let k = 0; k < 4; k++) {
      const t = (y - origin.y) / direction.y;
      p.copy(direction).multiplyScalar(t).add(origin);
      y = host.model.floorAt(p.x, p.z);
    }
    p.y = y;
    return p;
  }

  function placeAt(p: THREE.Vector3, dragging: boolean): void {
    const layout = host.layout;
    if (tool.kind === 'piece') {
      const piece = tool.piece;
      if (piece.placement === 'cell') {
        const { col, row } = cellAt(layout, p.x, p.z);
        edit(() => placeCell(layout, piece.id, col, row));
      } else if (piece.placement === 'edge') {
        const e = nearestEdge(layout, p.x, p.z);
        edit(() => placeEdge(layout, piece.id, e.col, e.row, e.side));
      } else if (!dragging) {
        edit(() => placeProp(layout, piece.id, p.x, p.z, propYaw));
      }
    } else if (tool.kind === 'mark' && !dragging) {
      const kind = tool.markKind;
      const id = window.prompt(`id for the new ${kind} mark`, `${kind}.${layout.marks.filter((m) => m.kind === kind).length}`);
      if (!id) return;
      const [x, z, yaw] = snapProp(p.x, p.z, propYaw);
      edit(() => {
        layout.marks = layout.marks.filter((m) => m.id !== id);
        layout.marks.push({ id, kind, x, z, headingDeg: yaw });
      });
    } else if (tool.kind === 'select' && !dragging) {
      const { col, row } = cellAt(layout, p.x, p.z);
      selected = buildingAtCell(layout, col, row)?.id;
      refreshPanel();
    }
  }

  function erase(p: THREE.Vector3): void {
    const layout = host.layout;
    edit(() => {
      const k = propNear(layout, p.x, p.z, 0.8);
      if (k >= 0) {
        layout.props.splice(k, 1);
        return;
      }
      const mark = layout.marks.findIndex((m) => Math.hypot(m.x - p.x, m.z - p.z) < 0.8);
      if (mark >= 0) {
        layout.marks.splice(mark, 1);
        return;
      }
      const e = nearestEdge(layout, p.x, p.z);
      const seg = edgeSegment(layout, e);
      const across = seg.alongX ? Math.abs(p.z - seg.z) : Math.abs(p.x - seg.x);
      if (across < 0.4 && removeEdge(layout, e.col, e.row, e.side)) return;
      const { col, row } = cellAt(layout, p.x, p.z);
      removeCell(layout, col, row);
    });
  }

  function eyedrop(p: THREE.Vector3): void {
    const layout = host.layout;
    const k = propNear(layout, p.x, p.z, 0.8);
    if (k >= 0) {
      const t = layout.props[k]!;
      propYaw = t[3];
      setTool({ kind: 'piece', piece: kitPiece(pieceId(layout, t[0])) });
      return;
    }
    const { col, row } = cellAt(layout, p.x, p.z);
    const c = cellPieceAt(layout, col, row);
    if (c) setTool({ kind: 'piece', piece: kitPiece(pieceId(layout, c[0])) });
  }

  function updateGhost(p: THREE.Vector3 | undefined): void {
    ghost.visible = false;
    if (!p) return;
    const layout = host.layout;
    if (tool.kind === 'piece') {
      const piece = tool.piece;
      ghost.visible = true;
      ghost.rotation.set(0, 0, 0);
      if (piece.placement === 'cell') {
        const { col, row } = cellAt(layout, p.x, p.z);
        const x = layout.bounds.x0 + (col + 0.5) * CELL_M;
        const z = layout.bounds.z0 + (row + 0.5) * CELL_M;
        const y = piece.deckM ?? host.model.floorAt(x, z);
        ghost.scale.set(CELL_M, 0.3, CELL_M);
        ghost.position.set(x, y - 0.1, z);
      } else if (piece.placement === 'edge') {
        const seg = edgeSegment(layout, nearestEdge(layout, p.x, p.z));
        const h = Math.max(piece.heightM, 1);
        ghost.scale.set(seg.alongX ? CELL_M : 0.25, h, seg.alongX ? 0.25 : CELL_M);
        ghost.position.set(seg.x, host.model.floorAt(seg.x, seg.z) + h / 2, seg.z);
      } else {
        const [x, z, yaw] = snapProp(p.x, p.z, propYaw);
        ghost.scale.set(piece.sizeM[0], Math.max(piece.heightM, 0.3), piece.sizeM[1]);
        ghost.position.set(x, host.model.floorAt(x, z) + Math.max(piece.heightM, 0.3) / 2, z);
        ghost.rotation.y = (-yaw * Math.PI) / 180;
      }
    } else if (tool.kind === 'building' && dragFrom) {
      const { col, row } = cellAt(layout, p.x, p.z);
      const r = rect(dragFrom, { col, row });
      ghost.visible = true;
      ghost.material = buildingFits(layout, r) ? ghostMat : badMat;
      ghost.scale.set(r.cols * CELL_M, 4, r.rows * CELL_M);
      ghost.position.set(layout.bounds.x0 + (r.col + r.cols / 2) * CELL_M, p.y + 2, layout.bounds.z0 + (r.row + r.rows / 2) * CELL_M);
      return;
    } else if (tool.kind === 'mark') {
      ghost.visible = true;
      ghost.scale.set(0.5, 2.5, 0.5);
      ghost.position.set(p.x, p.y + 1.25, p.z);
    }
    ghost.material = ghostMat;
  }

  function rect(a: { col: number; row: number }, b: { col: number; row: number }): Pick<DistrictBuildingDef, 'col' | 'row' | 'cols' | 'rows'> {
    return {
      col: Math.min(a.col, b.col),
      row: Math.min(a.row, b.row),
      cols: Math.abs(a.col - b.col) + 1,
      rows: Math.abs(a.row - b.row) + 1,
    };
  }

  function updateSelection(): void {
    const b = host.model.buildings.find((k) => k.def.id === selected);
    selBox.visible = !!b && active;
    if (b) selBox.box.set(new THREE.Vector3(b.minX, b.floorY, b.minZ), new THREE.Vector3(b.maxX, b.topY, b.maxZ));
  }

  // --- Input ----------------------------------------------------------------------------------
  const canvas = scene.renderer.domElement;
  canvas.addEventListener('contextmenu', (e) => active && e.preventDefault());
  canvas.addEventListener('pointermove', (e) => {
    if (!active) return;
    const r = canvas.getBoundingClientRect();
    mouse.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    mouseIn = true;
    if (orbiting) {
      yaw += (e.clientX - lastX) * 0.006;
      pitch = Math.min(1.5, Math.max(0.2, pitch + (e.clientY - lastY) * 0.006));
    }
    lastX = e.clientX;
    lastY = e.clientY;
    if (painting) {
      const p = pick();
      if (p) placeAt(p, true);
    }
  });
  canvas.addEventListener('pointerleave', () => (mouseIn = false));
  canvas.addEventListener('pointerdown', (e) => {
    if (!active) return;
    lastX = e.clientX;
    lastY = e.clientY;
    if (e.button === 2) {
      orbiting = true;
      return;
    }
    if (e.button !== 0) return;
    const p = pick();
    if (!p) return;
    if (tool.kind === 'building') {
      dragFrom = cellAt(host.layout, p.x, p.z);
      return;
    }
    placeAt(p, false);
    painting = tool.kind === 'piece' && tool.piece.placement !== 'prop';
  });
  window.addEventListener('pointerup', (e) => {
    if (!active) return;
    if (e.button === 2) orbiting = false;
    painting = false;
    if (dragFrom && tool.kind === 'building') {
      const p = pick();
      if (p) {
        const r = rect(dragFrom, cellAt(host.layout, p.x, p.z));
        if (buildingFits(host.layout, r) && r.cols >= 2 && r.rows >= 2) {
          let n = host.layout.buildings.length;
          while (host.layout.buildings.some((b) => b.id === `building_${n}`)) n++;
          const id = `building_${n}`;
          edit(() =>
            host.layout.buildings.push({
              id,
              kind: 'warehouse',
              ...r,
              wall: 'kit.wall_plank',
              floor: 'kit.floor_plank',
              wallHeightM: 4,
              roof: 'gable',
              ridge: r.cols >= r.rows ? 'x' : 'z',
              paint: 0,
              edges: [['kit.wall_plank_door', 0, Math.floor(r.cols / 2)]],
            }),
          );
          selected = id;
          tool = { kind: 'select' };
        }
      }
      dragFrom = undefined;
    }
  });
  canvas.addEventListener(
    'wheel',
    (e) => {
      if (!active) return;
      e.preventDefault();
      distance = Math.min(400, Math.max(6, distance * Math.exp(e.deltaY * 0.001)));
    },
    { passive: false },
  );
  window.addEventListener('keydown', (e) => {
    if (!active) return;
    if ((e.target as HTMLElement | null)?.closest?.('input, select, textarea')) return;
    keys.add(e.code);
    const p = pick();
    if ((e.ctrlKey || e.metaKey) && e.code === 'KeyZ') {
      e.preventDefault();
      if (e.shiftKey) doRedo();
      else doUndo();
    } else if ((e.ctrlKey || e.metaKey) && e.code === 'KeyY') {
      e.preventDefault();
      doRedo();
    } else if ((e.ctrlKey || e.metaKey) && e.code === 'KeyS') {
      e.preventDefault();
      void save();
    } else if (e.code === 'KeyR') {
      propYaw = (((propYaw + (e.shiftKey ? -PROP_TURN_DEG : PROP_TURN_DEG)) % 360) + 360) % 360;
    } else if (e.code === 'KeyX' && p) {
      erase(p);
    } else if (e.code === 'KeyQ' && p) {
      eyedrop(p);
    } else if (e.code === 'Escape') {
      setTool({ kind: 'select' });
    }
    refreshPanel();
  });
  window.addEventListener('keyup', (e) => keys.delete(e.code));

  buildPanel();

  return {
    get active() {
      return active;
    },
    target,
    help: HELP,
    enter(at) {
      active = true;
      target.set(at.x, at.y, at.z);
      panel.style.display = 'block';
      grid.position.y = 1.85;
      refreshPanel();
    },
    exit() {
      active = false;
      panel.style.display = 'none';
      ghost.visible = false;
      selBox.visible = false;
      grid.visible = false;
    },
    frame(dt) {
      const speed = distance * 0.9 * dt;
      const fx = Math.sin(yaw);
      const fz = -Math.cos(yaw);
      const ax = (keys.has('KeyD') || keys.has('ArrowRight') ? 1 : 0) - (keys.has('KeyA') || keys.has('ArrowLeft') ? 1 : 0);
      const az = (keys.has('KeyW') || keys.has('ArrowUp') ? 1 : 0) - (keys.has('KeyS') || keys.has('ArrowDown') ? 1 : 0);
      target.x += (fx * az - fz * ax) * speed;
      target.z += (fz * az + fx * ax) * speed;
      target.y = host.model.floorAt(target.x, target.z);
      const cp = Math.cos(pitch);
      scene.camera.position.set(
        target.x - fx * cp * distance,
        target.y + Math.sin(pitch) * distance,
        target.z - fz * cp * distance,
      );
      scene.camera.lookAt(target);
      updateGhost(pick());
      updateSelection();
    },
  };
}
