import type { Chart } from '../../core/coords';
import type { ChartView } from '../../render/chart/chart-view';
import { distance } from '../../sim/chart/geography';
import type { ChartSession } from '../../modes/chart';

/**
 * Course plotting on the chart canvas (plan 13 §4.3, from prototype S8): click to add a
 * waypoint (it snaps to a port nearby), drag one to move it, right-click to delete it,
 * Shift-click to insert one into the nearest leg. Dragging empty chart pans and the wheel
 * zooms, whether or not the course can be edited.
 */

const PICK_PX = 10;
const SNAP_PX = 12;

export interface Plotting {
  /** The waypoint under the cursor, for the view to highlight. */
  readonly hoverWaypoint: number | undefined;
  detach(): void;
}

export interface PlottingOptions {
  view: ChartView;
  session: ChartSession;
  /** True while the course may change: not under way, no encounter waiting. */
  canPlot(): boolean;
  /** Plan the course again after the waypoints change. */
  replot(): void;
}

/** Index to insert at so `p` splits the leg of `[from, ...waypoints]` it is closest to. */
export function nearestLeg(from: Chart, waypoints: readonly Chart[], p: Chart): number {
  const pts = [from, ...waypoints];
  let best = 0;
  let bestD = Infinity;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1] as Chart;
    const b = pts[i] as Chart;
    const len2 = (b.x - a.x) ** 2 + (b.y - a.y) ** 2;
    const t =
      len2 > 0
        ? Math.min(Math.max(((p.x - a.x) * (b.x - a.x) + (p.y - a.y) * (b.y - a.y)) / len2, 0), 1)
        : 0;
    const d = distance(p, { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
    if (d < bestD) {
      bestD = d;
      best = i - 1;
    }
  }
  return best;
}

export function attachPlotting({ view, session, canPlot, replot }: PlottingOptions): Plotting {
  const canvas = view.canvas;
  let dragWaypoint: number | undefined;
  let pan: { x: number; y: number; moved: boolean } | undefined;
  let hoverWaypoint: number | undefined;

  const pick = (x: number, y: number): number | undefined => {
    let best: number | undefined;
    let bestD = PICK_PX;
    session.waypoints.forEach((p, i) => {
      const s = view.toScreen(p);
      const d = Math.hypot(s.x - x, s.y - y);
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    });
    return best;
  };

  const snap = (x: number, y: number): Chart => {
    for (const port of session.geo.ports) {
      const s = view.toScreen(port.pos);
      if (Math.hypot(s.x - x, s.y - y) < SNAP_PX) return { ...port.pos };
    }
    return view.toChart(x, y);
  };

  const onDown = (e: PointerEvent): void => {
    if (e.button !== 0) return;
    canvas.setPointerCapture(e.pointerId);
    const hit = canPlot() ? pick(e.offsetX, e.offsetY) : undefined;
    if (hit !== undefined) dragWaypoint = hit;
    else pan = { x: e.offsetX, y: e.offsetY, moved: false };
  };

  const onMove = (e: PointerEvent): void => {
    if (dragWaypoint !== undefined) {
      session.waypoints[dragWaypoint] = snap(e.offsetX, e.offsetY);
      replot();
      return;
    }
    if (pan) {
      const dx = e.offsetX - pan.x;
      const dy = e.offsetY - pan.y;
      if (pan.moved || Math.hypot(dx, dy) > 4) {
        pan.moved = true;
        view.panBy(dx, dy);
        pan.x = e.offsetX;
        pan.y = e.offsetY;
      }
      return;
    }
    hoverWaypoint = canPlot() ? pick(e.offsetX, e.offsetY) : undefined;
    canvas.style.cursor = hoverWaypoint !== undefined ? 'grab' : 'crosshair';
  };

  const onUp = (e: PointerEvent): void => {
    if (dragWaypoint !== undefined) {
      dragWaypoint = undefined;
      return;
    }
    const click = pan && !pan.moved;
    pan = undefined;
    if (!click || !canPlot()) return;
    const p = snap(e.offsetX, e.offsetY);
    if (e.shiftKey && session.waypoints.length > 0) {
      session.waypoints.splice(nearestLeg(session.position, session.waypoints, p), 0, p);
    } else {
      session.waypoints.push(p);
    }
    replot();
  };

  const onContext = (e: MouseEvent): void => {
    e.preventDefault();
    if (!canPlot()) return;
    const hit = pick(e.offsetX, e.offsetY);
    if (hit === undefined) return;
    session.waypoints.splice(hit, 1);
    replot();
  };

  const onWheel = (e: WheelEvent): void => {
    e.preventDefault();
    view.zoomAt(e.offsetX, e.offsetY, e.deltaY < 0 ? 1.15 : 1 / 1.15);
  };

  canvas.addEventListener('pointerdown', onDown);
  canvas.addEventListener('pointermove', onMove);
  canvas.addEventListener('pointerup', onUp);
  canvas.addEventListener('contextmenu', onContext);
  canvas.addEventListener('wheel', onWheel, { passive: false });

  return {
    get hoverWaypoint() {
      return hoverWaypoint;
    },
    detach() {
      canvas.removeEventListener('pointerdown', onDown);
      canvas.removeEventListener('pointermove', onMove);
      canvas.removeEventListener('pointerup', onUp);
      canvas.removeEventListener('contextmenu', onContext);
      canvas.removeEventListener('wheel', onWheel);
    },
  };
}
