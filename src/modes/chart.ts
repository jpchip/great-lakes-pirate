import type { Chart } from '../core/coords';
import { advanceGameTime, dayAndHour } from '../core/time';
import {
  encounterBudget,
  expectedEncounters,
  tradeLaneLines,
  type LaneLines,
} from '../sim/chart/director';
import { monthAt } from '../sim/chart/routes';
import type { ChartGeography, ChartZone } from '../sim/chart/geography';
import {
  avoidChance,
  checkEncounters,
  detourSeconds,
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
export const ENCOUNTER_QUIET_S = 1.5 * 3600;

/** Everything chart mode reads and changes. The voyage goes in the save (piece D). */
export interface ChartSession {
  readonly geo: ChartGeography;
  ship: ChartShip;
  position: Chart;
  heading: number;
  wind: ChartWind;
  contacts: Contact[];
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
  /**
   * The encounter director's reports left this voyage (piece F); once spent only threats
   * are reported. Undefined: no budget, every sighting the lookout setting passes.
   */
  budget?: number;
  /** Hostiles hunt and force meetings (`?cutter=hunt`, dev only until Phase 5's Wanted). */
  hostilesHunt?: boolean;
  /** Game seconds still to lose standing off something steered clear of (S8 finding 4). */
  detourS?: number;
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
  let lanes: LaneLines | undefined;

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
      session.detourS = 0;
      lanes ??= tradeLaneLines(session.geo.projection);
      session.budget = encounterBudget(
        expectedEncounters(course, monthAt(clock.gameSeconds), lanes),
        ctx.rng,
      );
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
        const weather = weatherFactor(session.position, session.contacts);
        const p = avoidChance(enc, hour(), session.voyage?.speedKn ?? 0, weather);
        const escaped = ctx.rng.chance(p);
        ctx.events.emit('EncounterAvoided', { contactId: id, escaped });
        if (!escaped) {
          ctx.events.emit('EncounterEngaged', { contactId: id, forced: true });
          return { outcome: 'arena', escaped };
        }
        // Steering clear costs sea room, and so time (S8 finding 4).
        session.detourS = (session.detourS ?? 0) + detourSeconds(enc, session.voyage?.speedKn ?? 0);
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
      // A detour eats into the time before the voyage makes good any more of its course.
      const standingOff = Math.min(session.detourS ?? 0, gameSeconds);
      if (standingOff > 0) session.detourS = (session.detourS ?? 0) - standingOff;
      stepVoyage(voyage, gameSeconds - standingOff, session.wind, session.ship);
      stepContacts(
        session.contacts,
        gameSeconds,
        session.wind,
        session.geo.charted,
        clock.gameSeconds,
      );
      session.position = voyage.position;
      session.heading = voyage.heading;

      for (let i = 0; i < worldTicks; i++) {
        ctx.events.emit('WorldTick', { gameSeconds: clock.gameSeconds });
        driftWind(session.wind, ctx);
      }
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
          session.contacts,
          hour(),
          clock.gameSeconds,
          session.lookout,
          session.handled,
          {
            forcedOnly: clock.gameSeconds < session.quietUntil,
            threatsOnly: session.budget !== undefined && session.budget <= 0,
            hostilesHunt: session.hostilesHunt ?? false,
          },
        );
        if (enc) {
          session.quietUntil = clock.gameSeconds + ENCOUNTER_QUIET_S;
          if (!enc.forced && session.budget !== undefined) {
            session.budget = Math.max(session.budget - 1, 0);
          }
          session.pending = enc;
          ctx.events.emit('EncounterSpotted', { contactId: enc.contact.id, forced: enc.forced });
          hooks.onEncounter?.(enc);
        }
      }
    },
  };
  return mode;
}

/** A small random walk per world tick until plan 04's weather sim (S9) drives it. */
function driftWind(wind: ChartWind, ctx: GameContext): void {
  wind.from = (wind.from + ctx.rng.range(-0.06, 0.06) + Math.PI * 2) % (Math.PI * 2);
  wind.speedKn = Math.min(Math.max(wind.speedKn + ctx.rng.range(-0.7, 0.7), 4), 24);
}
