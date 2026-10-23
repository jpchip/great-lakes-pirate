/**
 * Game loop (plan 01 §3.3): a variable-dt render loop on requestAnimationFrame driving
 * a fixed-timestep gameplay tick. Render interpolates between the last two ticks with
 * `alpha`.
 */

/** Gameplay tick rate. 30 Hz is acceptable if the 3 ms tick budget is tight (plan 01 §5). */
export const GAMEPLAY_TICK_HZ = 60;

/** Frames longer than this (tab switch, breakpoint) are clamped so the sim never spirals. */
export const MAX_FRAME_SECONDS = 0.25;

export interface StepResult {
  /** Fixed ticks to run this frame. */
  ticks: number;
  /** Fraction of a tick left in the accumulator, for render interpolation (0 ≤ alpha < 1). */
  alpha: number;
}

/** Pure fixed-step accumulator, separate from rAF so it can be unit-tested. */
export class FixedStepper {
  readonly dt: number;
  private accumulator = 0;
  paused = false;

  constructor(
    hz: number = GAMEPLAY_TICK_HZ,
    private readonly maxFrameSeconds: number = MAX_FRAME_SECONDS,
  ) {
    if (!(hz > 0)) throw new RangeError(`Tick rate must be positive, got ${hz}`);
    this.dt = 1 / hz;
  }

  /** Feed one frame's real elapsed seconds; returns how many ticks to run. */
  advance(frameSeconds: number): StepResult {
    if (this.paused) return { ticks: 0, alpha: this.accumulator / this.dt };
    this.accumulator += Math.min(Math.max(frameSeconds, 0), this.maxFrameSeconds);
    const ticks = Math.floor(this.accumulator / this.dt);
    this.accumulator -= ticks * this.dt;
    return { ticks, alpha: this.accumulator / this.dt };
  }

  reset(): void {
    this.accumulator = 0;
  }
}

export interface LoopCallbacks {
  /** One fixed gameplay tick of `dt` real seconds. Not called while paused. */
  tick(dt: number): void;
  /** One render frame. `alpha` interpolates between the previous and current tick. */
  frame(alpha: number, frameSeconds: number): void;
}

export interface LoopScheduler {
  request(cb: (timeMs: number) => void): number;
  cancel(handle: number): void;
}

const rafScheduler: LoopScheduler = {
  request: (cb) => requestAnimationFrame(cb),
  cancel: (handle) => cancelAnimationFrame(handle),
};

export interface Loop {
  readonly stepper: FixedStepper;
  start(): void;
  stop(): void;
  /** Pause stops the gameplay tick; frames keep rendering for ambient effects. */
  setPaused(paused: boolean): void;
}

export function createLoop(
  callbacks: LoopCallbacks,
  stepper: FixedStepper = new FixedStepper(),
  scheduler: LoopScheduler = rafScheduler,
): Loop {
  let handle: number | undefined;
  let lastMs: number | undefined;

  const onFrame = (timeMs: number): void => {
    const frameSeconds = lastMs === undefined ? 0 : (timeMs - lastMs) / 1000;
    lastMs = timeMs;
    const { ticks, alpha } = stepper.advance(frameSeconds);
    for (let i = 0; i < ticks; i++) callbacks.tick(stepper.dt);
    callbacks.frame(alpha, frameSeconds);
    handle = scheduler.request(onFrame);
  };

  return {
    stepper,
    start() {
      if (handle !== undefined) return;
      lastMs = undefined;
      handle = scheduler.request(onFrame);
    },
    stop() {
      if (handle !== undefined) scheduler.cancel(handle);
      handle = undefined;
    },
    setPaused(paused) {
      stepper.paused = paused;
    },
  };
}
