import { KNOT_MS, type Chart } from '../../core/coords';
import {
  bearing,
  distance,
  firstLandHit,
  lerpChart,
  rectEntry,
  zoneAt,
  type ChartGeography,
  type ChartZone,
} from './geography';

/**
 * Course plotting and voyage simulation on the chart (plan 03 §5.3). Positions are
 * chart meters; speeds are game knots; time is game seconds.
 */

/** Chart wind: where it blows from (radians clockwise from north) and its strength. */
export interface ChartWind {
  from: number;
  speedKn: number;
}

/** The ship stats the chart needs. Upgrades, damage and cargo scale `cruiseKn` later. */
export interface ChartShip {
  /** Speed on a beam reach in a working breeze (plan 03 §3.3: schooner 7–8 kn). */
  cruiseKn: number;
}

export const PROTOTYPE_SCHOONER: ChartShip = { cruiseKn: 7.5 };

/**
 * Speed multiplier by true wind angle (0 = head to wind). Close-hauled and dead-upwind
 * values are the made-good speed along the course, so tacking is folded in rather
 * than drawn. A schooner is fastest on a beam reach.
 */
const POINT_OF_SAIL: readonly [deg: number, factor: number][] = [
  [0, 0.42],
  [35, 0.45],
  [50, 0.72],
  [75, 0.98],
  [100, 1],
  [140, 0.92],
  [180, 0.78],
];

/** Speed multiplier by wind strength: calm drifts, a fresh breeze is best, gales reef. */
const WIND_STRENGTH: readonly [kn: number, factor: number][] = [
  [0, 0.12],
  [4, 0.45],
  [10, 0.9],
  [16, 1.08],
  [24, 1.1],
  [34, 0.85],
];

function interpolate(table: readonly (readonly [number, number])[], x: number): number {
  const first = table[0] as readonly [number, number];
  if (x <= first[0]) return first[1];
  for (let i = 1; i < table.length; i++) {
    const [x1, y1] = table[i] as readonly [number, number];
    const [x0, y0] = table[i - 1] as readonly [number, number];
    if (x <= x1) return y0 + ((y1 - y0) * (x - x0)) / (x1 - x0);
  }
  return (table.at(-1) as readonly [number, number])[1];
}

/** True wind angle for a heading, 0–π. */
export function trueWindAngle(heading: number, wind: ChartWind): number {
  const tau = 2 * Math.PI;
  return Math.abs(((((heading - wind.from) % tau) + tau + Math.PI) % tau) - Math.PI);
}

export function pointOfSailFactor(twa: number): number {
  return interpolate(POINT_OF_SAIL, (twa * 180) / Math.PI);
}

export function windStrengthFactor(speedKn: number): number {
  return interpolate(WIND_STRENGTH, speedKn);
}

/** Game speed in knots on `heading`. */
export function chartSpeedKn(heading: number, wind: ChartWind, ship: ChartShip): number {
  return (
    ship.cruiseKn *
    pointOfSailFactor(trueWindAngle(heading, wind)) *
    windStrengthFactor(wind.speedKn)
  );
}

export interface CourseLeg {
  from: Chart;
  to: Chart;
  lengthM: number;
  heading: number;
  /** Fraction along the leg where it runs aground, if it does. */
  landAt?: number;
}

export type CourseProblem = 'tooShort' | 'aground' | 'insideDestination';

export interface PlannedCourse {
  /** The ship's position followed by the player's waypoints. */
  points: Chart[];
  /**
   * The part sailed on the chart: it stops where the course first enters the
   * destination's zone, because that zone loads and takes over from there (§5.3 step 5).
   */
  legs: CourseLeg[];
  /** Waypoints past the zone boundary, drawn but never sailed on the chart. */
  insideZone: Chart[];
  destinationZone: ChartZone | undefined;
  lengthM: number;
  problem: CourseProblem | undefined;
}

/**
 * Plan a course from the ship through `waypoints`. Each sailed leg is checked against
 * the land mask. The departure zone never counts as the destination zone, so a course
 * from Bayfield to Ashland is refused: that trip is sailed in 3D.
 */
export function planCourse(
  geo: ChartGeography,
  from: Chart,
  waypoints: readonly Chart[],
): PlannedCourse {
  const points = [from, ...waypoints];
  const last = points.at(-1) as Chart;
  const destinationZone = waypoints.length > 0 ? zoneAt(geo, last) : undefined;
  const legs: CourseLeg[] = [];
  const insideZone: Chart[] = [];
  let problem: CourseProblem | undefined;

  if (destinationZone && zoneAt(geo, from)?.id === destinationZone.id) {
    problem = 'insideDestination';
  }

  let reached = false;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1] as Chart;
    const b = points[i] as Chart;
    if (reached) {
      insideZone.push(b);
      continue;
    }
    let to = b;
    if (destinationZone && !problem) {
      const t = rectEntry(a, b, destinationZone);
      if (t !== undefined) {
        to = lerpChart(a, b, t);
        reached = true;
        insideZone.push(b);
      }
    }
    const leg: CourseLeg = { from: a, to, lengthM: distance(a, to), heading: bearing(a, to) };
    if (leg.lengthM > 0) {
      const hit = firstLandHit(geo, a, to);
      if (hit !== undefined) {
        leg.landAt = hit;
        problem ??= 'aground';
      }
      legs.push(leg);
    }
  }

  const lengthM = legs.reduce((sum, leg) => sum + leg.lengthM, 0);
  if (!problem && lengthM < 500) problem = 'tooShort';
  return { points, legs, insideZone, destinationZone, lengthM, problem };
}

/** Game seconds to sail the course if the wind holds. */
export function estimateSeconds(course: PlannedCourse, wind: ChartWind, ship: ChartShip): number {
  let seconds = 0;
  for (const leg of course.legs) {
    seconds += leg.lengthM / (chartSpeedKn(leg.heading, wind, ship) * KNOT_MS);
  }
  return seconds;
}

/** A voyage under way (plan 03 §9 `voyage` slice). */
export interface Voyage {
  legs: CourseLeg[];
  destinationZone: ChartZone | undefined;
  leg: number;
  /** Meters along the current leg. */
  progressM: number;
  position: Chart;
  heading: number;
  speedKn: number;
  startedAt: number;
  arrived: boolean;
}

export function startVoyage(course: PlannedCourse, startedAt: number): Voyage {
  const first = course.legs[0];
  if (!first || course.problem) throw new Error('Cannot sail an invalid course');
  return {
    legs: course.legs,
    destinationZone: course.destinationZone,
    leg: 0,
    progressM: 0,
    position: { ...first.from },
    heading: first.heading,
    speedKn: 0,
    startedAt,
    arrived: false,
  };
}

/** Advance the voyage by `gameSeconds` with the current wind. Leg turns carry over. */
export function stepVoyage(
  voyage: Voyage,
  gameSeconds: number,
  wind: ChartWind,
  ship: ChartShip,
): void {
  let remaining = gameSeconds;
  while (remaining > 0 && !voyage.arrived) {
    const leg = voyage.legs[voyage.leg] as CourseLeg;
    voyage.heading = leg.heading;
    voyage.speedKn = chartSpeedKn(leg.heading, wind, ship);
    const speed = voyage.speedKn * KNOT_MS;
    const left = leg.lengthM - voyage.progressM;
    const step = speed * remaining;
    if (step < left) {
      voyage.progressM += step;
      remaining = 0;
    } else {
      remaining -= left / speed;
      voyage.leg++;
      voyage.progressM = 0;
      if (voyage.leg >= voyage.legs.length) {
        voyage.leg = voyage.legs.length - 1;
        voyage.progressM = leg.lengthM;
        voyage.arrived = true;
      }
    }
    const current = voyage.legs[voyage.leg] as CourseLeg;
    voyage.position = lerpChart(
      current.from,
      current.to,
      current.lengthM > 0 ? voyage.progressM / current.lengthM : 1,
    );
  }
}

/** Meters still to sail. */
export function remainingM(voyage: Voyage): number {
  let left = 0;
  for (let i = voyage.leg; i < voyage.legs.length; i++)
    left += (voyage.legs[i] as CourseLeg).lengthM;
  return left - voyage.progressM;
}
