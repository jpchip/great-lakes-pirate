import zonesJson from '../../../data/zones.json';
import { zonesFileSchema, type SetPieceDef, type ZoneDef } from '../../../data/schemas/zones';
import { ChartProjection, chartToZone, type Zone, type ZoneFrame } from '../../core/coords';
import type { ZoneManifest } from './manifest';
import type { Pose } from './test-bay';

/** Validated coastal zones from data/zones.json (plan 03 §9). */
export const ZONE_DEFS = zonesFileSchema.parse(zonesJson);

/** The Phase 2 zone. */
export const APOSTLES_ID = 'zone.apostles';

const DEG = Math.PI / 180;

export function zoneDef(id: string): ZoneDef {
  const def = ZONE_DEFS.find((z) => z.id === id);
  if (!def) throw new Error(`No zone ${id} in data/zones.json`);
  return def;
}

/** Where a new run starts, in zone meters and radians. */
export function spawnPose(def: ZoneDef): Pose {
  return { x: def.spawn.x, z: def.spawn.z, heading: def.spawn.headingDeg * DEG };
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
