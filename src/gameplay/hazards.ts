import {
  applyJibe,
  stepHazards,
  type HazardClass,
  type HazardEnv,
  type HazardEvent,
  type HazardState,
  type MooringCommand,
} from '../sim/sailing/hazards';
import type { SceneScale } from '../sim/sailing/controller';
import type { Entity, GameWorld } from './ecs';
import type { WindSampler } from './sailing';

/** A sailing ship's damage, strain, ground, anchor and berth (plan 02 §6–7). */
export interface ShipHazards {
  /** Shared per class; the dev panel swaps in a rebuilt one. */
  cls: HazardClass;
  state: HazardState;
}

const events: HazardEvent[] = [];

/**
 * Run right after the sailing system, before buoyancy: corrects where each ship sailed
 * to for ground, rock, piers, its anchor and its berth, and applies damage and strain.
 * `previousTransform` (this tick's snapshot) is where a grounded ship stays.
 */
export function hazardSystem(
  world: GameWorld,
  commandFor: (e: Entity) => MooringCommand,
  env: HazardEnv,
  windAt: WindSampler,
  scale: SceneScale,
  dt: number,
  onEvent?: (e: Entity, event: HazardEvent) => void,
): void {
  for (const e of world.with('transform', 'previousTransform', 'sailing', 'hazards')) {
    const s = e.sailing.state;
    const prev = e.previousTransform;
    const pose = { x: prev.position.x, z: prev.position.z, heading: prev.heading };
    events.length = 0;
    stepHazards(
      s,
      e.hazards.state,
      e.hazards.cls,
      commandFor(e),
      env,
      pose,
      windAt(s.x, s.z),
      scale,
      dt,
      events,
    );
    e.transform.position.x = s.x;
    e.transform.position.z = s.z;
    e.transform.heading = s.heading;
    if (onEvent) for (const ev of events) onEvent(e, ev);
  }
}

/** The controller's jibe events feed rigging damage (plan 02 §4). */
export function onShipJibed(e: Entity, uncontrolled: boolean): void {
  if (e.hazards) applyJibe(e.hazards.state, e.hazards.cls, uncontrolled);
}
