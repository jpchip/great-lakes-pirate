import * as THREE from 'three';
import type { LighthouseDef, TowerStyle } from '../../../data/schemas/lighthouses';
import { PALETTE } from '../style/palette';
import { box, frustum, gable, merged, part, place, strut } from '../style/parts';

/**
 * The lighthouse station kit (plan 14 §8, §13; Phase 2 piece F): three tower styles that
 * the seven lights are built from, each scaled to its own tower height.
 *
 * - **conical:** a tapering round tower on a stone foundation, with a keeper's house beside
 *   it and an oil house (Outer and Michigan Island).
 * - **dwelling:** a two-storey keeper's house with the square tower rising through its
 *   seaward end (Raspberry, and Sand Island in brownstone).
 * - **skeleton:** a braced timber or iron frame carrying the lamp, with a small watch house
 *   at its foot (Devils Island, Chequamegon Point and La Pointe).
 *
 * Each station is three meshes (one draw call each): `body`, all its solid parts merged
 * with vertex colors; `lantern`, the lamp's glass, which glows; and `windows`, the lit
 * panes. All are at 1:1 scale (plan 03 §3.4), in a local frame with the tower's foot at the
 * origin, the ground at y = 0 and the sea toward -z.
 */

export interface StationParts {
  body: THREE.BufferGeometry;
  lantern: THREE.BufferGeometry;
  /** Lit windows; empty for a station with none. */
  windows: THREE.BufferGeometry | undefined;
  /** The lamp's height above the ground, meters. */
  lampY: number;
  /** Triangles in all three meshes. */
  triangles: number;
}

const FINISH: Record<LighthouseDef['tower']['finish'], number> = {
  white: PALETTE.towerWhite,
  brownstone: PALETTE.sandstone,
  brick: PALETTE.brick,
  iron: PALETTE.roofGray,
};

/** The lantern glass: ruby for a red light, clear (amber with the lamp behind it) otherwise. */
const glassOf = (def: LighthouseDef): number =>
  def.characteristic.color === 'red' ? 0xa02418 : PALETTE.lampAmber;

const foundationColor = PALETTE.slopeRock;
const trimColor = PALETTE.lanternBlack;

/** The lantern room and its roof: glass is the lantern mesh, the frame joins the body. */
function lantern(
  lampY: number,
  radius: number,
  glass: THREE.BufferGeometry[],
  frame: THREE.BufferGeometry[],
  glassColor: number,
): void {
  const h = 2.4;
  glass.push(frustum(radius, radius, h, 8, 0, lampY, 0, glassColor));
  frame.push(frustum(radius + 0.9, radius + 0.9, 0.35, 10, 0, lampY - 0.35, 0, trimColor));
  frame.push(frustum(radius + 0.12, radius + 0.12, 0.3, 8, 0, lampY + h, 0, trimColor));
  frame.push(
    place(
      part(new THREE.ConeGeometry(radius + 0.35, 1.5, 8), trimColor),
      0,
      lampY + h + 0.3 + 0.75,
      0,
    ),
  );
  frame.push(place(part(new THREE.SphereGeometry(0.28, 6, 4), trimColor), 0, lampY + h + 2.1, 0));
}

function conical(def: LighthouseDef): StationParts {
  const H = def.tower.heightM;
  const finish = FINISH[def.tower.finish];
  const body: THREE.BufferGeometry[] = [];
  const glass: THREE.BufferGeometry[] = [];
  const windows: THREE.BufferGeometry[] = [];
  const rBottom = Math.max(2.4, H * 0.13);
  const rTop = rBottom * 0.62;
  body.push(frustum(rBottom + 0.9, rBottom + 1.5, 4.2, 12, 0, -3.4, 0, foundationColor));
  body.push(frustum(rTop, rBottom, H - 0.8, 12, 0, 0.8, 0, finish));
  // A lantern whose floor is the tower's top, with its gallery rail.
  lantern(H, 1.3, glass, body, glassOf(def));
  // The keeper's house, behind the tower and parallel to the shore, and an oil house.
  body.push(box(9, 4.6, 6.4, -2, 0, 11, PALETTE.brick));
  body.push(gable(9, 6.4, 2.8, -2, 4.6, 11, PALETTE.roofGray));
  body.push(box(1.4, 3, 1.2, 4.8, 3.2, 11, PALETTE.brick));
  body.push(box(3.2, 2.8, 3.2, 8.5, 0, 6, PALETTE.brick));
  body.push(gable(3.2, 3.2, 1.6, 8.5, 2.8, 6, PALETTE.roofGray));
  for (const x of [-4.2, -0.2]) windows.push(box(1.1, 1.5, 0.2, x, 1.7, 7.7, PALETTE.windowAmber));
  return assemble(body, glass, windows, H);
}

function dwelling(def: LighthouseDef): StationParts {
  const H = def.tower.heightM;
  const finish = FINISH[def.tower.finish];
  const body: THREE.BufferGeometry[] = [];
  const glass: THREE.BufferGeometry[] = [];
  const windows: THREE.BufferGeometry[] = [];
  const roof = PALETTE.roofGray;
  body.push(box(10.4, 1.2, 8.4, 0, -0.8, 0, foundationColor));
  // The dwelling: two storeys, its long side along the shore.
  body.push(box(9.2, 6.4, 7, 0, 0.4, 1.2, finish));
  body.push(gable(9.2, 7, 3, 0, 6.8, 1.2, roof));
  body.push(box(1.1, 3.2, 1.1, 2.6, 7.2, 2.6, PALETTE.brick));
  // The square tower, rising through the seaward end of the house.
  const half = Math.max(1.7, H * 0.13);
  body.push(box(half * 2, H - 0.4, half * 2, 0, 0.4, -3.2, finish));
  body.push(box(half * 2 + 1.1, 0.35, half * 2 + 1.1, 0, H - 0.35, -3.2, trimColor));
  const parts = { glass, body };
  lanternAt(H, 1.3, 0, -3.2, parts, glassOf(def));
  for (const x of [-3.2, -1.1, 1.1, 3.2]) {
    windows.push(box(0.9, 1.5, 0.2, x, 1.5, -2.4 + 0.02, PALETTE.windowAmber));
    windows.push(box(0.9, 1.5, 0.2, x, 4.1, -2.4 + 0.02, PALETTE.windowAmber));
  }
  return assemble(body, glass, windows, H);
}

/** `lantern`, with the lamp moved off the tower's axis. */
function lanternAt(
  lampY: number,
  radius: number,
  x: number,
  z: number,
  parts: { glass: THREE.BufferGeometry[]; body: THREE.BufferGeometry[] },
  glassColor: number,
): void {
  const glass: THREE.BufferGeometry[] = [];
  const frame: THREE.BufferGeometry[] = [];
  lantern(lampY, radius, glass, frame, glassColor);
  for (const g of glass) parts.glass.push(g.translate(x, 0, z));
  for (const g of frame) parts.body.push(g.translate(x, 0, z));
}

function skeleton(def: LighthouseDef): StationParts {
  const H = def.tower.heightM;
  const finish = FINISH[def.tower.finish];
  const body: THREE.BufferGeometry[] = [];
  const glass: THREE.BufferGeometry[] = [];
  const windows: THREE.BufferGeometry[] = [];
  const foot = Math.max(2.2, H * 0.17);
  const top = Math.max(0.9, H * 0.05);
  const legs = [
    [-1, -1],
    [1, -1],
    [1, 1],
    [-1, 1],
  ] as const;
  const v = (sx: number, sz: number, r: number, y: number) => new THREE.Vector3(sx * r, y, sz * r);
  for (const [sx, sz] of legs) {
    body.push(box(1.1, 0.9, 1.1, sx * foot, -0.7, sz * foot, foundationColor));
    body.push(strut(v(sx, sz, foot, 0), v(sx, sz, top, H), 0.2, finish));
  }
  // Cross-bracing in the lower three of four bays, and a ring at each level.
  const bays = 4;
  for (let k = 0; k < bays - 1; k++) {
    const y0 = (H * k) / bays;
    const y1 = (H * (k + 1)) / bays;
    const r0 = foot + ((top - foot) * k) / bays;
    const r1 = foot + ((top - foot) * (k + 1)) / bays;
    for (let i = 0; i < 4; i++) {
      const [ax, az] = legs[i] as readonly [number, number];
      const [bx, bz] = legs[(i + 1) % 4] as readonly [number, number];
      body.push(strut(v(ax, az, r0, y0), v(bx, bz, r1, y1), 0.1, finish));
      body.push(strut(v(bx, bz, r0, y0), v(ax, az, r1, y1), 0.1, finish));
      body.push(strut(v(ax, az, r1, y1), v(bx, bz, r1, y1), 0.12, finish));
    }
  }
  body.push(box(top * 2 + 1.4, 0.4, top * 2 + 1.4, 0, H - 0.4, 0, trimColor));
  lantern(H, 1.05, glass, body, glassOf(def));
  // A small watch house at the foot, with a lit window.
  body.push(box(4.2, 2.8, 3.6, 0, 0, 7, PALETTE.weatheredWood));
  body.push(gable(4.2, 3.6, 1.4, 0, 2.8, 7, PALETTE.roofGray));
  windows.push(box(0.9, 1.1, 0.2, -0.8, 1.0, 5.12, PALETTE.windowAmber));
  return assemble(body, glass, windows, H);
}

const triangles = (g: THREE.BufferGeometry): number => g.getAttribute('position').count / 3;

function assemble(
  body: THREE.BufferGeometry[],
  glass: THREE.BufferGeometry[],
  windows: THREE.BufferGeometry[],
  H: number,
): StationParts {
  const b = merged(body);
  const l = merged(glass);
  const w = windows.length ? merged(windows) : undefined;
  return {
    body: b,
    lantern: l,
    windows: w,
    lampY: H + 1.2,
    triangles: triangles(b) + triangles(l) + (w ? triangles(w) : 0),
  };
}

const BUILDERS: Record<TowerStyle, (def: LighthouseDef) => StationParts> = {
  conical,
  dwelling,
  skeleton,
};

/** The geometry of one light, from its style, height and finish. */
export function buildStation(def: LighthouseDef): StationParts {
  return BUILDERS[def.tower.style](def);
}
