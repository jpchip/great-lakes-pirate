import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { GUI } from 'three/examples/jsm/libs/lil-gui.module.min.js';
import { fetchManifest } from '../../src/core/assets';
import { createAssetLoader } from '../../src/render/assets';
import { isQualityId, QUALITY_IDS, type QualityId } from '../../src/render/quality';
import { TIME_OF_DAY_IDS, type TimeOfDayId } from '../../src/render/style/time-of-day';
import { formatS4Report, runS4Bench, type S4Report } from './measure';
import {
  createStyleScene,
  VARIANT_IDS,
  VARIANTS,
  VIEW_IDS,
  type StyleSceneState,
  type VariantId,
  type ViewId,
} from './scene';

/**
 * Spike S4 page: `npm run dev`, then open /bench/s4/.
 *
 * - Look: orbit with the mouse; the panel switches style, time, fog and camera.
 * - Measure: the "Run benchmark" button, or open /bench/s4/?bench (about two minutes).
 *
 * Query options: `?variant=A|B0|B|B-edge&time=dusk|night&fog=1&view=hero|wide|beam`
 * set the start state, `?t=20` freezes the clock at 20 s (for screenshots), `?hud=0`
 * hides the panel and readout, `?quality=low|medium|high` picks the preset, and
 * `?bench&presets=medium` limits the benchmark to some presets.
 */

const params = new URLSearchParams(window.location.search);
const stage = document.getElementById('stage') as HTMLDivElement;
const status = document.getElementById('status') as HTMLDivElement;
const out = document.getElementById('out') as HTMLPreElement;
const thumbs = document.getElementById('thumbs') as HTMLDivElement;

const pick = <T extends string>(key: string, allowed: readonly T[], fallback: T): T => {
  const value = params.get(key);
  return value !== null && (allowed as readonly string[]).includes(value) ? (value as T) : fallback;
};

async function assetLoader() {
  // Assets live at the site root (public/), not next to this page.
  const url = new URL('/assets/manifest.json', window.location.origin).href;
  return createAssetLoader(await fetchManifest(url), url);
}

function showReport(report: S4Report): void {
  const text = formatS4Report(report);
  out.textContent = text;
  for (const t of report.thumbnails) {
    const figure = document.createElement('figure');
    const img = document.createElement('img');
    img.src = t.dataUrl;
    img.alt = t.label;
    const caption = document.createElement('figcaption');
    caption.textContent = t.label;
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
  (window as unknown as { s4: S4Report }).s4 = report;
}

async function bench(): Promise<void> {
  status.textContent = "Spike S4: starting… keep this tab in front and don't touch it.";
  const presets = (params.get('presets')?.split(',') ?? [...QUALITY_IDS]).filter(isQualityId);
  await new Promise((resolve) => setTimeout(resolve, 1000));
  try {
    const report = await runS4Bench(
      stage,
      (m) => (status.textContent = m),
      await assetLoader(),
      presets,
    );
    showReport(report);
    document.body.dataset['s4'] = 'done';
  } catch (err) {
    console.error(err);
    out.textContent = String(err);
    document.body.dataset['s4'] = 'failed';
  }
}

async function look(): Promise<void> {
  const quality: QualityId = pick('quality', QUALITY_IDS, 'medium');
  const initial: StyleSceneState = {
    variant: pick<VariantId>('variant', VARIANT_IDS, 'B'),
    time: pick<TimeOfDayId>('time', TIME_OF_DAY_IDS, 'dusk'),
    fog: params.get('fog') === '1',
    view: pick<ViewId>('view', VIEW_IDS, 'hero'),
    outlineWidth: Number(params.get('width')) || 2,
  };
  const scene = await createStyleScene(stage, quality, initial, await assetLoader());
  const gl = scene.renderer.renderer;
  const showHud = params.get('hud') !== '0';
  status.style.display = showHud ? '' : 'none';

  const controls = new OrbitControls(scene.camera, gl.domElement);
  const retarget = (): void => {
    // Keep orbiting about the point the preset view looks at.
    const forward = scene.camera.getWorldDirection(controls.target.clone());
    controls.target.copy(scene.camera.position).addScaledVector(forward, 40);
    controls.update();
  };
  retarget();
  window.addEventListener('resize', () => scene.resize());

  const frozen = params.has('t') ? Number(params.get('t')) : undefined;
  const ui = {
    variant: initial.variant,
    time: initial.time,
    fog: initial.fog,
    view: initial.view,
    outlineWidth: initial.outlineWidth,
    freeze: frozen !== undefined,
    quality,
    screenshot() {
      scene.frame(clock);
      const link = document.createElement('a');
      link.download = `s4-${scene.state.variant}-${scene.state.time}${scene.state.fog ? '-fog' : ''}-${scene.state.view}.png`;
      link.href = gl.domElement.toDataURL('image/png');
      link.click();
    },
    bench() {
      window.location.search = '?bench';
    },
  };
  if (showHud) {
    const gui = new GUI({ title: 'S4 style test' });
    const labels = Object.fromEntries(VARIANT_IDS.map((id) => [VARIANTS[id].label, id]));
    gui
      .add(ui, 'variant', labels)
      .name('Style')
      .onChange((variant: VariantId) => scene.set({ variant }));
    gui
      .add(ui, 'time', [...TIME_OF_DAY_IDS])
      .name('Time')
      .onChange((time: TimeOfDayId) => scene.set({ time }));
    gui
      .add(ui, 'fog')
      .name('Fog')
      .onChange((fog: boolean) => scene.set({ fog }));
    gui
      .add(ui, 'view', [...VIEW_IDS])
      .name('Camera')
      .onChange((view: ViewId) => {
        scene.setView(view);
        retarget();
      });
    gui
      .add(ui, 'outlineWidth', 1, 4, 0.5)
      .name('Outline px')
      .onChange((outlineWidth: number) => scene.set({ outlineWidth }));
    gui.add(ui, 'freeze').name('Freeze time');
    gui
      .add(ui, 'quality', [...QUALITY_IDS])
      .name('Preset (reloads)')
      .onChange((q: QualityId) => {
        params.set('quality', q);
        window.location.search = params.toString();
      });
    gui.add(ui, 'screenshot').name('Save screenshot');
    gui.add(ui, 'bench').name('Run benchmark');
  }

  let clock = frozen ?? 12;
  let last = performance.now();
  let smoothed = 16;
  const timer = scene.renderer.gpuTimer;
  const tick = (now: number): void => {
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    smoothed += (dt * 1000 - smoothed) * 0.05;
    if (!ui.freeze) clock += dt;
    controls.update();
    timer.poll();
    timer.begin();
    scene.frame(clock);
    timer.end();
    if (showHud) {
      const s = scene.renderer.stats();
      status.textContent =
        `${VARIANTS[scene.state.variant].label} · hull: ${scene.hullSource}\n` +
        `${s.width}×${s.height} · ${s.drawCalls} calls · ${(s.triangles / 1000).toFixed(1)}k tris\n` +
        `frame ${smoothed.toFixed(1)} ms` +
        (timer.lastMs !== undefined ? ` · GPU ${timer.lastMs.toFixed(2)} ms` : '');
    }
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
  document.body.dataset['s4'] = 'ready';
}

if (params.has('bench')) void bench();
else
  look().catch((err: unknown) => {
    console.error(err);
    status.textContent = String(err);
  });
