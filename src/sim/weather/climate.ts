import climateJson from '../../../data/climate.json';
import { climateFileSchema, type ClimateMonth } from '../../../data/schemas/climate';

/**
 * Climate normals for western Lake Superior (plan 04 §4.1, §23), interpolated by calendar
 * date. The numbers live in data/climate.json: air and water temperatures from NOAA
 * normals, and the sim's tuning beside the observed wind it was checked against.
 *
 * Rates marked "per game day" run on the day clock (plan 04 §3.2): a storm lasts game
 * hours, so a season's character is set by how often systems pass per game day.
 */

/** Storm tracks (plan 04 §5.1). Each spawns at a different chart edge. */
export type LowTrack = 'clipper' | 'panhandle' | 'pacific';

export interface MonthNormals {
  /** Normal daily high and low air temperature, °C. */
  airMaxC: number;
  airMinC: number;
  /** Lake surface temperature, °C. */
  waterC: number;
  /**
   * Background wind speed, knots: the climatological flow the moving systems ride on.
   * The systems add the rest, so this sits well under the observed mean wind.
   */
  prevailingKn: number;
  /** Where the prevailing wind comes from, degrees clockwise from north. */
  prevailingFromDeg: number;
  /** New lows per game day. */
  lowsPerDay: number;
  /** Share of new lows that deepen into gales. */
  deepShare: number;
  /** New highs per game day. */
  highsPerDay: number;
  /** Track weights for new lows. */
  tracks: Readonly<Record<LowTrack, number>>;
  /** Advection fog weight (warm, moist air over cold water), 0–1. */
  advectionFog: number;
  /** Radiation fog weight (clear, calm nights), 0–1. */
  radiationFog: number;
}

/** The validated data/climate.json, January first. */
export const CLIMATE_MONTHS: readonly ClimateMonth[] = climateFileSchema.parse(climateJson);

/** Mid-month normals as the sim reads them, January first. */
export const MONTHS: readonly MonthNormals[] = CLIMATE_MONTHS.map((m) => ({
  airMaxC: m.airMaxC,
  airMinC: m.airMinC,
  waterC: m.waterC,
  ...m.sim,
}));

/** Interpolated normals for a moment, plus the prevailing wind as a vector. */
export interface Climate extends Omit<MonthNormals, 'prevailingFromDeg'> {
  /** Unit vector the prevailing wind blows toward (x east, y north) times its speed in knots. */
  prevailingToKn: { x: number; y: number };
}

const DAY_MS = 86_400_000;

/** Fractional month index (0 = mid-January) for a UTC date. */
export function monthPosition(date: Date): number {
  const y = date.getUTCFullYear();
  const month = date.getUTCMonth();
  const monthStart = Date.UTC(y, month, 1);
  const monthDays = (Date.UTC(y, month + 1, 1) - monthStart) / DAY_MS;
  const dayInMonth = (date.getTime() - monthStart) / DAY_MS;
  // Normals sit at mid-month, so day 0 of a month is half a month before its normal.
  return (month + dayInMonth / monthDays - 0.5 + 12) % 12;
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function toVector(n: MonthNormals): { x: number; y: number } {
  // "From" 225° (SW) blows toward 45° (NE).
  const to = ((n.prevailingFromDeg + 180) * Math.PI) / 180;
  return { x: Math.sin(to) * n.prevailingKn, y: Math.cos(to) * n.prevailingKn };
}

/** Climate normals for a calendar date, interpolated between mid-month values. */
export function climateAt(date: Date): Climate {
  const pos = monthPosition(date);
  const i = Math.floor(pos);
  const t = pos - i;
  const a = MONTHS[i] as MonthNormals;
  const b = MONTHS[(i + 1) % 12] as MonthNormals;
  const va = toVector(a);
  const vb = toVector(b);
  return {
    airMaxC: lerp(a.airMaxC, b.airMaxC, t),
    airMinC: lerp(a.airMinC, b.airMinC, t),
    waterC: lerp(a.waterC, b.waterC, t),
    prevailingKn: Math.hypot(lerp(va.x, vb.x, t), lerp(va.y, vb.y, t)),
    prevailingToKn: { x: lerp(va.x, vb.x, t), y: lerp(va.y, vb.y, t) },
    lowsPerDay: lerp(a.lowsPerDay, b.lowsPerDay, t),
    deepShare: lerp(a.deepShare, b.deepShare, t),
    highsPerDay: lerp(a.highsPerDay, b.highsPerDay, t),
    tracks: {
      clipper: lerp(a.tracks.clipper, b.tracks.clipper, t),
      panhandle: lerp(a.tracks.panhandle, b.tracks.panhandle, t),
      pacific: lerp(a.tracks.pacific, b.tracks.pacific, t),
    },
    advectionFog: lerp(a.advectionFog, b.advectionFog, t),
    radiationFog: lerp(a.radiationFog, b.radiationFog, t),
  };
}
