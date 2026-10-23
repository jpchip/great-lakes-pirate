/**
 * Coordinate spaces (plan 01 §3.6). All projection math lives here and nowhere else.
 * Units are SI (meters, seconds, radians) everywhere outside data files (plan 01 §8).
 *
 * - Geo:    WGS84 lat/lon in degrees.
 * - Chart:  true-scale meters on a local equirectangular projection; x east, y north.
 * - Zone:   3D gameplay meters in a coastal zone, compressed by C around the zone's
 *           origin; x east, z south (three.js convention: y up, north is -z).
 * - Render: zone coordinates minus the floating-origin offset.
 */

/** Horizontal compression for every MVP coastal zone (plan 03 §3.2). */
export const DEFAULT_COMPRESSION = 8;

/** Mean Earth radius (IUGG), meters. */
export const EARTH_RADIUS_M = 6_371_008.8;

export const METERS_PER_NAUTICAL_MILE = 1852;
export const KNOT_MS = METERS_PER_NAUTICAL_MILE / 3600;

/** Recenter the render origin when the player is farther than this from it (meters). */
export const FLOATING_ORIGIN_THRESHOLD_M = 2000;

export interface Geo {
  lat: number;
  lon: number;
}
export interface Chart {
  x: number;
  y: number;
}
export interface Zone {
  x: number;
  z: number;
}

const DEG = Math.PI / 180;

/** Local equirectangular projection around a reference point. */
export class ChartProjection {
  private readonly cosRef: number;

  /** Defaults to the middle of Lake Superior. */
  constructor(readonly reference: Geo = { lat: 47.5, lon: -88 }) {
    this.cosRef = Math.cos(reference.lat * DEG);
  }

  geoToChart(geo: Geo): Chart {
    return {
      x: (geo.lon - this.reference.lon) * DEG * EARTH_RADIUS_M * this.cosRef,
      y: (geo.lat - this.reference.lat) * DEG * EARTH_RADIUS_M,
    };
  }

  chartToGeo(chart: Chart): Geo {
    return {
      lat: this.reference.lat + chart.y / (EARTH_RADIUS_M * DEG),
      lon: this.reference.lon + chart.x / (EARTH_RADIUS_M * DEG * this.cosRef),
    };
  }
}

/** A coastal zone's frame: its origin on the chart and its compression ratio C. */
export interface ZoneFrame {
  origin: Chart;
  compression: number;
}

export function chartToZone(chart: Chart, frame: ZoneFrame): Zone {
  return {
    x: (chart.x - frame.origin.x) / frame.compression,
    z: -(chart.y - frame.origin.y) / frame.compression,
  };
}

export function zoneToChart(zone: Zone, frame: ZoneFrame): Chart {
  return {
    x: frame.origin.x + zone.x * frame.compression,
    y: frame.origin.y - zone.z * frame.compression,
  };
}

/**
 * Speed of a ship in the 3D scene, in m/s, for a game speed in m/s: v₃ᴅ = v × R / C
 * (plan 03 §3.3), so the clock stays honest about distances.
 */
export function sceneSpeed(gameSpeed: number, rate: number, compression: number): number {
  return (gameSpeed * rate) / compression;
}

export function knotsToMs(knots: number): number {
  return knots * KNOT_MS;
}

export function msToKnots(ms: number): number {
  return ms / KNOT_MS;
}

/**
 * Floating origin (render space only; zone coordinates stay authoritative). Keeps
 * float precision near the camera by shifting the scene when the player strays.
 */
export class FloatingOrigin {
  offset: Zone = { x: 0, z: 0 };

  constructor(readonly threshold: number = FLOATING_ORIGIN_THRESHOLD_M) {}

  /** Recenter on `focus` if it's past the threshold. Returns the shift applied, if any. */
  update(focus: Zone): Zone | undefined {
    const dx = focus.x - this.offset.x;
    const dz = focus.z - this.offset.z;
    if (Math.hypot(dx, dz) <= this.threshold) return undefined;
    this.offset = { x: focus.x, z: focus.z };
    return { x: dx, z: dz };
  }

  toRender(zone: Zone): Zone {
    return { x: zone.x - this.offset.x, z: zone.z - this.offset.z };
  }

  toZone(render: Zone): Zone {
    return { x: render.x + this.offset.x, z: render.z + this.offset.z };
  }
}
