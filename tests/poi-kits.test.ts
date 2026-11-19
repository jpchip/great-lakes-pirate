import type * as THREE from 'three';
import { Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import tiersJson from '../data/island_tiers.json';
import { islandTiersFileSchema } from '../data/schemas/island_tiers';
import { poiPieceKindSchema, type PoiDef } from '../data/schemas/pois';
import { pieceColliders } from '../src/gameplay/island-ashore';
import type { Collider } from '../src/gameplay/onfoot/colliders';
import { DRAWN_CURIOS, curiosGeometry } from '../src/render/hideout/curios';
import { pieceGeometry } from '../src/render/onfoot/poi-view';
import { DISPLAY_PIECES, curioDefs, curioSlots } from '../src/sim/discovery/discovery';
import {
  FLAT_KINDS,
  ISLANDS,
  POIS,
  caveOpening,
  pieceToZone,
  placeIsland,
  placePoi,
  poiDef,
  type PlacedPoi,
} from '../src/sim/islands/on-foot';

/**
 * Phase 9 piece P: the POI kits (plan 11 §2.3, §13). Every kind is drawn and made solid,
 * every prefab places on any ground with its marks, and every prefab and every island's
 * layout stays inside `island_tiers.json`'s budgets, so pieces Q and R can't lay out an
 * island over its tier without this failing.
 */

const TIERS = islandTiersFileSchema.parse(tiersJson);

const triangles = (gs: THREE.BufferGeometry[]): number =>
  gs.reduce((n, g) => n + g.getAttribute('position').count / 3, 0);

/** Every prefab set down facing `facingDeg` on `ground`, its origin at (100, 100). */
function place(poi: PoiDef, ground: (x: number, z: number) => number, facingDeg = 0): PlacedPoi {
  return placePoi(poi, { id: 'test', x: 100, z: 100, facingDeg }, { x0: 0, z0: 0 }, ground);
}

const flat = (): number => 1;
/** A shore: land rising to the south of z = 100... */
const shoreFacingNorth = (_x: number, z: number): number => (z - 100) * 0.08 + 0.6;
const hill = (x: number, z: number): number => 20 - Math.hypot(x - 100, z - 100) * 0.15;

function inside(c: Collider, x: number, y: number, z: number): boolean {
  if (y < c.minY || y > c.maxY) return false;
  if (c.kind === 'cylinder') return Math.hypot(x - c.x, z - c.z) <= c.radius;
  const dx = x - c.x;
  const dz = z - c.z;
  const cos = Math.cos(c.yaw);
  const sin = Math.sin(c.yaw);
  const lx = dx * cos - dz * sin;
  const lz = dx * sin + dz * cos;
  return Math.abs(lx) <= c.halfX && Math.abs(lz) <= c.halfZ;
}

describe('the POI kit pieces', () => {
  const placed = POIS.flatMap((p) => place(p, flat).pieces);

  it('every kind is used by a prefab, drawn, and finite', () => {
    for (const kind of poiPieceKindSchema.options) {
      // A cairn is set by the caches too; steps only come out of the quarry's ledges.
      const of = placed.filter((p) => p.kind === kind);
      expect(of.length, kind).toBeGreaterThan(0);
      for (const p of of) {
        const parts = pieceGeometry(p);
        expect(triangles(parts), kind).toBeGreaterThan(0);
        for (const g of parts) {
          const pos = g.getAttribute('position');
          expect(g.getAttribute('color'), kind).toBeDefined();
          for (let i = 0; i < pos.count * 3; i++) {
            expect(Number.isFinite(pos.array[i]), kind).toBe(true);
          }
        }
      }
    }
  });

  it('every kind but the flat ones is solid; fields, planks and dig spots are walked over', () => {
    for (const p of placed) {
      const solids = pieceColliders(p);
      if (FLAT_KINDS.has(p.kind)) expect(solids, p.kind).toHaveLength(0);
      else expect(solids.length, p.kind).toBeGreaterThan(0);
    }
  });
});

describe('the prefabs', () => {
  it('include the fish camp, farmstead, trapper cabin, viewpoint, wreck, cairn, dig spot and cave mouth', () => {
    for (const id of [
      'poi.fish_camp',
      'poi.farmstead',
      'poi.trapper_cabin',
      'poi.viewpoint',
      'poi.beach_wreck',
      'poi.cairn',
      'poi.dig_spot',
      'poi.cave_mouth',
    ]) {
      expect(poiDef(id), id).toBeDefined();
    }
  });

  it('each stays within the prefab budget and has unique mark ids', () => {
    for (const poi of POIS) {
      const tris = triangles(place(poi, flat).pieces.flatMap(pieceGeometry));
      expect(tris, poi.id).toBeLessThanOrEqual(TIERS.prefabTriangles);
      const ids = poi.marks.map((m) => m.id);
      expect(new Set(ids).size, poi.id).toBe(ids.length);
    }
  });

  it('places on a shore and a hill without anything below the ground it stands on', () => {
    for (const ground of [shoreFacingNorth, hill]) {
      for (const poi of POIS) {
        for (const p of place(poi, ground, 37).pieces) {
          expect(Number.isFinite(p.minY) && Number.isFinite(p.maxY), poi.id).toBe(true);
          expect(p.maxY, `${poi.id} ${p.kind}`).toBeGreaterThan(ground(p.x, p.z) - 1e-6);
        }
      }
    }
  });

  it("the fish camp's dock stands over the water with a ladder at its end", () => {
    const camp = poiDef('poi.fish_camp');
    if (!camp) throw new Error('no fish camp');
    const at = place(camp, shoreFacingNorth);
    const dock = at.pieces.find((p) => p.kind === 'dock');
    expect(dock?.maxY).toBeCloseTo(shoreFacingNorth(100, 100) + 1, 5);
    expect(at.ladders).toHaveLength(1);
    // The fish house stands on the shore, not on the dock.
    const house = at.pieces.find((p) => p.kind === 'fish_house');
    expect(house?.minY).toBeCloseTo(shoreFacingNorth(house?.x ?? 0, house?.z ?? 0) - 0.3, 5);
    // Its landing mark is the dock's end, on the deck.
    const landing = at.marks.find((m) => m.kind === 'landing');
    expect(landing?.y).toBeCloseTo(dock?.maxY ?? 0, 5);
  });

  it('marks turn and move with the prefab', () => {
    const view = poiDef('poi.viewpoint');
    if (!view) throw new Error('no viewpoint');
    const north = place(view, flat, 0).marks.find((m) => m.kind === 'view');
    const east = place(view, flat, 90).marks.find((m) => m.kind === 'view');
    // 3.5 m out: north is -z, east is +x.
    expect(north?.z).toBeCloseTo(100 - 3.5, 5);
    expect(east?.x).toBeCloseTo(100 + 3.5, 5);
    expect(east?.facing).toBeCloseTo(Math.PI / 2, 5);
  });

  it("a field lies on the slope it's on, and stumps stand on the ground", () => {
    const farm = poiDef('poi.farmstead');
    if (!farm) throw new Error('no farmstead');
    const at = place(farm, hill, 20);
    for (const f of at.pieces.filter((p) => p.kind === 'field')) {
      expect(f.drape?.heights.length).toBe((f.drape?.nx ?? 0) * (f.drape?.nz ?? 0));
      const hs = f.drape?.heights ?? [];
      expect(Math.max(...hs) - Math.min(...hs)).toBeGreaterThan(0.5);
    }
    const stumps = at.pieces.find((p) => p.kind === 'stumps');
    for (const s of stumps?.posts ?? []) expect(s.y).toBeCloseTo(hill(s.x, s.z), 5);
  });

  it("a cave mouth's opening is open to its back wall, and its jambs are solid", () => {
    const cave = poiDef('poi.cave_mouth');
    if (!cave) throw new Error('no cave mouth');
    const at = place(cave, flat, 120);
    const mouth = at.pieces.find((p) => p.kind === 'cave_mouth');
    if (!mouth) throw new Error('no mouth');
    const solids = pieceColliders(mouth);
    const y = 2;
    const o = caveOpening(mouth);
    const free = (right: number, out: number): boolean => {
      const p = pieceToZone(mouth, right, out);
      return !solids.some((c) => inside(c, p.x, y, p.z));
    };
    expect(free(0, mouth.depthM / 2 - 0.2)).toBe(true);
    expect(free(0, 0)).toBe(true);
    expect(free(0, -mouth.depthM / 2 + 0.3)).toBe(false);
    expect(free(o.w / 2 + 1, 0)).toBe(false);
    expect(free(-(o.w / 2 + 1), 0)).toBe(false);
    expect(at.marks.find((m) => m.kind === 'cave')).toBeDefined();
  });
});

describe('islands against their tier (island_tiers.json)', () => {
  it('every walkable island with a tier places at most its POIs, within its triangles', () => {
    for (const def of ISLANDS) {
      if (!def.tier || !def.onFoot) continue;
      const budget = TIERS.tiers[def.tier];
      expect(def.onFoot.pois.length, def.id).toBeLessThanOrEqual(budget.maxPois);
      const island = placeIsland(def, { x0: 0, z0: 0 }, flat);
      const tris = triangles(island.pieces.flatMap(pieceGeometry));
      expect(tris, def.id).toBeLessThanOrEqual(budget.poiTriangles);
    }
  });

  it("each tier's showcase set fits: hero a full set, standard three, minor one", () => {
    const sets: Record<'hero' | 'standard' | 'minor', string[]> = {
      hero: [
        'poi.quarry',
        'poi.fish_camp',
        'poi.farmstead',
        'poi.trapper_cabin',
        'poi.viewpoint',
        'poi.beach_wreck',
        'poi.cave_mouth',
        'poi.cairn',
        'poi.dig_spot',
      ],
      standard: ['poi.fish_camp', 'poi.viewpoint', 'poi.beach_wreck'],
      minor: ['poi.cairn'],
    };
    for (const [tier, ids] of Object.entries(sets) as [keyof typeof sets, string[]][]) {
      const budget = TIERS.tiers[tier];
      expect(ids.length).toBeLessThanOrEqual(budget.maxPois);
      const tris = ids.reduce((n, id) => {
        const poi = poiDef(id);
        return poi ? n + triangles(place(poi, flat).pieces.flatMap(pieceGeometry)) : n;
      }, 0);
      expect(tris, tier).toBeLessThanOrEqual(budget.poiTriangles);
    }
  });
});

describe('curios on the shelves (piece O, drawn in piece P)', () => {
  const piece = (id: string, x: number, rot: number, built = true) => ({
    id,
    built,
    x,
    y: 0,
    z: 0,
    rot,
  });

  it('a shelf, a table and a chest offer four places; ghosts and other pieces none', () => {
    const slots = curioSlots([
      piece('build.shelving', 0, 0),
      piece('build.table', 4, 1),
      piece('build.chest', 8, 2),
      piece('build.chest', 12, 0, false),
      piece('build.wall', 16, 0),
    ]);
    const room =
      (DISPLAY_PIECES['build.shelving'] ?? 0) +
      (DISPLAY_PIECES['build.table'] ?? 0) +
      (DISPLAY_PIECES['build.chest'] ?? 0);
    expect(slots).toHaveLength(room);
    // On the shelving's top shelf, and turned with a table turned a quarter.
    expect(slots[0]?.y).toBeCloseTo(1.94, 5);
    expect(slots[1]?.yaw).toBeCloseTo(-Math.PI / 2, 5);
    for (const s of slots.slice(1, 3)) expect(Math.hypot(s.x - 4, s.z)).toBeLessThan(0.8);
  });

  it('every curio in the catalog is drawn, small', () => {
    for (const c of curioDefs()) {
      expect(DRAWN_CURIOS, c.id).toContain(c.id);
      const g = curiosGeometry([{ id: c.id, slot: { x: 0, y: 0, z: 0, yaw: 0 } }]);
      g?.computeBoundingBox();
      const size = g?.boundingBox?.getSize(new Vector3());
      expect(size && Math.max(size.x, size.y, size.z), c.id).toBeLessThan(0.7);
    }
  });
});
