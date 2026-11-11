import islandsJson from '../../../data/islands.json';
import poisJson from '../../../data/pois.json';
import { islandsFileSchema, type IslandCache, type IslandDef } from '../../../data/schemas/islands';
import { poisFileSchema, type PoiDef, type PoiPieceKind } from '../../../data/schemas/pois';
import { Rng } from '../../core/rng';
import type { Clearing } from '../terrain/vegetation';

/**
 * Islands on foot (plan 11 §3, §16; plan 08 §20.4 piece H): each walkable island's points
 * of interest set down on the drawn ground, and its seeded caches. Pure: the renderer
 * draws the pieces, the ashore scene makes them solid, and both get the same numbers.
 *
 * Positions in `islands.json` are meters on the island's 1 m tiles (east and south of the
 * baked footprint's corner, from the zone manifest); everything here is zone meters.
 */

export const ISLANDS: readonly IslandDef[] = islandsFileSchema.parse(islandsJson);
export const POIS: readonly PoiDef[] = poisFileSchema.parse(poisJson);

export function poiDef(id: string): PoiDef | undefined {
  return POIS.find((p) => p.id === id);
}

/** The islands of a zone that have something to walk to. */
export function walkableIslands(zoneId: string): IslandDef[] {
  return ISLANDS.filter((i) => i.zone === zoneId && i.onFoot);
}

/** One piece of a placed prefab: a yawed box (or a post, for a derrick or a cairn). */
export interface PlacedPoiPiece {
  kind: PoiPieceKind;
  /** The prefab it's part of, e.g. `stockton_quarry`. */
  poi: string;
  x: number;
  z: number;
  /** Bearing of its depth axis, radians clockwise from north. */
  bearing: number;
  widthM: number;
  depthM: number;
  /** Its foot and its top, m above the lake. */
  minY: number;
  maxY: number;
}

/** A ladder down a wharf's face into the water, in the ashore scene's shape. */
export interface PlacedPoiLadder {
  x: number;
  z: number;
  /** The way you face on it (toward the wharf), radians clockwise from north. */
  facing: number;
  bottomY: number;
  topY: number;
  topX: number;
  topZ: number;
}

export interface PlacedCacheSpot {
  name: string;
  x: number;
  y: number;
  z: number;
}

export interface PlacedCache {
  def: IslandCache;
  spots: PlacedCacheSpot[];
}

export interface PlacedIsland {
  id: string;
  name: string;
  pieces: PlacedPoiPiece[];
  ladders: PlacedPoiLadder[];
  caches: PlacedCache[];
  /** Kept clear of trees and shore rocks: the prefabs' grounds and the cache cairns. */
  clearings: Clearing[];
}

/** The corner of an island's 1 m tiles, zone meters (manifest `islands[]`). */
export interface IslandOrigin {
  x0: number;
  z0: number;
}

/** How far down a wharf ladder reaches below the lake. */
const LADDER_DEPTH_M = 1.2;
/** A cache cairn: low enough to step around, wide enough to see. */
const CAIRN = { widthM: 1.4, heightM: 0.8 };

/** Unit vectors of a facing: forward (out) and right, zone x/z. */
function axes(bearing: number): { fx: number; fz: number; rx: number; rz: number } {
  const fx = Math.sin(bearing);
  const fz = -Math.cos(bearing);
  return { fx, fz, rx: -fz, rz: fx };
}

/** Is (x, z) inside a yawed rectangle? */
function insideBox(p: PlacedPoiPiece, x: number, z: number, pad = 0): boolean {
  const { fx, fz, rx, rz } = axes(p.bearing);
  const dx = x - p.x;
  const dz = z - p.z;
  return (
    Math.abs(dx * rx + dz * rz) <= p.widthM / 2 + pad &&
    Math.abs(dx * fx + dz * fz) <= p.depthM / 2 + pad
  );
}

/** Lowest and highest ground under a yawed rectangle, sampled every meter. */
function groundRange(
  heightAt: (x: number, z: number) => number,
  x: number,
  z: number,
  bearing: number,
  widthM: number,
  depthM: number,
): { lo: number; hi: number } {
  const { fx, fz, rx, rz } = axes(bearing);
  let lo = Number.POSITIVE_INFINITY;
  let hi = Number.NEGATIVE_INFINITY;
  const nw = Math.max(1, Math.ceil(widthM));
  const nd = Math.max(1, Math.ceil(depthM));
  for (let a = 0; a <= nw; a++) {
    for (let b = 0; b <= nd; b++) {
      const r = (a / nw - 0.5) * widthM;
      const o = (b / nd - 0.5) * depthM;
      const h = heightAt(x + rx * r + fx * o, z + rz * r + fz * o);
      lo = Math.min(lo, h);
      hi = Math.max(hi, h);
    }
  }
  return { lo, hi };
}

/** The floor at (x, z): the ground drawn, or the top of a ledge over it. */
function floorAt(
  pieces: readonly PlacedPoiPiece[],
  heightAt: (x: number, z: number) => number,
  x: number,
  z: number,
): number {
  let y = heightAt(x, z);
  for (const p of pieces) {
    if (p.kind === 'ledge' && insideBox(p, x, z)) y = Math.max(y, p.maxY);
  }
  return y;
}

/**
 * An island's prefabs and caches set down on the ground drawn (`heightAt`, the zone's
 * sailing terrain): ledges first, so blocks, the derrick and the shack stand on them.
 */
export function placeIsland(
  def: IslandDef,
  origin: IslandOrigin,
  heightAt: (x: number, z: number) => number,
): PlacedIsland {
  const pieces: PlacedPoiPiece[] = [];
  const ladders: PlacedPoiLadder[] = [];
  const clearings: Clearing[] = [];
  const onFoot = def.onFoot ?? { pois: [], caches: [] };
  for (const at of onFoot.pois) {
    const poi = poiDef(at.poi);
    if (!poi) throw new Error(`islands: ${def.id} places unknown ${at.poi}`);
    const bearing = (at.facingDeg * Math.PI) / 180;
    const { fx, fz, rx, rz } = axes(bearing);
    const ox = origin.x0 + at.x;
    const oz = origin.z0 + at.z;
    const baseY = heightAt(ox, oz);
    const point = (right: number, out: number): { x: number; z: number } => ({
      x: ox + rx * right + fx * out,
      z: oz + rz * right + fz * out,
    });
    const ordered = [...poi.pieces].sort(
      (a, b) => Number(b.kind === 'ledge') - Number(a.kind === 'ledge'),
    );
    for (const piece of ordered) {
      const c = point(piece.right, piece.out);
      const pb = bearing + (piece.yawDeg * Math.PI) / 180;
      if (piece.kind === 'ledge') {
        const g = groundRange(heightAt, c.x, c.z, pb, piece.widthM, piece.depthM);
        const top =
          piece.clearM === undefined
            ? baseY + piece.heightM
            : Math.max(baseY + piece.heightM, g.hi + piece.clearM);
        const ledge: PlacedPoiPiece = {
          kind: 'ledge',
          poi: at.id,
          x: c.x,
          z: c.z,
          bearing: pb,
          widthM: piece.widthM,
          depthM: piece.depthM,
          minY: Math.min(g.lo, top) - 1,
          maxY: top,
        };
        pieces.push(ledge);
        // A wharf standing in the water gets a ladder down its face.
        if (piece.clearM === undefined) {
          const a = axes(pb);
          const hx = c.x + a.fx * (piece.depthM / 2 + 0.02);
          const hz = c.z + a.fz * (piece.depthM / 2 + 0.02);
          if (heightAt(hx + a.fx, hz + a.fz) < 0) {
            ladders.push({
              x: hx,
              z: hz,
              facing: pb + Math.PI,
              bottomY: -LADDER_DEPTH_M,
              topY: top,
              topX: hx - a.fx * 0.7,
              topZ: hz - a.fz * 0.7,
            });
          }
        }
        continue;
      }
      const foot = floorAt(pieces, heightAt, c.x, c.z) + piece.yM;
      pieces.push({
        kind: piece.kind,
        poi: at.id,
        x: c.x,
        z: c.z,
        bearing: pb,
        widthM: piece.widthM,
        depthM: piece.depthM,
        minY: foot - (piece.yM > 0 ? 0 : 0.3),
        maxY: foot + piece.heightM,
      });
    }
    const [r0, r1] = poi.clear.rightM;
    const [o0, o1] = poi.clear.outM;
    const mid = point((r0 + r1) / 2, (o0 + o1) / 2);
    clearings.push({
      x: mid.x,
      z: mid.z,
      ux: rx,
      uz: rz,
      halfAlong: (r1 - r0) / 2,
      halfAcross: (o1 - o0) / 2,
    });
  }

  const caches: PlacedCache[] = onFoot.caches.map((cache) => ({
    def: cache,
    spots: cache.spots.map((s) => {
      const x = origin.x0 + s.x;
      const z = origin.z0 + s.z;
      const y = floorAt(pieces, heightAt, x, z);
      pieces.push({
        kind: 'cairn',
        poi: cache.id,
        x,
        z,
        bearing: 0,
        widthM: CAIRN.widthM,
        depthM: CAIRN.widthM,
        minY: y - 0.3,
        maxY: y + CAIRN.heightM,
      });
      clearings.push({ x, z, ux: 1, uz: 0, halfAlong: 3, halfAcross: 3 });
      return { name: s.name, x, y, z };
    }),
  }));

  return { id: def.id, name: def.name, pieces, ladders, caches, clearings };
}

/** Every walkable island of a zone placed, given the manifest's tile corners. */
export function placeZoneIslands(
  zoneId: string,
  origins: readonly ({ id: string } & IslandOrigin)[],
  heightAt: (x: number, z: number) => number,
): PlacedIsland[] {
  const out: PlacedIsland[] = [];
  for (const def of walkableIslands(zoneId)) {
    const origin = origins.find((o) => o.id === def.id);
    if (origin) out.push(placeIsland(def, origin, heightAt));
  }
  return out;
}

/**
 * The run's cache (plan 11 §11): which spot holds it and the cash inside, from the run's
 * seed (the weather's noise seed, fixed at the run's start) and the cache's id. The same
 * run always hides it in the same place; another run, likely another.
 */
export function rollCache(cache: IslandCache, runSeed: number): { spot: number; cents: number } {
  const rng = Rng.fromSeed(`${runSeed}:${cache.id}`);
  const spot = Math.floor(rng.next() * cache.spots.length);
  const [lo, hi] = cache.cashCents;
  const cents = Math.round(lo + (hi - lo) * rng.next());
  return { spot: Math.min(spot, cache.spots.length - 1), cents };
}
