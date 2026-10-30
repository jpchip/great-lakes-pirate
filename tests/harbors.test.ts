import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { knotsToMs } from '../src/core/coords';
import { createHarbors } from '../src/render/harbors/harbors';
import { buildHarbor } from '../src/render/harbors/harbor-kit';
import { StyleLighting } from '../src/render/style/stylized-material';
import { createSailingState, IDLE_COMMAND, stepSailing } from '../src/sim/sailing/controller';
import { defaultHandling } from '../src/sim/sailing/handling';
import { defaultHazardRules } from '../src/sim/sailing/hazard-rules';
import {
  compileHazardClass,
  createHazardState,
  IDLE_MOORING,
  mooringBerths,
  stepHazards,
  type HazardEnv,
  type HazardEvent,
} from '../src/sim/sailing/hazards';
import { compileSailingClass } from '../src/sim/sailing/ship-class';
import { sailShipRecord, T1_SCHOONER_ID } from '../src/sim/sailing/ships';
import {
  footprintPoint,
  harborClearings,
  HARBORS,
  layoutHarbor,
  layoutHarbors,
  type HarborLayout,
} from '../src/sim/harbors';
import { loadZoneTerrain, type LoadedZone } from '../src/sim/terrain/load';
import { defFrame, manifestFrame, setPieceFootprint, zoneDef } from '../src/sim/terrain/zones';

const DEG = Math.PI / 180;

describe('the harbor data', () => {
  it('names a real set piece for every harbor, and gives each kind of pier once', () => {
    const ids = new Set(zoneDef('zone.apostles').setPieces.map((s) => s.id));
    for (const h of HARBORS) {
      expect(ids.has(h.setPiece), h.id).toBe(true);
      const kinds = h.piers.map((p) => p.kind);
      expect(new Set(kinds).size, h.id).toBe(kinds.length);
    }
    expect(HARBORS.map((h) => h.id)).toEqual(['harbor.bayfield', 'harbor.ashland']);
  });

  it('has Bayfield’s fish docks, packing house, cooperage and sawmill, and Ashland’s ore dock', () => {
    const bay = HARBORS.find((h) => h.id === 'harbor.bayfield');
    const ash = HARBORS.find((h) => h.id === 'harbor.ashland');
    const kinds = (h: typeof bay) => new Set(h?.buildings.map((b) => b.kind));
    expect(bay?.piers.map((p) => p.kind)).toContain('fish');
    for (const k of ['packingHouse', 'cooperage', 'sawmill'] as const) {
      expect(kinds(bay).has(k), k).toBe(true);
    }
    const ore = ash?.piers.find((p) => p.kind === 'ore');
    // The Soo Line dock ran about 1,800 ft; the lens keeps it at 1:1.
    expect(ore?.lengthM).toBeGreaterThanOrEqual(500);
  });
});

/** Flat land east of x = 0 and 8 m of water west of it, for the layout on its own. */
const flatShore = { heightAt: (x: number) => (x >= 0 ? 4 : -8) };

describe('laying out a harbor', () => {
  const zdef = zoneDef('zone.apostles');
  const frame = defFrame(zdef);
  const piece = (id: string) => {
    const p = zdef.setPieces.find((s) => s.id === id);
    if (!p) throw new Error(id);
    return setPieceFootprint(p, frame);
  };
  const def = HARBORS[0];
  if (!def) throw new Error('no harbors');

  it('roots each pier at the shore and runs it out over the water', () => {
    const fp = piece(def.setPiece);
    // A shore across the footprint's own frame: land inland of along-axis, water seaward.
    const shore = {
      heightAt: (x: number, z: number) => {
        const inland =
          -(x - fp.anchor.x) * Math.sin(fp.bearing) + (z - fp.anchor.z) * Math.cos(fp.bearing);
        return inland >= 0 ? 4 : -8;
      },
    };
    const layout = layoutHarbor(def, frame, shore, 'zone.apostles');
    for (const p of layout.piers) {
      expect(shore.heightAt(p.root.x, p.root.z), p.id).toBeGreaterThan(0);
      const sx = Math.sin(p.bearing);
      const sz = -Math.cos(p.bearing);
      const end = { x: p.root.x + sx * p.lengthM, z: p.root.z + sz * p.lengthM };
      expect(shore.heightAt(end.x, end.z), p.id).toBeLessThan(0);
      // The deck bites a few meters into the bank, no more.
      expect(p.shoreM, p.id).toBeGreaterThan(0);
      expect(p.shoreM, p.id).toBeLessThan(12);
    }
  });

  it('is deterministic', () => {
    const a = layoutHarbor(def, frame, flatShore, 'zone.apostles');
    const b = layoutHarbor(def, frame, flatShore, 'zone.apostles');
    expect(b.buildings).toEqual(a.buildings);
    expect(b.piers).toEqual(a.piers);
  });

  it('measures along and inland from the set piece anchor', () => {
    const fp = piece(def.setPiece);
    const seaward = footprintPoint(fp, 0, -10);
    expect(seaward.x - fp.anchor.x).toBeCloseTo(Math.sin(fp.bearing) * 10, 6);
    expect(seaward.z - fp.anchor.z).toBeCloseTo(-Math.cos(fp.bearing) * 10, 6);
  });
});

describe('the harbors on the Apostles zone', () => {
  const dir = join(__dirname, '..', 'public', 'world', 'apostles');
  const baked =
    existsSync(join(dir, 'manifest.json')) &&
    readFileSync(join(dir, 'height', '0-0.bin')).byteLength > 200;
  let zone: LoadedZone;
  let layouts: HarborLayout[];

  beforeAll(async () => {
    if (!baked) return;
    zone = await loadZoneTerrain(async (path) => new Uint8Array(readFileSync(join(dir, path))));
    layouts = layoutHarbors(manifestFrame(zone.manifest), zone.terrain);
  });

  it.skipIf(!baked)('puts every pier’s berths in water deep enough for the schooner', () => {
    for (const l of layouts) {
      for (const b of mooringBerths(l.piers, zone.terrain)) {
        expect(zone.terrain.heightAt(b.pose.x, b.pose.z), b.id).toBeLessThan(-3);
      }
    }
  });

  it.skipIf(!baked)('offers berths down the length of the long piers, not only at the end', () => {
    const ash = layouts.find((l) => l.def.id === 'harbor.ashland');
    const city = ash?.piers.find((p) => p.kind === 'city');
    if (!city) throw new Error('no Ashland city dock');
    const berths = mooringBerths([city], zone.terrain);
    // 166 m of pier: a pair every 36 m from the end, all in deep enough water.
    expect(berths.length).toBeGreaterThanOrEqual(6);
    const alongs = berths.map(
      (b) =>
        (b.pose.x - city.root.x) * Math.sin(city.bearing) -
        (b.pose.z - city.root.z) * Math.cos(city.bearing),
    );
    expect(Math.min(...alongs)).toBeLessThan(city.lengthM / 2);
  });

  it.skipIf(!baked)('stands the buildings on dry ground and fills the towns', () => {
    for (const l of layouts) {
      for (const b of l.buildings) {
        expect(zone.terrain.heightAt(b.x, b.z), `${l.def.id} ${b.kind}`).toBeGreaterThan(0.5);
        expect(b.floorM).toBeGreaterThanOrEqual(b.footM);
      }
      const houses = l.buildings.filter((b) => b.kind === 'house').length;
      expect(houses, l.def.id).toBeGreaterThan(l.def.town.houses * 0.6);
      expect(houses, l.def.id).toBeLessThanOrEqual(l.def.town.houses);
    }
  });

  it.skipIf(!baked)('keeps the piers apart and clears the trees from the buildings', () => {
    for (const l of layouts) {
      const ends = l.piers.map((p) => ({
        x: p.root.x + Math.sin(p.bearing) * p.lengthM,
        z: p.root.z - Math.cos(p.bearing) * p.lengthM,
      }));
      for (let i = 0; i < ends.length; i++) {
        for (let j = i + 1; j < ends.length; j++) {
          const a = ends[i];
          const b = ends[j];
          if (!a || !b) continue;
          expect(Math.hypot(a.x - b.x, a.z - b.z), l.def.id).toBeGreaterThan(60);
        }
      }
      expect(harborClearings(l).length).toBe(l.buildings.length + l.piers.length);
    }
  });

  it.skipIf(!baked)('docks at Bayfield and at Ashland (the piece G exit criterion)', () => {
    const record = sailShipRecord(T1_SCHOONER_ID);
    const sailing = compileSailingClass(record, defaultHandling());
    const c = compileHazardClass(record, defaultHazardRules());
    const docks = layouts.flatMap((l) => l.piers);
    const env: HazardEnv = {
      terrain: zone.terrain,
      docks,
      berths: mooringBerths(docks, zone.terrain),
    };
    const wind = { fromRad: 270 * DEG, speedKn: 10, gust01: 0 };
    for (const l of layouts) {
      for (const pier of l.piers) {
        const own = env.berths.filter((b) => b.dockId === pier.id);
        expect(own.length, pier.id).toBeGreaterThan(0);
        for (const berth of own) {
          // Drifting in at a knot, 8 m off the berth.
          const s = createSailingState(
            berth.pose.x + berth.awayX * 8,
            berth.pose.z + berth.awayZ * 8,
            berth.pose.heading,
          );
          s.speed = knotsToMs(1);
          const h = createHazardState(c);
          const events: HazardEvent[] = [];
          for (let i = 0; i < 240; i++) {
            const prev = { x: s.x, z: s.z, heading: s.heading };
            stepSailing(s, IDLE_COMMAND, sailing, wind, 0, { rate: 24, compression: 8 }, 1 / 30);
            stepHazards(
              s,
              h,
              c,
              { ...IDLE_MOORING, interact: i === 0 },
              env,
              prev,
              wind,
              { rate: 24, compression: 8 },
              1 / 30,
              events,
            );
          }
          expect(h.mooring, berth.id).toBe('docked');
          expect(events, berth.id).toContainEqual({ kind: 'docked', berthId: berth.id });
          expect(h.aground, berth.id).toBe(false);
          expect(h.hull, berth.id).toBe(100);
        }
      }
    }
  });

  it.skipIf(!baked)('draws both towns in four draw calls, within the triangle budget', () => {
    const lighting = new StyleLighting();
    const view = createHarbors(layouts, (x, z) => zone.terrain.heightAt(x, z), lighting);
    expect(view.group.children).toHaveLength(4);
    expect(view.triangles).toBeLessThan(250_000);
    for (const l of layouts) {
      expect(buildHarbor(l, (x, z) => zone.terrain.heightAt(x, z)).triangles).toBeGreaterThan(
        10_000,
      );
    }
    view.dispose();
  });
});
