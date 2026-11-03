import chartJson from '../../../data/chart.json';
import portsJson from '../../../data/ports.json';
import { chartFileSchema } from '../../../data/schemas/chart';
import { portsFileSchema } from '../../../data/schemas/ports';
import { R_SAILING } from '../../core/time';

/**
 * How long a passage between two ports takes, in real and game time, from the chart's
 * port positions and the pace of sailing in a zone and on the chart. The balance harness
 * (plan 17 §3) times its bots with it, and the freight agent (piece F) prices and dates
 * contracts by it.
 */

/** In a zone, 13 nm takes ~4 real minutes (plan 03 §3.3: Bayfield → Ashland). */
const ZONE_NM_PER_REAL_MIN = 13 / 4;
/** On the chart, ~2.5 real seconds per game hour (plan 03 §5.3). */
const CHART_REAL_S_PER_GAME_HOUR = 2.5;
/** A T1 averaging this through a mixed passage, game knots (plan 02 §3). */
const CRUISE_KN = 7;
/** Courses bend around points and islands: sailed distance over the straight line. */
const DETOUR = 1.2;
/** Harbor to the zone's edge, each end of a passage between zones, nm. */
const ZONE_EDGE_NM = 10;
/** Docking, trading and casting off, real minutes. */
const PORT_CALL_REAL_MIN = 2;
const EARTH_RADIUS_NM = 3440.065;

export interface Passage {
  realMinutes: number;
  gameSeconds: number;
}

/** How long each passage between two ports with markets takes, real and game time. */
export type PassageTable = (from: string, to: string) => Passage;

function haversineNm(a: readonly [number, number], b: readonly [number, number]): number {
  const rad = Math.PI / 180;
  const dLat = (b[1] - a[1]) * rad;
  const dLon = (b[0] - a[0]) * rad;
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(a[1] * rad) * Math.cos(b[1] * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_NM * Math.asin(Math.sqrt(h));
}

/**
 * Passages from the chart's port positions: sailed in a zone at the zone's pace, or out
 * to the zone edge, across the chart at its compression and in again.
 */
export function passageTable(): PassageTable {
  const at = new Map<string, readonly [number, number]>();
  for (const f of chartFileSchema.parse(chartJson)) if (f.kind === 'port') at.set(f.id, f.at);
  const zone = new Map(portsFileSchema.parse(portsJson).map((p) => [p.id, p.zone]));
  const cache = new Map<string, Passage>();
  return (from, to) => {
    const key = `${from}>${to}`;
    const hit = cache.get(key);
    if (hit) return hit;
    const a = at.get(from);
    const b = at.get(to);
    if (!a || !b) throw new Error(`No chart position for ${a ? to : from}`);
    const nm = haversineNm(a, b) * DETOUR;
    let p: Passage;
    if (zone.get(from) === zone.get(to)) {
      const real = nm / ZONE_NM_PER_REAL_MIN + PORT_CALL_REAL_MIN;
      p = { realMinutes: real, gameSeconds: real * 60 * R_SAILING };
    } else {
      const inZone = Math.min(nm, 2 * ZONE_EDGE_NM);
      const chartHours = (nm - inZone) / CRUISE_KN;
      const zoneReal = inZone / ZONE_NM_PER_REAL_MIN + PORT_CALL_REAL_MIN;
      p = {
        realMinutes: zoneReal + (chartHours * CHART_REAL_S_PER_GAME_HOUR) / 60,
        gameSeconds: zoneReal * 60 * R_SAILING + chartHours * 3600,
      };
    }
    cache.set(key, p);
    return p;
  };
}
