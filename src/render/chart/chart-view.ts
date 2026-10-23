import { METERS_PER_NAUTICAL_MILE, type Chart } from '../../core/coords';
import { Rng } from '../../core/rng';
import {
  distance,
  inRect,
  isWater,
  type ChartGeography,
  type Ring,
} from '../../sim/chart/geography';
import type { Contact } from '../../sim/chart/traffic';
import type { PlannedCourse, Voyage } from '../../sim/chart/voyage';

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
}

interface Sounding {
  pos: Chart;
  fathoms: number;
}

const FONT = '"Libre Caslon Text", "Iowan Old Style", Georgia, serif';

export class ChartView {
  /** Chart point at the canvas center. */
  center: Chart = { x: 0, y: 0 };
  /** Chart meters per CSS pixel. */
  metersPerPx = 200;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly parchment: CanvasPattern | null;
  private soundings: Sounding[] = [];
  private soundingsFor: ChartGeography | undefined;

  constructor(readonly canvas: HTMLCanvasElement) {
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('2D canvas unavailable');
    this.ctx = ctx;
    this.parchment = ctx.createPattern(createParchment(), 'repeat');
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

  draw(frame: ChartFrame): void {
    const { ctx, canvas } = this;
    const dpr = window.devicePixelRatio || 1;
    const w = this.width;
    const h = this.height;
    if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';

    const geo = frame.geo;
    this.drawBase(geo);
    this.drawSoundings(geo);
    this.drawGraticule(geo);
    this.drawZones(geo);
    this.drawUncharted(geo);
    this.drawLabels(geo);

    // Night falls over the paper; lights, ships and the course stay readable on top.
    if (frame.daylight < 1) {
      ctx.fillStyle = `rgba(18, 28, 46, ${0.42 * (1 - frame.daylight)})`;
      ctx.fillRect(0, 0, w, h);
    }
    this.drawLights(geo, frame.daylight);
    this.drawPorts(geo);
    this.drawSpotRange(frame);
    this.drawContacts(frame);
    this.drawCourse(frame);
    this.drawShip(frame.position, frame.heading);
    this.drawCompassRose(h);
    this.drawScaleBar(h);
  }

  private ringPath(ring: Ring): void {
    const { ctx } = this;
    ring.points.forEach((p, i) => {
      const s = this.toScreen(p);
      if (i === 0) ctx.moveTo(s.x, s.y);
      else ctx.lineTo(s.x, s.y);
    });
    ctx.closePath();
  }

  private waterPath(geo: ChartGeography): Path2D {
    const path = new Path2D();
    for (const ring of [geo.water, ...geo.islands]) {
      ring.points.forEach((p, i) => {
        const s = this.toScreen(p);
        if (i === 0) path.moveTo(s.x, s.y);
        else path.lineTo(s.x, s.y);
      });
      path.closePath();
    }
    return path;
  }

  private drawBase(geo: ChartGeography): void {
    const { ctx } = this;
    const w = this.width;
    const h = this.height;
    ctx.fillStyle = CHART_COLORS.land;
    ctx.fillRect(0, 0, w, h);

    const water = this.waterPath(geo);
    ctx.fillStyle = CHART_COLORS.water;
    ctx.fill(water, 'evenodd');

    // Depth vignette: the classic chart shading that hugs the shore, inside the water.
    ctx.save();
    ctx.clip(water, 'evenodd');
    const coast = (): void => {
      ctx.beginPath();
      for (const ring of [geo.water, ...geo.islands]) this.ringPath(ring);
    };
    const bands: [number, number][] = [
      [26, 0.05],
      [14, 0.07],
      [6, 0.1],
    ];
    for (const [width, alpha] of bands) {
      coast();
      ctx.strokeStyle = `rgba(47, 111, 115, ${alpha})`;
      ctx.lineWidth = width;
      ctx.stroke();
    }
    // A thin waterline a few pixels offshore.
    coast();
    ctx.strokeStyle = 'rgba(43, 33, 24, 0.25)';
    ctx.lineWidth = 7;
    ctx.stroke();
    coast();
    ctx.strokeStyle = CHART_COLORS.water;
    ctx.lineWidth = 5;
    ctx.stroke();
    ctx.restore();

    coast();
    ctx.strokeStyle = CHART_COLORS.ink;
    ctx.lineWidth = 1.3;
    ctx.stroke();

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
   * Illustrative soundings until S3 bakes real depths: deeper away from shore, in
   * fathoms like the 1900 Lake Survey charts.
   */
  private drawSoundings(geo: ChartGeography): void {
    if (this.soundingsFor !== geo) {
      this.soundings = makeSoundings(geo);
      this.soundingsFor = geo;
    }
    const { ctx } = this;
    const minGapPx = 46;
    const step = Math.max(1, Math.round((minGapPx * this.metersPerPx) / SOUNDING_SPACING_M));
    ctx.fillStyle = 'rgba(43, 33, 24, 0.55)';
    ctx.font = `italic 10px ${FONT}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (const s of this.soundings) {
      const gx = Math.round(s.pos.x / SOUNDING_SPACING_M);
      const gy = Math.round(s.pos.y / SOUNDING_SPACING_M);
      if (gx % step !== 0 || gy % step !== 0) continue;
      const p = this.toScreen(s.pos);
      if (p.x < 0 || p.y < 0 || p.x > this.width || p.y > this.height) continue;
      ctx.fillText(String(s.fathoms), p.x, p.y);
    }
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
      const a = Math.abs(deg);
      const d = Math.floor(a + 1e-6);
      const m = Math.round((a - d) * 60);
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
      const c = centroid(island.points);
      const sizePx = (island.bounds.max.x - island.bounds.min.x) / this.metersPerPx;
      if (sizePx < 14) continue;
      const s = this.toScreen(c);
      ctx.fillText(island.name, s.x, s.y);
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

  private drawContacts(frame: ChartFrame): void {
    const { ctx } = this;
    for (const c of frame.contacts) {
      const seenNow = frame.visible.has(c.id);
      if (!seenNow && (!c.lastSeen || frame.now - c.lastSeen.at > GHOST_MAX_AGE_S)) continue;
      const pos = seenNow ? c.pos : (c.lastSeen as { pos: Chart }).pos;
      const s = this.toScreen(pos);
      if (c.kind === 'storm') {
        drawStorm(ctx, s.x, s.y, (c.radiusM ?? 0) / this.metersPerPx, seenNow);
      } else {
        drawContactGlyph(ctx, c, s.x, s.y, seenNow);
      }
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
        if (r > 3 && c.kind !== 'storm') {
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

const SOUNDING_SPACING_M = 4000;
/** Sightings older than this drop off the chart; plan 05's rumors take over. */
const GHOST_MAX_AGE_S = 6 * 3600;
/** Cap on a ghost's "could be anywhere in here" circle. */
const GHOST_MAX_REACH_M = 15 * METERS_PER_NAUTICAL_MILE;

function makeSoundings(geo: ChartGeography): Sounding[] {
  const rng = Rng.fromSeed('chart-soundings');
  const coast = [geo.water, ...geo.islands].flatMap((r) => r.points);
  const out: Sounding[] = [];
  const { min, max } = geo.charted;
  for (let y = Math.ceil(min.y / SOUNDING_SPACING_M); y * SOUNDING_SPACING_M <= max.y; y++) {
    for (let x = Math.ceil(min.x / SOUNDING_SPACING_M); x * SOUNDING_SPACING_M <= max.x; x++) {
      const pos = { x: x * SOUNDING_SPACING_M, y: y * SOUNDING_SPACING_M };
      if (!inRect(pos, geo.charted) || !isWater(geo, pos)) continue;
      let d = Infinity;
      for (const c of coast) d = Math.min(d, distance(pos, c));
      if (d < 1200) continue;
      const fathoms = Math.round(Math.min(3 + (d / 1000) * 4.5, 120) * rng.range(0.8, 1.2));
      out.push({ pos, fathoms });
    }
  }
  return out;
}

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
