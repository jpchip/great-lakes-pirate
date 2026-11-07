import { KNOT_MS, type Chart, type ChartProjection } from '../../core/coords';
import type { RouteNode } from '../../../data/schemas/routes';
import { bearing, distance, lerpChart } from './geography';
import type { Contact } from './traffic';

/**
 * Where the law's ships are on the chart (plan 06 §5.1; Phase 5 piece C). The traffic's
 * ships follow timetables that are a pure function of the seed and the clock; the
 * *Morrill* and the tier-5 tug don't, because where they go depends on Wanted. Each sails
 * one **leg** at a time along a route lane, then lies at its end; the planner
 * (`sim/law/patrol.ts`) chooses the next leg when that one is done and the leg is saved.
 * This module only turns a leg and the clock into a place, so it has no law in it.
 */

/** Why she's sailing this leg (for the dev overlay, the papers and the rumors). */
export type LegPurpose =
  'beat' | 'return' | 'transfer' | 'coal' | 'shelter' | 'away' | 'winter' | 'lie';

/** One leg: along `lane` from `fromM` to `toM` (meters from the lane's `from` end). */
export interface PatrolLeg {
  lane: string;
  fromM: number;
  toM: number;
  /** Game seconds she gets under way (she lies at `fromM` until then). */
  departAt: number;
  /** Game seconds she lies at `toM` after arriving. */
  lieS: number;
  purpose: LegPurpose;
}

/** A lane as the law's ships sail it: its polyline in chart meters and its end nodes. */
export interface PatrolLane {
  id: string;
  points: Chart[];
  cumM: number[];
  lengthM: number;
  from: RouteNode;
  to: RouteNode;
}

export type PatrolLanes = ReadonlyMap<string, PatrolLane>;

export function patrolLanes(
  projection: ChartProjection,
  lanes: readonly { id: string; from: string; to: string; via: [number, number][] }[],
  nodes: ReadonlyMap<string, RouteNode>,
): Map<string, PatrolLane> {
  const out = new Map<string, PatrolLane>();
  const toChart = ([lon, lat]: [number, number]): Chart => projection.geoToChart({ lat, lon });
  for (const lane of lanes) {
    const from = nodes.get(lane.from);
    const to = nodes.get(lane.to);
    if (!from || !to) continue;
    const points = [from.at, ...lane.via, to.at].map(toChart);
    const cumM = [0];
    for (let i = 1; i < points.length; i++) {
      cumM.push((cumM[i - 1] as number) + distance(points[i - 1] as Chart, points[i] as Chart));
    }
    out.set(lane.id, {
      id: lane.id,
      points,
      cumM,
      lengthM: cumM[cumM.length - 1] as number,
      from,
      to,
    });
  }
  return out;
}

/** Game seconds a leg's passage takes at `speedKn`. */
export function legTransitS(leg: PatrolLeg, speedKn: number): number {
  return Math.abs(leg.toM - leg.fromM) / (speedKn * KNOT_MS);
}

export function legArriveAt(leg: PatrolLeg, speedKn: number): number {
  return leg.departAt + legTransitS(leg, speedKn);
}

/** When she's done lying at the end of the leg and wants her next orders. */
export function legDoneAt(leg: PatrolLeg, speedKn: number): number {
  return legArriveAt(leg, speedKn) + leg.lieS;
}

/** Meters along the lane she is at `t`. */
export function legAlongM(leg: PatrolLeg, speedKn: number, t: number): number {
  if (t <= leg.departAt) return leg.fromM;
  const run = (t - leg.departAt) * speedKn * KNOT_MS;
  const span = leg.toM - leg.fromM;
  return Math.abs(span) <= run ? leg.toM : leg.fromM + Math.sign(span) * run;
}

/** Under way at `t` (not lying at either end). */
export function legUnderWay(leg: PatrolLeg, speedKn: number, t: number): boolean {
  return leg.toM !== leg.fromM && t > leg.departAt && t < legArriveAt(leg, speedKn);
}

/** The node she lies at when `along` is an end of the lane, else undefined. */
export function nodeAt(lane: PatrolLane, along: number): RouteNode | undefined {
  if (along <= 0.5) return lane.from;
  if (along >= lane.lengthM - 0.5) return lane.to;
  return undefined;
}

/** A point `along` meters down a lane, with the leg it's on and the progress along that leg. */
export function pointAlong(
  lane: PatrolLane,
  along: number,
): { pos: Chart; leg: number; progressM: number } {
  const a = Math.min(Math.max(along, 0), lane.lengthM);
  const last = lane.points.length - 2;
  for (let i = 0; i <= last; i++) {
    const end = lane.cumM[i + 1] as number;
    if (a <= end || i === last) {
      const start = lane.cumM[i] as number;
      const len = end - start;
      const p = lane.points[i] as Chart;
      const q = lane.points[i + 1] as Chart;
      return {
        pos: lerpChart(p, q, len > 0 ? (a - start) / len : 0),
        leg: i,
        progressM: a - start,
      };
    }
  }
  return { pos: { ...(lane.points[0] as Chart) }, leg: 0, progressM: 0 };
}

/** A contact sailed by the law's planner: its leg and speed (the planner keeps it current). */
export interface PatrolRef {
  lanes: PatrolLanes;
  /** The leg she's on (shared with the save: the planner writes it). */
  leg: PatrolLeg | undefined;
  speedKn: number;
  /** Off the chart entirely (the tug before she's chartered, or after). */
  absent?: boolean;
}

/** Puts a planner-sailed contact where her leg has her at `t`. */
export function placePatrol(c: Contact, t: number): void {
  const p = c.patrol;
  const leg = p?.leg;
  const lane = leg && p.lanes.get(leg.lane);
  if (!p || !leg || !lane || p.absent) {
    c.inPort = true;
    c.underWay = false;
    return;
  }
  const along = legAlongM(leg, p.speedKn, t);
  const at = pointAlong(lane, along);
  const forward = leg.toM >= leg.fromM;
  const a = lane.points[at.leg] as Chart;
  const b = lane.points[at.leg + 1] as Chart;
  c.pos = at.pos;
  c.heading = forward ? bearing(a, b) : bearing(b, a);
  c.underWay = legUnderWay(leg, p.speedKn, t);
  const node = c.underWay ? undefined : nodeAt(lane, along);
  // Lying in port (or off the chart in the lower lakes), she isn't on the water to be seen.
  c.inPort = node?.role === 'port' || node?.role === 'sink';
  c.lane = { points: lane.points, leg: at.leg, progressM: at.progressM, forward };
}
