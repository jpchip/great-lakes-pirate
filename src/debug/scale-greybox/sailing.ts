import { sceneSpeed } from '../../core/coords';
import {
  createSailingState,
  FULL_SAIL,
  updateTargetSpeed,
  type SailingWind,
  type SceneScale,
} from '../../sim/sailing/controller';
import { sampleCurve } from '../../sim/sailing/curve';
import type { HazardTerrain } from '../../sim/sailing/hazards';
import type { SailingClass } from '../../sim/sailing/ship-class';

/**
 * Spike S7 on the plan 02 sailing model: a steady test wind, the greybox heightfield
 * as hazard terrain, and the readouts the HUD shows (beam-reach speed, turning circle).
 * Speeds are game m/s; the ship moves at v₃ᴅ = v × R / C.
 */

/** A steady breeze with no gusts; the greybox has no weather. */
export function steadyWind(fromDeg: number, speedKn: number): SailingWind {
  return { fromRad: (fromDeg * Math.PI) / 180, speedKn, gust01: 0 };
}

/** The greybox heightfield (lake = 0, water negative) as water depth for the hazards. */
export function greyboxDepth(heightAt: (x: number, z: number) => number): HazardTerrain {
  return { depthAt: (x, z) => Math.max(0, -heightAt(x, z)) };
}

/** Target speed at Full sail on a beam reach in `wind`, game m/s, with no head sea. */
export function beamReachSpeed(cls: SailingClass, wind: SailingWind): number {
  const s = createSailingState(0, 0, wind.fromRad + Math.PI / 2);
  s.sailSetting = FULL_SAIL;
  return updateTargetSpeed(s, cls, wind, 0);
}

/** Turning-circle diameter in zone meters at full rudder (Infinity when stopped). */
export function turningCircle(cls: SailingClass, speed: number, scale: SceneScale): number {
  const omega = sampleCurve(cls.turnRate, Math.abs(speed));
  const v = Math.abs(sceneSpeed(speed, scale.rate, scale.compression));
  return v > 0 && omega > 0 ? (2 * v) / omega : Infinity;
}
