import type { PlacedBuilding, PlacedPier } from '../../sim/harbors';
import type { Pose } from '../../sim/terrain/test-bay';
import { ColliderSet, type BoxCollider, type Collider, type Surface } from './colliders';
import type { Ladder, OnFootZone } from './controller';
import { Heightfield } from './heightfield';

/**
 * The on-foot scene for going ashore (plan 03 §7, plan 08 §20.4 piece A): the ground, the
 * piers, the buildings and the schooner around the landing, as the controller's colliders,
 * plus the ladders down the pier heads. Built behind the transition when you go ashore.
 *
 * This is the stand-in every landing uses until its own scene lands: the zone's 4 m
 * sailing terrain (the same grid the terrain mesh draws, so feet meet the ground drawn),
 * the harbor kit's piers on their piles and its buildings as solid blocks. Piece C swaps
 * in Bayfield's district for its harbor, and piece H the island's 1 m tiles for its
 * landing; both keep this shape.
 */

export interface AshoreGround {
  /** Height above the lake, m (negative under water). */
  heightAt(x: number, z: number): number;
  /** The grid the terrain is sampled on: its origin and spacing, so samples line up. */
  x0: number;
  z0: number;
  step: number;
}

export interface AshoreShip {
  pose: Pose;
  lengthM: number;
  beamM: number;
  /** Her deck above the water, m. */
  deckM: number;
}

export interface AshoreSceneInput {
  ground: AshoreGround;
  /** The landing: the scene is built around it. */
  center: { x: number; z: number };
  /** Half the side of the square built, m. */
  halfSizeM?: number;
  piers?: readonly PlacedPier[];
  buildings?: readonly PlacedBuilding[];
  /** The schooner alongside or at anchor: a hull you can't walk through. */
  ship?: AshoreShip | undefined;
  /** True inside a town's footprint, where the ground is dirt streets. */
  inTown?(x: number, z: number): boolean;
}

export interface AshoreScene extends OnFootZone {
  /** The square built, zone meters; the mode keeps you inside it. */
  bounds: { minX: number; minZ: number; maxX: number; maxZ: number };
  ladders: Ladder[];
  /** The schooner's hull, if she's in the scene (for "go aboard" checks). */
  ship: BoxCollider | undefined;
}

export const ASHORE_HALF_M = 320;
/** The plank deck's thickness, as the harbor kit draws it. */
const DECK_M = 0.4;
const PILE_SPACING_M = 5;
const PILE_R = 0.22;
/** How far below the water a pier-head ladder reaches. */
const LADDER_DEPTH_M = 1.2;
/** Slopes steeper than this read as bare rock underfoot. */
const ROCK_SLOPE = (35 * Math.PI) / 180;

/** A yawed box from a footprint center along a bearing (radians clockwise from north). */
export function bearingBox(
  x: number,
  z: number,
  bearing: number,
  across: number,
  along: number,
  minY: number,
  maxY: number,
  surface?: Surface,
): BoxCollider {
  // three.js yaw is counter-clockwise; a bearing is clockwise (plan 01 §3).
  return {
    kind: 'box',
    x,
    z,
    halfX: across / 2,
    halfZ: along / 2,
    yaw: -bearing,
    minY,
    maxY,
    ...(surface ? { surface } : {}),
  };
}

/** A plank pier's deck, piles and pier-head ladders. */
function pierColliders(
  p: PlacedPier,
  ground: AshoreGround,
  out: Collider[],
  ladders: Ladder[],
): void {
  const fx = Math.sin(p.bearing);
  const fz = -Math.cos(p.bearing);
  const rx = -fz;
  const rz = fx;
  const mid = p.lengthM / 2;
  const solid = p.kind === 'canal' || p.kind === 'ore';
  // A canal pier is a crib to the bottom and an ore dock a wall of pockets: no swimming under.
  const minY = solid ? Math.min(ground.heightAt(p.root.x, p.root.z), -6) : p.deckM - DECK_M;
  out.push(
    bearingBox(
      p.root.x + fx * mid,
      p.root.z + fz * mid,
      p.bearing,
      p.widthM,
      p.lengthM,
      minY,
      p.deckM,
      solid ? 'stone' : 'wood',
    ),
  );
  if (!solid) {
    for (let s = PILE_SPACING_M / 2; s <= p.lengthM; s += PILE_SPACING_M) {
      for (const side of [-1, 1]) {
        const across = side * (p.widthM / 2 - 0.25);
        const x = p.root.x + fx * s + rx * across;
        const z = p.root.z + fz * s + rz * across;
        const bottom = Math.min(ground.heightAt(x, z), p.deckM - 1) - 1;
        out.push({ kind: 'cylinder', x, z, radius: PILE_R, minY: bottom, maxY: p.deckM - DECK_M });
      }
    }
  }
  // A ladder down the pier head, where nothing berths, if there's water under it.
  const headX = p.root.x + fx * (p.lengthM + 0.02);
  const headZ = p.root.z + fz * (p.lengthM + 0.02);
  if (ground.heightAt(headX + fx, headZ + fz) < -0.5) {
    ladders.push({
      x: headX,
      z: headZ,
      facing: p.bearing + Math.PI,
      bottomY: -LADDER_DEPTH_M,
      topY: p.deckM,
      topX: p.root.x + fx * (p.lengthM - 0.7),
      topZ: p.root.z + fz * (p.lengthM - 0.7),
    });
  }
}

/** A building as a solid block to its roof ridge (piece C opens the ones you can enter). */
function buildingCollider(b: PlacedBuilding): BoxCollider {
  return bearingBox(b.x, b.z, b.facing, b.widthM, b.depthM, b.footM, b.floorM + b.heightM + 3);
}

export function buildAshoreScene(input: AshoreSceneInput): AshoreScene {
  const { ground } = input;
  const half = input.halfSizeM ?? ASHORE_HALF_M;
  const step = ground.step;
  // Snap to the terrain's own samples, so the walked ground is the drawn ground.
  const i0 = Math.floor((input.center.x - half - ground.x0) / step);
  const j0 = Math.floor((input.center.z - half - ground.z0) / step);
  const n = Math.ceil((2 * half) / step) + 2;
  const originX = ground.x0 + i0 * step;
  const originZ = ground.z0 + j0 * step;
  const heights = new Float32Array(n * n);
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      heights[j * n + i] = ground.heightAt(originX + i * step, originZ + j * step);
    }
  }
  const field = new Heightfield(n, n, step, originX, originZ, heights);
  const bounds = {
    minX: originX,
    minZ: originZ,
    maxX: originX + (n - 1) * step,
    maxZ: originZ + (n - 1) * step,
  };
  const inside = (x: number, z: number, pad: number): boolean =>
    x > bounds.minX - pad && x < bounds.maxX + pad && z > bounds.minZ - pad && z < bounds.maxZ + pad;

  const colliders = new ColliderSet();
  const all: Collider[] = [];
  const ladders: Ladder[] = [];
  for (const p of input.piers ?? []) {
    if (!inside(p.root.x, p.root.z, p.lengthM + 20)) continue;
    pierColliders(p, ground, all, ladders);
  }
  for (const b of input.buildings ?? []) {
    if (inside(b.x, b.z, 20)) all.push(buildingCollider(b));
  }
  let ship: BoxCollider | undefined;
  if (input.ship) {
    const s = input.ship;
    // Her hull from the keel to the rail; you board her by the gangway, not over the side.
    ship = bearingBox(
      s.pose.x,
      s.pose.z,
      s.pose.heading,
      s.beamM,
      s.lengthM,
      -2.5,
      s.deckM + 1,
      'wood',
    );
    all.push(ship);
  }
  for (const c of all) colliders.add(c);

  const surfaceAt = (x: number, z: number): Surface => {
    if (input.inTown?.(x, z)) return 'dirt';
    const h = field.heightAt(x, z);
    if (field.slopeAt(x, z, 2) > ROCK_SLOPE) return 'rock';
    if (h < 1.2) return 'sand';
    return 'grass';
  };

  return { ground: field, colliders, waterLevel: 0, ladders, surfaceAt, bounds, ship };
}

/**
 * The gangway at a berth (plan 02 §7): on the pier's deck abreast of the ship's middle,
 * a step in from the edge she lies at. Where you step ashore and where F goes aboard.
 */
export function gangwayAt(pier: PlacedPier, shipPose: Pose): { x: number; y: number; z: number } {
  const fx = Math.sin(pier.bearing);
  const fz = -Math.cos(pier.bearing);
  const dx = shipPose.x - pier.root.x;
  const dz = shipPose.z - pier.root.z;
  const along = Math.min(Math.max(dx * fx + dz * fz, 1), pier.lengthM - 1);
  const ax = dx - fx * along;
  const az = dz - fz * along;
  const off = Math.hypot(ax, az) || 1;
  const inset = Math.max(pier.widthM / 2 - 0.9, 0);
  return {
    x: pier.root.x + fx * along + (ax / off) * inset,
    y: pier.deckM,
    z: pier.root.z + fz * along + (az / off) * inset,
  };
}

/**
 * Where you step out of the boat onto the beach: up from her bow until the ground is dry
 * and gentle enough to stand on, or undefined if there's none close.
 */
export function beachStep(
  heightAt: (x: number, z: number) => number,
  bow: { x: number; z: number },
  heading: number,
  maxSlope = (36 * Math.PI) / 180,
): { x: number; y: number; z: number } | undefined {
  const fx = Math.sin(heading);
  const fz = -Math.cos(heading);
  for (let d = 0; d <= 14; d += 0.5) {
    const x = bow.x + fx * d;
    const z = bow.z + fz * d;
    const h = heightAt(x, z);
    if (h < 0.15) continue;
    const g = Math.hypot(heightAt(x + 1, z) - heightAt(x - 1, z), heightAt(x, z + 1) - heightAt(x, z - 1)) / 2;
    if (Math.atan(g) > maxSlope) return undefined;
    return { x, y: h, z };
  }
  return undefined;
}
