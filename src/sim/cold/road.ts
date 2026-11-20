import { calendarMs, winterDay, winterOf } from '../ice/season';
import { COLD } from './footing';

/**
 * Snow on the ground and the ice road (plan 04 §8.2; Phase 9 piece M).
 *
 * **Snow lies** once the winter's air has kept below freezing for a few days running, and
 * goes in a thaw of a few days above it: a pure function of the run's seed and the date
 * (piece K's winters), so the tracks, the footsteps and piece L's look agree on it.
 *
 * **The ice road** runs between two piers (Bayfield's city dock and La Pointe's village
 * dock), straight across the channel ice, marked with evergreen boughs. It's open while the
 * ice along it is thick enough (`openCm`); its marked lane has no weak spots.
 */

const SNOW_DAYS = 5;

/** Snow lies on the ground at a game time. */
export function snowLies(seed: string, gameSeconds: number): boolean {
  const wd = winterDay(calendarMs(gameSeconds));
  if (!wd) return false;
  const w = winterOf(seed, wd.year);
  const day = Math.floor(wd.day);
  // Walk back through the winter: the last run of SNOW_DAYS cold or warm days decides.
  let cold = 0;
  let warm = 0;
  for (let d = Math.min(day, w.airC.length - 1); d >= 0; d--) {
    const a = w.airC[d] ?? 0;
    if (a < -1) {
      cold++;
      warm = 0;
    } else if (a > 1) {
      warm++;
      cold = 0;
    }
    if (cold >= SNOW_DAYS) return true;
    if (warm >= SNOW_DAYS) return false;
  }
  return false;
}

export interface XZ {
  x: number;
  z: number;
}

/** The road laid between its two ends, zone meters. */
export interface IceRoad {
  from: XZ;
  to: XZ;
  lengthM: number;
  /** The boughs along it, end to end. */
  markers: XZ[];
}

export function layRoad(from: XZ, to: XZ): IceRoad {
  const lengthM = Math.hypot(to.x - from.x, to.z - from.z);
  const n = Math.max(1, Math.round(lengthM / COLD.road.markerM));
  const markers: XZ[] = [];
  for (let k = 0; k <= n; k++) {
    const t = k / n;
    // Alternate sides of the lane, a couple of meters out.
    const side = k % 2 ? 2 : -2;
    const ux = (to.x - from.x) / (lengthM || 1);
    const uz = (to.z - from.z) / (lengthM || 1);
    markers.push({
      x: from.x + (to.x - from.x) * t - uz * side,
      z: from.z + (to.z - from.z) * t + ux * side,
    });
  }
  return { from, to, lengthM, markers };
}

/** Distance from a point to the road's lane, m, and how far along it (0 … 1). */
export function roadDistance(road: IceRoad, p: XZ): { d: number; t: number } {
  const dx = road.to.x - road.from.x;
  const dz = road.to.z - road.from.z;
  const l2 = dx * dx + dz * dz || 1;
  const t = Math.max(0, Math.min(1, ((p.x - road.from.x) * dx + (p.z - road.from.z) * dz) / l2));
  const x = road.from.x + dx * t;
  const z = road.from.z + dz * t;
  return { d: Math.hypot(p.x - x, p.z - z), t };
}

/** The road's open: the thinnest ice along it (sampled `samples` times) is thick enough. */
export function roadOpen(road: IceRoad, thicknessAt: (p: XZ) => number, samples = 12): boolean {
  return thinnestOnRoad(road, thicknessAt, samples) >= COLD.road.openCm;
}

export function thinnestOnRoad(
  road: IceRoad,
  thicknessAt: (p: XZ) => number,
  samples = 12,
): number {
  let min = Infinity;
  for (let k = 0; k <= samples; k++) {
    const t = k / samples;
    min = Math.min(
      min,
      thicknessAt({
        x: road.from.x + (road.to.x - road.from.x) * t,
        z: road.from.z + (road.to.z - road.from.z) * t,
      }),
    );
  }
  return min;
}
