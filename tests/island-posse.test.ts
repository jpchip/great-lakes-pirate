import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { attachIslandAshore } from '../src/gameplay/island-ashore';
import { buildAshoreScene, type AshoreScene } from '../src/gameplay/onfoot/ashore-scene';
import {
  createIslandPosse,
  GIVE_UP_S,
  ISLAND_NAV_CELL_M,
  LAND_AFTER_S,
  SWEEP_RADII_M,
} from '../src/gameplay/island-posse';
import { createCharacter } from '../src/gameplay/onfoot/controller';
import { placeZoneIslands, type PlacedIsland } from '../src/sim/islands/on-foot';
import type { GridField } from '../src/sim/terrain/grid-field';
import { loadIslandGround, loadZoneTerrain, type LoadedZone } from '../src/sim/terrain/load';
import { createWorldState } from '../src/sim/world-state';

/**
 * The marshal posse on Stockton (plan 08 §20.4 piece H; Phase 9 piece F, plan 11 §18): at
 * tier 4 and up the marshals land by your boat a while after you do, sweep outward from it,
 * give up after a quiet while, and break off at a hideout's bounds without setting foot in
 * them.
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
    const island = attachIslandAshore({
      state,
      heightAt: (x, z) => zone.terrain.heightAt(x, z),
      grid: () => ({
        x0: zone.terrain.height.x0,
        z0: zone.terrain.height.z0,
        step: zone.terrain.height.step,
      }),
      islands: () => [placed],
      ground: (id) => (id === 'island.stockton' ? field : undefined),
      runSeed: () => 7,
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

  /** A posse at a tier, its boat at `boat`, with an optional hideout box. */
  const posseAt = (
    tier: number,
    boat?: { x: number; z: number },
    sanctuary?: (at: { x: number; z: number }) => string | undefined,
  ) =>
    createIslandPosse({
      scene,
      placed,
      seed: 's',
      conditions: () => ({ ...conditions(), wantedTier: tier }),
      ...(boat ? { boat: () => boat } : {}),
      ...(sanctuary ? { sanctuary } : {}),
    });

  /** The quarry's spoil wharf: a boat beached there. */
  const wharf = (): { x: number; z: number } => {
    const w = placed.pieces.find((p) => p.kind === 'steps') ?? placed.pieces[0];
    if (!w) throw new Error('no quarry pieces');
    return { x: w.x, z: w.z };
  };

  /** Someone far off, out of anyone's sight. */
  const faraway = () => {
    const b = scene.bounds;
    return createCharacter({ x: b.minX + 1, y: 0, z: b.minZ + 1 });
  };

  const step = (posse: ReturnType<typeof posseAt>, me: ReturnType<typeof faraway>, s: number) => {
    for (let t = 0; t < s * 20 && posse && !posse.captured; t++) posse.step(1 / 20, me, true);
  };

  it.skipIf(!baked)('sends no marshal below tier 4, one at tier 4 and two from tier 5', () => {
    expect(posseAt(3)?.count).toBe(0);
    expect(posseAt(4)?.count).toBe(1);
    expect(posseAt(5)?.count).toBe(2);
    // Nobody lands below tier 4.
    const none = posseAt(3, wharf());
    step(none, faraway(), LAND_AFTER_S.notorious + 5);
    expect(none?.phase).toBe('coming');
    expect(none?.stealth.guards).toHaveLength(0);
  });

  it.skipIf(!baked)('lands by your boat a while after you set foot ashore', () => {
    const boat = wharf();
    const posse = posseAt(5, boat);
    if (!posse) throw new Error('no posse');
    expect(posse.phase).toBe('coming');
    expect(posse.stealth.guards).toHaveLength(0);
    const landed: unknown[] = [];
    posse.onPosse((e) => landed.push(e));
    step(posse, faraway(), LAND_AFTER_S.infamous - 1);
    expect(posse.phase).toBe('coming');
    step(posse, faraway(), 2);
    expect(posse.phase).toBe('searching');
    expect(landed).toEqual([expect.objectContaining({ type: 'PosseLanded', count: 2 })]);
    expect(posse.stealth.guards).toHaveLength(2);
    for (const g of posse.stealth.guards) {
      expect(g.type.id).toBe('npc.marshal');
      // On the ground drawn, near the boat.
      expect(g.body.position.y).toBeCloseTo(
        scene.ground.heightAt(g.body.position.x, g.body.position.z),
        0,
      );
      expect(Math.hypot(g.body.position.x - boat.x, g.body.position.z - boat.z)).toBeLessThan(40);
    }
  });

  it.skipIf(!baked)('sweeps outward from the landing, each marshal his own sector', () => {
    const posse = posseAt(5, wharf());
    if (!posse?.land()) throw new Error('no landing');
    const at = posse.landing;
    if (!at) throw new Error('no landing');
    let far = 0;
    step(posse, faraway(), 120);
    for (const g of posse.stealth.guards) {
      far = Math.max(far, Math.hypot(g.body.position.x - at.x, g.body.position.z - at.z));
    }
    expect(far).toBeGreaterThan(SWEEP_RADII_M[1] ?? 30);
    // Apart: two sectors, not one.
    const [a, b] = posse.stealth.guards;
    if (!a || !b) throw new Error('two marshals');
    expect(
      Math.hypot(a.body.position.x - b.body.position.x, a.body.position.z - b.body.position.z),
    ).toBeGreaterThan(10);
  });

  it.skipIf(!baked)('gives up after a quiet while, walks back and puts off', () => {
    const posse = posseAt(4, wharf());
    if (!posse?.land()) throw new Error('no landing');
    const seen: string[] = [];
    posse.onPosse((e) => seen.push(e.type));
    step(posse, faraway(), GIVE_UP_S.notorious + 1);
    expect(seen).toContain('PosseGaveUp');
    step(posse, faraway(), 200);
    expect(seen).toEqual(['PosseGaveUp', 'PosseLeft']);
    expect(posse.phase).toBe('gone');
    expect(posse.stealth.guards).toHaveLength(0);
    expect(posse.count).toBe(0);
  });

  it.skipIf(!baked)('a marshal who sees you gives chase, and that is danger (§20.3 #11)', () => {
    const posse = posseAt(4, wharf());
    if (!posse?.land()) throw new Error('no landing');
    const marshal = posse.stealth.guards[0];
    if (!marshal) throw new Error('no marshal');
    expect(posse.pursued).toBe(false);
    // Stand in front of him in daylight.
    const m = marshal.body.position;
    const x = m.x + Math.sin(marshal.body.heading) * 4;
    const z = m.z - Math.cos(marshal.body.heading) * 4;
    const me = createCharacter({ x, y: scene.ground.heightAt(x, z), z });
    let pursued = false;
    for (let t = 0; t < 60 * 20 && !pursued && !posse.captured; t++) {
      posse.step(1 / 60, me, true);
      pursued = posse.pursued;
    }
    expect(pursued).toBe(true);
  });

  it.skipIf(!baked)(
    "breaks off at a hideout's bounds, never sets foot in them, and saw you go in",
    () => {
      const boat = wharf();
      // Find where the marshal lands, then put a hideout's bounds a few meters from him.
      const probe = posseAt(4, boat);
      if (!probe?.land() || !probe.landing) throw new Error('no landing');
      const marshal0 = probe.stealth.guards[0];
      if (!marshal0) throw new Error('no marshal');
      const h = marshal0.body.heading;
      const cx = probe.landing.x + Math.sin(h) * 14;
      const cz = probe.landing.z - Math.cos(h) * 14;
      const box = { minX: cx - 6, maxX: cx + 6, minZ: cz - 6, maxZ: cz + 6 };
      const inBox = (p: { x: number; z: number }) =>
        p.x >= box.minX && p.x <= box.maxX && p.z >= box.minZ && p.z <= box.maxZ;
      const posse = posseAt(4, boat, (p) => (inBox(p) ? 'hideout.test' : undefined));
      if (!posse?.land()) throw new Error('no landing');
      const marshal = posse.stealth.guards[0];
      if (!marshal) throw new Error('no marshal');
      const events: { type: string; sawIt?: boolean; hideout?: string }[] = [];
      posse.onPosse((e) => events.push(e));

      // Seen just outside the bounds, between him and them.
      const m = marshal.body.position;
      const x0 = m.x + Math.sin(h) * 6;
      const z0 = m.z - Math.cos(h) * 6;
      const me = createCharacter({ x: x0, y: scene.ground.heightAt(x0, z0), z: z0 });
      for (let t = 0; t < 60 * 20 && !posse.pursued; t++) posse.step(1 / 60, me, true);
      expect(posse.pursued).toBe(true);

      // Into the bounds: the chase is over, and he watched you go.
      me.position.x = cx;
      me.position.z = cz;
      me.position.y = scene.ground.heightAt(cx, cz);
      posse.step(1 / 60, me, true);
      expect(posse.pursued).toBe(false);
      expect(events).toContainEqual(
        expect.objectContaining({ type: 'PosseBrokeOff', hideout: 'hideout.test', sawIt: true }),
      );
      // Stand there a while in plain sight: nobody takes you, nobody comes in.
      for (let t = 0; t < 90 * 20; t++) {
        posse.step(1 / 20, me, true);
        for (const g of posse.stealth.guards) expect(inBox(g.body.position)).toBe(false);
      }
      expect(posse.captured).toBe(false);
      expect(posse.pursued).toBe(false);
    },
  );

  it.skipIf(!baked)('no posse at all on the mainland', () => {
    expect(
      createIslandPosse({ scene, placed: { ...placed, mainland: true }, seed: 's', conditions }),
    ).toBeUndefined();
    expect(ISLAND_NAV_CELL_M).toBeGreaterThan(0);
  });
});
