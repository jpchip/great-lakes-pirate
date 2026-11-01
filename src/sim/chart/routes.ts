import routesJson from '../../../data/routes.json';
import {
  routesFileSchema,
  type RouteFeature,
  type RouteLane,
  type RouteNode,
  type RoutePoi,
} from '../../../data/schemas/routes';
import type { ShipRecord } from '../../../data/schemas/ships';
import { KNOT_MS, type Chart, type ChartProjection } from '../../core/coords';
import { calendarDate } from '../../core/time';
import { SHIP_RECORDS } from '../sailing/ships';
import { bearing, distance, lerpChart } from './geography';
import type { Contact, ContactKind } from './traffic';

/**
 * Traffic on the route graph (plan 03 §6.1, plan 01 §3.4; Phase 3 piece F). Every ship
 * on the lake exists abstractly on a lane of `data/routes.json` as `{leg, progress}`, and
 * the lookouts check those real ships, not dice.
 *
 * A ship's place is a **pure function of the run's seed and the clock**: it sails its
 * lane out, lies at the far end, sails back and lies at home, on a cycle with its own
 * phase. At the start of each cycle the lane's monthly weight decides whether it sails
 * that cycle or stays laid up, so fall is busy and winter near empty. Nothing about the
 * traffic needs saving until Phase 4 gives ships cargo and damage: a reload, a zone or an
 * arena all find every ship where the clock says it is.
 */

export interface RouteGraph {
  nodes: ReadonlyMap<string, RouteNode>;
  lanes: readonly RouteLane[];
  pois: readonly RoutePoi[];
}

export function buildRouteGraph(features: readonly RouteFeature[]): RouteGraph {
  const nodes = new Map<string, RouteNode>();
  const lanes: RouteLane[] = [];
  const pois: RoutePoi[] = [];
  for (const f of features) {
    if (f.kind === 'node') nodes.set(f.id, f);
    else if (f.kind === 'lane') lanes.push(f);
    else pois.push(f);
  }
  for (const lane of lanes) {
    for (const id of [lane.from, lane.to]) {
      if (!nodes.has(id)) throw new Error(`${lane.id}: no node ${id}`);
    }
  }
  return { nodes, lanes, pois };
}

let cached: RouteGraph | undefined;

/** The validated western Superior route graph. Built once on first use. */
export function westernSuperiorRoutes(): RouteGraph {
  cached ??= buildRouteGraph(routesFileSchema.parse(routesJson));
  return cached;
}

/** A lane's whole polyline, `from` through the waypoints to `to`, as [lon, lat]. */
export function laneLonLats(graph: RouteGraph, lane: RouteLane): [number, number][] {
  const from = graph.nodes.get(lane.from) as RouteNode;
  const to = graph.nodes.get(lane.to) as RouteNode;
  return [from.at, ...lane.via, to.at];
}

/** The chart contact kind each ships.json class shows as. */
export const CLASS_KIND: Readonly<Record<string, Exclude<ContactKind, 'storm' | 'derelict'>>> = {
  'ship.ore_freighter': 'freighter',
  'ship.package_steamer': 'steamer',
  'ship.fish_tug': 'tug',
  'ship.cutter_morrill': 'cutter',
  'ship.schooner_barge': 'barge',
};

function shipRecord(id: string): ShipRecord {
  const record = SHIP_RECORDS.find((r) => r.id === id);
  if (!record) throw new Error(`No ship class ${id} in ships.json`);
  return record;
}

function classSpeedKn(record: ShipRecord): number {
  return record.propulsion === 'steam' ? record.engineSpeedKn : record.hullMaxSpeedKn;
}

/** cyrb53-style string hash to [0, 1): a stable per-ship, per-cycle draw. */
export function hash01(key: string): number {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < key.length; i++) {
    const ch = key.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return ((h2 >>> 0) * 2 ** 21 + (h1 >>> 11)) / 2 ** 53;
}

/** The calendar month (0 = January) a game time falls in. */
export function monthAt(gameSeconds: number): number {
  return calendarDate(Math.max(gameSeconds, 0)).getUTCMonth();
}

/** A ship's timetable on its lane: what `placeTraffic` evaluates at any game time. */
export interface LaneSchedule {
  laneId: string;
  /** The lane polyline in chart meters, from the ship's home end. */
  points: Chart[];
  /** Cumulative meters at each point. */
  cumM: number[];
  lengthM: number;
  speedMs: number;
  /** Game seconds lying at home (the first point) and at the far end. */
  dwellHomeS: number;
  dwellAwayS: number;
  /** Game seconds added to the clock so each ship is at its own point of the cycle. */
  phaseS: number;
  /** Visible while lying at each end: only fishing grounds and turning marks are. */
  seenAtHome: boolean;
  seenAway: boolean;
  season: readonly number[];
  /** Hash key for the per-cycle sailing draw. */
  key: string;
}

/** One cycle's length: out, lie away, back, lie at home. */
export function cycleS(s: LaneSchedule): number {
  return (2 * s.lengthM) / s.speedMs + s.dwellHomeS + s.dwellAwayS;
}

/** Where a ship is on its timetable at `gameSeconds`. */
export interface LanePlace {
  /** Leg index along the home-first polyline and meters along it. */
  leg: number;
  progressM: number;
  /** True sailing toward the far end. */
  forward: boolean;
  underWay: boolean;
  /** Lying at an end out of sight (in port, or off the chart in the lower lakes). */
  hidden: boolean;
  /** Laid up this cycle (the lane's monthly weight said no). */
  laidUp: boolean;
}

function alongToLeg(s: LaneSchedule, along: number): { leg: number; progressM: number } {
  const last = s.points.length - 2;
  for (let i = 0; i <= last; i++) {
    if (along <= (s.cumM[i + 1] as number) || i === last) {
      return { leg: i, progressM: Math.max(along - (s.cumM[i] as number), 0) };
    }
  }
  return { leg: 0, progressM: 0 };
}

export function lanePlace(s: LaneSchedule, gameSeconds: number): LanePlace {
  const cycle = cycleS(s);
  const t = gameSeconds + s.phaseS;
  const k = Math.floor(t / cycle);
  const u = t - k * cycle;
  // Each cycle begins with the run out from home; the month then decides if she goes.
  const sails = hash01(`${s.key}:${k}`) < (s.season[monthAt(gameSeconds - u)] ?? 0);
  const transit = s.lengthM / s.speedMs;
  const home = { leg: 0, progressM: 0 };
  if (!sails) {
    return { ...home, forward: true, underWay: false, hidden: !s.seenAtHome, laidUp: true };
  }
  if (u < transit) {
    return {
      ...alongToLeg(s, u * s.speedMs),
      forward: true,
      underWay: true,
      hidden: false,
      laidUp: false,
    };
  }
  if (u < transit + s.dwellAwayS) {
    return {
      ...alongToLeg(s, s.lengthM),
      forward: true,
      underWay: false,
      hidden: !s.seenAway,
      laidUp: false,
    };
  }
  const back = u - transit - s.dwellAwayS;
  if (back < transit) {
    return {
      ...alongToLeg(s, s.lengthM - back * s.speedMs),
      forward: false,
      underWay: true,
      hidden: false,
      laidUp: false,
    };
  }
  return { ...home, forward: true, underWay: false, hidden: !s.seenAtHome, laidUp: false };
}

const seenAtEnd = (node: RouteNode): boolean => node.role === 'grounds' || node.role === 'waypoint';

/**
 * Every ship on the route graph, and the derelicts, as chart contacts. `seed` is the
 * run's; each ship's phase, which end it calls home and every cycle's sailing draw come
 * from it, so the same run always has the same traffic. Call `placeTraffic` to put them
 * where the clock says.
 */
export function createTraffic(
  projection: ChartProjection,
  seed: string,
  graph: RouteGraph = westernSuperiorRoutes(),
): Contact[] {
  const toChart = ([lon, lat]: [number, number]): Chart => projection.geoToChart({ lat, lon });
  const contacts: Contact[] = [];
  for (const lane of graph.lanes) {
    const polyline = laneLonLats(graph, lane).map(toChart);
    const fromNode = graph.nodes.get(lane.from) as RouteNode;
    const toNode = graph.nodes.get(lane.to) as RouteNode;
    let n = 0;
    for (const entry of lane.fleet) {
      const record = shipRecord(entry.classId);
      for (let i = 0; i < entry.count; i++, n++) {
        const id = `${lane.id.replace(/^lane\./, 'ship.')}_${n + 1}`;
        const key = `${seed}:${id}`;
        // Half the fleet calls the far end home, so ships pass both ways at once.
        const flip = lane.use !== 'patrol' && hash01(`${key}:home`) < 0.5;
        const points = flip ? [...polyline].reverse() : polyline;
        const cumM = [0];
        for (let j = 1; j < points.length; j++) {
          cumM.push((cumM[j - 1] as number) + distance(points[j - 1] as Chart, points[j] as Chart));
        }
        const speedKn = entry.speedKn ?? classSpeedKn(record);
        // Each ship's lie-overs vary a little, so the fleet doesn't sail in step.
        const jitter = 0.75 + 0.5 * hash01(`${key}:dwell`);
        const [dwellFrom, dwellTo] = lane.dwellH;
        const schedule: LaneSchedule = {
          laneId: lane.id,
          points,
          cumM,
          lengthM: cumM[cumM.length - 1] as number,
          speedMs: speedKn * KNOT_MS,
          dwellHomeS: (flip ? dwellTo : dwellFrom) * 3600 * jitter,
          dwellAwayS: (flip ? dwellFrom : dwellTo) * 3600 * jitter,
          phaseS: 0,
          seenAtHome: seenAtEnd(flip ? toNode : fromNode),
          seenAway: seenAtEnd(flip ? fromNode : toNode),
          season: lane.season,
          key,
        };
        schedule.phaseS = hash01(`${key}:phase`) * cycleS(schedule);
        const kind = CLASS_KIND[entry.classId] ?? 'freighter';
        const contact: Contact = {
          id,
          kind,
          name: entry.names[i % entry.names.length] as string,
          classId: entry.classId,
          pos: { ...(points[0] as Chart) },
          heading: 0,
          speedKn,
          conspicuity: record.conspicuity,
          hostile: lane.use === 'patrol',
          threat: lane.use === 'patrol',
          prize: lane.use === 'trade',
          schedule,
          lane: { points, leg: 0, progressM: 0, forward: true },
        };
        if (entry.consort) {
          const consort = shipRecord(entry.consort);
          contact.consorts = [
            { classId: consort.id, name: entry.consortName ?? `${consort.name} in tow` },
          ];
        }
        contacts.push(contact);
      }
    }
  }
  for (const poi of graph.pois) {
    contacts.push({
      id: poi.id,
      kind: 'derelict',
      name: poi.name,
      classId: poi.classId,
      description: poi.description,
      pos: toChart(poi.at),
      heading: hash01(`${seed}:${poi.id}`) * Math.PI * 2,
      speedKn: 0,
      conspicuity: 0.7,
      hostile: false,
      threat: false,
      prize: true,
    });
  }
  return contacts;
}

/** Put every scheduled ship where its timetable has it at `gameSeconds`. */
export function placeTraffic(contacts: readonly Contact[], gameSeconds: number): void {
  for (const c of contacts) {
    const s = c.schedule;
    if (!s) continue;
    const place = lanePlace(s, gameSeconds);
    const a = s.points[place.leg] as Chart;
    const b = s.points[place.leg + 1] as Chart;
    const len = distance(a, b);
    c.pos = lerpChart(a, b, len > 0 ? Math.min(place.progressM / len, 1) : 0);
    c.heading = place.forward ? bearing(a, b) : bearing(b, a);
    c.inPort = place.hidden;
    c.underWay = place.underWay;
    c.lane = {
      points: s.points,
      leg: place.leg,
      progressM: place.progressM,
      forward: place.forward,
    };
  }
}

/**
 * The share of the lake's fleet sailing in a month, 0–1 (the lanes' monthly weights,
 * weighted by fleet size). The encounter director scales its budget by it.
 */
export function seasonBusyness(month: number, graph: RouteGraph = westernSuperiorRoutes()): number {
  let sailing = 0;
  let total = 0;
  for (const lane of graph.lanes) {
    if (lane.use === 'patrol') continue;
    const count = lane.fleet.reduce((sum, e) => sum + e.count, 0);
    sailing += count * (lane.season[month] ?? 0);
    total += count;
  }
  return total > 0 ? sailing / total : 0;
}
