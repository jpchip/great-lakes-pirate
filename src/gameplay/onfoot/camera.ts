import type { Vec3 } from '../ecs';
import { footprintDistance, type Collider, type Push } from './colliders';
import type { OnFootZone } from './controller';

/**
 * Third-person over-the-shoulder camera (plan 08 §3.1): yaw and pitch from pointer-lock
 * mouse movement, a boom from a pivot behind the character's shoulder, and boom
 * collision against terrain and props so the camera never ends up inside a wall.
 * Pure math; render/ copies the result into a three.js camera.
 */

export interface CameraParams {
  /** Radians per pixel of mouse movement. */
  sensitivity: number;
  minPitch: number;
  maxPitch: number;
  distance: number;
  crouchDistance: number;
  /** Pivot height above the feet. */
  pivotHeight: number;
  crouchPivotHeight: number;
  /** Sideways offset to the right, for the over-the-shoulder view. */
  shoulder: number;
  /** Clearance kept between the camera and any surface. */
  clearance: number;
  /** How fast the boom grows back after a collision shortened it, in m/s. */
  recoverSpeed: number;
}

export const DEFAULT_CAMERA: CameraParams = {
  sensitivity: 0.0025,
  minPitch: -1.2,
  maxPitch: 0.75,
  distance: 3.4,
  crouchDistance: 2.6,
  pivotHeight: 1.55,
  crouchPivotHeight: 1.0,
  shoulder: 0.5,
  clearance: 0.2,
  recoverSpeed: 4,
};

export class FollowCamera {
  /** Radians, clockwise from north. */
  yaw = 0;
  /** Radians; positive looks down at the character. */
  pitch = 0.25;
  readonly position: Vec3 = { x: 0, y: 0, z: 0 };
  readonly target: Vec3 = { x: 0, y: 0, z: 0 };
  private boom: number;
  private readonly nearby: Collider[] = [];
  private readonly push: Push = { nx: 0, nz: 0 };

  constructor(readonly params: CameraParams = DEFAULT_CAMERA) {
    this.boom = params.distance;
  }

  look(dxPixels: number, dyPixels: number): void {
    const p = this.params;
    this.yaw += dxPixels * p.sensitivity;
    this.yaw = Math.atan2(Math.sin(this.yaw), Math.cos(this.yaw));
    this.pitch = Math.min(p.maxPitch, Math.max(p.minPitch, this.pitch + dyPixels * p.sensitivity));
  }

  /** Place the camera for a character whose feet are at `feet`. Call once per frame. */
  update(feet: Vec3, crouching: boolean, zone: OnFootZone, frameSeconds: number): void {
    const p = this.params;
    const fx = Math.sin(this.yaw);
    const fz = -Math.cos(this.yaw);
    // Right of the view is (−fz, fx).
    this.target.x = feet.x - fz * p.shoulder;
    this.target.y = feet.y + (crouching ? p.crouchPivotHeight : p.pivotHeight);
    this.target.z = feet.z + fx * p.shoulder;

    // Boom points back from the pivot, raised by pitch.
    const cp = Math.cos(this.pitch);
    const bx = -fx * cp;
    const by = Math.sin(this.pitch);
    const bz = -fz * cp;

    const want = crouching ? p.crouchDistance : p.distance;
    const free = this.clearDistance(this.target, bx, by, bz, want, zone);
    // Snap in at once so walls never clip; ease back out.
    this.boom = free < this.boom ? free : Math.min(free, this.boom + p.recoverSpeed * frameSeconds);

    this.position.x = this.target.x + bx * this.boom;
    this.position.y = this.target.y + by * this.boom;
    this.position.z = this.target.z + bz * this.boom;
  }

  /** March along the boom and stop before the first sample that hits something. */
  private clearDistance(
    from: Vec3,
    bx: number,
    by: number,
    bz: number,
    max: number,
    zone: OnFootZone,
  ): number {
    const c = this.params.clearance;
    const step = 0.1;
    const cx = from.x + bx * max * 0.5;
    const cz = from.z + bz * max * 0.5;
    zone.colliders.query(cx, cz, max * 0.5 + c, this.nearby);
    for (let d = step; d <= max; d += step) {
      const x = from.x + bx * d;
      const y = from.y + by * d;
      const z = from.z + bz * d;
      if (y < zone.ground.heightAt(x, z) + c) return Math.max(d - step, 0.3);
      for (const col of this.nearby) {
        if (y < col.minY - c || y > col.maxY + c) continue;
        if (footprintDistance(col, x, z, this.push) < c) return Math.max(d - step, 0.3);
      }
    }
    return max;
  }
}
