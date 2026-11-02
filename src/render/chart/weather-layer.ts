import { METERS_PER_NAUTICAL_MILE, type Chart } from '../../core/coords';
import {
  fieldValue,
  forecastSpreadM,
  type ChartPressureCentre,
  type ChartWeatherPicture,
  type WeatherField,
} from '../../sim/chart/chart-weather';
import { INHG_PER_HPA } from '../../ui/hud/model';

/**
 * The weather on the chart (plan 04 §12; Phase 3 piece E), drawn as a forecaster's
 * overlay on the period chart: isobars in inches of mercury, the lows and highs with their
 * tracks, fronts in the old hand-drawn style, rain hatched, fog banks shaded, squalls as
 * dark cells with their lightning, and wind arrows flying with the wind, feathered by
 * strength. A forecast picture (a lead ahead) is drawn the same, with the uncertainty
 * around the systems, banks and cells it can't be sure of.
 *
 * The chart view draws the field (rain, isobars, fronts, wind, the systems) over a copy of
 * its static layer and keeps the result, drawing it again when the view settles or the
 * weather has moved on by WEATHER_REDRAW_S, so a still frame is one copy. The fog banks
 * and squalls are drawn live each frame (`drawLive`), so they stand where they are met.
 */

export interface WeatherView {
  readonly center: Chart;
  readonly metersPerPx: number;
  readonly width: number;
  readonly height: number;
  toScreen(p: Chart): { x: number; y: number };
}

/** The cached field is drawn again once the weather has moved on this far, game seconds. */
export const WEATHER_REDRAW_S = 1800;

const FONT = '"Libre Caslon Text", "Iowan Old Style", Georgia, serif';
const INK = '43, 33, 24';
const RED = '179, 54, 43';
const SLATE = '58, 72, 92';
const FOG = '141, 138, 131';

/**
 * Isobars every 0.02 inHg (about 0.7 hPa). A 1900 continental map used 0.1 in; the western
 * lake is only 90 nm across, so the step is finer to show the gradient across it.
 */
export const ISOBAR_STEP_INHG = 0.02;
/** Wind arrows stand about this far apart on screen, CSS px. */
const ARROW_SPACING_PX = 92;

export class WeatherLayer {
  /** The context being drawn into: the chart view's composite of its static layer. */
  private ctx!: CanvasRenderingContext2D;
  private size = { w: 0, h: 0 };
  /** Rain as an image one pixel per field cell, scaled up smoothly. */
  private readonly rainImage: HTMLCanvasElement;
  private readonly scratch: HTMLCanvasElement;
  private hatch: CanvasPattern | null = null;
  /** Redraws since construction (for tests and the bench). */
  draws = 0;

  constructor() {
    this.rainImage = document.createElement('canvas');
    this.scratch = document.createElement('canvas');
  }

  /**
   * Draw the weather over `target`, which holds the chart's static layer at device
   * pixels. The caller caches the result (the chart view's composite), so this runs only
   * when the view settles or the picture changes.
   */
  drawInto(
    target: CanvasRenderingContext2D,
    view: WeatherView,
    picture: ChartWeatherPicture,
    dpr: number,
  ): void {
    this.ctx = target;
    this.size = { w: target.canvas.width, h: target.canvas.height };
    target.save();
    this.render(view, picture, dpr);
    target.restore();
    this.draws++;
  }

  private render(view: WeatherView, pic: ChartWeatherPicture, dpr: number): void {
    const { ctx } = this;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    const forecast = pic.leadHours > 0;
    this.drawRain(view, pic.field, dpr);
    this.drawIsobars(view, pic.field);
    this.drawFronts(view, pic.centres);
    this.drawWindArrows(view, pic.field);
    this.drawCentres(view, pic, forecast);
  }

  /**
   * The fog banks and squalls, drawn every frame over the chart: they are what the ship
   * meets, so they must stand where the lookouts report them, while the slower field
   * under them (rain, isobars, fronts, wind) is cached.
   */
  drawLive(
    target: CanvasRenderingContext2D,
    view: WeatherView,
    pic: ChartWeatherPicture,
    night: number,
  ): void {
    this.ctx = target;
    target.save();
    const forecast = pic.leadHours > 0;
    this.drawFog(view, pic, forecast, night);
    this.drawCells(view, pic, forecast);
    target.restore();
  }

  // -------------------------------------------------------------------------------
  // Rain

  private drawRain(view: WeatherView, field: WeatherField, dpr: number): void {
    const { cols, rows } = field;
    const img = this.rainImage;
    if (img.width !== cols || img.height !== rows) {
      img.width = cols;
      img.height = rows;
    }
    const ictx = img.getContext('2d');
    if (!ictx) return;
    const data = ictx.createImageData(cols, rows);
    let any = false;
    for (let j = 0; j < rows; j++) {
      for (let i = 0; i < cols; i++) {
        const rain = field.rain[j * cols + i] as number;
        const a = rain < 0.2 ? 0 : Math.min(1, (rain - 0.2) / 0.6);
        if (a > 0) any = true;
        // Image rows run top down; the field's run south to north.
        const o = ((rows - 1 - j) * cols + i) * 4;
        data.data[o] = 58;
        data.data[o + 1] = 72;
        data.data[o + 2] = 92;
        data.data[o + 3] = Math.round(255 * a);
      }
    }
    if (!any) return;
    ictx.putImageData(data, 0, 0);

    // The grid's corners on screen: cell centres sit on the samples.
    const sw = view.toScreen(field.origin);
    const ne = view.toScreen({
      x: field.origin.x + (cols - 1) * field.cellM,
      y: field.origin.y + (rows - 1) * field.cellM,
    });
    const cellPx = field.cellM / view.metersPerPx;
    const x = sw.x - cellPx / 2;
    const y = ne.y - cellPx / 2;
    const w = ne.x - sw.x + cellPx;
    const h = sw.y - ne.y + cellPx;

    // Hatching where it rains, diagonal strokes the old chart's way, over a light wash.
    const { ctx } = this;
    // The hatching is masked at half resolution: a full-size composite costs several
    // milliseconds on a software canvas, and the strokes don't need the detail.
    const s = this.scratch;
    const sw2 = Math.ceil(this.size.w / 2);
    const sh2 = Math.ceil(this.size.h / 2);
    if (s.width !== sw2 || s.height !== sh2) {
      s.width = sw2;
      s.height = sh2;
    }
    const sctx = s.getContext('2d');
    if (!sctx) return;
    sctx.setTransform(1, 0, 0, 1, 0, 0);
    sctx.globalCompositeOperation = 'source-over';
    sctx.clearRect(0, 0, s.width, s.height);
    sctx.setTransform(dpr / 2, 0, 0, dpr / 2, 0, 0);
    sctx.imageSmoothingEnabled = true;
    sctx.drawImage(img, x, y, w, h);
    sctx.globalCompositeOperation = 'source-in';
    sctx.setTransform(1, 0, 0, 1, 0, 0);
    this.hatch ??= sctx.createPattern(createHatch(), 'repeat');
    if (this.hatch) {
      sctx.fillStyle = this.hatch;
      sctx.fillRect(0, 0, s.width, s.height);
    }
    // The wash goes under the strokes, so the two cost one blit onto the chart.
    sctx.globalCompositeOperation = 'destination-over';
    sctx.globalAlpha = 0.3;
    sctx.setTransform(dpr / 2, 0, 0, dpr / 2, 0, 0);
    sctx.drawImage(img, x, y, w, h);
    sctx.globalAlpha = 1;
    sctx.globalCompositeOperation = 'source-over';
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 0.45;
    ctx.drawImage(s, 0, 0, this.size.w, this.size.h);
    ctx.restore();
  }

  // -------------------------------------------------------------------------------
  // Fog banks

  private drawFog(
    view: WeatherView,
    pic: ChartWeatherPicture,
    forecast: boolean,
    night: number,
  ): void {
    const { ctx } = this;
    const spread = forecast ? forecastSpreadM(pic.leadHours, pic.spreadScale) : 0;
    for (const bank of pic.fogBanks) {
      const s = view.toScreen(bank.pos);
      const r = (bank.radiusM + spread) / view.metersPerPx;
      const wall = (bank.wallM + spread * 0.5) / view.metersPerPx;
      if (r < 2) continue;
      const a = 0.5 * bank.strength * (forecast ? 0.6 : 1) * (1 - 0.3 * night);
      const g = ctx.createRadialGradient(s.x, s.y, 0, s.x, s.y, r);
      g.addColorStop(0, `rgba(${FOG}, ${a})`);
      g.addColorStop(0.45, `rgba(${FOG}, ${a})`);
      g.addColorStop(1, `rgba(${FOG}, 0)`);
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(s.x, s.y, r, 0, Math.PI * 2);
      ctx.fill();
      // The wall: where the fog is half strength, as a zone shows it from outside.
      ctx.save();
      ctx.setLineDash(forecast ? [2, 6] : [1, 4]);
      ctx.strokeStyle = `rgba(${FOG}, ${0.9 * bank.strength})`;
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      ctx.arc(s.x, s.y, wall, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }
  }

  // -------------------------------------------------------------------------------
  // Isobars

  private drawIsobars(view: WeatherView, field: WeatherField): void {
    const { cols, rows } = field;
    let lo = Infinity;
    let hi = -Infinity;
    for (const v of field.pressure) {
      lo = Math.min(lo, v);
      hi = Math.max(hi, v);
    }
    const loIn = lo * INHG_PER_HPA;
    const hiIn = hi * INHG_PER_HPA;
    const first = Math.ceil(loIn / ISOBAR_STEP_INHG) * ISOBAR_STEP_INHG;
    const { ctx } = this;
    ctx.save();
    ctx.strokeStyle = `rgba(${INK}, 0.42)`;
    ctx.lineWidth = 1;
    ctx.font = `italic 10px ${FONT}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const at = (i: number, j: number): Chart => ({
      x: field.origin.x + i * field.cellM,
      y: field.origin.y + j * field.cellM,
    });
    for (let level = first; level <= hiIn + 1e-9; level += ISOBAR_STEP_INHG) {
      const hpa = level / INHG_PER_HPA;
      const segs = contourSegments(field.pressure, cols, rows, hpa);
      if (segs.length === 0) continue;
      ctx.beginPath();
      let label: { x: number; y: number } | undefined;
      let bestY = Infinity;
      for (const [a, b] of segs) {
        const pa = view.toScreen(at(a.i, a.j));
        const pb = view.toScreen(at(b.i, b.j));
        ctx.moveTo(pa.x, pa.y);
        ctx.lineTo(pb.x, pb.y);
        // Label each isobar where it is highest on screen and inside the view.
        const mx = (pa.x + pb.x) / 2;
        const my = (pa.y + pb.y) / 2;
        if (mx > 40 && mx < view.width - 40 && my > 30 && my < bestY) {
          bestY = my;
          label = { x: mx, y: my };
        }
      }
      ctx.stroke();
      if (label) haloText(ctx, level.toFixed(2), label.x, label.y + 7, `rgba(${INK}, 0.7)`);
    }
    ctx.restore();
  }

  // -------------------------------------------------------------------------------
  // Squalls

  private drawCells(view: WeatherView, pic: ChartWeatherPicture, forecast: boolean): void {
    const { ctx } = this;
    const spread = forecast ? forecastSpreadM(pic.leadHours, pic.spreadScale) * 0.5 : 0;
    for (const cell of pic.cells) {
      const s = view.toScreen(cell.pos);
      const r = (cell.radiusM + spread) / view.metersPerPx;
      ctx.save();
      const g = ctx.createRadialGradient(s.x, s.y, 0, s.x, s.y, r);
      const a = (forecast ? 0.16 : 0.26) * Math.min(1, 0.5 + cell.strength);
      g.addColorStop(0, `rgba(${SLATE}, ${a})`);
      g.addColorStop(0.7, `rgba(${SLATE}, ${a * 0.7})`);
      g.addColorStop(1, `rgba(${SLATE}, 0)`);
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(s.x, s.y, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.setLineDash(forecast ? [3, 6] : [6, 4]);
      ctx.strokeStyle = `rgba(${INK}, ${forecast ? 0.45 : 0.7})`;
      ctx.lineWidth = 1.4;
      ctx.stroke();
      ctx.setLineDash([]);
      // A thunder squall carries a bolt; a cold squall the barbed squall-line mark.
      ctx.strokeStyle = cell.thunder ? `rgba(${RED}, 0.9)` : `rgba(${INK}, 0.8)`;
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      if (cell.thunder) {
        ctx.moveTo(s.x + 2, s.y - 9);
        ctx.lineTo(s.x - 3, s.y + 1);
        ctx.lineTo(s.x + 2, s.y);
        ctx.lineTo(s.x - 2, s.y + 9);
      } else {
        ctx.moveTo(s.x - 8, s.y + 3);
        ctx.lineTo(s.x - 4, s.y - 3);
        ctx.lineTo(s.x, s.y + 3);
        ctx.lineTo(s.x + 4, s.y - 3);
        ctx.lineTo(s.x + 8, s.y + 3);
      }
      ctx.stroke();
      ctx.restore();
    }
  }

  // -------------------------------------------------------------------------------
  // Fronts

  /**
   * A front for each low with a centre to speak of: the warm front running east-southeast
   * from the centre and the cold front trailing south-southwest, where the sim's rain
   * shield and wind shift lie. Drawn as curves with the usual barbs and bumps.
   */
  private drawFronts(view: WeatherView, centres: readonly ChartPressureCentre[]): void {
    const { ctx } = this;
    for (const c of centres) {
      if (c.kind !== 'low' || c.hpa > 1007) continue;
      const deg = Math.PI / 180;
      const warm = frontPath(c.pos, 112 * deg, 0.55 * c.radiusM, 1);
      const cold = frontPath(c.pos, 208 * deg, 0.75 * c.radiusM, -1);
      this.drawFront(view, warm, 'warm');
      this.drawFront(view, cold, 'cold');
    }
    ctx.setLineDash([]);
  }

  private drawFront(view: WeatherView, path: Chart[], kind: 'warm' | 'cold'): void {
    const { ctx } = this;
    const pts = path.map((p) => view.toScreen(p));
    ctx.save();
    const color = kind === 'warm' ? `rgba(${RED}, 0.85)` : `rgba(${INK}, 0.8)`;
    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    ctx.lineWidth = 1.8;
    ctx.beginPath();
    pts.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
    ctx.stroke();
    // Marks every 28 px along the line, on the side the front is moving toward (east).
    let carry = 14;
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1] as { x: number; y: number };
      const b = pts[i] as { x: number; y: number };
      const len = Math.hypot(b.x - a.x, b.y - a.y);
      if (len === 0) continue;
      const ux = (b.x - a.x) / len;
      const uy = (b.y - a.y) / len;
      // The normal on the east (screen right) side.
      let nx = -uy;
      let ny = ux;
      if (nx < 0) {
        nx = -nx;
        ny = -ny;
      }
      let d = carry;
      while (d < len) {
        const x = a.x + ux * d;
        const y = a.y + uy * d;
        if (x > -20 && x < view.width + 20 && y > -20 && y < view.height + 20) {
          ctx.beginPath();
          if (kind === 'cold') {
            ctx.moveTo(x - ux * 5, y - uy * 5);
            ctx.lineTo(x + nx * 7, y + ny * 7);
            ctx.lineTo(x + ux * 5, y + uy * 5);
          } else {
            const ang = Math.atan2(ny, nx);
            ctx.arc(x, y, 5, ang - Math.PI / 2, ang + Math.PI / 2);
          }
          ctx.closePath();
          ctx.fill();
        }
        d += 28;
      }
      carry = d - len;
    }
    ctx.restore();
  }

  // -------------------------------------------------------------------------------
  // Wind

  private drawWindArrows(view: WeatherView, field: WeatherField): void {
    const { ctx } = this;
    const tl = { x: field.origin.x, y: field.origin.y + (field.rows - 1) * field.cellM };
    const br = { x: field.origin.x + (field.cols - 1) * field.cellM, y: field.origin.y };
    const a = view.toScreen(tl);
    const b = view.toScreen(br);
    const x0 = Math.max(a.x, 0) + ARROW_SPACING_PX / 2;
    const y0 = Math.max(a.y, 0) + ARROW_SPACING_PX / 2;
    const x1 = Math.min(b.x, view.width);
    const y1 = Math.min(b.y, view.height);
    ctx.save();
    ctx.strokeStyle = `rgba(${INK}, 0.45)`;
    ctx.fillStyle = `rgba(${INK}, 0.45)`;
    ctx.lineWidth = 1;
    // Offset alternate rows, so the arrows read as a field rather than a grid.
    let row = 0;
    for (let y = y0; y < y1; y += ARROW_SPACING_PX * 0.87, row++) {
      for (let x = x0 + (row % 2) * (ARROW_SPACING_PX / 2); x < x1; x += ARROW_SPACING_PX) {
        const p = {
          x: view.center.x + (x - view.width / 2) * view.metersPerPx,
          y: view.center.y - (y - view.height / 2) * view.metersPerPx,
        };
        const wx = fieldValue(field, field.windX, p);
        const wy = fieldValue(field, field.windY, p);
        windArrow(ctx, x, y, wx, wy);
      }
    }
    ctx.restore();
  }

  // -------------------------------------------------------------------------------
  // Lows and highs

  private drawCentres(view: WeatherView, pic: ChartWeatherPicture, forecast: boolean): void {
    const { ctx } = this;
    const margin = 26;
    /** Edge labels already placed, so a second system's label steps clear of the first. */
    const placed: { x: number; y: number }[] = [];
    for (const c of pic.centres) {
      const s = view.toScreen(c.pos);
      const low = c.kind === 'low';
      const color = low ? `rgba(${RED}, 0.92)` : `rgba(${INK}, 0.85)`;
      const inHg = (c.hpa * INHG_PER_HPA).toFixed(2);
      const onScreen =
        s.x > margin && s.x < view.width - margin && s.y > margin && s.y < view.height - margin;
      if (onScreen) {
        // The track ahead for twelve hours, with the uncertainty it gathers.
        const ahead = 12;
        const next = view.toScreen({
          x: c.pos.x + c.vx * ahead * 3600,
          y: c.pos.y + c.vy * ahead * 3600,
        });
        ctx.save();
        ctx.strokeStyle = color;
        ctx.setLineDash([4, 5]);
        ctx.lineWidth = 1.3;
        ctx.beginPath();
        ctx.moveTo(s.x, s.y);
        ctx.lineTo(next.x, next.y);
        ctx.stroke();
        const cone = forecastSpreadM(pic.leadHours + ahead, pic.spreadScale) / view.metersPerPx;
        ctx.setLineDash([2, 4]);
        ctx.beginPath();
        ctx.arc(next.x, next.y, cone, 0, Math.PI * 2);
        ctx.stroke();
        if (forecast) {
          ctx.beginPath();
          ctx.arc(
            s.x,
            s.y,
            forecastSpreadM(pic.leadHours, pic.spreadScale) / view.metersPerPx,
            0,
            Math.PI * 2,
          );
          ctx.stroke();
        }
        ctx.restore();
        ctx.save();
        ctx.font = `bold 26px ${FONT}`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        haloText(ctx, low ? 'L' : 'H', s.x, s.y, color);
        ctx.font = `italic 11px ${FONT}`;
        haloText(ctx, inHg, s.x, s.y + 19, color);
        ctx.restore();
        continue;
      }
      // Off the view: a pointer at the edge, the way a forecaster notes a system beyond the map.
      const cx = view.width / 2;
      const cy = view.height / 2;
      const dx = s.x - cx;
      const dy = s.y - cy;
      const k = Math.min(
        (view.width / 2 - margin) / Math.max(Math.abs(dx), 1e-6),
        (view.height / 2 - margin) / Math.max(Math.abs(dy), 1e-6),
      );
      const ex = cx + dx * k;
      const ey = cy + dy * k;
      const ang = Math.atan2(dy, dx);
      const distNm =
        Math.hypot(c.pos.x - view.center.x, c.pos.y - view.center.y) / METERS_PER_NAUTICAL_MILE;
      ctx.save();
      ctx.translate(ex, ey);
      ctx.fillStyle = color;
      ctx.rotate(ang);
      ctx.beginPath();
      ctx.moveTo(8, 0);
      ctx.lineTo(-4, -6);
      ctx.lineTo(-4, 6);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
      ctx.save();
      ctx.font = `italic 11px ${FONT}`;
      ctx.textBaseline = 'middle';
      ctx.textAlign = dx > 0 ? 'right' : 'left';
      const lx = ex - Math.cos(ang) * 14;
      let ly =
        ey -
        Math.sin(ang) * 14 +
        (Math.abs(dy * k) > view.height / 2 - margin - 1 ? (dy > 0 ? -8 : 8) : 0);
      while (placed.some((q) => Math.abs(q.x - lx) < 420 && Math.abs(q.y - ly) < 14)) {
        ly += dy > 0 ? -14 : 14;
      }
      placed.push({ x: lx, y: ly });
      const moving = compass8(Math.atan2(c.vx, c.vy));
      haloText(
        ctx,
        `${low ? 'Low' : 'High'} ${inHg}, ${Math.round(distNm / 10) * 10} nm, moving ${moving}`,
        lx,
        ly,
        color,
      );
      ctx.restore();
    }
  }
}

/** A gentle curve from `from` along `bearing` for `length` meters, bowing to one side. */
function frontPath(from: Chart, bearing: number, length: number, bow: number): Chart[] {
  const pts: Chart[] = [];
  const n = 24;
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    // The curve turns 25° over its length, like a front wrapping round its low.
    const b = bearing + bow * 0.44 * t;
    const along = length * t;
    pts.push({ x: from.x + Math.sin(b) * along, y: from.y + Math.cos(b) * along });
  }
  return pts;
}

const POINTS8 = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
function compass8(rad: number): string {
  const i = Math.round((((rad / (Math.PI * 2)) % 1) + 1) * 8) % 8;
  return POINTS8[i] as string;
}

/**
 * A wind arrow flying with the wind (x east, y north, knots), with a feather at the tail
 * for every 10 kn and half a feather for 5. Calm is a small ring.
 */
function windArrow(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  wx: number,
  wy: number,
): void {
  const kn = Math.hypot(wx, wy);
  if (kn < 2) {
    ctx.beginPath();
    ctx.arc(x, y, 3, 0, Math.PI * 2);
    ctx.stroke();
    return;
  }
  // Screen direction the air moves (y down).
  const ux = wx / kn;
  const uy = -wy / kn;
  const len = 26;
  const hx = x + (ux * len) / 2;
  const hy = y + (uy * len) / 2;
  const tx = x - (ux * len) / 2;
  const ty = y - (uy * len) / 2;
  ctx.beginPath();
  ctx.moveTo(tx, ty);
  ctx.lineTo(hx, hy);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(hx, hy);
  ctx.lineTo(hx - ux * 6 - uy * 3, hy - uy * 6 + ux * 3);
  ctx.lineTo(hx - ux * 6 + uy * 3, hy - uy * 6 - ux * 3);
  ctx.closePath();
  ctx.fill();
  // Feathers, on the left of the shaft as it flies, from the tail.
  const rounded = Math.round(kn / 5) * 5;
  let full = Math.floor(rounded / 10);
  const half = rounded % 10 === 5;
  const nx = uy;
  const ny = -ux;
  let along = 0;
  ctx.beginPath();
  for (; full > 0 && along < len * 0.7; full--, along += 4) {
    const bx = tx + ux * along;
    const by = ty + uy * along;
    ctx.moveTo(bx, by);
    ctx.lineTo(bx + nx * 7 - ux * 3, by + ny * 7 - uy * 3);
  }
  if (half && along < len * 0.7) {
    const bx = tx + ux * along;
    const by = ty + uy * along;
    ctx.moveTo(bx, by);
    ctx.lineTo(bx + nx * 4 - ux * 2, by + ny * 4 - uy * 2);
  }
  ctx.stroke();
}

function haloText(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  color: string,
): void {
  ctx.save();
  ctx.lineWidth = 3;
  ctx.strokeStyle = 'rgba(233, 220, 187, 0.85)';
  ctx.strokeText(text, x, y);
  ctx.fillStyle = color;
  ctx.fillText(text, x, y);
  ctx.restore();
}

/** Diagonal rain strokes on a transparent tile. */
function createHatch(): HTMLCanvasElement {
  const c = document.createElement('canvas');
  // Drawn at half resolution, so this tile shows at 12 px.
  c.width = 6;
  c.height = 6;
  const ctx = c.getContext('2d');
  if (!ctx) return c;
  ctx.strokeStyle = `rgba(${SLATE}, 1)`;
  ctx.lineWidth = 0.7;
  ctx.beginPath();
  ctx.moveTo(-1, 7);
  ctx.lineTo(7, -1);
  ctx.moveTo(-1, 1);
  ctx.lineTo(1, -1);
  ctx.moveTo(5, 7);
  ctx.lineTo(7, 5);
  ctx.stroke();
  return c;
}

type GridPoint = { i: number; j: number };

/**
 * Marching squares over a row-major grid: the segments where it crosses `level`, in grid
 * coordinates. Saddles are split by the cell's mean.
 */
export function contourSegments(
  values: ArrayLike<number>,
  cols: number,
  rows: number,
  level: number,
): [GridPoint, GridPoint][] {
  const out: [GridPoint, GridPoint][] = [];
  const v = (i: number, j: number): number => values[j * cols + i] as number;
  const lerp = (a: number, b: number): number => (level - a) / (b - a);
  for (let j = 0; j < rows - 1; j++) {
    for (let i = 0; i < cols - 1; i++) {
      const a = v(i, j);
      const b = v(i + 1, j);
      const c = v(i + 1, j + 1);
      const d = v(i, j + 1);
      const idx =
        (a > level ? 1 : 0) | (b > level ? 2 : 0) | (c > level ? 4 : 0) | (d > level ? 8 : 0);
      if (idx === 0 || idx === 15) continue;
      const bottom = { i: i + lerp(a, b), j };
      const right = { i: i + 1, j: j + lerp(b, c) };
      const top = { i: i + lerp(d, c), j: j + 1 };
      const left = { i, j: j + lerp(a, d) };
      switch (idx) {
        case 1:
        case 14:
          out.push([left, bottom]);
          break;
        case 2:
        case 13:
          out.push([bottom, right]);
          break;
        case 3:
        case 12:
          out.push([left, right]);
          break;
        case 4:
        case 11:
          out.push([right, top]);
          break;
        case 6:
        case 9:
          out.push([bottom, top]);
          break;
        case 7:
        case 8:
          out.push([left, top]);
          break;
        case 5:
        case 10: {
          const mean = (a + b + c + d) / 4;
          const joinAC = mean > level === (idx === 5);
          if (joinAC) {
            out.push([left, top], [bottom, right]);
          } else {
            out.push([left, bottom], [right, top]);
          }
          break;
        }
      }
    }
  }
  return out;
}
