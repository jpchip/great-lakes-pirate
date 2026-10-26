import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SHIP_CAMERA,
  ShipCamera,
  wrapPi,
  type ShipPose,
  type SurfaceSampler,
} from '../src/gameplay/camera/ship-camera';

const DEG = Math.PI / 180;
const flat: SurfaceSampler = () => 0.8;

function pose(heading = 0, x = 0, z = 0): ShipPose {
  return { position: { x, y: 0, z }, heading, roll: 0, speed01: 0 };
}

/** Run `seconds` of frames at 60 fps. */
function run(cam: ShipCamera, p: ShipPose, seconds: number, surface: SurfaceSampler = flat): void {
  for (let t = 0; t < seconds; t += 1 / 60) cam.update(p, surface, 1 / 60);
}

/** Compass bearing from the target to the camera, radians. */
function bearingToCamera(cam: ShipCamera): number {
  return Math.atan2(cam.position.x - cam.target.x, -(cam.position.z - cam.target.z));
}

describe('ship camera', () => {
  it('starts behind and above the ship, not rolling with it', () => {
    const cam = new ShipCamera();
    const p = pose(90 * DEG);
    p.roll = 0.2;
    run(cam, p, 0.5);
    // Heading east, so the camera sits to the west.
    expect(wrapPi(bearingToCamera(cam) - 270 * DEG)).toBeCloseTo(0, 3);
    expect(cam.position.y).toBeGreaterThan(cam.target.y);
    expect(cam.roll).toBe(0);
    cam.options = { ...cam.options, rollWithShip: true };
    run(cam, p, 0.1);
    expect(cam.roll).toBeCloseTo(0.2);
  });

  it('orbits with the mouse and eases back behind the ship after a few seconds', () => {
    const cam = new ShipCamera();
    const p = pose(0);
    run(cam, p, 0.1);
    cam.orbit(-Math.PI / 2 / DEFAULT_SHIP_CAMERA.sensitivity, 0);
    run(cam, p, DEFAULT_SHIP_CAMERA.recenterDelayS - 0.5);
    expect(Math.abs(wrapPi(cam.yaw))).toBeGreaterThan(80 * DEG);
    run(cam, p, 6);
    expect(Math.abs(wrapPi(cam.yaw))).toBeLessThan(2 * DEG);

    // With the option off it stays where it was put.
    cam.options = { ...cam.options, autoRecenter: false };
    cam.orbit(300, 0);
    const yaw = cam.yaw;
    run(cam, p, 10);
    expect(cam.yaw).toBeCloseTo(yaw);
  });

  it('zooms between the deck shot and the tactical view, which looks down', () => {
    const cam = new ShipCamera();
    const p = pose();
    cam.zoom(-50);
    run(cam, p, 2);
    expect(cam.distance).toBeCloseTo(DEFAULT_SHIP_CAMERA.minDistance, 1);
    expect(cam.tactical01).toBe(0);

    cam.zoom(50);
    run(cam, p, 3);
    expect(cam.distance).toBeCloseTo(DEFAULT_SHIP_CAMERA.maxDistance, 0);
    expect(cam.tactical01).toBeCloseTo(1, 2);
    expect(cam.pitch).toBeGreaterThanOrEqual(DEFAULT_SHIP_CAMERA.tacticalMinPitch - 0.01);
    // Dragging can't flatten it out of the tactical look.
    cam.orbit(0, -5000);
    expect(cam.pitch).toBeGreaterThanOrEqual(DEFAULT_SHIP_CAMERA.tacticalMinPitch - 0.01);
  });

  it('pulls in instead of going through a hill behind the ship', () => {
    const cam = new ShipCamera();
    const p = pose(0);
    // A 40 m ridge 30 m south of the ship (behind it, heading north).
    const ridge = (_x: number, z: number): number => (z > 30 ? 40 : 0.8);
    run(cam, p, 1, ridge);
    const boom = Math.hypot(
      cam.position.x - cam.target.x,
      cam.position.y - cam.target.y,
      cam.position.z - cam.target.z,
    );
    expect(boom).toBeLessThan(35);
    expect(cam.position.z).toBeLessThanOrEqual(31);

    // And never dips under the water, whatever the pitch.
    const low = new ShipCamera();
    low.orbit(0, -5000);
    run(low, p, 1);
    expect(low.position.y).toBeGreaterThanOrEqual(0.8 + DEFAULT_SHIP_CAMERA.clearance - 1e-6);
  });

  it('narrows the view at speed, a little', () => {
    const cam = new ShipCamera();
    const p = pose();
    run(cam, p, 0.1);
    const still = cam.fovDeg;
    p.speed01 = 1;
    run(cam, p, 0.1);
    expect(still - cam.fovDeg).toBeCloseTo(DEFAULT_SHIP_CAMERA.speedFovDropDeg);
  });

  it('raises the spyglass from the deck toward where the cursor meets the water', () => {
    const cam = new ShipCamera();
    const p = pose(0, 100, 200);
    run(cam, p, 0.1);
    // A cursor ray that lands 400 m due east of the ship.
    const origin = { x: 100, y: 40, z: 200 };
    const hit = { x: 500, y: 0, z: 200 };
    const len = Math.hypot(hit.x - origin.x, hit.y - origin.y);
    const dir = { x: (hit.x - origin.x) / len, y: (hit.y - origin.y) / len, z: 0 };
    cam.setSpyglass(true, { origin, dir });
    run(cam, p, 0.1);
    expect(cam.spyglass).toBe(true);
    expect(cam.fovDeg).toBe(DEFAULT_SHIP_CAMERA.spyglassFovDeg);
    expect(cam.position.y).toBeCloseTo(DEFAULT_SHIP_CAMERA.spyglassEyeHeight);
    const look = Math.atan2(cam.target.x - cam.position.x, -(cam.target.z - cam.position.z));
    expect(Math.abs(wrapPi(look - 90 * DEG))).toBeLessThan(0.01);
    // Looking out at the water 400 m off, not down at the bow.
    const down = Math.atan2(cam.position.y - cam.target.y, Math.hypot(100, 0));
    expect(down).toBeLessThan(0.03);

    // The wheel does nothing in the glass; lowering it restores the chase view.
    cam.zoom(10);
    expect(cam.zoomTo).toBe(DEFAULT_SHIP_CAMERA.startDistance);
    cam.setSpyglass(false);
    run(cam, p, 0.1);
    expect(cam.fovDeg).toBeCloseTo(DEFAULT_SHIP_CAMERA.fovDeg);
  });
});
