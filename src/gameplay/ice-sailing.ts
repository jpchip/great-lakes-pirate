import { msToKnots } from '../core/coords';
import { closesHull, hullInIce, stopCmFor, type IceSample } from '../sim/ice/ice';
import { damageHullBy, type HazardEvent } from '../sim/sailing/hazards';
import type { Entity, GameWorld } from './ecs';

/**
 * Ice under a hull (plan 02 §5.2, plan 04 §8.2; plan 11 §18.4 piece K), run after the
 * hazards each tick on every sailing ship with a hull to lose:
 *
 * - **Drag.** Ice she's making way through sets the controller's `iceFactor` for her
 *   next step: thin, broken or loose ice slows her, thick ice nearly stops her.
 * - **Damage.** Forcing ice grinds the planking: hull HP a second for each knot over a
 *   walking pace, more in thicker and closer ice. Floes at ice-out knock at her too.
 * - **Stopped.** Ice closed over its water and thicker than she can break (8 cm for a
 *   plain hull, 20 with the ice bow) won't let her bow in: she stops at its edge and can
 *   only turn and go back. Ice that closes round her where she lies holds her: beset.
 *
 * The ice bow (plan 10 §5.1) takes 70% off the damage and 40% off the drag.
 */
export interface IceSailingDeps {
  /** The ice at a zone point now. */
  sample(x: number, z: number): IceSample;
  /** The ship carries the ice bow. */
  iceBow(e: Entity): boolean;
  onEvent?(e: Entity, ev: IceEvent): void;
}

export type IceEvent =
  | { kind: 'stopped'; thicknessCm: number }
  | { kind: 'grinding'; damage: number }
  | { kind: 'hazard'; event: HazardEvent };

/** Bow's distance ahead of the ship's center, as a share of her length. */
const BOW = 0.45;
/** A second between "stopped by the ice" reports. */
const REPORT_S = 4;

const lastReport = new WeakMap<Entity, number>();
const hazardEvents: HazardEvent[] = [];

export function iceSailingSystem(world: GameWorld, deps: IceSailingDeps, dt: number, now: number): void {
  for (const e of world.with('transform', 'previousTransform', 'sailing', 'hazards')) {
    const s = e.sailing.state;
    const h = e.hazards.state;
    if (h.mooring === 'docked') {
      s.iceFactor = 1;
      continue;
    }
    const bow = deps.iceBow(e);
    const here = deps.sample(s.x, s.z);
    const len = e.hazards.cls.lengthM * BOW;
    const fx = Math.sin(s.heading);
    const fz = -Math.cos(s.heading);
    const ahead = s.speed >= 0 ? 1 : -1;
    const bowIce = deps.sample(s.x + fx * len * ahead, s.z + fz * len * ahead);
    const stopCm = stopCmFor(bow);

    if (closesHull(bowIce, stopCm) && Math.abs(s.speed) > 0) {
      // Back where she was this tick, and no way on: the ice won't take her bow.
      const prev = e.previousTransform;
      const was = deps.sample(
        prev.position.x + fx * len * ahead,
        prev.position.z + fz * len * ahead,
      );
      if (!closesHull(was, stopCm) || bowIce.thicknessCm >= was.thicknessCm) {
        s.x = prev.position.x;
        s.z = prev.position.z;
        e.transform.position.x = s.x;
        e.transform.position.z = s.z;
        s.speed = 0;
        const last = lastReport.get(e) ?? -Infinity;
        if (now - last >= REPORT_S) {
          lastReport.set(e, now);
          deps.onEvent?.(e, { kind: 'stopped', thicknessCm: bowIce.thicknessCm });
        }
      }
    }

    const worst = here.thicknessCm >= bowIce.thicknessCm ? here : bowIce;
    const effect = hullInIce(worst, bow);
    s.iceFactor = Math.max(0.05, effect.drag);
    const over = msToKnots(Math.abs(s.speed)) - effect.fromKn;
    if (effect.damagePerKn > 0 && over > 0 && !h.foundering) {
      const damage = effect.damagePerKn * over * dt;
      hazardEvents.length = 0;
      damageHullBy(h, damage, hazardEvents);
      deps.onEvent?.(e, { kind: 'grinding', damage });
      for (const ev of hazardEvents) deps.onEvent?.(e, { kind: 'hazard', event: ev });
    }
  }
}
