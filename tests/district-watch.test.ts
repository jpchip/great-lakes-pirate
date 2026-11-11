import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import bayfieldJson from '../data/districts/bayfield.json';
import { buildDistrict, type DistrictModel } from '../src/gameplay/district/district';
import { DistrictNav } from '../src/gameplay/district/district-nav';
import { decodeGround } from '../src/gameplay/district/ground';
import { createCharacter } from '../src/gameplay/onfoot/controller';
import { planDistrictWatch, suspectAshore } from '../src/gameplay/onfoot/district-guards';
import { MAX_GUARDS } from '../src/gameplay/onfoot/guards';
import { createWatch, type WatchConditions } from '../src/gameplay/onfoot/watch';
import { NavMesh, type NavMeshData } from '../src/sim/district/navmesh';
import { parseLayout } from '../src/sim/district/layout';
import { Rng } from '../src/core/rng';

/**
 * Bayfield's watch on the real district (Phase 7, plan 08 §5): the roster read from the
 * district's marks, guards walking the baked navmesh, the placeholder conduct rule, and a
 * guard who sees you up to no good chasing you down and taking you (into Phase 5's jail,
 * through `onCaptured`). Needs the baked ground from Git LFS, like district.test.ts.
 */

const dir = join(import.meta.dirname, '..', 'public', 'districts', 'bayfield');
const groundPath = join(dir, 'ground.bin');
const baked = existsSync(groundPath) && readFileSync(groundPath).byteLength > 200;

function load(): { model: DistrictModel; nav: DistrictNav } {
  const model = buildDistrict(
    parseLayout(structuredClone(bayfieldJson)),
    decodeGround(new Uint8Array(readFileSync(groundPath))),
  );
  const mesh = new NavMesh(
    JSON.parse(readFileSync(join(dir, 'navmesh.json'), 'utf8')) as NavMeshData,
  );
  return { model, nav: new DistrictNav(mesh, (x, z) => model.floorAt(x, z)) };
}

/** 11 p.m. on a June night, clear. */
const NIGHT = 160 * 86400 + 23 * 3600;
const NOON = 160 * 86400 + 12 * 3600;

function conditions(at: number, over: Partial<WatchConditions> = {}): () => WatchConditions {
  return () => ({
    gameSeconds: at,
    cloud01: 0,
    fogM: 20_000,
    rain01: 0,
    wantedTier: 0,
    fame01: 0.2,
    ...over,
  });
}

describe.skipIf(!baked)('the watch in Bayfield', () => {
  it('posts its guards from the district marks', () => {
    const { model, nav } = load();
    const plan = planDistrictWatch(model, nav);
    const ids = plan.base.map((g) => g.id);
    expect(ids).toContain('constable.waterfront');
    expect(ids).toContain('constable.lockup');
    expect(ids).toContain('watchman.hollister_warehouse');
    expect(ids.filter((id) => id.startsWith('watchman.')).length).toBe(3);
    // The watchman runs to the lockup for the law.
    const post = model.mark('post.lockup');
    expect(plan.lawPost).toEqual({ x: post.x, z: post.z });
    // Every waypoint is somewhere a guard can stand, and the waterfront is a loop.
    for (const g of plan.base) {
      expect(g.route.points.length).toBeGreaterThan(1);
      for (const p of g.route.points) expect(nav.walkable(p), `${g.id} ${p.x},${p.z}`).toBe(true);
    }
    expect(plan.spareBeats.length).toBe(3);
  });

  it('paths on the baked navmesh, corners only, ending at the goal', () => {
    const { model, nav } = load();
    const g = model.mark('gangway.fish_pier');
    const lockup = model.mark('post.lockup');
    const from = { x: g.x, y: model.floorAt(g.x, g.z), z: g.z };
    const path = nav.findPath(from, lockup);
    expect(path).toBeDefined();
    const last = path?.[path.length - 1];
    expect(Math.hypot((last?.x ?? 0) - lockup.x, (last?.z ?? 0) - lockup.z)).toBeLessThan(0.5);
    // A search sweep picks places on the mesh round a point.
    const rng = Rng.fromSeed('sweep');
    for (let k = 0; k < 20; k++) {
      const p = nav.randomNear(lockup, 7, rng);
      expect(p && nav.walkable(p)).toBe(true);
    }
  });

  it('walks its beats', () => {
    const { model, nav } = load();
    const watch = createWatch({
      model,
      nav,
      tier: 0,
      seed: 'walk',
      conditions: conditions(NIGHT),
      onCaptured: () => undefined,
    });
    // You, out of everyone's way at the far end of the city dock.
    const me = createCharacter({ x: 85, y: model.floorAt(85, -60), z: -60 });
    const start = watch.stealth.guards.map((g) => ({ ...g.body.position }));
    for (let t = 0; t < 30 * 60; t++) watch.step(1 / 60, me);
    const moved = watch.stealth.guards.filter((g, k) => {
      const s = start[k];
      return s && Math.hypot(g.body.position.x - s.x, g.body.position.z - s.z) > 5;
    });
    expect(moved.length).toBeGreaterThanOrEqual(3);
    // Nobody fell through a deck or wandered off the district.
    for (const g of watch.stealth.guards) {
      const p = g.body.position;
      expect(p.y).toBeGreaterThan(model.floorAt(p.x, p.z) - 0.5);
      expect(p.x).toBeGreaterThan(model.minX);
      expect(p.x).toBeLessThan(model.maxX);
    }
    expect(watch.pursued).toBe(false);
  });

  it('grows with the Wanted tier, within the full-AI budget', () => {
    const { model, nav } = load();
    const at = (tier: number) =>
      createWatch({
        model,
        nav,
        tier,
        seed: 'tier',
        conditions: conditions(NIGHT, { wantedTier: tier }),
        onCaptured: () => undefined,
      });
    const calm = at(0).stealth.guards;
    const hot = at(5).stealth.guards;
    expect(hot.length).toBeGreaterThan(calm.length);
    expect(hot.length).toBeLessThanOrEqual(MAX_GUARDS);
    expect(hot.some((g) => g.type.id === 'npc.marshal')).toBe(true);
    // Perception for the lot stays inside plan 08's 1 ms a tick (exit criterion 10).
    const watch = at(5);
    const me = createCharacter({ x: 0, y: model.floorAt(0, 0), z: 0 });
    let total = 0;
    for (let t = 0; t < 600; t++) {
      watch.step(1 / 60, me);
      total += watch.stealth.lastStepMs;
    }
    expect(total / 600).toBeLessThan(1);
  });

  it('takes you to the lockup when a constable sees you up to no good', () => {
    const { model, nav } = load();
    let taken: string | undefined;
    const watch = createWatch({
      model,
      nav,
      tier: 0,
      seed: 'caught',
      conditions: conditions(NIGHT),
      suspect: () => true,
      onCaptured: (by) => (taken = by),
    });
    // Right in front of the lockup's constable, in the light of the street.
    const post = model.mark('post.lockup');
    const me = createCharacter({ x: post.x, y: model.floorAt(post.x, post.z - 4), z: post.z - 4 });
    let pursued = false;
    for (let t = 0; t < 40 * 60 && !taken; t++) {
      watch.step(1 / 60, me);
      pursued ||= watch.pursued;
    }
    expect(pursued).toBe(true);
    expect(taken).toBe('npc.constable');
    expect(watch.stealth.captured).toBe(true);
  });

  it('thinks nothing of an honest walk down the street', () => {
    const { model, nav } = load();
    let taken = false;
    const watch = createWatch({
      model,
      nav,
      tier: 0,
      seed: 'honest',
      conditions: conditions(NOON),
      onCaptured: () => (taken = true),
    });
    const post = model.mark('post.lockup');
    const me = createCharacter({ x: post.x, y: model.floorAt(post.x, post.z - 4), z: post.z - 4 });
    for (let t = 0; t < 20 * 60; t++) watch.step(1 / 60, me);
    expect(taken).toBe(false);
    expect(watch.pursued).toBe(false);
  });

  it('suspects you by the placeholder conduct rule', () => {
    const { model } = load();
    const at = (x: number, z: number) => createCharacter({ x, y: model.floorAt(x, z), z });
    const warehouse = model.buildings.find((b) => b.def.id === 'hollister_warehouse');
    const store = model.buildings.find((b) => b.def.id === 'general_store');
    if (!warehouse || !store) throw new Error('no buildings');
    const inWarehouse = at(
      (warehouse.minX + warehouse.maxX) / 2,
      (warehouse.minZ + warehouse.maxZ) / 2,
    );
    const inStore = at((store.minX + store.maxX) / 2, (store.minZ + store.maxZ) / 2);
    const street = at(10, -20);
    expect(suspectAshore({ model, player: street, hour: 12 })).toBe(false);
    expect(suspectAshore({ model, player: street, hour: 23 })).toBe(false);
    expect(suspectAshore({ model, player: inStore, hour: 12 })).toBe(false);
    expect(suspectAshore({ model, player: inStore, hour: 23 })).toBe(true);
    expect(suspectAshore({ model, player: inWarehouse, hour: 12 })).toBe(true);
    street.crouching = true;
    expect(suspectAshore({ model, player: street, hour: 23 })).toBe(true);
    expect(suspectAshore({ model, player: street, hour: 12 })).toBe(false);
    expect(suspectAshore({ model, player: at(10, -20), hour: 12, carrying: true })).toBe(true);
  });

  it("judges you by piece E's conduct, and hands F to the tool belt by a guard", () => {
    const { model, nav } = load();
    const pockets = { purse: 10_000, stores: { 'store.cosh': 1 } as Record<string, number> };
    const watch = createWatch({
      model,
      nav,
      tier: 0,
      seed: 'conduct',
      conditions: conditions(NOON),
      onCaptured: () => undefined,
      pockets,
    });
    const warehouse = model.buildings.find((b) => b.def.id === 'hollister_warehouse');
    if (!warehouse) throw new Error('no warehouse');
    const inside = createCharacter({
      x: (warehouse.minX + warehouse.maxX) / 2,
      y: model.floorAt(
        (warehouse.minX + warehouse.maxX) / 2,
        (warehouse.minZ + warehouse.maxZ) / 2,
      ),
      z: (warehouse.minZ + warehouse.maxZ) / 2,
    });
    watch.step(1 / 60, inside);
    expect(watch.conduct?.reason).toBe('trespass');
    expect(watch.toolsHud(inside)?.conduct).toBe('Suspicious if seen: Trespassing');
    const street = createCharacter({ x: 10, y: model.floorAt(10, -20), z: -20 });
    watch.step(1 / 60, street);
    expect(watch.conduct?.suspect).toBe(false);
    // Behind the lockup's constable with the cosh in hand: F is the belt's.
    const c = watch.stealth.guards.find((g) => g.type.id === 'npc.constable');
    if (!c) throw new Error('no constable');
    const h = c.body.heading;
    const me = createCharacter({
      x: c.body.position.x - Math.sin(h) * 1.5,
      y: c.body.position.y,
      z: c.body.position.z + Math.cos(h) * 1.5,
    });
    // The purse is in hand to start: face to face only.
    expect(watch.offer(me)).toMatchObject({ verb: 'bribe', ok: false, why: 'Get in front of him' });
    watch.tools?.select('tool.cosh');
    expect(watch.offer(me)).toMatchObject({ verb: 'knockOut', ok: true });
    expect(watch.interact(1 / 60, me, true, true)).toBe(true);
    expect(c.state).toBe('unconscious');
    // Nobody near: F goes back to the ashore prompts.
    expect(watch.interact(1 / 60, street, true, true)).toBe(false);
  });
});
