import { METERS_PER_NAUTICAL_MILE } from '../../core/coords';
import { calendarDate, dayAndHour, SECONDS_PER_GAME_DAY } from '../../core/time';
import type { Encounter } from '../../sim/chart/traffic';

/**
 * Period-flavored strings for the chart (prototype S8, then the game in Phase 3 piece D).
 * Plan 13's i18n keys replace them.
 */

const POINTS = [
  'N',
  'NNE',
  'NE',
  'ENE',
  'E',
  'ESE',
  'SE',
  'SSE',
  'S',
  'SSW',
  'SW',
  'WSW',
  'W',
  'WNW',
  'NW',
  'NNW',
];

export function compassPoint(radians: number): string {
  const i = Math.round((radians / (Math.PI * 2)) * 16) % 16;
  return POINTS[(i + 16) % 16] as string;
}

export function nm(meters: number): string {
  return `${(meters / METERS_PER_NAUTICAL_MILE).toFixed(1)} nm`;
}

/** Where something lies relative to the bow, the way a lookout calls it. */
export function relativeBearing(bearing: number, heading: number): string {
  const rel = Math.atan2(Math.sin(bearing - heading), Math.cos(bearing - heading));
  const deg = Math.abs((rel * 180) / Math.PI);
  const side = rel >= 0 ? 'starboard' : 'port';
  if (deg < 12) return 'dead ahead';
  if (deg > 168) return 'dead astern';
  if (deg < 60) return `off the ${side} bow`;
  if (deg < 120) return `on the ${side} beam`;
  return `off the ${side} quarter`;
}

export function clockText(gameSeconds: number): string {
  const { day, hour } = dayAndHour(gameSeconds);
  const hh = Math.floor(hour);
  const mm = Math.floor((hour - hh) * 60);
  return `Day ${day + 1}, ${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
}

/** The calendar week a game day stands for (each game day is one week). */
export function weekText(gameSeconds: number): string {
  const d = calendarDate(dayAndHour(gameSeconds).day * SECONDS_PER_GAME_DAY);
  const month = d.toLocaleString('en-US', { month: 'long', timeZone: 'UTC' });
  return `Wk of ${month} ${d.getUTCDate()}, ${d.getUTCFullYear()}`;
}

export function durationText(seconds: number): string {
  const minutes = Math.round(seconds / 60);
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return h > 0 ? `${h} h ${String(m).padStart(2, '0')} m` : `${m} m`;
}

export function encounterText(enc: Encounter, heading: number): { kind: string; text: string } {
  const c = enc.contact;
  const where = `${nm(enc.distanceM)} ${relativeBearing(enc.bearing, heading)}`;
  const course = c.speedKn > 0 ? `, steering ${compassPoint(c.heading)}` : '';
  switch (c.kind) {
    case 'freighter':
      return {
        kind: 'Prize',
        text: `Smoke on the horizon. ${c.name}, deep-laden, ${where}${course}.`,
      };
    case 'steamer':
      return { kind: 'Prize', text: `A white hull and a red stack: ${c.name}, ${where}${course}.` };
    case 'barge':
      return {
        kind: 'Prize',
        text: `Topsails over the horizon: ${c.name}, lumber-laden, ${where}${course}.`,
      };
    case 'tug':
      return c.underWay === false
        ? { kind: 'Traffic', text: `${c.name} working her nets, ${where}.` }
        : { kind: 'Traffic', text: `${c.name} steaming for the grounds, ${where}${course}.` };
    case 'cutter':
      return {
        kind: 'Threat',
        text:
          enc.hunts === false
            ? `Revenue colors! ${c.name}, ${where}${course}. She keeps her course; she isn't looking for you.`
            : `Revenue colors! ${c.name}, ${where}${course}.`,
      };
    case 'derelict':
      return {
        kind: 'Prize',
        text: `Wreckage in the water, ${where}: ${c.description ?? 'a scow, dismasted and drifting'}.`,
      };
    case 'storm':
      return {
        kind: 'Threat',
        text: `Black cloud building ${where}. A squall line, moving ${compassPoint(c.heading)}.`,
      };
  }
}

export function engageLabel(enc: Encounter): string {
  if (enc.forced) return 'Into the arena';
  switch (enc.contact.kind) {
    case 'derelict':
      return 'Investigate';
    case 'storm':
      return 'Sail through';
    case 'tug':
      return 'Close and hail';
    default:
      return 'Engage';
  }
}
