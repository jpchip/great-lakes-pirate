import type { SiteDef } from '../../../data/schemas/sites';
import type { ZoneFrame } from '../../core/coords';
import { footprintPoint } from '../harbors';
import { setPieceFootprint, zoneDef, type SetPieceFootprint } from '../terrain/zones';
import type { BuildSite } from './grid';
import { siteBuild } from './stash';
import { CELL_M } from './structures';

/**
 * A hideout site set down in its zone (plan 09 §2.1, §4; Phase 8 piece C). The grid's
 * local frame (x along the shore, z inland, from the build bounds' corner; piece A) is the
 * set piece footprint's, moved to that corner: x runs with `alongM` and z with `inlandM`.
 * That's a turn about y and a shift, never a mirror, so pieces, colliders and the build
 * camera all go between the two frames with one rotation.
 */
export interface SiteFrame {
  /** The bounds' corner (col 0, row 0's outer corner), zone meters. */
  origin: { x: number; z: number };
  /** Unit vector of local +x (along the shore) in zone meters. */
  along: { x: number; z: number };
  /** Unit vector of local +z (inland). */
  inland: { x: number; z: number };
  /**
   * The turn about +y from local to zone, as three.js `rotation.y` (counter-clockwise from
   * above): a local box with this yaw is the zone's box.
   */
  yaw: number;
  /** The bounds in cells and level 0's floor height above the lake. */
  cols: number;
  rows: number;
  baseM: number;
}

/** The set piece footprint a site stands on, in its zone's frame. */
export function siteFootprint(site: SiteDef, frame: ZoneFrame): SetPieceFootprint | undefined {
  const piece = zoneDef(site.zone).setPieces.find((p) => p.id === site.setPiece);
  return piece && setPieceFootprint(piece, frame);
}

export function siteFrame(site: SiteDef, fp: SetPieceFootprint): SiteFrame {
  const b = siteBuild(site);
  const o = footprintPoint(fp, b.alongM, b.inlandM);
  const ax = footprintPoint(fp, b.alongM + 1, b.inlandM);
  const iz = footprintPoint(fp, b.alongM, b.inlandM + 1);
  const along = { x: ax.x - o.x, z: ax.z - o.z };
  const inland = { x: iz.x - o.x, z: iz.z - o.z };
  return {
    origin: { x: o.x, z: o.z },
    along,
    inland,
    // three.js turns +x to (cos θ, 0, -sin θ).
    yaw: Math.atan2(-along.z, along.x),
    cols: b.cols,
    rows: b.rows,
    baseM: b.baseM,
  };
}

/** A local point (meters from the corner) in zone meters. */
export function siteToZone(f: SiteFrame, x: number, z: number): { x: number; z: number } {
  return {
    x: f.origin.x + f.along.x * x + f.inland.x * z,
    z: f.origin.z + f.along.z * x + f.inland.z * z,
  };
}

/** A zone point in the site's local meters. */
export function zoneToSite(f: SiteFrame, x: number, z: number): { x: number; z: number } {
  const dx = x - f.origin.x;
  const dz = z - f.origin.z;
  return { x: dx * f.along.x + dz * f.along.z, z: dx * f.inland.x + dz * f.inland.z };
}

/** A zone direction (radians, three.js yaw) turned into the local frame, and back. */
export function yawToZone(f: SiteFrame, localYaw: number): number {
  return localYaw + f.yaw;
}

/** The grid's site for validity and the work session: the zone's ground under the bounds. */
export function buildSiteOf(f: SiteFrame, heightAt: (x: number, z: number) => number): BuildSite {
  return {
    cols: f.cols,
    rows: f.rows,
    baseM: f.baseM,
    ground: (x, z) => {
      const p = siteToZone(f, x, z);
      return heightAt(p.x, p.z);
    },
  };
}

/** Whether a local point lies within the bounds, give or take `marginM`. */
export function inSiteBounds(f: SiteFrame, x: number, z: number, marginM = 0): boolean {
  return (
    x >= -marginM &&
    z >= -marginM &&
    x <= f.cols * CELL_M + marginM &&
    z <= f.rows * CELL_M + marginM
  );
}
