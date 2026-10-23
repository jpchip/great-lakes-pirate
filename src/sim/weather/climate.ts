/**
 * Climate normals for western Lake Superior (plan 04 §4.1), interpolated by calendar
 * date. These are tuning placeholders until they're checked against NOAA normals; they
 * move to data/climate.json once the weather sim leaves the prototype stage.
 *
 * Rates marked "per game day" run on the day clock (plan 04 §3.2): a storm lasts game
 * hours, so a season's character is set by how often systems pass per game day.
 */

/** Storm tracks (plan 04 §5.1). Each spawns at a different chart edge. */
export type LowTrack = 'clipper' | 'panhandle' | 'pacific';

export interface MonthNormals {
  /** Daytime air temperature, °C. */
  airDayC: number;
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

const T = (clipper: number, panhandle: number, pacific: number) => ({
  clipper,
  panhandle,
  pacific,
});

/** Mid-month normals, January first. */
export const MONTHS: readonly MonthNormals[] = [
  // prettier-ignore
  { airDayC: -10, waterC: 1, prevailingKn: 5, prevailingFromDeg: 300, lowsPerDay: 1.0, deepShare: 0.25, highsPerDay: 0.8, tracks: T(0.6, 0.25, 0.15), advectionFog: 0.05, radiationFog: 0.05 },
  // prettier-ignore
  { airDayC: -9, waterC: 1, prevailingKn: 5, prevailingFromDeg: 300, lowsPerDay: 1.0, deepShare: 0.25, highsPerDay: 0.8, tracks: T(0.6, 0.25, 0.15), advectionFog: 0.05, radiationFog: 0.05 },
  // prettier-ignore
  { airDayC: -3, waterC: 1, prevailingKn: 5, prevailingFromDeg: 315, lowsPerDay: 1.0, deepShare: 0.25, highsPerDay: 0.7, tracks: T(0.45, 0.35, 0.2), advectionFog: 0.1, radiationFog: 0.05 },
  // prettier-ignore
  { airDayC: 5, waterC: 2, prevailingKn: 3, prevailingFromDeg: 45, lowsPerDay: 0.9, deepShare: 0.15, highsPerDay: 0.7, tracks: T(0.25, 0.4, 0.35), advectionFog: 0.6, radiationFog: 0.1 },
  // prettier-ignore
  { airDayC: 13, waterC: 4, prevailingKn: 3, prevailingFromDeg: 225, lowsPerDay: 0.75, deepShare: 0.07, highsPerDay: 0.7, tracks: T(0.2, 0.35, 0.45), advectionFog: 1.0, radiationFog: 0.15 },
  // prettier-ignore
  { airDayC: 19, waterC: 8, prevailingKn: 3.5, prevailingFromDeg: 225, lowsPerDay: 0.7, deepShare: 0.05, highsPerDay: 0.7, tracks: T(0.15, 0.25, 0.6), advectionFog: 1.0, radiationFog: 0.25 },
  // prettier-ignore
  { airDayC: 23, waterC: 13, prevailingKn: 3.5, prevailingFromDeg: 225, lowsPerDay: 0.55, deepShare: 0.03, highsPerDay: 0.75, tracks: T(0.2, 0.1, 0.7), advectionFog: 0.6, radiationFog: 0.45 },
  // prettier-ignore
  { airDayC: 22, waterC: 15, prevailingKn: 3.5, prevailingFromDeg: 235, lowsPerDay: 0.6, deepShare: 0.05, highsPerDay: 0.75, tracks: T(0.25, 0.1, 0.65), advectionFog: 0.3, radiationFog: 0.8 },
  // prettier-ignore
  { airDayC: 17, waterC: 13, prevailingKn: 4.5, prevailingFromDeg: 270, lowsPerDay: 0.85, deepShare: 0.12, highsPerDay: 0.7, tracks: T(0.35, 0.25, 0.4), advectionFog: 0.15, radiationFog: 1.0 },
  // prettier-ignore
  { airDayC: 11, waterC: 9, prevailingKn: 5, prevailingFromDeg: 290, lowsPerDay: 1.05, deepShare: 0.3, highsPerDay: 0.7, tracks: T(0.35, 0.4, 0.25), advectionFog: 0.1, radiationFog: 0.8 },
  // prettier-ignore
  { airDayC: 3, waterC: 6, prevailingKn: 6, prevailingFromDeg: 315, lowsPerDay: 1.5, deepShare: 0.55, highsPerDay: 0.6, tracks: T(0.35, 0.45, 0.2), advectionFog: 0.05, radiationFog: 0.2 },
  // prettier-ignore
  { airDayC: -6, waterC: 3, prevailingKn: 6, prevailingFromDeg: 300, lowsPerDay: 1.2, deepShare: 0.35, highsPerDay: 0.7, tracks: T(0.55, 0.3, 0.15), advectionFog: 0.05, radiationFog: 0.05 },
];

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
    airDayC: lerp(a.airDayC, b.airDayC, t),
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
