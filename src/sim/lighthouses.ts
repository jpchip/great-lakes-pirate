import lighthousesJson from '../../data/lighthouses.json';
import {
  lighthousesFileSchema,
  type Characteristic,
  type LighthouseDef,
  type LightTier,
  type TowerStyle,
} from '../../data/schemas/lighthouses';
import { ChartProjection, chartToZone, type ZoneFrame } from '../core/coords';
import { pierHead } from './harbors';
import { hash01 } from './terrain/vegetation';
import type { Clearing } from './terrain/vegetation';

/**
 * The 1900 lights of the Apostles (plan 06 §6.1, R1 §2.1; Phase 2 piece F): where each
 * stands on the zone's land, whether it is lit, and what it shows. Pure and deterministic,
 * no three.js, so the renderer, the chart and (in Phase 5) keepers' detection all read the
 * same lights.
 *
 * Distances are zone meters: a real light's range is far past the compressed zone, so a
 * tier's `rangeM` is how far it shows in the zone, up to the 6 km fog floor.
 */

/** Validated lights from data/lighthouses.json. */
export const LIGHTHOUSES: readonly LighthouseDef[] = lighthousesFileSchema.parse(lighthousesJson);

/** The lights standing in one zone. */
export function lightsIn(zoneId: string): LighthouseDef[] {
  return LIGHTHOUSES.filter((l) => l.zone === zoneId);
}

export interface TierSpec {
  /** How far the light shows in clear air, zone meters. */
  rangeM: number;
  /** Lamp strength, 0–1: sets the glare and the beam. */
  strength: number;
}

export const LIGHT_TIERS: Readonly<Record<LightTier, TierSpec>> = {
  strong: { rangeM: 6000, strength: 1 },
  medium: { rangeM: 4500, strength: 0.8 },
  weak: { rangeM: 3000, strength: 0.6 },
};

export function lightRangeM(def: LighthouseDef): number {
  return LIGHT_TIERS[def.tier].rangeM;
}

/** The lamp color of a characteristic, as 0xRRGGBB: warm white or ruby red. */
export function lampHex(c: Characteristic): number {
  return c.color === 'red' ? 0xff4a38 : 0xfff0d0;
}

/**
 * Lamps burn from sunset to sunrise (1900's keepers lit them at dusk): 0 in full day,
 * 1 once the sun is a few degrees down, easing in across the twilight.
 */
export function lampLevel(sunElevationDeg: number): number {
  const t = Math.min(1, Math.max(0, (3 - sunElevationDeg) / 7));
  return t * t * (3 - 2 * t);
}

/** Where a flashing light's lens is pointing, radians clockwise from north (0 for fixed). */
export function beamBearing(def: LighthouseDef, nowS: number): number {
  const c = def.characteristic;
  if (c.kind !== 'flashing') return 0;
  const phase = hash01(def.id.length, def.id.charCodeAt(6), 91) * c.periodS;
  const turns = (nowS + phase) / c.periodS;
  return (turns - Math.floor(turns)) * Math.PI * 2;
}

/** The half-width of a lens's beam as seen from outside, radians: about 5°. */
export const BEAM_HALF_ANGLE_RAD = (5 * Math.PI) / 180;

/**
 * How much of its flash a viewer at `bearingToViewer` (radians clockwise from north, from
 * the light) sees: 1 when the beam points at them, falling to 0 past the beam's edge.
 * Fixed lights show no flash.
 */
export function flashSeen(def: LighthouseDef, nowS: number, bearingToViewer: number): number {
  if (def.characteristic.kind !== 'flashing') return 0;
  const TAU = Math.PI * 2;
  let d = (bearingToViewer - beamBearing(def, nowS)) % TAU;
  if (d > Math.PI) d -= TAU;
  if (d < -Math.PI) d += TAU;
  const x = Math.min(1, Math.abs(d) / (2 * BEAM_HALF_ANGLE_RAD));
  return (1 - x) * (1 - x) * (1 + 2 * x);
}

/** A light placed on the zone's land. */
export interface PlacedLight {
  def: LighthouseDef;
  /** Zone meters of the tower's foot. */
  x: number;
  z: number;
  /** Ground height there, meters above the lake. */
  groundM: number;
  /** Radians clockwise from north: from the tower out over the nearest water. */
  seaward: number;
}

/** What placement reads of the terrain: a ZoneTerrain does. */
export interface LightTerrain {
  heightAt(x: number, z: number): number;
  shoreNormalAt(x: number, z: number, out: { x: number; z: number }): { x: number; z: number };
}

/** A tower needs dry ground this far above the lake. */
const MIN_GROUND_M = 1.5;
const projection = new ChartProjection();

/**
 * Kit-local xz offset to zone xz, matching the renderer's `rotation.y = -seaward` (sea
 * toward -z in the kit).
 */
export function stationOffsetWorld(
  seaward: number,
  localX: number,
  localZ: number,
): { x: number; z: number } {
  const θ = -seaward;
  return {
    x: localX * Math.cos(θ) + localZ * Math.sin(θ),
    z: -localX * Math.sin(θ) + localZ * Math.cos(θ),
  };
}

/** Dry-ground samples for the merged station mesh (kit space, +z landward). Keep in sync with kit.ts. */
/** Dry-ground samples for a station mesh (kit space, +z landward). Keep in sync with kit.ts. */
export function stationFootprintProbes(def: LighthouseDef): readonly [number, number][] {
  return STATION_FOOTPRINT[def.tower.style](def);
}

const STATION_FOOTPRINT: Readonly<
  Record<TowerStyle, (def: LighthouseDef) => readonly [number, number][]>
> = {
  conical: (def) =>
    def.tower.finish === 'iron'
      ? [
          [0, 5],
          [-2.5, 4.8],
          [2.5, 4.8],
        ]
      : [
          [0, 14],
          [-5.5, 13],
          [3, 13],
        ],
  dwelling: () => [
    [0, 5],
    [-4, 2],
    [4, 2],
  ],
  skeleton: () => [[0, 7]],
};

function dryAt(terrain: LightTerrain, x: number, z: number): boolean {
  return terrain.heightAt(x, z) >= MIN_GROUND_M;
}

/** Kit corners may sit on low shingle above the lake without meeting the tower-foot threshold. */
const PROBE_MIN_GROUND_M = 0.1;

function probeDry(terrain: LightTerrain, x: number, z: number): boolean {
  return terrain.heightAt(x, z) >= PROBE_MIN_GROUND_M;
}

/** Slide the tower foot along shore until the kit footprint sits on dry ground. */
function fitStationFootprint(
  x: number,
  z: number,
  seaward: number,
  def: LighthouseDef,
  terrain: LightTerrain,
): { x: number; z: number } {
  const probes = stationFootprintProbes(def);
  const land = stationOffsetWorld(seaward, 0, 1);
  const len = Math.hypot(land.x, land.z) || 1;
  const lx = land.x / len;
  const lz = land.z / len;

  let bestX = x;
  let bestZ = z;
  let bestDist = Infinity;
  for (let shift = -40; shift <= 60; shift += 1) {
    const fx = x + lx * shift;
    const fz = z + lz * shift;
    if (!dryAt(terrain, fx, fz)) continue;
    let score = 0;
    for (const [px, pz] of probes) {
      const w = stationOffsetWorld(seaward, px, pz);
      if (probeDry(terrain, fx + w.x, fz + w.z)) score++;
    }
    if (score !== probes.length) continue;
    const dist = Math.abs(shift);
    if (dist < bestDist) {
      bestDist = dist;
      bestX = fx;
      bestZ = fz;
    }
  }
  return { x: bestX, z: bestZ };
}

/**
 * Puts each light on the zone's land: its geographic point, moved to the nearest ground at
 * least 1.5 m above the lake if that point turns out to be water or a shingle beach (the
 * zone is compressed and clipped, so a light's real coordinates can land just offshore).
 */
export function placeLights(
  defs: readonly LighthouseDef[],
  frame: ZoneFrame,
  terrain: LightTerrain,
): PlacedLight[] {
  const out: PlacedLight[] = [];
  const normal = { x: 0, z: 0 };
  for (const def of defs) {
    // A pierhead light stands on its pier's outer end, on the deck, facing out along it.
    const head = def.pier ? pierHead(def.pier, frame, terrain) : undefined;
    if (head) {
      const back = 4;
      out.push({
        def,
        x: head.x - Math.sin(head.bearing) * back,
        z: head.z + Math.cos(head.bearing) * back,
        groundM: head.deckM,
        seaward: head.bearing,
      });
      continue;
    }
    const at = chartToZone(projection.geoToChart(def.at), frame);
    let x = at.x;
    let z = at.z;
    if (terrain.heightAt(x, z) < MIN_GROUND_M) {
      let found = false;
      for (let r = 4; r <= 400 && !found; r += 4) {
        const steps = Math.max(8, Math.round((2 * Math.PI * r) / 4));
        for (let k = 0; k < steps; k++) {
          const a = (k / steps) * Math.PI * 2;
          const px = at.x + Math.cos(a) * r;
          const pz = at.z + Math.sin(a) * r;
          if (terrain.heightAt(px, pz) >= MIN_GROUND_M) {
            x = px;
            z = pz;
            found = true;
            break;
          }
        }
      }
    }
    terrain.shoreNormalAt(x, z, normal);
    const seaward = Math.atan2(normal.x, -normal.z);
    const fit = fitStationFootprint(x, z, seaward, def, terrain);
    x = fit.x;
    z = fit.z;
    out.push({
      def,
      x,
      z,
      groundM: Math.max(terrain.heightAt(x, z), 0),
      seaward,
    });
  }
  return out;
}

/** Ground around a light kept free of trees and rocks. */
export const LIGHT_CLEARING_M = 26;

export function lightClearing(p: Pick<PlacedLight, 'x' | 'z'>): Clearing {
  return {
    x: p.x,
    z: p.z,
    ux: 1,
    uz: 0,
    halfAlong: LIGHT_CLEARING_M,
    halfAcross: LIGHT_CLEARING_M,
  };
}

/** Open water for a ship to sit in: this deep, with the same all round it. */
const SHIP_WATER_M = -6;

/**
 * Where to put a ship to look at a light from the water, about `distanceM` off: deep water
 * with a clear line of water to the light's shore (no island in between), as near the
 * seaward bearing as it can find, then nearer in if the far spots are all blocked. The
 * heading faces the light. Undefined when no water is found (a light up a creek).
 */
export function viewingSpot(
  p: Pick<PlacedLight, 'x' | 'z' | 'seaward'>,
  terrain: Pick<LightTerrain, 'heightAt'>,
  distanceM: number,
): { x: number; z: number; heading: number } | undefined {
  const clearTo = (x: number, z: number, bearing: number, d: number): boolean => {
    const dx = Math.sin(bearing);
    const dz = -Math.cos(bearing);
    // Water at the ship and round it, then every 20 m back toward the shore.
    for (const [ox, oz] of [
      [0, 0],
      [25, 0],
      [-25, 0],
      [0, 25],
      [0, -25],
    ] as const) {
      if (terrain.heightAt(x + ox, z + oz) > SHIP_WATER_M) return false;
    }
    for (let k = 20; k < d - 60; k += 20) {
      if (terrain.heightAt(p.x + dx * (d - k), p.z + dz * (d - k)) > -1.5) return false;
    }
    return true;
  };
  for (let d = distanceM; d >= 120; d *= 0.8) {
    for (let step = 0; step <= 12; step++) {
      for (const sign of step === 0 ? [1] : [1, -1]) {
        const bearing = p.seaward + sign * step * ((15 * Math.PI) / 180);
        const x = p.x + Math.sin(bearing) * d;
        const z = p.z - Math.cos(bearing) * d;
        if (clearTo(x, z, bearing, d)) return { x, z, heading: bearing + Math.PI };
      }
    }
  }
  return undefined;
}
