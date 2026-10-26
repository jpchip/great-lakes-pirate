import * as THREE from 'three';
import { DynamicResolution } from './dynamic-resolution';
import { GpuTimer } from './gpu-timer';
import { QUALITY_PRESETS, type QualityId, type QualityPreset } from './quality';

/**
 * The renderer wrapper (plan 01 §11.1 task 8): owns the WebGLRenderer, applies the
 * quality preset, and runs dynamic resolution scaling. Spike S1 kept WebGLRenderer
 * (plan 01 §14); the rest of render/ only talks to this.
 */
export interface FrameStats {
  drawCalls: number;
  triangles: number;
  /** Current render scale (dynamic resolution). */
  scale: number;
  /** Drawing-buffer size in device pixels. */
  width: number;
  height: number;
  /** GPU time of the last timed frame, if the timer extension is available. */
  gpuMs: number | undefined;
  /** Smoothed frame time the dynamic resolution sees. */
  frameMs: number;
}

export class GameRenderer {
  readonly renderer: THREE.WebGLRenderer;
  readonly dynamicResolution: DynamicResolution;
  readonly gpuTimer: GpuTimer;
  private _preset: QualityPreset;
  private fixedScale: number | undefined;
  private readonly presetListeners = new Set<(preset: QualityPreset) => void>();

  constructor(
    private readonly container: HTMLElement,
    quality: QualityId,
  ) {
    this._preset = QUALITY_PRESETS[quality];
    this.renderer = new THREE.WebGLRenderer({
      antialias: this._preset.antialias,
      powerPreference: 'high-performance',
    });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    // Draw-call and triangle counts are read after each frame, so reset them per frame.
    this.renderer.info.autoReset = false;
    container.appendChild(this.renderer.domElement);

    const { min, max } = this._preset.resolutionScale;
    this.dynamicResolution = new DynamicResolution({
      min,
      max,
      targetMs: this._preset.targetFrameMs,
    });
    this.gpuTimer = new GpuTimer(this.renderer.getContext() as WebGL2RenderingContext);
    this.applySize();
  }

  get preset(): QualityPreset {
    return this._preset;
  }

  get aspect(): number {
    return this.container.clientWidth / Math.max(1, this.container.clientHeight);
  }

  /** Switch presets in place. Returns true if a reload is needed (antialiasing changed). */
  setQuality(id: QualityId): boolean {
    const next = QUALITY_PRESETS[id];
    const needsReload = next.antialias !== this._preset.antialias;
    this._preset = next;
    this.configureResolution();
    for (const listener of this.presetListeners) listener(next);
    return needsReload;
  }

  /**
   * The settings screen's resolution scale (plan 13 §12): 'auto' runs dynamic resolution
   * inside the preset's range; a number pins the render scale there.
   */
  setResolution(resolution: 'auto' | number): void {
    this.fixedScale = resolution === 'auto' ? undefined : resolution;
    this.configureResolution();
  }

  get resolution(): 'auto' | number {
    return this.fixedScale ?? 'auto';
  }

  onPresetChange(listener: (preset: QualityPreset) => void): () => void {
    this.presetListeners.add(listener);
    return () => this.presetListeners.delete(listener);
  }

  /** Call on window resize. */
  resize(): void {
    this.applySize();
  }

  render(scene: THREE.Scene, camera: THREE.Camera, frameSeconds: number): void {
    if (frameSeconds > 0 && this.dynamicResolution.update(frameSeconds * 1000)) {
      this.applySize();
    }
    this.renderer.info.reset();
    this.gpuTimer.poll();
    this.gpuTimer.begin();
    this.renderer.render(scene, camera);
    this.gpuTimer.end();
  }

  stats(): FrameStats {
    const { render } = this.renderer.info;
    const size = this.renderer.getDrawingBufferSize(new THREE.Vector2());
    return {
      drawCalls: render.calls,
      triangles: render.triangles,
      scale: this.dynamicResolution.scale,
      width: size.x,
      height: size.y,
      gpuMs: this.gpuTimer.lastMs,
      frameMs: this.dynamicResolution.frameMs,
    };
  }

  private configureResolution(): void {
    const { min, max } = this._preset.resolutionScale;
    const fixed = this.fixedScale;
    this.dynamicResolution.enabled = fixed === undefined;
    if (fixed === undefined) this.dynamicResolution.configure(min, max, this._preset.targetFrameMs);
    else this.dynamicResolution.configure(fixed, fixed, this._preset.targetFrameMs);
    this.applySize();
  }

  private applySize(): void {
    const ratio =
      Math.min(window.devicePixelRatio, this._preset.maxPixelRatio) * this.dynamicResolution.scale;
    this.renderer.setPixelRatio(ratio);
    this.renderer.setSize(this.container.clientWidth, this.container.clientHeight);
  }
}
