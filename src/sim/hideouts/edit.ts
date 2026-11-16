import { BuildGrid, type BuildSite, type Piece } from './grid';
import { REFUND_SHARE, structure } from './structures';
import { canPlace, dependentsOf, type Check, type Refusal } from './validity';

/**
 * Edits to a hideout's grid (plan 09 §6.3, §9; Phase 8 piece A): placing a ghost,
 * removing pieces with what stands on them, the refund, and undo and redo as an edit log.
 *
 * Placing is free and instant: a placed piece is **planned** until a work session builds
 * it (work.ts). Removing a planned piece costs and refunds nothing; removing a built one
 * refunds 75% of its materials, rounded down per good, into the hideout's storage.
 *
 * Undo puts the grid back as it was, with one exception kept on purpose: undoing the
 * removal of a built piece brings it back as a ghost, and the refund stays in storage.
 * Taking materials back out of storage by pressing Ctrl+Z would be a surprise, and the
 * ghost is one work session from standing again.
 */

export type Goods = Record<string, number>;

/** What a hideout's storage must still hold after a removal: its goods and cash. */
export interface StorageLoad {
  goodsCu: number;
  cash: number;
}

export type EditResult =
  | { ok: true; uids: number[]; refund: Goods }
  | { ok: false; reason: Refusal; dependents?: number[] };

/** Materials for one piece in its variant. */
export function pieceCost(p: Piece): Goods {
  return { ...(structure(p.id).variants[p.variant]?.cost ?? {}) };
}

export function addGoods(into: Goods, more: Goods, times = 1): Goods {
  for (const [g, n] of Object.entries(more)) into[g] = (into[g] ?? 0) + n * times;
  return into;
}

/** The refund for deconstructing built pieces: 75% of their materials, per good, down. */
export function refundFor(pieces: readonly Piece[]): Goods {
  const total: Goods = {};
  for (const p of pieces) addGoods(total, pieceCost(p));
  const out: Goods = {};
  for (const [g, n] of Object.entries(total)) {
    const r = Math.floor(n * REFUND_SHARE);
    if (r > 0) out[g] = r;
  }
  return out;
}

/** CU of storage the hideout's built pieces give (plan 09 §5.4). */
export function gridStorageCu(grid: BuildGrid): number {
  let n = 0;
  for (const p of grid.built()) n += structure(p.piece.id).functions.storageCu ?? 0;
  return n;
}

/** Whether a built strongbox stands at the hideout, so it can hold cash. */
export function gridHasStrongbox(grid: BuildGrid): boolean {
  return grid.built().some((p) => structure(p.piece.id).functions.strongbox);
}

/** Places a ghost. */
export function placePiece(grid: BuildGrid, site: BuildSite, p: Piece): EditResult {
  const check: Check = canPlace(grid, site, p);
  if (!check.ok) return check;
  return { ok: true, uids: [grid.add(p, false)], refund: {} };
}

/**
 * What a removal would take: the piece, and everything that stands on it if
 * `withDependents`. Refuses if other pieces stand on it (and `withDependents` is off),
 * if the storage left couldn't hold the goods stored, or if it would take the only
 * strongbox with cash in it.
 */
export function planRemoval(
  grid: BuildGrid,
  site: BuildSite,
  uid: number,
  opts: { withDependents?: boolean; load?: StorageLoad } = {},
): EditResult {
  const target = grid.get(uid);
  if (!target) return { ok: false, reason: 'notThere' };
  const dependents = dependentsOf(grid, site, [uid]);
  if (dependents.length > 0 && !opts.withDependents) {
    return { ok: false, reason: 'supports', dependents };
  }
  const uids = [uid, ...dependents];
  if (opts.load) {
    const after = grid.clone();
    const order = grid.all().map((p) => p.uid);
    const cloned = after.all().map((p) => p.uid);
    for (const u of uids) after.remove(cloned[order.indexOf(u)] as number);
    if (gridStorageCu(after) < opts.load.goodsCu) return { ok: false, reason: 'storageInUse' };
    if (opts.load.cash > 0 && gridHasStrongbox(grid) && !gridHasStrongbox(after)) {
      return { ok: false, reason: 'cashInStrongbox' };
    }
  }
  const built = uids.map((u) => grid.get(u)).flatMap((p) => (p?.built ? [p.piece] : []));
  return { ok: true, uids, refund: refundFor(built) };
}

/** Removes a piece (and its dependents if asked), returning the refund to store. */
export function removePiece(
  grid: BuildGrid,
  site: BuildSite,
  uid: number,
  opts: { withDependents?: boolean; load?: StorageLoad } = {},
): EditResult {
  const plan = planRemoval(grid, site, uid, opts);
  if (!plan.ok) return plan;
  for (const u of plan.uids) grid.remove(u);
  return plan;
}

// --- Undo and redo --------------------------------------------------------------------------

interface LoggedPiece {
  piece: Piece;
  built: boolean;
}

type Edit = { kind: 'place'; pieces: LoggedPiece[] } | { kind: 'remove'; pieces: LoggedPiece[] };

/**
 * The build mode's edit log (Ctrl+Z, Ctrl+Y). Pieces are recorded by what they are, not
 * their uid, since undoing a removal adds them back under new uids. A work session or
 * anything else that changes the grid outside the log should `clear()` it.
 */
export class EditLog {
  private undos: Edit[] = [];
  private redos: Edit[] = [];

  get canUndo(): boolean {
    return this.undos.length > 0;
  }

  get canRedo(): boolean {
    return this.redos.length > 0;
  }

  clear(): void {
    this.undos = [];
    this.redos = [];
  }

  /** Places a ghost and logs it. */
  place(grid: BuildGrid, site: BuildSite, p: Piece): EditResult {
    const r = placePiece(grid, site, p);
    if (r.ok) this.push({ kind: 'place', pieces: [{ piece: { ...p }, built: false }] });
    return r;
  }

  /** Places several ghosts as one step (a dragged line or rectangle); invalid ones skipped. */
  placeMany(
    grid: BuildGrid,
    site: BuildSite,
    ps: readonly Piece[],
  ): { placed: number[]; refused: { piece: Piece; reason: Refusal }[] } {
    const placed: number[] = [];
    const logged: LoggedPiece[] = [];
    const refused: { piece: Piece; reason: Refusal }[] = [];
    for (const p of ps) {
      const r = placePiece(grid, site, p);
      if (r.ok) {
        placed.push(...r.uids);
        logged.push({ piece: { ...p }, built: false });
      } else refused.push({ piece: p, reason: r.reason });
    }
    if (logged.length > 0) this.push({ kind: 'place', pieces: logged });
    return { placed, refused };
  }

  /** Removes a piece (and its dependents if asked) and logs it. */
  remove(
    grid: BuildGrid,
    site: BuildSite,
    uid: number,
    opts: { withDependents?: boolean; load?: StorageLoad } = {},
  ): EditResult {
    const plan = planRemoval(grid, site, uid, opts);
    if (!plan.ok) return plan;
    const pieces = plan.uids
      .flatMap((u) => {
        const p = grid.get(u);
        return p ? [p] : [];
      })
      .map((p) => ({ piece: { ...p.piece }, built: p.built }));
    for (const u of plan.uids) grid.remove(u);
    this.push({ kind: 'remove', pieces });
    return plan;
  }

  /** Steps back one edit. Returns false when there's nothing to undo. */
  undo(grid: BuildGrid): boolean {
    const e = this.undos.pop();
    if (!e) return false;
    apply(grid, invert(e));
    this.redos.push(e);
    return true;
  }

  /** Steps forward one undone edit. Returns false when there's nothing to redo. */
  redo(grid: BuildGrid): boolean {
    const e = this.redos.pop();
    if (!e) return false;
    apply(grid, e);
    this.undos.push(e);
    return true;
  }

  private push(e: Edit): void {
    this.undos.push(e);
    this.redos = [];
  }
}

function invert(e: Edit): Edit {
  // An undone removal comes back as ghosts (see the module note).
  return e.kind === 'place'
    ? { kind: 'remove', pieces: e.pieces }
    : { kind: 'place', pieces: e.pieces.map((p) => ({ piece: p.piece, built: false })) };
}

const samePiece = (a: Piece, b: Piece): boolean =>
  a.id === b.id &&
  a.col === b.col &&
  a.row === b.row &&
  a.level === b.level &&
  a.rot === b.rot &&
  a.variant === b.variant &&
  a.paint === b.paint;

function apply(grid: BuildGrid, e: Edit): void {
  if (e.kind === 'place') {
    for (const p of e.pieces) grid.add(p.piece, p.built);
    return;
  }
  // Removals undo in reverse, dependents first.
  for (const p of [...e.pieces].reverse()) {
    const found = grid.all().find((q) => samePiece(q.piece, p.piece));
    if (found) grid.remove(found.uid);
  }
}
