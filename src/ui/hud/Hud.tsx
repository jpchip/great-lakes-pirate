import type { ReadonlySignal } from '@preact/signals';
import type { HudDensity } from '../../core/settings';
import { COMPASS_POINTS, STRAIN_SHOW, type BarometerSnapshot, type HudSnapshot } from './model';

/**
 * Sailing HUD v1 (plan 13 §4.1, §12): the wind ring with speed and sail level bottom
 * right, hull, rigging, strain and depth bottom left, the date and clock top left and a
 * compass strip top center. Brass-and-enamel instruments kept flat and cheap: SVG and
 * CSS transforms only, re-rendered at the 10 Hz the snapshot updates (plan 13 §10).
 */

const DANGER_STATUS = new Set([
  'Foundering',
  'Knocked down',
  'Aground: hold X to kedge',
  'Anchor dragging',
]);

const RING = 64;
const R_OUT = 56;
const R_IN = 44;

/** A point on the ring, `deg` clockwise from the bow (straight up). */
function at(r: number, deg: number): [number, number] {
  const a = (deg * Math.PI) / 180;
  return [RING + r * Math.sin(a), RING - r * Math.cos(a)];
}

/** An annular wedge from `a` to `b` degrees (clockwise), between radii r0 and r1. */
export function wedgePath(a: number, b: number, r0: number, r1: number): string {
  const large = (b - a + 360) % 360 > 180 ? 1 : 0;
  const [x0, y0] = at(r1, a);
  const [x1, y1] = at(r1, b);
  const [x2, y2] = at(r0, b);
  const [x3, y3] = at(r0, a);
  const f = (n: number): string => n.toFixed(2);
  return (
    `M${f(x0)} ${f(y0)} A${r1} ${r1} 0 ${large} 1 ${f(x1)} ${f(y1)} ` +
    `L${f(x2)} ${f(y2)} A${r0} ${r0} 0 ${large} 0 ${f(x3)} ${f(y3)} Z`
  );
}

function WindRing({ hud }: { hud: HudSnapshot }) {
  const w = hud.windAngleDeg;
  const calm = !Number.isFinite(w) || hud.windKn < 0.5;
  // Sheets ease out on the side away from the wind.
  const lee = w >= 0 ? -1 : 1;
  const boom = (t: number): string => {
    const [x, y] = [RING + lee * Math.sin(t * 1.45) * 30, RING + 4 + Math.cos(t * 1.45) * 30];
    return `M${RING} ${RING + 4} L${x.toFixed(1)} ${y.toFixed(1)}`;
  };
  return (
    <svg
      class="hud-ring"
      viewBox={`0 0 ${RING * 2} ${RING * 2}`}
      role="img"
      aria-label={calm ? 'Wind: calm' : `Wind ${Math.round(Math.abs(w))}° off the bow`}
    >
      <circle class="ring-face" cx={RING} cy={RING} r={R_OUT} />
      {!calm && (
        <g>
          <path class="ring-nogo" d={wedgePath(w - hud.noGoDeg, w + hud.noGoDeg, R_IN, R_OUT)} />
          <path
            class="ring-best"
            d={wedgePath(w + hud.bestFromDeg, w + hud.bestToDeg, R_IN, R_OUT)}
          />
          <path
            class="ring-best"
            d={wedgePath(w - hud.bestToDeg, w - hud.bestFromDeg, R_IN, R_OUT)}
          />
        </g>
      )}
      <circle class="ring-rim" cx={RING} cy={RING} r={R_OUT} />
      {/* The ship, bow up. */}
      <path
        class="ring-ship"
        d={`M${RING} ${RING - 22} C${RING + 9} ${RING - 10} ${RING + 8} ${RING + 12} ${RING + 5} ${RING + 20} L${RING - 5} ${RING + 20} C${RING - 8} ${RING + 12} ${RING - 9} ${RING - 10} ${RING} ${RING - 22} Z`}
      />
      {hud.manualTrim && !calm && (
        <g>
          <path class="ring-trim-ideal" d={boom(hud.idealTrim)} />
          <path class="ring-trim" d={boom(hud.trim)} />
        </g>
      )}
      {!calm && (
        <g transform={`rotate(${w.toFixed(1)} ${RING} ${RING})`}>
          {/* The wind arrow, from the rim pointing in. */}
          <path
            class="ring-wind"
            d={`M${RING} ${RING - R_OUT - 4} L${RING} ${RING - R_IN + 10} M${RING - 6} ${RING - R_IN + 2} L${RING} ${RING - R_IN + 10} L${RING + 6} ${RING - R_IN + 2}`}
          />
        </g>
      )}
    </svg>
  );
}

function Bar({ label, value, testid }: { label: string; value: number; testid: string }) {
  const v = Math.max(0, Math.min(1, value));
  return (
    <div class={`hud-bar${v < 0.3 ? ' danger' : ''}`} data-testid={testid}>
      <span class="hud-label">{label}</span>
      <span class="hud-bar-track">
        <span class="hud-bar-fill" style={{ transform: `scaleX(${v.toFixed(3)})` }} />
      </span>
    </div>
  );
}

function Compass({ headingDeg }: { headingDeg: number }) {
  const PX = 2.2;
  const marks = [];
  for (const k of [-360, 0, 360]) {
    for (const [deg, label] of COMPASS_POINTS) {
      marks.push(
        <span
          key={`${k + deg}`}
          class={`hud-compass-mark${label.length === 1 ? ' cardinal' : ''}`}
          style={{ left: `${(k + deg) * PX}px` }}
        >
          {label}
        </span>,
      );
    }
    for (let deg = 15; deg < 360; deg += 15) {
      if (deg % 45 === 0) continue;
      marks.push(
        <span
          key={`t${k + deg}`}
          class="hud-compass-tick"
          style={{ left: `${(k + deg) * PX}px` }}
        />,
      );
    }
  }
  return (
    <div class="hud-compass" data-testid="hud-compass">
      <div
        class="hud-compass-strip"
        style={{ transform: `translateX(${(-headingDeg * PX).toFixed(1)}px)` }}
      >
        {marks}
      </div>
      <span class="hud-compass-lubber" />
      <span class="hud-compass-heading">
        {String(Math.round(headingDeg) % 360).padStart(3, '0')}°
      </span>
    </div>
  );
}

/** The moon's lit part as an SVG path: 0 new, 0.5 full (northern-hemisphere view). */
export function moonPath(phase01: number, r = 7, c = 8): string {
  const p = ((phase01 % 1) + 1) % 1;
  // Waxing lights the right side; the terminator is an ellipse of half-width |cos|·r.
  const waxing = p < 0.5;
  const k = Math.cos(p * 2 * Math.PI) * r;
  const outer = waxing ? 1 : 0;
  const inner = k > 0 === waxing ? 0 : 1;
  return `M${c} ${c - r} A${r} ${r} 0 0 ${outer} ${c} ${c + r} A${Math.abs(k).toFixed(2)} ${r} 0 0 ${inner} ${c} ${c - r} Z`;
}

function Clock({ hud }: { hud: HudSnapshot }) {
  return (
    <div class="hud-clock" data-testid="hud-clock">
      <span>{hud.dateText}</span>
      <span class="hud-num">{hud.timeText}</span>
      <svg class="hud-moon" viewBox="0 0 16 16" aria-label="Moon phase">
        <circle cx="8" cy="8" r="7" class="moon-dark" />
        <path d={moonPath(hud.moonPhase01)} class="moon-lit" />
      </svg>
    </div>
  );
}

/** Pressure in inches with the 3-hour trend; red when it's falling fast. */
function Barometer({ baro }: { baro: BarometerSnapshot }) {
  return (
    <div
      class={`hud-chip hud-baro${baro.trend === 'falling fast' ? ' danger' : ''}`}
      data-testid="hud-barometer"
      title={`${baro.hpa.toFixed(0)} hPa, ${baro.trend}`}
      aria-label={`Barometer ${baro.inHgText} inches, ${baro.trend}`}
    >
      Barometer <span class="hud-num">{baro.inHgText}</span> {baro.arrow}
    </div>
  );
}

export function Hud({
  hud,
  density,
  spyglass,
}: {
  hud: ReadonlySignal<HudSnapshot | undefined>;
  density: ReadonlySignal<HudDensity>;
  spyglass: ReadonlySignal<boolean>;
}) {
  const h = hud.value;
  const mode = density.value;
  return (
    <div class="hud" data-testid="hud" data-density={mode}>
      {spyglass.value && <div class="hud-spyglass" data-testid="hud-spyglass" />}
      {h && mode !== 'off' && (
        <>
          <Clock hud={h} />
          {h.barometer && <Barometer baro={h.barometer} />}
          <Compass headingDeg={h.headingDeg} />
          <div class="hud-status">
            {h.hull01 !== undefined && <Bar label="Hull" value={h.hull01} testid="hud-hull" />}
            <Bar label="Rig" value={h.rigging01} testid="hud-rigging" />
            {h.strain01 !== undefined && (mode === 'full' || h.strain01 > STRAIN_SHOW) && (
              <div class={`hud-chip${h.strain01 > 0.6 ? ' danger' : ''}`} data-testid="hud-strain">
                Strain {Math.round(h.strain01 * 100)}%
              </div>
            )}
            {h.depthM !== undefined && (mode === 'full' || h.shallow) && (
              <div
                class={`hud-chip${h.depthM < h.draftM + 1 ? ' danger' : ''}`}
                data-testid="hud-depth"
              >
                Depth <span class="hud-num">{h.depthM < 100 ? h.depthM.toFixed(1) : '100+'} m</span>
              </div>
            )}
          </div>
          <div class="hud-wind" data-testid="hud-wind">
            <WindRing hud={h} />
            <div class="hud-readout">
              <span class="hud-speed hud-num" data-testid="hud-speed">
                {h.speedKn.toFixed(1)}
                <small> kn</small>
              </span>
              <span class="hud-sail" data-testid="hud-sail">
                {h.sailSet === h.sailOrdered ? h.sailSet : `${h.sailSet} → ${h.sailOrdered}`}
              </span>
              {h.inIrons && <span class="hud-chip danger">In irons</span>}
              {h.sweepsOut && <span class="hud-chip">Sweeps</span>}
              {h.status.map((label) => (
                <span
                  key={label}
                  class={`hud-chip${DANGER_STATUS.has(label) ? ' danger' : ''}`}
                  data-testid="hud-status"
                >
                  {label}
                </span>
              ))}
              {mode === 'full' && (
                <span class="hud-num hud-dim">wind {h.windKn.toFixed(0)} kn</span>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
