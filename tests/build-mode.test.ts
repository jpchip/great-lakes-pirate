/* eslint-disable @typescript-eslint/no-non-null-assertion -- test lookups of pieces just placed */
// Phase 8 piece C (plan 09 §9, §16.4): the build mode's tools, the hideout sites set down
// in their zones, and Stockton's and Siskiwit's pre-built shack and short pier on the real
// ground. The baked checks skip when the zones aren't checked out (LFS pointers only).

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { attachHideouts } from '../src/gameplay/hideouts';
import { buildAshoreScene } from '../src/gameplay/onfoot/ashore-scene';
import { createCharacter, stepCharacter } from '../src/gameplay/onfoot/controller';
import { layoutHarbors } from '../src/sim/harbors';
import {
  affordable,
  aimPiece,
  DRAG_MAX,
  dragPieces,
  goodsText,
  PALETTE_CATEGORIES,
  pieceAt,
  piecesIn,
  type Held,
} from '../src/sim/hideouts/build-tools';
import { EditLog } from '../src/sim/hideouts/edit';
import {
  BuildGrid,
  mergeLayouts,
  packGrid,
  unpackGrid,
  type BuildSite,
} from '../src/sim/hideouts/grid';
import {
  buildSiteOf,
  inSiteBounds,
  siteFootprint,
  siteFrame,
  siteToZone,
  zoneToSite,
  type SiteFrame,
} from '../src/sim/hideouts/site-frame';
import {
  siteDef,
  startingHideouts,
  starterLayout,
  storageCapacity,
  hasStrongbox,
} from '../src/sim/hideouts/stash';
import { STRUCTURES, structure } from '../src/sim/hideouts/structures';
import { canPlace, cellDepth } from '../src/sim/hideouts/validity';
import { runWorkSession } from '../src/sim/hideouts/work';
import type { ZoneFrame } from '../src/core/coords';
import { loadZoneTerrain, type LoadedZone } from '../src/sim/terrain/load';
import { defFrame, manifestFrame, setPieceFootprint, zoneDef } from '../src/sim/terrain/zones';
import { createWorldState } from '../src/sim/world-state';

const def = (id: string) => structure(`build.${id}`);
const held = (id: string, o: Partial<Held> = {}): Held => ({
  id: `build.${id}`,
  variant: 0,
  rot: 0,
  flip: false,
  ...o,
});
const flat: BuildSite = { cols: 12, rows: 10, baseM: 2, ground: () => 1.4 };

describe('the build tools (plan 09 §9)', () => {
  it('centers a cell piece on the cursor and turns its footprint', () => {
    expect(aimPiece(def('foundation'), held('foundation'), { x: 5.1, z: 3.9 }, 0)).toMatchObject({
      col: 2,
      row: 1,
      rot: 0,
    });
    // A 2 × 1 workbench centered on the cursor, then turned to 1 × 2.
    const w = def('workbench');
    expect(aimPiece(w, held('workbench'), { x: 6, z: 3 }, 0)).toMatchObject({ col: 2, row: 1 });
    expect(aimPiece(w, held('workbench', { rot: 1 }), { x: 3, z: 6 }, 0)).toMatchObject({
      col: 1,
      row: 2,
      rot: 1,
    });
  });

  it('puts a wall on the cell edge nearest the cursor, and R flips its facing', () => {
    const wall = def('wall');
    // Near the -z side of cell (2, 3).
    const a = aimPiece(wall, held('wall'), { x: 5, z: 6.2 }, 0);
    expect(a).toMatchObject({ col: 2, row: 3, rot: 0 });
    // The same edge spelled from the cell in front: rot 2, facing the other way.
    const b = aimPiece(wall, held('wall', { flip: true }), { x: 5, z: 6.2 }, 0);
    expect(b).toMatchObject({ col: 2, row: 2, rot: 2 });
    // Near the +x side.
    expect(aimPiece(wall, held('wall'), { x: 5.9, z: 7 }, 0)).toMatchObject({ rot: 1 });
  });

  it('snaps props to the quarter-meter grid and turns them in 15° steps', () => {
    const p = aimPiece(def('lantern'), held('lantern', { rot: 25 }), { x: 3.13, z: 1.9 }, 1);
    expect(p).toMatchObject({ col: 13, row: 8, rot: 1, level: 1 });
  });

  it('drags walls into a line along the start edge, keeping its facing', () => {
    const wall = def('wall');
    const start = aimPiece(wall, held('wall'), { x: 1, z: 4.1 }, 0);
    const end = aimPiece(wall, held('wall'), { x: 9, z: 4.3 }, 0);
    const line = dragPieces(wall, start, end);
    expect(line.map((p) => [p.col, p.row, p.rot])).toEqual([
      [0, 2, 0],
      [1, 2, 0],
      [2, 2, 0],
      [3, 2, 0],
      [4, 2, 0],
    ]);
    // Flipped, the line is spelled from the cells in front and still one edge row.
    const fs = aimPiece(wall, held('wall', { flip: true }), { x: 1, z: 4.1 }, 0);
    const fe = aimPiece(wall, held('wall', { flip: true }), { x: 5, z: 4.1 }, 0);
    expect(dragPieces(wall, fs, fe).map((p) => [p.col, p.row, p.rot])).toEqual([
      [0, 1, 2],
      [1, 1, 2],
      [2, 1, 2],
    ]);
    // Doors don't drag.
    const door = def('door_plank');
    expect(dragPieces(door, start, end)).toEqual([end]);
  });

  it('drags floors and foundations into rectangles, capped', () => {
    const f = def('foundation');
    const a = aimPiece(f, held('foundation'), { x: 1, z: 1 }, 0);
    const b = aimPiece(f, held('foundation'), { x: 7, z: 5 }, 0);
    expect(dragPieces(f, a, b)).toHaveLength(12);
    expect(dragPieces(f, b, a)).toHaveLength(12);
    const far = aimPiece(f, held('foundation'), { x: 99, z: 99 }, 0);
    expect(dragPieces(f, a, far)).toHaveLength(DRAG_MAX);
  });

  it('picks the wall on the line under the cursor, else what stands in the cell', () => {
    const g = new BuildGrid();
    const log = new EditLog();
    for (let c = 0; c < 3; c++)
      log.place(g, flat, {
        ...aimPiece(def('foundation'), held('foundation'), { x: c * 2 + 1, z: 1 }, 0),
      });
    log.place(g, flat, aimPiece(def('wall'), held('wall'), { x: 1, z: 0.1 }, 0));
    log.place(g, flat, aimPiece(def('stove'), held('stove'), { x: 3, z: 1 }, 0));
    expect(pieceAt(g, { x: 1, z: 0.1 }, 0)?.piece.id).toBe('build.wall');
    expect(pieceAt(g, { x: 1, z: 1 }, 0)?.piece.id).toBe('build.foundation');
    expect(pieceAt(g, { x: 3, z: 1 }, 0)?.piece.id).toBe('build.stove');
    expect(pieceAt(g, { x: 30, z: 1 }, 0)).toBeUndefined();
  });

  it('lists every piece under a palette category, and counts what the goods pay for', () => {
    const listed = PALETTE_CATEGORIES.flatMap((c) => piecesIn(c.id).map((p) => p.id));
    expect(new Set(listed)).toEqual(new Set(STRUCTURES.map((s) => s.id)));
    expect(affordable({ 'good.lumber': 4 }, { 'good.lumber': 18 })).toBe(4);
    expect(affordable({ 'good.lumber': 4 }, { 'good.lumber': 18 }, { 'good.lumber': 10 })).toBe(2);
    expect(affordable({ 'good.lumber': 2, 'good.hardware': 1 }, { 'good.lumber': 18 })).toBe(0);
    expect(goodsText({ 'good.lumber': 4, 'good.hardware': 1 }, (g) => g.replace('good.', ''))).toBe(
      '4 lumber, 1 hardware',
    );
  });
});

describe('a site set down in its zone', () => {
  const fake: ZoneFrame = defFrame(zoneDef('zone.apostles'));
  it('turns between the site and the zone without a mirror', () => {
    const s = siteDef('site.stockton')!;
    const fp = siteFootprint(s, fake);
    if (!fp) throw new Error('no footprint');
    const f = siteFrame(s, fp);
    for (const [x, z] of [
      [0, 0],
      [12.5, 3],
      [40, 48],
    ] as const) {
      const p = siteToZone(f, x, z);
      const back = zoneToSite(f, p.x, p.z);
      expect(back.x).toBeCloseTo(x, 6);
      expect(back.z).toBeCloseTo(z, 6);
    }
    // Unit axes, square to each other, and inland is along turned a quarter clockwise in
    // three.js terms (x × y = z): no mirror.
    expect(Math.hypot(f.along.x, f.along.z)).toBeCloseTo(1, 6);
    expect(f.along.x * f.inland.x + f.along.z * f.inland.z).toBeCloseTo(0, 6);
    expect(f.inland.x).toBeCloseTo(-f.along.z, 6);
    expect(f.inland.z).toBeCloseTo(f.along.x, 6);
    // three.js's yaw turns +x onto along.
    expect(Math.cos(f.yaw)).toBeCloseTo(f.along.x, 6);
    expect(-Math.sin(f.yaw)).toBeCloseTo(f.along.z, 6);
    expect(inSiteBounds(f, -1, 5)).toBe(false);
    expect(inSiteBounds(f, -1, 5, 2)).toBe(true);
  });

  it('starts a claim with its shack and its short pier, the storage the prefab had', () => {
    for (const id of ['site.stockton', 'site.siskiwit']) {
      const layout = starterLayout(id);
      const g = unpackGrid(layout);
      expect(g.all().some((p) => p.piece.id === 'build.pier')).toBe(true);
      expect(g.all().some((p) => p.piece.id === 'build.mooring_post')).toBe(true);
      const h = { siteId: id, claimedAt: 0, storage: { goods: [], cash: 0 }, layout };
      expect(storageCapacity(h)).toBe(40);
      expect(hasStrongbox(h)).toBe(true);
    }
    const a = packGrid(unpackGrid(starterLayout('site.stockton')));
    const merged = mergeLayouts(a, { palette: [], built: [], planned: [] });
    expect(merged).toEqual(a);
  });
});

const dirs: Record<string, string> = { 'zone.apostles': 'apostles', 'zone.siskiwit': 'siskiwit' };
const baked = (zoneId: string): boolean => {
  const dir = join(__dirname, '..', 'public', 'world', dirs[zoneId]!);
  return (
    existsSync(join(dir, 'manifest.json')) &&
    readFileSync(join(dir, 'height', '0-0.bin')).byteLength > 200
  );
};

for (const [siteId, background] of [
  ['site.stockton', 'deckhand'],
  ['site.siskiwit', 'lumberjack'],
] as const) {
  const site = siteDef(siteId)!;
  const zoneId = site.zone;
  describe.skipIf(!baked(zoneId))(`${siteId} on the baked ground (piece C)`, () => {
    let zone: LoadedZone;
    let frame: SiteFrame;
    let build: BuildSite;
    beforeAll(async () => {
      const dir = join(__dirname, '..', 'public', 'world', dirs[zoneId]!);
      zone = await loadZoneTerrain(async (p) => new Uint8Array(readFileSync(join(dir, p))));
      frame = siteFrame(site, siteFootprint(site, manifestFrame(zone.manifest))!);
      build = buildSiteOf(frame, (x, z) => zone.terrain.heightAt(x, z));
    });

    it('lays the shack and the pier piece by piece as the rules allow', () => {
      const g = new BuildGrid();
      for (const p of unpackGrid(starterLayout(siteId)).all()) {
        expect(canPlace(g, build, p.piece), `${p.piece.id} ${p.piece.col},${p.piece.row}`).toEqual({
          ok: true,
        });
        g.add(p.piece, true);
      }
      // The pier runs from the beach out over water, the mooring post in deep enough water.
      const post = g.all().find((p) => p.piece.id === 'build.mooring_post')!;
      expect(cellDepth(build, post.piece.col, post.piece.row)).toBeGreaterThan(1.5);
      const shack = g.all().find((p) => p.piece.id === 'build.strongbox')!;
      expect(cellDepth(build, shack.piece.col, shack.piece.row)).toBe(0);
    });

    it('keeps the bounds inside the set piece, clear of the landing and its berths', () => {
      const piece = zoneDef(zoneId).setPieces.find((p) => p.id === site.setPiece)!;
      const fp = setPieceFootprint(piece, manifestFrame(zone.manifest));
      const layout = layoutHarbors(manifestFrame(zone.manifest), zone.terrain, zoneId).find(
        (l) => l.def.setPiece === site.setPiece,
      )!;
      const b = site.build!;
      expect(b.alongM).toBeGreaterThanOrEqual(-piece.alongM / 2);
      expect(b.alongM + b.cols * 2).toBeLessThanOrEqual(piece.alongM / 2);
      expect(b.inlandM + b.rows * 2).toBeLessThanOrEqual(piece.inlandM);
      expect(fp).toBeDefined();
      // The landing's deck and a hull's beam either side of it stay out of the bounds.
      for (const p of layout.piers) {
        for (let t = 0; t <= p.lengthM; t += 2) {
          for (const side of [-1, 0, 1]) {
            const off = side * (p.widthM / 2 + 4);
            const x = p.root.x + Math.sin(p.bearing) * t + Math.cos(p.bearing) * off;
            const z = p.root.z - Math.cos(p.bearing) * t + Math.sin(p.bearing) * off;
            const l = zoneToSite(frame, x, z);
            expect(inSiteBounds(frame, l.x, l.z), `${p.id} at ${t} m`).toBe(false);
          }
        }
      }
    });

    it('builds a roofed storehouse from materials, and walks on what was built', () => {
      const state = createWorldState('build');
      state.hideouts = startingHideouts(background, 0);
      const hideouts = attachHideouts({
        state,
        zone: () => ({ id: zoneId, frame: manifestFrame(zone.manifest) }),
        heightAt: (x, z) => zone.terrain.heightAt(x, z),
        openStash: () => true,
        notice: () => undefined,
      });
      const s = hideouts.sites()[0]!;
      expect(s.hideoutId).toBe(`hideout.${siteId.replace('site.', '')}`);
      const grid = s.grid.clone();
      const log = new EditLog();
      const f = def('foundation');
      // A 3 × 3 plank storehouse on timber foundations, back from the shore.
      const at = (x: number, z: number, id: string, o: Partial<Held> = {}) =>
        aimPiece(def(id), held(id, o), { x, z }, 0);
      const r = log.placeMany(
        grid,
        s.build,
        dragPieces(f, at(3, 31, 'foundation'), at(7, 35, 'foundation')),
      );
      expect(r.refused).toEqual([]);
      for (const [a, b] of [
        [at(3, 30.1, 'wall', { variant: 1 }), at(7, 30.1, 'wall', { variant: 1 })],
        [at(3, 35.9, 'wall', { variant: 1 }), at(7, 35.9, 'wall', { variant: 1 })],
        [at(2.1, 31, 'wall', { variant: 1 }), at(2.1, 35, 'wall', { variant: 1 })],
        [at(7.9, 31, 'wall', { variant: 1 }), at(7.9, 35, 'wall', { variant: 1 })],
      ] as const) {
        expect(log.placeMany(grid, s.build, dragPieces(def('wall'), a, b)).refused).toEqual([]);
      }
      // A crate stack inside, and a roof over it.
      expect(log.place(grid, s.build, at(5, 33, 'crate_stack')).ok).toBe(true);
      const roof = def('roof_flat');
      const ra = aimPiece(roof, held('roof_flat'), { x: 3, z: 31 }, 1);
      const rb = aimPiece(roof, held('roof_flat'), { x: 7, z: 35 }, 1);
      expect(log.placeMany(grid, s.build, dragPieces(roof, ra, rb)).refused).toEqual([]);
      const store = s.state.storage.goods;
      store.push({ good: 'good.lumber', qty: 200 }, { good: 'good.hardware', qty: 40 });
      const work = runWorkSession(grid, s.build, [store], { crewTier: 1, gameSeconds: 0 });
      expect(work.left).toBe(0);
      expect(work.seconds).toBeGreaterThan(0);
      const v = hideouts.version;
      hideouts.commit(s.hideoutId, grid);
      expect(hideouts.version).toBe(v + 1);
      expect(storageCapacity(s.state)).toBe(45);
      // Drawn: everything; with level 0 being edited, the roof is cut away.
      const all = hideouts.draw()[0]!.pieces;
      const cut = hideouts.draw({ hideoutId: s.hideoutId, level: 0, roofs: false })[0]!.pieces;
      expect(all.length - cut.length).toBeGreaterThanOrEqual(9);
      // Walked: stand on the storehouse floor, and a wall stops you walking out.
      const colliders = hideouts.colliders();
      const mid = siteToZone(s.frame, 5, 33);
      const box = { minX: mid.x - 80, minZ: mid.z - 80, maxX: mid.x + 80, maxZ: mid.z + 80 };
      const scene = buildAshoreScene({
        ground: {
          heightAt: (x, z) => zone.terrain.heightAt(x, z),
          x0: zone.terrain.height.x0,
          z0: zone.terrain.height.z0,
          step: zone.terrain.height.step,
        },
        center: mid,
        box,
        extra: colliders,
      });
      const c = createCharacter({ x: mid.x, y: s.frame.baseM + 0.5, z: mid.z });
      for (let t = 0; t < 30; t++)
        stepCharacter(
          c,
          { forward: 0, right: 0, run: false, crouch: false, jump: false },
          0,
          scene,
          1 / 60,
        );
      expect(c.grounded).toBe(true);
      expect(c.position.y).toBeCloseTo(s.frame.baseM, 1);
      // Walk toward the sea (local -z) for three seconds: the front wall holds you in.
      const heading = Math.atan2(-s.frame.inland.x, s.frame.inland.z);
      for (let t = 0; t < 180; t++)
        stepCharacter(
          c,
          { forward: 1, right: 0, run: false, crouch: false, jump: false },
          heading,
          scene,
          1 / 60,
        );
      const l = zoneToSite(s.frame, c.position.x, c.position.z);
      expect(l.z).toBeGreaterThan(30);
      // F at the strongbox opens the stash; at the new crate stack, the stores.
      const sb = hideouts.strongbox()!;
      expect(hideouts.prompt({ x: sb.x + 1, y: sb.y, z: sb.z })?.text).toBe('Open the stash');
      expect(hideouts.prompt({ x: mid.x, y: s.frame.baseM, z: mid.z })?.text).toBe(
        'Open the stores',
      );
      expect(hideouts.siteAt(mid)?.hideoutId).toBe(s.hideoutId);
    });
  });
}
