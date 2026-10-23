import * as THREE from 'three';
import { knotsToMs, type Chart } from '../../core/coords';
import { FREIGHTER_ROUTES } from './geography';

/**
 * Placeholder steel ore boats for spike S7: a ~400 ft (122 m) laker with the pilothouse
 * forward and the engine house and stack aft, drawn at `displayScale` (plan 03 §3.5).
 * They steam back and forth along fixed lanes in chart space, so changing C keeps
 * them on the same water.
 */

export const FREIGHTER_LENGTH_M = 122;
const BEAM = 14.6;
/** Freeboard above the waterline and draft below it. */
const FREEBOARD = 4.5;
const DRAFT = 5.5;
/** Steam speed, game knots (plan 02 §10 steamers). */
export const FREIGHTER_SPEED_KN = 9;

const HULL = new THREE.MeshStandardMaterial({ color: 0x5b2b22, roughness: 0.8, flatShading: true });
const DECK = new THREE.MeshStandardMaterial({ color: 0x4a4440, roughness: 0.9, flatShading: true });
const CABIN = new THREE.MeshStandardMaterial({
  color: 0xe8e1d0,
  roughness: 0.85,
  flatShading: true,
});
const STACK = new THREE.MeshStandardMaterial({
  color: 0x1d1d1d,
  roughness: 0.7,
  flatShading: true,
});

function hullGeometry(): THREE.BufferGeometry {
  // Top-view outline: square stern at +y, pointed bow at -y (becomes -z, forward).
  const half = FREIGHTER_LENGTH_M / 2;
  const b = BEAM / 2;
  const shape = new THREE.Shape();
  shape.moveTo(-b, half);
  shape.lineTo(b, half);
  shape.lineTo(b, -half + 18);
  shape.quadraticCurveTo(b, -half + 4, 0, -half);
  shape.quadraticCurveTo(-b, -half + 4, -b, -half + 18);
  shape.closePath();
  const geo = new THREE.ExtrudeGeometry(shape, {
    depth: FREEBOARD + DRAFT,
    bevelEnabled: false,
    curveSegments: 6,
  });
  // Extrusion runs along +z; stand it up so it runs along +y from the keel.
  geo.rotateX(-Math.PI / 2);
  geo.scale(1, 1, -1);
  geo.translate(0, -DRAFT, 0);
  return geo;
}

function box(
  w: number,
  h: number,
  d: number,
  x: number,
  y: number,
  z: number,
  mat: THREE.Material,
): THREE.Mesh {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  mesh.position.set(x, y + h / 2, z);
  return mesh;
}

export function createFreighterMesh(): THREE.Group {
  const half = FREIGHTER_LENGTH_M / 2;
  const g = new THREE.Group();
  g.name = 'placeholder-freighter';
  const hull = new THREE.Mesh(hullGeometry(), HULL);
  // ExtrudeGeometry's side winding flips with the mirror; draw both sides.
  HULL.side = THREE.DoubleSide;
  g.add(hull);
  // Hatch line, pilothouse forward, engine house and stack aft, two masts.
  g.add(box(BEAM - 4, 0.8, FREIGHTER_LENGTH_M - 40, 0, FREEBOARD, 2, DECK));
  g.add(box(10, 7, 8, 0, FREEBOARD, -half + 15, CABIN));
  g.add(box(13, 6, 14, 0, FREEBOARD, half - 10, CABIN));
  const stack = new THREE.Mesh(new THREE.CylinderGeometry(1.4, 1.6, 10, 10), STACK);
  stack.position.set(0, FREEBOARD + 6 + 5, half - 12);
  g.add(stack);
  for (const z of [-half + 22, half - 22]) {
    const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.35, 20, 6), STACK);
    mast.position.set(0, FREEBOARD + 10, z);
    g.add(mast);
  }
  return g;
}

export interface Freighter {
  readonly route: readonly Chart[];
  /** Chart meters along the route. */
  s: number;
  direction: 1 | -1;
  /** Current chart position and heading (radians clockwise from north). */
  readonly chart: Chart;
  heading: number;
}

function routeLength(route: readonly Chart[]): number {
  let total = 0;
  for (let i = 1; i < route.length; i++) {
    const a = route[i - 1] as Chart;
    const b = route[i] as Chart;
    total += Math.hypot(b.x - a.x, b.y - a.y);
  }
  return total;
}

export function createFreighters(): Freighter[] {
  // Two boats on the Ashland lane going opposite ways, one on the outer lane.
  const starts: [number, number, 1 | -1][] = [
    [0, 0.15, 1],
    [0, 0.7, -1],
    [1, 0.4, 1],
  ];
  return starts.map(([r, f, direction]) => {
    const route = FREIGHTER_ROUTES[r] as Chart[];
    const ship: Freighter = {
      route,
      s: f * routeLength(route),
      direction,
      chart: { x: 0, y: 0 },
      heading: 0,
    };
    stepFreighter(ship, 0, 1);
    return ship;
  });
}

/** Advance along the lane at FREIGHTER_SPEED_KN for `dt` real seconds at clock rate R. */
export function stepFreighter(f: Freighter, dt: number, rate: number): void {
  const length = routeLength(f.route);
  f.s += f.direction * knotsToMs(FREIGHTER_SPEED_KN) * rate * dt;
  if (f.s > length) {
    f.s = 2 * length - f.s;
    f.direction = -1;
  } else if (f.s < 0) {
    f.s = -f.s;
    f.direction = 1;
  }
  let remaining = f.s;
  for (let i = 1; i < f.route.length; i++) {
    const a = f.route[i - 1] as Chart;
    const b = f.route[i] as Chart;
    const seg = Math.hypot(b.x - a.x, b.y - a.y);
    if (remaining <= seg || i === f.route.length - 1) {
      const t = Math.min(remaining / seg, 1);
      f.chart.x = a.x + (b.x - a.x) * t;
      f.chart.y = a.y + (b.y - a.y) * t;
      // Chart y is north, so the compass heading is atan2(east, north).
      const h = Math.atan2(b.x - a.x, b.y - a.y);
      f.heading = f.direction === 1 ? h : h + Math.PI;
      return;
    }
    remaining -= seg;
  }
}
