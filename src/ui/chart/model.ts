import { dayAndHour } from '../../core/time';
import type { ChartSession } from '../../modes/chart';
import {
  avoidChance,
  spotRangeM,
  weatherFactor,
  type Encounter,
  type LookoutPref,
} from '../../sim/chart/traffic';
import { estimateSeconds, remainingM, remainingSeconds } from '../../sim/chart/voyage';
import { clockLabel, weekLabel } from '../hud/model';
import { compassPoint, durationText, encounterText, engageLabel, nm } from './text';

/**
 * What the chart HUD shows (plan 13 §4.3, Phase 3 piece D), sampled from the chart session
 * at the HUD's 10 Hz. Plain data, so the wording can be tested without a DOM.
 */

/**
 * How the chart was opened. `look`: M in a zone, a look at the chart with the world held
 * (plan 03 §20.5); a course can be plotted but not sailed. `sea`: taken to the chart at the
 * soft edge, where a voyage can be sailed.
 */
export type ChartTrip = 'look' | 'sea';

export interface EncounterCard {
  /** "Prize", "Threat" or "Traffic". */
  kind: string;
  name: string;
  text: string;
  /** Set when the contact forces the meeting: no Avoid, no Ignore. */
  forcedText: string | undefined;
  engageLabel: string;
  /** "Avoid (62%)" for a hostile, "Steer clear" for the rest; undefined when forced. */
  avoidLabel: string | undefined;
  /** Threats can't simply be ignored: meet them or steer clear. */
  canIgnore: boolean;
}

export interface ChartNotice {
  title: string;
  text: string;
}

export interface ChartHudSnapshot {
  trip: ChartTrip;
  dateText: string;
  timeText: string;
  windText: string;
  lookoutText: string;
  /** What the ship is doing: plotting, a course laid, or under way. */
  statusText: string;
  /** "ETA 14:20 (6 h 30 m)" for a laid course or the voyage under way. */
  etaText: string | undefined;
  /** Why the laid course can't be sailed. */
  problem: string | undefined;
  underWay: boolean;
  canSail: boolean;
  sailLabel: string;
  canEdit: boolean;
  canHeave: boolean;
  /** "Back to the helm" and the like; undefined when there's no way back from here. */
  backLabel: string | undefined;
  lookout: LookoutPref;
  encounter: EncounterCard | undefined;
  notice: ChartNotice | undefined;
  locked: boolean;
}

export interface ChartHudSources {
  session: ChartSession;
  trip: ChartTrip;
  gameSeconds: number;
  backLabel: string | undefined;
  notice: ChartNotice | undefined;
  locked: boolean;
}

export const LOOKOUT_LABELS: Record<LookoutPref, string> = {
  all: 'Report everything',
  threatsAndPrizes: 'Threats and prizes',
  threats: 'Threats only',
};

/** The encounter card's words and choices (plan 13 §4.3). */
export function encounterCard(
  enc: Encounter,
  session: ChartSession,
  gameSeconds: number,
): EncounterCard {
  const { kind, text } = encounterText(enc, session.heading);
  let avoidLabel: string | undefined;
  if (!enc.forced) {
    const weather = weatherFactor(session.position, session.contacts);
    const hour = dayAndHour(gameSeconds).hour;
    const p = avoidChance(enc, hour, session.voyage?.speedKn ?? 0, weather);
    const pct = `${Math.round(p * 100)}%`;
    if (enc.contact.hostile && enc.hunts !== false) avoidLabel = `Avoid (${pct})`;
    else avoidLabel = p < 1 ? `Steer clear (${pct})` : 'Steer clear';
  }
  return {
    kind,
    name: enc.contact.name,
    text,
    forcedText: enc.forced
      ? "She has seen you and is closing. There's no avoiding this one."
      : undefined,
    engageLabel: engageLabel(enc),
    avoidLabel,
    canIgnore: !enc.forced && !enc.contact.threat,
  };
}

function etaText(gameSeconds: number, seconds: number): string {
  return `ETA ${clockLabel(gameSeconds + seconds)} (${durationText(seconds)})`;
}

export function chartHud(src: ChartHudSources): ChartHudSnapshot {
  const { session, trip, gameSeconds } = src;
  const hour = dayAndHour(gameSeconds).hour;
  const wind = session.wind;
  const voyage = session.voyage;
  const course = session.course;
  const pending = session.pending;
  const plotted = !!course && course.legs.length > 0;

  let statusText: string;
  let eta: string | undefined;
  if (voyage) {
    const detour = session.detourS ?? 0;
    statusText =
      detour > 0
        ? `Standing off, back on course in ${durationText(detour)}; ${nm(remainingM(voyage))} to go`
        : `Under way ${compassPoint(voyage.heading)} at ${voyage.speedKn.toFixed(1)} kn, ${nm(remainingM(voyage))} to go`;
    eta = etaText(gameSeconds, remainingSeconds(voyage, wind, session.ship) + detour);
  } else if (course && plotted) {
    const legs = `${course.legs.length} leg${course.legs.length > 1 ? 's' : ''}`;
    const to = course.destinationZone ? ` to ${course.destinationZone.name}` : '';
    statusText = `Course ${nm(course.lengthM)} in ${legs}${to}`;
    if (!course.problem) eta = etaText(gameSeconds, estimateSeconds(course, wind, session.ship));
  } else {
    statusText = 'Click the chart to lay a course.';
  }

  let problem: string | undefined;
  if (!voyage && course?.problem === 'aground') {
    problem = 'That course runs aground (red cross). Add a waypoint around the land.';
  } else if (!voyage && course?.problem === 'insideDestination') {
    problem = "You're already in that zone: sail there at the helm, not on the chart.";
  } else if (!voyage && plotted && course.problem === 'tooShort') {
    problem = 'Too short a hop for the chart.';
  }

  const free = !voyage && !pending;
  const sailable = free && plotted && !course.problem;
  return {
    trip,
    dateText: weekLabel(gameSeconds),
    timeText: clockLabel(gameSeconds),
    windText: `Wind ${compassPoint(wind.from)} ${wind.speedKn.toFixed(0)} kn`,
    lookoutText: `Lookouts see ${nm(spotRangeM(hour) * weatherFactor(session.position, session.contacts))}`,
    statusText,
    etaText: eta,
    problem,
    underWay: !!voyage,
    canSail: trip === 'sea' && sailable && !src.locked,
    sailLabel: trip === 'sea' ? 'Set sail' : 'Sail out to the zone edge to set out',
    canEdit: free,
    canHeave: !!voyage && !pending,
    backLabel: pending ? undefined : src.backLabel,
    lookout: session.lookout,
    encounter: pending ? encounterCard(pending, session, gameSeconds) : undefined,
    notice: src.notice,
    locked: src.locked,
  };
}
