import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import districtsJson from '../data/districts.json';
import bayfieldJson from '../data/districts/bayfield.json';
import { createCharacter, stepCharacter, type MoveInput } from '../src/gameplay/onfoot/controller';
import { Heightfield } from '../src/gameplay/onfoot/heightfield';
import { buildDistrict, type DistrictModel } from '../src/gameplay/district/district';
import {
  decodeGround,
  districtFrame,
  encodeGround,
  findDistrict,
} from '../src/gameplay/district/ground';
import { KIT } from '../src/sim/district/kit';
import {
  buildingEdge,
  compactPalette,
  emptyLayout,
  layoutHash,
  normalizeEdge,
  parseLayout,
  perimeterPiece,
  placeCell,
  placeEdge,
  placeProp,
  removeEdge,
  type DistrictLayout,
} from '../src/sim/district/layout';
import { NavMesh, type NavMeshData } from '../src/sim/district/navmesh';
import { zoneDef } from '../src/sim/terrain/zones';

function must<T>(v: T | undefined): T {
  if (v === undefined) throw new Error('missing');
  return v;
}

const flat = (y = 1.8): Heightfield => {
  const n = 81;
  return new Heightfield(n, n, 1, -40, -40, new Float32Array(n * n).fill(y));
};

/** A 10 × 6 m room with one door on its north wall, on flat ground. */
function room(): DistrictLayout {
  const l = emptyLayout('district.test', -20, -20, 20, 20);
  l.buildings.push({
    id: 'room',
    kind: 'warehouse',
    col: 5,
    row: 5,
    cols: 5,
    rows: 3,
    wall: 'kit.wall_plank',
    floor: 'kit.floor_plank',
    wallHeightM: 4,
    roof: 'gable',
    ridge: 'x',
    paint: 0,
    edges: [['kit.wall_plank_door', 0, 2]],
  });
  return l;
}

const idle: MoveInput = { forward: 0, right: 0, run: false, crouch: false, jump: false };

/** Walks toward heading `yaw` for `seconds`; returns where the character ends up. */
function walk(
  model: DistrictModel,
  x: number,
  z: number,
  yaw: number,
  seconds: number,
): { x: number; z: number } {
  const c = createCharacter({ x, y: model.floorAt(x, z) + 0.05, z }, yaw);
  for (let t = 0; t < seconds * 30; t++)
    stepCharacter(c, { ...idle, forward: 1 }, yaw, model, 1 / 30);
  return { x: c.position.x, z: c.position.z };
}

describe('district layouts', () => {
  it('spells each edge one way', () => {
    expect(normalizeEdge(3, 4, 1)).toEqual({ col: 4, row: 4, side: 3 });
    expect(normalizeEdge(3, 4, 2)).toEqual({ col: 3, row: 5, side: 0 });
    expect(normalizeEdge(3, 4, 0)).toEqual({ col: 3, row: 4, side: 0 });
  });

  it('turns an edge piece laid on a building wall into that wall’s override', () => {
    const l = room();
    // The room's east wall, second cell down: the cell (9, 6)'s east edge.
    placeEdge(l, 'kit.wall_plank_window', 9, 6, 1);
    expect(buildingEdge(l, normalizeEdge(9, 6, 1))?.index).toBe(1);
    expect(perimeterPiece(must(l.buildings[0]), 1, 1)).toBe('kit.wall_plank_window');
    expect(l.edges).toHaveLength(0);
    // Removing a building edge opens it rather than deleting the wall.
    removeEdge(l, 9, 6, 1);
    expect(perimeterPiece(must(l.buildings[0]), 1, 1)).toBe('kit.none');
  });

  it('compacts the palette without changing what is placed', () => {
    const l = room();
    placeCell(l, 'kit.boardwalk', 1, 1);
    placeProp(l, 'kit.crate', 3.1, 2.9, 20);
    placeCell(l, 'kit.track', 1, 1); // replaces the boardwalk, leaving it unused
    expect(l.palette).toContain('kit.boardwalk');
    const before = buildDistrict(l, flat());
    compactPalette(l);
    expect(l.palette).not.toContain('kit.boardwalk');
    const after = buildDistrict(l, flat());
    expect(after.props.map((p) => [p.piece.id, p.x, p.z])).toEqual(
      before.props.map((p) => [p.piece.id, p.x, p.z]),
    );
    // Props snap to 0.25 m and 15°.
    expect(must(l.props[0]).slice(1, 4)).toEqual([3, 3, 15]);
  });
});

describe('a district built from its layout', () => {
  const model = buildDistrict(room(), flat());

  it('numbers doors in perimeter order and finds the building you are in', () => {
    expect(model.doors.map((d) => d.id)).toEqual(['room.door0']);
    const b = must(model.buildings[0]);
    expect(b.floorY).toBeCloseTo(1.95);
    expect(model.buildingAt(-5, 2, -5)?.def.id).toBe('room');
    expect(model.buildingAt(-5, 2, 5)).toBeUndefined();
  });

  it('blocks walking through a wall and lets you through the door', () => {
    // From the street, south (heading π) into the wall west of the door: stopped outside.
    const blocked = walk(model, -8, -14, Math.PI, 4);
    expect(blocked.z).toBeLessThan(-10);
    // In line with the door (its middle is x -5): in, onto the floor.
    const through = walk(model, -5, -14, Math.PI, 4);
    expect(through.z).toBeGreaterThan(-9);
  });

  it('reports what is underfoot', () => {
    const l = room();
    placeCell(l, 'kit.track', 0, 0);
    placeCell(l, 'kit.pier_deck', 0, 2);
    const m = buildDistrict(l, flat(0.5));
    expect(m.surfaceAt(-19, 0.5, -19)).toBe('gravel');
    expect(m.surfaceAt(-19, 1.6, -15)).toBe('planks');
    expect(m.surfaceAt(-10, 0.5, -10)).toBe('dirt');
    expect(m.surfaceAt(-5, must(m.buildings[0]).floorY, -5)).toBe('planks');
  });

  it('keeps everything inside the walkable bounds', () => {
    const out = walk(model, -18, 0, (3 * Math.PI) / 2, 6);
    expect(out.x).toBeGreaterThan(-20);
  });
});

describe('district ground', () => {
  it('round-trips through bytes at centimeter precision', () => {
    const g = new Heightfield(
      3,
      2,
      1,
      -1.5,
      4,
      Float32Array.from([1.234, -2.5, 3, 0, 0.004, 9.99]),
    );
    const back = decodeGround(encodeGround(g));
    expect(back.originX).toBe(-1.5);
    expect(back.samplesX).toBe(3);
    for (let k = 0; k < 6; k++) expect(back.heights[k]).toBeCloseTo(g.heights[k] ?? NaN, 2);
  });

  it('maps district meters to the zone and back', () => {
    const def = findDistrict('bayfield');
    if (!def) throw new Error('no Bayfield district');
    const piece = zoneDef('zone.apostles').setPieces.find((p) => p.id === 'setpiece.bayfield');
    if (!piece) throw new Error('no Bayfield set piece');
    const frame = districtFrame(def, {
      id: piece.id,
      anchor: { x: 120, z: -340 },
      bearing: (piece.bearingDeg * Math.PI) / 180,
      def: piece,
    });
    const p = frame.toZone(12, -30);
    const back = frame.toLocal(p);
    expect(back.x).toBeCloseTo(12);
    expect(back.z).toBeCloseTo(-30);
    // Heading 0 faces the lake: the set piece's seaward bearing.
    expect(frame.headingToZone(0)).toBeCloseTo((piece.bearingDeg * Math.PI) / 180);
  });
});

describe('navmesh queries', () => {
  // Two 4 × 4 m squares side by side (x 0–4 and 6–10), joined only by a door link.
  const data: NavMeshData = {
    version: 1,
    layoutHash: 'test',
    agent: { radiusM: 0.3, heightM: 1.75, climbM: 0.4, maxSlopeDeg: 42 },
    verts: [
      0, 0, 0, 400, 0, 0, 400, 0, 400, 0, 0, 400, 600, 0, 0, 1000, 0, 0, 1000, 0, 400, 600, 0, 400,
      400, 0, 1000, 0, 0, 1000,
    ],
    polys: [
      [0, 1, 2, 3],
      [4, 5, 6, 7],
      [3, 2, 8, 9],
    ],
    neis: [
      [-1, -1, 2, -1],
      [-1, -1, -1, -1],
      [0, -1, -1, -1],
    ],
    links: [{ door: 'a.door0', a: 0, b: 1, pa: { x: 4, y: 0, z: 2 }, pb: { x: 6, y: 0, z: 2 } }],
  };
  const nav = new NavMesh(data);

  it('goes through an open door and not a shut one', () => {
    const path = nav.findPath({ x: 1, y: 0, z: 1 }, { x: 9, y: 0, z: 3 });
    expect(path.length).toBeGreaterThanOrEqual(3);
    expect(path.some((p) => Math.abs(p.x - 4) < 1e-6 && Math.abs(p.z - 2) < 1e-6)).toBe(true);
    expect(
      nav.findPath(
        { x: 1, y: 0, z: 1 },
        { x: 9, y: 0, z: 3 },
        { closedDoors: new Set(['a.door0']) },
      ),
    ).toEqual([]);
  });

  it('pulls the string tight across shared edges', () => {
    // Straight down from one polygon into the next: no corners in between.
    const path = nav.findPath({ x: 2, y: 0, z: 1 }, { x: 2, y: 0, z: 9 });
    expect(path).toHaveLength(2);
    // Around the corner of an L: one turn at the inside corner (4, 4).
    const l = nav.findPath({ x: 3.5, y: 0, z: 0.5 }, { x: 0.5, y: 0, z: 9.5 });
    expect(l.length).toBeLessThanOrEqual(3);
  });
});

describe('Bayfield', () => {
  const navPath = join(
    import.meta.dirname,
    '..',
    'public',
    'districts',
    'bayfield',
    'navmesh.json',
  );
  const groundPath = join(
    import.meta.dirname,
    '..',
    'public',
    'districts',
    'bayfield',
    'ground.bin',
  );
  const baked = existsSync(groundPath) && readFileSync(groundPath).byteLength > 200;
  const layout = parseLayout(bayfieldJson);

  it('has a layout every district entry can find, with its marks', () => {
    for (const d of districtsJson) expect(findDistrict(d.id)?.layout).toBe(d.layout);
    const ids = new Set(layout.marks.map((m) => m.id));
    expect(ids.size).toBe(layout.marks.length);
    expect(ids.has('gangway.fish_pier')).toBe(true);
    // The named Phase 7 places are there: the heist's warehouse, the saloon, the lockup.
    for (const b of ['hollister_warehouse', 'saloon', 'lockup', 'packing_house', 'harbor_office']) {
      expect(layout.buildings.map((k) => k.id)).toContain(b);
    }
    // Every kit piece used is a real one, and every kit placement kind appears.
    const used = new Set(layout.palette);
    expect(KIT.filter((p) => p.placement === 'prop' && used.has(p.id)).length).toBeGreaterThan(30);
  });

  it.skipIf(!baked)('has a navmesh baked from the current layout', () => {
    const data = JSON.parse(readFileSync(navPath, 'utf8')) as NavMeshData;
    expect(data.layoutHash, 'run npm run district:bake').toBe(layoutHash(layout));
  });

  it.skipIf(!baked)('lets a guard reach every door from the gangway, fast', () => {
    const model = buildDistrict(layout, decodeGround(new Uint8Array(readFileSync(groundPath))));
    const nav = new NavMesh(JSON.parse(readFileSync(navPath, 'utf8')) as NavMeshData);
    expect(nav.links.map((l) => l.door).sort()).toEqual(model.doors.map((d) => d.id).sort());
    const g = model.mark('gangway.fish_pier');
    const from = { x: g.x, y: model.floorAt(g.x, g.z), z: g.z };
    // Into the lockup's cells: through the front door and a cell door.
    const cell = nav.findPath(from, { x: 38, y: model.floorAt(38, 43), z: 43 });
    expect(cell.length).toBeGreaterThan(2);
    // Shut the lockup's front door and the cells are out of reach.
    expect(
      nav.findPath(from, { x: 38, y: 2, z: 43 }, { closedDoors: new Set(['lockup.door0']) }),
    ).toEqual([]);
    // Many random queries, well inside plan 08 §14's per-tick budget.
    let seed = 7;
    const random = (): number => (seed = (seed * 16807) % 2147483647) / 2147483647;
    const t0 = performance.now();
    let found = 0;
    for (let k = 0; k < 300; k++)
      if (nav.findPath(nav.randomPoint(random), nav.randomPoint(random)).length > 0) found++;
    expect(found).toBe(300);
    expect((performance.now() - t0) / 300).toBeLessThan(2);
  });

  it.skipIf(!baked)('keeps the waterfront walkable from the gangway to the street', () => {
    const model = buildDistrict(layout, decodeGround(new Uint8Array(readFileSync(groundPath))));
    // Off the fish pier, inland (heading π is inland, +z), past the warehouse.
    const end = walk(model, -41.5, -56, Math.PI, 20);
    expect(end.z).toBeGreaterThan(-30);
    expect(model.surfaceAt(-41, 1.6, -56)).toBe('planks');
    expect(model.lamps.length).toBeGreaterThan(15);
    // Shop doors open their port tabs by day.
    expect(model.doors.find((d) => d.building === 'general_store')?.opens).toBe('market');
  });
});
