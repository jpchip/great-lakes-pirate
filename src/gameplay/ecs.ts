import { World } from 'miniplex';

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
}

export interface Entity {
  /** Stable WorldState id this entity materializes, e.g. "ship.player". */
  id?: string;
  transform?: Transform;
  /** Transform at the previous tick, for render interpolation. */
  previousTransform?: Transform;
  velocity?: Vec3;
  /** Placeholder bobbing until buoyancy lands (plan 02). */
  bob?: { amplitude: number; frequency: number; phase: number };
  /** Which model render/ draws for this entity; render/ owns the three.js objects. */
  model?: 'schooner';
  playerControlled?: true;
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
}

export function cloneTransform(t: Transform): Transform {
  return { position: { ...t.position }, heading: t.heading };
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
  return out;
}
