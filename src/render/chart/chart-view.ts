import { METERS_PER_NAUTICAL_MILE, type Chart } from '../../core/coords';
import { Rng } from '../../core/rng';
import { simplifyRing } from '../../core/simplify';
import { isWater, type ChartGeography, type Rect, type Ring } from '../../sim/chart/geography';
import type { ChartWeatherPicture } from '../../sim/chart/chart-weather';
import { isWeatherContact, type Contact } from '../../sim/chart/traffic';
import type { PlannedCourse, Voyage } from '../../sim/chart/voyage';
import { WEATHER_REDRAW_S, WeatherLayer } from './weather-layer';

/**
 * Chart mode renderer (plan 13 §8.1): a 2D canvas in a period nautical-chart style
 * (parchment, soundings, compass rose, ink coastlines). It only reads state. Pan and
 * zoom live in the camera here; input handling is the caller's.
 */

/** Plan 13 §2.2 draft color tokens. */
export const CHART_COLORS = {
  ink: '#2b2118',
  paper: '#e9dcbb',
  land: '#d9c393',
  water: '#efe7cf',
  brass: '#b8892e',
  signalRed: '#b3362b',
  lakeTeal: '#2f6f73',
  fogGray: '#8d8a83',
} as const;

export interface ChartFrame {
  geo: ChartGeography;
  position: Chart;
  heading: number;
  course: PlannedCourse | undefined;
  voyage: Voyage | undefined;
  contacts: readonly Contact[];
  /** Known traffic lanes (plan 03 §5.2), chart polylines, drawn faint under the ships. */
  lanes?: readonly (readonly Chart[])[];
  /** Game seconds now, for rumor ages. */
  now: number;
  /** 0 at night, 1 by day. */
  daylight: number;
  /** The player's lookout range for a conspicuity-1 ship, meters. */
  spotRangeM: number;
  /** Which contacts the lookouts can see right now. */
  visible: ReadonlySet<string>;
  /** Index of the waypoint under the cursor, for highlighting. */
  hoverWaypoint: number | undefined;
  /** Text by the destination, e.g. "ETA 03:40 (9 h 20 m)". */
  etaLabel: string | undefined;
  /** The weather to draw (Phase 3 piece E): as it stands, or a forecast. */
  weather?: ChartWeatherPicture | undefined;
  /** The captain's hideouts (Phase 4 piece E): the stash, marked in pencil. */
  hideouts?: readonly { id: string; name: string; pos: Chart }[];
}

const FONT = '"Libre Caslon Text", "Iowan Old Style", Georgia, serif';

export class ChartView {
  /** Chart point at the canvas center. */
  center: Chart = { x: 0, y: 0 };
  /** Chart meters per CSS pixel. */
  metersPerPx = 200;
  /** The context the draw calls use: the screen's, or the static layer's while it is drawn. */
  private ctx: CanvasRenderingContext2D;
  private readonly screen: CanvasRenderingContext2D;
  private readonly parchment: CanvasPattern | null;
  /**
   * The static layer (plan 03 §16, finding 9): paper, coast, depths, soundings, graticule,
   * zones and labels depend only on the view, so they're drawn offscreen once per view and
   * copied while the view holds still. Night, lights, ships and the course go on top.
   */
  private readonly layer: HTMLCanvasElement;
  private readonly layerCtx: CanvasRenderingContext2D;
  private layerKey = '';
  private layerGeo: ChartGeography | undefined;
  /** The view the static layer was drawn for, to place it while the view moves. */
  private layerView = { center: { x: 0, y: 0 }, metersPerPx: 1, w: 0, h: 0, dpr: 1 };
  /** The last frame's view key and when the view last changed (ms). */
  private lastKey = '';
  private viewChangedAt = 0;
  private readonly lodCache = new WeakMap<Ring, { tol: number; points: Chart[] }>();
  /** Static-layer redraws since construction (for the bench and tests). */
  layerDraws = 0;
  /** The weather overlay, cached in its own canvas. */
  readonly weatherLayer = new WeatherLayer();
  /**
   * The static layer with the weather drawn over it, so a frame is one copy with the
   * weather up too. Rebuilt when either changes; shifted like the static layer while the
   * view moves.
   */
  private readonly composite: HTMLCanvasElement;
  private readonly compositeCtx: CanvasRenderingContext2D;
  private compositeKey = '';
  private compositePicture: ChartWeatherPicture | undefined;

  constructor(readonly canvas: HTMLCanvasElement) {
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('2D canvas unavailable');
    this.ctx = ctx;
    this.screen = ctx;
    this.parchment = ctx.createPattern(createParchment(), 'repeat');
    this.layer = document.createElement('canvas');
    const layerCtx = this.layer.getContext('2d');
    if (!layerCtx) throw new Error('2D canvas unavailable');
    this.layerCtx = layerCtx;
    this.composite = document.createElement('canvas');
    const compositeCtx = this.composite.getContext('2d');
    if (!compositeCtx) throw new Error('2D canvas unavailable');
    this.compositeCtx = compositeCtx;
  }

  get width(): number {
    return this.canvas.clientWidth;
  }

  get height(): number {
    return this.canvas.clientHeight;
  }

  /** Fit a chart rectangle to the canvas. */
  fit(min: Chart, max: Chart, marginPx = 24): void {
    this.center = { x: (min.x + max.x) / 2, y: (min.y + max.y) / 2 };
    const w = Math.max(this.width - 2 * marginPx, 1);
    const h = Math.max(this.height - 2 * marginPx, 1);
    this.metersPerPx = Math.max((max.x - min.x) / w, (max.y - min.y) / h);
  }

  toScreen(p: Chart): { x: number; y: number } {
    return {
      x: this.width / 2 + (p.x - this.center.x) / this.metersPerPx,
      y: this.height / 2 - (p.y - this.center.y) / this.metersPerPx,
    };
  }

  toChart(x: number, y: number): Chart {
    return {
      x: this.center.x + (x - this.width / 2) * this.metersPerPx,
      y: this.center.y - (y - this.height / 2) * this.metersPerPx,
    };
  }

  /** Zoom by `factor` (>1 zooms in) keeping the chart point under (x, y) fixed. */
  zoomAt(x: number, y: number, factor: number): void {
    const before = this.toChart(x, y);
    this.metersPerPx = Math.min(Math.max(this.metersPerPx / factor, 15), 2000);
    const after = this.toChart(x, y);
    this.center = {
      x: this.center.x + before.x - after.x,
      y: this.center.y + before.y - after.y,
    };
  }

  panBy(dxPx: number, dyPx: number): void {
    this.center = {
      x: this.center.x - dxPx * this.metersPerPx,
      y: this.center.y + dyPx * this.metersPerPx,
    };
  }

  /** Forget the static layer, e.g. after the chart data changes in place. */
  invalidate(): void {
    this.layerKey = '';
  }

  draw(frame: ChartFrame): void {
    const { canvas } = this;
    const dpr = window.devicePixelRatio || 1;
    const w = this.width;
    const h = this.height;
    const pw = Math.round(w * dpr);
    const ph = Math.round(h * dpr);
    if (canvas.width !== pw || canvas.height !== ph) {
      canvas.width = pw;
      canvas.height = ph;
    }
    const geo = frame.geo;

    // The static layer is redrawn only when the view moves. While the view is moving
    // (a drag or a wheel zoom), the last layer is shifted and scaled into place instead,
    // which costs a copy; the real redraw waits until the view has held still for
    // LAYER_SETTLE_MS. With the baked coast a full redraw is far over a frame's budget on
    // a software canvas, so redrawing on every drag frame would stutter.
    const key = `${this.center.x},${this.center.y},${this.metersPerPx},${w},${h},${dpr}`;
    const now = performance.now();
    if (key !== this.lastKey) {
      this.lastKey = key;
      this.viewChangedAt = now;
    }
    const lv = this.layerView;
    const canShift =
      this.layerKey !== '' && geo === this.layerGeo && lv.w === w && lv.h === h && lv.dpr === dpr;
    const stale = key !== this.layerKey || geo !== this.layerGeo;
    if (stale && canShift && now - this.viewChangedAt < LAYER_SETTLE_MS) {
      // The weather isn't redrawn mid-drag either: the last composite moves with the view.
      this.drawShiftedLayer(
        dpr,
        frame.weather && this.compositeKey.startsWith(`${this.layerKey}|`)
          ? this.composite
          : this.layer,
      );
    } else {
      if (stale) this.redrawLayer(geo, key, pw, ph, dpr);
      const source = frame.weather ? this.withWeather(frame.weather, dpr) : this.layer;
      const { ctx } = this;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.globalCompositeOperation = 'copy';
      ctx.drawImage(source, 0, 0);
      ctx.globalCompositeOperation = 'source-over';
    }
    this.begin(dpr);
    const { ctx } = this;

    // Night falls over the paper; lights, ships and the course stay readable on top.
    if (frame.daylight < 1) {
      ctx.fillStyle = `rgba(18, 28, 46, ${0.42 * (1 - frame.daylight)})`;
      ctx.fillRect(0, 0, w, h);
    }
    if (frame.weather) this.weatherLayer.drawLive(ctx, this, frame.weather, 1 - frame.daylight);
    this.drawLights(geo, frame.daylight);
    this.drawPorts(geo);
    this.drawHideouts(frame);
    this.drawLanes(frame);
    this.drawSpotRange(frame);
    this.drawContacts(frame);
    this.drawCourse(frame);
    this.drawShip(frame.position, frame.heading);
    this.drawCompassRose(h);
    this.drawScaleBar(h);
  }

  private redrawLayer(geo: ChartGeography, key: string, pw: number, ph: number, dpr: number): void {
    if (this.layer.width !== pw || this.layer.height !== ph) {
      this.layer.width = pw;
      this.layer.height = ph;
    }
    this.ctx = this.layerCtx;
    this.begin(dpr);
    this.drawBase(geo);
    this.drawSoundings(geo);
    this.drawGraticule(geo);
    this.drawZones(geo);
    this.drawUncharted(geo);
    this.drawLabels(geo);
    this.ctx = this.screen;
    this.layerKey = key;
    this.layerGeo = geo;
    const view = { w: this.width, h: this.height, dpr };
    this.layerView = { center: { ...this.center }, metersPerPx: this.metersPerPx, ...view };
    this.layerDraws++;
  }

  /** The static layer with the weather over it, rebuilt only when either has changed. */
  private withWeather(picture: ChartWeatherPicture, dpr: number): HTMLCanvasElement {
    const ckey = `${this.layerKey}|${this.layerDraws}`;
    const last = this.compositePicture;
    const moved =
      !last ||
      last.leadHours !== picture.leadHours ||
      Math.abs(picture.at - last.at) >= WEATHER_REDRAW_S;
    if (ckey !== this.compositeKey || moved) {
      const c = this.composite;
      if (c.width !== this.layer.width || c.height !== this.layer.height) {
        c.width = this.layer.width;
        c.height = this.layer.height;
      }
      const ctx = this.compositeCtx;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.globalCompositeOperation = 'copy';
      ctx.drawImage(this.layer, 0, 0);
      ctx.globalCompositeOperation = 'source-over';
      this.weatherLayer.drawInto(ctx, this, picture, dpr);
      this.compositeKey = ckey;
      this.compositePicture = picture;
    }
    return this.composite;
  }

  /** The last static layer (or composite), moved and scaled to where the current view puts it. */
  private drawShiftedLayer(dpr: number, source: HTMLCanvasElement = this.layer): void {
    const { ctx } = this;
    const lv = this.layerView;
    const k = lv.metersPerPx / this.metersPerPx;
    const tx = lv.w / 2 - (k * lv.w) / 2 + (lv.center.x - this.center.x) / this.metersPerPx;
    const ty = lv.h / 2 - (k * lv.h) / 2 - (lv.center.y - this.center.y) / this.metersPerPx;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = CHART_COLORS.land;
    ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    ctx.setTransform(k, 0, 0, k, tx * dpr, ty * dpr);
    ctx.drawImage(source, 0, 0);
  }

  private begin(dpr: number): void {
    const { ctx } = this;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.setLineDash([]);
    ctx.globalAlpha = 1;
  }

  /**
   * A ring simplified to about half a pixel at the current zoom. The baked coast holds
   * detail to 40 m, which is wasted (and slow to fill and stroke) at the full-lake zoom.
   */
  private lod(ring: Ring): readonly Chart[] {
    const tol = 2 ** Math.floor(Math.log2(Math.max(this.metersPerPx * 0.5, 1)));
    let cached = this.lodCache.get(ring);
    if (cached?.tol !== tol) {
      cached = { tol, points: simplifyRing(ring.points, tol) };
      this.lodCache.set(ring, cached);
    }
    return cached.points;
  }

  /** Rings worth drawing in view: on screen and at least `minPx` across. */
  private visibleRings(rings: readonly Ring[], view: Rect, minPx: number): Ring[] {
    const min = minPx * this.metersPerPx;
    return rings.filter(
      (r) =>
        overlaps(r.bounds, view) &&
        Math.max(r.bounds.max.x - r.bounds.min.x, r.bounds.max.y - r.bounds.min.y) >= min,
    );
  }

  private drawBase(geo: ChartGeography): void {
    const { ctx } = this;
    const w = this.width;
    const h = this.height;
    ctx.fillStyle = CHART_COLORS.land;
    ctx.fillRect(0, 0, w, h);

    // One path for the whole coast: filled, clipped to and stroked three times.
    const view = this.viewRect(8);
    const water = new Path2D();
    for (const ring of [geo.water, ...this.visibleRings(geo.islands, view, 1.5)]) {
      this.addPath(water, this.lod(ring));
    }
    ctx.fillStyle = CHART_COLORS.water;
    ctx.fill(water, 'evenodd');

    // Depth shading from the baked contours, inside the water: each contour's shallow side
    // gets a wash of lake teal, so the shallows build up darkest, and a dotted line marks
    // the contour itself, as on the Lake Survey charts.
    ctx.save();
    ctx.clip(water, 'evenodd');
    for (const contour of geo.depths) {
      const path = new Path2D();
      // Nonzero winding: the view rectangle counter-clockwise (in chart space) makes
      // everything shallow; each deep basin's clockwise ring takes its inside back out,
      // and shallow banks inside a basin (counter-clockwise again) put theirs back.
      const corners: Chart[] = [
        { x: view.min.x, y: view.min.y },
        { x: view.max.x, y: view.min.y },
        { x: view.max.x, y: view.max.y },
        { x: view.min.x, y: view.max.y },
      ];
      this.addPath(path, corners);
      const lines = new Path2D();
      for (const ring of this.visibleRings(contour.rings, view, 3)) {
        const points = this.lod(ring);
        this.addPath(path, points);
        this.addPath(lines, points);
      }
      ctx.fillStyle = 'rgba(47, 111, 115, 0.07)';
      ctx.fill(path, 'nonzero');
      ctx.setLineDash([1.5, 3]);
      ctx.strokeStyle = 'rgba(47, 111, 115, 0.45)';
      ctx.lineWidth = 0.9;
      ctx.stroke(lines);
      ctx.setLineDash([]);
    }
    // A thin waterline a few pixels offshore.
    ctx.strokeStyle = 'rgba(43, 33, 24, 0.25)';
    ctx.lineWidth = 7;
    ctx.stroke(water);
    ctx.strokeStyle = CHART_COLORS.water;
    ctx.lineWidth = 5;
    ctx.stroke(water);
    ctx.restore();

    ctx.strokeStyle = CHART_COLORS.ink;
    ctx.lineWidth = 1.3;
    ctx.stroke(water);

    // Paper grain over everything drawn so far.
    if (this.parchment) {
      ctx.save();
      ctx.globalCompositeOperation = 'multiply';
      ctx.fillStyle = this.parchment;
      ctx.fillRect(0, 0, w, h);
      ctx.restore();
    }
  }

  /**
   * Soundings in fathoms from the NOAA bathymetry (plan 03 §8.2 step 9), thinned by their
   * grid level so they stay about the same distance apart on screen at any zoom.
   */
  private drawSoundings(geo: ChartGeography): void {
    const { ctx } = this;
    const minGapPx = 46;
    let maxLevel = -1;
    for (let level = 0; level <= 4; level++) {
      const spacingM = (SOUNDING_GRID_NM[level] as number) * METERS_PER_NAUTICAL_MILE;
      if (spacingM / this.metersPerPx >= minGapPx) maxLevel = level;
    }
    if (maxLevel < 0) return;
    const view = this.viewRect(20);
    ctx.fillStyle = 'rgba(43, 33, 24, 0.55)';
    ctx.font = `italic 10px ${FONT}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (const s of geo.soundings) {
      if (s.level > maxLevel) continue;
      const { x, y } = s.pos;
      if (x < view.min.x || x > view.max.x || y < view.min.y || y > view.max.y) continue;
      const p = this.toScreen(s.pos);
      ctx.fillText(String(s.fathoms), p.x, p.y);
    }
  }

  /** The visible chart rectangle, grown by `marginPx` on each side. */
  private viewRect(marginPx: number): Rect {
    const a = this.toChart(-marginPx, this.height + marginPx);
    const b = this.toChart(this.width + marginPx, -marginPx);
    return { min: a, max: b };
  }

  private addPath(path: Path2D, points: readonly Chart[]): void {
    points.forEach((p, i) => {
      const s = this.toScreen(p);
      if (i === 0) path.moveTo(s.x, s.y);
      else path.lineTo(s.x, s.y);
    });
    path.closePath();
  }

  private drawGraticule(geo: ChartGeography): void {
    const { ctx } = this;
    const nw = geo.projection.chartToGeo(this.toChart(0, 0));
    const se = geo.projection.chartToGeo(this.toChart(this.width, this.height));
    const stepDeg = this.metersPerPx > 400 ? 0.5 : this.metersPerPx > 120 ? 0.25 : 0.0833333;
    ctx.strokeStyle = 'rgba(43, 33, 24, 0.14)';
    ctx.lineWidth = 1;
    ctx.fillStyle = 'rgba(43, 33, 24, 0.6)';
    ctx.font = `10px ${FONT}`;
    const label = (deg: number, hemi: [string, string]): string => {
      const minutes = Math.round(Math.abs(deg) * 60);
      const d = Math.floor(minutes / 60);
      const m = minutes % 60;
      return `${d}°${m > 0 ? ` ${String(m).padStart(2, '0')}′` : ''} ${deg >= 0 ? hemi[0] : hemi[1]}`;
    };
    ctx.beginPath();
    for (let lat = Math.ceil(se.lat / stepDeg) * stepDeg; lat <= nw.lat; lat += stepDeg) {
      const y = this.toScreen(geo.projection.geoToChart({ lat, lon: nw.lon })).y;
      ctx.moveTo(0, y);
      ctx.lineTo(this.width, y);
      ctx.textAlign = 'left';
      ctx.textBaseline = 'bottom';
      ctx.fillText(label(lat, ['N', 'S']), 4, y - 2);
    }
    for (let lon = Math.ceil(nw.lon / stepDeg) * stepDeg; lon <= se.lon; lon += stepDeg) {
      const x = this.toScreen(geo.projection.geoToChart({ lat: nw.lat, lon })).x;
      ctx.moveTo(x, 0);
      ctx.lineTo(x, this.height);
      ctx.textAlign = 'left';
      ctx.textBaseline = 'top';
      ctx.fillText(label(lon, ['E', 'W']), x + 3, 4);
    }
    ctx.stroke();
  }

  private drawZones(geo: ChartGeography): void {
    const { ctx } = this;
    ctx.save();
    ctx.setLineDash([6, 5]);
    ctx.strokeStyle = 'rgba(47, 111, 115, 0.55)';
    ctx.lineWidth = 1.2;
    ctx.fillStyle = 'rgba(47, 111, 115, 0.85)';
    ctx.font = `italic 11px ${FONT}`;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    for (const z of geo.zones) {
      const a = this.toScreen({ x: z.min.x, y: z.max.y });
      const b = this.toScreen({ x: z.max.x, y: z.min.y });
      ctx.strokeRect(a.x, a.y, b.x - a.x, b.y - a.y);
      ctx.fillText(z.name, a.x + 4, a.y + 4);
    }
    ctx.restore();
  }

  private drawUncharted(geo: ChartGeography): void {
    const { ctx } = this;
    const a = this.toScreen({ x: geo.charted.min.x, y: geo.charted.max.y });
    const b = this.toScreen({ x: geo.charted.max.x, y: geo.charted.min.y });
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, this.width, this.height);
    ctx.rect(a.x, a.y, b.x - a.x, b.y - a.y);
    ctx.fillStyle = 'rgba(120, 116, 108, 0.55)';
    ctx.fill('evenodd');
    ctx.clip('evenodd');
    ctx.strokeStyle = 'rgba(60, 56, 50, 0.18)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let x = -this.height; x < this.width; x += 9) {
      ctx.moveTo(x, this.height);
      ctx.lineTo(x + this.height, 0);
    }
    ctx.stroke();
    ctx.restore();

    if (b.x < this.width - 40) {
      ctx.save();
      ctx.translate(
        (b.x + this.width) / 2,
        Math.min(Math.max((a.y + b.y) / 2, 80), this.height - 80),
      );
      ctx.rotate(-Math.PI / 2);
      ctx.fillStyle = 'rgba(43, 33, 24, 0.65)';
      ctx.font = `italic 14px ${FONT}`;
      ctx.textAlign = 'center';
      ctx.fillText('Beyond your charts', 0, 0);
      ctx.restore();
    }
  }

  private drawLabels(geo: ChartGeography): void {
    const { ctx } = this;
    // The lake's name in spaced capitals, centered on open water.
    const title = this.toScreen(geo.projection.geoToChart({ lat: 47.22, lon: -90.9 }));
    ctx.save();
    ctx.fillStyle = 'rgba(43, 33, 24, 0.5)';
    ctx.font = `${Math.round(Math.min(Math.max(30000 / this.metersPerPx, 14), 34))}px ${FONT}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.letterSpacing = '0.4em';
    ctx.fillText('LAKE SUPERIOR', title.x, title.y);
    ctx.restore();

    if (this.metersPerPx > 160) return;
    ctx.fillStyle = 'rgba(43, 33, 24, 0.8)';
    ctx.font = `italic 11px ${FONT}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (const island of geo.islands) {
      if (!island.name) continue;
      const c = centroid(island.points);
      const sizePx = (island.bounds.max.x - island.bounds.min.x) / this.metersPerPx;
      if (sizePx < 14) continue;
      const s = this.toScreen(c);
      // Period chart style: "Madeline I." rather than "Madeline Island".
      ctx.fillText(island.name.replace(/ Island$/, ' I.'), s.x, s.y);
    }
  }

  private drawLights(geo: ChartGeography, daylight: number): void {
    const { ctx } = this;
    const night = 1 - daylight;
    for (const light of geo.lights) {
      const s = this.toScreen(light.pos);
      if (light.status === 'lit' && night > 0) {
        // Light-tier ring (plan 13 §4.3): a thin ring at roughly the light's range,
        // plus a small glow at the tower.
        const range = (12 * METERS_PER_NAUTICAL_MILE) / this.metersPerPx;
        ctx.save();
        ctx.setLineDash([1, 4]);
        ctx.strokeStyle = `rgba(232, 190, 90, ${0.75 * night})`;
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(s.x, s.y, range, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
        const r = 16;
        const glow = ctx.createRadialGradient(s.x, s.y, 0, s.x, s.y, r);
        glow.addColorStop(0, `rgba(255, 214, 120, ${0.7 * night})`);
        glow.addColorStop(1, 'rgba(255, 214, 120, 0)');
        ctx.fillStyle = glow;
        ctx.beginPath();
        ctx.arc(s.x, s.y, r, 0, Math.PI * 2);
        ctx.fill();
      }
      drawStar(ctx, s.x, s.y, 5.5, light.status === 'lit' ? CHART_COLORS.brass : 'transparent');
      ctx.strokeStyle = light.status === 'lit' ? CHART_COLORS.ink : CHART_COLORS.fogGray;
      ctx.lineWidth = 1;
      ctx.stroke();
    }
  }

  private drawPorts(geo: ChartGeography): void {
    const { ctx } = this;
    ctx.font = `600 12px ${FONT}`;
    ctx.textBaseline = 'middle';
    for (const port of geo.ports) {
      const s = this.toScreen(port.pos);
      ctx.beginPath();
      ctx.arc(s.x, s.y, 4, 0, Math.PI * 2);
      ctx.fillStyle = CHART_COLORS.paper;
      ctx.fill();
      ctx.strokeStyle = CHART_COLORS.ink;
      ctx.lineWidth = 1.5;
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(s.x, s.y, 1.5, 0, Math.PI * 2);
      ctx.fillStyle = CHART_COLORS.ink;
      ctx.fill();
      // Label on the land side: west-shore ports read better to the left.
      const left = isWater(geo, { x: port.pos.x + 3000, y: port.pos.y });
      ctx.textAlign = left ? 'right' : 'left';
      haloText(ctx, port.name, s.x + (left ? -8 : 8), s.y);
    }
  }

  /** A hideout as the captain would mark it: a penciled cross in a ring, and its name. */
  private drawHideouts(frame: ChartFrame): void {
    if (!frame.hideouts?.length) return;
    const { ctx } = this;
    ctx.save();
    ctx.font = `italic 600 12px ${FONT}`;
    ctx.textBaseline = 'middle';
    for (const h of frame.hideouts) {
      const s = this.toScreen(h.pos);
      ctx.strokeStyle = CHART_COLORS.signalRed;
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      ctx.arc(s.x, s.y, 6.5, 0, Math.PI * 2);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(s.x - 4, s.y - 4);
      ctx.lineTo(s.x + 4, s.y + 4);
      ctx.moveTo(s.x + 4, s.y - 4);
      ctx.lineTo(s.x - 4, s.y + 4);
      ctx.stroke();
      ctx.textAlign = 'left';
      ctx.fillStyle = CHART_COLORS.signalRed;
      haloText(ctx, h.name, s.x + 10, s.y + 10);
    }
    ctx.restore();
  }

  private drawSpotRange(frame: ChartFrame): void {
    const { ctx } = this;
    const s = this.toScreen(frame.position);
    ctx.save();
    ctx.setLineDash([2, 5]);
    ctx.strokeStyle = 'rgba(47, 111, 115, 0.6)';
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.arc(s.x, s.y, frame.spotRangeM / this.metersPerPx, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }

  private drawLanes(frame: ChartFrame): void {
    if (!frame.lanes?.length) return;
    const { ctx } = this;
    ctx.save();
    ctx.setLineDash([2, 6]);
    ctx.strokeStyle = 'rgba(43, 33, 24, 0.28)';
    ctx.lineWidth = 1.2;
    for (const line of frame.lanes) {
      ctx.beginPath();
      line.forEach((p, i) => {
        const s = this.toScreen(p);
        if (i === 0) ctx.moveTo(s.x, s.y);
        else ctx.lineTo(s.x, s.y);
      });
      ctx.stroke();
    }
    ctx.restore();
  }

  private drawContacts(frame: ChartFrame): void {
    const { ctx } = this;
    for (const c of frame.contacts) {
      const seenNow = frame.visible.has(c.id);
      if (!seenNow && (!c.lastSeen || frame.now - c.lastSeen.at > GHOST_MAX_AGE_S)) continue;
      const pos = seenNow ? c.pos : (c.lastSeen as { pos: Chart }).pos;
      const s = this.toScreen(pos);
      // With the weather layer up it draws the cell or the bank; the sighting is the label.
      if (!isWeatherContact(c)) drawContactGlyph(ctx, c, s.x, s.y, seenNow);
      else if (!frame.weather)
        drawStorm(ctx, s.x, s.y, (c.radiusM ?? 0) / this.metersPerPx, seenNow);
      ctx.font = `italic 11px ${FONT}`;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = seenNow ? CHART_COLORS.ink : CHART_COLORS.fogGray;
      let text = c.name;
      if (!seenNow && c.lastSeen) {
        // A rumor-style ghost: where it was, how long ago, and how far it could be by now.
        const ageS = frame.now - c.lastSeen.at;
        const reachM = Math.min(
          c.speedKn * (METERS_PER_NAUTICAL_MILE / 3600) * ageS,
          GHOST_MAX_REACH_M,
        );
        const r = reachM / this.metersPerPx;
        if (r > 3 && !isWeatherContact(c)) {
          ctx.save();
          ctx.setLineDash([3, 4]);
          ctx.strokeStyle = 'rgba(141, 138, 131, 0.8)';
          ctx.beginPath();
          ctx.arc(s.x, s.y, r, 0, Math.PI * 2);
          ctx.stroke();
          ctx.restore();
        }
        text += ` · seen ${formatAge(ageS)} ago`;
      }
      haloText(ctx, text, s.x + 10, s.y - 9);
    }
  }

  private drawCourse(frame: ChartFrame): void {
    const course = frame.course;
    const voyage = frame.voyage;
    const { ctx } = this;
    if (voyage) {
      // Remaining track ahead of the ship.
      ctx.save();
      ctx.setLineDash([8, 6]);
      ctx.strokeStyle = CHART_COLORS.ink;
      ctx.lineWidth = 2;
      ctx.beginPath();
      const s = this.toScreen(voyage.position);
      ctx.moveTo(s.x, s.y);
      for (let i = voyage.leg; i < voyage.legs.length; i++) {
        const t = this.toScreen((voyage.legs[i] as { to: Chart }).to);
        ctx.lineTo(t.x, t.y);
      }
      ctx.stroke();
      ctx.restore();
      const end = voyage.legs.at(-1)?.to;
      if (end) this.drawDestination(end, frame.etaLabel);
      return;
    }
    if (!course || course.points.length < 2) return;

    for (const leg of course.legs) {
      const a = this.toScreen(leg.from);
      const b = this.toScreen(leg.to);
      ctx.save();
      ctx.setLineDash([8, 6]);
      ctx.lineWidth = 2;
      if (leg.landAt === undefined) {
        ctx.strokeStyle = CHART_COLORS.ink;
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
        ctx.stroke();
      } else {
        const hit = { x: a.x + (b.x - a.x) * leg.landAt, y: a.y + (b.y - a.y) * leg.landAt };
        ctx.strokeStyle = CHART_COLORS.ink;
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(hit.x, hit.y);
        ctx.stroke();
        ctx.strokeStyle = CHART_COLORS.signalRed;
        ctx.beginPath();
        ctx.moveTo(hit.x, hit.y);
        ctx.lineTo(b.x, b.y);
        ctx.stroke();
        // Aground marker: a red cross, so it reads without color too.
        ctx.setLineDash([]);
        ctx.lineWidth = 2.5;
        ctx.beginPath();
        ctx.moveTo(hit.x - 6, hit.y - 6);
        ctx.lineTo(hit.x + 6, hit.y + 6);
        ctx.moveTo(hit.x + 6, hit.y - 6);
        ctx.lineTo(hit.x - 6, hit.y + 6);
        ctx.stroke();
      }
      ctx.restore();
    }

    // Past the destination zone's edge the zone takes over: drawn faint, never sailed.
    const lastLeg = course.legs.at(-1);
    if (lastLeg && course.insideZone.length > 0) {
      ctx.save();
      ctx.setLineDash([2, 5]);
      ctx.strokeStyle = 'rgba(43, 33, 24, 0.45)';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      const s = this.toScreen(lastLeg.to);
      ctx.moveTo(s.x, s.y);
      for (const p of course.insideZone) {
        const t = this.toScreen(p);
        ctx.lineTo(t.x, t.y);
      }
      ctx.stroke();
      ctx.restore();
    }

    // Waypoints (index 0 is the ship itself).
    course.points.slice(1).forEach((p, i) => {
      const s = this.toScreen(p);
      ctx.beginPath();
      ctx.arc(s.x, s.y, frame.hoverWaypoint === i ? 7 : 5, 0, Math.PI * 2);
      ctx.fillStyle = CHART_COLORS.paper;
      ctx.fill();
      ctx.strokeStyle = CHART_COLORS.ink;
      ctx.lineWidth = 2;
      ctx.stroke();
    });
    if (lastLeg && !course.problem) this.drawDestination(lastLeg.to, frame.etaLabel);
  }

  private drawDestination(p: Chart, label: string | undefined): void {
    const { ctx } = this;
    const s = this.toScreen(p);
    ctx.beginPath();
    ctx.arc(s.x, s.y, 9, 0, Math.PI * 2);
    ctx.strokeStyle = CHART_COLORS.brass;
    ctx.lineWidth = 2.5;
    ctx.stroke();
    if (label) {
      ctx.font = `600 12px ${FONT}`;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = CHART_COLORS.ink;
      haloText(ctx, label, s.x + 13, s.y + 14);
    }
  }

  private drawShip(pos: Chart, heading: number): void {
    const { ctx } = this;
    const s = this.toScreen(pos);
    ctx.save();
    ctx.translate(s.x, s.y);
    ctx.rotate(heading);
    ctx.beginPath();
    ctx.moveTo(0, -11);
    ctx.quadraticCurveTo(6, -2, 4, 8);
    ctx.lineTo(-4, 8);
    ctx.quadraticCurveTo(-6, -2, 0, -11);
    ctx.fillStyle = CHART_COLORS.brass;
    ctx.fill();
    ctx.strokeStyle = CHART_COLORS.ink;
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.restore();
  }

  private drawCompassRose(h: number): void {
    const { ctx } = this;
    const cx = 92;
    const cy = h - 110;
    const r = 58;
    ctx.save();
    ctx.translate(cx, cy);
    ctx.strokeStyle = 'rgba(43, 33, 24, 0.7)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, Math.PI * 2);
    ctx.arc(0, 0, r - 6, 0, Math.PI * 2);
    ctx.stroke();
    for (let i = 0; i < 32; i++) {
      const a = (i / 32) * Math.PI * 2;
      const len = i % 8 === 0 ? 6 : i % 4 === 0 ? 4 : 2;
      ctx.beginPath();
      ctx.moveTo(Math.sin(a) * (r - 6), -Math.cos(a) * (r - 6));
      ctx.lineTo(Math.sin(a) * (r - 6 - len), -Math.cos(a) * (r - 6 - len));
      ctx.stroke();
    }
    // Eight-point star, alternately inked and paper.
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      const long = i % 2 === 0;
      const tip = long ? r - 10 : (r - 10) * 0.6;
      const side = long ? 8 : 6;
      for (const half of [-1, 1]) {
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.lineTo(Math.sin(a) * tip, -Math.cos(a) * tip);
        const b = a + half * (Math.PI / 8);
        ctx.lineTo(Math.sin(b) * side, -Math.cos(b) * side);
        ctx.closePath();
        ctx.fillStyle = half > 0 ? CHART_COLORS.ink : CHART_COLORS.paper;
        ctx.fill();
        ctx.stroke();
      }
    }
    ctx.fillStyle = CHART_COLORS.ink;
    ctx.font = `600 13px ${FONT}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'bottom';
    ctx.fillText('N', 0, -r - 3);
    ctx.restore();
  }

  private drawScaleBar(h: number): void {
    const { ctx } = this;
    const targetPx = 160;
    const options = [1, 2, 5, 10, 20, 50];
    const nmPerPx = this.metersPerPx / METERS_PER_NAUTICAL_MILE;
    const nm = options.find((n) => n / nmPerPx >= targetPx * 0.5) ?? 50;
    const px = nm / nmPerPx;
    const x = 180;
    const y = h - 30;
    ctx.fillStyle = CHART_COLORS.ink;
    ctx.strokeStyle = CHART_COLORS.ink;
    ctx.lineWidth = 1;
    const parts = 5;
    for (let i = 0; i < parts; i++) {
      const x0 = x + (px / parts) * i;
      if (i % 2 === 0) ctx.fillRect(x0, y, px / parts, 5);
      ctx.strokeRect(x0, y, px / parts, 5);
    }
    ctx.font = `11px ${FONT}`;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'bottom';
    ctx.fillText(`${nm} nautical miles`, x, y - 3);
  }
}

/** How long the view must hold still before the static layer is redrawn, ms. */
export const LAYER_SETTLE_MS = 120;

/** Sounding grid spacing by level (tools/geo/chart.ts). */
const SOUNDING_GRID_NM = [16, 8, 4, 2, 1];

function overlaps(r: Rect, s: Rect): boolean {
  return r.min.x <= s.max.x && r.max.x >= s.min.x && r.min.y <= s.max.y && r.max.y >= s.min.y;
}
/** Sightings older than this drop off the chart; plan 05's rumors take over. */
const GHOST_MAX_AGE_S = 6 * 3600;
/** Cap on a ghost's "could be anywhere in here" circle. */
const GHOST_MAX_REACH_M = 15 * METERS_PER_NAUTICAL_MILE;

function centroid(points: readonly Chart[]): Chart {
  let x = 0;
  let y = 0;
  for (const p of points) {
    x += p.x;
    y += p.y;
  }
  return { x: x / points.length, y: y / points.length };
}

function formatAge(seconds: number): string {
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.round(minutes / 6) / 10;
  return `${hours} h`;
}

/** Text with a paper-colored halo so it reads over coastlines and soundings. */
function haloText(ctx: CanvasRenderingContext2D, text: string, x: number, y: number): void {
  const fill = ctx.fillStyle;
  ctx.save();
  ctx.strokeStyle = 'rgba(239, 231, 207, 0.85)';
  ctx.lineWidth = 3;
  ctx.strokeText(text, x, y);
  ctx.restore();
  ctx.fillStyle = fill;
  ctx.fillText(text, x, y);
}

function drawStar(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  r: number,
  fill: string,
): void {
  ctx.beginPath();
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2;
    const rr = i % 2 === 0 ? r : r * 0.45;
    const px = x + Math.sin(a) * rr;
    const py = y - Math.cos(a) * rr;
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.closePath();
  ctx.fillStyle = fill;
  ctx.fill();
}

/** Each kind has its own shape (plan 13 §2.2: never color alone). */
function drawContactGlyph(
  ctx: CanvasRenderingContext2D,
  c: Contact,
  x: number,
  y: number,
  seenNow: boolean,
): void {
  const ink = seenNow ? CHART_COLORS.ink : CHART_COLORS.fogGray;
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(c.heading);
  ctx.strokeStyle = ink;
  ctx.lineWidth = 1.5;
  ctx.fillStyle = ink;
  ctx.beginPath();
  switch (c.kind) {
    case 'freighter':
      ctx.roundRect(-2.5, -9, 5, 18, 2.5);
      ctx.fill();
      break;
    case 'steamer':
      ctx.roundRect(-3, -7, 6, 14, 3);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(0, 0, 1.5, 0, Math.PI * 2);
      ctx.fill();
      break;
    case 'barge':
      // A sail: a narrow open triangle, point forward.
      ctx.moveTo(0, -8);
      ctx.lineTo(4, 7);
      ctx.lineTo(-4, 7);
      ctx.closePath();
      ctx.stroke();
      break;
    case 'tug':
      ctx.arc(0, 0, 3.5, 0, Math.PI * 2);
      ctx.fill();
      break;
    case 'cutter':
      ctx.moveTo(0, -9);
      ctx.lineTo(5, 0);
      ctx.lineTo(0, 9);
      ctx.lineTo(-5, 0);
      ctx.closePath();
      ctx.fillStyle = seenNow ? CHART_COLORS.signalRed : CHART_COLORS.fogGray;
      ctx.fill();
      ctx.stroke();
      break;
    case 'derelict':
      ctx.rotate(-c.heading);
      ctx.moveTo(-5, -5);
      ctx.lineTo(5, 5);
      ctx.moveTo(5, -5);
      ctx.lineTo(-5, 5);
      ctx.lineWidth = 2;
      ctx.stroke();
      break;
    case 'storm':
    case 'fog':
      break;
  }
  ctx.restore();
}

function drawStorm(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  r: number,
  seenNow: boolean,
): void {
  ctx.save();
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fillStyle = seenNow ? 'rgba(60, 70, 90, 0.18)' : 'rgba(141, 138, 131, 0.1)';
  ctx.fill();
  ctx.setLineDash([5, 4]);
  ctx.strokeStyle = seenNow ? 'rgba(43, 33, 24, 0.7)' : 'rgba(141, 138, 131, 0.7)';
  ctx.lineWidth = 1.5;
  ctx.stroke();
  // A small spiral at the center.
  ctx.setLineDash([]);
  ctx.beginPath();
  for (let i = 0; i <= 40; i++) {
    const a = (i / 40) * Math.PI * 4;
    const rr = (i / 40) * Math.min(r * 0.4, 12);
    const px = x + Math.cos(a) * rr;
    const py = y + Math.sin(a) * rr;
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.stroke();
  ctx.restore();
}

/** A small tile of paper grain, multiplied over the chart. */
function createParchment(): HTMLCanvasElement {
  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) return canvas;
  const rng = Rng.fromSeed('parchment');
  const img = ctx.createImageData(size, size);
  for (let i = 0; i < size * size; i++) {
    const v = 236 + Math.floor(rng.range(-14, 19));
    img.data[i * 4] = v;
    img.data[i * 4 + 1] = v - 4;
    img.data[i * 4 + 2] = v - 14;
    img.data[i * 4 + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  return canvas;
}
