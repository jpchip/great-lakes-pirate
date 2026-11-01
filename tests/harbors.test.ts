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
  findHarbor,
  footprintPoint,
  harborClearings,
  HARBORS,
  harborsIn,
  harborZoneId,
  layoutHarbor,
  layoutHarbors,
  pierHead,
  type HarborLayout,
  type PlacedPier,
} from '../src/sim/harbors';
import { lightsIn, placeLights } from '../src/sim/lighthouses';
import { loadZoneTerrain, type LoadedZone } from '../src/sim/terrain/load';
import { defFrame, manifestFrame, setPieceFootprint, zoneDef } from '../src/sim/terrain/zones';
import type { ZoneTerrain } from '../src/sim/terrain/zone-terrain';

const DEG = Math.PI / 180;

describe('the harbor data', () => {
  it('names a real set piece for every harbor, and gives each kind of pier once', () => {
    for (const h of HARBORS) {
      const ids = new Set(zoneDef(harborZoneId(h)).setPieces.map((s) => s.id));
      expect(ids.has(h.setPiece), h.id).toBe(true);
      // An entry has a pier each side; every other kind of pier comes once per harbor.
      const kinds = h.piers.map((p) => p.kind).filter((k) => k !== 'canal');
      expect(new Set(kinds).size, h.id).toBe(kinds.length);
    }
    const ids = HARBORS.map((h) => h.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(harborsIn('zone.apostles').map((h) => h.id)).toEqual([
      'harbor.bayfield',
      'harbor.ashland',
    ]);
    expect(harborsIn('zone.twin_ports').map((h) => h.id)).toEqual([
      'harbor.duluth_canal',
      'harbor.duluth',
      'harbor.superior_entry',
      'harbor.superior',
    ]);
    expect(harborsIn('zone.two_harbors').map((h) => h.id)).toEqual(['harbor.two_harbors']);
  });

  it('finds a harbor by its id or a fragment, exact first', () => {
    expect(findHarbor('duluth')?.id).toBe('harbor.duluth');
    expect(findHarbor('canal')?.id).toBe('harbor.duluth_canal');
    expect(findHarbor('harbor.two_harbors')?.id).toBe('harbor.two_harbors');
    expect(findHarbor('nowhere')).toBeUndefined();
  });

  it('lines the Duluth Ship Canal and Superior Entry with a pier each side, at 1:1 (piece I)', () => {
    for (const [id, piece, gap] of [
      ['harbor.duluth_canal', 'setpiece.duluth_canal', 90],
      ['harbor.superior_entry', 'setpiece.superior_entry', 150],
    ] as const) {
      const h = HARBORS.find((x) => x.id === id);
      const canal = h?.piers.filter((p) => p.kind === 'canal') ?? [];
      expect(canal, id).toHaveLength(2);
      const [a, b] = canal;
      if (!a || !b) throw new Error(id);
      // Both on the cut's own bearing, one each side of it, the inner faces about the
      // real entry's width apart: the canal 300 ft, Superior Entry about 500 ft.
      expect(a.bearingDeg, id).toBeUndefined();
      expect(Math.sign(a.alongM) * Math.sign(b.alongM), id).toBe(-1);
      const inner = Math.abs(a.alongM - b.alongM) - (a.widthM + b.widthM) / 2;
      expect(inner, id).toBeGreaterThanOrEqual(gap);
      expect(inner, id).toBeLessThan(gap + 15);
      const cut = zoneDef('zone.twin_ports').setPieces.find((p) => p.id === piece)?.cuts?.[0];
      expect(inner, id).toBeGreaterThanOrEqual(cut?.widthM ?? Infinity);
    }
  });

  it('gives Two Harbors a 1:1 wooden ore dock', () => {
    const ore = HARBORS.find((h) => h.id === 'harbor.two_harbors')?.piers.find(
      (p) => p.kind === 'ore',
    );
    // The D&IR docks stood about 50 ft above the water to the top of the pockets.
    expect(ore?.deckM).toBeGreaterThanOrEqual(15);
    expect(ore?.widthM).toBeGreaterThanOrEqual(15);
    expect(ore?.lengthM).toBeGreaterThanOrEqual(180);
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
    dockAtEveryPier(zone.terrain, layouts);
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

/** A zone baked into public/world/<dir>, or undefined when the LFS files aren't there. */
function bakedDir(name: string): string | undefined {
  const dir = join(__dirname, '..', 'public', 'world', name);
  return existsSync(join(dir, 'manifest.json')) &&
    readFileSync(join(dir, 'height', '0-0.bin')).byteLength > 200
    ? dir
    : undefined;
}

/**
 * Drifts the T1 in at a knot from 8 m off every berth of every pier with berths, through
 * the plan 02 hazards on the real zone, and checks she docks without a scratch. A pier
 * with berths has to have at least one deep enough to lie at.
 */
function dockAtEveryPier(terrain: ZoneTerrain, layouts: readonly HarborLayout[]): number {
  const record = sailShipRecord(T1_SCHOONER_ID);
  const sailing = compileSailingClass(record, defaultHandling());
  const c = compileHazardClass(record, defaultHazardRules());
  const docks = layouts.flatMap((l) => l.piers);
  const env: HazardEnv = { terrain, docks, berths: mooringBerths(docks, terrain) };
  const wind = { fromRad: 270 * DEG, speedKn: 10, gust01: 0 };
  let docked = 0;
  for (const l of layouts) {
    for (const pier of l.piers) {
      const own = env.berths.filter((b) => b.dockId === pier.id);
      if (pier.berths === false) {
        expect(own, pier.id).toHaveLength(0);
        continue;
      }
      expect(own.length, pier.id).toBeGreaterThan(0);
      for (const berth of own) {
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
        docked++;
      }
    }
  }
  return docked;
}

/** Whether a point lies on a pier's deck footprint, with `pad` meters to spare. */
function onPier(p: PlacedPier, x: number, z: number, pad: number): boolean {
  const fx = Math.sin(p.bearing);
  const fz = -Math.cos(p.bearing);
  const dx = x - p.root.x;
  const dz = z - p.root.z;
  const along = dx * fx + dz * fz;
  const across = Math.abs(dx * -fz + dz * fx);
  return along >= -pad && along <= p.lengthM + pad && across <= p.widthM / 2 + pad;
}

for (const [zoneId, dirName] of [
  ['zone.twin_ports', 'twin_ports'],
  ['zone.two_harbors', 'two_harbors'],
] as const) {
  describe(`the harbors in ${zoneId} (Phase 3 piece I)`, () => {
    const dir = bakedDir(dirName);
    let zone: LoadedZone;
    let layouts: HarborLayout[];

    beforeAll(async () => {
      if (!dir) return;
      zone = await loadZoneTerrain(async (path) => new Uint8Array(readFileSync(join(dir, path))));
      layouts = layoutHarbors(manifestFrame(zone.manifest), zone.terrain, zoneId);
    });

    it.skipIf(!dir)('lays out only this zone’s harbors', () => {
      expect(layouts.map((l) => l.def.id)).toEqual(harborsIn(zoneId).map((h) => h.id));
      // The Apostles' harbors aren't laid out here (they were, off the zone's edge).
      expect(layoutHarbors(manifestFrame(zone.manifest), zone.terrain).length).toBe(2);
    });

    it.skipIf(!dir)('docks at every pier with berths, in water deep enough', () => {
      for (const l of layouts) {
        for (const b of mooringBerths(l.piers, zone.terrain)) {
          expect(zone.terrain.heightAt(b.pose.x, b.pose.z), b.id).toBeLessThan(-3);
        }
      }
      expect(dockAtEveryPier(zone.terrain, layouts)).toBeGreaterThanOrEqual(
        zoneId === 'zone.twin_ports' ? 8 : 6,
      );
    });

    it.skipIf(!dir)('stands the buildings on dry ground and fills the towns', () => {
      for (const l of layouts) {
        for (const b of l.buildings) {
          expect(b.floorM, `${l.def.id} ${b.kind}`).toBeGreaterThanOrEqual(b.footM);
          if (b.kind === 'house') {
            expect(zone.terrain.heightAt(b.x, b.z), `${l.def.id} house`).toBeGreaterThan(0.5);
          }
        }
        const houses = l.buildings.filter((b) => b.kind === 'house').length;
        expect(houses, l.def.id).toBeGreaterThanOrEqual(l.def.town.houses * 0.6);
        expect(houses, l.def.id).toBeLessThanOrEqual(l.def.town.houses);
      }
    });

    it.skipIf(!dir || zoneId !== 'zone.twin_ports')(
      'leaves the canal and Superior Entry open to sail through between their piers',
      () => {
        const frame = manifestFrame(zone.manifest);
        for (const h of ['harbor.duluth_canal', 'harbor.superior_entry']) {
          const l = layouts.find((x) => x.def.id === h);
          const canal = l?.piers.filter((p) => p.kind === 'canal') ?? [];
          expect(canal, h).toHaveLength(2);
          const piece = zoneDef(zoneId).setPieces.find((p) => p.id === l?.def.setPiece);
          if (!piece || !l) throw new Error(h);
          const fp = setPieceFootprint(piece, frame);
          // Down the middle from the harbor side to the lake: deep water, no pier within
          // 25 m either side (a T1's beam is under 7 m).
          const defs = l.def.piers.filter((p) => p.kind === 'canal');
          const middle = defs.reduce((sum, p) => sum + p.alongM, 0) / defs.length;
          const from = Math.max(...defs.map((p) => p.inlandM));
          const to = Math.min(...defs.map((p) => p.inlandM - p.lengthM));
          for (let inland = from; inland >= to; inland -= 5) {
            const mid = footprintPoint(fp, middle, inland);
            expect(zone.terrain.heightAt(mid.x, mid.z), `${h} ${inland}`).toBeLessThan(-5);
            for (const pier of canal) {
              expect(onPier(pier, mid.x, mid.z, 25), `${h} ${pier.id} ${inland}`).toBe(false);
            }
          }
          // And the piers really are walls: the lake end of each stands in the water.
          for (const pier of canal) {
            const head = pierHead(pier.id, frame, zone.terrain);
            expect(head && zone.terrain.heightAt(head.x, head.z), pier.id).toBeLessThan(-5);
          }
        }
      },
    );

    it.skipIf(!dir)('stands the 1900 lights: pierheads on their piers, the rest ashore', () => {
      const frame = manifestFrame(zone.manifest);
      const placed = placeLights(lightsIn(zoneId), frame, zone.terrain);
      expect(placed.map((p) => p.def.id).sort()).toEqual(
        zoneId === 'zone.twin_ports'
          ? ['light.duluth_south_pier', 'light.minnesota_point', 'light.superior_entry']
          : ['light.two_harbors'],
      );
      const piers = layouts.flatMap((l) => l.piers);
      for (const p of placed) {
        if (p.def.pier) {
          const pier = piers.find((x) => x.id === p.def.pier);
          if (!pier) throw new Error(`${p.def.id}: no pier ${p.def.pier}`);
          expect(onPier(pier, p.x, p.z, 0), p.def.id).toBe(true);
          expect(p.groundM, p.def.id).toBe(pier.deckM);
        } else {
          expect(zone.terrain.heightAt(p.x, p.z), p.def.id).toBeGreaterThanOrEqual(1.5);
          // Clear of the piers and the buildings.
          for (const pier of piers) expect(onPier(pier, p.x, p.z, 4), p.def.id).toBe(false);
        }
      }
    });

    it.skipIf(!dir)('draws each harbor in two draw calls, within the triangle budget', () => {
      const lighting = new StyleLighting();
      const view = createHarbors(layouts, (x, z) => zone.terrain.heightAt(x, z), lighting);
      expect(view.group.children).toHaveLength(layouts.length * 2);
      expect(view.triangles).toBeLessThan(250_000);
      view.dispose();
    });
  });
}
