/**
 * Smooth tuning curves (plan 02 §3.3: "the curve is a smooth spline"). A monotone cubic
 * (Fritsch–Carlson) through `[x, y]` points: smooth, passes through every point, and
 * never overshoots, so a flat stretch like the polar's no-go zone stays exactly flat.
 * Outside the points the curve holds the end values.
 */
export interface Curve {
  readonly xs: Float64Array;
  readonly ys: Float64Array;
  /** Tangent at each point. */
  readonly ms: Float64Array;
}

export function createCurve(points: readonly (readonly [number, number])[]): Curve {
  const n = points.length;
  if (n < 2) throw new RangeError('A curve needs at least two points');
  const xs = new Float64Array(n);
  const ys = new Float64Array(n);
  points.forEach(([x, y], i) => {
    xs[i] = x;
    ys[i] = y;
  });
  const slopes = new Float64Array(n - 1);
  for (let i = 0; i < n - 1; i++) {
    const dx = (xs[i + 1] as number) - (xs[i] as number);
    if (!(dx > 0)) throw new RangeError('Curve x values must strictly increase');
    slopes[i] = ((ys[i + 1] as number) - (ys[i] as number)) / dx;
  }
  const ms = new Float64Array(n);
  ms[0] = slopes[0] as number;
  ms[n - 1] = slopes[n - 2] as number;
  for (let i = 1; i < n - 1; i++) {
    const a = slopes[i - 1] as number;
    const b = slopes[i] as number;
    ms[i] = a * b <= 0 ? 0 : (a + b) / 2;
  }
  // Limit the tangents so each segment stays monotone.
  for (let i = 0; i < n - 1; i++) {
    const d = slopes[i] as number;
    if (d === 0) {
      ms[i] = 0;
      ms[i + 1] = 0;
      continue;
    }
    const a = (ms[i] as number) / d;
    const b = (ms[i + 1] as number) / d;
    const h = a * a + b * b;
    if (h > 9) {
      const t = 3 / Math.sqrt(h);
      ms[i] = t * a * d;
      ms[i + 1] = t * b * d;
    }
  }
  return { xs, ys, ms };
}

export function sampleCurve(c: Curve, x: number): number {
  const { xs, ys, ms } = c;
  const n = xs.length;
  if (x <= (xs[0] as number)) return ys[0] as number;
  if (x >= (xs[n - 1] as number)) return ys[n - 1] as number;
  let lo = 0;
  let hi = n - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if ((xs[mid] as number) <= x) lo = mid;
    else hi = mid;
  }
  const x0 = xs[lo] as number;
  const h = (xs[hi] as number) - x0;
  const t = (x - x0) / h;
  const t2 = t * t;
  const t3 = t2 * t;
  return (
    (2 * t3 - 3 * t2 + 1) * (ys[lo] as number) +
    (t3 - 2 * t2 + t) * h * (ms[lo] as number) +
    (-2 * t3 + 3 * t2) * (ys[hi] as number) +
    (t3 - t2) * h * (ms[hi] as number)
  );
}
