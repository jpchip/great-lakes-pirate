import * as THREE from 'three';
import { DynamicResolution } from './dynamic-resolution';
import { GpuTimer } from './gpu-timer';
import { QUALITY_PRESETS, type QualityId, type QualityPreset } from './quality';

/**
 * The renderer wrapper (plan 01 §11.1 task 8): owns the WebGLRenderer, applies the
 * quality preset, and runs dynamic resolution scaling. Spike S1 may swap the renderer
 * underneath; the rest of render/ only talks to this.
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
    const { min, max } = next.resolutionScale;
    this.dynamicResolution.configure(min, max, next.targetFrameMs);
    this.applySize();
    for (const listener of this.presetListeners) listener(next);
    return needsReload;
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

  private applySize(): void {
    const ratio =
      Math.min(window.devicePixelRatio, this._preset.maxPixelRatio) * this.dynamicResolution.scale;
    this.renderer.setPixelRatio(ratio);
    this.renderer.setSize(this.container.clientWidth, this.container.clientHeight);
  }
}
