import { QUALITY_IDS, QUALITY_PRESETS, type QualityId } from '../../src/render/quality';
import { RIG_LABELS, type Rig, type RigId } from './rigs';

/**
 * Spike S1 measurements (plan 01 §11.2). Per renderer:
 * - startup: renderer init, and the first frame (shader or pipeline compile included);
 * - throughput: frames are submitted in batches of BATCH and the GPU is waited on once
 *   per batch, so the per-frame time is GPU-bound work plus the renderer's CPU cost,
 *   whichever is slower. "CPU ms" is the submit time alone;
 * - post-processing: the same with a bloom pass (EffectComposer vs. TSL RenderPipeline);
 * - stability: a SOAK_MS real-time run on requestAnimationFrame, counting hitches,
 *   plus every error or warning the page or the device logs.
 */

const WARMUP_FRAMES = 30;
const BATCH = 20;
const BATCHES = 8;
const SOAK_MS = 10_000;
/** A presented frame longer than this is a hitch (two missed 60 Hz vsyncs). */
const HITCH_MS = 1000 / 30 + 4;

export interface PresetRow {
  preset: QualityId;
  width: number;
  height: number;
  frameMs: number;
  cpuMs: number;
  triangles: number;
  drawCalls: number;
}

export interface RigResult {
  id: RigId;
  label: string;
  backend: string;
  gpu: string;
  initMs: number;
  firstFrameMs: number;
  rows: PresetRow[];
  bloomFirstFrameMs: number;
  /** Medium with bloom: full frame, ms. */
  bloomFrameMs: number;
  soak: { p50: number; p99: number; hitches: number; frames: number };
  errors: string[];
  thumbnail: string;
}

export interface Skipped {
  id: RigId;
  label: string;
  reason: string;
}

const nextTask = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));
const nextFrame = (): Promise<number> => new Promise((resolve) => requestAnimationFrame(resolve));

function quantile(values: number[], q: number): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * q))] ?? 0;
}

/** A sea clock that advances one 60 Hz step per frame, so every frame does real work. */
function seaClock(): () => number {
  let t = 12;
  return () => (t += 1 / 60);
}

async function throughput(
  rig: Rig,
  clock: () => number,
): Promise<{ frameMs: number; cpuMs: number }> {
  for (let i = 0; i < WARMUP_FRAMES; i++) rig.frame(clock());
  await rig.finish();
  await nextTask();
  const frame: number[] = [];
  const cpu: number[] = [];
  for (let b = 0; b < BATCHES; b++) {
    const t0 = performance.now();
    for (let i = 0; i < BATCH; i++) rig.frame(clock());
    const submitted = performance.now();
    await rig.finish();
    const done = performance.now();
    frame.push((done - t0) / BATCH);
    cpu.push((submitted - t0) / BATCH);
    await nextTask();
  }
  return { frameMs: quantile(frame, 0.5), cpuMs: quantile(cpu, 0.5) };
}

async function timedFrame(rig: Rig, clock: () => number): Promise<number> {
  const t0 = performance.now();
  rig.frame(clock());
  await rig.finish();
  return performance.now() - t0;
}

async function soak(rig: Rig, clock: () => number): Promise<RigResult['soak']> {
  const intervals: number[] = [];
  let last = await nextFrame();
  const end = last + SOAK_MS;
  while (last < end) {
    rig.frame(clock());
    const now = await nextFrame();
    intervals.push(now - last);
    last = now;
  }
  return {
    p50: quantile(intervals, 0.5),
    p99: quantile(intervals, 0.99),
    hitches: intervals.filter((ms) => ms > HITCH_MS).length,
    frames: intervals.length,
  };
}

/** Collects page errors and console errors/warnings while a rig runs. */
function watchErrors(): { stop(): string[] } {
  const seen: string[] = [];
  const { error, warn } = console;
  console.error = (...args: unknown[]) => {
    seen.push(`error: ${args.map(String).join(' ')}`);
    error.apply(console, args);
  };
  console.warn = (...args: unknown[]) => {
    seen.push(`warning: ${args.map(String).join(' ')}`);
    warn.apply(console, args);
  };
  const onError = (event: ErrorEvent): void => void seen.push(`uncaught: ${event.message}`);
  const onRejection = (event: PromiseRejectionEvent): void =>
    void seen.push(`unhandled rejection: ${String(event.reason)}`);
  window.addEventListener('error', onError);
  window.addEventListener('unhandledrejection', onRejection);
  return {
    stop() {
      console.error = error;
      console.warn = warn;
      window.removeEventListener('error', onError);
      window.removeEventListener('unhandledrejection', onRejection);
      return seen;
    },
  };
}

export async function measureRig(
  create: () => Rig | Promise<Rig>,
  onProgress: (message: string) => void,
): Promise<RigResult> {
  const errors = watchErrors();
  const clock = seaClock();
  let rig: Rig | undefined;
  try {
    rig = await create();
    const label = RIG_LABELS[rig.id];
    onProgress(`${label}: first frame…`);
    // The rig boots on Medium, the baseline preset.
    const firstFrameMs = await timedFrame(rig, clock);

    const rows: PresetRow[] = [];
    for (const id of QUALITY_IDS) {
      onProgress(`${label}: ${QUALITY_PRESETS[id].label}…`);
      rig.setPreset(QUALITY_PRESETS[id]);
      await timedFrame(rig, clock);
      const { frameMs, cpuMs } = await throughput(rig, clock);
      rig.frame(clock());
      const stats = rig.stats();
      rows.push({ preset: id, ...stats, frameMs, cpuMs });
    }

    onProgress(`${label}: bloom…`);
    rig.setPreset(QUALITY_PRESETS.medium);
    rig.setBloom(true);
    const bloomFirstFrameMs = await timedFrame(rig, clock);
    const { frameMs: bloomFrameMs } = await throughput(rig, clock);
    rig.setBloom(false);

    onProgress(`${label}: 10 s soak…`);
    const soaked = await soak(rig, clock);

    // A fixed sea time so the thumbnails are comparable side by side.
    rig.frame(12);
    // Read back in the same task as the render, before the canvas is presented.
    const thumbnail = rig.canvas.toDataURL('image/jpeg', 0.8);
    await rig.finish();

    return {
      id: rig.id,
      label,
      backend: rig.backend,
      gpu: rig.gpu,
      initMs: rig.initMs,
      firstFrameMs,
      rows,
      bloomFirstFrameMs,
      bloomFrameMs,
      soak: soaked,
      errors: [...rig.deviceErrors, ...errors.stop()],
      thumbnail,
    };
  } finally {
    errors.stop();
    rig?.dispose();
  }
}

export interface S1Report {
  userAgent: string;
  date: string;
  devicePixelRatio: number;
  webgpu: string;
  results: RigResult[];
  skipped: Skipped[];
}

/** Markdown, ready to paste into the S1 write-up. */
export function formatReport(report: S1Report): string {
  const f = (ms: number): string => ms.toFixed(1);
  const row = (r: RigResult, id: QualityId): PresetRow | undefined =>
    r.rows.find((x) => x.preset === id);
  const ms = (r: RigResult, id: QualityId): string => {
    const x = row(r, id);
    return x ? f(x.frameMs) : '–';
  };
  const lines = [
    `Browser: ${report.userAgent}`,
    `Date: ${report.date}`,
    `Device pixel ratio: ${report.devicePixelRatio}`,
    `WebGPU: ${report.webgpu}`,
    ...report.results.map((r) => `GPU (${r.label}, ${r.backend}): ${r.gpu}`),
    '',
    '| Renderer | Backend | Init ms | First frame ms | Low ms | Medium ms | High ms | Medium CPU ms | Medium + bloom ms | Bloom first frame ms | Soak p50 / p99 ms | Hitches | Errors |',
    '|---|---|---|---|---|---|---|---|---|---|---|---|---|',
    ...report.results.map(
      (r) =>
        `| ${r.label} | ${r.backend} | ${f(r.initMs)} | ${f(r.firstFrameMs)} | ${ms(r, 'low')} | ${ms(r, 'medium')} | ${ms(r, 'high')} | ${f(row(r, 'medium')?.cpuMs ?? 0)} | ${f(r.bloomFrameMs)} | ${f(r.bloomFirstFrameMs)} | ${f(r.soak.p50)} / ${f(r.soak.p99)} | ${r.soak.hitches} of ${r.soak.frames} | ${r.errors.length} |`,
    ),
    ...report.skipped.map((s) => `| ${s.label} | skipped: ${s.reason} | | | | | | | | | | | |`),
    '',
    '| Renderer | Preset | Buffer | Frame ms | CPU ms | Triangles | Draw calls |',
    '|---|---|---|---|---|---|---|',
    ...report.results.flatMap((r) =>
      r.rows.map(
        (x) =>
          `| ${r.label} | ${x.preset} | ${x.width}×${x.height} | ${f(x.frameMs)} | ${f(x.cpuMs)} | ${x.triangles} | ${x.drawCalls} |`,
      ),
    ),
  ];
  const errors = report.results.filter((r) => r.errors.length > 0);
  if (errors.length > 0) {
    lines.push('', 'Errors and warnings:');
    for (const r of errors) {
      // Repeats are common (one per frame); list each message once with a count.
      const counts = new Map<string, number>();
      for (const e of r.errors) counts.set(e.slice(0, 300), (counts.get(e.slice(0, 300)) ?? 0) + 1);
      for (const [message, count] of counts) lines.push(`- ${r.label}: ${message} (×${count})`);
    }
  }
  return lines.join('\n');
}
