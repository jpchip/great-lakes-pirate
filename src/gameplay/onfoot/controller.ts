import type { Vec3 } from '../ecs';
import {
  footprintDistance,
  type Collider,
  type ColliderSet,
  type Push,
  type Surface,
} from './colliders';
import type { Heightfield } from './heightfield';

/**
 * Hand-rolled on-foot character controller (plan 01 §2.2, spike S5). A vertical capsule
 * of `radius` walks on a heightfield and collides with extruded primitives. No physics
 * engine: horizontal moves are sub-stepped so the capsule never skips through a prop,
 * pushed out of overlapping footprints, then snapped to the ground below.
 *
 * Controls follow plan 08 §3: walk, run, crouch-sneak, and swimming in deep water, plus
 * a small hop (about 0.45 m) for getting over rough ground. Phase 7 piece A adds ladders,
 * vaulting and climbing at marked spots (a short scripted move onto or over the prop),
 * the landing speed for fall damage, and the surface underfoot.
 */

export interface ControllerParams {
  radius: number;
  standHeight: number;
  crouchHeight: number;
  /** Ledges up to this high are walked up without vaulting (stairs, low crates, curbs). */
  stepHeight: number;
  /** Steeper terrain blocks uphill movement and slides you down (plan 11 §3.1). */
  maxSlope: number;
  /**
   * Width in meters the slope is measured over. Wider than a heightfield cell, it keeps
   * the sawtooth of a diagonal cliff on 1 m tiles from snagging you as you walk along it.
   */
  slopeSpan: number;
  /** While grounded, follow the ground down this far instead of falling (slopes, stairs). */
  snapDistance: number;
  sneakSpeed: number;
  walkSpeed: number;
  runSpeed: number;
  swimSpeed: number;
  groundAccel: number;
  airAccel: number;
  gravity: number;
  /** Take-off speed of a hop, in m/s; the apex is jumpSpeed² / (2·gravity). */
  jumpSpeed: number;
  /** Radians per second the body turns to face its movement. */
  turnRate: number;
  /** Water deeper than this floats you: you swim with your feet this far below the surface. */
  swimDepth: number;
  /** Up and down a ladder, m/s. */
  climbSpeed: number;
  /** A `vault` spot's top may be this high above your feet; a `climb` spot's, `climbMax`. */
  vaultMax: number;
  climbMax: number;
  /** Seconds a vault and a climb take. */
  vaultS: number;
  climbS: number;
}

export const DEFAULT_CONTROLLER: ControllerParams = {
  radius: 0.3,
  standHeight: 1.75,
  crouchHeight: 1.15,
  stepHeight: 0.4,
  maxSlope: (42 * Math.PI) / 180,
  slopeSpan: 1,
  snapDistance: 0.45,
  sneakSpeed: 1.3,
  walkSpeed: 2.4,
  runSpeed: 5.2,
  swimSpeed: 1.1,
  groundAccel: 30,
  airAccel: 4,
  gravity: 18,
  jumpSpeed: 4,
  turnRate: 12,
  swimDepth: 1.3,
  climbSpeed: 1.4,
  vaultMax: 1.3,
  climbMax: 2.6,
  vaultS: 0.45,
  climbS: 0.9,
};

export type Gait =
  | 'idle'
  | 'sneak'
  | 'walk'
  | 'run'
  | 'swim'
  | 'fall'
  | 'slide'
  | 'ladder'
  | 'vault'
  | 'climb';

/**
 * A ladder (plan 08 §3.1): against a wall or a pier's end, from `bottomY` (often under
 * the water) to `topY`. You face `facing` on it; at the top you step off to (topX, topZ).
 */
export interface Ladder {
  x: number;
  z: number;
  facing: number;
  bottomY: number;
  topY: number;
  topX: number;
  topZ: number;
}

/** A vault or a climb under way: a short scripted move from one place to another. */
export interface ScriptedMove {
  kind: 'vault' | 'climb' | 'dismount';
  from: Vec3;
  to: Vec3;
  /** The highest the feet go on the way, so they clear the prop's top. */
  peakY: number;
  t: number;
  durationS: number;
}

export interface CharacterState {
  /** Feet position in zone meters. */
  position: Vec3;
  velocity: Vec3;
  /** Radians, clockwise from north, like every other heading. */
  heading: number;
  grounded: boolean;
  crouching: boolean;
  swimming: boolean;
  /** Slope of the terrain underfoot (0 when standing on a prop). */
  groundSlope: number;
  gait: Gait;
  /** What's underfoot (plan 08 §3.2): a prop's surface or the terrain's; `water` swimming. */
  surface: Surface | 'water';
  /**
   * How fast you were falling when you landed this tick, m/s, and whether into water
   * (fall damage, plan 11 §3.2); 0 on every other tick.
   */
  landedSpeed: number;
  landedInWater: boolean;
  /** On a ladder: its index in the zone's list. */
  ladder: number | undefined;
  move: ScriptedMove | undefined;
}

export interface MoveInput {
  /** -1…1 along the view direction. */
  forward: number;
  /** -1…1 to the right of the view direction. */
  right: number;
  run: boolean;
  crouch: boolean;
  /** Hop this tick (on the ground, standing). */
  jump?: boolean;
}

export interface OnFootZone {
  ground: Heightfield;
  colliders: ColliderSet;
  /** Lake surface height; Superior is flat on foot. */
  waterLevel: number;
  ladders?: readonly Ladder[];
  /** The terrain's surface at a point; absent, all terrain is dirt. */
  surfaceAt?(x: number, z: number): Surface;
}

export function createCharacter(position: Vec3, heading = 0): CharacterState {
  return {
    position: { ...position },
    velocity: { x: 0, y: 0, z: 0 },
    heading,
    grounded: false,
    crouching: false,
    swimming: false,
    groundSlope: 0,
    gait: 'idle',
    surface: 'dirt',
    landedSpeed: 0,
    landedInWater: false,
    ladder: undefined,
    move: undefined,
  };
}

/** Puts the character somewhere at rest: off any ladder or move, not falling. */
export function placeCharacter(s: CharacterState, at: Vec3, heading = s.heading): void {
  s.position.x = at.x;
  s.position.y = at.y;
  s.position.z = at.z;
  s.velocity.x = s.velocity.y = s.velocity.z = 0;
  s.heading = heading;
  s.ladder = undefined;
  s.move = undefined;
  s.grounded = false;
  s.swimming = false;
  s.crouching = false;
  s.landedSpeed = 0;
  s.landedInWater = false;
}

const MAX_FALL_SPEED = 40;
const PUSH_ITERATIONS = 3;
const SKIN = 1e-4;

const nearby: Collider[] = [];
const push: Push = { nx: 0, nz: 0 };
const grad = { x: 0, z: 0 };

/**
 * Advance the character one fixed tick. `viewYaw` is the camera heading (clockwise from
 * north) that `input` is relative to.
 */
export function stepCharacter(
  s: CharacterState,
  input: MoveInput,
  viewYaw: number,
  zone: OnFootZone,
  dt: number,
  p: ControllerParams = DEFAULT_CONTROLLER,
): void {
  s.landedSpeed = 0;
  s.landedInWater = false;
  if (s.move) {
    stepMove(s, zone, p, dt);
    return;
  }
  if (s.ladder !== undefined) {
    stepLadder(s, input, zone, p, dt);
    return;
  }

  // Crouch, standing up only where there's headroom.
  if (input.crouch && !s.swimming) s.crouching = true;
  else if (s.crouching && fits(s, zone, p, p.standHeight)) s.crouching = false;

  // Wish direction on the ground plane. Heading h faces (sin h, −cos h) in x/z.
  const fx = Math.sin(viewYaw);
  const fz = -Math.cos(viewYaw);
  let wx = fx * input.forward - fz * input.right;
  let wz = fz * input.forward + fx * input.right;
  const wishLen = Math.hypot(wx, wz);
  if (wishLen > 1) {
    wx /= wishLen;
    wz /= wishLen;
  }
  const speed = s.swimming
    ? p.swimSpeed
    : s.crouching
      ? p.sneakSpeed
      : input.run
        ? p.runSpeed
        : p.walkSpeed;

  const sliding = s.grounded && s.groundSlope > p.maxSlope;
  if (sliding) {
    // On a slope too steep to stand on you can walk off it, but not up it.
    zone.ground.smoothGradientAt(s.position.x, s.position.z, p.slopeSpan, grad);
    const g = Math.hypot(grad.x, grad.z);
    const up = (wx * grad.x + wz * grad.z) / g;
    if (up > 0) {
      wx -= (up * grad.x) / g;
      wz -= (up * grad.z) / g;
    }
  }
  // In the air you only steer a little.
  const accel = s.grounded || s.swimming ? p.groundAccel : p.airAccel;
  let dvx = wx * speed - s.velocity.x;
  let dvz = wz * speed - s.velocity.z;
  const dv = Math.hypot(dvx, dvz);
  const maxDv = accel * dt;
  if (dv > maxDv) {
    dvx *= maxDv / dv;
    dvz *= maxDv / dv;
  }
  s.velocity.x += dvx;
  s.velocity.z += dvz;

  if (sliding) {
    // Gravity along the slope, downhill.
    zone.ground.smoothGradientAt(s.position.x, s.position.z, p.slopeSpan, grad);
    const g = Math.hypot(grad.x, grad.z);
    const a = p.gravity * Math.sin(s.groundSlope) * Math.cos(s.groundSlope);
    s.velocity.x -= (grad.x / g) * a * dt;
    s.velocity.z -= (grad.z / g) * a * dt;
  }

  if (s.grounded || s.swimming) s.velocity.y = 0;
  else s.velocity.y = Math.max(s.velocity.y - p.gravity * dt, -MAX_FALL_SPEED);
  if (input.jump && s.grounded && !s.crouching) {
    // At a marked spot Space vaults or climbs; anywhere else it hops.
    if (startSpotMove(s, zone, p, wx, wz)) return;
    s.velocity.y = p.jumpSpeed;
    s.grounded = false;
  }

  // Sub-step so no step moves farther than half the radius.
  const travel = Math.hypot(s.velocity.x, s.velocity.z, s.velocity.y) * dt;
  const steps = Math.max(1, Math.ceil(travel / (p.radius * 0.5)));
  const h = dt / steps;
  for (let i = 0; i < steps; i++) {
    moveHorizontal(s, zone, p, s.velocity.x * h, s.velocity.z * h);
    s.position.y += s.velocity.y * h;
    settle(s, zone, p);
  }

  // Walking or swimming into the foot of a ladder takes hold of it.
  if (wishLen > 0.1 && !s.crouching) {
    const k = ladderAhead(s, zone, p, wx / wishLen, wz / wishLen);
    if (k !== undefined) {
      grabLadder(s, zone, k, p);
      return;
    }
  }

  // Face the direction of travel.
  const hs = Math.hypot(s.velocity.x, s.velocity.z);
  if (hs > 0.2 && wishLen > 0.01) {
    const target = Math.atan2(s.velocity.x, -s.velocity.z);
    const diff = Math.atan2(Math.sin(target - s.heading), Math.cos(target - s.heading));
    const maxTurn = p.turnRate * dt;
    s.heading += Math.max(-maxTurn, Math.min(maxTurn, diff));
    s.heading = Math.atan2(Math.sin(s.heading), Math.cos(s.heading));
  }

  s.gait = s.swimming
    ? 'swim'
    : !s.grounded
      ? 'fall'
      : s.groundSlope > p.maxSlope
        ? 'slide'
        : hs < 0.1
          ? 'idle'
          : s.crouching
            ? 'sneak'
            : hs > (p.walkSpeed + p.runSpeed) / 2
              ? 'run'
              : 'walk';
}

function bodyHeight(s: CharacterState, p: ControllerParams): number {
  return s.crouching ? p.crouchHeight : p.standHeight;
}

/** True if a collider blocks the body sideways: it spans part of the body above the step. */
function blocks(c: Collider, feetY: number, height: number, p: ControllerParams): boolean {
  return c.maxY > feetY + p.stepHeight && c.minY < feetY + height;
}

function fits(s: CharacterState, zone: OnFootZone, p: ControllerParams, height: number): boolean {
  zone.colliders.query(s.position.x, s.position.z, p.radius, nearby);
  for (const c of nearby) {
    if (!blocks(c, s.position.y, height, p)) continue;
    if (footprintDistance(c, s.position.x, s.position.z, push) < p.radius - SKIN) return false;
  }
  return true;
}

function moveHorizontal(
  s: CharacterState,
  zone: OnFootZone,
  p: ControllerParams,
  dx: number,
  dz: number,
): void {
  const pos = s.position;
  const ground = zone.ground;

  // Steep terrain: keep only the part of the move that doesn't climb it.
  if (!s.swimming && (dx !== 0 || dz !== 0)) {
    const hNow = ground.heightAt(pos.x, pos.z);
    const hNext = ground.heightAt(pos.x + dx, pos.z + dz);
    const terrainIsFloor = hNext > pos.y - p.stepHeight;
    if (
      terrainIsFloor &&
      hNext > hNow &&
      ground.slopeAt(pos.x + dx, pos.z + dz, p.slopeSpan) > p.maxSlope
    ) {
      ground.smoothGradientAt(pos.x + dx, pos.z + dz, p.slopeSpan, grad);
      const g = Math.hypot(grad.x, grad.z);
      const ux = grad.x / g;
      const uz = grad.z / g;
      const into = dx * ux + dz * uz;
      if (into > 0) {
        dx -= into * ux;
        dz -= into * uz;
        const vInto = s.velocity.x * ux + s.velocity.z * uz;
        if (vInto > 0) {
          s.velocity.x -= vInto * ux;
          s.velocity.z -= vInto * uz;
        }
      }
      // Still climbing a cliff after sliding along it: stay put.
      const hSlide = ground.heightAt(pos.x + dx, pos.z + dz);
      if (
        hSlide > hNow + p.stepHeight * 0.25 &&
        ground.slopeAt(pos.x + dx, pos.z + dz, p.slopeSpan) > p.maxSlope
      ) {
        dx = 0;
        dz = 0;
      }
    }
  }

  pos.x += dx;
  pos.z += dz;

  // Push the capsule out of props, removing velocity into each contact.
  const height = bodyHeight(s, p);
  for (let iter = 0; iter < PUSH_ITERATIONS; iter++) {
    let moved = false;
    zone.colliders.query(pos.x, pos.z, p.radius, nearby);
    for (const c of nearby) {
      if (!blocks(c, pos.y, height, p)) continue;
      const d = footprintDistance(c, pos.x, pos.z, push);
      if (d >= p.radius) continue;
      const depth = p.radius - d + SKIN;
      pos.x += push.nx * depth;
      pos.z += push.nz * depth;
      const vn = s.velocity.x * push.nx + s.velocity.z * push.nz;
      if (vn < 0) {
        s.velocity.x -= vn * push.nx;
        s.velocity.z -= vn * push.nz;
      }
      moved = true;
    }
    if (!moved) break;
  }
}

/** Find the floor under the capsule and land on it, follow it down, or fall. */
function settle(s: CharacterState, zone: OnFootZone, p: ControllerParams): void {
  const pos = s.position;
  const terrain = zone.ground.heightAt(pos.x, pos.z);
  let floor = terrain;
  let onTerrain = true;

  // Prop tops count as floor once enough of the capsule is over them.
  let floorSurface: Surface | undefined;
  zone.colliders.query(pos.x, pos.z, p.radius, nearby);
  for (const c of nearby) {
    if (c.maxY <= floor || c.maxY > pos.y + p.stepHeight + SKIN) continue;
    if (footprintDistance(c, pos.x, pos.z, push) < p.radius * 0.6) {
      floor = c.maxY;
      onTerrain = false;
      floorSurface = c.surface ?? 'wood';
    }
  }

  const wasGrounded = s.grounded;
  s.groundSlope = onTerrain ? zone.ground.slopeAt(pos.x, pos.z, p.slopeSpan) : 0;

  // Deep water floats you; walking out where it gets shallow.
  const floatY = zone.waterLevel - p.swimDepth;
  if (floor < floatY && pos.y <= floatY + SKIN) {
    if (!s.swimming && s.velocity.y < 0) {
      s.landedSpeed = -s.velocity.y;
      s.landedInWater = true;
    }
    pos.y = floatY;
    s.velocity.y = 0;
    s.swimming = true;
    s.grounded = false;
    s.crouching = false;
    s.surface = 'water';
    return;
  }
  s.swimming = false;
  s.surface = floorSurface ?? zone.surfaceAt?.(pos.x, pos.z) ?? 'dirt';

  if (pos.y <= floor) {
    if (!wasGrounded && s.velocity.y < 0) s.landedSpeed = -s.velocity.y;
    pos.y = floor;
    s.velocity.y = 0;
    s.grounded = true;
  } else if (wasGrounded && pos.y - floor <= p.snapDistance && s.velocity.y <= 0) {
    pos.y = floor;
    s.grounded = true;
  } else {
    s.grounded = false;
  }
}

// --- Ladders, vaults and climbs (Phase 7 piece A) ----------------------------------

/** How close (m) you must be to a ladder's foot, beyond your radius, to take hold. */
const LADDER_REACH = 0.45;

/** Where you hang on ladder `l`: your radius out from the wall it stands against. */
function ladderStandoff(l: Ladder, p: ControllerParams): { x: number; z: number } {
  return { x: l.x - Math.sin(l.facing) * p.radius, z: l.z + Math.cos(l.facing) * p.radius };
}

/** A ladder you're moving into near its foot (or anywhere up it, swimming), if any. */
function ladderAhead(
  s: CharacterState,
  zone: OnFootZone,
  p: ControllerParams,
  dirX: number,
  dirZ: number,
): number | undefined {
  const ladders = zone.ladders;
  if (!ladders) return undefined;
  for (let k = 0; k < ladders.length; k++) {
    const l = ladders[k] as Ladder;
    const at = ladderStandoff(l, p);
    if (Math.hypot(s.position.x - at.x, s.position.z - at.z) > LADDER_REACH + p.radius) continue;
    // Facing it: moving roughly the way the ladder faces.
    if (dirX * Math.sin(l.facing) - dirZ * Math.cos(l.facing) < 0.6) continue;
    const y = s.position.y;
    if (y < l.bottomY - p.swimDepth - 0.3 || y > l.topY - 0.6) continue;
    return k;
  }
  return undefined;
}

/** The ladder whose top you're standing at, if any: F there climbs down (the mode asks). */
export function ladderTopNear(
  s: CharacterState,
  zone: OnFootZone,
  reach = 0.9,
): number | undefined {
  const ladders = zone.ladders;
  if (!ladders || !s.grounded) return undefined;
  for (let k = 0; k < ladders.length; k++) {
    const l = ladders[k] as Ladder;
    if (Math.abs(s.position.y - l.topY) > 0.3) continue;
    if (Math.hypot(s.position.x - l.topX, s.position.z - l.topZ) <= reach) return k;
  }
  return undefined;
}

/** Takes hold of ladder `k` where you are on it (clamped to its length). */
export function grabLadder(
  s: CharacterState,
  zone: OnFootZone,
  k: number,
  p: ControllerParams = DEFAULT_CONTROLLER,
): void {
  const l = zone.ladders?.[k];
  if (!l) return;
  const at = ladderStandoff(l, p);
  s.ladder = k;
  s.move = undefined;
  s.position.x = at.x;
  s.position.z = at.z;
  s.position.y = Math.min(Math.max(s.position.y, l.bottomY - p.swimDepth), l.topY - 0.3);
  s.velocity.x = s.velocity.y = s.velocity.z = 0;
  s.heading = l.facing;
  s.grounded = false;
  s.swimming = false;
  s.crouching = false;
  s.gait = 'ladder';
}

/** From the top of ladder `k` down onto it, facing the wall. */
export function climbDownLadder(
  s: CharacterState,
  zone: OnFootZone,
  k: number,
  p: ControllerParams = DEFAULT_CONTROLLER,
): void {
  const l = zone.ladders?.[k];
  if (!l) return;
  s.position.y = l.topY - 0.4;
  grabLadder(s, zone, k, p);
}

function stepLadder(
  s: CharacterState,
  input: MoveInput,
  zone: OnFootZone,
  p: ControllerParams,
  dt: number,
): void {
  const l = zone.ladders?.[s.ladder ?? -1];
  if (!l) {
    s.ladder = undefined;
    return;
  }
  s.gait = 'ladder';
  s.velocity.x = s.velocity.z = 0;
  // Space lets go: you drop back off it.
  if (input.jump) {
    s.ladder = undefined;
    s.velocity.x = -Math.sin(l.facing) * 1.5;
    s.velocity.z = Math.cos(l.facing) * 1.5;
    s.velocity.y = 0;
    s.gait = 'fall';
    return;
  }
  const climb = Math.max(-1, Math.min(1, input.forward));
  s.velocity.y = climb * p.climbSpeed * (input.run && climb < 0 ? 2 : 1);
  s.position.y += s.velocity.y * dt;
  if (s.position.y >= l.topY - 0.3 && climb > 0) {
    // Over the top and onto the deck.
    s.ladder = undefined;
    s.velocity.y = 0;
    s.move = {
      kind: 'dismount',
      from: { ...s.position },
      to: { x: l.topX, y: l.topY, z: l.topZ },
      peakY: l.topY + 0.05,
      t: 0,
      durationS: 0.5,
    };
    s.gait = 'climb';
    return;
  }
  const floor = zone.ground.heightAt(s.position.x, s.position.z);
  const floatY = zone.waterLevel - p.swimDepth;
  if (s.position.y <= Math.max(l.bottomY - p.swimDepth, floor, floatY) && climb < 0) {
    // The foot of it: into the water, or onto the ground.
    s.ladder = undefined;
    s.position.y = Math.max(floor, floatY);
    s.velocity.y = 0;
    settle(s, zone, p);
    s.gait = s.swimming ? 'swim' : 'idle';
  }
}

/** Starts a vault or climb at a marked spot ahead, if there is one; true if it did. */
function startSpotMove(
  s: CharacterState,
  zone: OnFootZone,
  p: ControllerParams,
  wx: number,
  wz: number,
): boolean {
  // The way you're going, or the way you face standing still.
  let dx = wx;
  let dz = wz;
  const len = Math.hypot(dx, dz);
  if (len < 0.1) {
    dx = Math.sin(s.heading);
    dz = -Math.cos(s.heading);
  } else {
    dx /= len;
    dz /= len;
  }
  const reach = p.radius + 0.5;
  const px = s.position.x + dx * reach;
  const pz = s.position.z + dz * reach;
  zone.colliders.query(px, pz, p.radius, nearby);
  let best: Collider | undefined;
  for (const c of nearby) {
    if (!c.spot) continue;
    const rise = c.maxY - s.position.y;
    const max = c.spot === 'vault' ? p.vaultMax : p.climbMax;
    if (rise <= p.stepHeight * 0.5 || rise > max) continue;
    if (footprintDistance(c, s.position.x, s.position.z, push) > reach) continue;
    // The face you'd go over must be ahead of you, not beside.
    if (footprintDistance(c, px, pz, push) > p.radius) continue;
    if (!best || c.maxY < best.maxY) best = c;
  }
  if (!best) return false;
  const top = best.maxY;
  // Onto its top if there's room to stand there; over it (a vault) if it's a fence.
  let to: Vec3 | undefined;
  for (let d = 0.2; d <= 2.5; d += 0.1) {
    const x = s.position.x + dx * d;
    const z = s.position.z + dz * d;
    if (footprintDistance(best, x, z, push) < -p.radius * 0.7) {
      const at = { x, y: top, z };
      if (fitsAt(at, zone, p, p.standHeight, best)) to = at;
      break;
    }
  }
  if (!to && best.spot === 'vault') {
    for (let d = 0.4; d <= 2.5; d += 0.1) {
      const x = s.position.x + dx * d;
      const z = s.position.z + dz * d;
      if (footprintDistance(best, x, z, push) > p.radius + 0.05) {
        const ground = Math.max(zone.ground.heightAt(x, z), zone.waterLevel - p.swimDepth);
        const at = { x, y: ground, z };
        if (ground < top && fitsAt(at, zone, p, p.standHeight, undefined)) to = at;
        break;
      }
    }
  }
  if (!to) return false;
  s.move = {
    kind: best.spot === 'climb' ? 'climb' : 'vault',
    from: { ...s.position },
    to,
    peakY: top + 0.08,
    t: 0,
    durationS: best.spot === 'climb' ? p.climbS : p.vaultS,
  };
  s.velocity.x = s.velocity.y = s.velocity.z = 0;
  s.heading = Math.atan2(dx, -dz);
  s.gait = s.move.kind === 'climb' ? 'climb' : 'vault';
  return true;
}

/** True if a body of `height` at `at` overlaps nothing but `ignore` (whose top it stands on). */
function fitsAt(
  at: Vec3,
  zone: OnFootZone,
  p: ControllerParams,
  height: number,
  ignore: Collider | undefined,
): boolean {
  zone.colliders.query(at.x, at.z, p.radius, nearby);
  for (const c of nearby) {
    if (c === ignore) continue;
    if (!blocks(c, at.y, height, p)) continue;
    if (footprintDistance(c, at.x, at.z, push) < p.radius - SKIN) return false;
  }
  return true;
}

function stepMove(s: CharacterState, zone: OnFootZone, p: ControllerParams, dt: number): void {
  const m = s.move as ScriptedMove;
  m.t = Math.min(m.t + dt / m.durationS, 1);
  // Up first, then across: the feet rise to the top in the first part, then carry over.
  const up = Math.min(m.t / 0.55, 1);
  const across = m.t < 0.35 ? 0 : (m.t - 0.35) / 0.65;
  const e = (t: number): number => t * t * (3 - 2 * t);
  s.position.x = m.from.x + (m.to.x - m.from.x) * e(across);
  s.position.z = m.from.z + (m.to.z - m.from.z) * e(across);
  const rise = m.from.y + (m.peakY - m.from.y) * e(up);
  // Coming down the far side of a vault, the feet drop to where they land.
  s.position.y = m.t < 0.7 ? rise : m.peakY + (m.to.y - m.peakY) * e((m.t - 0.7) / 0.3);
  s.gait = m.kind === 'vault' ? 'vault' : 'climb';
  if (m.t >= 1) {
    s.position.x = m.to.x;
    s.position.y = m.to.y;
    s.position.z = m.to.z;
    s.move = undefined;
    s.velocity.x = s.velocity.y = s.velocity.z = 0;
    s.grounded = true;
    settle(s, zone, p);
    s.landedSpeed = 0;
    s.landedInWater = false;
    s.gait = s.swimming ? 'swim' : 'idle';
  }
}
