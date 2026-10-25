import { calendarDate, dayAndHour } from '../../core/time';

/**
 * Sun and moon for basic day and night (plan 04 §3.4, §9). Local solar time is the hour of
 * the game day; the season comes from the compressed calendar (7 calendar days per game
 * day), so the moon runs through its phases in about four game days. Phase 2 refines the
 * moon's path; the sun formula is the standard low-cost one plan 04 asks for.
 */

/** The Apostles, about 46.8° N (plan 04 §3.4). */
export const LATITUDE_RAD = (46.8 * Math.PI) / 180;
const OBLIQUITY_RAD = (23.44 * Math.PI) / 180;
const DAY_MS = 86_400_000;
export const SYNODIC_DAYS = 29.530588853;
/** A new moon: 1900-01-01 13:52 UTC. */
const NEW_MOON_MS = Date.UTC(1900, 0, 1, 13, 52);

export interface SkyBody {
  /** Above the horizon, radians (negative below). */
  elevationRad: number;
  /** Compass bearing, radians clockwise from north. */
  azimuthRad: number;
  /** Unit vector toward the body in zone space (x east, y up, z south). */
  direction: { x: number; y: number; z: number };
}

export interface Moon extends SkyBody {
  /** 0 = new, 0.25 = first quarter, 0.5 = full, 0.75 = last quarter. */
  phase01: number;
  /** Lit fraction of the disc, 0–1. */
  illumination01: number;
}

function dayOfYear(date: Date): number {
  const start = Date.UTC(date.getUTCFullYear(), 0, 1);
  return (date.getTime() - start) / DAY_MS + 1;
}

/** Solar declination (Cooper's formula), radians. */
export function solarDeclination(dayOfYearN: number): number {
  return OBLIQUITY_RAD * Math.sin((2 * Math.PI * (284 + dayOfYearN)) / 365);
}

function bodyAt(declination: number, hourAngle: number, latitude: number): SkyBody {
  const sinEl =
    Math.sin(latitude) * Math.sin(declination) +
    Math.cos(latitude) * Math.cos(declination) * Math.cos(hourAngle);
  const elevationRad = Math.asin(Math.max(-1, Math.min(1, sinEl)));
  const azimuthRad =
    (Math.atan2(
      Math.sin(hourAngle),
      Math.cos(hourAngle) * Math.sin(latitude) - Math.tan(declination) * Math.cos(latitude),
    ) +
      Math.PI) %
    (2 * Math.PI);
  const c = Math.cos(elevationRad);
  return {
    elevationRad,
    azimuthRad,
    direction: { x: c * Math.sin(azimuthRad), y: sinEl, z: -c * Math.cos(azimuthRad) },
  };
}

/** Hour angle from local solar time: 0 at noon, negative in the morning. */
function hourAngle(gameSeconds: number): number {
  return ((dayAndHour(gameSeconds).hour - 12) * Math.PI) / 12;
}

export function sunAt(gameSeconds: number, latitude = LATITUDE_RAD): SkyBody {
  const declination = solarDeclination(dayOfYear(calendarDate(gameSeconds)));
  return bodyAt(declination, hourAngle(gameSeconds), latitude);
}

export function moonPhase(date: Date): number {
  const days = (date.getTime() - NEW_MOON_MS) / DAY_MS;
  const phase = (days / SYNODIC_DAYS) % 1;
  return phase < 0 ? phase + 1 : phase;
}

/**
 * The moon trails the sun by its phase angle: new moon rides with the sun, full moon
 * rises at sunset. Its declination is the sun's half a year on per full phase, so the
 * summer full moon runs low and the winter one high.
 */
export function moonAt(gameSeconds: number, latitude = LATITUDE_RAD): Moon {
  const date = calendarDate(gameSeconds);
  const phase01 = moonPhase(date);
  const declination = solarDeclination(dayOfYear(date) + phase01 * 365);
  const body = bodyAt(declination, hourAngle(gameSeconds) - phase01 * 2 * Math.PI, latitude);
  return { ...body, phase01, illumination01: (1 - Math.cos(phase01 * 2 * Math.PI)) / 2 };
}
