import { LAND_CELL_M, type ArenaLand } from './land';
import { arenaSceneSpeed, type SteeredShip } from './steering';

/** Keel probes along the centerline: bow, midships, stern (as in the player hazards). */
const PROBE_FRAC = [0.45, 0, -0.45] as const;

function blocked(land: ArenaLand, deepDraft: boolean, x: number, z: number): boolean {
  if (land.isLand(x, z)) return true;
  if (deepDraft && land.isShoal?.(x, z)) return true;
  return false;
}

/** True when any keel probe at (x,z) with `heading` touches land or shoal (deep-draft only). */
export function probesOnLand(
  land: ArenaLand,
  deepDraft: boolean,
  x: number,
  z: number,
  heading: number,
  lengthM: number,
): boolean {
  const fx = Math.sin(heading);
  const fz = -Math.cos(heading);
  for (const f of PROBE_FRAC) {
    const k = f * lengthM;
    if (blocked(land, deepDraft, x + fx * k, z + fz * k)) return true;
  }
  return false;
}

/** Unit vector toward deeper water from a land mask (arena grid has no SDF). */
function towardWater(land: ArenaLand, x: number, z: number): { nx: number; nz: number } {
  const e = LAND_CELL_M;
  let gx = 0;
  let gz = 0;
  if (land.isLand(x + e, z)) gx += 1;
  if (land.isLand(x - e, z)) gx -= 1;
  if (land.isLand(x, z + e)) gz += 1;
  if (land.isLand(x, z - e)) gz -= 1;
  const len = Math.hypot(gx, gz);
  if (len < 1e-6) return { nx: 0, nz: 0 };
  return { nx: -gx / len, nz: -gz / len };
}

/**
 * After movement, push a steered hull off dry land (and shoals when `deepDraft`), restore
 * a clear pre-tick pose when possible, and strip velocity into the shore.
 */
export function separateSteeredFromLand(
  s: SteeredShip,
  land: ArenaLand,
  prev: { x: number; z: number },
  _dt: number,
): void {
  const deep = !!s.helm.deepDraft;
  if (land.allWater && (!deep || land.allDeep)) return;
  if (!probesOnLand(land, deep, s.x, s.z, s.heading, s.lengthM)) return;

  if (!probesOnLand(land, deep, prev.x, prev.z, s.heading, s.lengthM)) {
    s.x = prev.x;
    s.z = prev.z;
  } else {
    let cx = s.x;
    let cz = s.z;
    const maxSteps = Math.max(1, Math.ceil((2 * s.lengthM) / LAND_CELL_M));
    const backFx = -Math.sin(s.heading);
    const backFz = Math.cos(s.heading);
    for (let n = 0; n < maxSteps && probesOnLand(land, deep, cx, cz, s.heading, s.lengthM); n++) {
      const { nx, nz } = towardWater(land, cx, cz);
      let moved = false;
      if (nx !== 0 || nz !== 0) {
        const tx = cx + nx * LAND_CELL_M;
        const tz = cz + nz * LAND_CELL_M;
        if (!probesOnLand(land, deep, tx, tz, s.heading, s.lengthM)) {
          cx = tx;
          cz = tz;
          moved = true;
        }
      }
      if (!moved) {
        for (let d = LAND_CELL_M; d <= s.lengthM && !moved; d += LAND_CELL_M) {
          const tx = cx + backFx * d;
          const tz = cz + backFz * d;
          if (!probesOnLand(land, deep, tx, tz, s.heading, s.lengthM)) {
            cx = tx;
            cz = tz;
            moved = true;
          }
        }
      }
      if (!moved) {
        for (let k = 0; k < 8; k++) {
          const ang = (k * Math.PI) / 4;
          const tx = cx + Math.sin(ang) * LAND_CELL_M;
          const tz = cz - Math.cos(ang) * LAND_CELL_M;
          if (!probesOnLand(land, deep, tx, tz, s.heading, s.lengthM)) {
            cx = tx;
            cz = tz;
            moved = true;
            break;
          }
        }
      }
      if (!moved) break;
    }
    s.x = cx;
    s.z = cz;
  }

  if (probesOnLand(land, deep, s.x, s.z, s.heading, s.lengthM)) {
    s.vx = 0;
    s.vz = 0;
    s.helm.speedKn = 0;
    return;
  }

  const { nx, nz } = towardWater(land, s.x, s.z);
  if (nx !== 0 || nz !== 0) {
    const dot = s.vx * nx + s.vz * nz;
    if (dot < 0) {
      s.vx -= dot * nx;
      s.vz -= dot * nz;
    }
  }
  const knMs = arenaSceneSpeed(1);
  const kn = Math.hypot(s.vx, s.vz) / Math.max(knMs, 1e-6);
  s.helm.speedKn = Math.min(s.helm.speedKn, kn);
}