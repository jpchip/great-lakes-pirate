import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { GridField } from '../src/sim/terrain/grid-field';
import { loadZoneTerrain, type LoadedZone } from '../src/sim/terrain/load';
import { dockBerths, dockPoint, TEST_BAY } from '../src/sim/terrain/test-bay';
import { WindMaps } from '../src/sim/terrain/zone-terrain';

const DEG = Math.PI / 180;

function field(width: number, height: number, f: (i: number, j: number) => number): GridField {
  const values = new Float32Array(width * height);
  for (let j = 0; j < height; j++) for (let i = 0; i < width; i++) values[j * width + i] = f(i, j);
  return new GridField(10, 20, 2, width, height, values);
}

describe('GridField', () => {
  const plane = field(5, 4, (i, j) => 3 * i - j);

  it('interpolates bilinearly and is exact on a plane', () => {
    expect(plane.sample(10, 20)).toBeCloseTo(0);
    // x = 13 is i = 1.5, z = 23 is j = 1.5.
    expect(plane.sample(13, 23)).toBeCloseTo(3 * 1.5 - 1.5);
  });

  it('extends the edge samples outward', () => {
    expect(plane.sample(-100, 20)).toBeCloseTo(0);
    expect(plane.sample(1000, 1000)).toBeCloseTo(3 * 4 - 3);
  });

  it('has a gradient in zone meters', () => {
    const g = plane.gradient(14, 22, { x: 0, z: 0 });
    expect(g.x).toBeCloseTo(1.5); // 3 per sample, 2 m per sample
    expect(g.z).toBeCloseTo(-0.5);
  });

  it('crops with the right frame', () => {
    const c = plane.crop(1, 1, 3, 2);
    expect(c.x0).toBe(12);
    expect(c.z0).toBe(22);
    expect(c.sample(14, 24)).toBeCloseTo(plane.sample(14, 24));
  });
});

describe('WindMaps', () => {
  // 16 layers; layer k holds k / 16 in shelter. One land cell at (0, 0).
  const layers = (f: (k: number) => number): GridField[] =>
    Array.from({ length: 16 }, (_, k) => field(3, 3, (i, j) => (i === 0 && j === 0 ? 0 : f(k))));
  const maps = new WindMaps(
    layers((k) => k / 16),
    layers(() => 1000),
    layers(() => 0.5),
  );

  it('blends the two nearest directions', () => {
    const at = (deg: number): number => maps.sample(maps.shelter, 13, 23, deg * DEG);
    expect(at(0)).toBeCloseTo(0);
    expect(at(22.5)).toBeCloseTo(1 / 16);
    expect(at(33.75)).toBeCloseTo(1.5 / 16);
    // Between the last layer and the first again.
    expect(at(360 - 11.25)).toBeCloseTo(7.5 / 16);
    expect(at(-22.5)).toBeCloseTo(15 / 16);
  });

  it('ignores land cells when interpolating', () => {
    // Halfway between the land cell and its water neighbors: water values only.
    expect(maps.sample(maps.funnel, 11, 21, 0)).toBeCloseTo(0.5);
    expect(maps.sample(maps.fetch, 11, 21, 0)).toBeCloseTo(1000);
    // On the land cell itself.
    expect(maps.sample(maps.fetch, 10, 20, 0)).toBe(0);
  });
});

describe('Apostles test bay', () => {
  const dir = join(__dirname, '..', 'public', 'world', 'apostles');
  // LFS pointer files are ~130 bytes; skip when the bake isn't checked out.
  const baked =
    existsSync(join(dir, 'manifest.json')) &&
    readFileSync(join(dir, 'height', '0-0.bin')).byteLength > 200;
  let zone: LoadedZone;

  beforeAll(async () => {
    if (!baked) return;
    zone = await loadZoneTerrain(
      async (path) => new Uint8Array(readFileSync(join(dir, path))),
      TEST_BAY.tiles,
    );
  });

  it.skipIf(!baked)('loads the 3 × 3 km slice', () => {
    const { terrain, backdrop } = zone;
    expect(terrain.zoneId).toBe(TEST_BAY.zone);
    expect(terrain.bounds).toEqual({ minX: -1536, minZ: -1024, maxX: 1536, maxZ: 2048 });
    expect(terrain.height.width).toBe(769);
    expect(terrain.sdf.width).toBe(769);
    expect(backdrop.step).toBe(32);
    // The backdrop agrees with the full-resolution slice on shared samples.
    for (const [x, z] of [
      [-1536, -1024],
      [-896, 320],
      [0, 0],
      [1536, 2048],
    ] as const) {
      expect(backdrop.sample(x, z)).toBeCloseTo(terrain.heightAt(x, z), 3);
    }
  });

  it.skipIf(!baked)('puts the spawn in deep open water and Bayfield ashore', () => {
    const { terrain } = zone;
    const { spawn } = TEST_BAY;
    expect(terrain.depthAt(spawn.x, spawn.z)).toBeGreaterThan(20);
    expect(terrain.shoreDistanceAt(spawn.x, spawn.z)).toBeGreaterThan(60);
    // Downtown Bayfield, 30 m inland of the dock.
    expect(terrain.heightAt(-910, 339)).toBeGreaterThan(5);
    expect(terrain.depthAt(-910, 339)).toBe(0);
    expect(terrain.shoreDistanceAt(-910, 339)).toBeLessThan(0);
  });

  it.skipIf(!baked)('has depth and SDF that agree on the shoreline', () => {
    const { terrain } = zone;
    let mismatches = 0;
    let samples = 0;
    for (let z = -1000; z < 2040; z += 37) {
      for (let x = -1530; x < 1530; x += 37) {
        const d = terrain.shoreDistanceAt(x, z);
        if (Math.abs(d) < 12) continue; // the two grids round the shore differently
        samples++;
        if (d > 0 !== terrain.heightAt(x, z) <= 0.5) mismatches++;
      }
    }
    expect(mismatches / samples).toBeLessThan(0.002);
  });

  it.skipIf(!baked)('points the shore normal out to sea', () => {
    const { terrain } = zone;
    const n = terrain.shoreNormalAt(-874, 339, { x: 0, z: 0 });
    expect(Math.hypot(n.x, n.z)).toBeCloseTo(1);
    // Bayfield's shore faces east-south-east.
    expect(n.x).toBeGreaterThan(0.8);
    expect(terrain.shoreDistanceAt(-874 + n.x * 20, 339 + n.z * 20)).toBeGreaterThan(
      terrain.shoreDistanceAt(-874, 339) + 15,
    );
  });

  it.skipIf(!baked)('builds the Bayfield dock from shore out to deep water', () => {
    const { terrain } = zone;
    const dock = TEST_BAY.docks[0];
    if (!dock) throw new Error('no dock');
    // The root is ashore, the head is well out.
    expect(terrain.shoreDistanceAt(dock.root.x, dock.root.z)).toBeLessThan(0);
    const head = dockPoint(dock, dock.lengthM, 0);
    expect(terrain.depthAt(head.x, head.z)).toBeGreaterThan(15);
    expect(terrain.heightAt(dock.root.x, dock.root.z)).toBeLessThan(dock.deckM + 2);

    for (const berth of dockBerths(dock)) {
      // Every point of the berth zone has water for a laden T1 (draft ≤ 3 m) and margin.
      for (let a = -berth.lengthM / 2; a <= berth.lengthM / 2; a += 4) {
        const x = berth.pose.x + Math.sin(berth.pose.heading) * a;
        const z = berth.pose.z - Math.cos(berth.pose.heading) * a;
        expect(terrain.depthAt(x, z)).toBeGreaterThan(5);
      }
      expect(berth.pose.heading).toBe(dock.bearing);
    }
  });

  it.skipIf(!baked)('shelters the lee of Madeline and Basswood', () => {
    const { terrain } = zone;
    const nw = 315 * DEG;
    const se = 135 * DEG;
    // The North Channel off Bayfield's shore: in the lee of the bluffs in a west wind.
    expect(terrain.shelterAt(-830, 340, 270 * DEG)).toBeGreaterThan(0.3);
    // Off Madeline's south-east shore, a north-west wind leaves a lee…
    const lee = { x: 500, z: 700 };
    expect(terrain.shelterAt(lee.x, lee.z, nw)).toBeGreaterThan(
      terrain.shelterAt(lee.x, lee.z, se),
    );
    // …and short fetch, while a south-east wind comes off Chequamegon Bay.
    expect(terrain.fetchAt(lee.x, lee.z, nw)).toBeLessThan(terrain.fetchAt(lee.x, lee.z, se));
    for (const from of [0, nw, se]) {
      const s = terrain.shelterAt(lee.x, lee.z, from);
      expect(s).toBeGreaterThanOrEqual(0);
      expect(s).toBeLessThanOrEqual(1);
      const f = terrain.funnelAt(lee.x, lee.z, from);
      expect(f).toBeGreaterThanOrEqual(0);
      expect(f).toBeLessThanOrEqual(1);
    }
  });

  it.skipIf(!baked)('funnels a north-east wind through the North Channel', () => {
    const { terrain } = zone;
    // The channel runs NE–SW between the Bayfield shore and Madeline.
    const ne = 45 * DEG;
    const channel = { x: -600, z: 300 };
    expect(terrain.funnelAt(channel.x, channel.z, ne)).toBeGreaterThan(
      terrain.funnelAt(channel.x, channel.z, ne + 90 * DEG),
    );
  });
});
