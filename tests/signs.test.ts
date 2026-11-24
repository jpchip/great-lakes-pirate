import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import bayfieldJson from '../data/districts/bayfield.json';
import type { DistrictBuilding, DistrictDoor } from '../src/gameplay/district/district';
import { signLabel, signPlacement } from '../src/render/district/signs';

/**
 * Signs on Bayfield's buildings (0.7.2): a named building says its name, the rest say what
 * they are, and each board hangs over a door on the wall it's set in, facing out.
 */

function building(over: Partial<DistrictBuilding> = {}): DistrictBuilding {
  return {
    def: { id: 'b', kind: 'store', name: 'Booth & Sons' } as DistrictBuilding['def'],
    minX: 0,
    maxX: 10,
    minZ: 0,
    maxZ: 6,
    floorY: 0,
    eavesY: 4.2,
    topY: 6,
    doors: [],
    ...over,
  };
}

function door(over: Partial<DistrictDoor> = {}): DistrictDoor {
  return {
    id: 'b.door0',
    piece: 'kit.wall_plank_door',
    building: 'b',
    x: 5,
    z: 0,
    alongX: true,
    widthM: 1.2,
    y: 0,
    opens: undefined,
    ...over,
  } as DistrictDoor;
}

describe('the words on a building (0.7.2)', () => {
  it('a named building says its name; the rest say what they are', () => {
    expect(signLabel({ name: 'Lake Superior Saloon', kind: 'saloon' })).toBe(
      'Lake Superior Saloon',
    );
    expect(signLabel({ kind: 'house' })).toBeUndefined();
    expect(signLabel({ name: "Sailors' boarding house", kind: 'house' })).toBe(
      "Sailors' boarding house",
    );
    expect(signLabel({ kind: 'lockup' })).toBe('Lockup');
    expect(signLabel({ kind: 'no-such-kind' })).toBeUndefined();
  });
});

describe('where a board hangs (0.7.2)', () => {
  it('on a south wall it faces out along -z, over the door', () => {
    const p = signPlacement(building(), door({ z: 0, x: 5, alongX: true }));
    expect(p.x).toBe(5);
    expect(p.z).toBeLessThan(0);
    expect(p.rotY).toBeCloseTo(Math.PI);
  });

  it('on a north wall it faces out along +z', () => {
    const p = signPlacement(building(), door({ z: 6, x: 5, alongX: true }));
    expect(p.z).toBeGreaterThan(6);
    expect(p.rotY).toBeCloseTo(0);
  });

  it('on an east or west wall it faces out along x', () => {
    const east = signPlacement(building(), door({ x: 10, z: 3, alongX: false }));
    const west = signPlacement(building(), door({ x: 0, z: 3, alongX: false }));
    expect(east.x).toBeGreaterThan(10);
    expect(east.rotY).toBeCloseTo(Math.PI / 2);
    expect(west.x).toBeLessThan(0);
    expect(west.rotY).toBeCloseTo(-Math.PI / 2);
  });

  it('stands clear of the wall face and its battens, not inside the wall', () => {
    const south = signPlacement(building(), door({ z: 0, x: 5, alongX: true }));
    const west = signPlacement(building(), door({ x: 0, z: 3, alongX: false }));
    // The wall is 0.2 m thick on its line; battens and trim stand a little proud of it.
    expect(south.z).toBeLessThan(-0.13);
    expect(west.x).toBeLessThan(-0.13);
  });

  it('on a false front, paints the dark board that is already there', () => {
    const b = building({
      def: { id: 'b', kind: 'saloon', roof: 'falseFront' } as DistrictBuilding['def'],
      eavesY: 6,
    });
    const p = signPlacement(b, door({ z: 0, x: 3, alongX: true }));
    expect(p.x).toBe(5);
    expect(p.z).toBeLessThan(-0.26);
    expect(p.y).toBeCloseTo(4.9);
    expect(p.y + p.heightM).toBeLessThanOrEqual(6 - 0.3);
    expect(p.rotY).toBeCloseTo(Math.PI);
  });

  it('stays under the eaves and is no wider than the wall', () => {
    const p = signPlacement(building({ eavesY: 2.6 }), door({ y: 0 }));
    expect(p.y + p.heightM).toBeLessThanOrEqual(2.6);
    expect(p.widthM).toBeLessThanOrEqual(10 - 0.6);
  });
});

const dir = join(import.meta.dirname, '..', 'public', 'districts', 'bayfield');
const baked =
  existsSync(join(dir, 'ground.bin')) && readFileSync(join(dir, 'ground.bin')).byteLength > 200;

describe.skipIf(!baked)('the signs on the Bayfield district', () => {
  it('names every named building, and boards only doors that have a label', async () => {
    // No DOM in the node test environment: a blank canvas stands in for the painted board.
    const ctx = {
      fillRect() {},
      strokeRect() {},
      fillText() {},
      measureText: () => ({ width: 10 }),
    };
    (globalThis as { document?: unknown }).document = {
      createElement: () => ({ width: 0, height: 0, getContext: () => ctx }),
    };
    const { buildDistrict } = await import('../src/gameplay/district/district');
    const { decodeGround } = await import('../src/gameplay/district/ground');
    const { parseLayout } = await import('../src/sim/district/layout');
    const { buildingSigns } = await import('../src/render/district/signs');
    const model = buildDistrict(
      parseLayout(structuredClone(bayfieldJson)),
      decodeGround(new Uint8Array(readFileSync(join(dir, 'ground.bin')))),
    );
    const signs = buildingSigns(model);
    const withSign = model.buildings.filter(
      (b) => signLabel(b.def) && model.doors.some((d) => d.building === b.def.id),
    );
    expect(signs.meshes.length).toBe(withSign.length);
    for (const name of [
      'Lake Superior Saloon',
      'Halvorsen Chandlery',
      'Booth & Sons General Store',
    ]) {
      expect(model.buildings.some((b) => b.def.name === name)).toBe(true);
    }
    signs.dispose();
    delete (globalThis as { document?: unknown }).document;
  });
});
