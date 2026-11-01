import { METERS_PER_NAUTICAL_MILE, type Chart, type ChartProjection } from '../../core/coords';
import type { Rng } from '../../core/rng';
import { laneLonLats, seasonBusyness, westernSuperiorRoutes, type RouteGraph } from './routes';
import type { PlannedCourse } from './voyage';

/**
 * The encounter director (plan 03 §6.4, S8 finding 2; Phase 3 piece F). The lookouts
 * still see real ships, but how many sightings interrupt a voyage is a budget set when
 * the ship sails: longer courses down busy lanes in a busy month get more, a short hop
 * across empty water fewer. Once it's spent, only threats are reported, and a hostile
 * that closes always interrupts. The S8 pacing guard (a quiet spell after each report)
 * still spaces them out.
 */

/** Expected meaningful encounters per nautical mile of course on a busy lane in a busy month. */
export const ENCOUNTERS_PER_NM = 0.065;
/** Never more than this many reports a voyage, however long. */
export const MAX_BUDGET = 3;
/** A course point this close to a trade lane counts as on it, meters (the day lookout range). */
export const LANE_NEAR_M = 6 * METERS_PER_NAUTICAL_MILE;
/** Off the lanes there's still a little traffic: this share of the on-lane rate. */
export const OFF_LANE_SHARE = 0.35;
/** In the quietest sailing month the budget keeps this share of the busiest's. */
export const QUIET_SEASON_SHARE = 0.15;

export interface LaneLines {
  /** Each trade lane's polyline, chart meters. */
  lines: Chart[][];
}

/** The trade lanes as chart polylines (fishing tugs and the patrol don't make a route busy). */
export function tradeLaneLines(
  projection: ChartProjection,
  graph: RouteGraph = westernSuperiorRoutes(),
): LaneLines {
  return {
    lines: graph.lanes
      .filter((lane) => lane.use === 'trade')
      .map((lane) =>
        laneLonLats(graph, lane).map(([lon, lat]) => projection.geoToChart({ lat, lon })),
      ),
  };
}

function segmentDistance(p: Chart, a: Chart, b: Chart): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  const t = len2 > 0 ? Math.min(Math.max(((p.x - a.x) * dx + (p.y - a.y) * dy) / len2, 0), 1) : 0;
  return Math.hypot(p.x - (a.x + dx * t), p.y - (a.y + dy * t));
}

/** Share of the course, 0–1, that runs within `LANE_NEAR_M` of a trade lane. */
export function laneShare(course: PlannedCourse, lanes: LaneLines): number {
  let near = 0;
  let total = 0;
  for (const leg of course.legs) {
    const steps = Math.max(Math.ceil(leg.lengthM / METERS_PER_NAUTICAL_MILE), 1);
    for (let i = 0; i < steps; i++) {
      const t = (i + 0.5) / steps;
      const p = {
        x: leg.from.x + (leg.to.x - leg.from.x) * t,
        y: leg.from.y + (leg.to.y - leg.from.y) * t,
      };
      total++;
      const onLane = lanes.lines.some((line) => {
        for (let j = 1; j < line.length; j++) {
          if (segmentDistance(p, line[j - 1] as Chart, line[j] as Chart) <= LANE_NEAR_M)
            return true;
        }
        return false;
      });
      if (onLane) near++;
    }
  }
  return total > 0 ? near / total : 0;
}

/** The expected number of meaningful encounters for a course in a month (before rounding). */
export function expectedEncounters(
  course: PlannedCourse,
  month: number,
  lanes: LaneLines,
  graph: RouteGraph = westernSuperiorRoutes(),
): number {
  const lengthNm = course.lengthM / METERS_PER_NAUTICAL_MILE;
  const route = OFF_LANE_SHARE + (1 - OFF_LANE_SHARE) * laneShare(course, lanes);
  const busiest = Math.max(...Array.from({ length: 12 }, (_, m) => seasonBusyness(m, graph)), 1e-6);
  const season = seasonBusyness(month, graph) / busiest;
  // Winter (nothing sailing) gives no budget at all.
  const seasonal = season > 0 ? QUIET_SEASON_SHARE + (1 - QUIET_SEASON_SHARE) * season : 0;
  return ENCOUNTERS_PER_NM * lengthNm * route * seasonal;
}

/**
 * The voyage's budget: the expected count rounded up or down at random in proportion
 * (2.3 is 2 seven times in ten and 3 the rest), capped at `MAX_BUDGET`.
 */
export function encounterBudget(expected: number, rng: Rng): number {
  const whole = Math.floor(expected);
  const budget = whole + (rng.chance(expected - whole) ? 1 : 0);
  return Math.min(budget, MAX_BUDGET);
}
