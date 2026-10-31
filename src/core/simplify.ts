/**
 * Douglas–Peucker simplification of a closed ring, shared by the chart bake
 * (tools/geo/lib/coast.ts) and the chart renderer's zoom levels. No imports, so the
 * Node bake can load it directly.
 */

export interface XY {
  x: number;
  y: number;
}

/**
 * Keeps the points that deviate more than `tolerance` from the simplified outline,
 * anchored at the first point and the point farthest from it. Returns a copy; rings of
 * four points or fewer come back unchanged.
 */
export function simplifyRing<P extends XY>(ring: readonly P[], tolerance: number): P[] {
  if (ring.length <= 4 || tolerance <= 0) return ring.slice();
  const first = ring[0] as P;
  let far = 0;
  let farD = -1;
  for (let k = 1; k < ring.length; k++) {
    const p = ring[k] as P;
    const d = (p.x - first.x) ** 2 + (p.y - first.y) ** 2;
    if (d > farD) {
      farD = d;
      far = k;
    }
  }
  const keep = new Uint8Array(ring.length);
  keep[0] = 1;
  keep[far] = 1;
  const tol2 = tolerance * tolerance;
  const stack: [number, number][] = [
    [0, far],
    [far, ring.length],
  ];
  while (stack.length) {
    const [s, e] = stack.pop() as [number, number];
    const a = ring[s] as P;
    const b = ring[e % ring.length] as P;
    let best = -1;
    let bestD = tol2;
    for (let k = s + 1; k < e; k++) {
      const d = segDist2(ring[k] as P, a, b);
      if (d > bestD) {
        bestD = d;
        best = k;
      }
    }
    if (best >= 0) {
      keep[best] = 1;
      stack.push([s, best], [best, e]);
    }
  }
  const out = ring.filter((_, k) => keep[k]);
  return out.length >= 3 ? out : ring.slice();
}

function segDist2(p: XY, a: XY, b: XY): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  let t = len2 > 0 ? ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2 : 0;
  t = Math.max(0, Math.min(1, t));
  return (p.x - a.x - t * dx) ** 2 + (p.y - a.y - t * dy) ** 2;
}
