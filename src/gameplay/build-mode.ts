import { advanceGameTime, dayAndHour, WORLD_TICK_GAME_SECONDS } from '../core/time';
import type { GameContext } from '../modes/context';
import type { Mode } from '../modes/machine';
import type { BuildOverlay, HideoutSitesView } from '../render/hideout/site-views';
import {
  affordable,
  aimPiece,
  costOf,
  dragPieces,
  goodsText,
  PALETTE_CATEGORIES,
  pieceAt,
  piecesIn,
  type Aim,
  type Held,
} from '../sim/hideouts/build-tools';
import { addGoods, EditLog, pieceCost, type Goods } from '../sim/hideouts/edit';
import { BuildGrid, type Piece } from '../sim/hideouts/grid';
import { concealmentOf, type ConcealmentNow } from '../sim/hideouts/life';
import { placedRender, type PlacedRender } from '../sim/hideouts/placed';
import { siteToZone, zoneToSite } from '../sim/hideouts/site-frame';
import {
  FLOOR_LEVELS,
  findStructure,
  LEVEL_M,
  PROP_TURNS,
  structure,
} from '../sim/hideouts/structures';
import { canPlace, dependentsOf, REFUSAL_TEXT } from '../sim/hideouts/validity';
import { materialsOnHand, queueSummary, runWorkSession } from '../sim/hideouts/work';
import { addToHold, holdUsed, type Hold } from '../sim/economy/hold';
import type { StructureCategory, StructureDef } from '../../data/schemas/structures';
import type { BuildActions, BuildPanelSnapshot } from '../ui/build/model';
import type { GameAshore } from './ashore';
import type { HideoutSite, Hideouts } from './hideouts';

/**
 * Build mode (plan 09 §9, plan 13 §12; Phase 8 piece C). B on foot inside a claimed
 * hideout's bounds opens it: the camera lifts off into a free orbit over the site, the
 * palette comes up, and the mouse lays out ghosts on the grid, green where they can go and
 * red with the reason where they can't. Placing is free; Build runs a work session that
 * puts up every ghost the materials on hand allow and advances the clock by the work's
 * hours (piece A's `runWorkSession`). Deconstructing a built piece refunds 75% into the
 * hideout's storage.
 *
 * The world holds still while you plan: only Build passes time. Every edit is saved into
 * the hideout's layout at once, so the ghosts outlive the mode and the run.
 */

interface V3 {
  x: number;
  y: number;
  z: number;
}

export interface BuildModeDeps {
  ctx: GameContext;
  hideouts: Hideouts;
  ashore: GameAshore;
  /** The canvas the mouse works on, if there's one drawn. */
  canvas(): HTMLElement | undefined;
  /** A ray through a point on the canvas, zone meters, from the camera last drawn. */
  ray(clientX: number, clientY: number): { origin: V3; dir: V3 } | undefined;
  view(): HideoutSitesView | undefined;
  transition(to: 'build' | 'onFoot'): void;
  /** The hold of the ship moored at this hideout, if she lies there (plan 09 §9). */
  shipHold(hideoutId: string): Hold | undefined;
  /** The crew's tier for the work session: a T1's is 1. */
  crewTier(): number;
  goodName(id: string): string;
  /** Why build mode can't open now (pursued, a screen open), or undefined. */
  blocked(): string | undefined;
  save(): Promise<void>;
  notice(text: string): void;
  panel(snapshot: BuildPanelSnapshot | undefined): void;
  /** Storage, the hold or the clock changed under the HUD. */
  changed?(): void;
  /**
   * The moment for a site's concealment (Phase 8 piece F): after dark, your ship lying
   * there, and who spotted it this week ("the tug Sophia, 2 days ago").
   */
  concealmentNow?(hideoutId: string): ConcealmentNow & { spotted?: string | undefined };
  /** The sounds of building (Phase 8 piece I); silent without. */
  sounds?: BuildSounds;
}

/** What build mode asks the audio to play (Phase 8 piece I). Materials from `structures.json`. */
export interface BuildSounds {
  opened(): void;
  closed(): void;
  page(): void;
  placed(materials: readonly string[]): void;
  refused(): void;
  removed(materials: readonly string[], built: boolean): void;
  undone(): void;
  built(materials: readonly string[], seconds: number): void;
}

/** A piece's material, from its variant. */
const materialOf = (p: Piece): string =>
  findStructure(p.id)?.variants[p.variant]?.material ?? 'timber';

export interface BuildMode {
  readonly mode: Mode;
  readonly active: boolean;
  readonly hideoutId: string | undefined;
  /** B on foot: opens build mode at the hideout you stand in, or says why not. */
  open(): string | undefined;
  close(): void;
  /** What the site's drawing leaves out while a level is edited (plan 09 §9). */
  cut(): { hideoutId: string; level: number; roofs: boolean } | undefined;
  actions: BuildActions;
  /** The dev hooks' handles: the same paths the mouse and keys take. */
  dev: BuildDev;
}

export interface BuildDev {
  /** Where the cursor is, site meters on the level edited (no ray needed). */
  aim(x: number, z: number): void;
  /** Left mouse down and up where the cursor is (a drag if the aim moves between). */
  press(): void;
  release(): void;
  key(code: string, mods?: { ctrl?: boolean; shift?: boolean }): void;
  state(): BuildDevState | undefined;
}

export interface BuildDevState {
  hideout: string;
  level: number;
  tool: 'place' | 'remove';
  held: Held | undefined;
  aim: Aim | undefined;
  /** What the cursor would place, and whether it can. */
  ghosts: { piece: Piece; ok: boolean; reason?: string }[];
  marked: number;
  built: number;
  planned: number;
  canUndo: boolean;
  canRedo: boolean;
  message: string | undefined;
  camera: { position: V3; target: V3 };
}

/** The build camera's reach (plan 09 §9). */
const DIST_MIN = 6;
const DIST_MAX = 90;
const PITCH_MIN = 0.2;
const PITCH_MAX = 1.45;
const PAN_MS = 14;
/** B opens build mode this far outside the bounds too, meters. */
export const BUILD_MARGIN_M = 6;

function hoursText(seconds: number): string {
  const h = seconds / 3600;
  if (h < 1) return `${Math.max(1, Math.round(h * 60))} minutes of work`;
  if (h < 24) return `about ${Math.round(h)} hour${Math.round(h) === 1 ? '' : 's'} of work`;
  const d = Math.floor(h / 24);
  const r = Math.round(h - d * 24);
  return `about ${d} day${d === 1 ? '' : 's'}${r ? ` ${r} h` : ''} of work`;
}

function cloneHold(h: Hold): Hold {
  return h.map((s) => ({ ...s, ...(s.hot ? { hot: { ...s.hot } } : {}) }));
}

/** Pieces drawn from the placement level up a roof's or gable's: a level above the floor. */
const roofish = (def: StructureDef): boolean => def.placement === 'roof' || !!def.onRoof;

export function attachBuildMode(deps: BuildModeDeps): BuildMode {
  const { ctx, hideouts, ashore } = deps;
  let active = false;
  let site: HideoutSite | undefined;
  let grid: BuildGrid | undefined;
  const log = new EditLog();
  let level = 0;
  let showGrid = true;
  let tool: 'place' | 'remove' = 'place';
  let category: StructureCategory = 'foundation';
  let held: Held | undefined = { id: 'build.foundation', variant: 0, rot: 0, flip: false };
  let aim: Aim | undefined;
  let mouse: { x: number; y: number } | undefined;
  let dragFrom: Piece | undefined;
  let message: string | undefined;
  /** Bumped by anything that changes the panel's palette or queue. */
  let rev = 0;

  // The camera: an orbit around a target on the level edited, zone meters.
  const cam = { tx: 0, tz: 0, yaw: 0, pitch: 0.9, dist: 30 };
  const keys = new Set<string>();
  let orbiting: { x: number; y: number } | undefined;

  const def = (): StructureDef | undefined => (held ? findStructure(held.id) : undefined);
  /** The level a piece goes on: a roof or a gable sits on the level edited's walls. */
  const placeLevel = (d: StructureDef | undefined): number => (d && roofish(d) ? level + 1 : level);
  const targetY = (): number => (site?.frame.baseM ?? 0) + level * LEVEL_M;

  const cameraPose = (): { position: V3; target: V3 } => {
    const target = { x: cam.tx, y: targetY(), z: cam.tz };
    const c = Math.cos(cam.pitch);
    return {
      position: {
        x: target.x + Math.sin(cam.yaw) * c * cam.dist,
        y: target.y + Math.sin(cam.pitch) * cam.dist,
        z: target.z + Math.cos(cam.yaw) * c * cam.dist,
      },
      target,
    };
  };

  const sources = (): Hold[] => {
    if (!site) return [];
    const ship = deps.shipHold(site.hideoutId);
    return ship ? [site.state.storage.goods, ship] : [site.state.storage.goods];
  };

  const commit = (): void => {
    if (!site || !grid) return;
    hideouts.commit(site.hideoutId, grid);
    // The commit re-reads the site; keep ours pointing at the saved state.
    site = hideouts.site(site.hideoutId) ?? site;
    rev++;
  };

  // --- What the cursor would do ---------------------------------------------------------------

  let ghostKey = '';
  let ghosts: { piece: Piece; render: PlacedRender; ok: boolean; reason?: string }[] = [];
  let marked: PlacedRender[] = [];
  let markedUids: number[] = [];

  const recomputeCursor = (): void => {
    const d = def();
    const key = JSON.stringify([aim, held, tool, level, dragFrom, rev]);
    if (key === ghostKey) return;
    ghostKey = key;
    ghosts = [];
    marked = [];
    markedUids = [];
    if (!site || !grid || !aim) return;
    if (tool === 'remove') {
      const target = pieceAt(grid, aim, level) ?? pieceAt(grid, aim, level + 1);
      if (!target) return;
      markedUids = [target.uid, ...dependentsOf(grid, site.build, [target.uid])];
      const set = new Set(markedUids);
      marked = placedRender(grid, site.build).filter((r) => set.has(r.uid));
      return;
    }
    if (!d || !held) return;
    const end = aimPiece(d, held, aim, placeLevel(d));
    const list = dragFrom ? dragPieces(d, dragFrom, end) : [end];
    const tmp = grid.clone();
    const uids: { uid: number; ok: boolean; reason?: string; piece: Piece }[] = [];
    for (const p of list) {
      const c = canPlace(tmp, site.build, p);
      uids.push({
        uid: tmp.add(p, false),
        ok: c.ok,
        piece: p,
        ...(c.ok ? {} : { reason: REFUSAL_TEXT[c.reason] }),
      });
    }
    const renders = new Map(placedRender(tmp, site.build).map((r) => [r.uid, r]));
    for (const u of uids) {
      const r = renders.get(u.uid);
      if (!r) continue;
      ghosts.push({
        piece: u.piece,
        render: r,
        ok: u.ok,
        ...(u.reason ? { reason: u.reason } : {}),
      });
    }
  };

  const cursorText = (): { text: string; ok: boolean } | undefined => {
    if (tool === 'remove') {
      if (!grid || markedUids.length === 0)
        return aim ? { text: 'Nothing here', ok: false } : undefined;
      const pieces = markedUids.map((u) => grid?.get(u)).filter((p) => !!p);
      const built = pieces.filter((p) => p.built).map((p) => p.piece);
      const refund: Goods = {};
      for (const p of built) addGoods(refund, pieceCost(p));
      const back: Goods = {};
      for (const [g, n] of Object.entries(refund)) back[g] = Math.floor(n * 0.75);
      const name = structure(pieces[0]?.piece.id ?? '').name;
      const more = pieces.length > 1 ? ` and ${pieces.length - 1} on it` : '';
      return {
        text: built.length
          ? `Take down ${name}${more} · back: ${goodsText(back, deps.goodName)}`
          : `Clear the plan for ${name}${more}`,
        ok: true,
      };
    }
    if (ghosts.length === 0) return undefined;
    const bad = ghosts.find((g) => !g.ok);
    const okCount = ghosts.filter((g) => g.ok).length;
    if (okCount === 0) return { text: bad?.reason ?? "Can't go here", ok: false };
    const cost = costOf(ghosts.filter((g) => g.ok).map((g) => g.piece));
    const n = okCount > 1 ? `${okCount} × ` : '';
    const skip = bad ? ` (${ghosts.length - okCount} can't: ${bad.reason})` : '';
    return {
      text: `Plan ${n}${structure(ghosts[0]?.piece.id ?? '').name} · ${goodsText(cost, deps.goodName)}${skip}`,
      ok: true,
    };
  };

  // --- Edits ----------------------------------------------------------------------------------

  const placeNow = (): void => {
    if (!site || !grid) return;
    recomputeCursor();
    const list = ghosts.map((g) => g.piece);
    dragFrom = undefined;
    if (list.length === 0) return;
    const r = log.placeMany(grid, site.build, list);
    if (r.placed.length === 0) {
      message = REFUSAL_TEXT[r.refused[0]?.reason ?? 'occupied'];
      deps.sounds?.refused();
      rev++;
      return;
    }
    deps.sounds?.placed(list.map(materialOf));
    message = `Planned ${r.placed.length} ${r.placed.length === 1 ? 'piece' : 'pieces'}`;
    commit();
  };

  const removeNow = (): void => {
    if (!site || !grid || !aim) return;
    const target = pieceAt(grid, aim, level) ?? pieceAt(grid, aim, level + 1);
    if (!target) return;
    const storage = site.state.storage;
    const going = [target.uid, ...dependentsOf(grid, site.build, [target.uid])].flatMap((u) => {
      const p = grid?.get(u);
      return p ? [p] : [];
    });
    const r = log.remove(grid, site.build, target.uid, {
      withDependents: true,
      load: { goodsCu: holdUsed(storage.goods), cash: storage.cash },
    });
    if (!r.ok) {
      message = REFUSAL_TEXT[r.reason];
      deps.sounds?.refused();
      rev++;
      return;
    }
    deps.sounds?.removed(
      going.map((p) => materialOf(p.piece)),
      going.some((p) => p.built),
    );
    for (const [good, qty] of Object.entries(r.refund)) addToHold(storage.goods, { good, qty });
    const back = goodsText(r.refund, deps.goodName);
    message = Object.keys(r.refund).length ? `Taken down: ${back} back in storage` : 'Plan cleared';
    commit();
    deps.changed?.();
  };

  const eyedrop = (): void => {
    if (!grid || !aim) return;
    const t = pieceAt(grid, aim, level) ?? pieceAt(grid, aim, level + 1);
    if (!t) return;
    const d = structure(t.piece.id);
    held = {
      id: d.id,
      variant: t.piece.variant,
      rot: t.piece.rot,
      flip: d.placement === 'edge' && (t.piece.rot === 1 || t.piece.rot === 2),
    };
    category = d.category;
    tool = 'place';
    rev++;
  };

  const rotate = (back: boolean): void => {
    const d = def();
    if (!held || !d) return;
    if (d.placement === 'edge') held.flip = !held.flip;
    else if (d.placement === 'prop') {
      const step = back ? 1 : PROP_TURNS / 4;
      held.rot = (held.rot + step) % PROP_TURNS;
    } else held.rot = (held.rot + (back ? 3 : 1)) % 4;
    rev++;
  };

  const setLevel = (delta: number): void => {
    const next = Math.max(0, Math.min(FLOOR_LEVELS - 1, level + delta));
    if (next === level) return;
    level = next;
    dragFrom = undefined;
    rev++;
  };

  const undo = (): void => {
    if (grid && log.undo(grid)) {
      message = 'Undone';
      deps.sounds?.undone();
      commit();
    }
  };
  const redo = (): void => {
    if (grid && log.redo(grid)) {
      message = 'Redone';
      deps.sounds?.undone();
      commit();
    }
  };

  /** Runs the clock on by `seconds`, a world tick at a time (as lying at anchor does). */
  const passTime = (seconds: number): void => {
    const clock = ctx.state.environment.clock;
    let left = seconds;
    while (left > 0) {
      const step = Math.min(WORLD_TICK_GAME_SECONDS, left);
      left -= step;
      const before = dayAndHour(clock.gameSeconds).day;
      const n = advanceGameTime(clock, step);
      for (let i = 0; i < n; i++) ctx.events.emit('WorldTick', { gameSeconds: clock.gameSeconds });
      const after = dayAndHour(clock.gameSeconds).day;
      if (after !== before) ctx.events.emit('DayChanged', { day: after });
    }
    const at = ashore.zoneAt();
    ctx.weather.tick(clock.gameSeconds, at, ctx.sea);
  };

  const build = (): void => {
    if (!site || !grid) return;
    const before = grid.planned().length;
    if (before === 0) return;
    const r = runWorkSession(grid, site.build, sources(), {
      crewTier: deps.crewTier(),
      gameSeconds: ctx.state.environment.clock.gameSeconds,
    });
    if (r.built.length === 0) {
      message = 'Nothing can be built yet: short of materials, or nothing to stand on';
      deps.sounds?.refused();
      rev++;
      return;
    }
    const builtGrid = grid;
    deps.sounds?.built(
      r.built.flatMap((uid) => {
        const p = builtGrid.get(uid);
        return p ? [materialOf(p.piece)] : [];
      }),
      r.seconds,
    );
    passTime(r.seconds);
    // Built pieces are what they are now: undo can't take back the work.
    log.clear();
    commit();
    ashore.refreshScene();
    deps.changed?.();
    message =
      `Built ${r.built.length} ${r.built.length === 1 ? 'piece' : 'pieces'} (${hoursText(r.seconds).replace(' of work', '')})` +
      (r.left ? `; ${r.left} still planned` : '');
    deps.notice(message);
    void deps.save();
  };

  // --- The panel ------------------------------------------------------------------------------

  let queueRev = -1;
  let queueCache: BuildPanelSnapshot['queue'] | undefined;
  let lastPanel = '';

  const queue = (): BuildPanelSnapshot['queue'] => {
    if (queueCache && queueRev === rev) return queueCache;
    queueRev = rev;
    const empty = { pieces: 0, needs: [], time: '', buildable: 0 };
    if (!site || !grid) return (queueCache = empty);
    const opts = {
      crewTier: deps.crewTier(),
      gameSeconds: ctx.state.environment.clock.gameSeconds,
    };
    const q = queueSummary(grid, sources(), opts);
    // What a session would build now, tried on copies.
    const trial = runWorkSession(grid.clone(), site.build, sources().map(cloneHold), opts);
    return (queueCache = {
      pieces: q.pieces,
      needs: Object.entries(q.needs).map(([good, need]) => ({
        good,
        name: deps.goodName(good),
        need,
        have: q.have[good] ?? 0,
      })),
      time: hoursText(q.seconds),
      buildable: trial.built.length,
    });
  };

  /** The site's concealment now, and once the ghosts are up (plan 09 §8; piece F). */
  const concealmentView = (): BuildPanelSnapshot['concealment'] => {
    if (!site || !grid || !deps.concealmentNow) return undefined;
    const at = deps.concealmentNow(site.hideoutId);
    const c = concealmentOf(site.site, grid, at);
    const pct = (v: number): number => Math.round(v * 100);
    let planned: { value: number; word: string } | undefined;
    if (grid.planned().length > 0) {
      const all = new BuildGrid();
      for (const p of grid.all()) all.add(p.piece, true);
      const after = concealmentOf(site.site, all, at);
      if (after.value !== c.value) planned = { value: pct(after.value), word: after.word };
    }
    return {
      value: pct(c.value),
      word: c.word,
      parts: c.parts.map((p) => ({ label: p.label, delta: pct(p.delta) })),
      ...(planned ? { planned } : {}),
      ...(at.spotted ? { spotted: at.spotted } : {}),
    };
  };

  const snapshot = (): BuildPanelSnapshot | undefined => {
    if (!site || !grid) return undefined;
    const onHand = materialsOnHand(sources());
    const needs = costOf(grid.planned().map((p) => p.piece));
    const d = def();
    const c = cursorText();
    return {
      site: site.site.name,
      level,
      levels: FLOOR_LEVELS,
      grid: showGrid,
      tool,
      category,
      categories: PALETTE_CATEGORIES.map((x) => ({ ...x })),
      pieces: piecesIn(category).map((p) => ({
        id: p.id,
        name: p.name,
        variants: p.variants.map((v, index) => ({
          index,
          material: v.material,
          cost: goodsText(v.cost, deps.goodName),
          afford: affordable(v.cost, onHand, needs),
        })),
      })),
      held: held && d ? { id: held.id, variant: held.variant, name: d.name } : undefined,
      cursor: c && mouse ? { ...c, x: mouse.x, y: mouse.y } : undefined,
      queue: queue(),
      onHand: Object.entries(onHand)
        .filter(([, n]) => n > 0)
        .map(([g, qty]) => ({ name: deps.goodName(g), qty }))
        .sort((a, b) => a.name.localeCompare(b.name)),
      fromHold: !!deps.shipHold(site.hideoutId),
      concealment: concealmentView(),
      canUndo: log.canUndo,
      canRedo: log.canRedo,
      message,
    };
  };

  const pushPanel = (): void => {
    const s = snapshot();
    const key = JSON.stringify(s);
    if (key === lastPanel) return;
    lastPanel = key;
    deps.panel(s);
  };

  const overlay = (): BuildOverlay | undefined => {
    if (!site) return undefined;
    return {
      key: site.hideoutId,
      level,
      grid: showGrid,
      ghosts: ghosts.map((g) => ({ piece: g.render, ok: g.ok })),
      marked,
    };
  };

  // --- Input ----------------------------------------------------------------------------------

  const aimFromMouse = (): void => {
    if (!mouse || !site) return;
    const canvas = deps.canvas();
    if (!canvas) return;
    const r = canvas.getBoundingClientRect();
    const ray = deps.ray(mouse.x + r.left, mouse.y + r.top);
    if (!ray || Math.abs(ray.dir.y) < 1e-4) {
      aim = undefined;
      return;
    }
    const d = def();
    const y = site.frame.baseM + placeLevel(tool === 'place' ? d : undefined) * LEVEL_M;
    const t = (y - ray.origin.y) / ray.dir.y;
    if (t <= 0) {
      aim = undefined;
      return;
    }
    const zx = ray.origin.x + ray.dir.x * t;
    const zz = ray.origin.z + ray.dir.z * t;
    aim = zoneToSite(site.frame, zx, zz);
  };

  const onKey = (code: string, m: { ctrl: boolean; shift: boolean }): boolean => {
    if (m.ctrl && code === 'KeyZ') {
      if (m.shift) redo();
      else undo();
      return true;
    }
    if (m.ctrl && code === 'KeyY') {
      redo();
      return true;
    }
    if (m.ctrl) return false;
    switch (code) {
      case 'KeyR':
        rotate(m.shift);
        return true;
      case 'KeyX':
        tool = tool === 'remove' ? 'place' : 'remove';
        dragFrom = undefined;
        rev++;
        return true;
      case 'KeyQ':
        eyedrop();
        return true;
      case 'Tab':
        showGrid = !showGrid;
        rev++;
        return true;
      case 'PageUp':
        setLevel(1);
        return true;
      case 'PageDown':
        setLevel(-1);
        return true;
      case 'Enter':
        build();
        return true;
      case 'Escape':
      case 'KeyB':
        close();
        // The same press must not reach the on-foot keys too (Escape there is the menu,
        // B opens build mode again).
        ctx.input.endTick();
        return true;
    }
    return false;
  };

  const PAN_KEYS = new Set([
    'KeyW',
    'KeyA',
    'KeyS',
    'KeyD',
    'ArrowUp',
    'ArrowDown',
    'ArrowLeft',
    'ArrowRight',
  ]);

  let detach: (() => void) | undefined;
  const attachInput = (): void => {
    const canvas = deps.canvas();
    const onKeyDown = (e: KeyboardEvent): void => {
      if (!active) return;
      if ((e.target as HTMLElement | null)?.tagName === 'INPUT') return;
      if (PAN_KEYS.has(e.code)) {
        keys.add(e.code);
        e.preventDefault();
        return;
      }
      if (e.repeat) return;
      if (onKey(e.code, { ctrl: e.ctrlKey || e.metaKey, shift: e.shiftKey })) e.preventDefault();
    };
    const onKeyUp = (e: KeyboardEvent): void => {
      keys.delete(e.code);
    };
    const onMove = (e: MouseEvent): void => {
      if (orbiting) {
        cam.yaw -= (e.clientX - orbiting.x) * 0.006;
        cam.pitch = Math.max(
          PITCH_MIN,
          Math.min(PITCH_MAX, cam.pitch + (e.clientY - orbiting.y) * 0.005),
        );
        orbiting = { x: e.clientX, y: e.clientY };
      }
      if (!canvas) return;
      const r = canvas.getBoundingClientRect();
      mouse = { x: e.clientX - r.left, y: e.clientY - r.top };
    };
    const onDown = (e: MouseEvent): void => {
      if (e.button === 2) {
        orbiting = { x: e.clientX, y: e.clientY };
        return;
      }
      if (e.button === 0) press();
    };
    const onUp = (e: MouseEvent): void => {
      if (e.button === 2) orbiting = undefined;
      if (e.button === 0) release();
    };
    const onWheel = (e: WheelEvent): void => {
      cam.dist = Math.max(DIST_MIN, Math.min(DIST_MAX, cam.dist * 1.1 ** (e.deltaY / 100)));
      e.preventDefault();
    };
    const onMenu = (e: Event): void => e.preventDefault();
    const onLeave = (): void => {
      mouse = undefined;
      aim = undefined;
    };
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    canvas?.addEventListener('mousedown', onDown);
    canvas?.addEventListener('wheel', onWheel, { passive: false });
    canvas?.addEventListener('contextmenu', onMenu);
    canvas?.addEventListener('mouseleave', onLeave);
    detach = () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      canvas?.removeEventListener('mousedown', onDown);
      canvas?.removeEventListener('wheel', onWheel);
      canvas?.removeEventListener('contextmenu', onMenu);
      canvas?.removeEventListener('mouseleave', onLeave);
    };
  };

  const press = (): void => {
    if (!active || !aim) return;
    if (tool === 'remove') return;
    const d = def();
    if (!d || !held) return;
    dragFrom = aimPiece(d, held, aim, placeLevel(d));
  };

  const release = (): void => {
    if (!active) return;
    if (tool === 'remove') {
      removeNow();
      return;
    }
    if (dragFrom) placeNow();
  };

  // --- Open and close -------------------------------------------------------------------------

  const open = (): string | undefined => {
    if (active) return undefined;
    if (!ashore.active || ashore.inBoat) return 'Get ashore first';
    if (ashore.character.swimming) return 'Not in the water';
    const why = deps.blocked();
    if (why) return why;
    const at = ashore.zoneAt();
    const held = hideouts.siteAt(at, BUILD_MARGIN_M);
    // A site nobody holds opens too, and the first thing built claims it (piece W).
    const s = held ?? hideouts.openSiteAt(at, BUILD_MARGIN_M);
    if (!s) return 'Nothing to build here: walk into your hideout or onto a site';
    site = s;
    grid = s.grid.clone();
    log.clear();
    level = 0;
    tool = 'place';
    dragFrom = undefined;
    message = held
      ? undefined
      : s.site.lease
        ? `${s.site.lease.from} own this ground: build without a lease and you're squatting`
        : 'Nobody holds this site: the first thing you build claims it';
    aim = undefined;
    // The camera out over the water, looking inland at where you stand.
    const local = zoneToSite(s.frame, at.x, at.z);
    const w = s.frame.cols * 2;
    const dd = s.frame.rows * 2;
    const c = siteToZone(
      s.frame,
      Math.max(0, Math.min(w, local.x)),
      Math.max(0, Math.min(dd, local.z)),
    );
    cam.tx = c.x;
    cam.tz = c.z;
    cam.yaw = Math.atan2(-s.frame.inland.x, -s.frame.inland.z) + 0.5;
    cam.pitch = 0.85;
    cam.dist = 30;
    rev++;
    deps.transition('build');
    deps.sounds?.opened();
    return undefined;
  };

  const close = (): void => {
    if (!active) return;
    deps.transition('onFoot');
    deps.sounds?.closed();
  };

  const mode: Mode = {
    id: 'build',
    enter() {
      active = true;
      ctx.input.context = 'build';
      ashore.cameraOverride = cameraPose;
      attachInput();
      document.body.dataset['build'] = site?.hideoutId ?? '';
    },
    exit() {
      active = false;
      detach?.();
      detach = undefined;
      keys.clear();
      orbiting = undefined;
      dragFrom = undefined;
      ashore.cameraOverride = undefined;
      deps.panel(undefined);
      lastPanel = '';
      deps.view()?.setOverlay(undefined);
      ashore.refreshScene();
      delete document.body.dataset['build'];
      site = undefined;
      grid = undefined;
    },
    update(dt) {
      if (!ashore.active) {
        close();
        return;
      }
      if (!site) return;
      // WASD pans across the site, relative to where the camera looks.
      let f = 0;
      let r = 0;
      if (keys.has('KeyW') || keys.has('ArrowUp')) f += 1;
      if (keys.has('KeyS') || keys.has('ArrowDown')) f -= 1;
      if (keys.has('KeyD') || keys.has('ArrowRight')) r += 1;
      if (keys.has('KeyA') || keys.has('ArrowLeft')) r -= 1;
      if (f || r) {
        const speed = PAN_MS * (0.4 + cam.dist / 40) * dt;
        const fx = -Math.sin(cam.yaw);
        const fz = -Math.cos(cam.yaw);
        cam.tx += (fx * f + Math.cos(cam.yaw) * r) * speed;
        cam.tz += (fz * f - Math.sin(cam.yaw) * r) * speed;
        // Kept over the site, give or take a margin.
        const l = zoneToSite(site.frame, cam.tx, cam.tz);
        const m = 12;
        const cl = siteToZone(
          site.frame,
          Math.max(-m, Math.min(site.frame.cols * 2 + m, l.x)),
          Math.max(-m, Math.min(site.frame.rows * 2 + m, l.z)),
        );
        cam.tx = cl.x;
        cam.tz = cl.z;
      }
    },
    render(alpha, frameSeconds) {
      ashore.mode.render?.(alpha, frameSeconds);
      // The camera just drawn is the build camera: aim through it for the next frame.
      aimFromMouse();
      recomputeCursor();
      deps.view()?.setOverlay(overlay());
      pushPanel();
    },
  };

  const actions: BuildActions = {
    category(id) {
      const c = PALETTE_CATEGORIES.find((x) => x.id === id);
      if (!c) return;
      if (c.id !== category) deps.sounds?.page();
      category = c.id;
      const first = piecesIn(c.id)[0];
      if (first) held = { id: first.id, variant: 0, rot: 0, flip: false };
      tool = 'place';
      rev++;
    },
    piece(id, variant) {
      const d = findStructure(id);
      if (!d) return;
      held = { id, variant, rot: held?.rot ?? 0, flip: held?.flip ?? false };
      if (d.placement !== 'prop') held.rot &= 3;
      category = d.category;
      tool = 'place';
      rev++;
    },
    tool(t) {
      tool = t;
      dragFrom = undefined;
      rev++;
    },
    level: setLevel,
    grid() {
      showGrid = !showGrid;
      rev++;
    },
    undo,
    redo,
    build,
    close,
  };

  return {
    mode,
    get active() {
      return active;
    },
    get hideoutId() {
      return site?.hideoutId;
    },
    open,
    close,
    cut() {
      if (!active || !site) return undefined;
      const d = def();
      return {
        hideoutId: site.hideoutId,
        level,
        roofs: tool === 'remove' || (!!d && roofish(d)),
      };
    },
    actions,
    dev: {
      aim(x, z) {
        aim = { x, z };
        mouse = undefined;
      },
      press,
      release,
      key(code, mods) {
        onKey(code, { ctrl: !!mods?.ctrl, shift: !!mods?.shift });
      },
      state() {
        if (!site || !grid) return undefined;
        recomputeCursor();
        return {
          hideout: site.hideoutId,
          level,
          tool,
          held: held && { ...held },
          aim: aim && { ...aim },
          ghosts: ghosts.map((g) => ({
            piece: { ...g.piece },
            ok: g.ok,
            ...(g.reason ? { reason: g.reason } : {}),
          })),
          marked: markedUids.length,
          built: grid.built().length,
          planned: grid.planned().length,
          canUndo: log.canUndo,
          canRedo: log.canRedo,
          message,
          camera: cameraPose(),
        };
      },
    },
  };
}
