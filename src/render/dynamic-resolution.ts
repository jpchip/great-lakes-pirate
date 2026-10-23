/**
 * Dynamic resolution scaling (plan 01 §5): lower the render scale when frames run over
 * budget, raise it again when there is headroom. Pure, so it can be unit-tested; the
 * renderer wrapper feeds it a frame time each frame and applies `scale`.
 *
 * Frame times from requestAnimationFrame are pinned to the display's refresh, so a frame
 * that is on budget never looks faster than the target. The controller therefore treats
 * "on budget for a while" as headroom and probes one step up. If that probe pushes frames
 * over budget again quickly, it steps back and waits twice as long before the next probe.
 */
export interface DynamicResolutionOptions {
  min: number;
  max: number;
  targetMs: number;
  /** Scale change per step. */
  step?: number;
  /** Exponential smoothing factor for the frame time, 0–1. */
  smoothing?: number;
  /** Frames to wait after any change before judging again. */
  settleFrames?: number;
  /** On-budget frames before probing a step up; doubles after a failed probe. */
  probeFrames?: number;
  maxProbeFrames?: number;
}

export class DynamicResolution {
  enabled = true;
  private _scale: number;
  private min: number;
  private max: number;
  private targetMs: number;
  private readonly step: number;
  private readonly smoothing: number;
  private readonly settleFrames: number;
  private readonly baseProbeFrames: number;
  private readonly maxProbeFrames: number;
  private probeFrames: number;
  private averageMs: number | undefined;
  private settle = 0;
  private onBudget = 0;
  /** Frames since the last step up, while it is still on trial. */
  private sinceProbe: number | undefined;

  constructor(options: DynamicResolutionOptions) {
    this.min = options.min;
    this.max = options.max;
    this.targetMs = options.targetMs;
    this.step = options.step ?? 0.05;
    this.smoothing = options.smoothing ?? 0.1;
    this.settleFrames = options.settleFrames ?? 30;
    this.baseProbeFrames = options.probeFrames ?? 120;
    this.maxProbeFrames = options.maxProbeFrames ?? 1920;
    this.probeFrames = this.baseProbeFrames;
    this._scale = options.max;
  }

  get scale(): number {
    return this._scale;
  }

  /** The smoothed frame time the controller is reacting to. */
  get frameMs(): number {
    return this.averageMs ?? 0;
  }

  /** New range and target (a preset change). Starts again at the top of the range. */
  configure(min: number, max: number, targetMs: number): void {
    this.min = min;
    this.max = max;
    this.targetMs = targetMs;
    this._scale = max;
    this.averageMs = undefined;
    this.settle = this.settleFrames;
    this.onBudget = 0;
    this.sinceProbe = undefined;
    this.probeFrames = this.baseProbeFrames;
  }

  /** Feed one frame's time in milliseconds. Returns true when `scale` changed. */
  update(frameMs: number): boolean {
    if (!(frameMs > 0) || !Number.isFinite(frameMs)) return false;
    this.averageMs =
      this.averageMs === undefined
        ? frameMs
        : this.averageMs + (frameMs - this.averageMs) * this.smoothing;
    if (this.sinceProbe !== undefined) this.sinceProbe++;
    if (!this.enabled) return false;
    if (this.settle > 0) {
      this.settle--;
      return false;
    }

    // Small slack so refresh jitter on an on-budget frame doesn't count as a miss.
    if (this.averageMs > this.targetMs * 1.1) {
      this.onBudget = 0;
      if (this.sinceProbe !== undefined && this.sinceProbe < this.probeFrames) {
        this.probeFrames = Math.min(this.probeFrames * 2, this.maxProbeFrames);
      }
      this.sinceProbe = undefined;
      return this.setScale(this._scale - this.step);
    }

    if (this.averageMs <= this.targetMs * 1.02) {
      this.onBudget++;
      if (this.onBudget >= this.probeFrames && this._scale < this.max) {
        this.onBudget = 0;
        this.sinceProbe = 0;
        return this.setScale(this._scale + this.step);
      }
    } else {
      this.onBudget = 0;
    }
    return false;
  }

  private setScale(next: number): boolean {
    const clamped = Math.min(this.max, Math.max(this.min, Math.round(next * 1000) / 1000));
    if (clamped === this._scale) return false;
    this._scale = clamped;
    this.settle = this.settleFrames;
    return true;
  }
}
