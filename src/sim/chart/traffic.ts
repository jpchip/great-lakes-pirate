import {
  KNOT_MS,
  METERS_PER_NAUTICAL_MILE,
  type Chart,
  type ChartProjection,
} from '../../core/coords';
import { bearing, distance } from './geography';
import { createTraffic, placeTraffic, type LaneSchedule } from './routes';
import type { ChartWind } from './voyage';

/**
 * Chart contacts and the lookouts (plan 03 §6). Encounters come from abstract entities
 * near the player's track, not dice: the ships on the route graph (`routes.ts`, Phase 3
 * piece F), the derelicts, and a drifting storm cell until piece E's weather brings its
 * own.
 */

export type ContactKind =
  'freighter' | 'steamer' | 'barge' | 'tug' | 'cutter' | 'derelict' | 'storm';

export interface Contact {
  id: string;
  kind: ContactKind;
  name: string;
  pos: Chart;
  heading: number;
  speedKn: number;
  /** ships.json class it's drawn as in an arena. */
  classId?: string;
  /** Ships in its company (a consort in tow), materialized with it in an arena. */
  consorts?: { classId: string; name: string }[];
  /** What the lookout calls a derelict ("a scow, dismasted and drifting"). */
  description?: string;
  /** Where it is on its lane: `{leg, progress}` (plan 01 §3.4). */
  lane?: { points: Chart[]; leg: number; progressM: number; forward: boolean };
  /** Its timetable on the route graph; `placeTraffic` puts it where the clock says. */
  schedule?: LaneSchedule;
  /** Lying in port or off the chart: not on the water to be seen. */
  inPort?: boolean;
  /** Making way along its lane (false lying at an end, or at anchor on the grounds). */
  underWay?: boolean;
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
  /**
   * A hostile that is hunting you (dev flag until Phase 5's Wanted). False for one that's
   * only sighted: she isn't looking for you, so steering clear always works.
   */
  hunts?: boolean;
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

/**
 * Stand-in weather contacts until piece E brings squalls and fog banks from the sim: one
 * squall line drifting downwind, re-forming upwind when it leaves the chart.
 */
export function createWeatherContacts(projection: ChartProjection): Contact[] {
  return [
    {
      id: 'weather.squall',
      kind: 'storm',
      name: 'Squall line',
      pos: projection.geoToChart({ lat: 47.2, lon: -91.2 }),
      heading: 0,
      speedKn: 9,
      conspicuity: 2,
      hostile: false,
      threat: true,
      prize: false,
      radiusM: 9000,
    },
  ];
}

/**
 * Every contact on the chart for a run: the route graph's ships and derelicts (piece F),
 * placed for `gameSeconds`, and the stand-in squall.
 */
export function createContacts(
  projection: ChartProjection,
  seed: string,
  gameSeconds = 0,
): Contact[] {
  const contacts = [...createTraffic(projection, seed), ...createWeatherContacts(projection)];
  placeTraffic(contacts, gameSeconds);
  return contacts;
}

/**
 * Move every contact on to `now` (game seconds), `gameSeconds` after the last call. The
 * route graph's ships go where their timetables have them; the squall drifts downwind and
 * re-forms upwind once it leaves `bounds`.
 */
export function stepContacts(
  contacts: Contact[],
  gameSeconds: number,
  wind: ChartWind,
  bounds: { min: Chart; max: Chart },
  now: number,
): void {
  placeTraffic(contacts, now);
  for (const c of contacts) {
    if (c.kind !== 'storm') continue;
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
export interface EncounterCheck {
  /** The pacing guard's quiet spell: only a hostile closing can interrupt. */
  forcedOnly?: boolean;
  /**
   * The director's budget for this voyage is spent: only threats (and forced meetings)
   * are still reported.
   */
  threatsOnly?: boolean;
  /**
   * Hostiles hunt the player and force a meeting when they spot her. Off in Phase 3 (the
   * Morrill is sighted but forces nothing until Phase 5's Wanted); `?cutter=hunt` sets it.
   */
  hostilesHunt?: boolean;
}

export function checkEncounters(
  player: Chart,
  contacts: readonly Contact[],
  hour: number,
  now: number,
  pref: LookoutPref,
  handled: ReadonlySet<string>,
  check: EncounterCheck = {},
): Encounter | undefined {
  const hunt = check.hostilesHunt ?? true;
  const weather = weatherFactor(player, contacts);
  let best: Encounter | undefined;
  for (const c of contacts) {
    if (c.inPort) continue;
    const d = distance(player, c.pos);
    const seen = d <= playerSeesAtM(c, hour, weather);
    if (seen) c.lastSeen = { at: now, pos: { ...c.pos } };
    if (handled.has(c.id)) continue;
    const forced = hunt && c.hostile && d <= hostileSeesAtM(hour, weather);
    const reportable = seen && reported(c, pref) && (!check.threatsOnly || c.threat);
    if (!forced && (check.forcedOnly || !reportable)) continue;
    // Storms are measured to their edge.
    const distanceM = Math.max(d - (c.radiusM ?? 0), 0);
    const enc: Encounter = {
      contact: c,
      forced,
      distanceM,
      bearing: bearing(player, c.pos),
      ...(c.hostile ? { hunts: hunt } : {}),
    };
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

/** A squall raised closer than this can still clip you when you steer clear. */
export const SQUALL_CLIP_M = 2 * METERS_PER_NAUTICAL_MILE;

/**
 * Chance that "Avoid" works (plan 03 §6.2: night, weather, your visibility, their
 * speed). Only a hunting hostile gives chase. A squall raised late can still clip you
 * (S8 finding 4); anything else is simply left behind.
 */
export function avoidChance(
  enc: Encounter,
  hour: number,
  playerKn: number,
  weather: number,
): number {
  if (enc.contact.kind === 'storm') {
    return Math.min(0.5 + (0.5 * enc.distanceM) / SQUALL_CLIP_M, 1);
  }
  if (!enc.contact.hostile || enc.hunts === false) return 1;
  let p = 0.45;
  p += 0.3 * (1 - daylight(hour));
  if (weather < 1) p += 0.15;
  p += Math.min(Math.max((playerKn - enc.contact.speedKn) * 0.05, -0.2), 0.2);
  // Farther away is easier to slip.
  p += Math.min(enc.distanceM / (10 * METERS_PER_NAUTICAL_MILE), 0.15);
  return Math.min(Math.max(p, 0.05), 0.95);
}

/** Extra sea room steering clear takes, nautical miles: around a ship, or off a hostile. */
export const DETOUR_NM = { ship: 2, hostile: 5 } as const;

/**
 * Game seconds a detour costs (S8 finding 4: Avoid isn't free). Steering clear of a ship
 * takes a couple of miles; slipping a hostile, five; a squall, most of the way round it.
 */
export function detourSeconds(enc: Encounter, playerKn: number): number {
  const c = enc.contact;
  const extraM =
    c.kind === 'storm'
      ? (c.radiusM ?? 0) * 0.8
      : (c.hostile ? DETOUR_NM.hostile : DETOUR_NM.ship) * METERS_PER_NAUTICAL_MILE;
  return extraM / (Math.max(playerKn, 3) * KNOT_MS);
}
