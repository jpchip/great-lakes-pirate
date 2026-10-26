import type { Vec3 } from '../ecs';

/**
 * The sailing camera (plan 02 §8): a chase/orbit boom behind and above the ship that
 * the mouse swings round and the wheel pulls in or out, from a close deck shot to the
 * wide tactical view, plus the spyglass. It eases back behind the ship after a few
 * seconds without input, keeps out of the water and the hills, and doesn't roll with
 * the ship unless asked to. Pure math like the on-foot camera; render/ copies the
 * result into a three.js camera.
 *
 * Zone coordinates: x east, y up, z south. Yaw is the direction the camera looks,
 * radians clockwise from north, so yaw = heading is straight behind the ship.
 */

export interface ShipCameraParams {
  /** Radians per pixel of mouse drag at sensitivity 1. */
  sensitivity: number;
  /** Boom length range, meters; the long end is the tactical view. */
  minDistance: number;
  maxDistance: number;
  startDistance: number;
  /** Boom length where the tactical view starts to blend in. */
  tacticalFrom: number;
  /** Boom change per wheel notch, as a factor. */
  zoomFactor: number;
  /** How fast the boom eases toward the zoom the wheel asked for, 1/s. */
  zoomRate: number;
  /** Look-down angle range, radians; the tactical view raises the floor. */
  minPitch: number;
  maxPitch: number;
  tacticalMinPitch: number;
  startPitch: number;
  /** Seconds without input before the boom swings back behind the ship. */
  recenterDelayS: number;
  /** How fast it swings back, 1/s. */
  recenterRate: number;
  /** The point the boom pivots on, above the ship's waterline. */
  pivotHeight: number;
  /** Gap kept between the camera and the water or the ground. */
  clearance: number;
  /** How fast a boom shortened by terrain grows back, m/s. */
  recoverSpeed: number;
  fovDeg: number;
  /** FOV taken off at hull speed so pace reads as weight, not a speedboat (plan 02 §8). */
  speedFovDropDeg: number;
  /** Spyglass: a narrow FOV from the deck at eye height (plan 02 §8). */
  spyglassFovDeg: number;
  spyglassEyeHeight: number;
  /** Sway amplitude in the spyglass, radians. */
  spyglassSway: number;
}

export const DEFAULT_SHIP_CAMERA: ShipCameraParams = {
  sensitivity: 0.005,
  minDistance: 22,
  maxDistance: 900,
  startDistance: 70,
  tacticalFrom: 220,
  zoomFactor: 1.18,
  zoomRate: 8,
  minPitch: 0.04,
  maxPitch: 1.35,
  tacticalMinPitch: 0.95,
  startPitch: 0.3,
  recenterDelayS: 3,
  recenterRate: 1.2,
  pivotHeight: 4,
  clearance: 1.5,
  recoverSpeed: 30,
  fovDeg: 50,
  speedFovDropDeg: 4,
  spyglassFovDeg: 8,
  spyglassEyeHeight: 4.5,
  spyglassSway: 0.003,
};

/** What the camera follows each frame (interpolated between ticks). */
export interface ShipPose {
  position: Vec3;
  heading: number;
  /** Starboard side up, radians; only used with roll-with-ship on. */
  roll: number;
  /** Speed through the water over hull speed, 0–1. */
  speed01: number;
}

export interface ShipCameraOptions {
  autoRecenter: boolean;
  rollWithShip: boolean;
  /** Orbit speed multiplier. */
  sensitivity: number;
}

/** Height of whatever the camera must stay above at (x, z): ground or water. */
export type SurfaceSampler = (x: number, z: number) => number;

const TAU = Math.PI * 2;
/** Boom samples checked against the terrain each frame. */
const BOOM_SAMPLES = 12;

export function wrapPi(a: number): number {
  return a - TAU * Math.floor((a + Math.PI) / TAU);
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

function smoothstep(e0: number, e1: number, x: number): number {
  const t = clamp((x - e0) / (e1 - e0), 0, 1);
  return t * t * (3 - 2 * t);
}

export class ShipCamera {
  yaw = 0;
  pitch: number;
  /** The boom length the wheel asked for; `distance` eases toward it. */
  zoomTo: number;
  distance: number;
  options: ShipCameraOptions = { autoRecenter: true, rollWithShip: false, sensitivity: 1 };

  /** Results of the last `update`, for render/ to copy. */
  readonly position: Vec3 = { x: 0, y: 0, z: 0 };
  readonly target: Vec3 = { x: 0, y: 0, z: 0 };
  fovDeg: number;
  roll = 0;
  /** 0 in the chase view, 1 fully zoomed out to the tactical view. */
  tactical01 = 0;

  private spy = false;
  private spyYaw = 0;
  private spyPitch = 0;
  private boom: number;
  private idle = 0;
  private clock = 0;
  private snapped = false;
  /** Where the ship was at the last update, for aiming the spyglass. */
  private readonly ship = { x: 0, z: 0 };

  constructor(readonly params: ShipCameraParams = DEFAULT_SHIP_CAMERA) {
    this.pitch = params.startPitch;
    this.zoomTo = params.startDistance;
    this.distance = params.startDistance;
    this.boom = params.startDistance;
    this.fovDeg = params.fovDeg;
  }

  get spyglass(): boolean {
    return this.spy;
  }

  /** Mouse drag in pixels: swings the boom, or pans the spyglass. */
  orbit(dxPixels: number, dyPixels: number): void {
    if (dxPixels === 0 && dyPixels === 0) return;
    const p = this.params;
    const k = p.sensitivity * this.options.sensitivity;
    if (this.spy) {
      // Pan slower the narrower the view, so the cursor tracks what's under it.
      const s = k * (p.spyglassFovDeg / p.fovDeg);
      this.spyYaw = wrapPi(this.spyYaw + dxPixels * s);
      this.spyPitch = clamp(this.spyPitch + dyPixels * s, -0.6, 0.6);
      return;
    }
    this.yaw = wrapPi(this.yaw + dxPixels * k);
    this.pitch = clamp(this.pitch + dyPixels * k, this.minPitch(), p.maxPitch);
    this.idle = 0;
  }

  /** Wheel notches: positive zooms out toward the tactical view. */
  zoom(notches: number): void {
    if (notches === 0 || this.spy) return;
    const p = this.params;
    this.zoomTo = clamp(this.zoomTo * p.zoomFactor ** notches, p.minDistance, p.maxDistance);
    this.idle = 0;
  }

  /**
   * Raise the spyglass toward what the cursor points at, or lower it. `ray` is the
   * cursor's ray from the chase camera: where it meets the water, the glass looks at
   * that spot from the deck; above the horizon it keeps the ray's own direction.
   */
  setSpyglass(on: boolean, ray?: { origin: Vec3; dir: Vec3 }): void {
    if (on === this.spy) return;
    this.spy = on;
    this.idle = 0;
    if (!on) return;
    const eye = this.params.spyglassEyeHeight;
    if (!ray) {
      this.spyYaw = this.yaw;
      this.spyPitch = 0;
      return;
    }
    const { origin, dir } = ray;
    if (dir.y < -1e-4) {
      const t = -origin.y / dir.y;
      const dx = origin.x + dir.x * t - this.ship.x;
      const dz = origin.z + dir.z * t - this.ship.z;
      const d = Math.hypot(dx, dz);
      if (d > 1) {
        this.spyYaw = Math.atan2(dx, -dz);
        this.spyPitch = clamp(Math.atan2(eye, d), 0, 0.35);
        return;
      }
    }
    this.spyYaw = Math.atan2(dir.x, -dir.z);
    this.spyPitch = clamp(-Math.atan2(dir.y, Math.hypot(dir.x, dir.z)), -0.1, 0.35);
  }

  /** Place the camera for this frame. */
  update(ship: ShipPose, surface: SurfaceSampler, frameSeconds: number): void {
    const p = this.params;
    const dt = Math.max(0, frameSeconds);
    this.clock += dt;
    this.ship.x = ship.position.x;
    this.ship.z = ship.position.z;
    if (!this.snapped) {
      // Start behind the ship rather than wherever yaw 0 points.
      this.yaw = ship.heading;
      this.snapped = true;
    }

    this.distance += (this.zoomTo - this.distance) * (1 - Math.exp(-dt * p.zoomRate));
    this.tactical01 = smoothstep(p.tacticalFrom, p.maxDistance, this.distance);
    // Zooming out tips the view down toward a chart-like look.
    const floor = this.minPitch();
    if (this.pitch < floor) this.pitch += (floor - this.pitch) * (1 - Math.exp(-dt * 4));

    this.idle += dt;
    if (this.options.autoRecenter && !this.spy && this.idle > p.recenterDelayS) {
      const off = wrapPi(ship.heading - this.yaw);
      this.yaw = wrapPi(this.yaw + off * (1 - Math.exp(-dt * p.recenterRate)));
    }

    if (this.spy) {
      this.updateSpyglass(ship);
      return;
    }

    this.target.x = ship.position.x;
    this.target.y = ship.position.y + p.pivotHeight;
    this.target.z = ship.position.z;
    const cp = Math.cos(this.pitch);
    const bx = -Math.sin(this.yaw) * cp;
    const by = Math.sin(this.pitch);
    const bz = Math.cos(this.yaw) * cp;

    // Shorten the boom where it would pass under a hill or the water; grow back slowly.
    let reach = this.distance;
    for (let i = 1; i <= BOOM_SAMPLES; i++) {
      const d = (this.distance * i) / BOOM_SAMPLES;
      const y = this.target.y + by * d;
      const ground = surface(this.target.x + bx * d, this.target.z + bz * d) + p.clearance;
      if (y < ground) {
        reach = (this.distance * (i - 1)) / BOOM_SAMPLES;
        break;
      }
    }
    reach = Math.max(reach, p.minDistance * 0.5);
    this.boom = reach < this.boom ? reach : Math.min(reach, this.boom + p.recoverSpeed * dt);

    this.position.x = this.target.x + bx * this.boom;
    this.position.y = this.target.y + by * this.boom;
    this.position.z = this.target.z + bz * this.boom;
    const floorY = surface(this.position.x, this.position.z) + p.clearance;
    if (this.position.y < floorY) this.position.y = floorY;

    this.fovDeg = p.fovDeg - p.speedFovDropDeg * clamp(ship.speed01, 0, 1) * (1 - this.tactical01);
    this.roll = this.options.rollWithShip ? ship.roll : 0;
  }

  private minPitch(): number {
    const p = this.params;
    return p.minPitch + (p.tacticalMinPitch - p.minPitch) * this.tactical01;
  }

  private updateSpyglass(ship: ShipPose): void {
    const p = this.params;
    // Held by hand on a moving deck: a slow wander on top of the ship's own motion.
    const swayYaw = Math.sin(this.clock * 0.9) * p.spyglassSway;
    const swayPitch = Math.sin(this.clock * 1.3 + 1) * p.spyglassSway * 0.7;
    const yaw = this.spyYaw + swayYaw;
    const pitch = this.spyPitch + swayPitch;
    this.position.x = ship.position.x;
    this.position.y = ship.position.y + p.spyglassEyeHeight;
    this.position.z = ship.position.z;
    const cp = Math.cos(pitch);
    this.target.x = this.position.x + Math.sin(yaw) * cp * 100;
    this.target.y = this.position.y - Math.sin(pitch) * 100;
    this.target.z = this.position.z - Math.cos(yaw) * cp * 100;
    this.fovDeg = p.spyglassFovDeg;
    this.roll = ship.roll * 0.3;
  }
}
