import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import discoveriesJson from '../data/discoveries.json';
import { discoveriesFileSchema } from '../data/schemas/discoveries';
import { attachCaves } from '../src/gameplay/caves';
import { attachIslandAshore } from '../src/gameplay/island-ashore';
import { buildAshoreScene, type AshoreScene } from '../src/gameplay/onfoot/ashore-scene';
import { CaveGround } from '../src/gameplay/onfoot/cave-ground';
import { footprintDistance, type Collider } from '../src/gameplay/onfoot/colliders';
import { createCharacter, stepCharacter } from '../src/gameplay/onfoot/controller';
import { EventBus } from '../src/core/events';
import type { GameEvents } from '../src/modes/context';
import { caveMeshData, createCaveView } from '../src/render/onfoot/cave-view';
import { MAX_CAVE_SEGMENTS, MAX_CAVES } from '../src/render/terrain/cave-clip';
import { StyleLighting } from '../src/render/style/stylized-material';
import { createRowboat, stepRowboat } from '../src/sim/ashore/rowboat';
import {
  CAVES,
  caveClips,
  caveAt,
  placeZoneCaves,
  sampleCave,
  type PlacedCave,
} from '../src/sim/caves/caves';
import { COLD } from '../src/sim/cold/footing';
import { caveMouthBlocks, ISLANDS, placeZoneIslands } from '../src/sim/islands/on-foot';
import { loadZoneTerrain, type LoadedZone } from '../src/sim/terrain/load';
import { manifestFrame } from '../src/sim/terrain/zones';
import { createWorldState } from '../src/sim/world-state';

/**
 * Plan 11 §5, §18.3 (the caves row, criterion 12's "a cave ≤ 40"), §18.4 piece S: the sea
 * caves at Devils, Sand and the mainland, in their cliffs, rowed into in a calm and turned
 * back in a sea, swum into, walked from a cave mouth, frozen into ice caves in winter, and
 * their caches.
 */

describe('caves.json', () => {
  const wonders = new Set(discoveriesFileSchema.parse(discoveriesJson).places.map((p) => p.id));

  it('has the three cave shores the plan names', () => {
    expect(CAVES.filter((c) => c.island === 'island.devils').length).toBeGreaterThanOrEqual(3);
    expect(CAVES.some((c) => c.island === 'island.sand')).toBe(true);
    expect(CAVES.some((c) => !c.island)).toBe(true);
    // The Devil's Grotto: "the third cave", with its chamber for piece T.
    const grotto = CAVES.find((c) => c.marks.some((m) => m.kind === 'grotto'));
    expect(grotto?.island).toBe('island.devils');
  });

  it('ties each cave to its island, its prefab and its wonder', () => {
    for (const c of CAVES) {
      expect(wonders.has(c.wonder), c.id).toBe(true);
      const island = c.island ? ISLANDS.find((i) => i.id === c.island) : undefined;
      if (c.island) expect(island, c.id).toBeDefined();
      if (c.mouth) {
        const poi = island?.onFoot?.pois.find((p) => p.id === c.mouth);
        expect(poi?.poi, c.id).toBe('poi.cave_mouth');
      }
    }
  });

  it("keeps cache ids apart from the islands' and each other", () => {
    const ids = [
      ...CAVES.flatMap((c) => c.caches.map((k) => k.id)),
      ...ISLANDS.flatMap((i) => i.onFoot?.caches.map((k) => k.id) ?? []),
    ];
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('opens the cave mouth prefabs it goes in by', () => {
    const shut = caveMouthBlocks({ widthM: 12, depthM: 5, minY: 0, maxY: 8 });
    const open = caveMouthBlocks({ widthM: 12, depthM: 5, minY: 0, maxY: 8, open: true });
    expect(shut.length - open.length).toBe(2);
    expect(open.some((b) => b.dark)).toBe(false);
  });
});

const dir = join(__dirname, '..', 'public', 'world', 'apostles');
const baked =
  existsSync(join(dir, 'manifest.json')) &&
  existsSync(join(dir, 'height', '0-0.bin')) &&
  readFileSync(join(dir, 'height', '0-0.bin')).byteLength > 200;

describe('the caves in their cliffs', () => {
  let zone: LoadedZone;
  let caves: PlacedCave[] = [];
  const heightAt = (x: number, z: number): number => zone.terrain.heightAt(x, z);

  beforeAll(async () => {
    if (!baked) return;
    const read = async (path: string) => new Uint8Array(readFileSync(join(dir, path)));
    zone = await loadZoneTerrain(read);
    const frame = manifestFrame(zone.manifest);
    const placed = placeZoneIslands(
      zone.manifest.zone,
      zone.manifest.islands ?? [],
      heightAt,
      frame,
    );
    caves = placeZoneCaves(zone.manifest.zone, zone.manifest.islands ?? [], placed, frame);
  }, 120_000);

  /** The scene a landing at the cave builds: the zone's ground round it, with its caves. */
  const sceneAt = (cave: PlacedCave, ice?: number): AshoreScene => {
    const g = zone.terrain.height;
    return buildAshoreScene({
      ground: { heightAt, x0: g.x0, z0: g.z0, step: g.step },
      center: cave.frame,
      halfSizeM: 120,
      caves: [cave],
      caveIce: () => ice,
    });
  };

  it.skipIf(!baked)('places every cave of the Apostles zone', () => {
    expect(caves.map((c) => c.id).sort()).toEqual(
      CAVES.filter((c) => c.zone === 'zone.apostles')
        .map((c) => c.id)
        .sort(),
    );
    // Within the shaders' room for them.
    expect(caves.length).toBeLessThanOrEqual(MAX_CAVES);
    expect(caves.reduce((n, c) => n + caveClips(c).length, 0)).toBeLessThanOrEqual(
      MAX_CAVE_SEGMENTS,
    );
  });

  it.skipIf(!baked)('runs every passage under rock, opening to the lake', () => {
    for (const cave of caves) {
      // The open end out in the lake is water, and deep enough for the boat.
      expect(cave.sea, cave.id).toBeDefined();
      if (!cave.sea) continue;
      expect(heightAt(cave.sea.x, cave.sea.z), cave.id).toBeLessThan(0);
      // Away from where it opens, there's rock over the roof: a meter at least.
      const n = cave.nodes;
      for (let k = 0; k + 1 < n.length; k++) {
        const a = n[k];
        const b = n[k + 1];
        if (!a || !b || a.roof === undefined || b.roof === undefined) continue;
        const len = Math.hypot(b.x - a.x, b.z - a.z);
        const openA = n[k - 1]?.roof === undefined;
        const openB = n[k + 2]?.roof === undefined && k + 2 < n.length;
        for (let d = 0; d <= len; d += 0.5) {
          if ((openA && d < 4) || (openB && len - d < 4)) continue;
          const t = d / len;
          const x = a.x + (b.x - a.x) * t;
          const z = a.z + (b.z - a.z) * t;
          const roof = a.roof + (b.roof - a.roof) * t;
          expect(
            heightAt(x, z) - roof,
            `${cave.id} at ${d.toFixed(1)} m of segment ${k}`,
          ).toBeGreaterThan(1);
        }
      }
    }
  });

  it.skipIf(!baked)('rows in under the roof in a calm, and is turned back in a sea', () => {
    for (const cave of caves) {
      const scene = sceneAt(cave);
      const state = createWorldState('caves-test');
      let hs = 0.3;
      const play = attachCaves({
        state,
        events: new EventBus<GameEvents>(),
        caves: () => [cave],
        hsAt: () => hs,
        runSeed: () => 7,
        notice: () => undefined,
      });
      const near: Collider[] = [];
      const push = { nx: 0, nz: 0 };
      const env = {
        depthAt: (x: number, z: number) => play.depthAt(x, z) ?? -heightAt(x, z),
        blocked: (x: number, z: number, r: number) => {
          const sea = play.rowBlocked(x, z, r);
          if (sea) return sea;
          scene.colliders.query(x, z, r, near);
          for (const c of near) {
            if (c.minY > 0.3 || c.maxY < 0) continue;
            const d = footprintDistance(c, x, z, push);
            if (d < r) return { nx: push.nx, nz: push.nz, depth: r - d + 1e-3 };
          }
          return undefined;
        },
      };
      // From the open end along the passage, steering for each node in turn.
      const row = (): number => {
        const path = cave.sea ? orderFromSea(cave) : cave.nodes;
        const start = path[0];
        if (!start) return 0;
        const boat = createRowboat(start.x, start.z, 0);
        let deepest = 0;
        let target = 1;
        for (let t = 0; t < 60 * 60 && target < path.length; t++) {
          const goal = path[target];
          if (!goal || goal.floor > -0.6) break;
          const want = Math.atan2(goal.x - boat.x, -(goal.z - boat.z));
          const err = Math.atan2(Math.sin(want - boat.heading), Math.cos(want - boat.heading));
          stepRowboat(
            boat,
            { pull: Math.abs(err) < 0.6 ? 1 : 0.2, turn: Math.sign(err) },
            env,
            1 / 60,
          );
          if (Math.hypot(goal.x - boat.x, goal.z - boat.z) < 1.2) target++;
          const s = sampleCave(cave, boat.x, boat.z);
          if (s?.roof !== undefined) deepest = Math.max(deepest, s.roof);
          expect(boat.beached, `${cave.id}: the boat aground`).toBe(false);
        }
        return deepest;
      };
      expect(row(), `${cave.id}: in under the roof in a calm`).toBeGreaterThan(0);
      hs = 1.2;
      expect(row(), `${cave.id}: kept out in a sea`).toBe(0);
    }
  });

  it.skipIf(!baked)('walks a cave floor between its walls, and the cliff top over it', () => {
    for (const cave of caves) {
      const scene = sceneAt(cave);
      expect(scene.ground).toBeInstanceOf(CaveGround);
      const ground = scene.ground as CaveGround;
      // The chamber's beach: into the wall beside it, then along toward the next node in.
      const roofed = cave.nodes.filter((n) => n.roof !== undefined);
      const beach = roofed
        .filter((n) => n.floor > 0 && n.floor < 1.5)
        .sort((a, b) => b.hw - a.hw)[0];
      if (!beach) continue;
      const k = cave.nodes.indexOf(beach);
      const next = cave.nodes[k + 1]?.roof !== undefined ? cave.nodes[k + 1] : cave.nodes[k - 1];
      if (!next) continue;
      const yaw = Math.atan2(next.x - beach.x, -(next.z - beach.z));
      const c = createCharacter({ x: beach.x, y: beach.floor + 0.2, z: beach.z });
      for (let t = 0; t < 6 * 60; t++) {
        ground.ref = c.position.y;
        const wall = t < 180;
        stepCharacter(
          c,
          { forward: wall ? 0 : 1, right: wall ? 1 : 0, run: false, crouch: false },
          yaw,
          scene,
          1 / 60,
        );
        const s = caveAt([cave], c.position.x, c.position.z, 0.5);
        expect(s, `${cave.id}: still in the passage`).toBeDefined();
        if (!c.swimming) {
          expect(c.position.y, `${cave.id}: on the floor`).toBeLessThan((s?.roof ?? 99) - 1);
        }
      }
      // On the cliff top over the passage's deepest roofed point: the ground holds.
      const deep = cave.nodes.filter(
        (n) => n.roof !== undefined && heightAt(n.x, n.z) > n.roof + 2,
      )[0];
      if (!deep) continue;
      const top = createCharacter({ x: deep.x, y: heightAt(deep.x, deep.z) + 0.1, z: deep.z });
      for (let t = 0; t < 120; t++) {
        ground.ref = top.position.y;
        stepCharacter(top, { forward: 0, right: 0, run: false, crouch: false }, 0, scene, 1 / 60);
      }
      expect(top.position.y, `${cave.id}: over the cave, not in it`).toBeGreaterThan(
        (deep.roof ?? 0) + 1,
      );
    }
  });

  it.skipIf(!baked)('walks into an ice cave on the ice, and finds the winter cache there', () => {
    const cave = caves.find((c) => c.caches.some((k) => k.def.winter));
    expect(cave, 'a cave with a winter cache').toBeDefined();
    if (!cave?.sea) return;
    const scene = sceneAt(cave, COLD.ice.topM);
    const ground = scene.ground as CaveGround;
    const spot = cave.caches.find((k) => k.def.winter)?.spots[0];
    if (!spot) return;
    // In from the channel on the ice to the winter cache's crack.
    const c = createCharacter({ x: cave.sea.x, y: COLD.ice.topM + 0.05, z: cave.sea.z });
    const path = orderFromSea(cave);
    let target = 1;
    for (let t = 0; t < 40 * 60; t++) {
      const goal: { x: number; z: number } | undefined = target < path.length ? path[target] : spot;
      if (!goal) break;
      const yaw = Math.atan2(goal.x - c.position.x, -(goal.z - c.position.z));
      ground.ref = c.position.y;
      stepCharacter(c, { forward: 1, right: 0, run: false, crouch: false }, yaw, scene, 1 / 60);
      expect(c.swimming, 'on the ice, not in the water').toBe(false);
      if (Math.hypot(goal.x - c.position.x, goal.z - c.position.z) < 1) {
        if (goal === spot) break;
        target++;
        if (target < path.length && (path[target]?.floor ?? 0) > 0) target = path.length;
      }
    }
    expect(Math.hypot(spot.x - c.position.x, spot.z - c.position.z)).toBeLessThan(2.2);
    const state = createWorldState('caves-ice');
    let frozen: string[] | undefined = [cave.id];
    const play = attachCaves({
      state,
      events: new EventBus<GameEvents>(),
      caves: () => [cave],
      hsAt: () => 0,
      runSeed: () => 7,
      notice: () => undefined,
    });
    play.forceFrozen(frozen);
    expect(play.prompt(c.position, false)?.text).toMatch(/^Search /);
    frozen = undefined;
    play.forceFrozen(frozen);
    expect(play.prompt(c.position, false)).toBeUndefined();
  });

  it.skipIf(!baked)('lands a boat at the mainland cave, which has a pad of its own', () => {
    const mainland = caves.find((c) => !c.island);
    if (!mainland?.sea) throw new Error('no mainland cave');
    const g = zone.terrain.height;
    const ashore = attachIslandAshore({
      state: createWorldState('caves-pad'),
      heightAt,
      grid: () => ({ x0: g.x0, z0: g.z0, step: g.step }),
      islands: () => [],
      ground: () => undefined,
      caves: () => caves,
      runSeed: () => 7,
      notice: () => undefined,
    });
    expect(ashore.walkableAt(mainland.sea)).toBe(true);
    expect(ashore.sceneFor(mainland.sea)?.box.maxX).toBeGreaterThan(mainland.frame.x);
  });

  it.skipIf(!baked)('draws each cave in a few draw calls', () => {
    const view = createCaveView(caves, new StyleLighting());
    // Rock in one mesh; each ice cave's ice only while frozen.
    expect(view.drawCalls).toBe(1);
    view.setFrozen(new Set(caves.map((c) => c.id)));
    expect(view.drawCalls).toBeLessThanOrEqual(1 + caves.length);
    expect(view.drawCalls).toBeLessThanOrEqual(40);
    for (const c of caves) {
      const tris = caveMeshData(c).rock.getAttribute('position').count / 3;
      expect(tris, c.id).toBeLessThan(8000);
    }
    view.dispose();
  });
});

describe('a cave in play', () => {
  it('notes the first time in, the surge on a swimmer, and its caches', () => {
    const cave = placeZoneCaves(
      'zone.apostles',
      [{ id: 'island.devils', x0: 0, z0: 0 }],
      [],
      undefined,
    ).find((c) => c.id === 'cave.devils_second');
    expect(cave).toBeDefined();
    if (!cave) return;
    const state = createWorldState('caves-play');
    const notes: string[] = [];
    const events = new EventBus<GameEvents>();
    const seen: string[] = [];
    events.on('CaveEntered', (e) => seen.push(`in ${e.cave} by ${e.by}`));
    events.on('CaveLeft', (e) => seen.push(`out ${e.cave}`));
    let hs = 0.3;
    const play = attachCaves({
      state,
      events,
      caves: () => [cave],
      hsAt: () => hs,
      runSeed: () => 7,
      notice: (t) => notes.push(t),
    });
    const back = cave.nodes[cave.nodes.length - 2];
    if (!back) return;
    const inside = { x: back.x, y: back.floor, z: back.z };
    expect(play.tick(inside, 'foot')).toBe(0);
    expect(state.caves?.entered[cave.id]).toBeDefined();
    expect(notes[0]).toBe(cave.entered);
    play.tick(inside, 'foot');
    expect(notes).toHaveLength(1);
    play.tick({ x: back.x, y: 50, z: back.z }, 'foot');
    expect(seen).toEqual([`in ${cave.id} by foot`, `out ${cave.id}`]);
    // Swimming in a sea: the surge hurts, more as the sea builds.
    hs = 1.2;
    const hurt = play.tick(inside, 'swimming');
    expect(hurt).toBeGreaterThan(0);
    hs = 1.8;
    expect(play.tick(inside, 'swimming')).toBeGreaterThan(hurt);
    hs = 0.3;
    expect(play.tick(inside, 'swimming')).toBe(0);
    // The cache: one of its spots holds it, the others are wet rock.
    const info = play.cache('cache.devils_cave');
    expect(info).toBeDefined();
    if (!info) return;
    const purse = state.player.purse;
    for (let k = 0; k < info.spots.length; k++) {
      const spot = info.spots[k];
      if (!spot) continue;
      const p = play.prompt({ x: spot.x, y: spot.y, z: spot.z }, false);
      expect(p?.text).toBe(`Search ${spot.name}`);
      p?.act();
      if (k === info.holds) break;
    }
    expect(state.player.purse - purse).toBe(info.cents);
    expect(state.caches?.['cache.devils_cave']?.looted).toBe(true);
  });
});

/** A cave's nodes from its open end in the lake inward. */
function orderFromSea(cave: PlacedCave): PlacedCave['nodes'] {
  const n = cave.nodes;
  const first = n[0];
  const last = n[n.length - 1];
  const seaEnd =
    first && last && cave.sea && Math.hypot(last.x - cave.sea.x, last.z - cave.sea.z) < 0.01;
  return seaEnd ? [...n].reverse() : [...n];
}
