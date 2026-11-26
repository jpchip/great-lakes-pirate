import { layoutHarbors, type HarborLayout } from '../src/sim/harbors';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type * as THREE from 'three';
import { beforeAll, describe, expect, it } from 'vitest';
import tiersJson from '../data/island_tiers.json';
import { islandTiersFileSchema } from '../data/schemas/island_tiers';
import { ChartProjection, chartToZone } from '../src/core/coords';
import { attachIslandAshore, type IslandAshore } from '../src/gameplay/island-ashore';
import { beachStep, buildAshoreScene, rockStep } from '../src/gameplay/onfoot/ashore-scene';
import { createCharacter, stepCharacter } from '../src/gameplay/onfoot/controller';
import { pieceGeometry } from '../src/render/onfoot/poi-view';
import { findLanding, type IslandLanding } from '../src/sim/islands/island-land';
import { ISLANDS, placeZoneIslands, type PlacedIsland } from '../src/sim/islands/on-foot';
import { LIGHT_STATIONS, placeStation, type PlacedStation } from '../src/sim/light-stations';
import { lightsIn, placeLights } from '../src/sim/lighthouses';
import { RIVALS } from '../src/sim/rivals/rivals';
import type { GridField } from '../src/sim/terrain/grid-field';
import { loadIslandGround, loadZoneTerrain, type LoadedZone } from '../src/sim/terrain/load';
import { manifestFrame } from '../src/sim/terrain/zones';
import { createWorldState } from '../src/sim/world-state';

/**
 * Plan 11 §18.3 criterion 12 (Phase 9 piece R): every one of the 22 Apostle Islands lands
 * and walks at its tier. For each island with `onFoot` data this finds a landing (a
 * prefab's landing mark or the gentlest shore), checks the boat's water there takes you to
 * that island's scene and no other, builds the scene, and walks inland from the beach. Each
 * island's layout is held to its tier's budget in `island_tiers.json`: its prefabs and
 * their triangles, and the people who could be ashore (station keepers and the residents'
 * marks; wildlife is piece V). The whole frame's draw calls on foot are `bench.island`'s,
 * per tier.
 *
 * An island without `onFoot` data yet (a hero island before piece Q lands) is skipped, so
 * it starts being checked the moment its data does.
 */

const TIERS = islandTiersFileSchema.parse(tiersJson);

/** Plan 11 §2.2's catalog: each Apostle's tier. */
const CATALOG: Record<string, 'hero' | 'standard' | 'minor'> = {
  'island.madeline': 'hero',
  'island.stockton': 'hero',
  'island.hermit': 'hero',
  'island.basswood': 'hero',
  'island.devils': 'hero',
  'island.sand': 'hero',
  'island.outer': 'hero',
  'island.raspberry': 'hero',
  'island.michigan': 'standard',
  'island.long': 'standard',
  'island.oak': 'standard',
  'island.manitou': 'standard',
  'island.rocky': 'standard',
  'island.south_twin': 'standard',
  'island.otter': 'standard',
  'island.bear': 'standard',
  'island.cat': 'minor',
  'island.ironwood': 'minor',
  'island.york': 'minor',
  'island.north_twin': 'minor',
  'island.gull': 'minor',
  'island.eagle': 'minor',
};

const APOSTLES = ISLANDS.filter((i) => i.zone === 'zone.apostles' && !i.mainland);

const triangles = (gs: THREE.BufferGeometry[]): number =>
  gs.reduce((n, g) => n + g.getAttribute('position').count / 3, 0);

describe('the 22 Apostles in islands.json', () => {
  it('lists every island of the catalog, each at its tier where it has one', () => {
    expect(APOSTLES.map((i) => i.id).sort()).toEqual(Object.keys(CATALOG).sort());
    for (const def of APOSTLES) {
      if (def.tier) expect(def.tier, def.id).toBe(CATALOG[def.id]);
      // Walkable means a tier, and a tier means walkable.
      expect(!!def.onFoot, def.id).toBe(!!def.tier);
    }
  });

  it('every standard and minor island is walkable (piece R)', () => {
    for (const def of APOSTLES) {
      if (CATALOG[def.id] === 'hero') continue;
      expect(def.onFoot, def.id).toBeDefined();
    }
  });

  for (const def of APOSTLES) {
    it.skipIf(!def.onFoot)(`${def.name} keeps to the ${CATALOG[def.id]} budget`, () => {
      const tier = TIERS.tiers[CATALOG[def.id] ?? 'minor'];
      const pois = def.onFoot?.pois ?? [];
      expect(pois.length).toBeLessThanOrEqual(tier.maxPois);
      expect(new Set(pois.map((p) => p.id)).size).toBe(pois.length);
    });
  }
});

const dir = join(__dirname, '..', 'public', 'world', 'apostles');
const baked =
  existsSync(join(dir, 'manifest.json')) &&
  existsSync(join(dir, 'islands', 'oak', '0-0.bin')) &&
  readFileSync(join(dir, 'islands', 'oak', '0-0.bin')).byteLength > 200;

describe('landing on and walking every island', () => {
  let zone: LoadedZone;
  let placed: PlacedIsland[] = [];
  let stations: PlacedStation[] = [];
  let harbors: HarborLayout[] = [];
  const grounds = new Map<string, GridField>();
  let ashore: IslandAshore;
  const heightAt = (x: number, z: number): number => zone.terrain.heightAt(x, z);
  const landings = new Map<string, IslandLanding | undefined>();

  beforeAll(async () => {
    if (!baked) return;
    const read = async (path: string) => new Uint8Array(readFileSync(join(dir, path)));
    zone = await loadZoneTerrain(read);
    const frame = manifestFrame(zone.manifest);
    placed = placeZoneIslands(zone.manifest.zone, zone.manifest.islands ?? [], heightAt, frame);
    for (const p of placed) {
      const g = await loadIslandGround(read, zone.manifest, p.id);
      if (g) grounds.set(p.id, g);
    }
    harbors = layoutHarbors(frame, zone.terrain);
    stations = placeLights(lightsIn(zone.manifest.zone), frame, zone.terrain).flatMap(
      (l) => placeStation(l, heightAt) ?? [],
    );
    ashore = attachIslandAshore({
      state: createWorldState('islands-test'),
      heightAt,
      grid: () => ({
        x0: zone.terrain.height.x0,
        z0: zone.terrain.height.z0,
        step: zone.terrain.height.step,
      }),
      islands: () => placed,
      ground: (id) => grounds.get(id),
      stations: () => stations,
      runSeed: () => 7,
      notice: () => undefined,
      harbors: () => harbors,
    });
    for (const p of placed) landings.set(p.id, findLanding(p, heightAt));
  }, 120_000);

  it.skipIf(!baked)(
    "lays Madeline's hearths on dry ground in La Pointe, by the trapper's cabin and at the fish camp",
    () => {
      // La Pointe's, before the general store, and the trapper's and the fish camp's.
      const fires = ashore.hearths();
      expect(fires).toHaveLength(3);
      for (const f of fires) {
        expect(heightAt(f.x, f.z)).toBeGreaterThan(0);
        expect(ashore.walkableAt(f)).toBe(true);
      }
    },
  );

  for (const def of APOSTLES) {
    it.skipIf(!baked || !def.onFoot)(`lands on ${def.name} and walks inland`, () => {
      const island = placed.find((p) => p.id === def.id);
      expect(island, 'placed').toBeDefined();
      expect(island?.anchor, 'anchored').toBeDefined();
      expect(grounds.get(def.id), '1 m tiles').toBeDefined();
      const landing = landings.get(def.id);
      expect(landing, 'a landing').toBeDefined();
      if (!island || !landing) return;
      // The boat's water is deep enough, and it lands on this island and no other.
      expect(heightAt(landing.boat.x, landing.boat.z)).toBeLessThan(-1);
      expect(heightAt(landing.shore.x, landing.shore.z)).toBeGreaterThan(0.2);
      expect(ashore.walkableAt(landing.boat)).toBe(true);
      // Rowed in to the water's edge, you can step out over the bow.
      const lx = landing.boat.x - landing.shore.x;
      const lz = landing.boat.z - landing.shore.z;
      const len = Math.hypot(lx, lz);
      let k = 0;
      while (
        k < len &&
        heightAt(landing.shore.x + (lx / len) * k, landing.shore.z + (lz / len) * k) > -0.25
      ) {
        k += 0.5;
      }
      const bow = {
        x: landing.shore.x + (lx / len) * (k + 1),
        z: landing.shore.z + (lz / len) * (k + 1),
      };
      const step =
        beachStep(heightAt, bow, landing.inland) ?? rockStep(heightAt, bow, landing.inland);
      expect(step, 'steps ashore').toBeDefined();
      if (!step) return;
      const s = ashore.sceneFor(landing.boat);
      expect(s?.island).toBe(def.id);
      if (!s) return;
      const scene = buildAshoreScene({
        ground: s.ground,
        center: landing.shore,
        box: s.box,
        extra: s.extra,
        ladders: s.ladders,
      });
      // The whole island is in the scene.
      const field = grounds.get(def.id);
      if (field) {
        expect(scene.bounds.minX).toBeLessThanOrEqual(field.x0);
        expect(scene.bounds.maxZ).toBeGreaterThanOrEqual(field.maxZ);
      }
      // Up the beach and inland for eight seconds at a walk, turning off whatever stands in
      // the way (a fish house behind its dock) as a player would.
      const c = createCharacter({ x: step.x, y: step.y + 0.4, z: step.z });
      let wet = 0;
      let yaw = landing.inland;
      let from = { x: c.position.x, z: c.position.z };
      const start = { ...from };
      for (let t = 0; t < 8 * 60; t++) {
        if (t % 60 === 59) {
          if (Math.hypot(c.position.x - from.x, c.position.z - from.z) < 0.6) yaw += Math.PI / 3;
          from = { x: c.position.x, z: c.position.z };
        }
        stepCharacter(
          c,
          { forward: 1, right: 0, run: false, crouch: false, jump: t % 30 === 0 },
          yaw,
          scene,
          1 / 60,
        );
        if (c.swimming) wet++;
        expect(c.position.y).toBeGreaterThan(heightAt(c.position.x, c.position.z) - 0.5);
      }
      const moved = Math.hypot(c.position.x - start.x, c.position.z - start.z);
      expect(moved, 'walked inland').toBeGreaterThan(4);
      expect(c.swimming, 'ashore, not swimming').toBe(false);
      expect(wet / (8 * 60)).toBeLessThan(0.1);
      expect(heightAt(c.position.x, c.position.z)).toBeGreaterThan(0);
    });

    it.skipIf(!baked || !def.onFoot)(`${def.name}'s prefabs and people fit its tier`, () => {
      const island = placed.find((p) => p.id === def.id);
      if (!island) throw new Error('not placed');
      const tier = TIERS.tiers[CATALOG[def.id] ?? 'minor'];
      // One merged mesh for the zone's points of interest: their triangles are the cost.
      const tris = triangles(island.pieces.flatMap(pieceGeometry));
      expect(tris).toBeLessThanOrEqual(tier.poiTriangles);
      // Everything stands on the ground or a platform, never under it.
      for (const p of island.pieces) {
        expect(p.maxY, `${p.poi} ${p.kind}`).toBeGreaterThan(heightAt(p.x, p.z) - 1e-6);
      }
      // Who could be ashore: the station keepers and the island's residents (piece Q).
      const keepers = LIGHT_STATIONS.filter((st) => st.island === def.id).reduce(
        (n, st) => n + st.keepers.length,
        0,
      );
      const residents = island.residents.length;
      expect(keepers + residents).toBeLessThanOrEqual(tier.people);
      expect(tier.people).toBeLessThanOrEqual(TIERS.tiers.hero.people);
      expect(tier.animals).toBeLessThanOrEqual(TIERS.tiers.hero.animals);
    });
  }

  it.skipIf(!baked)('a station on a walkable island is part of its scene (piece H)', () => {
    for (const st of stations) {
      const def = APOSTLES.find((i) => i.id === st.island);
      if (!def?.onFoot || !st.landing) continue;
      // Landing at the station's landing stage: the island's scene, with this station's
      // keepers and its buildings solid.
      const s = ashore.sceneFor({ x: st.landing.x, z: st.landing.z });
      expect(s?.island, st.light.def.id).toBe(st.island);
      expect(s?.station?.light.def.id, st.light.def.id).toBe(st.light.def.id);
      expect(s?.extra.length ?? 0).toBeGreaterThan(st.solids.length);
      const ladder = st.landingLadder;
      if (ladder) {
        expect(s?.ladders.some((l) => Math.hypot(l.x - ladder.x, l.z - ladder.z) < 0.01)).toBe(
          true,
        );
      }
    }
  });

  it.skipIf(!baked)("a rival's camp is landed on at its own island", () => {
    const frame = manifestFrame(zone.manifest);
    const lake = new ChartProjection();
    for (const camp of RIVALS.camps) {
      const def = APOSTLES.find((i) => i.id === camp.island);
      if (!def?.onFoot) continue;
      const at = chartToZone(lake.geoToChart(camp.at), frame);
      expect(ashore.walkableAt(at), camp.id).toBe(true);
      expect(ashore.sceneFor(at)?.island, camp.id).toBe(camp.island);
    }
  });
});
