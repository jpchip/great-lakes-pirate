import type { GameRenderer } from '../render/renderer';
import { QUALITY_IDS, type QualityId } from '../render/quality';
import type { TestScene } from '../render/test-scene';
import { DEFAULT_COMPRESSION, sceneSpeed } from '../core/coords';
import { R_SAILING } from '../core/time';
import { FULL_SAIL } from '../sim/sailing/controller';

/**
 * Spike S2 water benchmark (plan 04 §16), extended for Phase 1 piece F. For each preset
 * it times full frames with everything on, then with one feature off at a time (crest
 * foam, depth bands and shore foam, the wind cues, the wake and spray), and with the
 * water, wake and spray all hidden; each cost is the difference. Frames are timed on the
 * CPU around render plus a 1-pixel readPixels, which waits for the GPU to finish, so it
 * measures GPU time without the timer extension. Results are rough (±0.3 ms); run it a
 * few times on the baseline laptop.
 *
 * So the wake has something to draw, it first puts the player's ship under full sail
 * and lets it sail for WAKE_BUILD_S if it isn't already moving.
 *
 * Phase 2 piece C adds the land: the terrain and the vegetation are each timed by hiding
 * them. Hiding the terrain also uncovers water it was hiding, so its column reads a little
 * low; the vegetation column is clean.
 */

const WARMUP_FRAMES = 20;
const FRAMES = 150;
const WAKE_BUILD_S = 20;
/** Scene speed (m/s) that counts as already sailing. */
const SAILING_MS = 2;

export interface WaterBenchRow {
  preset: QualityId;
  width: number;
  height: number;
  waves: number;
  /** Median full-frame time, ms. */
  frameMs: number;
  /** Median with crest foam off. */
  noFoamMs: number;
  /** Median with the water, wake and spray hidden. */
  noWaterMs: number;
  /** frameMs − noWaterMs: everything on the water. */
  waterMs: number;
  /** frameMs − noFoamMs. */
  foamMs: number;
  /** Depth bands and shore foam: frameMs − the median with them off. */
  shoreMs: number;
  /** Cat's-paws and wind streaks. */
  windCuesMs: number;
  /** Bow wave and wake ribbons plus spray. */
  wakeMs: number;
  /** The terrain shader and meshes: frameMs − the median with the terrain hidden. */
  terrainMs: number;
  /** Trees and rocks, meshes and impostors: frameMs − the median with them hidden. */
  vegetationMs: number;
  triangles: number;
  drawCalls: number;
}

export interface WaterBenchResult {
  gpu: string;
  /** MSAA is fixed at context creation, so every row shares the boot preset's setting. */
  antialias: boolean;
  userAgent: string;
  date: string;
  rows: WaterBenchRow[];
}

const nextTask = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));
const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)] ?? 0;
}

function gpuName(gl: WebGLRenderingContext | WebGL2RenderingContext): string {
  const info = gl.getExtension('WEBGL_debug_renderer_info');
  return String(gl.getParameter(info ? info.UNMASKED_RENDERER_WEBGL : gl.RENDERER));
}

export async function runWaterBench(
  renderer: GameRenderer,
  scene: TestScene,
  onProgress?: (message: string) => void,
): Promise<WaterBenchResult> {
  const gl = renderer.renderer.getContext();
  const pixel = new Uint8Array(4);
  const startPreset = renderer.preset.id;
  const startDynamic = renderer.dynamicResolution.enabled;
  const uniforms = scene.water.material.uniforms;
  const foam = uniforms.uCrestFoam;
  const shore = uniforms.uShoreOn;

  // Get the ship moving so the wake and spray are on screen.
  const ships = [...scene.wakes.keys()].filter((e) => e.playerControlled && e.sailing);
  if (
    ships.every(
      (e) =>
        Math.abs(sceneSpeed(e.sailing?.state.speed ?? 0, R_SAILING, DEFAULT_COMPRESSION)) <
        SAILING_MS,
    )
  ) {
    for (const e of ships) if (e.sailing) e.sailing.state.sailLevel = FULL_SAIL;
    onProgress?.(`Sailing for ${WAKE_BUILD_S} s to build a wake…`);
    await sleep(WAKE_BUILD_S * 1000);
  }
  renderer.dynamicResolution.enabled = false;

  const time = (frames: number): number[] => {
    const samples: number[] = [];
    for (let i = 0; i < frames; i++) {
      const t0 = performance.now();
      // frameSeconds = 0 keeps dynamic resolution and the sea clock still.
      scene.render(1, 0, 0);
      gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
      samples.push(performance.now() - t0);
    }
    return samples;
  };
  const measure = async (): Promise<number> => {
    time(WARMUP_FRAMES);
    await nextTask();
    return median(time(FRAMES));
  };

  const setWakes = (visible: boolean): void => {
    for (const wake of scene.wakes.values()) wake.mesh.visible = visible;
    scene.spray.points.visible = visible && renderer.preset.sprayParticles > 0;
  };

  const rows: WaterBenchRow[] = [];
  try {
    for (const id of QUALITY_IDS) {
      onProgress?.(`Measuring ${id}…`);
      renderer.setQuality(id);
      const stored = foam.value;
      const frameMs = await measure();
      const stats = renderer.stats();
      foam.value = 0;
      const noFoamMs = await measure();
      foam.value = stored;
      const shoreStored = shore.value;
      shore.value = 0;
      const noShoreMs = await measure();
      shore.value = shoreStored;
      scene.windCues.enabled = false;
      const noCuesMs = await measure();
      scene.windCues.enabled = true;
      const land = scene.terrain?.group;
      const plants = scene.vegetation?.group;
      if (plants) plants.visible = false;
      const noVegetationMs = plants ? await measure() : frameMs;
      if (plants) plants.visible = true;
      if (land) land.visible = false;
      const noTerrainMs = land ? await measure() : frameMs;
      if (land) land.visible = true;
      setWakes(false);
      const noWakeMs = await measure();
      scene.water.mesh.visible = false;
      const noWaterMs = await measure();
      scene.water.mesh.visible = true;
      setWakes(true);
      rows.push({
        preset: id,
        width: stats.width,
        height: stats.height,
        waves: renderer.preset.waveCount,
        frameMs,
        noFoamMs,
        noWaterMs,
        waterMs: frameMs - noWaterMs,
        foamMs: frameMs - noFoamMs,
        shoreMs: frameMs - noShoreMs,
        windCuesMs: frameMs - noCuesMs,
        wakeMs: frameMs - noWakeMs,
        terrainMs: frameMs - noTerrainMs,
        vegetationMs: frameMs - noVegetationMs,
        triangles: stats.triangles,
        drawCalls: stats.drawCalls,
      });
    }
  } finally {
    scene.water.mesh.visible = true;
    scene.windCues.enabled = true;
    if (scene.terrain) scene.terrain.group.visible = true;
    if (scene.vegetation) scene.vegetation.group.visible = true;
    setWakes(true);
    renderer.setQuality(startPreset);
    renderer.dynamicResolution.enabled = startDynamic;
  }

  return {
    gpu: gpuName(gl),
    antialias: gl.getContextAttributes()?.antialias ?? false,
    userAgent: navigator.userAgent,
    date: new Date().toISOString(),
    rows,
  };
}

/** A Markdown table, ready to paste into the S2 write-up. */
export function formatWaterBench(result: WaterBenchResult): string {
  const f = (ms: number): string => ms.toFixed(2);
  return [
    `GPU: ${result.gpu}`,
    `Browser: ${result.userAgent}`,
    `MSAA: ${result.antialias ? 'on' : 'off'}`,
    `Date: ${result.date}`,
    '',
    '| Preset | Buffer | Waves | Frame ms | Water ms | Crest foam ms | Shore ms | Wind cues ms | Wake ms | No water ms | Terrain ms | Vegetation ms | Triangles | Draw calls |',
    '|---|---|---|---|---|---|---|---|---|---|---|---|---|---|',
    ...result.rows.map(
      (r) =>
        `| ${r.preset} | ${r.width}×${r.height} | ${r.waves} | ${f(r.frameMs)} | ${f(r.waterMs)} | ${f(r.foamMs)} | ${f(r.shoreMs)} | ${f(r.windCuesMs)} | ${f(r.wakeMs)} | ${f(r.noWaterMs)} | ${f(r.terrainMs)} | ${f(r.vegetationMs)} | ${r.triangles} | ${r.drawCalls} |`,
    ),
  ].join('\n');
}
