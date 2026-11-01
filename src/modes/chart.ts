import type { Chart } from '../core/coords';
import { advanceGameTime, dayAndHour } from '../core/time';
import {
  chartWindAt,
  refreshSky,
  visibilityFactor,
  type ChartSky,
} from '../sim/chart/chart-weather';
import type { ChartGeography, ChartZone } from '../sim/chart/geography';
import {
  avoidChance,
  checkEncounters,
  stepContacts,
  weatherFactor,
  type Contact,
  type Encounter,
  type LookoutPref,
} from '../sim/chart/traffic';
import {
  planCourse,
  startVoyage,
  stepVoyage,
  type ChartShip,
  type ChartWind,
  type PlannedCourse,
  type Voyage,
} from '../sim/chart/voyage';
import { advanceWeather } from '../sim/weather/weather';
import type { GameContext } from './context';
import type { Mode } from './machine';

/**
 * Real seconds per game hour on the chart under way. Plan 03 §5.3 asked for ~2–3 s, but
 * with the baked Apostles zone reaching farther west (§22.3) that put Duluth → the
 * Apostles edge at 16.5 s; 3.5 s brings it back inside criterion 2's 20–30 s (§24).
 */
export const CHART_SECONDS_PER_HOUR = 3.5;

/** Default chart time compression: game seconds per real second while under way. */
export const CHART_TIME_SCALE = 3600 / CHART_SECONDS_PER_HOUR;

/**
 * Pacing guard: after the lookouts report something, they stay quiet about anything
 * that isn't hunting you for this long (game seconds). It keeps a crossing near plan
 * 03 §6.4's 0–2 interruptions without thinning the traffic.
 */
export const ENCOUNTER_QUIET_S = 2 * 3600;

/** Everything chart mode reads and changes. Not saved yet (prototype S8). */
export interface ChartSession {
  readonly geo: ChartGeography;
  ship: ChartShip;
  position: Chart;
  heading: number;
  /** The wind under the ship: the weather sim's when there is a sky, else held as set. */
  wind: ChartWind;
  /** Traffic: the ships and the derelict. The weather's contacts live on the sky. */
  contacts: Contact[];
  /**
   * The weather sim behind the chart (Phase 3 piece E): it drives the wind, its storm
   * cells and fog banks are met as contacts, and its visibility sets the lookouts' range.
   * Without one (unit tests), the wind holds as set and the weather is clear.
   */
  sky?: ChartSky | undefined;
  /** Waypoints the player has plotted from `position`. */
  waypoints: Chart[];
  course: PlannedCourse | undefined;
  voyage: Voyage | undefined;
  lookout: LookoutPref;
  timeScale: number;
  /** An encounter waiting for the player's choice; time stands still meanwhile. */
  pending: Encounter | undefined;
  /** Contacts already met on this voyage; they don't interrupt again. */
  handled: Set<string>;
  /** Game time until which only forced encounters interrupt (the pacing guard). */
  quietUntil: number;
}

export type EncounterChoice = 'engage' | 'avoid' | 'ignore';

export interface ChartHooks {
  onEncounter?(enc: Encounter): void;
  /** `zone` is undefined when the course ended in open water. */
  onArrived?(zone: ChartZone | undefined): void;
}

export interface ChartMode extends Mode {
  readonly session: ChartSession;
  update(dt: number): void;
  /** Re-plan after the waypoints change. */
  replot(): PlannedCourse;
  /** Start sailing the plotted course. Returns false if it isn't valid. */
  setSail(): boolean;
  /**
   * Answer the pending encounter. Returns 'arena' when the player must (or chose to)
   * drop into real-time sailing, otherwise 'continue'.
   */
  resolve(choice: EncounterChoice): { outcome: 'arena' | 'continue'; escaped?: boolean };
  /** Back from an arena: mark the contact handled and carry on. */
  resumeFrom(contactId: string): void;
}

/** Every contact the lookouts can report: the traffic and the weather. */
export function allContacts(session: ChartSession): Contact[] {
  return session.sky ? [...session.contacts, ...session.sky.contacts] : session.contacts;
}

/**
 * Weather is reported only when it lies on the course ahead: a squall or bank off the
 * beam is something to watch on the chart, not a reason to stop. This far ahead, meters
 * (about three hours' sailing).
 */
export const WEATHER_AHEAD_M = 40_000;

/** True when the weather contact's disc crosses the voyage's track within `aheadM`. */
export function onTrackAhead(voyage: Voyage, c: Contact, aheadM = WEATHER_AHEAD_M): boolean {
  const r = c.radiusM ?? 0;
  let from = voyage.position;
  let left = aheadM;
  for (let i = voyage.leg; i < voyage.legs.length && left > 0; i++) {
    const leg = voyage.legs[i] as Voyage['legs'][number];
    const dx = leg.to.x - from.x;
    const dy = leg.to.y - from.y;
    const len = Math.hypot(dx, dy);
    const use = Math.min(len, left);
    if (len > 0) {
      // Nearest point on the used part of this leg to the contact.
      const t = Math.max(
        0,
        Math.min(use / len, ((c.pos.x - from.x) * dx + (c.pos.y - from.y) * dy) / (len * len)),
      );
      if (Math.hypot(from.x + dx * t - c.pos.x, from.y + dy * t - c.pos.y) < r) return true;
    }
    left -= use;
    from = leg.to;
  }
  return false;
}

/** What the lookouts may report under way: all the traffic, and weather on the course. */
export function reportableContacts(session: ChartSession): Contact[] {
  const voyage = session.voyage;
  if (!session.sky || !voyage) return allContacts(session);
  // Weather the ship is already in isn't news: the card says so and the speed shows it.
  const inside = (c: Contact): boolean =>
    Math.hypot(session.position.x - c.pos.x, session.position.y - c.pos.y) < (c.radiusM ?? 0);
  return [
    ...session.contacts,
    ...session.sky.contacts.filter((c) => !inside(c) && onTrackAhead(voyage, c)),
  ];
}

/** How far the lookouts see here, as a share of their clear-day range. */
export function sessionWeatherFactor(session: ChartSession): number {
  return session.sky
    ? visibilityFactor(session.sky.visibilityM)
    : weatherFactor(session.position, session.contacts);
}

/** Sail shortened in a squall, the lead going in fog: the chart's share of a zone's caution. */
export const SQUALL_SPEED = 0.6;
export const FOG_SPEED = 0.8;

/** The ship as the weather here lets her sail: slower inside a squall or a fog bank. */
export function sessionShip(session: ChartSession): ChartShip {
  const sky = session.sky;
  if (!sky) return session.ship;
  let f = 1;
  for (const c of sky.contacts) {
    if (Math.hypot(session.position.x - c.pos.x, session.position.y - c.pos.y) >= (c.radiusM ?? 0))
      continue;
    f = Math.min(f, c.kind === 'storm' ? SQUALL_SPEED : FOG_SPEED);
  }
  return f === 1 ? session.ship : { ...session.ship, cruiseKn: session.ship.cruiseKn * f };
}

/**
 * Read the weather at the ship again: the sim's wind, its storm cells and fog banks, and
 * the visibility. Call after the clock or the ship's position jumps.
 */
export function readSky(session: ChartSession, gameSeconds: number): void {
  const sky = session.sky;
  if (!sky) return;
  advanceWeather(sky.state, gameSeconds);
  refreshSky(sky, session.geo, session.position, gameSeconds);
  session.wind = chartWindAt(sky.state, session.geo, session.position, gameSeconds);
}

/**
 * Chart mode (prototype S8, plan 03 §5–6): plotting is free (the clock holds while the
 * course is drawn), and a voyage runs the clock at `timeScale` with the world ticking
 * normally. Encounters are checked on each world tick against the abstract contacts.
 */
export function createChartMode(
  ctx: GameContext,
  session: ChartSession,
  hooks: ChartHooks = {},
): ChartMode {
  const clock = ctx.state.environment.clock;
  const hour = (): number => dayAndHour(clock.gameSeconds).hour;

  const mode: ChartMode = {
    id: 'chart',
    session,
    enter() {
      ctx.input.context = 'chart';
    },
    replot() {
      session.course = planCourse(session.geo, session.position, session.waypoints);
      return session.course;
    },
    setSail() {
      const course = mode.replot();
      if (course.problem || course.legs.length === 0) return false;
      session.voyage = startVoyage(course, clock.gameSeconds);
      session.handled.clear();
      session.quietUntil = 0;
      ctx.events.emit('VoyageStarted', {
        legs: course.legs.length,
        lengthM: course.lengthM,
        destinationZoneId: course.destinationZone?.id,
      });
      return true;
    },
    resolve(choice) {
      const enc = session.pending;
      if (!enc) return { outcome: 'continue' };
      session.pending = undefined;
      const id = enc.contact.id;
      if (enc.forced || choice === 'engage') {
        ctx.events.emit('EncounterEngaged', { contactId: id, forced: enc.forced });
        return { outcome: 'arena' };
      }
      if (choice === 'avoid') {
        const weather = sessionWeatherFactor(session);
        const p = avoidChance(enc, hour(), session.voyage?.speedKn ?? 0, weather);
        const escaped = ctx.rng.chance(p);
        ctx.events.emit('EncounterAvoided', { contactId: id, escaped });
        if (!escaped) {
          ctx.events.emit('EncounterEngaged', { contactId: id, forced: true });
          return { outcome: 'arena', escaped };
        }
        session.handled.add(id);
        return { outcome: 'continue', escaped };
      }
      session.handled.add(id);
      return { outcome: 'continue' };
    },
    resumeFrom(contactId) {
      session.handled.add(contactId);
    },
    update(dt) {
      const voyage = session.voyage;
      if (!voyage || session.pending) return;

      const gameSeconds = dt * session.timeScale;
      const dayBefore = dayAndHour(clock.gameSeconds).day;
      const worldTicks = advanceGameTime(clock, gameSeconds);
      stepVoyage(voyage, gameSeconds, session.wind, sessionShip(session));
      stepContacts(session.contacts, gameSeconds);
      session.position = voyage.position;
      session.heading = voyage.heading;

      for (let i = 0; i < worldTicks; i++) {
        ctx.events.emit('WorldTick', { gameSeconds: clock.gameSeconds });
      }
      // The weather runs on the world tick, here as in a zone; the chart reads it after.
      if (worldTicks > 0) readSky(session, clock.gameSeconds);
      const dayAfter = dayAndHour(clock.gameSeconds).day;
      if (dayAfter !== dayBefore) ctx.events.emit('DayChanged', { day: dayAfter });

      if (voyage.arrived) {
        session.voyage = undefined;
        session.waypoints = [];
        session.course = undefined;
        ctx.events.emit('VoyageArrived', { zoneId: voyage.destinationZone?.id });
        hooks.onArrived?.(voyage.destinationZone);
        return;
      }

      if (worldTicks > 0) {
        const enc = checkEncounters(
          session.position,
          reportableContacts(session),
          hour(),
          clock.gameSeconds,
          session.lookout,
          session.handled,
          clock.gameSeconds < session.quietUntil,
          sessionWeatherFactor(session),
        );
        if (enc) {
          session.quietUntil = clock.gameSeconds + ENCOUNTER_QUIET_S;
          session.pending = enc;
          ctx.events.emit('EncounterSpotted', { contactId: enc.contact.id, forced: enc.forced });
          hooks.onEncounter?.(enc);
        }
      }
    },
  };
  return mode;
}
