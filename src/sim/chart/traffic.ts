import {
  KNOT_MS,
  METERS_PER_NAUTICAL_MILE,
  type Chart,
  type ChartProjection,
} from '../../core/coords';
import type { Rng } from '../../core/rng';
import { bearing, distance, lerpChart } from './geography';
import type { ChartWind } from './voyage';

/**
 * Prototype S8 traffic and encounters (plan 03 §6). Encounters come from abstract
 * entities near the player's track, not dice: a few ships on hand-placed lanes, one
 * derelict and a drifting storm cell. Plan 05's route graph and traffic slice replace
 * the lanes; plan 04's weather replaces the storm.
 */

export type ContactKind = 'freighter' | 'steamer' | 'tug' | 'cutter' | 'derelict' | 'storm';

export interface Contact {
  id: string;
  kind: ContactKind;
  name: string;
  pos: Chart;
  heading: number;
  speedKn: number;
  /** Lane the contact shuttles along, end to end and back. */
  lane?: { points: Chart[]; leg: number; progressM: number; forward: boolean };
  /** Storm radius, meters. */
  radiusM?: number;
  /** How far it can be seen, as a multiple of the base range (smoke, sails, size). */
  conspicuity: number;
  /** Hunts the player (the cutter); can force an encounter. */
  hostile: boolean;
  /** The lookout reports it under "threats". */
  threat: boolean;
  /** The lookout reports it under "prizes". */
  prize: boolean;
  /** Last time and place the player's lookouts saw it (a rumor-style ghost after). */
  lastSeen?: { at: number; pos: Chart };
}

/** Lookout setting (plan 03 §6.4); forced encounters ignore it. */
export type LookoutPref = 'all' | 'threatsAndPrizes' | 'threats';

export interface Encounter {
  contact: Contact;
  /** A hostile spotted you and is closing: no choice but the arena. */
  forced: boolean;
  distanceM: number;
  /** Bearing from the player to the contact. */
  bearing: number;
}

/** Base daytime spotting range in clear weather (masthead lookout, nm). */
export const DAY_SPOT_NM = 6;
/** Moonless-night spotting range (running lights, silhouettes, nm). */
export const NIGHT_SPOT_NM = 3;
/** How conspicuous the player's schooner is to others (small, no smoke). */
export const PLAYER_CONSPICUITY = 0.75;

/**
 * Daylight 0–1 for a game hour. Phase 0 uses a fixed late-spring day (sunrise ~5:15,
 * sunset ~20:30) with 45-minute twilights; plan 04's sun model replaces it.
 */
export function daylight(hour: number): number {
  const ramp = (h: number, start: number): number => Math.min(Math.max((h - start) / 0.75, 0), 1);
  return Math.min(ramp(hour, 4.9), 1 - ramp(hour, 20.4));
}

/** Spotting range in meters for a conspicuity of 1, before storms. */
export function spotRangeM(hour: number): number {
  const nm = NIGHT_SPOT_NM + (DAY_SPOT_NM - NIGHT_SPOT_NM) * daylight(hour);
  return nm * METERS_PER_NAUTICAL_MILE;
}

/** Inside a storm cell everyone's range drops by half. */
export function weatherFactor(pos: Chart, contacts: readonly Contact[]): number {
  for (const c of contacts) {
    if (c.kind === 'storm' && distance(pos, c.pos) < (c.radiusM ?? 0)) return 0.5;
  }
  return 1;
}

interface ContactDef {
  id: string;
  kind: ContactKind;
  name: string;
  speedKn: number;
  /** Lane as [lat, lon] pairs. A single point is a static contact. */
  lane: [number, number][];
  conspicuity: number;
  hostile?: boolean;
  threat?: boolean;
  prize?: boolean;
  radiusM?: number;
}

/** Hand-placed lanes, checked against the land mask in tests/chart.test.ts. */
export const PROTOTYPE_CONTACTS: readonly ContactDef[] = [
  {
    id: 'ship.ore_two_harbors',
    kind: 'freighter',
    name: 'Ore boat Manola',
    speedKn: 10,
    lane: [
      [47.0, -91.62],
      [47.15, -91.0],
      [47.25, -90.45],
      [47.35, -90.17],
    ],
    conspicuity: 1.3,
    prize: true,
  },
  {
    id: 'ship.grain_duluth',
    kind: 'freighter',
    name: 'Grain steamer Fayette Brown',
    speedKn: 9,
    lane: [
      [46.8, -91.95],
      [46.95, -91.4],
      [47.12, -90.92],
      [47.25, -90.42],
      [47.33, -90.17],
    ],
    conspicuity: 1.3,
    prize: true,
  },
  {
    id: 'ship.package_steamer',
    kind: 'steamer',
    name: 'Package steamer Dixon',
    speedKn: 11,
    lane: [
      [46.8, -91.95],
      [46.82, -91.5],
      [46.9, -91.15],
      [47.0, -90.99],
      [47.03, -90.88],
      [47.0, -90.77],
      [46.955, -90.775],
      [46.9, -90.74],
      [46.84, -90.781],
      [46.812, -90.802],
      [46.76, -90.82],
      [46.7, -90.85],
      [46.62, -90.87],
    ],
    conspicuity: 1.2,
    prize: true,
  },
  {
    id: 'ship.tug_bayfield',
    kind: 'tug',
    name: 'Fishing tug Hattie',
    speedKn: 6,
    lane: [
      [46.84, -90.781],
      [46.89, -90.73],
      [46.91, -90.66],
      [46.97, -90.7],
      [47.0, -90.73],
    ],
    conspicuity: 0.8,
  },
  {
    id: 'ship.tug_north_shore',
    kind: 'tug',
    name: 'Fishing tug Bob',
    speedKn: 6,
    lane: [
      [46.98, -91.68],
      [46.93, -91.5],
      [46.88, -91.25],
    ],
    conspicuity: 0.8,
  },
  {
    id: 'ship.morrill',
    kind: 'cutter',
    name: 'Revenue cutter Morrill',
    speedKn: 10,
    lane: [
      [46.82, -91.95],
      [47.0, -91.6],
      [47.05, -91.1],
      [47.1, -90.8],
      [47.12, -90.65],
      [47.06, -90.5],
    ],
    conspicuity: 1.2,
    hostile: true,
    threat: true,
  },
  {
    id: 'poi.derelict_scow',
    kind: 'derelict',
    name: 'Drifting scow, dismasted',
    speedKn: 0,
    lane: [[47.12, -91.25]],
    conspicuity: 0.7,
    prize: true,
  },
  {
    id: 'weather.squall',
    kind: 'storm',
    name: 'Squall line',
    speedKn: 9,
    lane: [[47.2, -91.2]],
    conspicuity: 2,
    threat: true,
    radiusM: 9000,
  },
];

/** Materialize the prototype contacts, each starting at a seeded point on its lane. */
export function createContacts(projection: ChartProjection, rng: Rng): Contact[] {
  return PROTOTYPE_CONTACTS.map((def) => {
    const points = def.lane.map(([lat, lon]) => projection.geoToChart({ lat, lon }));
    const contact: Contact = {
      id: def.id,
      kind: def.kind,
      name: def.name,
      pos: { ...(points[0] as Chart) },
      heading: 0,
      speedKn: def.speedKn,
      conspicuity: def.conspicuity,
      hostile: def.hostile ?? false,
      threat: def.threat ?? false,
      prize: def.prize ?? false,
    };
    if (def.radiusM !== undefined) contact.radiusM = def.radiusM;
    if (points.length > 1) {
      const leg = rng.int(0, points.length - 2);
      const a = points[leg] as Chart;
      const b = points[leg + 1] as Chart;
      const forward = rng.chance(0.5);
      contact.lane = { points, leg, progressM: rng.next() * distance(a, b), forward };
      placeOnLane(contact);
    }
    return contact;
  });
}

function placeOnLane(c: Contact): void {
  if (!c.lane) return;
  const { points, leg, progressM, forward } = c.lane;
  const a = points[leg] as Chart;
  const b = points[leg + 1] as Chart;
  const len = distance(a, b);
  c.pos = lerpChart(a, b, len > 0 ? progressM / len : 0);
  c.heading = forward ? bearing(a, b) : bearing(b, a);
}

/**
 * Move every contact by `gameSeconds`. Lane ships shuttle end to end; the storm drifts
 * downwind and re-forms upwind once it leaves `bounds`.
 */
export function stepContacts(
  contacts: Contact[],
  gameSeconds: number,
  wind: ChartWind,
  bounds: { min: Chart; max: Chart },
): void {
  for (const c of contacts) {
    if (c.kind === 'storm') {
      const toward = wind.from + Math.PI;
      const step = c.speedKn * KNOT_MS * gameSeconds;
      c.heading = toward;
      c.pos = { x: c.pos.x + Math.sin(toward) * step, y: c.pos.y + Math.cos(toward) * step };
      const margin = c.radiusM ?? 0;
      const outside =
        c.pos.x < bounds.min.x - margin ||
        c.pos.x > bounds.max.x + margin ||
        c.pos.y < bounds.min.y - margin ||
        c.pos.y > bounds.max.y + margin;
      if (outside) {
        // Re-form on the far (upwind) side of the chart.
        const cx = (bounds.min.x + bounds.max.x) / 2;
        const cy = (bounds.min.y + bounds.max.y) / 2;
        const reach = Math.hypot(bounds.max.x - cx, bounds.max.y - cy);
        c.pos = { x: cx + Math.sin(wind.from) * reach, y: cy + Math.cos(wind.from) * reach };
      }
      continue;
    }
    if (!c.lane || c.speedKn === 0) continue;
    let travel = c.speedKn * KNOT_MS * gameSeconds;
    const lane = c.lane;
    while (travel > 0) {
      const len = distance(lane.points[lane.leg] as Chart, lane.points[lane.leg + 1] as Chart);
      const along = lane.forward ? lane.progressM : len - lane.progressM;
      const left = len - along;
      if (travel < left) {
        lane.progressM += lane.forward ? travel : -travel;
        travel = 0;
      } else {
        travel -= left;
        const last = lane.points.length - 2;
        if (lane.forward && lane.leg < last) {
          lane.leg++;
          lane.progressM = 0;
        } else if (!lane.forward && lane.leg > 0) {
          lane.leg--;
          lane.progressM = distance(
            lane.points[lane.leg] as Chart,
            lane.points[lane.leg + 1] as Chart,
          );
        } else {
          // End of the lane: turn around.
          lane.forward = !lane.forward;
          lane.progressM = lane.forward ? 0 : len;
        }
      }
    }
    placeOnLane(c);
  }
}

function reported(c: Contact, pref: LookoutPref): boolean {
  if (pref === 'all') return true;
  if (pref === 'threats') return c.threat;
  return c.threat || c.prize;
}

/** Distance at which the player's lookouts see `c` (storms are seen at their edge). */
export function playerSeesAtM(c: Contact, hour: number, weather: number): number {
  return spotRangeM(hour) * weather * c.conspicuity + (c.radiusM ?? 0);
}

/** Distance at which a hostile spots the player. */
export function hostileSeesAtM(hour: number, weather: number): number {
  return spotRangeM(hour) * weather * PLAYER_CONSPICUITY;
}

/**
 * The world-tick encounter check. Updates every contact's last-seen record, then
 * returns the most pressing new encounter: forced ones first, then the nearest
 * reported one. `handled` holds contacts already dealt with this voyage; `forcedOnly`
 * is the pacing guard's quiet spell, when only a hostile can interrupt.
 */
export function checkEncounters(
  player: Chart,
  contacts: readonly Contact[],
  hour: number,
  now: number,
  pref: LookoutPref,
  handled: ReadonlySet<string>,
  forcedOnly = false,
): Encounter | undefined {
  const weather = weatherFactor(player, contacts);
  let best: Encounter | undefined;
  for (const c of contacts) {
    const d = distance(player, c.pos);
    const seen = d <= playerSeesAtM(c, hour, weather);
    if (seen) c.lastSeen = { at: now, pos: { ...c.pos } };
    if (handled.has(c.id)) continue;
    const forced = c.hostile && d <= hostileSeesAtM(hour, weather);
    if (!forced && (forcedOnly || !(seen && reported(c, pref)))) continue;
    // Storms are measured to their edge.
    const distanceM = Math.max(d - (c.radiusM ?? 0), 0);
    const enc: Encounter = { contact: c, forced, distanceM, bearing: bearing(player, c.pos) };
    if (
      !best ||
      (enc.forced && !best.forced) ||
      (enc.forced === best.forced && enc.distanceM < best.distanceM)
    ) {
      best = enc;
    }
  }
  return best;
}

/**
 * Chance that "Avoid" works (plan 03 §6.2: night, weather, your visibility, their
 * speed). Only a hostile gives chase; anything else is simply left behind.
 */
export function avoidChance(
  enc: Encounter,
  hour: number,
  playerKn: number,
  weather: number,
): number {
  if (!enc.contact.hostile) return 1;
  let p = 0.45;
  p += 0.3 * (1 - daylight(hour));
  if (weather < 1) p += 0.15;
  p += Math.min(Math.max((playerKn - enc.contact.speedKn) * 0.05, -0.2), 0.2);
  // Farther away is easier to slip.
  p += Math.min(enc.distanceM / (10 * METERS_PER_NAUTICAL_MILE), 0.15);
  return Math.min(Math.max(p, 0.05), 0.95);
}
