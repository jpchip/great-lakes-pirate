import { QUALITY_PRESETS } from '../../src/render/quality';
import { formatReport, measureRig, type RigResult, type S1Report, type Skipped } from './measure';
import { createWebGLRig, createWebGPURig, RIG_LABELS, type RigId } from './rigs';

/**
 * Spike S1 page: `npm run dev`, then open /bench/s1/. `?only=webgl,webgpu` runs a subset.
 * Rigs run one after another, each on a fresh canvas, so they never share a context.
 */

const stage = document.getElementById('stage') as HTMLDivElement;
const status = document.getElementById('status') as HTMLDivElement;
const out = document.getElementById('out') as HTMLPreElement;
const thumbs = document.getElementById('thumbs') as HTMLDivElement;

const ALL: RigId[] = ['webgl', 'webgpu', 'webgpu-gl'];

async function webgpuSupport(): Promise<{ ok: boolean; summary: string }> {
  if (!('gpu' in navigator)) return { ok: false, summary: 'navigator.gpu missing' };
  try {
    const adapter = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' });
    if (!adapter) return { ok: false, summary: 'navigator.gpu present, but no adapter' };
    const { vendor, architecture, description } = adapter.info;
    const fallback = (adapter.info as { isFallbackAdapter?: boolean }).isFallbackAdapter;
    const name = [vendor, architecture, description].filter(Boolean).join(' / ');
    return {
      ok: true,
      summary: `adapter ${name || '(info hidden)'}${fallback ? ', software fallback adapter' : ''}`,
    };
  } catch (err) {
    return { ok: false, summary: `requestAdapter failed: ${String(err)}` };
  }
}

async function run(): Promise<S1Report> {
  const only = new URLSearchParams(window.location.search).get('only');
  const ids = only ? ALL.filter((id) => only.split(',').includes(id)) : ALL;
  const support = await webgpuSupport();
  const medium = QUALITY_PRESETS.medium;
  const progress = (message: string): void => void (status.textContent = message);

  const results: RigResult[] = [];
  const skipped: Skipped[] = [];
  for (const id of ids) {
    if (id === 'webgpu' && !support.ok) {
      // WebGPURenderer would quietly fall back to WebGL2; the webgpu-gl row covers that.
      skipped.push({ id, label: RIG_LABELS[id], reason: support.summary });
      continue;
    }
    try {
      results.push(
        await measureRig(
          () =>
            id === 'webgl'
              ? createWebGLRig(stage, medium)
              : createWebGPURig(stage, medium, id === 'webgpu-gl'),
          progress,
        ),
      );
    } catch (err) {
      console.error(err);
      skipped.push({ id, label: RIG_LABELS[id], reason: `crashed: ${String(err)}` });
    }
  }

  return {
    userAgent: navigator.userAgent,
    date: new Date().toISOString(),
    devicePixelRatio: window.devicePixelRatio,
    webgpu: support.summary,
    results,
    skipped,
  };
}

function show(report: S1Report): void {
  const text = formatReport(report);
  out.textContent = text;
  for (const r of report.results) {
    const figure = document.createElement('figure');
    const img = document.createElement('img');
    img.src = r.thumbnail;
    img.alt = r.label;
    const caption = document.createElement('figcaption');
    caption.textContent = `${r.label} (${r.backend})`;
    figure.append(img, caption);
    thumbs.append(figure);
  }
  document.getElementById('copy')?.addEventListener('click', () => {
    const copied = document.getElementById('copied') as HTMLSpanElement;
    navigator.clipboard.writeText(text).then(
      () => (copied.textContent = 'Copied.'),
      () => (copied.textContent = 'Copy failed; select the text below instead.'),
    );
  });
  (window as unknown as { s1: S1Report }).s1 = report;
}

// Let the page settle (fonts, devtools) before timing anything.
setTimeout(() => {
  run().then(
    (report) => {
      show(report);
      document.body.dataset['s1'] = 'done';
    },
    (err: unknown) => {
      out.textContent = String(err);
      document.body.dataset['s1'] = 'failed';
    },
  );
}, 1000);
