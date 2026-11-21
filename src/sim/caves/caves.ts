import cavesJson from '../../../data/caves.json';
import {
  cavesFileSchema,
  type CaveCacheDef,
  type CaveDef,
  type CaveRules,
} from '../../../data/schemas/caves';
import { chartToZone, ChartProjection, type ZoneFrame } from '../../core/coords';
import { Rng } from '../../core/rng';
import { axes, type IslandOrigin, type PlacedIsland } from '../islands/on-foot';
import type { Clearing } from '../terrain/vegetation';

/**
 * Sea caves (plan 11 §5, §18.4 piece S): each cave's passage set down in zone meters off
 * its frame, and the questions the rest of the game asks of it. Pure: the ground, the
 * colliders, the renderer and the terrain's cut all come from the same numbers here.
 *
 * A passage is a line of nodes; between two nodes it's a capsule (round where it bends,
 * round at a closed end), its floor and roof eased from one node to the next. Under a roof
 * it's a cave; without one, the channel in from the lake or a prefab's opening.
 */

const FILE = cavesFileSchema.parse(cavesJson);
export const CAVES: readonly CaveDef[] = FILE.caves;
export const CAVE_RULES: CaveRules = FILE.rules;

/** Prefab placements (`onFoot.pois` ids) that open into a cave: their back wall is gone. */
export const OPEN_CAVE_MOUTHS: ReadonlySet<string> = new Set(
  CAVES.flatMap((c) => (c.mouth ? [c.mouth] : [])),
);

/** A node in zone meters. */
export interface PlacedCaveNode {
  x: number;
  z: number;
  /** Half the width, m. */
  hw: number;
  floor: number;
  /** Undefined: open sky. */
  roof: number | undefined;
  lip: boolean;
}

export interface PlacedCaveSpot {
  name: string;
  x: number;
  y: number;
  z: number;
}

export interface PlacedCaveCache {
  def: CaveCacheDef;
  spots: PlacedCaveSpot[];
}

export interface PlacedCave {
  id: string;
  name: string;
  island: string | undefined;
  wonder: string;
  entered: string;
  /** The frame: its origin and the bearing it faces out to the lake. */
  frame: { x: number; z: number; bearing: number };
  nodes: PlacedCaveNode[];
  caches: PlacedCaveCache[];
  marks: { id: string; kind: 'grotto' | 'ledge'; x: number; y: number; z: number }[];
  /**
   * Where it opens to the lake (the outermost open node in the water): the sea there is
   * the sea in the mouth, and the lake's ice there makes it an ice cave.
   */
  sea: { x: number; z: number } | undefined;
  bounds: { minX: number; minZ: number; maxX: number; maxZ: number };
}

/** A point inside a cave's passage. */
export interface CaveSample {
  cave: PlacedCave;
  /** The segment (from node `seg` to `seg + 1`) and how far along it, 0–1. */
  seg: number;
  t: number;
  /** Signed meters right of the passage's line, and its half width there. */
  lateral: number;
  hw: number;
  floor: number;
  roof: number | undefined;
}

const GEO = new ChartProjection();

/** Where each cave's frame sits: its prefab's, its island point's, or its chart point's. */
function caveFrame(
  def: CaveDef,
  origins: readonly ({ id: string } & IslandOrigin)[],
  islands: readonly PlacedIsland[],
  frame: ZoneFrame | undefined,
): { x: number; z: number; bearing: number } | undefined {
  if (def.mouth) {
    const island = islands.find((i) => i.id === def.island);
    const piece = island?.pieces.find((p) => p.poi === def.mouth && p.kind === 'cave_mouth');
    return piece && { x: piece.x, z: piece.z, bearing: piece.bearing };
  }
  const bearing = ((def.facingDeg ?? 0) * Math.PI) / 180;
  if (def.at) {
    if (!frame) return undefined;
    const at = chartToZone(GEO.geoToChart(def.at), frame);
    return { x: at.x, z: at.z, bearing };
  }
  const origin = origins.find((o) => o.id === def.island);
  if (!origin || def.x === undefined || def.z === undefined) return undefined;
  return { x: origin.x0 + def.x, z: origin.z0 + def.z, bearing };
}

/** One cave set down on its frame. */
export function placeCave(def: CaveDef, at: { x: number; z: number; bearing: number }): PlacedCave {
  const { fx, fz, rx, rz } = axes(at.bearing);
  const point = (right: number, out: number): { x: number; z: number } => ({
    x: at.x + rx * right + fx * out,
    z: at.z + rz * right + fz * out,
  });
  const nodes: PlacedCaveNode[] = def.nodes.map((n) => ({
    ...point(n.right, n.out),
    hw: n.widthM / 2,
    floor: n.floorM,
    roof: n.roofM,
    lip: !!n.lip,
  }));
  let minX = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxZ = -Infinity;
  for (const n of nodes) {
    minX = Math.min(minX, n.x - n.hw - 2);
    minZ = Math.min(minZ, n.z - n.hw - 2);
    maxX = Math.max(maxX, n.x + n.hw + 2);
    maxZ = Math.max(maxZ, n.z + n.hw + 2);
  }
  const cave: PlacedCave = {
    id: def.id,
    name: def.name,
    island: def.island,
    wonder: def.wonder,
    entered: def.entered,
    frame: { ...at },
    nodes,
    caches: [],
    marks: [],
    sea: undefined,
    bounds: { minX, minZ, maxX, maxZ },
  };
  const floorAt = (x: number, z: number): number => sampleCave(cave, x, z)?.floor ?? 0;
  cave.caches = def.caches.map((c) => ({
    def: c,
    spots: c.spots.map((s) => {
      const p = point(s.right, s.out);
      return { name: s.name, x: p.x, y: floorAt(p.x, p.z), z: p.z };
    }),
  }));
  cave.marks = def.marks.map((m) => {
    const p = point(m.right, m.out);
    return { id: m.id, kind: m.kind, x: p.x, y: floorAt(p.x, p.z), z: p.z };
  });
  // The open end out in the lake: the deepest open node.
  const open = nodes.filter((n) => n.roof === undefined && n.floor < 0);
  const sea = open.sort((a, b) => a.floor - b.floor)[0];
  cave.sea = sea && { x: sea.x, z: sea.z };
  return cave;
}

/**
 * Every cave of a zone set down: the islands placed first (a cave whose frame is a
 * prefab needs it), the manifest's tile corners, and the zone's frame for the mainland's.
 */
export function placeZoneCaves(
  zoneId: string,
  origins: readonly ({ id: string } & IslandOrigin)[],
  islands: readonly PlacedIsland[],
  frame?: ZoneFrame,
): PlacedCave[] {
  const out: PlacedCave[] = [];
  for (const def of CAVES) {
    if (def.zone !== zoneId) continue;
    const at = caveFrame(def, origins, islands, frame);
    if (at) out.push(placeCave(def, at));
  }
  return out;
}

const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

/**
 * The passage at (x, z), if the point is in it: the segment it's nearest the middle of
 * (a joint's round belongs to both), with the floor and the roof eased along it. A segment
 * is roofed only where both its ends are. `marginM` widens it past its walls (the walked
 * ground's, so a slope sampled beside the wall isn't the cliff's).
 */
export function sampleCave(
  cave: PlacedCave,
  x: number,
  z: number,
  marginM = 0,
): CaveSample | undefined {
  const b = cave.bounds;
  if (x < b.minX || x > b.maxX || z < b.minZ || z > b.maxZ) return undefined;
  let best: CaveSample | undefined;
  let bestRatio = 1;
  const n = cave.nodes;
  for (let k = 0; k + 1 < n.length; k++) {
    const a = n[k] as PlacedCaveNode;
    const c = n[k + 1] as PlacedCaveNode;
    const dx = c.x - a.x;
    const dz = c.z - a.z;
    const len2 = dx * dx + dz * dz;
    const t = len2 > 1e-9 ? Math.min(1, Math.max(0, ((x - a.x) * dx + (z - a.z) * dz) / len2)) : 0;
    const px = a.x + dx * t;
    const pz = a.z + dz * t;
    const d = Math.hypot(x - px, z - pz);
    const hw = lerp(a.hw, c.hw, t);
    const ratio = d / (hw + marginM);
    if (ratio > bestRatio) continue;
    if (best && ratio === bestRatio) continue;
    bestRatio = ratio;
    const len = Math.sqrt(len2) || 1;
    // Right of the line, zone x/z (x east, z south): (-dz, dx) over its length.
    const lateral = ((x - px) * -dz + (z - pz) * dx) / len;
    const roof = a.roof !== undefined && c.roof !== undefined ? lerp(a.roof, c.roof, t) : undefined;
    best = { cave, seg: k, t, lateral, hw, floor: lerp(a.floor, c.floor, t), roof };
  }
  return best;
}

/** The first cave whose passage holds (x, z). */
export function caveAt(
  caves: readonly PlacedCave[],
  x: number,
  z: number,
  marginM = 0,
): CaveSample | undefined {
  for (const c of caves) {
    const s = sampleCave(c, x, z, marginM);
    if (s) return s;
  }
  return undefined;
}

/**
 * Inside under the roof, for something standing at height `y`: in a roofed part of a
 * passage and below its roof. On the cliff top over it, you're not in it.
 */
export function underRoof(s: CaveSample | undefined, y: number): boolean {
  return !!s && s.roof !== undefined && y < s.roof;
}

/** The caves whose bounds meet a box (a scene being built). */
export function cavesIn(
  caves: readonly PlacedCave[],
  box: { minX: number; minZ: number; maxX: number; maxZ: number },
): PlacedCave[] {
  return caves.filter(
    (c) =>
      c.bounds.maxX >= box.minX &&
      c.bounds.minX <= box.maxX &&
      c.bounds.maxZ >= box.minZ &&
      c.bounds.minZ <= box.maxZ,
  );
}

/** A solid of a cave: a yawed box, as the on-foot colliders take it. */
export interface CaveSolid {
  x: number;
  z: number;
  /** Bearing of its long axis, radians clockwise from north. */
  bearing: number;
  across: number;
  along: number;
  minY: number;
  maxY: number;
}

/** Spacing of the wall's blocks along the rock, m. */
const WALL_STEP_M = 0.8;
const WALL_THICK_M = 1;

/**
 * The rock round a passage as blocks (plan 01 §2.2's boxes): small blocks just outside its
 * edge wherever the edge is the passage's own and not another segment's inside, from below
 * the floor up past the roof, and the roof itself as a slab over each roofed segment. The
 * channel and a prefab's opening have no walls: the lake, or the prefab's own jambs.
 */
export function caveSolids(cave: PlacedCave): CaveSolid[] {
  const out: CaveSolid[] = [];
  const n = cave.nodes;
  /** Inside any segment (a little in from its edge), roofed or open. */
  const inside = (x: number, z: number): boolean => {
    const s = sampleCave(cave, x, z);
    return !!s && Math.abs(s.lateral) < s.hw - 0.02;
  };
  const wall = (x: number, z: number, nx: number, nz: number, floor: number, roof: number) => {
    // A block centered half its thickness out from the edge, its face on the edge.
    const cx = x + nx * (WALL_THICK_M / 2);
    const cz = z + nz * (WALL_THICK_M / 2);
    out.push({
      x: cx,
      z: cz,
      bearing: Math.atan2(nx, -nz),
      across: WALL_STEP_M + 0.35,
      along: WALL_THICK_M,
      minY: floor - 4,
      maxY: roof + 0.4,
    });
  };
  for (let k = 0; k + 1 < n.length; k++) {
    const a = n[k] as PlacedCaveNode;
    const c = n[k + 1] as PlacedCaveNode;
    if (a.roof === undefined || c.roof === undefined) continue;
    const dx = c.x - a.x;
    const dz = c.z - a.z;
    const len = Math.hypot(dx, dz) || 1;
    const ux = dx / len;
    const uz = dz / len;
    // Right of the line, zone x/z (x east, z south): (-uz, ux).
    const rx = -uz;
    const rz = ux;
    const steps = Math.max(1, Math.ceil(len / WALL_STEP_M));
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const hw = lerp(a.hw, c.hw, t);
      const px = a.x + dx * t;
      const pz = a.z + dz * t;
      const floor = lerp(a.floor, c.floor, t);
      const roof = lerp(a.roof, c.roof, t);
      for (const side of [-1, 1]) {
        const ex = px + rx * side * (hw + 0.05);
        const ez = pz + rz * side * (hw + 0.05);
        if (!inside(ex, ez)) wall(ex, ez, rx * side, rz * side, floor, roof);
      }
    }
    // Round the joints and a closed end: the arc out past the line's ends.
    for (const [node, dir] of [
      [a, -1],
      [c, 1],
    ] as const) {
      const arcs = Math.max(4, Math.ceil((Math.PI * node.hw) / WALL_STEP_M));
      for (let i = 1; i < arcs; i++) {
        const ang = (i / arcs) * Math.PI;
        // From the right side round the end to the left.
        const ox = rx * Math.cos(ang) + ux * dir * Math.sin(ang);
        const oz = rz * Math.cos(ang) + uz * dir * Math.sin(ang);
        const ex = node.x + ox * (node.hw + 0.05);
        const ez = node.z + oz * (node.hw + 0.05);
        if (!inside(ex, ez)) wall(ex, ez, ox, oz, node.floor, node.roof ?? 0);
      }
    }
    // The roof over the segment: a slab from a little under the crown.
    const mid = { x: (a.x + c.x) / 2, z: (a.z + c.z) / 2 };
    const roofLow = Math.min(a.roof, c.roof);
    out.push({
      x: mid.x,
      z: mid.z,
      bearing: Math.atan2(ux, -uz),
      across: Math.max(a.hw, c.hw) * 2,
      along: len + Math.min(a.hw, c.hw),
      minY: roofLow - 0.15,
      maxY: Math.max(a.roof, c.roof) + 0.6,
    });
  }
  return out;
}

/**
 * Where the drawn ground is cut away for a cave (the terrain shader's discard): a capsule
 * per segment, with the height range cut. A roofed segment cuts everything from far under
 * its floor up to its roof, a hand wider than its walls; an open one only within its
 * width, up to its roofed neighbor's roof (a prefab's opening), or just over the lake
 * (the channel, where the bottom is the cave's own).
 */
export interface CaveClip {
  x0: number;
  z0: number;
  x1: number;
  z1: number;
  radius: number;
  minY: number;
  maxY: number;
  /** Under a roof (the water goes dark there); open, the channel or a prefab's opening. */
  roofed: boolean;
}

export function caveClips(cave: PlacedCave): CaveClip[] {
  const out: CaveClip[] = [];
  const n = cave.nodes;
  for (let k = 0; k + 1 < n.length; k++) {
    const a = n[k] as PlacedCaveNode;
    const c = n[k + 1] as PlacedCaveNode;
    const roofed = a.roof !== undefined && c.roof !== undefined;
    const neighbor = a.roof ?? c.roof;
    out.push({
      x0: a.x,
      z0: a.z,
      x1: c.x,
      z1: c.z,
      radius: Math.max(a.hw, c.hw) + (roofed ? 0.3 : 0),
      minY: Math.min(a.floor, c.floor) - 40,
      maxY: roofed ? Math.max(a.roof ?? 0, c.roof ?? 0) : neighbor !== undefined ? neighbor : 0.3,
      roofed,
    });
  }
  return out;
}

/** A cache's take this run: the island cairns' roll (`rollCache`), by its id and the seed. */
export function rollCaveCache(
  cache: Pick<CaveCacheDef, 'id' | 'spots' | 'cashCents'>,
  runSeed: number,
): { spot: number; cents: number } {
  const rng = Rng.fromSeed(`${runSeed}:${cache.id}`);
  const spot = Math.floor(rng.next() * cache.spots.length);
  const [lo, hi] = cache.cashCents;
  const cents = Math.round(lo + (hi - lo) * rng.next());
  return { spot: Math.min(spot, cache.spots.length - 1), cents };
}

/**
 * Where the forest and the shore rocks stay clear of a cave (plan 03 §14's clearings): its
 * channel and the mouth it comes in at, so no rock sits in the way in and no tree stands in
 * the cut. Over the roofed passage the cliff top keeps its trees.
 */
export function caveClearings(cave: PlacedCave): Clearing[] {
  const out: Clearing[] = [];
  const n = cave.nodes;
  for (let k = 0; k + 1 < n.length; k++) {
    const a = n[k] as PlacedCaveNode;
    const c = n[k + 1] as PlacedCaveNode;
    const open = a.roof === undefined || c.roof === undefined;
    if (!open && !a.lip && !c.lip) continue;
    const dx = c.x - a.x;
    const dz = c.z - a.z;
    const len = Math.hypot(dx, dz) || 1;
    out.push({
      x: (a.x + c.x) / 2,
      z: (a.z + c.z) / 2,
      ux: dx / len,
      uz: dz / len,
      halfAlong: len / 2 + Math.max(a.hw, c.hw) + 2,
      halfAcross: Math.max(a.hw, c.hw) + 2.5,
    });
  }
  return out;
}
