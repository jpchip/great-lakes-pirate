import { Rng } from '../../src/core/rng';
import { ChartView, type ChartFrame } from '../../src/render/chart/chart-view';
import { westernSuperiorChart } from '../../src/sim/chart/chart-data';
import { createContacts, spotRangeM } from '../../src/sim/chart/traffic';
import { weatherPicture } from '../../src/sim/chart/chart-weather';
import { advanceWeather, createWeatherState } from '../../src/sim/weather/weather';

/**
 * Chart redraw bench (plan 03 §20 piece B, criterion 9: the chart redraws in at most 8 ms
 * p95). Open /bench/chart/ on the laptop with `npm run dev`, or run `npm run bench:chart`
 * for headless Chromium. Three passes at two zooms (the whole chart and the Apostles):
 *
 * - still: the view holds, so the static layer (coast, depths, soundings, graticule) is
 *   copied from its offscreen canvas and only ships, lights and the course are drawn.
 * - panning: the view moves every frame, as in a drag, so the last static layer is
 *   shifted into place.
 * - redraw: the static layer is redrawn every frame, which is what one frame costs when
 *   the view settles after a drag or a zoom.
 *
 * - weather tick: the weather picture changes every frame, so the weather overlay (Phase 3
 *   piece E) is drawn again. Under way that happens once per world tick, about twice a
 *   real second at the default clock.
 *
 * The weather is a November gale with lows about (seed `shot-3`, game day 26, 14:00);
 * `?noweather` leaves it off. `?night` draws at night (the light rings on top).
 */

const params = new URLSearchParams(window.location.search);
const FRAMES = Number(params.get('frames') ?? 240);
const out = document.getElementById('out') as HTMLPreElement;
const canvas = document.getElementById('chart') as HTMLCanvasElement;
const view = new ChartView(canvas);
const geo = westernSuperiorChart();
const contacts = createContacts(geo.projection, Rng.fromSeed('bench'));
const hour = params.has('night') ? 22 : 12;
const sky = createWeatherState('bench-weather', 26 * 86_400);
const skyAt = 26 * 86_400 + 14 * 3600;
advanceWeather(sky, skyAt);
const pictureStart = performance.now();
const picture = weatherPicture(sky, geo, skyAt);
const pictureMs = performance.now() - pictureStart;
const pictures = [picture, weatherPicture(sky, geo, skyAt + 1800)];
const frame: ChartFrame = {
  geo,
  position: geo.projection.geoToChart({ lat: 46.8, lon: -91.96 }),
  heading: Math.PI / 3,
  course: undefined,
  voyage: undefined,
  contacts,
  now: 0,
  daylight: params.has('night') ? 0 : 1,
  spotRangeM: spotRangeM(hour),
  visible: new Set(contacts.map((c) => c.id)),
  hoverWaypoint: undefined,
  etaLabel: undefined,
  weather: params.has('noweather') ? undefined : picture,
};

interface Pass {
  name: string;
  setup: () => void;
  step: (i: number) => void;
}

const pan = (i: number) => view.panBy(i % 2 ? 2 : -2, 1);

const fitAll = () => view.fit(geo.charted.min, geo.charted.max);
const zoomApostles = () => {
  fitAll();
  view.center = geo.projection.geoToChart({ lat: 46.88, lon: -90.72 });
  view.metersPerPx = 45;
};
const passes: Pass[] = [
  { name: 'full chart, still', setup: fitAll, step: () => {} },
  { name: 'full chart, panning', setup: fitAll, step: pan },
  { name: 'full chart, redraw', setup: fitAll, step: () => view.invalidate() },
  { name: 'Apostles zoom, still', setup: zoomApostles, step: () => {} },
  { name: 'Apostles zoom, panning', setup: zoomApostles, step: pan },
  { name: 'Apostles zoom, redraw', setup: zoomApostles, step: () => view.invalidate() },
  {
    name: 'full chart, weather tick',
    setup: fitAll,
    step: (i) => (frame.weather = frame.weather && pictures[i % 2]),
  },
];

const nextFrame = () => new Promise<void>((r) => requestAnimationFrame(() => r()));
const pct = (sorted: number[], p: number) =>
  sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))] ?? NaN;

async function run(): Promise<void> {
  const lines = [
    `Chart redraw bench, ${canvas.clientWidth}×${canvas.clientHeight} CSS px at ${window.devicePixelRatio}× (${frame.daylight ? 'day' : 'night'})`,
    `${geo.water.points.length} lake points, ${geo.islands.length} islands, ${geo.soundings.length} soundings`,
    frame.weather
      ? `Weather: ${picture.cells.length} squalls, ${picture.fogBanks.length} fog banks, ${picture.centres.length} systems; sampling the sim took ${pictureMs.toFixed(1)} ms`
      : 'No weather',
    '',
  ];
  const results: Record<string, { median: number; p95: number; layerDraws: number }> = {};
  for (const pass of passes) {
    pass.setup();
    view.invalidate();
    for (let i = 0; i < 10; i++) view.draw(frame); // warm up
    const before = view.layerDraws;
    const times: number[] = [];
    for (let i = 0; i < FRAMES; i++) {
      pass.step(i);
      const t = performance.now();
      view.draw(frame);
      times.push(performance.now() - t);
      if (i % 30 === 0) await nextFrame();
    }
    times.sort((a, b) => a - b);
    const r = {
      median: pct(times, 0.5),
      p95: pct(times, 0.95),
      layerDraws: view.layerDraws - before,
    };
    results[pass.name] = r;
    lines.push(
      `${pass.name.padEnd(24)} median ${r.median.toFixed(2).padStart(6)} ms   p95 ${r.p95.toFixed(2).padStart(6)} ms   (static layer redrawn ${r.layerDraws}×)`,
    );
    out.textContent = lines.join('\n');
  }
  lines.push(
    '',
    'Target: p95 ≤ 8 ms still and panning (plan 03 §20.3, criterion 9). A redraw happens',
    'once, when the view settles after a drag or a zoom.',
  );
  out.textContent = lines.join('\n');
  (window as unknown as { benchResult: unknown }).benchResult = results;
  document.body.dataset['bench'] = 'done';
}

void run();
