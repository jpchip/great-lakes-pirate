import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { attachIslandAshore } from '../src/gameplay/island-ashore';
import { buildAshoreScene, type AshoreScene } from '../src/gameplay/onfoot/ashore-scene';
import { createIslandPosse, ISLAND_NAV_CELL_M } from '../src/gameplay/island-posse';
import { layoutHarbors } from '../src/sim/harbors';
import { placeZoneIslands, type PlacedIsland } from '../src/sim/islands/on-foot';
import type { GridField } from '../src/sim/terrain/grid-field';
import { loadIslandGround, loadZoneTerrain, type LoadedZone } from '../src/sim/terrain/load';
import { manifestFrame } from '../src/sim/terrain/zones';
import { createWorldState } from '../src/sim/world-state';

/**
 * The marshal posse on Stockton (plan 08 §20.4 piece H): tier 4 and up puts marshals on the
 * island's ground, on beats round the quarry, and they stand on the ground drawn.
 */

const conditions = () => ({
  gameSeconds: 15 * 3600,
  cloud01: 0.2,
  fogM: 25000,
  rain01: 0,
  wantedTier: 5,
  fame01: 0.5,
});

const dir = join(__dirname, '..', 'public', 'world', 'apostles');
const baked =
  existsSync(join(dir, 'manifest.json')) &&
  existsSync(join(dir, 'islands', 'stockton', '0-0.bin')) &&
  readFileSync(join(dir, 'islands', 'stockton', '0-0.bin')).byteLength > 200;

describe('the marshal posse on Stockton', () => {
  let zone: LoadedZone;
  let field: GridField;
  let placed: PlacedIsland;
  let scene: AshoreScene;
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
    const state = createWorldState('posse-test');
    const harbors = layoutHarbors(manifestFrame(zone.manifest), zone.terrain, zone.manifest.zone);
    const island = attachIslandAshore({
      state,
      heightAt: (x, z) => zone.terrain.heightAt(x, z),
      islands: () => [placed],
      ground: (id) => (id === 'island.stockton' ? field : undefined),
      harbors: () => harbors,
      runSeed: () => 7,
      openStash: () => true,
      notice: () => undefined,
    });
    const derrick = placed.pieces.find((p) => p.kind === 'derrick');
    const sc = derrick && island.sceneFor(derrick);
    if (!sc) throw new Error('no island scene');
    scene = buildAshoreScene({
      ground: sc.ground,
      center: derrick ?? { x: 0, z: 0 },
      box: sc.box,
      extra: sc.extra,
      ladders: sc.ladders,
    });
  });

  it.skipIf(!baked)('posts no marshal below tier 4, one at tier 4 and two from tier 5', () => {
    expect(createIslandPosse({ scene, placed, tier: 3, seed: 's', conditions })).toBeUndefined();
    expect(createIslandPosse({ scene, placed, tier: 4, seed: 's', conditions })?.count).toBe(1);
    expect(createIslandPosse({ scene, placed, tier: 5, seed: 's', conditions })?.count).toBe(2);
  });

  it.skipIf(!baked)('has its marshals stand on the ground drawn, round the quarry', () => {
    const posse = createIslandPosse({ scene, placed, tier: 5, seed: 's', conditions });
    if (!posse) throw new Error('no posse');
    const derrick = placed.pieces.find((p) => p.kind === 'derrick');
    if (!derrick) throw new Error('no derrick');
    for (const g of posse.stealth.guards) {
      expect(g.type.id).toBe('npc.marshal');
      expect(g.body.position.y).toBeCloseTo(
        scene.ground.heightAt(g.body.position.x, g.body.position.z),
        3,
      );
      // On a beat round the quarry, not out at sea.
      expect(Math.hypot(g.body.position.x - derrick.x, g.body.position.z - derrick.z)).toBeLessThan(
        60,
      );
    }
    expect(ISLAND_NAV_CELL_M).toBeGreaterThan(0);
  });
});
