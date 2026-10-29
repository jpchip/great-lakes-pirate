import * as THREE from 'three';
import { ShipCamera, type ShipPose, type SurfaceSampler } from '../gameplay/camera/ship-camera';

/**
 * Drives the sailing camera (gameplay/camera/ship-camera) from the mouse and copies it
 * into the three.js camera. The cursor stays free (plan 02 §2): drag with the left or
 * middle button to orbit, wheel to zoom, hold the Spyglass input (right mouse) to look
 * where the cursor points and drag to pan it. Right mouse never opens the browser menu
 * over the game.
 */
export class CameraRig {
  readonly ship = new ShipCamera();
  /** Spyglass on toggle instead of hold (plan 13 §9). */
  spyglassToggle = false;
  /** Whether the Spyglass input is down; main wires it to the input action map. */
  spyglassDown: () => boolean = () => false;
  /** Pause menu open: ignore the mouse and drop the spyglass. */
  suspended = false;

  private dx = 0;
  private dy = 0;
  private wheel = 0;
  private readonly cursor = new THREE.Vector2();
  private wasDown = false;
  private toggled = false;
  private readonly look = new THREE.Vector3();
  private readonly detach: () => void;

  constructor(
    private readonly camera: THREE.PerspectiveCamera,
    element: HTMLElement,
  ) {
    let lastX = 0;
    let lastY = 0;
    const onDown = (e: PointerEvent): void => {
      lastX = e.clientX;
      lastY = e.clientY;
    };
    const onMove = (e: PointerEvent): void => {
      const rect = element.getBoundingClientRect();
      this.cursor.set(
        ((e.clientX - rect.left) / Math.max(1, rect.width)) * 2 - 1,
        -((e.clientY - rect.top) / Math.max(1, rect.height)) * 2 + 1,
      );
      // Any held button drags: left or middle orbits, right pans the spyglass.
      if (e.buttons !== 0 && !this.suspended) {
        this.dx += e.clientX - lastX;
        this.dy += e.clientY - lastY;
      }
      lastX = e.clientX;
      lastY = e.clientY;
    };
    const onWheel = (e: WheelEvent): void => {
      if (this.suspended) return;
      e.preventDefault();
      // Lines or pages from a mouse, pixels from a trackpad: about one notch per 100 px.
      const scale = e.deltaMode === 1 ? 1 / 3 : e.deltaMode === 2 ? 3 : 1 / 100;
      this.wheel += Math.max(-3, Math.min(3, e.deltaY * scale));
    };
    const onContextMenu = (e: Event): void => e.preventDefault();
    element.addEventListener('pointerdown', onDown);
    window.addEventListener('pointermove', onMove);
    element.addEventListener('wheel', onWheel, { passive: false });
    element.addEventListener('contextmenu', onContextMenu);
    this.detach = () => {
      element.removeEventListener('pointerdown', onDown);
      window.removeEventListener('pointermove', onMove);
      element.removeEventListener('wheel', onWheel);
      element.removeEventListener('contextmenu', onContextMenu);
    };
  }

  dispose(): void {
    this.detach();
  }

  /** Feed the mouse into the camera, place it, and copy it to the three.js camera. */
  update(pose: ShipPose, surface: SurfaceSampler, frameSeconds: number): void {
    const cam = this.ship;
    this.updateSpyglass();
    // Drag right swings the view right; in the chase view that orbits the boom left.
    cam.orbit(cam.spyglass ? this.dx : -this.dx, this.dy);
    cam.zoom(this.wheel);
    this.dx = 0;
    this.dy = 0;
    this.wheel = 0;
    cam.update(pose, surface, frameSeconds);

    this.camera.position.set(cam.position.x, cam.position.y, cam.position.z);
    this.camera.up.set(0, 1, 0);
    this.camera.lookAt(cam.target.x, cam.target.y, cam.target.z);
    if (cam.roll !== 0) this.camera.rotateZ(-cam.roll);
    if (Math.abs(this.camera.fov - cam.fovDeg) > 0.01) {
      this.camera.fov = cam.fovDeg;
      this.camera.updateProjectionMatrix();
    }
  }

  private updateSpyglass(): void {
    const down = !this.suspended && this.spyglassDown();
    let on: boolean;
    if (this.suspended) {
      this.toggled = false;
      on = false;
    } else if (this.spyglassToggle) {
      if (down && !this.wasDown) this.toggled = !this.toggled;
      on = this.toggled;
    } else {
      on = down;
    }
    this.wasDown = down;
    if (on && !this.ship.spyglass) {
      // Look where the cursor points in the chase view.
      this.look.set(this.cursor.x, this.cursor.y, 0.5).unproject(this.camera);
      this.look.sub(this.camera.position).normalize();
      this.ship.setSpyglass(true, { origin: this.camera.position, dir: this.look });
    } else if (!on && this.ship.spyglass) {
      this.ship.setSpyglass(false);
    }
  }
}
