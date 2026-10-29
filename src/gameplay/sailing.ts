import {
  headSeaAmplitude,
  stepSailing,
  type SailingCommand,
  type SailingEvent,
  type SailingState,
  type SailingWind,
  type SceneScale,
} from '../sim/sailing/controller';
import type { SailingClass } from '../sim/sailing/ship-class';
import type { Sea } from '../sim/weather/waves';
import { holdInside } from '../sim/terrain/zone-edge';
import type { TerrainBounds } from '../sim/terrain/zone-terrain';
import type { Entity, GameWorld } from './ecs';

/** A ship sailing under the plan 02 model: its class and its live state. */
export interface SailingShip {
  /** Shared per class; the tuning panel swaps in a rebuilt one. */
  cls: SailingClass;
  state: SailingState;
}

/** The wind at a zone point (plan 02 §11); the weather system provides it. */
export type WindSampler = (x: number, z: number) => SailingWind;

/** The local wave-height multiplier at a zone point: 1 in open water, less in a lee. */
export type SeaScaleSampler = (x: number, z: number) => number;

const events: SailingEvent[] = [];

/**
 * Steps every sailing ship and writes its position and heading to the transform. Run
 * before buoyancy, which then floats the ship where it ended up. `commandFor` gives
 * each ship's helm orders (the keyboard for the player; AI later).
 */
export function sailingSystem(
  world: GameWorld,
  commandFor: (e: Entity) => SailingCommand,
  windAt: WindSampler,
  sea: Sea,
  scale: SceneScale,
  dt: number,
  onEvent?: (e: Entity, event: SailingEvent) => void,
  seaScaleAt: SeaScaleSampler = () => 1,
): void {
  for (const e of world.with('transform', 'sailing')) {
    const { state: s, cls } = e.sailing;
    const headSea = headSeaAmplitude(sea.waves, s.heading, seaScaleAt(s.x, s.z));
    events.length = 0;
    stepSailing(s, commandFor(e), cls, windAt(s.x, s.z), headSea, scale, dt, events);
    e.transform.position.x = s.x;
    e.transform.position.z = s.z;
    e.transform.heading = s.heading;
    if (onEvent) for (const ev of events) onEvent(e, ev);
  }
}

/** Run after buoyancy: lean each sailing ship over by its heel (plan 02 §5.1). */
export function heelSystem(world: GameWorld): void {
  for (const { transform, sailing } of world.with('transform', 'sailing')) {
    transform.roll = (transform.roll ?? 0) + sailing.state.heel;
  }
}

/**
 * Holds every sailing ship inside the zone's terrain (plan 03 §4): the one invisible
 * wall, at the very edge past the fog. Run after the hazards, which can move ships too.
 */
export function zoneEdgeSystem(world: GameWorld, bounds: TerrainBounds): void {
  for (const e of world.with('transform', 'sailing')) {
    const s = e.sailing.state;
    if (!holdInside(bounds, s)) continue;
    e.transform.position.x = s.x;
    e.transform.position.z = s.z;
  }
}
