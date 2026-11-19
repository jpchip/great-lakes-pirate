import type { Chart } from '../../core/coords';
import type { IcePicture } from '../../sim/ice/ice';
import { ICE_KINDS } from '../../sim/ice/season';

/**
 * The ice on the chart (plan 04 §12: "ice extent as a hatched overlay"; piece K): the
 * winter's ice over the water as a chart-maker would show it, a pale wash ruled with fine
 * hatching where it is solid (forming, fast or pack ice) and stippled where it has broken
 * into floes at ice-out. One pixel a field cell, scaled up smoothly, then hatched; the
 * result is kept until the view or the day changes, so a still frame is one copy.
 */
export interface IceView {
  readonly center: Chart;
  readonly metersPerPx: number;
  readonly width: number;
  readonly height: number;
  toScreen(p: Chart): { x: number; y: number };
}

const SOLID = new Set(['forming', 'fast', 'pack'].map((k) => ICE_KINDS.indexOf(k as never)));
const FLOES = ICE_KINDS.indexOf('floes');

export class IceLayer {
  private readonly cells: HTMLCanvasElement;
  private readonly floes: HTMLCanvasElement;
  private readonly out: HTMLCanvasElement;
  private key = '';
  private cellsKey = '';
  private hatch: CanvasPattern | null = null;
  private stipple: CanvasPattern | null = null;
  /** Redraws since construction (for tests). */
  draws = 0;

  constructor() {
    this.cells = document.createElement('canvas');
    this.floes = document.createElement('canvas');
    this.out = document.createElement('canvas');
  }

  draw(ctx: CanvasRenderingContext2D, view: IceView, pic: IcePicture, dpr: number): void {
    let any = false;
    for (let i = 0; i < pic.coverage.length; i++) {
      if ((pic.coverage[i] as number) > 0.05) {
        any = true;
        break;
      }
    }
    if (!any) return;
    const w = Math.round(view.width * dpr);
    const h = Math.round(view.height * dpr);
    const key = `${pic.key}|${view.center.x},${view.center.y},${view.metersPerPx},${w},${h}`;
    if (key !== this.key) {
      this.render(view, pic, dpr, w, h);
      this.key = key;
    }
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(this.out, 0, 0);
    ctx.restore();
  }

  private fillCells(pic: IcePicture): void {
    if (this.cellsKey === pic.key) return;
    this.cellsKey = pic.key;
    for (const [canvas, want] of [
      [this.cells, 'solid'],
      [this.floes, 'floes'],
    ] as const) {
      canvas.width = pic.cols;
      canvas.height = pic.rows;
      const c = canvas.getContext('2d');
      if (!c) continue;
      const img = c.createImageData(pic.cols, pic.rows);
      for (let r = 0; r < pic.rows; r++) {
        for (let col = 0; col < pic.cols; col++) {
          const i = r * pic.cols + col;
          const k = pic.kind[i] as number;
          const hit = want === 'solid' ? SOLID.has(k) : k === FLOES;
          if (!hit) continue;
          // Image rows run from the north; the field's from the south.
          const o = ((pic.rows - 1 - r) * pic.cols + col) * 4;
          img.data[o] = 236;
          img.data[o + 1] = 242;
          img.data[o + 2] = 246;
          img.data[o + 3] = Math.round(255 * Math.min(1, pic.coverage[i] as number));
        }
      }
      c.putImageData(img, 0, 0);
    }
  }

  private patterns(ctx: CanvasRenderingContext2D, dpr: number): void {
    if (this.hatch && this.stipple) return;
    const tile = (draw: (c: CanvasRenderingContext2D, s: number) => void): CanvasPattern | null => {
      const s = Math.round(8 * dpr);
      const t = document.createElement('canvas');
      t.width = s;
      t.height = s;
      const c = t.getContext('2d');
      if (!c) return null;
      draw(c, s);
      return ctx.createPattern(t, 'repeat');
    };
    this.hatch = tile((c, s) => {
      c.strokeStyle = 'rgba(70, 96, 128, 0.55)';
      c.lineWidth = Math.max(1, dpr * 0.8);
      c.beginPath();
      c.moveTo(0, s);
      c.lineTo(s, 0);
      c.moveTo(-s / 2, s / 2);
      c.lineTo(s / 2, -s / 2);
      c.moveTo(s / 2, s * 1.5);
      c.lineTo(s * 1.5, s / 2);
      c.stroke();
    });
    this.stipple = tile((c, s) => {
      c.fillStyle = 'rgba(70, 96, 128, 0.6)';
      const d = Math.max(1, dpr);
      c.fillRect(s * 0.2, s * 0.25, d, d);
      c.fillRect(s * 0.7, s * 0.7, d, d);
    });
  }

  private render(view: IceView, pic: IcePicture, dpr: number, w: number, h: number): void {
    this.draws++;
    this.fillCells(pic);
    const out = this.out;
    out.width = w;
    out.height = h;
    const ctx = out.getContext('2d');
    if (!ctx) return;
    this.patterns(ctx, dpr);
    // The field's north-west corner and its size on screen.
    const nw = view.toScreen({ x: pic.min.x, y: pic.min.y + pic.rows * pic.cellM });
    const sw = (pic.cols * pic.cellM) / view.metersPerPx;
    const sh = (pic.rows * pic.cellM) / view.metersPerPx;
    const layer = (src: HTMLCanvasElement, pattern: CanvasPattern | null): void => {
      const tmp = document.createElement('canvas');
      tmp.width = w;
      tmp.height = h;
      const c = tmp.getContext('2d');
      if (!c) return;
      c.imageSmoothingEnabled = true;
      c.drawImage(src, nw.x * dpr, nw.y * dpr, sw * dpr, sh * dpr);
      if (pattern) {
        c.globalCompositeOperation = 'source-atop';
        c.fillStyle = pattern;
        c.fillRect(0, 0, w, h);
      }
      ctx.drawImage(tmp, 0, 0);
    };
    layer(this.cells, this.hatch);
    layer(this.floes, this.stipple);
  }
}
