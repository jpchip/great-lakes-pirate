import { dayAndHour } from '../../core/time';
import { sessionShip, sessionWeatherFactor, type ChartSession } from '../../modes/chart';
import {
  courseWeather,
  forecastAt,
  type CourseWeather,
  type ChartForecast,
} from '../../sim/chart/chart-weather';
import { avoidChance, spotRangeM, type Encounter, type LookoutPref } from '../../sim/chart/traffic';
import {
  estimateSeconds,
  remainingM,
  remainingSeconds,
  type PlannedCourse,
  type Voyage,
} from '../../sim/chart/voyage';
import { barometerSnapshot, clockLabel, weekLabel } from '../hud/model';
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
  /** The weather, when the chart has the sim behind it (Phase 3 piece E). */
  weather: ChartWeatherHud | undefined;
}

/** The chart card's weather lines (plan 04 §5.4, §12). */
export interface ChartWeatherHud {
  /** "Glass 29.71 ↘ falling". */
  barometerText: string;
  /** True when the glass is falling fast: the line is drawn as a warning. */
  warning: boolean;
  /** "Outlook to 18:00: wind WSW 15–24 kn, rain." */
  outlookText: string;
  /** "Squall on the course in about 3 h." Undefined when the course looks clear. */
  courseText: string | undefined;
  /** "In fog" or "In a squall" when the ship is in it now. */
  hereText: string | undefined;
  /** Hours ahead the chart draws the weather for (0: as it stands). */
  lead: number;
  /** "The chart shows the weather expected at 02:00." when a forecast is up. */
  leadText: string | undefined;
  leads: readonly number[];
}

/** Forecast leads the chart offers, game hours. */
export const FORECAST_LEADS = [0, 6, 12, 24] as const;
/** The card's outlook looks this far ahead, game hours. */
export const OUTLOOK_HOURS = 6;

export interface ChartHudSources {
  session: ChartSession;
  trip: ChartTrip;
  gameSeconds: number;
  backLabel: string | undefined;
  notice: ChartNotice | undefined;
  locked: boolean;
  /** Hours ahead the chart draws the weather for. */
  forecastLead?: number;
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
    const weather = sessionWeatherFactor(session);
    const hour = dayAndHour(gameSeconds).hour;
    const p = avoidChance(enc, hour, session.voyage?.speedKn ?? 0, weather);
    avoidLabel = enc.contact.hostile ? `Avoid (${Math.round(p * 100)}%)` : 'Steer clear';
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

function windRange(f: ChartForecast): string {
  const lo = Math.round(f.windLowKn);
  const hi = Math.round(f.windHighKn);
  return hi - lo < 2 ? `${hi} kn` : `${lo}–${hi} kn`;
}

/** The outlook in a sentence: the wind and what comes with it. */
export function outlookText(f: ChartForecast, gameSeconds: number): string {
  const what: string[] = [`wind ${compassPoint(f.windFrom)} ${windRange(f)}`];
  if (f.squall) what.push('squalls');
  else if (f.rain) what.push('rain');
  if (f.visibilityM < 1000) what.push('fog');
  else if (f.visibilityM < 5000) what.push('thick');
  let text = `Outlook to ${clockLabel(gameSeconds + f.leadHours * 3600)}: ${what.join(', ')}.`;
  if (f.barometer.trend === 'falling fast' && f.windHighKn < 28) text += ' A blow may follow.';
  return text;
}

const COURSE_WORDS: Record<CourseWeather['kind'], string> = {
  squall: 'Squall',
  fog: 'Fog',
  gale: 'Gale',
};

export function courseWeatherText(w: CourseWeather | undefined): string | undefined {
  if (!w) return undefined;
  if (w.hours < 0.25) return `${COURSE_WORDS[w.kind]} on the course ahead.`;
  const h = w.hours < 1.5 ? 'an hour' : `${Math.round(w.hours)} h`;
  return `${COURSE_WORDS[w.kind]} on the course in about ${h}.`;
}

/** What is left of a voyage, as a course from where the ship is. */
function remainingCourse(voyage: Voyage): PlannedCourse {
  const legs = voyage.legs
    .slice(voyage.leg)
    .map((leg, i) =>
      i === 0 ? { ...leg, from: voyage.position, lengthM: leg.lengthM - voyage.progressM } : leg,
    );
  return {
    points: [voyage.position, ...legs.map((l) => l.to)],
    legs,
    insideZone: [],
    destinationZone: voyage.destinationZone,
    lengthM: legs.reduce((sum, l) => sum + l.lengthM, 0),
    problem: undefined,
  };
}

function weatherHud(src: ChartHudSources): ChartWeatherHud | undefined {
  const { session, gameSeconds } = src;
  const sky = session.sky;
  if (!sky) return undefined;
  const f = forecastAt(sky.state, session.geo, session.position, gameSeconds, OUTLOOK_HOURS);
  const glass = barometerSnapshot(f.barometer);
  const course = session.voyage
    ? remainingCourse(session.voyage)
    : session.course && !session.course.problem && session.course.legs.length > 0
      ? session.course
      : undefined;
  const ahead = course
    ? courseWeather(sky.state, session.geo, course, sessionShip(session), gameSeconds)
    : undefined;
  let hereText: string | undefined;
  for (const c of sky.contacts) {
    const d = Math.hypot(session.position.x - c.pos.x, session.position.y - c.pos.y);
    if (d >= (c.radiusM ?? 0)) continue;
    if (c.kind === 'storm') hereText = 'In a squall: sail shortened';
    else hereText ??= 'In fog: the lead going';
  }
  return {
    barometerText: `Glass ${glass.inHgText} ${glass.arrow} ${glass.trend}`,
    warning: f.barometer.trend === 'falling fast',
    outlookText: outlookText(f, gameSeconds),
    courseText: courseWeatherText(ahead),
    hereText,
    lead: src.forecastLead ?? 0,
    leadText: src.forecastLead
      ? `The chart shows the weather expected at ${clockLabel(gameSeconds + src.forecastLead * 3600)}.`
      : undefined,
    leads: FORECAST_LEADS,
  };
}

export function chartHud(src: ChartHudSources): ChartHudSnapshot {
  const { session, trip, gameSeconds } = src;
  const hour = dayAndHour(gameSeconds).hour;
  const wind = session.wind;
  const voyage = session.voyage;
  const course = session.course;
  const pending = session.pending;
  const plotted = !!course && course.legs.length > 0;
  const ship = sessionShip(session);

  let statusText: string;
  let eta: string | undefined;
  if (voyage) {
    statusText = `Under way ${compassPoint(voyage.heading)} at ${voyage.speedKn.toFixed(1)} kn, ${nm(remainingM(voyage))} to go`;
    eta = etaText(gameSeconds, remainingSeconds(voyage, wind, ship));
  } else if (course && plotted) {
    const legs = `${course.legs.length} leg${course.legs.length > 1 ? 's' : ''}`;
    const to = course.destinationZone ? ` to ${course.destinationZone.name}` : '';
    statusText = `Course ${nm(course.lengthM)} in ${legs}${to}`;
    if (!course.problem) eta = etaText(gameSeconds, estimateSeconds(course, wind, ship));
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
    lookoutText: `Lookouts see ${nm(spotRangeM(hour) * sessionWeatherFactor(session))}`,
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
    weather: weatherHud(src),
  };
}
