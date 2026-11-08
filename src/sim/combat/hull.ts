import type { ShipRecord } from '../../../data/schemas/ships';
import type { Vec3 } from './ballistics';

/**
 * A ship's shape to shoot at (plan 07 §4.1, plan 02 §6.3; Phase 6 piece A): a box for the
 * hull up to her rail, a band above it for the deck, and a narrower box aloft for her masts
 * and canvas (or a steamer's funnel and stays). Sized from her ships.json record in drawn
 * meters; plain math, so it unit-tests.
 *
 * Local frame: `u` across to starboard, `v` forward along the keel, `y` up from her
 * waterline.
 */

export interface HullShape {
  halfLength: number;
  halfBeam: number;
  /** How far the hull box reaches below the waterline (shot doesn't go deeper). */
  belowM: number;
  /** Rail height above the waterline. */
  freeboardM: number;
  /** The height of the deck band above the rail: men, boats, deckhouses. */
  deckM: number;
  /** The top of her masts or funnel above the waterline. */
  topM: number;
  /** The rig's fore-and-aft reach, a share of her length. */
  rigLength01: number;
  steam: boolean;
}

/** Where a shot struck (plan 07 §4.1): low on the hull (it leaks more), the hull, the deck, aloft. */
export type HitLocation = 'waterline' | 'hull' | 'deck' | 'rigging' | 'engine';

const clamp = (x: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, x));

export function hullShape(record: ShipRecord): HullShape {
  const length = record.lengthM * record.displayScale;
  // The buoyancy samples sit a little inside her ends and sides.
  const beam = (record.buoyancy.beam / record.buoyancy.length) * length * 1.1;
  const steam = record.propulsion === 'steam';
  const freeboardM = clamp(length * (steam ? 0.06 : 0.07), 1.1, 6);
  return {
    halfLength: length / 2,
    halfBeam: beam / 2,
    belowM: Math.min(record.draftEmptyM, 1.5),
    freeboardM,
    deckM: steam ? clamp(length * 0.06, 2.2, 7) : 2,
    // Two masts on a schooner, a tall funnel and a stick of a mast on a steamer.
    topM: freeboardM + (steam ? clamp(length * 0.17, 6, 18) : clamp(length * 0.95, 14, 32)),
    rigLength01: steam ? 0.35 : 0.75,
    steam,
  };
}

/** The ship on the water: where her waterline center is, and her heading. */
export interface HullPose {
  x: number;
  /** Her waterline's height (she rides the swell). */
  y: number;
  z: number;
  heading: number;
}

/** A point in her local frame. */
export function toLocal(p: Vec3, pose: HullPose): Vec3 {
  const dx = p.x - pose.x;
  const dz = p.z - pose.z;
  const s = Math.sin(pose.heading);
  const c = Math.cos(pose.heading);
  // Forward is (sin h, -cos h); starboard is (cos h, sin h).
  return { x: dx * c + dz * s, y: p.y - pose.y, z: dx * s - dz * c };
}

/** A local point back on the water (`x` is `u`, `z` is `v`). */
export function toWorld(l: Vec3, pose: HullPose): Vec3 {
  const s = Math.sin(pose.heading);
  const c = Math.cos(pose.heading);
  return { x: pose.x + l.x * c + l.z * s, y: pose.y + l.y, z: pose.z + l.x * s - l.z * c };
}

interface Box {
  u: number;
  v: number;
  y0: number;
  y1: number;
}

function boxes(h: HullShape): [Box, Box] {
  return [
    { u: h.halfBeam, v: h.halfLength, y0: -h.belowM, y1: h.freeboardM + h.deckM },
    {
      u: h.halfBeam * (h.steam ? 0.45 : 0.8),
      v: h.halfLength * h.rigLength01,
      y0: h.freeboardM + h.deckM,
      y1: h.topM,
    },
  ];
}

/** Where a segment first enters a box, as a share of its length; undefined if it misses. */
function enterBox(a: Vec3, b: Vec3, box: Box): number | undefined {
  let t0 = 0;
  let t1 = 1;
  const axes: [number, number, number, number][] = [
    [a.x, b.x - a.x, -box.u, box.u],
    [a.y, b.y - a.y, box.y0, box.y1],
    [a.z, b.z - a.z, -box.v, box.v],
  ];
  for (const [p, d, lo, hi] of axes) {
    if (Math.abs(d) < 1e-12) {
      if (p < lo || p > hi) return undefined;
      continue;
    }
    let ta = (lo - p) / d;
    let tb = (hi - p) / d;
    if (ta > tb) [ta, tb] = [tb, ta];
    t0 = Math.max(t0, ta);
    t1 = Math.min(t1, tb);
    if (t0 > t1) return undefined;
  }
  return t0;
}

export interface HullHit {
  /** Share of the segment where it struck. */
  t: number;
  /** The point, in her local frame. */
  local: Vec3;
  location: HitLocation;
}

/** The first point a shot's path from `a` to `b` (world) strikes her, and where. */
export function hitTest(a: Vec3, b: Vec3, shape: HullShape, pose: HullPose): HullHit | undefined {
  const la = toLocal(a, pose);
  const lb = toLocal(b, pose);
  let best: number | undefined;
  for (const box of boxes(shape)) {
    const t = enterBox(la, lb, box);
    if (t !== undefined && (best === undefined || t < best)) best = t;
  }
  if (best === undefined) return undefined;
  const local = {
    x: la.x + (lb.x - la.x) * best,
    y: la.y + (lb.y - la.y) * best,
    z: la.z + (lb.z - la.z) * best,
  };
  return { t: best, local, location: hitLocation(local, shape) };
}

/**
 * What part of her a local point is (plan 07 §4.1): low on the hull is the waterline,
 * then the hull to her rail, the deck band, and aloft her rigging. On a steamer the
 * engine and boiler spaces are midships to aft: the funnel above the deck, and below it
 * a hull hit there reaches the engine too (see `damage.ts`).
 */
export function hitLocation(local: Vec3, shape: HullShape): HitLocation {
  const { y } = local;
  if (y < shape.freeboardM * 0.35) return 'waterline';
  if (y <= shape.freeboardM) return 'hull';
  if (y <= shape.freeboardM + shape.deckM) return 'deck';
  if (shape.steam && inEngineSpaces(local, shape)) return 'engine';
  return 'rigging';
}

/** Midships to aft on a steamer: her engine room, boilers and funnel. */
export function inEngineSpaces(local: Vec3, shape: HullShape): boolean {
  const v01 = local.z / shape.halfLength;
  return shape.steam && v01 > -0.55 && v01 < 0.1;
}
