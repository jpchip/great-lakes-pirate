import zonesJson from '../../../data/zones.json';
import {
  zonesFileSchema,
  type EntryPointDef,
  type SetPieceDef,
  type ZoneDef,
} from '../../../data/schemas/zones';
import {
  ChartProjection,
  chartToZone,
  zoneToChart,
  type Chart,
  type Zone,
  type ZoneFrame,
} from '../../core/coords';
import type { ZoneManifest } from './manifest';
import type { Pose } from './test-bay';

/** Validated coastal zones from data/zones.json (plan 03 §9). */
export const ZONE_DEFS = zonesFileSchema.parse(zonesJson);

/** The Phase 2 zone. */
export const APOSTLES_ID = 'zone.apostles';

const DEG = Math.PI / 180;

/** The zone's definition, or undefined for an id data/zones.json doesn't have. */
export function findZoneDef(id: string): ZoneDef | undefined {
  return ZONE_DEFS.find((z) => z.id === id);
}

export function zoneDef(id: string): ZoneDef {
  const def = ZONE_DEFS.find((z) => z.id === id);
  if (!def) throw new Error(`No zone ${id} in data/zones.json`);
  return def;
}

/** Where a new run starts, in zone meters and radians. */
export function spawnPose(def: ZoneDef): Pose {
  return { x: def.spawn.x, z: def.spawn.z, heading: def.spawn.headingDeg * DEG };
}

/** Where a ship from the chart arrives at this entry, in zone meters and radians. */
export function entryPose(entry: EntryPointDef): Pose {
  return { x: entry.x, z: entry.z, heading: entry.headingDeg * DEG };
}

/** An entry point by id, or by the part after `entry.<zone>_` (`?entry=west`). */
export function findEntry(def: ZoneDef, key: string): EntryPointDef | undefined {
  return def.entries.find((e) => e.id === key || e.id.endsWith(`_${key}`));
}

/** An entry point's place on the chart, in chart meters. */
export function entryChartPos(def: ZoneDef, entry: EntryPointDef): Chart {
  return zoneToChart(entry, defFrame(def));
}

/**
 * The entry nearest a chart point: where a course from the chart into this zone arrives
 * (plan 03 §7). Piece D calls it with the point the course crosses the zone's outline.
 */
export function nearestEntry(def: ZoneDef, at: Chart): EntryPointDef {
  let best = def.entries[0] as EntryPointDef;
  let bestD = Infinity;
  for (const entry of def.entries) {
    const c = entryChartPos(def, entry);
    const d = Math.hypot(c.x - at.x, c.y - at.y);
    if (d < bestD) {
      best = entry;
      bestD = d;
    }
  }
  return best;
}

/** The zone frame the bake used: its origin is in the manifest, in whole chart meters. */
export function manifestFrame(manifest: ZoneManifest): ZoneFrame {
  return { origin: manifest.frame.origin, compression: manifest.frame.compression };
}

/**
 * The frame from the zone's definition: the same origin the bake rounds to whole chart
 * meters. For weather and the like when the zone files didn't load.
 */
export function defFrame(def: ZoneDef): ZoneFrame {
  const c = projection.geoToChart(def.center);
  return { origin: { x: Math.round(c.x), y: Math.round(c.y) }, compression: def.compression };
}

/** A set piece's footprint in zone meters, as the bake flattened it. */
export interface SetPieceFootprint {
  id: string;
  /** The shoreline anchor. */
  anchor: Zone;
  /** Radians clockwise from north, from the shore out over the water. */
  bearing: number;
  def: SetPieceDef;
}

const projection = new ChartProjection();

export function setPieceFootprint(def: SetPieceDef, frame: ZoneFrame): SetPieceFootprint {
  return {
    id: def.id,
    anchor: chartToZone(projection.geoToChart(def.at), frame),
    bearing: def.bearingDeg * DEG,
    def,
  };
}

/**
 * The zone's extent as the bake cut it, in degrees: the frame's origin plus half the
 * tile grid (times C) each way. The chart draws zone outlines from it, so they meet the
 * baked zone edges exactly.
 */
export function zoneGeoBounds(def: ZoneDef): {
  west: number;
  south: number;
  east: number;
  north: number;
} {
  const { origin, compression } = defFrame(def);
  const halfX =
    (def.bake.tilesX * def.bake.tileSamples * def.bake.sailingSampleM * compression) / 2;
  const halfY =
    (def.bake.tilesY * def.bake.tileSamples * def.bake.sailingSampleM * compression) / 2;
  const sw = projection.chartToGeo({ x: origin.x - halfX, y: origin.y - halfY });
  const ne = projection.chartToGeo({ x: origin.x + halfX, y: origin.y + halfY });
  return { west: sw.lon, south: sw.lat, east: ne.lon, north: ne.lat };
}
