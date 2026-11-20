import islandsJson from '../../../data/islands.json';
import poisJson from '../../../data/pois.json';
import {
  islandsFileSchema,
  type IslandCache,
  type IslandDef,
  type IslandPoi,
} from '../../../data/schemas/islands';
import { chartToZone, ChartProjection, type ZoneFrame } from '../../core/coords';
import {
  poisFileSchema,
  type PoiDef,
  type PoiMarkKind,
  type PoiPieceKind,
} from '../../../data/schemas/pois';
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
  /**
   * Phase 9 piece P: the ground under a `field`, sampled on a grid across (`nx`) and along
   * (`nz`) it, row by row from its back-left corner, so it's drawn lying on the ground.
   */
  drape?: { nx: number; nz: number; heights: number[] };
  /** Phase 9 piece P: each of a `stumps` piece's stumps, standing on the ground there. */
  posts?: { x: number; z: number; y: number; r: number }[];
  /** Phase 9 piece P: which look of its kind (`pois.json` `variant`); absent is 0. */
  variant?: number;
  /** Phase 9 piece Q: someone lives here, so its windows are lit through the evening. */
  lit?: boolean;
}

/**
 * A named point of a placed prefab (Phase 9 piece P), zone meters: where a resident
 * stands, a fire warms, a cache is dug for, a cave is entered. Pieces Q–V read these.
 */
export interface PlacedPoiMark {
  /** The placed prefab's id (`stockton_quarry`), and the mark's own id in it. */
  poi: string;
  id: string;
  kind: PoiMarkKind;
  x: number;
  y: number;
  z: number;
  /** Radians clockwise from north. */
  facing: number;
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

/** A beach or dock a boat comes in at (Phase 9 piece Q), zone meters. */
export interface PlacedLanding {
  name: string;
  x: number;
  y: number;
  z: number;
}

export type ResidentKind = 'fisherman' | 'farmer' | 'villager';
/** A resident's NPC type in `npc_types.json`. */
export type ResidentType = `npc.${ResidentKind}`;

/** Someone who lives on the island (Phase 9 piece Q), set down in zone meters. */
export interface PlacedResident {
  id: string;
  name: string;
  kind: ResidentKind;
  type: ResidentType;
  /** The placed prefab they live at, if any. */
  home?: string;
  /** Their round by day, in order: the home's `resident` marks, then their own stops. */
  route: { x: number; z: number; waitS: number; face?: number }[];
  /** Their yard: the home prefab's clear ground, where a known face isn't welcome. */
  grounds?: { x: number; z: number; radiusM: number };
  talk: readonly string[];
}

/**
 * Where an island's own land lies (Phase 9 piece Q), for telling which island a landing is
 * on where the baked boxes overlap (Basswood's lies inside Madeline's): each cell's distance
 * to the island's land in cells, 0 on it, up to its reach and 255 past it.
 */
export interface IslandLand {
  x0: number;
  z0: number;
  cellM: number;
  cols: number;
  rows: number;
  dist: Uint8Array;
}

export interface PlacedIsland {
  id: string;
  name: string;
  /** Plan 11 §2's tier. */
  tier?: 'hero' | 'standard' | 'minor';
  /** A walkable pad on the mainland (the Siskiwit logging camp), not an island. */
  mainland?: boolean;
  pieces: PlacedPoiPiece[];
  ladders: PlacedPoiLadder[];
  caches: PlacedCache[];
  /** Kept clear of trees and shore rocks: the prefabs' grounds and the cache cairns. */
  clearings: Clearing[];
  /** Every prefab's named points (Phase 9 piece P). */
  marks: PlacedPoiMark[];
  /** Beaches and docks to come in at (Phase 9 piece Q). */
  landings: PlacedLanding[];
  /** Who lives there (Phase 9 piece Q). */
  residents: PlacedResident[];
  /** How fast the residents' word reaches the law, where no keeper carries it. */
  reporting: 'fast' | 'medium' | 'slow';
  /** The harbor village standing on it, with its trading post (La Pointe). */
  village?: { harbor: string; port: string; tradingPost: string };
  /** The island's own land, when its baked box and the zone's frame were given. */
  land?: IslandLand;
  /**
   * Its `islands.json` point in zone meters, where the frame was given (piece R): where
   * `findLanding` looks out from for a shore to come in at.
   */
  anchor?: { x: number; z: number };
}

/** One prefab set down (Phase 9 piece P's `placePoi`). */
export interface PlacedPoi {
  pieces: PlacedPoiPiece[];
  ladders: PlacedPoiLadder[];
  clearing: Clearing;
  marks: PlacedPoiMark[];
}

/** The corner of an island's 1 m tiles, zone meters (manifest `islands[]`). */
export interface IslandOrigin {
  x0: number;
  z0: number;
  /** The tiles' extent (manifest `width`/`height`), for finding the island's own land. */
  width?: number;
  height?: number;
}

/** Buildings someone lives in: their windows light up through the evening (piece Q). */
const LIVED_IN: ReadonlySet<PoiPieceKind> = new Set<PoiPieceKind>([
  'shanty',
  'cabin',
  'fish_house',
]);
/** Seconds a resident stands at a mark of his home, and at a stop of his own. */
const RESIDENT_WAIT_S = { mark: 14, round: 8 };

/** How far down a wharf ladder reaches below the lake. */
const LADDER_DEPTH_M = 1.2;
/** A cache cairn: low enough to step around, wide enough to see. */
const CAIRN = { widthM: 1.4, heightM: 0.8 };
/** No `steps` tread rises more than this: well under the controller's step height. */
const STEP_RISE_M = 0.3;

/**
 * Pieces you stand on, placed before the rest so those stand on them: the quarry's cut
 * ledges and spoil wharf, and (piece P) the fish camp's dock.
 */
const PLATFORMS: ReadonlySet<PoiPieceKind> = new Set<PoiPieceKind>(['ledge', 'dock']);
/** Pieces drawn lying on the ground and walked over: no solid, no floor of their own. */
export const FLAT_KINDS: ReadonlySet<PoiPieceKind> = new Set<PoiPieceKind>([
  'field',
  'planks',
  'dig',
]);

/** A small deterministic hash in [0, 1), for scattering stumps the same way every time. */
function hash01(n: number): number {
  const s = Math.sin(n * 12.9898 + 78.233) * 43758.5453;
  return s - Math.floor(s);
}

/** Unit vectors of a facing: forward (out) and right, zone x/z. */
export function axes(bearing: number): { fx: number; fz: number; rx: number; rz: number } {
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
    if (PLATFORMS.has(p.kind) && insideBox(p, x, z)) y = Math.max(y, p.maxY);
  }
  return y;
}

/**
 * One prefab set down on the ground drawn (Phase 9 piece P, from Phase 7's quarry): the
 * one way a point of interest is put anywhere. `at` is where its origin goes, in the
 * island's 1 m tile meters (`origin` is their corner in zone meters, as the manifest has
 * it), with the bearing it faces; `heightAt` is the zone's drawn ground. Platforms (ledges,
 * a dock) go first, so blocks, the derrick and the sheds stand on them. `placed` is what's
 * already down on this island, so one prefab can stand on another's ledge.
 */
export function placePoi(
  poi: PoiDef,
  at: Pick<IslandPoi, 'id' | 'x' | 'z' | 'facingDeg'>,
  origin: IslandOrigin,
  heightAt: (x: number, z: number) => number,
  placed: readonly PlacedPoiPiece[] = [],
): PlacedPoi {
  const pieces: PlacedPoiPiece[] = [];
  const ladders: PlacedPoiLadder[] = [];
  const marks: PlacedPoiMark[] = [];
  const bearing = (at.facingDeg * Math.PI) / 180;
  const { fx, fz, rx, rz } = axes(bearing);
  const ox = origin.x0 + at.x;
  const oz = origin.z0 + at.z;
  const baseY = heightAt(ox, oz);
  const point = (right: number, out: number): { x: number; z: number } => ({
    x: ox + rx * right + fx * out,
    z: oz + rz * right + fz * out,
  });
  const floor = (x: number, z: number): number =>
    floorAt(placed.length ? [...placed, ...pieces] : pieces, heightAt, x, z);
  const ordered = [...poi.pieces].sort(
    (a, b) => Number(PLATFORMS.has(b.kind)) - Number(PLATFORMS.has(a.kind)),
  );
  for (const piece of ordered) {
    const c = point(piece.right, piece.out);
    const pb = bearing + (piece.yawDeg * Math.PI) / 180;
    if (PLATFORMS.has(piece.kind)) {
      const g = groundRange(heightAt, c.x, c.z, pb, piece.widthM, piece.depthM);
      const top =
        piece.clearM === undefined
          ? baseY + piece.heightM
          : Math.max(baseY + piece.heightM, g.hi + piece.clearM);
      pieces.push({
        kind: piece.kind,
        poi: at.id,
        x: c.x,
        z: c.z,
        bearing: pb,
        widthM: piece.widthM,
        depthM: piece.depthM,
        minY: Math.min(g.lo, top) - 1,
        maxY: top,
      });
      // A wharf or a dock standing in the water gets a ladder down its far end.
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
    if (piece.kind === 'steps') {
      // A flight from the ground at its foot to wherever `depthM` ahead lands: the top
      // of the ledge standing there, once ledges are placed (they go first, above), or
      // just the rise of the ground itself if there's no ledge to climb onto.
      const a = axes(pb);
      const foot = floor(c.x, c.z);
      const topX = c.x + a.fx * piece.depthM;
      const topZ = c.z + a.fz * piece.depthM;
      const top = floor(topX, topZ);
      const rise = top - foot;
      if (rise > 0.05) {
        const n = Math.max(1, Math.ceil(rise / STEP_RISE_M));
        const treadDepth = piece.depthM / n;
        const treadRise = rise / n;
        for (let k = 1; k <= n; k++) {
          pieces.push({
            kind: 'steps',
            poi: at.id,
            x: c.x + a.fx * treadDepth * (k - 0.5),
            z: c.z + a.fz * treadDepth * (k - 0.5),
            bearing: pb,
            widthM: piece.widthM,
            depthM: treadDepth,
            minY: foot - 0.3,
            maxY: foot + treadRise * k,
          });
        }
      }
      continue;
    }
    if (piece.kind === 'field') {
      // Laid over the ground on a grid about every 2 m, so it follows the slope.
      const a = axes(pb);
      const nx = Math.max(2, Math.ceil(piece.widthM / 2) + 1);
      const nz = Math.max(2, Math.ceil(piece.depthM / 2) + 1);
      const heights: number[] = [];
      let lo = Number.POSITIVE_INFINITY;
      let hi = Number.NEGATIVE_INFINITY;
      for (let j = 0; j < nz; j++) {
        const o = (0.5 - j / (nz - 1)) * piece.depthM;
        for (let i = 0; i < nx; i++) {
          const r = (i / (nx - 1) - 0.5) * piece.widthM;
          const h = heightAt(c.x + a.rx * r + a.fx * o, c.z + a.rz * r + a.fz * o);
          heights.push(h);
          lo = Math.min(lo, h);
          hi = Math.max(hi, h);
        }
      }
      pieces.push({
        kind: 'field',
        poi: at.id,
        x: c.x,
        z: c.z,
        bearing: pb,
        widthM: piece.widthM,
        depthM: piece.depthM,
        minY: lo,
        maxY: hi + piece.heightM,
        drape: { nx, nz, heights },
        ...(piece.variant ? { variant: piece.variant } : {}),
      });
      continue;
    }
    if (piece.kind === 'stumps') {
      // About one stump every 30 m², scattered by a hash of where the piece is.
      const a = axes(pb);
      const n = Math.max(1, Math.round((piece.widthM * piece.depthM) / 30));
      const posts: { x: number; z: number; y: number; r: number }[] = [];
      const seed = Math.round(c.x * 7 + c.z * 13);
      for (let k = 0; k < n; k++) {
        const r = (hash01(seed + k * 3.1) - 0.5) * piece.widthM;
        const o = (hash01(seed + k * 5.7 + 1) - 0.5) * piece.depthM;
        const x = c.x + a.rx * r + a.fx * o;
        const z = c.z + a.rz * r + a.fz * o;
        posts.push({ x, z, y: heightAt(x, z), r: 0.22 + hash01(seed + k) * 0.18 });
      }
      const ys = posts.map((q) => q.y);
      pieces.push({
        kind: 'stumps',
        poi: at.id,
        x: c.x,
        z: c.z,
        bearing: pb,
        widthM: piece.widthM,
        depthM: piece.depthM,
        minY: Math.min(...ys) - 0.3,
        maxY: Math.max(...ys) + piece.heightM,
        posts,
      });
      continue;
    }
    const flat = FLAT_KINDS.has(piece.kind);
    const foot = (flat ? heightAt(c.x, c.z) : floor(c.x, c.z)) + piece.yM;
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
      ...(piece.variant ? { variant: piece.variant } : {}),
    });
  }
  for (const m of poi.marks) {
    const c = point(m.right, m.out);
    marks.push({
      poi: at.id,
      id: m.id,
      kind: m.kind,
      x: c.x,
      y: floor(c.x, c.z) + m.yM,
      z: c.z,
      facing: bearing + (m.facingDeg * Math.PI) / 180,
    });
  }
  const [r0, r1] = poi.clear.rightM;
  const [o0, o1] = poi.clear.outM;
  const mid = point((r0 + r1) / 2, (o0 + o1) / 2);
  return {
    pieces,
    ladders,
    marks,
    clearing: {
      x: mid.x,
      z: mid.z,
      ux: rx,
      uz: rz,
      halfAlong: (r1 - r0) / 2,
      halfAcross: (o1 - o0) / 2,
    },
  };
}

/**
 * An island's prefabs and caches set down on the ground drawn (`heightAt`, the zone's
 * sailing terrain), each prefab by `placePoi`, then the caches' cairns.
 */
export function placeIsland(
  def: IslandDef,
  origin: IslandOrigin,
  heightAt: (x: number, z: number) => number,
): PlacedIsland {
  const pieces: PlacedPoiPiece[] = [];
  const ladders: PlacedPoiLadder[] = [];
  const clearings: Clearing[] = [];
  const marks: PlacedPoiMark[] = [];
  const onFoot = def.onFoot ?? {
    pois: [],
    caches: [],
    landings: [],
    residents: [],
    reporting: 'slow' as const,
  };
  const homes = new Set(onFoot.residents.flatMap((r) => (r.home ? [r.home] : [])));
  const clearingOf = new Map<string, Clearing>();
  for (const at of onFoot.pois) {
    const poi = poiDef(at.poi);
    if (!poi) throw new Error(`islands: ${def.id} places unknown ${at.poi}`);
    const one = placePoi(poi, at, origin, heightAt, pieces);
    // Someone lives here: the windows of its cabins, shanties and fish house are lit.
    if (homes.has(at.id)) {
      for (const p of one.pieces) if (LIVED_IN.has(p.kind)) p.lit = true;
    }
    pieces.push(...one.pieces);
    ladders.push(...one.ladders);
    marks.push(...one.marks);
    clearings.push(one.clearing);
    clearingOf.set(at.id, one.clearing);
  }

  const landings: PlacedLanding[] = onFoot.landings.map((l) => {
    const x = origin.x0 + l.x;
    const z = origin.z0 + l.z;
    return { name: l.name, x, y: floorAt(pieces, heightAt, x, z), z };
  });

  const residents: PlacedResident[] = onFoot.residents.map((r) => {
    const route: PlacedResident['route'] = [];
    const home = r.home ? clearingOf.get(r.home) : undefined;
    for (const m of marks) {
      if (m.poi === r.home && m.kind === 'resident') {
        route.push({ x: m.x, z: m.z, waitS: RESIDENT_WAIT_S.mark, face: m.facing });
      }
    }
    for (const p of r.round) {
      route.push({ x: origin.x0 + p.x, z: origin.z0 + p.z, waitS: RESIDENT_WAIT_S.round });
    }
    const type: ResidentType = `npc.${r.kind}`;
    return {
      id: r.id,
      name: r.name,
      kind: r.kind,
      type,
      ...(r.home ? { home: r.home } : {}),
      route,
      ...(home
        ? {
            grounds: {
              x: home.x,
              z: home.z,
              radiusM: Math.max(home.halfAlong, home.halfAcross),
            },
          }
        : {}),
      talk: r.talk,
    };
  });

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

  return {
    id: def.id,
    name: def.name,
    ...(def.tier ? { tier: def.tier } : {}),
    ...(def.mainland ? { mainland: true } : {}),
    pieces,
    ladders,
    caches,
    clearings,
    marks,
    landings,
    residents,
    reporting: onFoot.reporting,
    ...(onFoot.village ? { village: onFoot.village } : {}),
  };
}

/**
 * Every walkable island of a zone placed, given the manifest's tile corners. With the
 * zone's frame and the tiles' extent, each also knows where its own land lies (piece Q).
 */
export function placeZoneIslands(
  zoneId: string,
  origins: readonly ({ id: string } & IslandOrigin)[],
  heightAt: (x: number, z: number) => number,
  frame?: ZoneFrame,
): PlacedIsland[] {
  const out: PlacedIsland[] = [];
  for (const def of walkableIslands(zoneId)) {
    const origin = origins.find((o) => o.id === def.id);
    if (!origin) continue;
    const placed = placeIsland(def, origin, heightAt);
    if (frame && origin.width && origin.height && !def.mainland) {
      const center = chartToZone(GEO.geoToChart(def.at), frame);
      placed.anchor = center;
      placed.land = islandLand(
        heightAt,
        { x0: origin.x0, z0: origin.z0, width: origin.width, height: origin.height },
        center,
        LAND_CELL_M,
        !!def.clip,
      );
    }
    out.push(placed);
  }
  return out;
}

const GEO = new ChartProjection();

/** Cells of an island's land grid, meters, and how far out its distances run. */
export const LAND_CELL_M = 8;
const LAND_REACH_CELLS = 40;

/**
 * The island's own land in its baked box (Phase 9 piece Q): the land joined to the point
 * nearest its center, sampled every 8 m, and every cell's distance to it. Other land in
 * the box (a neighbor, the mainland) isn't the island's.
 */
export function islandLand(
  heightAt: (x: number, z: number) => number,
  box: { x0: number; z0: number; width: number; height: number },
  center: { x: number; z: number },
  cellM = LAND_CELL_M,
  allLand = false,
): IslandLand {
  const cols = Math.max(1, Math.ceil(box.width / cellM));
  const rows = Math.max(1, Math.ceil(box.height / cellM));
  const n = cols * rows;
  const land = new Uint8Array(n);
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const h = heightAt(box.x0 + (c + 0.5) * cellM, box.z0 + (r + 0.5) * cellM);
      if (h > 0) land[r * cols + c] = 1;
    }
  }
  // The land cell nearest the island's center seeds its component.
  const cc = Math.floor((center.x - box.x0) / cellM);
  const cr = Math.floor((center.z - box.z0) / cellM);
  let seed = -1;
  let best = Number.POSITIVE_INFINITY;
  for (let i = 0; i < n; i++) {
    if (!land[i]) continue;
    const d = (Math.floor(i / cols) - cr) ** 2 + ((i % cols) - cc) ** 2;
    if (d < best) {
      best = d;
      seed = i;
    }
  }
  const dist = new Uint8Array(n).fill(255);
  if (seed < 0) return { x0: box.x0, z0: box.z0, cellM, cols, rows, dist };
  const queue = new Int32Array(n);
  let head = 0;
  let tail = 0;
  dist[seed] = 0;
  queue[tail++] = seed;
  // An island cut out by a clip box (Long Island's broken spit, piece R) is all the land in it.
  if (allLand) {
    for (let i = 0; i < n; i++) {
      if (!land[i] || i === seed) continue;
      dist[i] = 0;
      queue[tail++] = i;
    }
  }
  // The component, 8-connected over land, at distance 0.
  while (head < tail) {
    const i = queue[head++] as number;
    const c = i % cols;
    const r = (i - c) / cols;
    for (let dr = -1; dr <= 1; dr++) {
      for (let dc = -1; dc <= 1; dc++) {
        const nr = r + dr;
        const nc = c + dc;
        if (nr < 0 || nc < 0 || nr >= rows || nc >= cols) continue;
        const j = nr * cols + nc;
        if (!land[j] || dist[j] === 0) continue;
        dist[j] = 0;
        queue[tail++] = j;
      }
    }
  }
  // Out from it over everything else, a cell a step.
  head = 0;
  while (head < tail) {
    const i = queue[head++] as number;
    const d = dist[i] as number;
    if (d >= LAND_REACH_CELLS) continue;
    const c = i % cols;
    const r = (i - c) / cols;
    for (const [dr, dc] of STEPS4) {
      const nr = r + dr;
      const nc = c + dc;
      if (nr < 0 || nc < 0 || nr >= rows || nc >= cols) continue;
      const j = nr * cols + nc;
      if ((dist[j] as number) <= d + 1) continue;
      dist[j] = d + 1;
      queue[tail++] = j;
    }
  }
  return { x0: box.x0, z0: box.z0, cellM, cols, rows, dist };
}

const STEPS4: readonly (readonly [number, number])[] = [
  [0, 1],
  [0, -1],
  [1, 0],
  [-1, 0],
];

/** Meters from (x, z) to the island's own land; Infinity off its grid or past its reach. */
export function landDistanceM(land: IslandLand, x: number, z: number): number {
  const c = Math.floor((x - land.x0) / land.cellM);
  const r = Math.floor((z - land.z0) / land.cellM);
  if (c < 0 || r < 0 || c >= land.cols || r >= land.rows) return Number.POSITIVE_INFINITY;
  const d = land.dist[r * land.cols + c] as number;
  return d === 255 ? Number.POSITIVE_INFINITY : d * land.cellM;
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

/**
 * A box in a piece's own frame (Phase 9 piece P): centered `right` and `out` of the piece's
 * middle, `w` across and `d` along, from `y0` to `y1` above its foot. Shared by the
 * renderer and the colliders, so what's drawn is what's solid.
 */
export interface LocalBlock {
  right: number;
  out: number;
  w: number;
  d: number;
  y0: number;
  y1: number;
  /** The mouth's dark lining: drawn, not solid. */
  dark?: boolean;
}

type PieceSize = Pick<PlacedPoiPiece, 'widthM' | 'depthM' | 'minY' | 'maxY'>;

/** How wide and high a cave mouth's opening is, for a face this big. */
export function caveOpening(p: PieceSize): { w: number; h: number } {
  const h = p.maxY - p.minY;
  return { w: Math.min(p.widthM * 0.42, 6), h: Math.min(h * 0.62, 5) };
}

/**
 * A cave mouth's rock and its dark lining: two jambs either side of the opening, the
 * lintel over it with a stepped (corbelled) underside, and the back wall that closes it
 * 0.8 m short of the face's back until piece S opens the cave. The opening faces out (the
 * frame's forward); its floor is the ground, walkable to the back wall.
 */
export function caveMouthBlocks(p: PieceSize): LocalBlock[] {
  const W = p.widthM;
  const D = p.depthM;
  const H = p.maxY - p.minY;
  const o = caveOpening(p);
  const side = (W - o.w) / 2;
  const back = 0.8;
  const step = Math.min(0.5, o.w / 6);
  return [
    { right: -(o.w / 2 + side / 2), out: 0, w: side, d: D, y0: 0, y1: H },
    { right: o.w / 2 + side / 2, out: 0, w: side, d: D, y0: 0, y1: H },
    { right: 0, out: 0, w: o.w, d: D, y0: o.h, y1: H },
    // The arch's steps, each course in a little from the jambs.
    { right: -(o.w / 2 - step / 2), out: 0, w: step, d: D, y0: o.h - 0.55, y1: o.h },
    { right: o.w / 2 - step / 2, out: 0, w: step, d: D, y0: o.h - 0.55, y1: o.h },
    { right: -(o.w / 2 - step * 1.5), out: 0, w: step, d: D, y0: o.h - 0.25, y1: o.h },
    { right: o.w / 2 - step * 1.5, out: 0, w: step, d: D, y0: o.h - 0.25, y1: o.h },
    { right: 0, out: -(D / 2 - back / 2), w: o.w, d: back, y0: 0, y1: o.h },
    // The dark lining over the back wall's face: the cave going on into the dark.
    { right: 0, out: -(D / 2 - back - 0.01), w: o.w, d: 0.02, y0: 0, y1: o.h, dark: true },
  ];
}

/** A survey signal's three feet in its frame, `widthM` across, one leg pointing out. */
export function signalFeet(widthM: number): { right: number; out: number }[] {
  const r = widthM / 2;
  return [0, 1, 2].map((k) => {
    const a = (k / 3) * Math.PI * 2;
    return { right: Math.sin(a) * r, out: Math.cos(a) * r };
  });
}

/** A point in a placed piece's frame, in zone meters. */
export function pieceToZone(
  p: Pick<PlacedPoiPiece, 'x' | 'z' | 'bearing'>,
  right: number,
  out: number,
): { x: number; z: number } {
  const { fx, fz, rx, rz } = axes(p.bearing);
  return { x: p.x + rx * right + fx * out, z: p.z + rz * right + fz * out };
}
