import { World } from 'miniplex';
import type { Buoyancy } from './buoyancy';
import type { ShipHazards } from './hazards';
import type { SailingShip } from './sailing';

/**
 * Materialized entities in the active zone (plan 01 §3.4), managed with miniplex.
 * Entities are plain objects; components are optional properties. Anything that must
 * persist is written back to WorldState before saving (plan 16 §5.3), so nothing here
 * is serialized directly.
 *
 * Positions are zone coordinates in meters (core/coords): x east, y up, z south.
 */

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export interface Transform {
  position: Vec3;
  /** Radians, clockwise from north (compass convention). */
  heading: number;
  /** Radians, bow up. Set by buoyancy; absent means level. */
  pitch?: number;
  /** Radians, starboard side up. Set by buoyancy; absent means level. */
  roll?: number;
}

export interface Entity {
  /** Stable WorldState id this entity materializes, e.g. "ship.player". */
  id?: string;
  transform?: Transform;
  /** Transform at the previous tick, for render interpolation. */
  previousTransform?: Transform;
  velocity?: Vec3;
  /** Simple sine bobbing for floating props that don't need buoyancy. */
  bob?: { amplitude: number; frequency: number; phase: number };
  /** Hull sampling on the shared wave set (plan 02 §5.1); see gameplay/buoyancy. */
  buoyancy?: Buoyancy;
  /** The plan 02 sailing model; see gameplay/sailing. */
  sailing?: SailingShip;
  /** Damage, strain, grounding, anchor and berth (plan 02 §6–7); see gameplay/hazards. */
  hazards?: ShipHazards;
  /** Which model render/ draws for this entity; render/ owns the three.js objects. */
  model?: 'schooner' | 'npc';
  /** A traffic ship (plan 03 §6; Phase 3 piece H): its ships.json class, steaming on. */
  npc?: NpcShip;
  playerControlled?: true;
}

/** An NPC ship holding a course: no helm yet (piece G steers them in the arenas). */
export interface NpcShip {
  /** ships.json id. */
  classId: string;
  /** Speed through the water, game knots. */
  speedKn: number;
}

export type GameWorld = World<Entity>;

export function createGameWorld(): GameWorld {
  return new World<Entity>();
}

function copyTransform(from: Transform, to: Transform): void {
  to.position.x = from.position.x;
  to.position.y = from.position.y;
  to.position.z = from.position.z;
  to.heading = from.heading;
  if (from.pitch !== undefined) to.pitch = from.pitch;
  if (from.roll !== undefined) to.roll = from.roll;
}

export function cloneTransform(t: Transform): Transform {
  const out: Transform = { position: { ...t.position }, heading: t.heading };
  if (t.pitch !== undefined) out.pitch = t.pitch;
  if (t.roll !== undefined) out.roll = t.roll;
  return out;
}

/** Run first in every tick: remember where interpolated entities were. */
export function snapshotTransforms(world: GameWorld): void {
  for (const e of world.with('transform', 'previousTransform')) {
    copyTransform(e.transform, e.previousTransform);
  }
}

export function velocitySystem(world: GameWorld, dt: number): void {
  for (const { transform, velocity } of world.with('transform', 'velocity')) {
    transform.position.x += velocity.x * dt;
    transform.position.y += velocity.y * dt;
    transform.position.z += velocity.z * dt;
  }
}

export function bobSystem(world: GameWorld, timeSeconds: number): void {
  for (const { transform, bob } of world.with('transform', 'bob')) {
    transform.position.y =
      bob.amplitude * Math.sin(timeSeconds * bob.frequency * 2 * Math.PI + bob.phase);
  }
}

function lerpAngle(a: number, b: number, t: number): number {
  const d = Math.atan2(Math.sin(b - a), Math.cos(b - a));
  return a + d * t;
}

/** The transform to draw this frame, between the previous and current tick. */
export function interpolateTransform(e: Entity, alpha: number, out: Transform): Transform {
  const cur = e.transform;
  if (!cur) throw new Error('Entity has no transform');
  const prev = e.previousTransform ?? cur;
  out.position.x = prev.position.x + (cur.position.x - prev.position.x) * alpha;
  out.position.y = prev.position.y + (cur.position.y - prev.position.y) * alpha;
  out.position.z = prev.position.z + (cur.position.z - prev.position.z) * alpha;
  out.heading = lerpAngle(prev.heading, cur.heading, alpha);
  const pitch = cur.pitch ?? 0;
  const roll = cur.roll ?? 0;
  out.pitch = (prev.pitch ?? pitch) + (pitch - (prev.pitch ?? pitch)) * alpha;
  out.roll = (prev.roll ?? roll) + (roll - (prev.roll ?? roll)) * alpha;
  return out;
}
