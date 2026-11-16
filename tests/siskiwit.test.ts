// Phase 8 piece D (plan 09 §16.4): the Siskiwit Bay zone, its logging camp and walkable
// mainland pad, the Lumberjack's start there, and the Gannet switched on. The bake checks
// skip when the zone isn't checked out (LFS pointers only), like the other zones'.

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { ChartProjection, chartToZone, type Zone } from '../src/core/coords';
import { attachHideouts } from '../src/gameplay/hideouts';
import { attachIslandAshore } from '../src/gameplay/island-ashore';
import { createNewRun, firstWeekContext } from '../src/sim/character/new-run';
import { allBackgrounds } from '../src/sim/character/backgrounds';
import { smugglerById, smugglersInWorld } from '../src/sim/economy/smuggler';
import { layoutHarbors, type HarborLayout } from '../src/sim/harbors';
import {
  hideoutIdOf,
  hideoutPlace,
  siteAnchorage,
  siteDef,
  SITES,
  startingHideouts,
  syncHideouts,
} from '../src/sim/hideouts/stash';
import { placeZoneIslands, walkableIslands, type PlacedIsland } from '../src/sim/islands/on-foot';
import { mooringBerths } from '../src/sim/sailing/hazards';
import type { GridField } from '../src/sim/terrain/grid-field';
import { loadIslandGround, loadZoneTerrain, type LoadedZone } from '../src/sim/terrain/load';
import { edgeDistance, edgeFactor } from '../src/sim/terrain/zone-edge';
import type { ZoneTerrain } from '../src/sim/terrain/zone-terrain';
import {
  entryPose,
  manifestFrame,
  setPieceFootprint,
  spawnPose,
  zoneDef,
  zoneGeoBounds,
} from '../src/sim/terrain/zones';
import { createWorldState, parseWorldState } from '../src/sim/world-state';

const projection = new ChartProjection();
const dir = join(__dirname, '..', 'public', 'world', 'siskiwit');
const baked =
  existsSync(join(dir, 'manifest.json')) &&
  readFileSync(join(dir, 'height', '0-0.bin')).byteLength > 200;
const read = async (path: string) => new Uint8Array(readFileSync(join(dir, path)));

/** The T1 draws about 2 m; half a meter under her keel. */
const SAILABLE_M = 2.5;

/** Water a T1 can sail, flood-filled on an 8 m grid from `from`. */
function sailable(terrain: ZoneTerrain, from: Zone): (p: Zone) => boolean {
  const step = 8;
  const { minX, minZ, maxX, maxZ } = terrain.bounds;
  const w = Math.floor((maxX - minX) / step) + 1;
  const h = Math.floor((maxZ - minZ) / step) + 1;
  const seen = new Uint8Array(w * h);
  const cell = (p: Zone) => [Math.round((p.x - minX) / step), Math.round((p.z - minZ) / step)];
  const ok = (i: number, j: number) =>
    terrain.heightAt(minX + i * step, minZ + j * step) <= -SAILABLE_M;
  const [si = 0, sj = 0] = cell(from);
  const stack = [sj * w + si];
  seen[sj * w + si] = 1;
  while (stack.length) {
    const k = stack.pop() ?? 0;
    const i = k % w;
    const j = (k - i) / w;
    for (const [di, dj] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ] as const) {
      const ni = i + di;
      const nj = j + dj;
      if (ni < 0 || nj < 0 || ni >= w || nj >= h) continue;
      const nk = nj * w + ni;
      if (seen[nk] || !ok(ni, nj)) continue;
      seen[nk] = 1;
      stack.push(nk);
    }
  }
  return (p) => {
    const [i = 0, j = 0] = cell(p);
    return seen[j * w + i] === 1;
  };
}

describe('the Siskiwit Bay zone (Phase 8 piece D)', () => {
  const def = zoneDef('zone.siskiwit');
  let zone: LoadedZone;
  let layouts: HarborLayout[];
  let field: GridField | undefined;

  beforeAll(async () => {
    if (!baked) return;
    zone = await loadZoneTerrain(read);
    const frame = manifestFrame(zone.manifest);
    layouts = layoutHarbors(frame, zone.terrain, 'zone.siskiwit');
    field = await loadIslandGround(read, zone.manifest, 'island.siskiwit_camp');
  });

  it('sits west of the Apostles zone without overlapping it', () => {
    const own = zoneGeoBounds(def);
    const apostles = zoneGeoBounds(zoneDef('zone.apostles'));
    expect(own.east).toBeLessThan(apostles.west);
    // It holds Bark Point and the bay behind it, and the chart's stop for it.
    expect(own.west).toBeLessThan(-91.25);
    expect(own.east).toBeGreaterThan(-91.12);
  });

  it.skipIf(!baked)('is baked 3 × 3 tiles, with the camp pad’s 1 m tiles', () => {
    expect([zone.manifest.height.tilesX, zone.manifest.height.tilesY]).toEqual([3, 3]);
    expect(zone.terrain.bounds).toEqual({ minX: -1536, minZ: -1536, maxX: 1536, maxZ: 1536 });
    expect(zone.manifest.islands?.map((i) => i.id)).toEqual(['island.siskiwit_camp']);
    expect(field).toBeDefined();
  });

  it.skipIf(!baked)('spawns in deep open water clear of the edge fog', () => {
    const spawn = spawnPose(def);
    expect(zone.terrain.depthAt(spawn.x, spawn.z)).toBeGreaterThan(15);
    expect(zone.terrain.shoreDistanceAt(spawn.x, spawn.z)).toBeGreaterThan(60);
    expect(edgeFactor(zone.terrain.bounds, def.edge, spawn.x, spawn.z)).toBe(0);
  });

  it.skipIf(!baked)('lands arrivals from the chart off the bay, heading for the camp', () => {
    const fp = setPieceFootprint(def.setPieces[0] as never, manifestFrame(zone.manifest));
    const reach = sailable(zone.terrain, spawnPose(def));
    for (const entry of def.entries) {
      const pose = entryPose(entry);
      expect(zone.terrain.depthAt(pose.x, pose.z), entry.id).toBeGreaterThan(15);
      expect(zone.terrain.shoreDistanceAt(pose.x, pose.z), entry.id).toBeGreaterThan(150);
      expect(reach(pose), entry.id).toBe(true);
      expect(edgeDistance(zone.terrain.bounds, pose.x, pose.z), entry.id).toBeLessThan(
        def.edge.chartFromM ?? 0,
      );
      const d = (p: Zone) => Math.hypot(fp.anchor.x - p.x, fp.anchor.z - p.z);
      expect(d(pose), entry.id).toBeLessThan(1000);
      const on = {
        x: pose.x + Math.sin(pose.heading) * 300,
        z: pose.z - Math.cos(pose.heading) * 300,
      };
      expect(d(on), entry.id).toBeLessThan(d(pose) - 200);
    }
  });

  it.skipIf(!baked)('flattens the camp ground and leaves the bay off it sailable', () => {
    const piece = def.setPieces.find((p) => p.id === 'setpiece.siskiwit');
    if (!piece) throw new Error('no camp set piece');
    const fp = setPieceFootprint(piece, manifestFrame(zone.manifest));
    // 40 m behind the shore the ground is the set piece's, give or take the 4 m samples.
    const back = {
      x: fp.anchor.x - Math.sin(fp.bearing) * 40,
      z: fp.anchor.z + Math.cos(fp.bearing) * 40,
    };
    expect(zone.terrain.heightAt(back.x, back.z)).toBeCloseTo(piece.groundM, 0);
    // The site's anchorage is deep, and a ship from the spawn can reach it.
    const site = siteDef('site.siskiwit');
    if (!site) throw new Error('no site');
    const a = siteAnchorage(site, manifestFrame(zone.manifest));
    if (!a) throw new Error('no anchorage');
    expect(zone.terrain.depthAt(a.x, a.z)).toBeGreaterThan(5);
    expect(sailable(zone.terrain, spawnPose(def))(a)).toBe(true);
  });

  it.skipIf(!baked)('docks the T1 at the camp dock in water deep enough', () => {
    const camp = layouts.find((l) => l.def.id === 'harbor.siskiwit');
    expect(camp?.piers.map((p) => p.id)).toEqual(['pier.siskiwit_dock']);
    const berths = mooringBerths(camp?.piers ?? [], zone.terrain);
    expect(berths.length).toBeGreaterThan(0);
    for (const b of berths)
      expect(zone.terrain.heightAt(b.pose.x, b.pose.z), b.id).toBeLessThan(-3);
    // The prefab office, tool shed and strongbox gave way to the grid's pieces (piece C).
    expect(camp?.buildings.map((b) => b.kind)).toEqual([]);
  });

  it.skipIf(!baked)('lays the Gannet to her anchor in the bay, deep and reachable', () => {
    const gannet = smugglerById('smuggler.siskiwit');
    if (!gannet) throw new Error('no Gannet');
    expect(smugglersInWorld().map((s) => s.id)).toContain('smuggler.siskiwit');
    const at = chartToZone(
      projection.geoToChart(gannet.anchorage.at),
      manifestFrame(zone.manifest),
    );
    expect(zone.terrain.depthAt(at.x, at.z)).toBeGreaterThan(8);
    expect(zone.terrain.shoreDistanceAt(at.x, at.z)).toBeGreaterThan(100);
    expect(sailable(zone.terrain, spawnPose(def))(at)).toBe(true);
    // Off the old logging dock: within a few hundred meters of it.
    const dock = layouts.flatMap((l) => l.piers).find((p) => p.id === 'pier.siskiwit_dock');
    if (!dock) throw new Error('no dock');
    expect(Math.hypot(dock.root.x - at.x, dock.root.z - at.z)).toBeLessThan(400);
  });
});

describe('the logging camp pad on foot (Phase 8 piece D)', () => {
  let zone: LoadedZone;
  let placed: PlacedIsland[];
  let field: GridField | undefined;

  beforeAll(async () => {
    if (!baked) return;
    zone = await loadZoneTerrain(read);
    placed = placeZoneIslands('zone.siskiwit', zone.manifest.islands ?? [], (x, z) =>
      zone.terrain.heightAt(x, z),
    );
    field = await loadIslandGround(read, zone.manifest, 'island.siskiwit_camp');
  });

  it('is a mainland pad, walkable like an island', () => {
    const pads = walkableIslands('zone.siskiwit');
    expect(pads.map((i) => i.id)).toEqual(['island.siskiwit_camp']);
    expect(pads[0]?.mainland).toBe(true);
    expect(pads[0]?.clip).toBeDefined();
  });

  it.skipIf(!baked)('stands the bunkhouse ruins, log decks and lumber piles on the ground', () => {
    const camp = placed[0];
    expect(camp?.mainland).toBe(true);
    const kinds = new Map<string, number>();
    for (const p of camp?.pieces ?? []) kinds.set(p.kind, (kinds.get(p.kind) ?? 0) + 1);
    expect(kinds.get('wall')).toBe(6);
    expect(kinds.get('logs')).toBe(3);
    expect(kinds.get('lumber')).toBe(2);
    for (const p of camp?.pieces ?? []) {
      // On dry, flat camp ground: above the lake, at most a little above the set piece's.
      const g = zone.terrain.heightAt(p.x, p.z);
      expect(g, p.kind).toBeGreaterThan(0.3);
      expect(p.minY, p.kind).toBeLessThanOrEqual(g);
      expect(p.maxY - g, p.kind).toBeLessThan(3);
    }
  });

  it.skipIf(!baked)('lands from the anchorage, and opens the stash for the Lumberjack only', () => {
    const site = siteDef('site.siskiwit');
    if (!site || !field) throw new Error('no site or ground');
    const make = (background: 'lumberjack' | 'deckhand') => {
      const state = createWorldState('pad');
      state.hideouts = startingHideouts(background, 0);
      const opened: string[] = [];
      const island = attachIslandAshore({
        state,
        heightAt: (x, z) => zone.terrain.heightAt(x, z),
        grid: () => ({
          x0: zone.terrain.height.x0,
          z0: zone.terrain.height.z0,
          step: zone.terrain.height.step,
        }),
        islands: () => placed,
        ground: (id) => (id === 'island.siskiwit_camp' ? field : undefined),
        hideouts: attachHideouts({
          state,
          zone: () => ({ id: 'zone.siskiwit', frame: manifestFrame(zone.manifest) }),
          heightAt: (x, z) => zone.terrain.heightAt(x, z),
          openStash: (id) => {
            opened.push(id);
            return true;
          },
          notice: () => undefined,
        }),
        runSeed: () => 7,
        notice: () => undefined,
      });
      return { island, opened };
    };
    const { island, opened } = make('lumberjack');
    const a = siteAnchorage(site, manifestFrame(zone.manifest));
    if (!a) throw new Error('no anchorage');
    // The boat goes over the side at the anchorage: that's a landing on the pad.
    expect(island.walkableAt(a)).toBe(true);
    expect(island.sceneFor(a)?.island).toBe('island.siskiwit_camp');
    // Out in the open lake it isn't.
    expect(island.walkableAt(spawnPose(zoneDef('zone.siskiwit')))).toBe(false);
    const box = island.strongbox();
    expect(box?.hideout).toBe('hideout.siskiwit');
    if (!box) return;
    const prompt = island.prompt({ x: box.x + 1, y: box.y, z: box.z });
    expect(prompt?.text).toBe('Open the stash');
    prompt?.act();
    expect(opened).toEqual(['hideout.siskiwit']);
    // A deckhand's run hasn't claimed the camp: its strongbox is just a box.
    const other = make('deckhand');
    expect(other.island.strongbox()).toBeUndefined();
    expect(other.island.prompt({ x: box.x + 1, y: box.y, z: box.z })).toBeUndefined();
  });
});

describe('the Lumberjack’s start (Phase 8 piece D)', () => {
  const setup = (background: 'lumberjack' | 'deckhand') => ({
    name: 'Ida Bergquist',
    shipName: 'Kittiwake',
    background,
    portrait: 'portrait.weathered',
    seed: 'abc12345',
  });

  it('agrees between backgrounds.json and sites.json', () => {
    for (const b of allBackgrounds()) {
      const sites = SITES.filter((s) => s.startFor.includes(b.key)).map((s) => hideoutIdOf(s.id));
      expect(sites, b.key).toEqual([b.hideout]);
    }
  });

  it('starts a new Lumberjack at the Siskiwit camp, and everyone else at Stockton', () => {
    const lumberjack = createNewRun(setup('lumberjack'));
    expect(Object.keys(lumberjack.hideouts ?? {})).toEqual(['hideout.siskiwit']);
    expect(lumberjack.hideouts?.['hideout.siskiwit']?.storage).toEqual({ goods: [], cash: 0 });
    expect(firstWeekContext('lumberjack').hideoutName).toBe('Siskiwit Bay');
    expect(firstWeekContext('deckhand').hideoutName).toBe('Stockton Island');
    const deckhand = createNewRun(setup('deckhand'));
    expect(Object.keys(deckhand.hideouts ?? {})).toEqual(['hideout.stockton']);
    expect(hideoutPlace('hideout.siskiwit')).toBe('Siskiwit Bay');
    expect(hideoutPlace('hideout.stockton')).toBe('Stockton Island');
  });

  it('lets a Lumberjack already under way keep Stockton, without Siskiwit', () => {
    const run = createWorldState('old-lumberjack');
    run.player.captain.background = 'lumberjack';
    run.hideouts = startingHideouts('deckhand', 0);
    const stockton = run.hideouts['hideout.stockton'];
    if (!stockton) throw new Error('no Stockton');
    stockton.storage.cash = 4_200;
    const back = parseWorldState(JSON.parse(JSON.stringify(run)));
    expect(Object.keys(back.hideouts ?? {})).toEqual(['hideout.stockton']);
    expect(back.hideouts?.['hideout.stockton']?.storage.cash).toBe(4_200);
    // A save with no hideouts at all still gets the background's own.
    expect(Object.keys(syncHideouts(undefined, 'lumberjack', 0))).toEqual(['hideout.siskiwit']);
  });
});
