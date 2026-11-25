import { calendarMs, winterDay, winterOf } from '../ice/season';
import type { IceSample } from '../ice/season';
import { COLD, iceUnderfoot } from './footing';

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

/**
 * Ice that will carry the road at a point: there to stand on, and `openCm` thick or more.
 * Every point along the road has to say so for it to be marked.
 */
export function carriesRoad(s: IceSample): boolean {
  return iceUnderfoot(s) && s.thicknessCm >= COLD.road.openCm;
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

/** Centimeters as a man on the shore would say them: whole inches. */
const inches = (cm: number): number => Math.round(cm / 2.54);

/**
 * What the harbor master says of the ice road at either of its ports (piece M): marked and
 * open, not yet (with how thick the channel ice has got, and what they mark it at), or
 * closed for the spring. Nothing at other ports, or with no ice in the channel.
 */
export function iceRoadWord(port: string, open: boolean, thinnestCm: number): string | undefined {
  const { fromPort, toPort, openCm } = COLD.road;
  if (port !== fromPort && port !== toPort) return undefined;
  const near = port === fromPort;
  const other = near ? 'La Pointe' : 'Bayfield';
  if (open) {
    return near
      ? `The ice road to ${other} is marked. Go down the ladder at the end of the city dock.`
      : `The ice road to ${other} is marked across the channel.`;
  }
  if (thinnestCm < 1) return undefined;
  if (thinnestCm >= openCm) {
    return `The ice road to ${other} is closed. The channel ice has gone rotten.`;
  }
  return `No ice road to ${other} yet. The channel ice is about ${Math.max(1, inches(thinnestCm))} in.; they mark the road at ${inches(openCm)}.`;
}
