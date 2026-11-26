/* eslint-disable @typescript-eslint/no-non-null-assertion -- test lookups of pieces just placed */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { migrateSave } from '../src/core/save/migrate';
import { SECONDS_PER_GAME_DAY } from '../src/core/time';
import {
  EditLog,
  gridHasStrongbox,
  gridStorageCu,
  placePiece,
  planRemoval,
  refundFor,
  removePiece,
} from '../src/sim/hideouts/edit';
import {
  BuildGrid,
  packGrid,
  unpackGrid,
  type BuildSite,
  type Piece,
} from '../src/sim/hideouts/grid';
import { hideoutColliders, placedRender } from '../src/sim/hideouts/placed';
import {
  hasStrongbox,
  stashCash,
  starterLayout,
  storageCapacity,
  takeCash,
  type HideoutState,
} from '../src/sim/hideouts/stash';
import { STARTERS, STRUCTURES, structure } from '../src/sim/hideouts/structures';
import { canPlace, REFUSAL_TEXT, type Refusal } from '../src/sim/hideouts/validity';
import { buildSeconds, queueSummary, runWorkSession, seasonFactor } from '../src/sim/hideouts/work';
import { parseWorldState, worldStateSchema } from '../src/sim/world-state';

/** Flat dry ground at the floor datum. */
const flat: BuildSite = { cols: 12, rows: 10, baseM: 2, ground: () => 2 };

/**
 * A beach: the lake for z < 8 m, deepening 0.5 m per meter out, and dry land rising
 * gently inland to meet the datum at z = 12.
 */
const shore: BuildSite = {
  cols: 12,
  rows: 10,
  baseM: 2,
  ground: (_x, z) => (z < 8 ? (z - 8) * 0.5 : Math.min(2, (z - 8) * 0.5)),
};

const P = (id: string, col: number, row: number, o: Partial<Piece> = {}): Piece => ({
  id: `build.${id}`,
  col,
  row,
  level: 0,
  rot: 0,
  variant: 0,
  paint: 0,
  ...o,
});

function refusal(grid: BuildGrid, site: BuildSite, p: Piece): Refusal | undefined {
  const r = canPlace(grid, site, p);
  return r.ok ? undefined : r.reason;
}

/** Places and builds a list of pieces, failing on the first refusal. */
function build(site: BuildSite, ps: Piece[], grid = new BuildGrid()): BuildGrid {
  for (const p of ps) {
    const r = placePiece(grid, site, p);
    if (!r.ok) throw new Error(`${p.id} at ${p.col},${p.row},${p.level}: ${r.reason}`);
    grid.setBuilt(r.uids[0]!, true);
  }
  return grid;
}

/** A 2×2 room on foundations with plank walls all round, on flat ground. */
function room(): Piece[] {
  const ps: Piece[] = [];
  for (const [c, r] of [
    [0, 0],
    [1, 0],
    [0, 1],
    [1, 1],
  ] as const) {
    ps.push(P('foundation', c, r));
  }
  ps.push(
    P('wall', 0, 0),
    P('wall_door', 1, 0),
    P('wall', 1, 0, { rot: 1 }),
    P('wall', 1, 1, { rot: 1 }),
  );
  ps.push(
    P('wall', 0, 1, { rot: 2 }),
    P('wall', 1, 1, { rot: 2 }),
    P('wall', 0, 0, { rot: 3 }),
    P('wall', 0, 1, { rot: 3 }),
  );
  return ps;
}

describe('the catalog (structures.json)', () => {
  it('has the ~60 pieces of plan 09 §16.2 in timber, plank and brownstone', () => {
    expect(STRUCTURES.length).toBeGreaterThanOrEqual(60);
    const materials = new Set(STRUCTURES.flatMap((s) => s.variants.map((v) => v.material)));
    for (const m of ['timber', 'plank', 'brownstone', 'tarpaper']) expect(materials).toContain(m);
    for (const id of [
      'strongbox',
      'bunk',
      'stove',
      'workbench',
      'smithy',
      'cooperage',
      'distillery',
      'slipway',
      'mooring_post',
      'cellar_vault',
      'warehouse_bay',
    ]) {
      expect(() => structure(`build.${id}`)).not.toThrow();
    }
  });

  it('costs only goods that exist', () => {
    const goods = (
      JSON.parse(readFileSync(join(import.meta.dirname, '..', 'data', 'goods.json'), 'utf8')) as {
        id: string;
      }[]
    ).map((g) => g.id);
    for (const s of STRUCTURES)
      for (const v of s.variants)
        for (const g of Object.keys(v.cost)) expect(goods, s.id).toContain(g);
  });

  it('gives storage as plan 09 §5.4 does', () => {
    const cu = (id: string): number | undefined => structure(`build.${id}`).functions.storageCu;
    expect([
      cu('crate_stack'),
      cu('barrel_rack'),
      cu('shelving'),
      cu('warehouse_bay'),
      cu('cellar_vault'),
    ]).toEqual([5, 6, 8, 25, 40]);
  });

  it('has text for every refusal', () => {
    for (const t of Object.values(REFUSAL_TEXT)) expect(t.length).toBeGreaterThan(3);
  });
});

describe('validity (plan 09 §4.3)', () => {
  it('keeps pieces inside the build bounds', () => {
    const g = new BuildGrid();
    expect(refusal(g, flat, P('foundation', 12, 0))).toBe('bounds');
    expect(refusal(g, flat, P('foundation', -1, 0))).toBe('bounds');
    expect(refusal(g, flat, P('warehouse_bay', 11, 0))).toBe('bounds');
    expect(refusal(g, flat, P('foundation', 11, 9))).toBeUndefined();
    // The bounds' far edge can take a fence.
    expect(refusal(g, flat, P('rail_fence', 11, 0, { rot: 1 }))).toBeUndefined();
  });

  it('refuses overlap in cells and on edges, from either side', () => {
    const g = build(flat, [
      P('foundation', 0, 0),
      P('foundation', 1, 0),
      P('wall', 0, 0, { rot: 1 }),
    ]);
    expect(refusal(g, flat, P('foundation', 0, 0, { variant: 1 }))).toBe('occupied');
    // The same edge spelled from the next cell.
    expect(refusal(g, flat, P('wall', 1, 0, { rot: 3 }))).toBe('occupied');
    // A base and what stands on it are different slots.
    expect(refusal(g, flat, P('crate_stack', 0, 0))).toBeUndefined();
  });

  it('turns footprints with the piece', () => {
    const g = new BuildGrid();
    expect(refusal(g, flat, P('workbench', 0, 0))).toBe('noFloor');
    build(flat, [P('foundation', 0, 0), P('foundation', 0, 1)], g);
    expect(refusal(g, flat, P('workbench', 0, 0))).toBe('noFloor');
    expect(refusal(g, flat, P('workbench', 0, 0, { rot: 1 }))).toBeUndefined();
  });

  it('needs a floor under what stands, unless it may stand on bare ground', () => {
    const g = new BuildGrid();
    expect(refusal(g, flat, P('wall', 0, 0))).toBe('noFloor');
    expect(refusal(g, flat, P('bunk', 0, 0))).toBe('noFloor');
    expect(refusal(g, flat, P('palisade', 0, 0))).toBeUndefined();
    expect(refusal(g, flat, P('well', 0, 0))).toBeUndefined();
    expect(refusal(g, flat, P('lantern', 4, 4))).toBeUndefined();
    expect(refusal(g, flat, P('fire_barrel', 6, 6))).toBeUndefined();
    expect(refusal(g, flat, P('table', 4, 4))).toBe('noFloor');
  });

  it('carries upper floors and roofs on walls below, two cells out at most', () => {
    const g = build(flat, room());
    expect(refusal(g, flat, P('floor', 0, 0, { level: 1 }))).toBeUndefined();
    expect(refusal(g, flat, P('floor', 4, 0, { level: 1 }))).toBe('noSupport');
    // A floor reaching out past the east wall (which carries the cells either side of
    // it): two cells beyond are fine, the third falls.
    build(
      flat,
      [
        P('floor', 1, 0, { level: 1 }),
        P('floor', 2, 0, { level: 1 }),
        P('floor', 3, 0, { level: 1 }),
        P('floor', 4, 0, { level: 1 }),
      ],
      g,
    );
    expect(refusal(g, flat, P('floor', 5, 0, { level: 1 }))).toBe('noSupport');
    // Roofs on the walls of level 0, on level 1.
    const r = build(flat, room());
    expect(refusal(r, flat, P('roof_slope', 0, 0, { level: 1 }))).toBeUndefined();
    expect(refusal(r, flat, P('roof_slope', 5, 5, { level: 1 }))).toBe('noSupport');
    expect(refusal(r, flat, P('roof_slope', 0, 0, { level: 0 }))).toBe('level');
  });

  it('builds two floors at most, roofs one above', () => {
    const g = new BuildGrid();
    expect(refusal(g, flat, P('floor', 0, 0, { level: 2 }))).toBe('level');
    expect(refusal(g, flat, P('roof_flat', 0, 0, { level: 3 }))).toBe('level');
    expect(refusal(g, flat, P('foundation', 0, 0, { level: 1 }))).toBe('level');
  });

  it('fits doors and windows only into their frames', () => {
    const g = build(flat, room());
    expect(refusal(g, flat, P('door_plank', 1, 0))).toBeUndefined();
    expect(refusal(g, flat, P('door_plank', 0, 0))).toBe('noFrame');
    expect(refusal(g, flat, P('shutters', 1, 0))).toBe('noFrame');
  });

  it('fits foundations to the terrain: dry, no cliffs, reaching down so far', () => {
    const g = new BuildGrid();
    // Out in the lake.
    expect(refusal(g, shore, P('foundation', 0, 0))).toBe('inWater');
    // Dry but low: the ground at z 8–10 m is 0–1 m up, 1–2 m under the datum.
    expect(refusal(g, shore, P('foundation', 0, 4))).toBeUndefined();
    expect(refusal(g, shore, P('floor', 0, 4))).toBe('groundTooLow');
    // A cliff rising into the floor.
    const hill: BuildSite = { ...flat, ground: (x) => (x > 4 ? 4 : 2) };
    expect(refusal(g, hill, P('foundation', 2, 0))).toBe('cliff');
    // A piling reaches into the lake.
    expect(refusal(g, shore, P('piling', 0, 3))).toBeUndefined();
    expect(refusal(g, { ...shore, ground: () => -9 }, P('piling', 0, 0))).toBe('groundTooLow');
  });

  it('keeps piers in water between their depths, and slipways at the shore', () => {
    const g = new BuildGrid();
    expect(refusal(g, shore, P('pier', 0, 5))).toBe('needsWater');
    expect(refusal(g, shore, P('pier', 0, 3))).toBeUndefined();
    expect(refusal(g, shore, P('pier', 0, 0))).toBeUndefined();
    const deep: BuildSite = { ...shore, ground: () => -9 };
    expect(refusal(g, deep, P('pier', 0, 0))).toBe('tooDeep');
    // Piers cross shallow water on their pilings, so a bar under 0.1 m is fine too.
    const shoal: BuildSite = { ...shore, ground: () => -0.1 };
    expect(refusal(g, shoal, P('pier', 0, 0))).toBeUndefined();
    const dry: BuildSite = { ...shore, ground: () => 0.2 };
    expect(refusal(g, dry, P('pier', 0, 0))).toBe('needsWater');
    // The slipway runs 4 cells from dry land at row 4 out to 2.5 m at row 1.
    expect(refusal(g, shore, P('slipway', 0, 1))).toBeUndefined();
    expect(refusal(g, shore, P('slipway', 0, 0))).toBe('needsShore');
  });

  it('moors only beside water deep enough', () => {
    const g = build(shore, [P('pier', 0, 3), P('pier', 0, 1)]);
    // Beside row 3 the open water at row 2 is 3–4 m out: 2 m deep.
    expect(refusal(g, shore, P('mooring_post', 0, 3))).toBeUndefined();
    const shoal: BuildSite = { ...shore, ground: (_x, z) => (z < 8 ? -0.6 : 2) };
    const s = build(shoal, [P('pier', 0, 3)]);
    expect(refusal(s, shoal, P('mooring_post', 0, 3))).toBe('noDeepWater');
  });

  it('explains every refusal (exit criterion 2)', () => {
    const ids = STRUCTURES.map((s) => s.id);
    const g = build(shore, [
      P('foundation', 2, 5),
      P('foundation', 3, 5),
      P('wall', 2, 5),
      P('pier', 2, 3),
    ]);
    fc.assert(
      fc.property(
        fc.constantFrom(...ids),
        fc.integer({ min: -2, max: 14 }),
        fc.integer({ min: -2, max: 12 }),
        fc.integer({ min: -1, max: 3 }),
        fc.integer({ min: -1, max: 24 }),
        fc.integer({ min: -1, max: 4 }),
        (id, col, row, level, rot, variant) => {
          const r = canPlace(g, shore, { id, col, row, level, rot, variant, paint: 0 });
          if (!r.ok) expect(REFUSAL_TEXT[r.reason]).toBeTruthy();
        },
      ),
      { numRuns: 2000 },
    );
    expect(refusal(g, shore, P('nonsense', 0, 0))).toBe('unknown');
  });
});

describe('removing and the refund (plan 09 §4.3, §6.3)', () => {
  it('refuses to take out what holds others up, or takes them along', () => {
    const g = build(flat, [...room(), P('roof_flat', 1, 1, { level: 1 }), P('bunk', 0, 0)]);
    const foundation = g.all().find((p) => p.piece.id === 'build.foundation')!.uid;
    const r = planRemoval(g, flat, foundation);
    expect(r).toMatchObject({ ok: false, reason: 'supports' });
    const deps = (r as { dependents: number[] }).dependents.map((u) => g.get(u)!.piece.id);
    // Its walls and the bunk fall with it; the roof stays on the east and south walls.
    expect(deps).toContain('build.bunk');
    expect(deps).toContain('build.wall');
    expect(deps).not.toContain('build.roof_flat');
    const before = g.size;
    const done = removePiece(g, flat, foundation, { withDependents: true });
    expect(done.ok).toBe(true);
    expect(g.size).toBe(before - 1 - deps.length);
  });

  it('refunds 75% of a built piece, rounded down per good; ghosts nothing', () => {
    expect(refundFor([P('foundation', 0, 0)])).toEqual({ 'good.lumber': 3 });
    expect(refundFor([P('wall', 0, 0, { variant: 1 })])).toEqual({ 'good.lumber': 1 });
    expect(refundFor([P('wall', 0, 0, { variant: 1 }), P('wall', 1, 0, { variant: 1 })])).toEqual({
      'good.lumber': 3,
      'good.hardware': 1,
    });
    const g = new BuildGrid();
    const r = placePiece(g, flat, P('foundation', 0, 0));
    expect(removePiece(g, flat, (r as { uids: number[] }).uids[0]!)).toEqual({
      ok: true,
      uids: [1],
      refund: {},
    });
  });

  it('keeps the storage the goods need, and the strongbox while it holds cash', () => {
    const g = build(flat, [
      P('foundation', 0, 0),
      P('foundation', 1, 0),
      P('shelving', 0, 0),
      P('strongbox', 1, 0),
    ]);
    const shelf = g.all().find((p) => p.piece.id === 'build.shelving')!.uid;
    const box = g.all().find((p) => p.piece.id === 'build.strongbox')!.uid;
    expect(planRemoval(g, flat, shelf, { load: { goodsCu: 3, cash: 0 } })).toMatchObject({
      ok: false,
      reason: 'storageInUse',
    });
    expect(planRemoval(g, flat, shelf, { load: { goodsCu: 0, cash: 0 } }).ok).toBe(true);
    expect(planRemoval(g, flat, box, { load: { goodsCu: 0, cash: 100 } })).toMatchObject({
      ok: false,
      reason: 'cashInStrongbox',
    });
    expect(planRemoval(g, flat, box, { load: { goodsCu: 0, cash: 0 } }).ok).toBe(true);
  });
});

describe('undo and redo', () => {
  it('steps placements and removals back and forth', () => {
    const g = new BuildGrid();
    const log = new EditLog();
    log.place(g, flat, P('foundation', 0, 0));
    log.placeMany(g, flat, [P('foundation', 1, 0), P('foundation', 2, 0), P('wall', 5, 5)]);
    expect(g.size).toBe(3);
    const snap = JSON.stringify(packGrid(g));
    expect(log.undo(g)).toBe(true);
    expect(g.size).toBe(1);
    expect(log.redo(g)).toBe(true);
    expect(JSON.stringify(packGrid(g))).toBe(snap);
    expect(log.redo(g)).toBe(false);
    log.undo(g);
    log.undo(g);
    expect(g.size).toBe(0);
    expect(log.canUndo).toBe(false);
  });

  it('brings a deconstructed piece back as a ghost, and the refund stays', () => {
    const g = build(flat, [P('foundation', 0, 0)]);
    const log = new EditLog();
    const r = log.remove(g, flat, g.all()[0]!.uid);
    expect(r).toMatchObject({ ok: true, refund: { 'good.lumber': 3 } });
    log.undo(g);
    expect(g.all().map((p) => p.built)).toEqual([false]);
    log.redo(g);
    expect(g.size).toBe(0);
  });

  it('forgets the redo after a new edit', () => {
    const g = new BuildGrid();
    const log = new EditLog();
    log.place(g, flat, P('foundation', 0, 0));
    log.undo(g);
    log.place(g, flat, P('foundation', 1, 0));
    expect(log.canRedo).toBe(false);
  });
});

describe('the work session (plan 09 §6.3)', () => {
  const MAY = 0;
  const lumber = (qty: number) => ({ good: 'good.lumber', qty });

  it('builds ghosts in an order that stands, from storage then the hold', () => {
    const g = new BuildGrid();
    // Placed wall first, then its foundation: the session builds the foundation first.
    placePiece(g, flat, P('palisade', 0, 0));
    placePiece(g, flat, P('foundation', 2, 0));
    placePiece(g, flat, P('wall', 2, 0, { variant: 0 }));
    const storage = [lumber(5)];
    const hold = [lumber(10), { good: 'good.lumber', qty: 50, contract: 'c1' } as never];
    const r = runWorkSession(g, flat, [storage, hold], { crewTier: 1, gameSeconds: MAY });
    expect(r.built).toHaveLength(3);
    expect(r.used).toEqual({ 'good.lumber': 9 });
    expect(storage).toEqual([]);
    expect(hold[0]).toEqual(lumber(6));
    expect((hold[1] as { qty: number }).qty).toBe(50);
    expect(r.seconds).toBe((1.5 + 3 + 2) * 3600);
    expect(r.left).toBe(0);
  });

  it('leaves what the materials won’t cover as ghosts (a partial build)', () => {
    const g = new BuildGrid();
    for (let c = 0; c < 4; c++) placePiece(g, flat, P('foundation', c, 0));
    const r = runWorkSession(g, flat, [[lumber(9)]], { crewTier: 1, gameSeconds: MAY });
    expect(r.built).toHaveLength(2);
    expect(r.left).toBe(2);
    const q = queueSummary(g, [[lumber(1)]], { crewTier: 1, gameSeconds: MAY });
    expect(q).toMatchObject({ pieces: 2, needs: { 'good.lumber': 8 }, have: { 'good.lumber': 1 } });
  });

  it('goes faster with a crew and slower in late autumn', () => {
    expect(buildSeconds(10, { crewTier: 3, gameSeconds: MAY })).toBe(5 * 3600);
    expect(seasonFactor(MAY)).toBe(1);
    // 1 game day = 1 calendar week from May 7: 27 game days is mid-November.
    expect(seasonFactor(27 * SECONDS_PER_GAME_DAY)).toBe(1.5);
    expect(seasonFactor(22 * SECONDS_PER_GAME_DAY)).toBe(1.25);
  });
});

describe('placing for the renderer and colliders', () => {
  it('gives a 3-wide gable roof its ridge rise, and foundations their reach', () => {
    const g = build(shore, [P('foundation', 0, 4)]);
    const [f] = placedRender(g, shore);
    expect(f).toMatchObject({ x: 1, z: 9, y: 0, material: 'timber' });
    expect(f!.extendM).toBeCloseTo(2);
    const r = new BuildGrid();
    for (let row = 0; row < 3; row++)
      r.add(
        P(row === 1 ? 'roof_ridge' : 'roof_slope', 0, row, { level: 1, rot: row === 2 ? 2 : 0 }),
        true,
      );
    expect(placedRender(r, flat).map((p) => p.riseM ?? 0)).toEqual([0, 1.2, 0]);
    // Gables beside it rise with it; a chimney's stack starts at the eave.
    r.add(P('wall_gable_peak', 0, 1, { level: 1, rot: 3 }), true);
    r.add(P('wall_gable', 0, 0, { level: 1, rot: 3 }), true);
    r.add(P('chimney', 4, 4), true);
    expect(
      placedRender(r, flat)
        .slice(3)
        .map((p) => [p.riseM ?? 0, p.y]),
    ).toEqual([
      [1.2, 3],
      [0, 3],
      [0, 3],
    ]);
  });

  it('blocks walls, leaves a doorway, and walks on floors', () => {
    const g = build(flat, room());
    const c = hideoutColliders(g, flat);
    expect(c.filter((k) => k.kind === 'floor')).toHaveLength(4);
    expect(c.filter((k) => k.kind === 'door')).toHaveLength(1);
    const door = c.find((k) => k.kind === 'door')!;
    expect(door.minX).toBeCloseTo(3 - 0.55);
    expect(door.maxX).toBeCloseTo(3 + 0.55);
    // Ghosts don't collide.
    placePiece(g, flat, P('bunk', 0, 0));
    expect(hideoutColliders(g, flat)).toHaveLength(c.length);
  });
});

describe('packing (plan 09 §10) and the save (plan 16; save v10)', () => {
  it('round-trips a grid exactly, built and planned', () => {
    const g = build(flat, room());
    placePiece(g, flat, P('lantern', 5, 5, { rot: 7 }));
    placePiece(g, flat, P('bunk', 1, 1, { rot: 1, paint: 3 }));
    const packed = packGrid(g);
    expect(packed.built.length).toBe(12 * 7);
    expect(packGrid(unpackGrid(packed))).toEqual(packed);
    expect(JSON.parse(JSON.stringify(packed))).toEqual(packed);
  });

  it('lays the starter shack piece by piece as the rules allow, with 40 CU and a strongbox', () => {
    // The short pier (piece C) needs a real shore: tests/build-mode.test.ts lays it.
    for (const s of STARTERS.filter((x) => x.id !== 'starter.pier')) {
      const g = new BuildGrid();
      const pieces = unpackGrid(s.layout)
        .all()
        .map((p) => p.piece);
      build(flat, pieces, g);
      expect(gridStorageCu(g)).toBe(40);
      expect(gridHasStrongbox(g)).toBe(true);
      expect(g.all().some((p) => structure(p.piece.id).functions.bed)).toBe(true);
      expect(g.all().some((p) => structure(p.piece.id).functions.warmth)).toBe(true);
    }
  });

  const read = (f: string) =>
    JSON.parse(readFileSync(join(import.meta.dirname, 'fixtures', 'saves', f), 'utf8')) as {
      saveVersion: number;
      state: Record<string, unknown>;
    };

  it('migrates a 0.7.x Stockton stash into the pre-built shack with its goods and cash (exit criterion 7)', () => {
    const v9 = read('v9-stash.json');
    const before = (v9.state['hideouts'] as Record<string, HideoutState>)['hideout.stockton']!;
    const state = parseWorldState(migrateSave(v9.state, 9));
    const h = state.hideouts!['hideout.stockton']!;
    expect(h.storage).toEqual(before.storage);
    expect(h.layout).toEqual(starterLayout('site.stockton'));
    expect(storageCapacity(h)).toBe(40);
    expect(hasStrongbox(h)).toBe(true);
    const player = { purse: 0 };
    expect(takeCash(player, h, 42_500)).toMatchObject({ ok: true });
    expect(stashCash(player, h, 500)).toMatchObject({ ok: true });
  });

  it('keeps a v10 save’s pieces exactly, ghosts too', () => {
    const v10 = read('v10.json');
    const h = (v10.state['hideouts'] as Record<string, HideoutState>)['hideout.stockton']!;
    const state = worldStateSchema.parse(structuredClone(v10.state));
    const loaded = state.hideouts!['hideout.stockton']!;
    expect(loaded.layout).toEqual(h.layout);
    expect(packGrid(unpackGrid(loaded.layout))).toEqual(h.layout);
    expect(unpackGrid(loaded.layout).planned()).toHaveLength(2);
  });

  it('packs 1,500 pieces in about 7 numbers each', () => {
    const g = new BuildGrid();
    for (let i = 0; i < 1500; i++) g.add(P('foundation', i % 40, Math.floor(i / 40)), true);
    const packed = packGrid(g);
    expect(packed.built.length).toBe(1500 * 7);
    expect(JSON.stringify(packed).length).toBeLessThan(1500 * 20);
  });
});
