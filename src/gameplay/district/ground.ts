import districtsJson from '../../../data/districts.json';
import { districtsFileSchema, type DistrictDef } from '../../../data/schemas/districts';
import type { Zone, ZoneFrame } from '../../core/coords';
import { Heightfield } from '../onfoot/heightfield';
import { findHarbor, footprintPoint, harborZoneId, type HarborTerrain } from '../../sim/harbors';
import { setPieceFootprint, zoneDef, type SetPieceFootprint } from '../../sim/terrain/zones';
import type { DistrictLayout } from '../../sim/district/layout';

/**
 * Where a district sits and the ground under it (plan 08 §2.1, §15; Phase 7 piece C). A
 * district is its own scene in local meters (layout.ts), placed on its harbor's set piece
 * so the waterfront you walk is the one you sailed up to: its origin is a point in the
 * set piece's footprint frame, x runs along the shore and z inland.
 *
 * The ground is baked offline from the zone's heightmap at 1 m (tools/district/bake), so
 * the scene loads without the zone and the navmesh is baked from the same heights.
 */

export const DISTRICTS: readonly DistrictDef[] = districtsFileSchema.parse(districtsJson);

export function findDistrict(key: string): DistrictDef | undefined {
  return DISTRICTS.find((d) => d.id === key || d.id === `district.${key}` || d.port === key);
}

export function districtDef(id: string): DistrictDef {
  const d = findDistrict(id);
  if (!d) throw new Error(`no district ${id}`);
  return d;
}

/** The harbor footprint a district stands on. */
export function districtFootprint(def: DistrictDef, frame: ZoneFrame): SetPieceFootprint {
  const harbor = findHarbor(def.harbor);
  if (!harbor) throw new Error(`district ${def.id}: no harbor ${def.harbor}`);
  const piece = zoneDef(harborZoneId(harbor)).setPieces.find((p) => p.id === harbor.setPiece);
  if (!piece) throw new Error(`district ${def.id}: no set piece ${harbor.setPiece}`);
  return setPieceFootprint(piece, frame);
}

/** District-local ↔ zone meters, and headings (clockwise from north) both ways. */
export interface DistrictFrame {
  toZone(x: number, z: number): Zone;
  toLocal(p: Zone): { x: number; z: number };
  /** A local heading (0 faces the lake) as a zone bearing, radians. */
  headingToZone(heading: number): number;
  headingToLocal(bearing: number): number;
}

export function districtFrame(def: DistrictDef, fp: SetPieceFootprint): DistrictFrame {
  const sx = Math.sin(fp.bearing);
  const sz = -Math.cos(fp.bearing);
  return {
    toZone: (x, z) => footprintPoint(fp, def.origin.alongM + x, def.origin.inlandM + z),
    toLocal(p) {
      // The inverse of footprintPoint, as in zones.ts setPieceAt.
      const dx = p.x - fp.anchor.x;
      const dz = p.z - fp.anchor.z;
      const inland = -(sx * dx + sz * dz);
      const along = sx * dz - sz * dx;
      return { x: along - def.origin.alongM, z: inland - def.origin.inlandM };
    },
    headingToZone: (h) => h + fp.bearing,
    headingToLocal: (b) => b - fp.bearing,
  };
}

/** The baked ground's extent: the walkable bounds plus the skirt, on whole meters. */
export function groundExtent(
  def: DistrictDef,
  layout: DistrictLayout,
): { x0: number; z0: number; nx: number; nz: number } {
  const { x0, z0, cols, rows } = layout.bounds;
  const gx0 = Math.floor(x0 - def.skirtM);
  const gz0 = Math.floor(z0 - def.skirtM);
  const gx1 = Math.ceil(x0 + cols * 2 + def.skirtM);
  const gz1 = Math.ceil(z0 + rows * 2 + def.skirtM);
  return { x0: gx0, z0: gz0, nx: gx1 - gx0 + 1, nz: gz1 - gz0 + 1 };
}

/** Samples the zone terrain under a district at 1 m. */
export function sampleGround(
  def: DistrictDef,
  layout: DistrictLayout,
  frame: DistrictFrame,
  terrain: HarborTerrain,
): Heightfield {
  const { x0, z0, nx, nz } = groundExtent(def, layout);
  const heights = new Float32Array(nx * nz);
  for (let j = 0; j < nz; j++) {
    for (let i = 0; i < nx; i++) {
      const p = frame.toZone(x0 + i, z0 + j);
      heights[j * nx + i] = terrain.heightAt(p.x, p.z);
    }
  }
  return new Heightfield(nx, nz, 1, x0, z0, heights);
}

const GROUND_MAGIC = 0x44474c47; // "GLGD"
/** Heights are stored as whole centimeters. */
const CM = 100;

/** The ground as bytes: a 20-byte header (magic, x0, z0, nx, nz) and int16 centimeters. */
export function encodeGround(g: Heightfield): Uint8Array {
  const n = g.samplesX * g.samplesZ;
  const buf = new ArrayBuffer(20 + n * 2);
  const view = new DataView(buf);
  view.setUint32(0, GROUND_MAGIC, true);
  view.setFloat32(4, g.originX, true);
  view.setFloat32(8, g.originZ, true);
  view.setUint32(12, g.samplesX, true);
  view.setUint32(16, g.samplesZ, true);
  for (let k = 0; k < n; k++) {
    const h = Math.round((g.heights[k] ?? 0) * CM);
    view.setInt16(20 + k * 2, Math.max(-32768, Math.min(32767, h)), true);
  }
  return new Uint8Array(buf);
}

export function decodeGround(bytes: Uint8Array): Heightfield {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint32(0, true) !== GROUND_MAGIC) throw new Error('district ground: bad header');
  const x0 = view.getFloat32(4, true);
  const z0 = view.getFloat32(8, true);
  const nx = view.getUint32(12, true);
  const nz = view.getUint32(16, true);
  if (bytes.byteLength !== 20 + nx * nz * 2) throw new Error('district ground: wrong size');
  const heights = new Float32Array(nx * nz);
  for (let k = 0; k < heights.length; k++) heights[k] = view.getInt16(20 + k * 2, true) / CM;
  return new Heightfield(nx, nz, 1, x0, z0, heights);
}
