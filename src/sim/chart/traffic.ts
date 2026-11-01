import {
  KNOT_MS,
  METERS_PER_NAUTICAL_MILE,
  type Chart,
  type ChartProjection,
} from '../../core/coords';
import { bearing, distance } from './geography';
import { createTraffic, placeTraffic, type LaneSchedule } from './routes';

/**
 * Chart contacts and the lookouts (plan 03 §6). Encounters come from abstract entities
 * near the player's track, not dice: the ships on the route graph (`routes.ts`, Phase 3
 * piece F) and the derelicts. The weather's contacts, storm cells (`storm`) and fog banks
 * (`fog`), come from the weather sim (`chart-weather.ts`, Phase 3 piece E).
 */

export type ContactKind =
  'freighter' | 'steamer' | 'barge' | 'tug' | 'cutter' | 'derelict' | 'storm' | 'fog';

/** Contacts that are weather, met at their edge and drawn as areas. */
export function isWeatherContact(c: Pick<Contact, 'kind'>): boolean {
  return c.kind === 'storm' || c.kind === 'fog';
}

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
  /** A storm cell's or fog bank's radius, meters: it is met at this edge. */
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

/**
 * Without the weather sim (tests, and a chart with no sky): inside a storm cell everyone's
 * range drops by half, and inside a fog bank to a tenth. With the sim the chart uses its
 * visibility instead (`visibilityFactor` in chart-weather.ts).
 */
export function weatherFactor(pos: Chart, contacts: readonly Contact[]): number {
  let f = 1;
  for (const c of contacts) {
    if (!isWeatherContact(c) || distance(pos, c.pos) >= (c.radiusM ?? 0)) continue;
    f = Math.min(f, c.kind === 'fog' ? 0.1 : 0.5);
  }
  return f;
}

/**
 * Every contact on the chart for a run: the route graph's ships and derelicts (piece F),
 * placed for `gameSeconds`. The weather's contacts come from the sky (`chart-weather.ts`).
 */
export function createContacts(
  projection: ChartProjection,
  seed: string,
  gameSeconds = 0,
): Contact[] {
  const contacts = createTraffic(projection, seed);
  placeTraffic(contacts, gameSeconds);
  return contacts;
}

/**
 * Move every contact on to `now` (game seconds). The route graph's ships go where their
 * timetables have them; weather contacts move with the sim, which rebuilds them each world
 * tick (`refreshSky`).
 */
export function stepContacts(contacts: Contact[], now: number): void {
  placeTraffic(contacts, now);
}

function reported(c: Contact, pref: LookoutPref): boolean {
  if (pref === 'all') return true;
  if (pref === 'threats') return c.threat;
  return c.threat || c.prize;
}

/** Distance at which the player's lookouts see `c` (weather is seen at its edge). */
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
  /**
   * Scales every spotting range (1 in clear air). The chart passes the sim's visibility;
   * it defaults to the stand-in `weatherFactor`.
   */
  weather?: number;
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
  const weather = check.weather ?? weatherFactor(player, contacts);
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
    // Weather is measured to its edge.
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
 * (S8 finding 4); a fog bank, or anything else, is simply left behind.
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
 * takes a couple of miles; slipping a hostile, five; a squall or fog bank, most of the way
 * round it.
 */
export function detourSeconds(enc: Encounter, playerKn: number): number {
  const c = enc.contact;
  const extraM = isWeatherContact(c)
    ? (c.radiusM ?? 0) * 0.8
    : (c.hostile ? DETOUR_NM.hostile : DETOUR_NM.ship) * METERS_PER_NAUTICAL_MILE;
  return extraM / (Math.max(playerKn, 3) * KNOT_MS);
}
