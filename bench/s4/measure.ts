import { QUALITY_IDS, QUALITY_PRESETS, type QualityId } from '../../src/render/quality';
import {
  TIME_OF_DAY_IDS,
  TIMES_OF_DAY,
  type TimeOfDayId,
} from '../../src/render/style/time-of-day';
import type { AssetLoader } from '../../src/core/assets';
import { createStyleScene, VARIANT_IDS, VARIANTS, type VariantId } from './scene';

/**
 * Spike S4 cost measurement (plan 14 §3.3, "GPU frame time on the baseline laptop").
 * For each quality preset it builds the test scene on a fresh canvas and, for every
 * variant × time of day × fog, submits frames in batches of BATCH with one GPU sync per
 * batch (as S1 does), so a frame's time is the GPU work or the CPU submit, whichever is
 * slower. Compare variants within one run, not with other benches.
 */

const WARMUP_FRAMES = 30;
const BATCH = 20;
const BATCHES = 8;

export interface CaseRow {
  preset: QualityId;
  variant: VariantId;
  time: TimeOfDayId;
  fog: boolean;
  frameMs: number;
  cpuMs: number;
  drawCalls: number;
  triangles: number;
}

export interface Thumbnail {
  label: string;
  dataUrl: string;
}

export interface S4Report {
  gpu: string;
  userAgent: string;
  date: string;
  hullSource: 'pipeline' | 'placeholder';
  buffers: Partial<Record<QualityId, { width: number; height: number; antialias: boolean }>>;
  rows: CaseRow[];
  thumbnails: Thumbnail[];
  errors: string[];
}

const nextTask = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)] ?? 0;
}

function gpuName(gl: WebGL2RenderingContext): string {
  const info = gl.getExtension('WEBGL_debug_renderer_info');
  return String(gl.getParameter(info ? info.UNMASKED_RENDERER_WEBGL : gl.RENDERER));
}

export async function runS4Bench(
  stage: HTMLElement,
  onProgress: (message: string) => void,
  assets?: AssetLoader,
  presets: readonly QualityId[] = QUALITY_IDS,
): Promise<S4Report> {
  const errors: string[] = [];
  const onError = (event: ErrorEvent): void => void errors.push(`uncaught: ${event.message}`);
  window.addEventListener('error', onError);
  const report: S4Report = {
    gpu: '',
    userAgent: navigator.userAgent,
    date: new Date().toISOString(),
    hullSource: 'placeholder',
    buffers: {},
    rows: [],
    thumbnails: [],
    errors,
  };
  let seaTime = 12;
  const pixel = new Uint8Array(4);

  try {
    for (const preset of presets) {
      const scene = await createStyleScene(
        stage,
        preset,
        { variant: 'A', time: 'dusk', fog: false, view: 'hero', outlineWidth: 2 },
        assets,
      );
      const gl = scene.renderer.renderer.getContext() as WebGL2RenderingContext;
      const sync = (): void => gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
      report.gpu = gpuName(gl);
      report.hullSource = scene.hullSource;
      const stats = scene.renderer.stats();
      report.buffers[preset] = {
        width: stats.width,
        height: stats.height,
        antialias: QUALITY_PRESETS[preset].antialias,
      };

      for (const variant of VARIANT_IDS) {
        for (const time of TIME_OF_DAY_IDS) {
          for (const fog of [false, true]) {
            onProgress(
              `${QUALITY_PRESETS[preset].label}: ${VARIANTS[variant].label}, ` +
                `${TIMES_OF_DAY[time].label}, fog ${fog ? 'on' : 'off'}`,
            );
            scene.set({ variant, time, fog });
            for (let i = 0; i < WARMUP_FRAMES; i++) scene.frame((seaTime += 1 / 60));
            sync();
            await nextTask();
            const frame: number[] = [];
            const cpu: number[] = [];
            for (let b = 0; b < BATCHES; b++) {
              const t0 = performance.now();
              for (let i = 0; i < BATCH; i++) scene.frame((seaTime += 1 / 60));
              const submitted = performance.now();
              sync();
              const done = performance.now();
              frame.push((done - t0) / BATCH);
              cpu.push((submitted - t0) / BATCH);
              await nextTask();
            }
            const info = scene.renderer.renderer.info.render;
            report.rows.push({
              preset,
              variant,
              time,
              fog,
              frameMs: median(frame),
              cpuMs: median(cpu),
              drawCalls: info.calls,
              triangles: info.triangles,
            });
            if (preset === 'medium' && ((time === 'dusk' && !fog) || (time === 'night' && fog))) {
              scene.frame(seaTime);
              report.thumbnails.push({
                label: `${VARIANTS[variant].label}, ${TIMES_OF_DAY[time].label}${fog ? ', fog' : ''}`,
                dataUrl: scene.renderer.renderer.domElement.toDataURL('image/jpeg', 0.85),
              });
            }
          }
        }
      }
      scene.dispose();
      await nextTask();
    }
  } finally {
    window.removeEventListener('error', onError);
  }
  return report;
}

const fmt = (ms: number): string => ms.toFixed(2);
const delta = (ms: number, base: number): string =>
  `${fmt(ms)} (${ms - base >= 0 ? '+' : ''}${fmt(ms - base)})`;

/** Markdown, ready to paste into plan 14. */
export function formatS4Report(report: S4Report): string {
  const lines: string[] = [
    `S4 style test, ${report.date.slice(0, 10)}`,
    `GPU: ${report.gpu}`,
    `Browser: ${report.userAgent}`,
    `Hull: ${report.hullSource === 'pipeline' ? 'pipeline GLB (Meshy)' : 'procedural placeholder'}`,
    '',
    'Buffers: ' +
      Object.entries(report.buffers)
        .map(([p, b]) => `${p} ${b.width}×${b.height}${b.antialias ? ' MSAA' : ''}`)
        .join(', '),
    '',
    'Frame ms (median of batched frames); in brackets, the difference from A.',
    '',
    '| Preset | Time | Fog | A flat | B no outline | B hull outline | B edge pass |',
    '|---|---|---|---|---|---|---|',
  ];
  const find = (p: QualityId, v: VariantId, t: TimeOfDayId, f: boolean): CaseRow | undefined =>
    report.rows.find((r) => r.preset === p && r.variant === v && r.time === t && r.fog === f);
  for (const preset of QUALITY_IDS) {
    for (const time of TIME_OF_DAY_IDS) {
      for (const fog of [false, true]) {
        const a = find(preset, 'A', time, fog);
        if (!a) continue;
        const cells = VARIANT_IDS.map((v) => {
          const row = find(preset, v, time, fog);
          if (!row) return '–';
          return v === 'A' ? fmt(row.frameMs) : delta(row.frameMs, a.frameMs);
        });
        lines.push(`| ${preset} | ${time} | ${fog ? 'on' : 'off'} | ${cells.join(' | ')} |`);
      }
    }
  }
  lines.push('', '| Preset | Variant | Draw calls | Triangles | CPU ms |', '|---|---|---|---|---|');
  for (const preset of QUALITY_IDS) {
    for (const v of VARIANT_IDS) {
      const row = find(preset, v, 'night', false);
      if (row) {
        lines.push(
          `| ${preset} | ${VARIANTS[v].label} | ${row.drawCalls} | ${row.triangles} | ${fmt(row.cpuMs)} |`,
        );
      }
    }
  }
  if (report.errors.length) lines.push('', 'Errors:', ...report.errors.map((e) => `- ${e}`));
  return lines.join('\n');
}
