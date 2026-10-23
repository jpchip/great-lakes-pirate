/**
 * Pointer-lock mouse look for the on-foot camera (plan 01 §4.8). Clicking the element
 * locks the pointer; mouse movement accumulates until the next `consume()`.
 */
export class PointerLook {
  private dx = 0;
  private dy = 0;
  private detach: (() => void) | undefined;

  get locked(): boolean {
    return document.pointerLockElement === this.element;
  }

  constructor(private readonly element: HTMLElement) {}

  attach(): void {
    this.detachListeners();
    const onClick = (): void => {
      if (!this.locked) void this.element.requestPointerLock();
    };
    const onMove = (e: MouseEvent): void => {
      if (!this.locked) return;
      this.dx += e.movementX;
      this.dy += e.movementY;
    };
    this.element.addEventListener('click', onClick);
    document.addEventListener('mousemove', onMove);
    this.detach = () => {
      this.element.removeEventListener('click', onClick);
      document.removeEventListener('mousemove', onMove);
    };
  }

  detachListeners(): void {
    this.detach?.();
    this.detach = undefined;
    if (this.locked) document.exitPointerLock();
  }

  /** Mouse movement in pixels since the last call. */
  consume(): { dx: number; dy: number } {
    const out = { dx: this.dx, dy: this.dy };
    this.dx = 0;
    this.dy = 0;
    return out;
  }
}
