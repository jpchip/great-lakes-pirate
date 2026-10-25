import type { Chart } from '../../core/coords';
import { WORLD_TICK_GAME_SECONDS, calendarDate, dayAndHour } from '../../core/time';
import {
  LAKE_BOUNDS,
  PROBES,
  RADIATION_FOG_SITES,
  WEATHER_DOMAIN,
  WESTERN_SUPERIOR,
} from '../../sim/weather/geography';
import {
  airTempAt,
  barometerAt,
  lifecycle,
  livingSystems,
  precipitationAt,
  pressureAt,
  visibilityAt,
  windAt,
  type WeatherState,
} from '../../sim/weather/weather';
import {
  GALE_KN,
  THICK_FOG_M,
  monthStats,
  runSeason,
  trendOutlook,
  type ProbeSeries,
  type SeasonRun,
} from './season';

/**
 * Prototype S9 chart page (plan 04 §20): runs a season of weather and lets you scrub
 * through it. Dev-only; open /weather-sim.html with `npm run dev`. `?seed=` and
 * `?day=` pick the run and the moment, which the screenshots in the write-up use.
 */

const SEASON_DAYS = 30;
const params = new URLSearchParams(window.location.search);

const synoptic = document.getElementById('synoptic') as HTMLCanvasElement;
const lake = document.getElementById('lake') as HTMLCanvasElement;
const strip = document.getElementById('strip') as HTMLCanvasElement;
const panel = document.getElementById('panel') as HTMLDivElement;

let run: SeasonRun;
let probeIndex = 0;
/** Game seconds being shown. */
let now = 0;
let playing = false;
/** Game hours per real second while playing. */
let speed = 3;

// ---------------------------------------------------------------------------------
// Helpers

interface View {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  /** Canvas pixels per chart meter, and the offset that centers the view. */
  scale: number;
  ox: number;
  oy: number;
}

function fit(canvas: HTMLCanvasElement, box: Omit<View, 'scale' | 'ox' | 'oy'>): View {
  const w = canvas.width;
  const h = canvas.height;
  const scale = Math.min(w / (box.maxX - box.minX), h / (box.maxY - box.minY));
  return {
    ...box,
    scale,
    ox: (w - (box.maxX - box.minX) * scale) / 2,
    oy: (h - (box.maxY - box.minY) * scale) / 2,
  };
}

const px = (v: View, p: Chart): [number, number] => [
  v.ox + (p.x - v.minX) * v.scale,
  v.oy + (v.maxY - p.y) * v.scale,
];
const chartAt = (v: View, x: number, y: number): Chart => ({
  x: v.minX + (x - v.ox) / v.scale,
  y: v.maxY - (y - v.oy) / v.scale,
});

function resize(canvas: HTMLCanvasElement): CanvasRenderingContext2D {
  const r = canvas.getBoundingClientRect();
  const dpr = Math.min(window.devicePixelRatio, 2);
  const w = Math.max(1, Math.round(r.width * dpr));
  const h = Math.max(1, Math.round(r.height * dpr));
  if (canvas.width !== w || canvas.height !== h) {
    canvas.width = w;
    canvas.height = h;
  }
  return canvas.getContext('2d') as CanvasRenderingContext2D;
}

function windColor(kn: number): string {
  if (kn < 10) return '#8fc3e8';
  if (kn < 20) return '#8fe0a0';
  if (kn < 28) return '#f0e07a';
  if (kn < GALE_KN) return '#f4a65a';
  return '#ff5a4f';
}

function arrow(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  toX: number,
  toY: number,
  len: number,
  color: string,
): void {
  const m = Math.hypot(toX, toY);
  if (m < 1e-6) return;
  // Chart y is north-up; the canvas is y-down.
  const dx = (toX / m) * len;
  const dy = (-toY / m) * len;
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = Math.max(1, len / 12);
  ctx.beginPath();
  ctx.moveTo(x - dx / 2, y - dy / 2);
  ctx.lineTo(x + dx / 2, y + dy / 2);
  ctx.stroke();
  const a = Math.atan2(dy, dx);
  const head = Math.max(4, len / 3.5);
  ctx.beginPath();
  ctx.moveTo(x + dx / 2, y + dy / 2);
  ctx.lineTo(x + dx / 2 - head * Math.cos(a - 0.45), y + dy / 2 - head * Math.sin(a - 0.45));
  ctx.lineTo(x + dx / 2 - head * Math.cos(a + 0.45), y + dy / 2 - head * Math.sin(a + 0.45));
  ctx.closePath();
  ctx.fill();
}

function polygon(ctx: CanvasRenderingContext2D, v: View, poly: readonly Chart[]): void {
  ctx.beginPath();
  poly.forEach((p, i) => {
    const [x, y] = px(v, p);
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.closePath();
}

/** Marching squares over a grid of values; draws line segments where `level` is crossed. */
function contour(
  ctx: CanvasRenderingContext2D,
  grid: Float32Array,
  nx: number,
  ny: number,
  cellW: number,
  cellH: number,
  x0: number,
  y0: number,
  level: number,
): void {
  const at = (i: number, j: number) => grid[j * nx + i] as number;
  ctx.beginPath();
  for (let j = 0; j < ny - 1; j++) {
    for (let i = 0; i < nx - 1; i++) {
      const a = at(i, j);
      const b = at(i + 1, j);
      const c = at(i + 1, j + 1);
      const d = at(i, j + 1);
      const pts: [number, number][] = [];
      const edge = (va: number, vb: number, xa: number, ya: number, xb: number, yb: number) => {
        if (va < level !== vb < level) {
          const t = (level - va) / (vb - va);
          pts.push([x0 + (xa + (xb - xa) * t) * cellW, y0 + (ya + (yb - ya) * t) * cellH]);
        }
      };
      edge(a, b, i, j, i + 1, j);
      edge(b, c, i + 1, j, i + 1, j + 1);
      edge(c, d, i + 1, j + 1, i, j + 1);
      edge(d, a, i, j + 1, i, j);
      for (let k = 0; k + 1 < pts.length; k += 2) {
        const p = pts[k] as [number, number];
        const q = pts[k + 1] as [number, number];
        ctx.moveTo(p[0], p[1]);
        ctx.lineTo(q[0], q[1]);
      }
    }
  }
  ctx.stroke();
}

// ---------------------------------------------------------------------------------
// State at the current moment

function indexAt(t: number): number {
  return Math.max(0, Math.min(run.ticks - 1, Math.floor(t / WORLD_TICK_GAME_SECONDS) - 1));
}

function stateAt(t: number): WeatherState {
  return (run.snapshots as WeatherState[])[indexAt(t)] as WeatherState;
}

// ---------------------------------------------------------------------------------
// Drawing

function drawSynoptic(state: WeatherState, t: number): void {
  const ctx = resize(synoptic);
  const v = fit(synoptic, WEATHER_DOMAIN);
  ctx.clearRect(0, 0, synoptic.width, synoptic.height);

  // Pressure shading and isobars on a coarse grid.
  const nx = 97;
  const ny = 73;
  const grid = new Float32Array(nx * ny);
  const cellW = ((WEATHER_DOMAIN.maxX - WEATHER_DOMAIN.minX) * v.scale) / (nx - 1);
  const cellH = ((WEATHER_DOMAIN.maxY - WEATHER_DOMAIN.minY) * v.scale) / (ny - 1);
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) {
      grid[j * nx + i] = pressureAt(state, chartAt(v, v.ox + i * cellW, v.oy + j * cellH), t);
    }
  }
  const img = ctx.createImageData(nx, ny);
  for (let k = 0; k < nx * ny; k++) {
    const d = ((grid[k] as number) - 1013) / 25;
    const low = Math.max(0, Math.min(1, -d));
    const high = Math.max(0, Math.min(1, d));
    img.data[k * 4] = 19 + 30 * low + 70 * high;
    img.data[k * 4 + 1] = 32 + 10 * low + 40 * high;
    img.data[k * 4 + 2] = 42 + 80 * low;
    img.data[k * 4 + 3] = 255;
  }
  const off = new OffscreenCanvas(nx, ny);
  (off.getContext('2d') as OffscreenCanvasRenderingContext2D).putImageData(img, 0, 0);
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(off, v.ox, v.oy, cellW * (nx - 1), cellH * (ny - 1));

  ctx.strokeStyle = 'rgb(220 230 240 / 45%)';
  ctx.lineWidth = 1;
  for (let level = 948; level <= 1052; level += 4) {
    ctx.strokeStyle = level === 1012 ? 'rgb(220 230 240 / 70%)' : 'rgb(220 230 240 / 35%)';
    contour(ctx, grid, nx, ny, cellW, cellH, v.ox, v.oy, level);
  }

  // The lake.
  ctx.fillStyle = 'rgb(70 120 160 / 55%)';
  ctx.strokeStyle = '#9cc8e6';
  ctx.lineWidth = 1.5;
  polygon(ctx, v, WESTERN_SUPERIOR);
  ctx.fill();
  ctx.stroke();

  // Wind arrows, inside the domain only.
  const domainW = (WEATHER_DOMAIN.maxX - WEATHER_DOMAIN.minX) * v.scale;
  const domainH = (WEATHER_DOMAIN.maxY - WEATHER_DOMAIN.minY) * v.scale;
  for (let j = 1; j < 10; j++) {
    for (let i = 1; i < 13; i++) {
      const x = v.ox + (domainW * i) / 13;
      const y = v.oy + (domainH * j) / 10;
      const w = windAt(state, chartAt(v, x, y), t);
      arrow(ctx, x, y, w.toKn.x, w.toKn.y, 8 + w.speedKn * 0.7, windColor(w.speedKn));
    }
  }

  // Systems: their tracks so far and ahead, and an L or H at the center.
  const dt = t - state.tickSeconds;
  ctx.font = `bold ${Math.round(synoptic.height / 22)}px ui-sans-serif, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  for (const s of state.systems) {
    // Young and dying systems fade; under 2 hPa they're not worth a symbol.
    const strength = Math.abs(s.peakHpa * lifecycle(s.age + dt, s.life));
    if (strength < 2) continue;
    ctx.globalAlpha = Math.min(1, 0.35 + strength / 10);
    const at = { x: s.x + s.vx * dt, y: s.y + s.vy * dt };
    const back = { x: at.x - s.vx * 12 * 3600, y: at.y - s.vy * 12 * 3600 };
    const ahead = { x: at.x + s.vx * 12 * 3600, y: at.y + s.vy * 12 * 3600 };
    const [ax, ay] = px(v, at);
    const [bx, by] = px(v, back);
    const [fx, fy] = px(v, ahead);
    ctx.setLineDash([4, 4]);
    ctx.strokeStyle = 'rgb(255 255 255 / 40%)';
    ctx.beginPath();
    ctx.moveTo(bx, by);
    ctx.lineTo(fx, fy);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = s.kind === 'low' ? '#ff6b6b' : '#7ab8ff';
    ctx.fillText(s.kind === 'low' ? 'L' : 'H', ax, ay);
    ctx.font = `${Math.round(synoptic.height / 48)}px ui-sans-serif, sans-serif`;
    ctx.fillStyle = '#dfe8ee';
    ctx.fillText(
      `${s.peakHpa < 0 ? '−' : '+'}${strength.toFixed(0)} hPa ${s.track === 'high' ? '' : s.track}`,
      ax,
      ay + synoptic.height / 28,
    );
    ctx.font = `bold ${Math.round(synoptic.height / 22)}px ui-sans-serif, sans-serif`;
  }
  ctx.globalAlpha = 1;
}

function drawLake(state: WeatherState, t: number): void {
  const ctx = resize(lake);
  const pad = 25_000;
  const v = fit(lake, {
    minX: LAKE_BOUNDS.minX - pad,
    maxX: LAKE_BOUNDS.maxX + pad,
    minY: LAKE_BOUNDS.minY - pad,
    maxY: LAKE_BOUNDS.maxY + pad,
  });
  ctx.fillStyle = '#2a3a2c';
  ctx.fillRect(0, 0, lake.width, lake.height);
  ctx.fillStyle = '#25506e';
  polygon(ctx, v, WESTERN_SUPERIOR);
  ctx.fill();

  // Rain and fog as a visibility overlay.
  const nx = 120;
  const ny = Math.round((nx * lake.height) / lake.width);
  const img = ctx.createImageData(nx, ny);
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) {
      const p = chartAt(v, ((i + 0.5) * lake.width) / nx, ((j + 0.5) * lake.height) / ny);
      const vis = visibilityAt(state, p, t);
      const rain = precipitationAt(state, p, t);
      // 25 km → clear, 100 m → opaque white.
      const fog = Math.max(0, Math.min(1, Math.log(25_000 / vis) / Math.log(250)));
      const k = (j * nx + i) * 4;
      img.data[k] = 235 - 60 * rain;
      img.data[k + 1] = 238 - 50 * rain;
      img.data[k + 2] = 242;
      img.data[k + 3] = Math.round(230 * fog);
    }
  }
  const off = new OffscreenCanvas(nx, ny);
  (off.getContext('2d') as OffscreenCanvasRenderingContext2D).putImageData(img, 0, 0);
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(off, 0, 0, lake.width, lake.height);

  ctx.strokeStyle = '#9cc8e6';
  ctx.lineWidth = 1.5;
  polygon(ctx, v, WESTERN_SUPERIOR);
  ctx.stroke();

  for (let j = 1; j < 8; j++) {
    for (let i = 1; i < 12; i++) {
      const x = (lake.width * i) / 12;
      const y = (lake.height * j) / 8;
      const w = windAt(state, chartAt(v, x, y), t);
      arrow(ctx, x, y, w.toKn.x, w.toKn.y, 10 + w.speedKn * 0.9, windColor(w.speedKn));
    }
  }

  ctx.font = `${Math.round(lake.height / 40)}px ui-sans-serif, sans-serif`;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  for (const site of RADIATION_FOG_SITES) {
    const [x, y] = px(v, site.at);
    ctx.strokeStyle = 'rgb(255 255 255 / 30%)';
    ctx.beginPath();
    ctx.arc(x, y, 4, 0, Math.PI * 2);
    ctx.stroke();
  }
  PROBES.forEach((p, i) => {
    const [x, y] = px(v, p.at);
    ctx.fillStyle = i === probeIndex ? '#ffd166' : '#dfe8ee';
    ctx.beginPath();
    ctx.arc(x, y, i === probeIndex ? 6 : 4, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillText(p.name, x + 8, y);
  });
}

function drawStrip(t: number): void {
  const ctx = resize(strip);
  const w = strip.width;
  const h = strip.height;
  ctx.clearRect(0, 0, w, h);
  const probe = run.probes[probeIndex] as ProbeSeries;
  const n = run.ticks;
  const top = h * 0.16;
  const bottom = h - 18;
  const yOf = (v: number, lo: number, hi: number) =>
    bottom - ((v - lo) / (hi - lo)) * (bottom - top);

  for (let x = 0; x < w; x++) {
    const i0 = Math.floor((x / w) * n);
    const i1 = Math.max(i0 + 1, Math.floor(((x + 1) / w) * n));
    let minVis = Infinity;
    let maxWind = 0;
    for (let i = i0; i < i1; i++) {
      minVis = Math.min(minVis, probe.visibilityM[i] as number);
      maxWind = Math.max(maxWind, probe.windKn[i] as number);
    }
    if (minVis < 1000) {
      ctx.fillStyle = minVis < THICK_FOG_M ? 'rgb(220 225 230 / 45%)' : 'rgb(220 225 230 / 20%)';
      ctx.fillRect(x, top, 1, bottom - top);
    }
    if (maxWind >= GALE_KN) {
      ctx.fillStyle = 'rgb(255 80 70 / 55%)';
      ctx.fillRect(x, bottom - 8, 1, 8);
    }
  }

  const line = (series: Float32Array, lo: number, hi: number, color: string) => {
    ctx.strokeStyle = color;
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let x = 0; x < w; x++) {
      const i = Math.min(n - 1, Math.floor((x / w) * n));
      const y = yOf(series[i] as number, lo, hi);
      if (x === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
  };
  line(probe.hpa, 960, 1040, '#f0b44c');
  line(probe.windKn, 0, 60, 'rgb(240 245 250 / 85%)');

  // Month ticks.
  ctx.fillStyle = '#9fb0bc';
  ctx.font = '11px ui-sans-serif, sans-serif';
  ctx.textAlign = 'left';
  let lastMonth = -1;
  for (let i = 0; i < n; i++) {
    const m = calendarDate(run.t[i] as number).getUTCMonth();
    if (m !== lastMonth) {
      const x = (i / n) * w;
      ctx.fillRect(x, bottom, 1, 5);
      ctx.fillText(
        calendarDate(run.t[i] as number).toLocaleString('en', { month: 'short', timeZone: 'UTC' }),
        x + 3,
        h - 4,
      );
      lastMonth = m;
    }
  }
  const cx = (indexAt(t) / n) * w;
  ctx.fillStyle = '#ffd166';
  ctx.fillRect(cx, top, 2, bottom - top);
}

function compass(rad: number): string {
  const names = [
    'N',
    'NNE',
    'NE',
    'ENE',
    'E',
    'ESE',
    'SE',
    'SSE',
    'S',
    'SSW',
    'SW',
    'WSW',
    'W',
    'WNW',
    'NW',
    'NNW',
  ];
  return names[Math.round((rad / (2 * Math.PI)) * 16) % 16] as string;
}

const instruments = document.createElement('div');
instruments.id = 'instruments';

function drawPanel(state: WeatherState, t: number): void {
  const probe = PROBES[probeIndex] as (typeof PROBES)[number];
  const baro = barometerAt(state, probe.at, t);
  const wind = windAt(state, probe.at, t);
  const { day, hour } = dayAndHour(t);
  const date = calendarDate(t);
  const hh = Math.floor(hour);
  const mm = Math.floor((hour - hh) * 60);
  const arrowFor: Record<string, string> = {
    'rising fast': '⇈',
    rising: '↑',
    steady: '→',
    falling: '↓',
    'falling fast': '⇊',
  };
  const vis = visibilityAt(state, probe.at, t);
  instruments.textContent = [
    `Game day ${day + 1}, ${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`,
    `Week of ${date.toLocaleDateString('en', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' })}`,
    '',
    `${probe.name}`,
    `Barometer  ${baro.hpa.toFixed(1)} hPa ${arrowFor[baro.trend]} ${baro.trend}`,
    `           ${baro.tendency3h >= 0 ? '+' : ''}${baro.tendency3h.toFixed(1)} hPa / 3 h`,
    `Wind       ${compass(wind.fromRad)} ${wind.speedKn.toFixed(0)} kn, gust ${(wind.gust01 * 100).toFixed(0)}%`,
    `Visibility ${vis >= 10_000 ? `${(vis / 1000).toFixed(0)} km` : vis >= 1000 ? `${(vis / 1000).toFixed(1)} km` : `${vis.toFixed(0)} m`}`,
    `Air        ${airTempAt(state, probe.at, t).toFixed(1)} °C`,
    `Rain/snow  ${(precipitationAt(state, probe.at, t) * 100).toFixed(0)}%`,
    `Systems    ${livingSystems(state)}, fog banks ${state.fogBanks.length}`,
  ].join('\n');
}

function buildPanel(): void {
  panel.innerHTML = '';
  const h1 = document.createElement('h1');
  h1.textContent = 'S9 weather sim';
  panel.append(h1);

  const row1 = document.createElement('div');
  row1.className = 'row';
  const seed = document.createElement('input');
  seed.value = run.seed;
  seed.size = 10;
  const rerun = document.createElement('button');
  rerun.textContent = 'Run season';
  rerun.onclick = () => {
    const url = new URL(window.location.href);
    url.searchParams.set('seed', seed.value);
    window.location.href = url.toString();
  };
  row1.append('Seed', seed, rerun);

  const row2 = document.createElement('div');
  row2.className = 'row';
  const play = document.createElement('button');
  play.textContent = playing ? 'Pause' : 'Play';
  play.onclick = () => {
    playing = !playing;
    play.textContent = playing ? 'Pause' : 'Play';
  };
  const speedSel = document.createElement('select');
  for (const s of [1, 3, 12, 48]) {
    const o = document.createElement('option');
    o.value = String(s);
    o.textContent = `${s} game h/s`;
    if (s === speed) o.selected = true;
    speedSel.append(o);
  }
  speedSel.onchange = () => (speed = Number(speedSel.value));
  row2.append(play, speedSel);

  const row3 = document.createElement('div');
  row3.className = 'row';
  const probeSel = document.createElement('select');
  PROBES.forEach((p, i) => {
    const o = document.createElement('option');
    o.value = String(i);
    o.textContent = p.name;
    if (i === probeIndex) o.selected = true;
    probeSel.append(o);
  });
  probeSel.onchange = () => {
    probeIndex = Number(probeSel.value);
    buildPanel();
  };
  row3.append('Probe', probeSel);

  panel.append(row1, row2, row3, instruments);

  // Season summary for the probe.
  const probe = run.probes[probeIndex] as ProbeSeries;
  const months = monthStats(run, probe);
  const outlook = trendOutlook([probe], 12);
  const summary = document.createElement('div');
  summary.id = 'legend';
  const lows = run.systems.filter((s) => s.kind === 'low');
  summary.innerHTML =
    `<b>This season</b>: ${lows.length} lows (${lows.filter((s) => s.peakHpa <= -20).length} deep), ` +
    `${run.systems.length - lows.length} highs, ${run.fogBanks.length} fog banks.<br>` +
    `<table style="border-spacing:6px 1px;margin-top:4px"><tr><th></th><th>wind</th><th>gales</th><th>fog days</th></tr>` +
    months
      .map(
        (m) =>
          `<tr><td>${m.month}</td><td>${m.meanWindKn.toFixed(0)} kn</td><td>${m.galeOnsets}</td>` +
          `<td>${m.thickFogDays}/${m.days}</td></tr>`,
      )
      .join('') +
    `</table><br><b>Barometer vs. storms</b> (≥28 kn within 12 h)<br>` +
    outlook.map((o) => `${o.trend}: ${(o.stormShare * 100).toFixed(0)}%`).join('<br>') +
    `<br><br>Wind arrows: <span style="color:#8fc3e8">&lt;10</span> ` +
    `<span style="color:#8fe0a0">10–20</span> <span style="color:#f0e07a">20–28</span> ` +
    `<span style="color:#f4a65a">28–34</span> <span style="color:#ff5a4f">gale 34+</span> kn. ` +
    `Grey circles are radiation-fog bays.`;
  panel.append(summary);
}

function draw(): void {
  const state = stateAt(now);
  drawSynoptic(state, now);
  drawLake(state, now);
  drawStrip(now);
  drawPanel(state, now);
}

strip.addEventListener('pointerdown', (e) => {
  const seek = (ev: PointerEvent) => {
    const r = strip.getBoundingClientRect();
    const f = Math.max(0, Math.min(1, (ev.clientX - r.left) / r.width));
    now = (Math.floor(f * run.ticks) + 1) * WORLD_TICK_GAME_SECONDS;
    draw();
  };
  seek(e);
  const move = (ev: PointerEvent) => seek(ev);
  window.addEventListener('pointermove', move);
  window.addEventListener('pointerup', () => window.removeEventListener('pointermove', move), {
    once: true,
  });
});

let last = performance.now();
function frame(time: number): void {
  const dt = (time - last) / 1000;
  last = time;
  if (playing) {
    now = Math.min(run.t[run.ticks - 1] as number, now + dt * speed * 3600);
    draw();
  }
  requestAnimationFrame(frame);
}

function start(): void {
  const seed = params.get('seed') ?? 's9-1';
  const t0 = performance.now();
  run = runSeason(seed, SEASON_DAYS, { snapshots: true });
  const day = Number(params.get('day') ?? '0.5');
  now = Math.max(WORLD_TICK_GAME_SECONDS, day * 86_400);
  const probe = params.get('probe');
  if (probe)
    probeIndex = Math.max(
      0,
      PROBES.findIndex((p) => p.id === probe),
    );
  buildPanel();
  draw();
  window.addEventListener('resize', draw);
  requestAnimationFrame(frame);
  document.body.dataset.s9 = 'ready';
  Object.assign(window, { s9: { run, ms: performance.now() - t0 } });
}

start();
