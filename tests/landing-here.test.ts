import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { districtBerthPiers, districtForHarbor } from '../src/gameplay/district/district-ashore';
import { findDistrict } from '../src/gameplay/district/ground';
import { attachIslandAshore } from '../src/gameplay/island-ashore';
import type { PlacedIsland } from '../src/sim/islands/on-foot';
import { layoutHarbors } from '../src/sim/harbors';
import { GridField } from '../src/sim/terrain/grid-field';
import { loadZoneTerrain, type LoadedZone } from '../src/sim/terrain/load';
import { manifestFrame } from '../src/sim/terrain/zones';
import { createWorldState } from '../src/sim/world-state';

describe('districtBerthPiers', () => {
  it('lists the Bayfield piers that walk the waterfront district, not the lumber pier', () => {
    const def = findDistrict('bayfield');
    if (!def) throw new Error('no Bayfield district');
    expect(districtForHarbor('harbor.bayfield')).toBe(def);
    const piers = districtBerthPiers(def);
    expect(piers.has('pier.bayfield_fish')).toBe(true);
    expect(piers.has('pier.bayfield_city')).toBe(true);
    expect(piers.has('pier.bayfield_lumber')).toBe(false);
  });
});

describe('harbor piers on the Apostles zone', () => {
  const dir = join(__dirname, '..', 'public', 'world', 'apostles');
  const baked =
    existsSync(join(dir, 'manifest.json')) &&
    readFileSync(join(dir, 'height', '0-0.bin')).byteLength > 200;
  let zone: LoadedZone;
  let def: NonNullable<ReturnType<typeof findDistrict>>;

  beforeAll(async () => {
    if (!baked) return;
    const read = async (path: string) => new Uint8Array(readFileSync(join(dir, path)));
    zone = await loadZoneTerrain(read);
    const mf = manifestFrame(zone.manifest);
    const layouts = layoutHarbors(mf, zone.terrain, zone.manifest.zone);
    const layout = layouts.find((l) => l.def.id === 'harbor.bayfield');
    if (!layout) throw new Error('no Bayfield harbor');
    def = findDistrict('bayfield') as NonNullable<ReturnType<typeof findDistrict>>;
    const piers = districtBerthPiers(def);
    for (const pier of layout.piers) {
      const allowed = piers.has(pier.id);
      if (pier.id.includes('lumber')) expect(allowed, pier.id).toBe(false);
      else if (pier.id.includes('fish') || pier.id.includes('city'))
        expect(allowed, pier.id).toBe(true);
    }
  });

  it.skipIf(!baked)('marks fish and city piers as walkable, lumber as not', () => {
    expect(districtBerthPiers(def).size).toBeGreaterThanOrEqual(2);
  });
});

describe('walkableAt', () => {
  it('is true within the hero island pad and false offshore', () => {
    const x0 = 450;
    const z0 = 700;
    const w = 200;
    const h = 200;
    const field = new GridField(x0, z0, 1, w, h, new Float32Array(w * h).fill(5));
    const placed: PlacedIsland = {
      id: 'island.stockton',
      name: 'Stockton',
      pieces: [],
      ladders: [],
      caches: [],
      clearings: [],
    };
    const state = createWorldState('landing-here');
    const island = attachIslandAshore({
      state,
      heightAt: () => 0,
      islands: () => [placed],
      ground: (id) => (id === 'island.stockton' ? field : undefined),
      harbors: () => [],
      runSeed: () => 0,
      openStash: () => false,
      notice: () => {},
    });
    expect(island.walkableAt({ x: x0 + 50, z: z0 + 50 })).toBe(true);
    expect(island.walkableAt({ x: x0 - 200, z: z0 + 50 })).toBe(false);
    expect(island.walkableAt({ x: -620.4, z: -49.04 })).toBe(false);
  });
});
