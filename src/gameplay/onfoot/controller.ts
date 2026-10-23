import type { Vec3 } from '../ecs';
import { footprintDistance, type Collider, type ColliderSet, type Push } from './colliders';
import type { Heightfield } from './heightfield';

/**
 * Hand-rolled on-foot character controller (plan 01 §2.2, spike S5). A vertical capsule
 * of `radius` walks on a heightfield and collides with extruded primitives. No physics
 * engine: horizontal moves are sub-stepped so the capsule never skips through a prop,
 * pushed out of overlapping footprints, then snapped to the ground below.
 *
 * Controls follow plan 08 §3: walk, run, crouch-sneak, and swimming in deep water.
 * Vault and climb at marked spots are left for Phase 7.
 */

export interface ControllerParams {
  radius: number;
  standHeight: number;
  crouchHeight: number;
  /** Ledges up to this high are walked up without vaulting (stairs, low crates, curbs). */
  stepHeight: number;
  /** Steeper terrain blocks uphill movement and slides you down (plan 11 §3.1). */
  maxSlope: number;
  /** While grounded, follow the ground down this far instead of falling (slopes, stairs). */
  snapDistance: number;
  sneakSpeed: number;
  walkSpeed: number;
  runSpeed: number;
  swimSpeed: number;
  groundAccel: number;
  airAccel: number;
  gravity: number;
  /** Radians per second the body turns to face its movement. */
  turnRate: number;
  /** Water deeper than this floats you: you swim with your feet this far below the surface. */
  swimDepth: number;
}

export const DEFAULT_CONTROLLER: ControllerParams = {
  radius: 0.3,
  standHeight: 1.75,
  crouchHeight: 1.15,
  stepHeight: 0.4,
  maxSlope: (42 * Math.PI) / 180,
  snapDistance: 0.45,
  sneakSpeed: 1.3,
  walkSpeed: 2.4,
  runSpeed: 5.2,
  swimSpeed: 1.1,
  groundAccel: 30,
  airAccel: 4,
  gravity: 18,
  turnRate: 12,
  swimDepth: 1.3,
};

export type Gait = 'idle' | 'sneak' | 'walk' | 'run' | 'swim' | 'fall' | 'slide';

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
}

export interface MoveInput {
  /** -1…1 along the view direction. */
  forward: number;
  /** -1…1 to the right of the view direction. */
  right: number;
  run: boolean;
  crouch: boolean;
}

export interface OnFootZone {
  ground: Heightfield;
  colliders: ColliderSet;
  /** Lake surface height; Superior is flat on foot. */
  waterLevel: number;
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
  };
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
  const onFooting = (s.grounded && !sliding) || s.swimming;
  const accel = onFooting ? p.groundAccel : p.airAccel;
  // In the air or sliding you only steer a little.
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
    zone.ground.gradientAt(s.position.x, s.position.z, grad);
    const g = Math.hypot(grad.x, grad.z);
    const a = p.gravity * Math.sin(s.groundSlope) * Math.cos(s.groundSlope);
    s.velocity.x -= (grad.x / g) * a * dt;
    s.velocity.z -= (grad.z / g) * a * dt;
  }

  if (s.grounded || s.swimming) s.velocity.y = 0;
  else s.velocity.y = Math.max(s.velocity.y - p.gravity * dt, -MAX_FALL_SPEED);

  // Sub-step so no step moves farther than half the radius.
  const travel = Math.hypot(s.velocity.x, s.velocity.z, s.velocity.y) * dt;
  const steps = Math.max(1, Math.ceil(travel / (p.radius * 0.5)));
  const h = dt / steps;
  for (let i = 0; i < steps; i++) {
    moveHorizontal(s, zone, p, s.velocity.x * h, s.velocity.z * h);
    s.position.y += s.velocity.y * h;
    settle(s, zone, p);
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
    if (terrainIsFloor && hNext > hNow && ground.slopeAt(pos.x + dx, pos.z + dz) > p.maxSlope) {
      ground.gradientAt(pos.x + dx, pos.z + dz, grad);
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
        ground.slopeAt(pos.x + dx, pos.z + dz) > p.maxSlope
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
  zone.colliders.query(pos.x, pos.z, p.radius, nearby);
  for (const c of nearby) {
    if (c.maxY <= floor || c.maxY > pos.y + p.stepHeight + SKIN) continue;
    if (footprintDistance(c, pos.x, pos.z, push) < p.radius * 0.6) {
      floor = c.maxY;
      onTerrain = false;
    }
  }

  const wasGrounded = s.grounded;
  s.groundSlope = onTerrain ? zone.ground.slopeAt(pos.x, pos.z) : 0;

  // Deep water floats you; walking out where it gets shallow.
  const floatY = zone.waterLevel - p.swimDepth;
  if (floor < floatY && pos.y <= floatY + SKIN) {
    pos.y = floatY;
    s.velocity.y = 0;
    s.swimming = true;
    s.grounded = false;
    s.crouching = false;
    return;
  }
  s.swimming = false;

  if (pos.y <= floor) {
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
