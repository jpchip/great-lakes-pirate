import harborsJson from '../../data/harbors.json';
import {
  harborsFileSchema,
  type BuildingKind,
  type HarborDef,
  type PierDef,
} from '../../data/schemas/harbors';
import type { Zone, ZoneFrame } from '../core/coords';
import { hash01, type Clearing } from './terrain/vegetation';
import type { Dock } from './terrain/test-bay';
import { setPieceFootprint, zoneDef, type SetPieceFootprint } from './terrain/zones';

/**
 * The harbor set pieces laid out on the zone (plan 03 §3.4; Phase 2 piece G): Bayfield's
 * fish docks, packing house, cooperage and mill, and Ashland's ore dock, each at 1:1 on its
 * set piece's footprint. Pure and deterministic: the renderer draws what this places, and
 * the sailing hazards and auto-dock use its piers as `Dock`s, so the berths you dock at are
 * the piers you see.
 *
 * Zone meters, x east, z south; bearings are radians clockwise from north.
 */

/** Validated harbors from data/harbors.json. */
export const HARBORS: readonly HarborDef[] = harborsFileSchema.parse(harborsJson);

/** What layout reads of the terrain: a ZoneTerrain does. */
export interface HarborTerrain {
  heightAt(x: number, z: number): number;
}

/** A pier on the zone: a Dock (for collisions and berths) and what kind to draw. */
export interface PlacedPier extends Dock {
  kind: PierDef['kind'];
  /** Where the deck meets the land: the shore end, meters from `root` along the pier. */
  shoreM: number;
}

export interface PlacedBuilding {
  kind: BuildingKind;
  name: string | undefined;
  x: number;
  z: number;
  /** Radians clockwise from north that the building's front (its -z side) faces. */
  facing: number;
  widthM: number;
  depthM: number;
  heightM: number;
  /** The floor: the highest ground under the corners, so nothing is buried. */
  floorM: number;
  /** The lowest ground under the corners: the foundation reaches down to it. */
  footM: number;
  /** A per-building number 0–1 for paint and which windows are lit. */
  seed: number;
}

export interface HarborLayout {
  def: HarborDef;
  footprint: SetPieceFootprint;
  piers: PlacedPier[];
  buildings: PlacedBuilding[];
}

/** A point in a footprint's frame: `along` the shore (right, facing the sea) and `inland`. */
export function footprintPoint(fp: SetPieceFootprint, along: number, inland: number): Zone {
  const sx = Math.sin(fp.bearing);
  const sz = -Math.cos(fp.bearing);
  return {
    x: fp.anchor.x - sx * inland - sz * along,
    z: fp.anchor.z - sz * inland + sx * along,
  };
}

/** Deck counts as ashore this high above the lake. */
const SHORE_M = 0.3;
/** The deck starts this far back on the land, so it meets the bank. */
const PIER_BITE_M = 6;

function placePier(def: PierDef, fp: SetPieceFootprint, terrain: HarborTerrain): PlacedPier {
  const bearing = def.bearingDeg === undefined ? fp.bearing : (def.bearingDeg * Math.PI) / 180;
  const start = footprintPoint(fp, def.alongM, def.inlandM);
  const fx = Math.sin(bearing);
  const fz = -Math.cos(bearing);
  // Walk out to the waterline.
  let s = 0;
  while (s < 600 && terrain.heightAt(start.x + fx * s, start.z + fz * s) >= SHORE_M) s += 2;
  const back = Math.min(PIER_BITE_M, s);
  return {
    id: def.id,
    name: def.name,
    kind: def.kind,
    root: { x: start.x + fx * (s - back), z: start.z + fz * (s - back) },
    bearing,
    lengthM: def.lengthM + back,
    widthM: def.widthM,
    deckM: def.deckM,
    shoreM: back,
  };
}

function corners(x: number, z: number, facing: number, w: number, d: number): Zone[] {
  const fx = Math.sin(facing);
  const fz = -Math.cos(facing);
  // Right is the facing turned a quarter clockwise.
  const rx = -fz;
  const rz = fx;
  const out: Zone[] = [];
  for (const [a, b] of [
    [-1, -1],
    [1, -1],
    [1, 1],
    [-1, 1],
  ] as const) {
    out.push({
      x: x + (rx * a * w) / 2 + (fx * b * d) / 2,
      z: z + (rz * a * w) / 2 + (fz * b * d) / 2,
    });
  }
  return out;
}

function ground(terrain: HarborTerrain, pts: Zone[]): { min: number; max: number } {
  let min = Infinity;
  let max = -Infinity;
  for (const p of pts) {
    const h = terrain.heightAt(p.x, p.z);
    min = Math.min(min, h);
    max = Math.max(max, h);
  }
  return { min, max };
}

/** House sizes, meters: width, depth, eaves. */
const HOUSE = { w: [6, 9], d: [7, 10], h: [4.5, 6.8] } as const;
/** Gap kept between buildings, and clear of a pier's shore end, meters. */
const SPACING_M = 5;
const PIER_ROOT_CLEAR_M = 14;

/** Lays out one harbor on the terrain. */
export function layoutHarbor(
  def: HarborDef,
  frame: ZoneFrame,
  terrain: HarborTerrain,
  zoneId = 'zone.apostles',
): HarborLayout {
  const pieceDef = zoneDef(zoneId).setPieces.find((p) => p.id === def.setPiece);
  if (!pieceDef) throw new Error(`harbor ${def.id}: no set piece ${def.setPiece}`);
  const fp = setPieceFootprint(pieceDef, frame);
  const piers = def.piers.map((p) => placePier(p, fp, terrain));
  const buildings: PlacedBuilding[] = [];
  const facingSea = fp.bearing;

  const place = (
    kind: BuildingKind,
    name: string | undefined,
    at: Zone,
    facing: number,
    w: number,
    d: number,
    h: number,
    seed: number,
  ): PlacedBuilding => {
    const g = ground(terrain, [...corners(at.x, at.z, facing, w, d), at]);
    return {
      kind,
      name,
      x: at.x,
      z: at.z,
      facing,
      widthM: w,
      depthM: d,
      heightM: h,
      floorM: Math.max(g.max, 0.6),
      footM: Math.min(g.min, g.max),
      seed,
    };
  };

  def.buildings.forEach((b, k) => {
    buildings.push(
      place(
        b.kind,
        b.name,
        footprintPoint(fp, b.alongM, b.inlandM),
        facingSea + (b.yawDeg * Math.PI) / 180,
        b.widthM,
        b.depthM,
        b.heightM,
        hash01(k, def.town.seed, 7),
      ),
    );
  });

  // The town: houses scattered behind the waterfront on fairly level, dry ground.
  const t = def.town;
  const roots = piers.map((p) => p.root);
  const fits = (x: number, z: number, r: number): boolean => {
    for (const b of buildings) {
      const rb = Math.hypot(b.widthM, b.depthM) / 2;
      if (Math.hypot(b.x - x, b.z - z) < r + rb + SPACING_M) return false;
    }
    for (const p of roots) if (Math.hypot(p.x - x, p.z - z) < r + PIER_ROOT_CLEAR_M) return false;
    return true;
  };
  let placed = 0;
  for (let k = 0; k < t.houses * 12 && placed < t.houses; k++) {
    const along = t.alongM[0] + (t.alongM[1] - t.alongM[0]) * hash01(k, t.seed, 1);
    const inland = t.inlandM[0] + (t.inlandM[1] - t.inlandM[0]) * hash01(k, t.seed, 2);
    const w = HOUSE.w[0] + (HOUSE.w[1] - HOUSE.w[0]) * hash01(k, t.seed, 3);
    const d = HOUSE.d[0] + (HOUSE.d[1] - HOUSE.d[0]) * hash01(k, t.seed, 4);
    const h = HOUSE.h[0] + (HOUSE.h[1] - HOUSE.h[0]) * hash01(k, t.seed, 5);
    // Streets run along the shore: houses face the water, a few degrees off true.
    const facing = facingSea + (hash01(k, t.seed, 6) - 0.5) * 0.14;
    const at = footprintPoint(fp, along, inland);
    if (!fits(at.x, at.z, Math.hypot(w, d) / 2)) continue;
    const g = ground(terrain, [...corners(at.x, at.z, facing, w, d), at]);
    if (g.min < 0.8 || g.max > t.maxGroundM || g.max - g.min > 3.5) continue;
    buildings.push(place('house', undefined, at, facing, w, d, h, hash01(k, t.seed, 8)));
    placed++;
  }

  return { def, footprint: fp, piers, buildings };
}

/** Every harbor in the zone. */
export function layoutHarbors(frame: ZoneFrame, terrain: HarborTerrain): HarborLayout[] {
  return HARBORS.map((h) => layoutHarbor(h, frame, terrain));
}

/** Ground kept free of trees: each building with a yard, and each pier's shore end. */
export function harborClearings(layout: HarborLayout): Clearing[] {
  const out: Clearing[] = layout.buildings.map((b) => ({
    x: b.x,
    z: b.z,
    ux: Math.cos(b.facing),
    uz: Math.sin(b.facing),
    halfAlong: b.widthM / 2 + 6,
    halfAcross: b.depthM / 2 + 6,
  }));
  for (const p of layout.piers) {
    out.push({ x: p.root.x, z: p.root.z, ux: 1, uz: 0, halfAlong: 16, halfAcross: 16 });
  }
  return out;
}
