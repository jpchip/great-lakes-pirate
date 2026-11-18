import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { SECONDS_PER_GAME_DAY } from '../src/core/time';
import { LIGHTHOUSES, lightsIn, placeLights, type PlacedLight } from '../src/sim/lighthouses';
import {
  BLUFF_RISE_M,
  LIGHT_STATIONS,
  STATION_RULES,
  emptyStation,
  houseCash,
  houseStocked,
  keepersOnDuty,
  lampOut,
  living,
  logbookHere,
  oilLeft,
  onDuty,
  placeStation,
  settleStation,
  skeletonPlatformHalf,
  stationFor,
  stationKeepers,
  stationKit,
  welcomeAt,
} from '../src/sim/light-stations';
import { loadZoneTerrain, type LoadedZone } from '../src/sim/terrain/load';
import { manifestFrame } from '../src/sim/terrain/zones';

const DAY = SECONDS_PER_GAME_DAY;

function need<T>(value: T | null | undefined, what = 'value'): T {
  if (value === undefined || value === null) throw new Error(`missing ${what}`);
  return value;
}

const light = (id: string) =>
  need(
    LIGHTHOUSES.find((l) => l.id === id),
    id,
  );
const station = (id: string) => need(stationFor(id), id);

/** A light on a flat island 3 m high whose shore lies 30 m to the north (seaward = 0). */
function flatLight(
  id: string,
  groundM = 3,
): {
  p: PlacedLight;
  heightAt: (x: number, z: number) => number;
} {
  const heightAt = (_x: number, z: number) => (z < -30 ? -5 : groundM);
  return { p: { def: light(id), x: 0, z: 0, groundM, seaward: 0 } as PlacedLight, heightAt };
}

describe('the light stations (plan 11 §18 piece H)', () => {
  it('has a station for each of the seven Apostles lights, keepers by name', () => {
    expect(LIGHT_STATIONS.map((s) => s.light).sort()).toEqual(
      lightsIn('zone.apostles')
        .map((l) => l.id)
        .sort(),
    );
    for (const s of LIGHT_STATIONS) {
      const def = light(s.light);
      expect(s.keepers.length, s.light).toBeGreaterThanOrEqual(def.keepers);
      expect(stationKeepers(def)).toHaveLength(def.keepers);
      expect(s.kerosene).toBeGreaterThan(0);
      expect(s.loyalty).toBeGreaterThanOrEqual(0);
      expect(s.loyalty).toBeLessThanOrEqual(1);
    }
    expect(stationKeepers(light('light.raspberry'))[0]).toEqual({
      id: 'light.raspberry.k1',
      name: 'Francis Jacker',
    });
  });

  it.each(LIGHT_STATIONS.map((s) => [s.light] as const))(
    'gives %s a kit with a tower, a house, an oil house and doors to each',
    (id) => {
      const kit = stationKit(light(id));
      const parts = new Set(kit.solids.map((s) => s.part));
      expect(parts.has('tower') || parts.has('leg')).toBe(true);
      expect(parts.has('house')).toBe(true);
      expect(parts.has('oil')).toBe(true);
      expect(kit.gallery.y).toBeGreaterThan(light(id).tower.heightM * 0.7);
      // Doors stand apart: you can tell which you're at.
      const { tower, house, oil } = kit.doors;
      expect(Math.hypot(tower.x - oil.x, tower.z - oil.z)).toBeGreaterThan(2);
      expect(Math.hypot(house.x - oil.x, house.z - oil.z)).toBeGreaterThan(2);
    },
  );

  it('climbs a skeleton tower by ladder and a masonry one by stair', () => {
    expect(stationKit(light('light.devils')).ladder).toBe(true);
    expect(stationKit(light('light.raspberry')).ladder).toBe(false);
    expect(skeletonPlatformHalf(20)).toBeGreaterThanOrEqual(2.1);
  });

  it('sets a station down on its light with a landing stage out to the water', () => {
    const { p, heightAt } = flatLight('light.raspberry');
    const st = need(placeStation(p, heightAt), 'station');
    expect(st.island).toBe('island.raspberry');
    const landing = need(st.landing, 'landing');
    // North of the tower, reaching over the water.
    expect(landing.z).toBeLessThan(-30);
    expect(landing.z + landing.d / 2).toBeGreaterThan(-30);
    expect(need(st.landingLadder, 'ladder').topY).toBe(landing.maxY);
    // Flat ground: no stair up a bluff.
    expect(st.bluff).toBeUndefined();
    // The gallery is up the tower, its lamp within reach of where you stand on it.
    expect(st.gallery.stand.y).toBeGreaterThan(p.groundM + 8);
    expect(
      Math.hypot(st.gallery.stand.x - st.gallery.lamp.x, st.gallery.stand.z - st.gallery.lamp.z),
    ).toBeLessThanOrEqual(st.gallery.reachM + 0.01);
    // Doors at the ground (the dwelling's stand on its sill).
    for (const d of Object.values(st.doors)) {
      expect(d.y).toBeGreaterThanOrEqual(p.groundM);
      expect(d.y).toBeLessThan(p.groundM + 0.5);
    }
  });

  it('puts a stair up the bluff when the station stands high over its landing', () => {
    const { p } = flatLight('light.michigan', 17);
    // A low beach under a steep bank.
    const heightAt = (_x: number, z: number) => (z < -30 ? -5 : z < -24 ? 1 : 17);
    const st = need(placeStation(p, heightAt), 'station');
    const bluff = need(st.bluff, 'bluff');
    expect(bluff.head.y - bluff.foot.y).toBeGreaterThanOrEqual(BLUFF_RISE_M);
    expect(bluff.head.y).toBeCloseTo(17, 6);
    expect(st.stairs.length).toBeGreaterThan(0);
  });

  it('stands a door on the ground of a sloping site', () => {
    const { p } = flatLight('light.outer');
    const slope = (x: number, z: number) => (z < -30 ? -5 : 3 + Math.max(0, z) * 0.3 + x * 0);
    const st = need(placeStation(p, slope), 'station');
    for (const d of Object.values(st.doors)) expect(d.y).toBeGreaterThanOrEqual(slope(d.x, d.z));
  });
});

describe("a station's keepers and stores", () => {
  const rasp = light('light.raspberry');
  const k1 = 'light.raspberry.k1';
  const k2 = 'light.raspberry.k2';

  it('keeps every keeper at his post until something befalls him', () => {
    expect(keepersOnDuty(rasp, undefined, 0)).toBe(2);
    const st = emptyStation();
    st.keepers[k1] = { downUntil: 100 };
    expect(onDuty(st, k1, 50)).toBe(false);
    expect(onDuty(st, k1, 100)).toBe(true);
    st.keepers[k2] = { bribedUntil: 200 };
    expect(keepersOnDuty(rasp, st, 50)).toBe(0);
    expect(keepersOnDuty(rasp, st, 150)).toBe(1);
  });

  it("leaves a dead keeper's post empty until his relief comes", () => {
    const st = emptyStation();
    st.keepers[k1] = { diedAt: 0 };
    const relief = STATION_RULES.replaceDays * DAY;
    expect(living(st, k1, relief - 1)).toBe(false);
    expect(onDuty(st, k1, relief - 1)).toBe(false);
    expect(living(st, k1, relief)).toBe(true);
    expect(settleStation(rasp, st, relief)).toBe(true);
    expect(st.keepers[k1]).toBeUndefined();
  });

  it('lights a doused lamp again once a keeper at his post sees it', () => {
    const st = emptyStation();
    st.dousedAt = 1000;
    expect(lampOut(st)).toBe(true);
    const relit = 1000 + STATION_RULES.relightMin * 60;
    expect(settleStation(rasp, st, relit - 1)).toBe(false);
    expect(lampOut(st)).toBe(true);
    expect(settleStation(rasp, st, relit)).toBe(true);
    expect(lampOut(st)).toBe(false);
  });

  it('leaves the lamp dark while nobody is at his post to light it', () => {
    const st = emptyStation();
    st.dousedAt = 0;
    st.keepers[k1] = { downUntil: 10 * 3600 };
    st.keepers[k2] = { diedAt: 0 };
    settleStation(rasp, st, 2 * 3600);
    expect(lampOut(st)).toBe(true);
    // He comes round, and the lamp is lit.
    settleStation(rasp, st, 10 * 3600);
    expect(lampOut(st)).toBe(false);
    expect(st.keepers[k2]).toBeDefined();
  });

  it('runs the oil house down a can at a time, stocked again after the tender comes', () => {
    const def = station('light.raspberry');
    const st = emptyStation();
    expect(oilLeft(def, st, 0)).toBe(def.kerosene);
    st.oilTaken = { count: 2, since: 0 };
    expect(oilLeft(def, st, DAY)).toBe(def.kerosene - 2);
    st.oilTaken = { count: 99, since: 0 };
    expect(oilLeft(def, st, DAY)).toBe(0);
    expect(oilLeft(def, st, STATION_RULES.restockDays * DAY)).toBe(def.kerosene);
  });

  it('fills the house and the logbook again after the restock', () => {
    const st = emptyStation();
    st.houseRobbedAt = 0;
    st.logbookTakenAt = 0;
    expect(houseStocked(st, DAY)).toBe(false);
    expect(logbookHere(st, DAY)).toBe(false);
    const later = STATION_RULES.restockDays * DAY;
    expect(houseStocked(st, later)).toBe(true);
    expect(logbookHere(st, later)).toBe(true);
  });

  it("pays out the house's cash from the run's seed, within its range", () => {
    const def = station('light.raspberry');
    const a = houseCash(def, 7, DAY);
    expect(houseCash(def, 7, DAY)).toBe(a);
    expect(a).toBeGreaterThanOrEqual(def.houseCashCents[0]);
    expect(a).toBeLessThanOrEqual(def.houseCashCents[1]);
  });

  it('welcomes a visitor by day only at low Wanted', () => {
    expect(welcomeAt(0)).toBe(true);
    expect(welcomeAt(STATION_RULES.welcomeMaxTier)).toBe(true);
    expect(welcomeAt(STATION_RULES.welcomeMaxTier + 1)).toBe(false);
  });
});

describe('the stations on the Apostles zone', () => {
  const dir = join(__dirname, '..', 'public', 'world', 'apostles');
  const baked =
    existsSync(join(dir, 'manifest.json')) &&
    readFileSync(join(dir, 'height', '0-0.bin')).byteLength > 200;
  let zone: LoadedZone;
  beforeAll(async () => {
    if (!baked) return;
    zone = await loadZoneTerrain(async (path) => new Uint8Array(readFileSync(join(dir, path))));
  });

  it('gives every station a landing over the water and doors on dry ground', () => {
    if (!baked) return;
    const frame = manifestFrame(zone.manifest);
    const heightAt = (x: number, z: number) =>
      zone.terrain.contains(x, z) ? zone.terrain.heightAt(x, z) : -10;
    const placed = placeLights(lightsIn('zone.apostles'), frame, zone.terrain);
    for (const p of placed) {
      const st = need(placeStation(p, heightAt), p.def.id);
      const landing = need(st.landing, `${p.def.id} landing`);
      const fx = Math.sin(p.seaward);
      const fz = -Math.cos(p.seaward);
      const tip = { x: landing.x + (fx * landing.d) / 2, z: landing.z + (fz * landing.d) / 2 };
      expect(heightAt(tip.x, tip.z), `${p.def.id} landing tip`).toBeLessThan(0.2);
      for (const [name, d] of Object.entries(st.doors)) {
        expect(heightAt(d.x, d.z), `${p.def.id} ${name}`).toBeGreaterThan(0);
      }
    }
    // Michigan Island's station is high on its bluff: a stair goes up to it.
    const mich = need(
      placeStation(need(placed.find((p) => p.def.id === 'light.michigan')), heightAt),
    );
    expect(mich.bluff).toBeDefined();
  });
});
