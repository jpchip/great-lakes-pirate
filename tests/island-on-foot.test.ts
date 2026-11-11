import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { attachIslandAshore, pieceColliders } from '../src/gameplay/island-ashore';
import { buildAshoreScene, plantColliders } from '../src/gameplay/onfoot/ashore-scene';
import type { Collider } from '../src/gameplay/onfoot/colliders';
import { createCharacter, stepCharacter } from '../src/gameplay/onfoot/controller';
import { layoutHarbors } from '../src/sim/harbors';
import {
  ISLANDS,
  placeIsland,
  placeZoneIslands,
  rollCache,
  type PlacedIsland,
} from '../src/sim/islands/on-foot';
import { zoneClearings } from '../src/sim/terrain/clearings';
import type { GridField } from '../src/sim/terrain/grid-field';
import { loadIslandGround, loadZoneTerrain, type LoadedZone } from '../src/sim/terrain/load';
import { PLANT_STRIDE, plantTile } from '../src/sim/terrain/vegetation';
import { manifestFrame } from '../src/sim/terrain/zones';
import { createWorldState } from '../src/sim/world-state';

/**
 * Phase 7 piece H (plan 08 §20.4): Stockton Island on foot. Its 1 m tiles as the walked
 * ground, the quarry set down on the drawn ground, trunks where the trees are drawn, the
 * seeded cache and the stash opened at its strongbox.
 */

const STOCKTON = ISLANDS.find((i) => i.id === 'island.stockton');
if (!STOCKTON) throw new Error('no Stockton');

describe('islands.json and pois.json for on foot', () => {
  it('Stockton is the hero island, with the quarry and one cache of three cairns', () => {
    expect(STOCKTON.tier).toBe('hero');
    expect(STOCKTON.onFoot?.pois.map((p) => p.poi)).toEqual(['poi.quarry']);
    expect(STOCKTON.onFoot?.caches).toHaveLength(1);
    expect(STOCKTON.onFoot?.caches[0]?.spots).toHaveLength(3);
  });

  it('places the quarry on any ground: ledges first, the rest standing on them', () => {
    // A hill rising to the west, the lake to the east: the shape of Stockton's shore.
    const hill = (x: number): number => (x < 470 ? (470 - x) * 0.4 : -0.3);
    const placed = placeIsland(STOCKTON, { x0: 0, z0: 0 }, (x) => hill(x));
    const ledges = placed.pieces.filter((p) => p.kind === 'ledge');
    expect(ledges).toHaveLength(3);
    // The spoil wharf is 1.3 m over the shallows; the cuts clear the hill they're cut in.
    const wharf = ledges.find((l) => Math.abs(l.maxY - 1) < 1e-6);
    expect(wharf).toBeDefined();
    for (const l of ledges.filter((x) => x !== wharf)) {
      expect(l.maxY).toBeGreaterThanOrEqual(hill(l.x - l.depthM / 2) - 1e-6);
    }
    const derrick = placed.pieces.find((p) => p.kind === 'derrick');
    expect(derrick?.minY).toBeCloseTo(1 - 0.3, 5);
    expect(derrick?.maxY).toBeCloseTo(14, 5);
    const stacked = placed.pieces.filter((p) => p.kind === 'block' && p.minY > 1.5);
    expect(stacked).toHaveLength(1);
    // A ladder down the wharf's face into the lake, and a cairn at each cache spot.
    expect(placed.ladders).toHaveLength(1);
    expect(placed.ladders[0]?.topY).toBeCloseTo(1, 5);
    expect(placed.pieces.filter((p) => p.kind === 'cairn')).toHaveLength(3);
    expect(placed.clearings.length).toBe(1 + 3);
  });
});

describe('the cache is seeded by the run', () => {
  const cache = STOCKTON.onFoot?.caches[0];
  if (!cache) throw new Error('no cache');

  it('hides it in the same cairn with the same cash every time for a run', () => {
    expect(rollCache(cache, 12345)).toEqual(rollCache(cache, 12345));
    const { cents } = rollCache(cache, 12345);
    expect(cents).toBeGreaterThanOrEqual(cache.cashCents[0]);
    expect(cents).toBeLessThanOrEqual(cache.cashCents[1]);
  });

  it('moves between cairns from run to run', () => {
    const seen = new Set<number>();
    for (let seed = 1; seed <= 60; seed++) seen.add(rollCache(cache, seed).spot);
    expect(seen.size).toBe(cache.spots.length);
  });
});

describe('trunks and rocks as colliders', () => {
  it('gives a post to each tree the preset draws and a low rock to hop', () => {
    const tree = (rank: number, kind: number): number[] => [10, 5, 20, 1, 0, kind, 0.5, rank];
    const trees = new Float32Array([...tree(0.1, 0), ...tree(0.3, 1), ...tree(0.7, 0)]);
    const rocks = new Float32Array([30, 0.5, 30, 1.5, 0, 2, 0.5, 0.2]);
    const out: Collider[] = [];
    plantColliders({ trees, rocks, density: 0.5 }, out);
    expect(out).toHaveLength(3);
    const [pine, birch, rock] = out;
    expect(pine?.kind === 'cylinder' && pine.radius).toBeCloseTo(0.36, 5);
    expect(birch?.kind === 'cylinder' && birch.radius).toBeCloseTo(0.22, 5);
    expect(pine?.maxY).toBeGreaterThan(10);
    expect(rock?.spot).toBe('vault');
    expect(rock?.maxY).toBeLessThan(0.5 + 1);
    expect(PLANT_STRIDE).toBe(8);
  });

  it('makes blocks you vault, a stack you climb, and a derrick post', () => {
    const base = { poi: 'q', x: 0, z: 0, bearing: 0, widthM: 1.2, depthM: 1.2, minY: 0 };
    expect(pieceColliders({ ...base, kind: 'block', maxY: 1.2 })[0]?.spot).toBe('vault');
    expect(pieceColliders({ ...base, kind: 'block', maxY: 2.4 })[0]?.spot).toBe('climb');
    expect(pieceColliders({ ...base, kind: 'derrick', maxY: 13 })[0]?.kind).toBe('cylinder');
    expect(pieceColliders({ ...base, kind: 'shack', maxY: 3 })[0]?.surface).toBe('wood');
  });
});

describe('a rectangle of ground', () => {
  it('builds the box asked for, not a square', () => {
    const scene = buildAshoreScene({
      ground: { heightAt: () => 2, x0: 0, z0: 0, step: 1 },
      center: { x: 0, z: 0 },
      box: { minX: 0, minZ: 0, maxX: 100, maxZ: 40 },
    });
    expect(scene.bounds.maxX - scene.bounds.minX).toBeGreaterThanOrEqual(100);
    expect(scene.bounds.maxZ - scene.bounds.minZ).toBeGreaterThanOrEqual(40);
    expect(scene.bounds.maxZ - scene.bounds.minZ).toBeLessThan(50);
  });
});

const dir = join(__dirname, '..', 'public', 'world', 'apostles');
const baked =
  existsSync(join(dir, 'manifest.json')) &&
  existsSync(join(dir, 'islands', 'stockton', '0-0.bin')) &&
  readFileSync(join(dir, 'islands', 'stockton', '0-0.bin')).byteLength > 200;

describe('Stockton on its baked tiles', () => {
  let zone: LoadedZone;
  let field: GridField;
  let placed: PlacedIsland;
  const read = async (path: string) => new Uint8Array(readFileSync(join(dir, path)));
  beforeAll(async () => {
    if (!baked) return;
    zone = await loadZoneTerrain(read);
    const g = await loadIslandGround(read, zone.manifest, 'island.stockton');
    if (!g) throw new Error('no Stockton tiles');
    field = g;
    const all = placeZoneIslands(zone.manifest.zone, zone.manifest.islands ?? [], (x, z) =>
      zone.terrain.heightAt(x, z),
    );
    const s = all.find((i) => i.id === 'island.stockton');
    if (!s) throw new Error('Stockton not placed');
    placed = s;
  });

  it.skipIf(!baked)('loads 6 × 4 tiles of 1 m ground that agree with the 4 m terrain', () => {
    expect(field.width).toBe(1537);
    expect(field.height).toBe(1025);
    expect(field.step).toBe(1);
    let max = -Infinity;
    for (const v of field.values) max = Math.max(max, v);
    expect(max).toBeGreaterThan(25);
    expect(max).toBeLessThan(30);
    let sum = 0;
    let n = 0;
    for (let j = 2; j < field.height - 2; j += 37) {
      for (let i = 2; i < field.width - 2; i += 41) {
        const x = field.x0 + i;
        const z = field.z0 + j;
        sum += Math.abs(field.sample(x, z) - zone.terrain.heightAt(x, z));
        n++;
      }
    }
    expect(sum / n).toBeLessThan(0.4);
  });

  it.skipIf(!baked)(
    'sets the quarry on the south shore: a wharf above the lake, cuts above',
    () => {
      const ledges = placed.pieces.filter((p) => p.kind === 'ledge');
      const wharf = ledges.reduce((a, b) => (a.maxY < b.maxY ? a : b));
      expect(wharf.maxY).toBeGreaterThan(0.5);
      expect(wharf.maxY).toBeLessThan(1.6);
      const tops = ledges.map((l) => l.maxY).sort((a, b) => a - b);
      expect(tops[1]).toBeGreaterThan(6);
      expect(tops[2]).toBeGreaterThan(tops[1] ?? 0);
      expect(placed.ladders).toHaveLength(1);
    },
  );

  it.skipIf(!baked)('plants no tree on the quarry or a cairn', () => {
    const frame = manifestFrame(zone.manifest);
    const harbors = layoutHarbors(frame, zone.terrain, zone.manifest.zone);
    const clearings = zoneClearings(zone, harbors, [placed]);
    const q = placed.pieces.find((p) => p.kind === 'derrick');
    if (!q) throw new Error('no derrick');
    const minX = Math.floor((q.x - 96) / 24) * 24;
    const minZ = Math.floor((q.z - 96) / 24) * 24;
    const plants = plantTile(zone.terrain.height, minX, minZ, 192, clearings);
    for (let k = 0; k < plants.trees.length; k += PLANT_STRIDE) {
      const x = plants.trees[k] ?? 0;
      const z = plants.trees[k + 2] ?? 0;
      for (const p of placed.pieces) {
        expect(Math.hypot(x - p.x, z - p.z)).toBeGreaterThan(
          p.kind === 'ledge' ? 0 : Math.max(p.widthM, p.depthM) / 2,
        );
      }
    }
  });

  it.skipIf(!baked)('walks it: on the wharf, cairns to search, and the stash to open', () => {
    const state = createWorldState('island-test');
    const frame = manifestFrame(zone.manifest);
    const harbors = layoutHarbors(frame, zone.terrain, zone.manifest.zone);
    const notices: string[] = [];
    const opened: string[] = [];
    const island = attachIslandAshore({
      state,
      heightAt: (x, z) => zone.terrain.heightAt(x, z),
      islands: () => [placed],
      ground: (id) => (id === 'island.stockton' ? field : undefined),
      harbors: () => harbors,
      runSeed: () => 7,
      openStash: (id) => {
        opened.push(id);
        return true;
      },
      notice: (t) => notices.push(t),
    });
    const derrick = placed.pieces.find((p) => p.kind === 'derrick');
    if (!derrick) throw new Error('no derrick');
    const s = island.sceneFor(derrick);
    expect(s?.island).toBe('island.stockton');
    // Out at sea, it's the stand-in's.
    expect(island.sceneFor({ x: field.x0 - 400, z: field.z0 })).toBeUndefined();
    if (!s) return;
    const scene = buildAshoreScene({
      ground: s.ground,
      center: derrick,
      box: s.box,
      extra: s.extra,
      ladders: s.ladders,
    });
    // The whole island is built: its far corners are inside.
    expect(scene.bounds.minX).toBeLessThan(field.x0);
    expect(scene.bounds.maxZ).toBeGreaterThan(field.maxZ);
    expect(scene.ground.heightAt(field.x0 + 935, field.z0 + 679)).toBeCloseTo(
      field.sample(field.x0 + 935, field.z0 + 679),
      5,
    );
    // Stood on the wharf beside the derrick, you stay on its top.
    const c = createCharacter({ x: derrick.x + 1.5, y: derrick.minY + 2, z: derrick.z });
    for (let t = 0; t < 60; t++) {
      stepCharacter(
        c,
        { forward: 0, right: 0, run: false, crouch: false, jump: false },
        0,
        scene,
        1 / 60,
      );
    }
    expect(c.grounded).toBe(true);
    expect(c.position.y).toBeCloseTo(derrick.minY + 0.3, 1);
    expect(c.surface).toBe('stone');

    // The cairns: two hold stones, one the cache.
    const info = island.cache('cache.stockton_quarry');
    if (!info) throw new Error('no cache');
    const order = [...info.spots.keys()].sort(
      (a, b) => Number(a === info.holds) - Number(b === info.holds),
    );
    const purse = state.player.purse;
    for (const k of order) {
      const spot = info.spots[k];
      if (!spot) continue;
      const p = island.prompt({ x: spot.x + 1, y: spot.y, z: spot.z });
      expect(p?.text).toBe(`Search ${spot.name}`);
      p?.act();
      // Searched: no prompt here again.
      expect(island.prompt({ x: spot.x + 1, y: spot.y, z: spot.z })).toBeUndefined();
    }
    expect(notices.filter((n) => n === 'Only stones under the stones')).toHaveLength(2);
    expect(state.player.purse - purse).toBe(info.cents);
    expect(state.caches?.['cache.stockton_quarry']?.looted).toBe(true);

    // The stash's strongbox at Presque Isle bay.
    const box = island.strongbox();
    expect(box?.hideout).toBe('hideout.stockton');
    if (!box) return;
    const p = island.prompt({ x: box.x + 1.2, y: box.y, z: box.z });
    expect(p?.text).toBe('Open the stash');
    p?.act();
    expect(opened).toEqual(['hideout.stockton']);
  });
});
