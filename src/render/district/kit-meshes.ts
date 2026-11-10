import * as THREE from 'three';
import type { DistrictBuilding, DistrictPile, PlacedPiece } from '../../gameplay/district/district';
import { CELL_M, DECK_THICK_M, DOOR_HEIGHT_M, WALL_M } from '../../sim/district/kit';
import { PALETTE } from '../style/palette';
import { box, frustum, gable, part, strut } from '../style/parts';

/**
 * The docks kit drawn (plan 08 §13, plan 14 §8; Phase 7 piece C): procedural low-poly
 * geometry for every kit piece, in the harbor kit's vertex-colored style, so a district
 * merges into a few meshes per block. Each builder works in the piece's own frame (base at
 * y 0, front toward -z) and the caller places it. Lamp glass and lit windows go to a
 * separate list that glows at night.
 */

export interface KitSink {
  body: THREE.BufferGeometry[];
  /** Lamp glass and lit windows: emissive after dusk. */
  lit: THREE.BufferGeometry[];
}

/** House paints, 1900 small-town (the harbor kit's): white lead, cream, red ochre, grays. */
export const PAINTS = [0xe2dccb, 0xd5c59c, 0x8e4a35, 0x8b857a, 0x7d8a78, 0xb59a5c] as const;
const TRIM = 0xe8e2d2;
const PLANK = 0x7a6450;
const PLANK_DARK = 0x5d4a3a;
const DECK = 0x6b5643;
const PILE = 0x3d3229;
const CRIB = 0x4f4236;
const IRON = 0x2c2b2a;
const GLASS = PALETTE.glass;
const LIT = PALETTE.windowAmber;
const LAMP = PALETTE.lampAmber;
const ROOF = [PALETTE.roofGray, 0x5a4636, 0x3a3a38] as const;
const CRATE = 0x9b7d55;
const BARREL = 0x7b5a3a;
const ICE = 0xbfd6dc;
const NET = 0x6f6a55;
const COAL = 0x232224;
const SACK = 0xc8b998;
const STONE = 0x8a857c;

function hash(n: number): number {
  const s = Math.sin(n * 12.9898) * 43758.5453;
  return s - Math.floor(s);
}

/** Moves geometry from a piece frame to the district: yaw by heading, then translate. */
function place(
  parts: THREE.BufferGeometry[],
  x: number,
  y: number,
  z: number,
  heading: number,
): void {
  for (const g of parts) g.rotateY(-heading).translate(x, y, z);
}

function cylinder(
  r: number,
  h: number,
  sides: number,
  x: number,
  y: number,
  z: number,
  color: number,
): THREE.BufferGeometry {
  return frustum(r, r, h, sides, x, y, z, color);
}

/** A horizontal cylinder along x (a lying barrel, a wheel's axle when short). */
function lying(
  r: number,
  len: number,
  sides: number,
  x: number,
  y: number,
  z: number,
  color: number,
): THREE.BufferGeometry {
  const g = part(new THREE.CylinderGeometry(r, r, len, sides, 1), color);
  g.rotateZ(Math.PI / 2);
  return g.translate(x, y + r, z);
}

function barrel(out: THREE.BufferGeometry[], x: number, y: number, z: number, scale = 1): void {
  const r = 0.3 * scale;
  const h = 0.9 * scale;
  out.push(frustum(r, r * 0.86, h / 2, 8, x, y, z, BARREL));
  out.push(frustum(r * 0.86, r, h / 2, 8, x, y + h / 2, z, BARREL));
  out.push(cylinder(r * 1.01, 0.05, 8, x, y + h * 0.2, z, IRON));
  out.push(cylinder(r * 1.01, 0.05, 8, x, y + h * 0.75, z, IRON));
}

function crate(
  out: THREE.BufferGeometry[],
  s: number,
  x: number,
  y: number,
  z: number,
  tint = 0,
): void {
  const color = tint ? 0x8a6c47 : CRATE;
  out.push(box(s, s, s, x, y, z, color));
  out.push(box(s + 0.02, 0.08, s + 0.02, x, y + s * 0.15, z, PLANK_DARK));
  out.push(box(s + 0.02, 0.08, s + 0.02, x, y + s * 0.8, z, PLANK_DARK));
}

// --- Cells ----------------------------------------------------------------------------

export function cellGeometry(
  p: PlacedPiece,
  groundAt: (x: number, z: number) => number,
  out: KitSink,
): void {
  const local: THREE.BufferGeometry[] = [];
  const h = CELL_M / 2;
  switch (p.piece.collider) {
    case 'deck': {
      // Planks across the cell, stringers below; a wharf has a timber crib to the bottom.
      const shade =
        hash(Math.floor(p.z / CELL_M) * 7.7 + Math.floor(p.x / 16)) < 0.5 ? DECK : 0x6e5845;
      local.push(box(CELL_M, 0.12, CELL_M, 0, -0.12, 0, shade));
      local.push(box(0.2, DECK_THICK_M - 0.12, CELL_M, -0.6, -DECK_THICK_M, 0, PLANK_DARK));
      local.push(box(0.2, DECK_THICK_M - 0.12, CELL_M, 0.6, -DECK_THICK_M, 0, PLANK_DARK));
      if (p.piece.id === 'kit.wharf') {
        const floor = groundAt(p.x, p.z);
        const depth = p.y - DECK_THICK_M - floor + 0.5;
        if (depth > 0.05) local.push(box(CELL_M, depth, CELL_M, 0, -DECK_THICK_M - depth, 0, CRIB));
      }
      break;
    }
    case 'floor': {
      const color =
        p.piece.surface === 'stone' ? STONE : p.piece.surface === 'sawdust' ? 0xb79a6a : DECK;
      const depth = p.y - groundAt(p.x, p.z) + 0.3;
      local.push(box(CELL_M, Math.max(depth, 0.15), CELL_M, 0, -Math.max(depth, 0.15), 0, color));
      if (p.piece.id === 'kit.boardwalk') {
        for (const sx of [-1, 1])
          local.push(box(0.12, 0.3, CELL_M, sx * (h - 0.06), -0.3, 0, PLANK_DARK));
      }
      break;
    }
    case 'flat': {
      if (p.piece.id === 'kit.track') {
        // Ballast, ties and two rails (standard gauge, 1.435 m), along x.
        local.push(box(CELL_M, 0.1, 2.6, 0, -0.02, 0, 0x6d665c));
        for (const tx of [-0.5, 0.5]) local.push(box(0.25, 0.08, 2.4, tx, 0.06, 0, 0x4a3a2c));
        for (const rz of [-0.72, 0.72]) local.push(box(CELL_M, 0.1, 0.07, 0, 0.12, rz, 0x5a5550));
      } else if (p.piece.id === 'kit.gravel') {
        local.push(box(CELL_M, 0.06, CELL_M, 0, -0.02, 0, 0x8a8170));
      }
      break;
    }
    default:
      break;
  }
  place(local, p.x, p.y, p.z, 0);
  out.body.push(...local);
}

export function pileGeometry(pile: DistrictPile, out: KitSink): void {
  out.body.push(cylinder(0.16, pile.y1 - pile.y0, 5, pile.x, pile.y0, pile.z, PILE));
}

// --- Edges ----------------------------------------------------------------------------

export interface EdgePaint {
  wall: number;
  trim: number;
  brick: boolean;
  /** Seed for which windows are lit. */
  seed: number;
}

export function edgeGeometry(p: PlacedPiece, paint: EdgePaint, out: KitSink): void {
  const body: THREE.BufferGeometry[] = [];
  const lit: THREE.BufferGeometry[] = [];
  const len = CELL_M + WALL_M;
  const height = p.topY - p.y;
  const footing = 0.4;
  const wallColor = paint.brick ? PALETTE.brick : paint.wall;
  const kind = p.piece.collider;
  const id = p.piece.id;
  const window = (cx: number, sill: number): void => {
    const lighted = hash(paint.seed * 31.7 + p.x * 1.3 + p.z * 2.9) < 0.5;
    body.push(box(1.0, 1.5, WALL_M + 0.06, cx, sill - 0.05, 0, paint.trim));
    const pane = box(0.8, 1.3, WALL_M + 0.1, cx, sill + 0.05, 0, lighted ? LIT : GLASS);
    (lighted ? lit : body).push(pane);
  };
  if (id === 'kit.wall_bars' || id === 'kit.wall_bars_door') {
    const bars = id === 'kit.wall_bars' ? 9 : 4;
    const w = id === 'kit.wall_bars' ? CELL_M : CELL_M - (p.piece.openingM ?? 1);
    for (let k = 0; k < bars; k++) {
      const x = -CELL_M / 2 + ((k + 0.5) / bars) * w;
      body.push(box(0.05, height, 0.05, x, 0, 0, IRON));
    }
    body.push(box(CELL_M, 0.08, 0.08, 0, height - 0.1, 0, IRON));
    body.push(box(CELL_M, 0.08, 0.08, 0, 0.1, 0, IRON));
    if (id === 'kit.wall_bars_door') {
      // The cell door, shut: bars across the opening on a frame.
      const ow = p.piece.openingM ?? 1;
      for (let k = 0; k < 4; k++)
        body.push(
          box(0.04, DOOR_HEIGHT_M, 0.04, CELL_M / 2 - ow + (k + 0.5) * (ow / 4), 0, 0, IRON),
        );
      body.push(box(ow, 0.06, 0.06, CELL_M / 2 - ow / 2, DOOR_HEIGHT_M - 0.06, 0, IRON));
    }
    place(body, p.x, p.y, p.z, p.heading);
    out.body.push(...body);
    return;
  }
  switch (kind) {
    case 'wall':
    case 'window': {
      body.push(box(len, height + footing, WALL_M, 0, -footing, 0, wallColor));
      if (!paint.brick) {
        // Board-and-batten: a few dark battens so the planking reads.
        for (const bx of [-0.66, 0, 0.66])
          body.push(box(0.06, height, WALL_M + 0.03, bx, 0, 0, PLANK_DARK));
      }
      if (kind === 'window') {
        window(0, 1.0);
        if (height > 5) window(0, 3.6);
      }
      break;
    }
    case 'door': {
      const w = p.piece.openingM ?? 1.4;
      const jamb = (len - w) / 2;
      const door = id === 'kit.gate_board';
      const color = door ? PLANK : wallColor;
      body.push(box(jamb, height + footing, WALL_M, -len / 2 + jamb / 2, -footing, 0, color));
      body.push(box(jamb, height + footing, WALL_M, len / 2 - jamb / 2, -footing, 0, color));
      if (height > DOOR_HEIGHT_M + 0.05) {
        body.push(box(w, height - DOOR_HEIGHT_M, WALL_M, 0, DOOR_HEIGHT_M, 0, color));
        body.push(box(w + 0.2, 0.15, WALL_M + 0.08, 0, DOOR_HEIGHT_M, 0, paint.trim));
        if (height > 5) window(0, 3.6);
      }
      // The leaf, swung open against the wall's inside face (+z here).
      const leaf = box(
        w * (door ? 0.5 : 0.95),
        Math.min(DOOR_HEIGHT_M, height) - 0.05,
        0.06,
        0,
        0,
        0,
        door ? PLANK_DARK : 0x5a3f2c,
      );
      leaf
        .translate(-(w * (door ? 0.5 : 0.95)) / 2, 0, 0)
        .rotateY(-Math.PI / 2 + 0.25)
        .translate(w / 2, 0, WALL_M / 2);
      body.push(leaf);
      break;
    }
    case 'fence': {
      body.push(box(len, p.piece.heightM, 0.08, 0, 0, 0, PLANK));
      body.push(box(0.14, p.piece.heightM + 0.15, 0.14, -CELL_M / 2, -0.1, 0, PLANK_DARK));
      break;
    }
    case 'rail': {
      const ht = p.piece.heightM;
      if (id === 'kit.fence_picket') {
        for (let k = 0; k < 8; k++)
          body.push(box(0.07, ht, 0.03, -CELL_M / 2 + (k + 0.5) * (CELL_M / 8), 0, 0, TRIM));
        body.push(box(CELL_M, 0.06, 0.05, 0, ht * 0.7, 0, TRIM));
      } else {
        body.push(box(0.12, ht, 0.12, -CELL_M / 2, 0, 0, PLANK_DARK));
        body.push(box(CELL_M, 0.1, 0.1, 0, ht - 0.1, 0, PLANK));
        body.push(box(CELL_M, 0.08, 0.06, 0, ht * 0.5, 0, PLANK));
      }
      break;
    }
    default:
      if (id === 'kit.ladder') {
        // Down the pier's side to the water: two rails and rungs, standing off the edge.
        const drop = p.y + 0.3;
        for (const sx of [-0.25, 0.25])
          body.push(box(0.06, drop + 0.9, 0.06, sx, -drop, 0, PLANK_DARK));
        for (let y = -drop + 0.3; y < 0.8; y += 0.3)
          body.push(box(0.5, 0.04, 0.05, 0, y, 0, PLANK));
      }
      break;
  }
  place(body, p.x, p.y, p.z, p.heading);
  place(lit, p.x, p.y, p.z, p.heading);
  out.body.push(...body);
  out.lit.push(...lit);
}

// --- Roofs ----------------------------------------------------------------------------

/** A building's roof, separate from its walls so it can fade when you're inside. */
export function roofGeometry(b: DistrictBuilding, out: KitSink): void {
  const def = b.def;
  const w = b.maxX - b.minX;
  const d = b.maxZ - b.minZ;
  const cx = (b.minX + b.maxX) / 2;
  const cz = (b.minZ + b.maxZ) / 2;
  const roof = ROOF[def.paint % ROOF.length] as number;
  const paint =
    def.wall === 'kit.wall_brick' ? PALETTE.brick : (PAINTS[def.paint % PAINTS.length] as number);
  const parts: THREE.BufferGeometry[] = [];
  const rise = b.topY - b.eavesY;
  if (def.roof === 'gable' || def.roof === 'falseFront') {
    const gr = def.roof === 'gable' ? rise : Math.min(Math.min(w, d) * 0.3, 3);
    // parts.gable puts the ridge along x; turn it for a ridge along z.
    const g =
      def.ridge === 'x'
        ? gable(w, d, gr, 0, 0, 0, roof)
        : gable(d, w, gr, 0, 0, 0, roof).rotateY(Math.PI / 2);
    parts.push(g.translate(cx, b.eavesY, cz));
    // Gable-end infill, so the triangles under the roof aren't open.
    const span = def.ridge === 'x' ? d : w;
    const tri = new THREE.Shape([
      new THREE.Vector2(-span / 2, 0),
      new THREE.Vector2(span / 2, 0),
      new THREE.Vector2(0, gr),
    ]);
    for (const s of [-1, 1]) {
      const g2 = part(
        new THREE.ExtrudeGeometry(tri, { depth: WALL_M, bevelEnabled: false }),
        paint,
      );
      g2.translate(0, 0, -WALL_M / 2);
      if (def.ridge === 'x') g2.rotateY(Math.PI / 2).translate(cx + (s * w) / 2, b.eavesY, cz);
      else g2.translate(cx, b.eavesY, cz + (s * d) / 2);
      parts.push(g2);
    }
    if (def.kind === 'packingHouse') {
      parts.push(box(2.4, 1.6, 2.4, cx, b.eavesY + gr - 0.4, cz, TRIM));
      parts.push(gable(2.8, 2.8, 0.8, cx, b.eavesY + gr + 1.2, cz, roof));
    }
    if (def.kind === 'cooperage' || def.kind === 'house' || def.kind === 'saloon') {
      parts.push(box(0.6, gr + 1.4, 0.6, cx + w * 0.25, b.eavesY, cz + d * 0.2, PALETTE.brick));
    }
    if (def.roof === 'falseFront') {
      // The tall square front on the street (north) side, with a cornice.
      parts.push(box(w + 0.3, rise + 0.4, 0.3, cx, b.eavesY - 0.4, b.minZ - 0.05, paint));
      parts.push(box(w + 0.6, 0.3, 0.6, cx, b.topY, b.minZ - 0.05, TRIM));
      // A blank sign board over the door.
      parts.push(box(Math.min(w - 1, 6), 0.9, 0.12, cx, b.eavesY - 1.2, b.minZ - 0.2, 0x3d3428));
    }
  } else {
    // Flat: tar roof and a parapet.
    parts.push(box(w + 0.2, 0.3, d + 0.2, cx, b.eavesY, cz, 0x3a3836));
    for (const [px, pz, pw, pd] of [
      [cx, b.minZ, w + 0.3, 0.3],
      [cx, b.maxZ, w + 0.3, 0.3],
      [b.minX, cz, 0.3, d + 0.3],
      [b.maxX, cz, 0.3, d + 0.3],
    ] as const) {
      parts.push(box(pw, rise + 0.2, pd, px, b.eavesY, pz, paint));
    }
  }
  out.body.push(...parts);
}

// --- Props ----------------------------------------------------------------------------

export function propGeometry(p: PlacedPiece, out: KitSink): void {
  const body: THREE.BufferGeometry[] = [];
  const lit: THREE.BufferGeometry[] = [];
  const [w, d] = p.piece.sizeM;
  const h = p.piece.heightM;
  const v = p.variant;
  switch (p.piece.id) {
    case 'kit.crate':
      crate(body, 0.9, 0, 0, 0, v);
      break;
    case 'kit.crate_stack':
      crate(body, 0.9, -0.45, 0, 0);
      crate(body, 0.9, 0.45, 0, 0, 1);
      crate(body, 0.86, -0.4, 0.9, 0.02, 1);
      break;
    case 'kit.barrel':
      barrel(body, 0, 0, 0);
      break;
    case 'kit.barrel_stack':
      // A rack of barrels on their sides, two tiers.
      body.push(box(w, 0.15, d, 0, 0, 0, PLANK_DARK));
      for (const bx of [-0.62, 0, 0.62]) {
        const g = part(new THREE.CylinderGeometry(0.3, 0.3, d * 0.9, 8), BARREL);
        g.rotateX(Math.PI / 2).translate(bx, 0.45, 0);
        body.push(g);
      }
      for (const bx of [-0.31, 0.31]) {
        const g = part(new THREE.CylinderGeometry(0.3, 0.3, d * 0.9, 8), BARREL);
        g.rotateX(Math.PI / 2).translate(bx, 0.97, 0);
        body.push(g);
      }
      break;
    case 'kit.fish_boxes':
      for (let k = 0; k < 3; k++)
        body.push(
          box(w - k * 0.04, 0.18, d - k * 0.03, k * 0.03, k * 0.2, 0, k % 2 ? 0xa48a64 : 0x8d7552),
        );
      break;
    case 'kit.sacks':
      for (const [sx, sz, sy] of [
        [-0.35, -0.2, 0],
        [0.35, -0.2, 0],
        [-0.35, 0.25, 0],
        [0.35, 0.25, 0],
        [0, 0, 0.3],
      ] as const) {
        const g = part(new THREE.IcosahedronGeometry(0.4, 0), SACK);
        g.scale(0.95, 0.42, 0.62).translate(sx, sy + 0.17, sz);
        body.push(g);
      }
      break;
    case 'kit.ice_blocks':
      body.push(box(0.55, 0.5, 0.55, -0.3, 0, -0.3, ICE));
      body.push(box(0.55, 0.5, 0.55, 0.3, 0, -0.3, 0xb3cdd4));
      body.push(box(0.55, 0.5, 0.55, -0.3, 0, 0.3, 0xb3cdd4));
      body.push(box(0.55, 0.5, 0.55, 0.3, 0, 0.3, ICE));
      body.push(box(0.55, 0.5, 0.55, 0, 0.5, 0, ICE));
      break;
    case 'kit.net_reel': {
      // A big drum on two trestles, wound with net.
      for (const sx of [-0.7, 0.7]) {
        body.push(
          strut(new THREE.Vector3(sx, 0, -0.45), new THREE.Vector3(sx, 0.9, 0), 0.05, PLANK_DARK),
        );
        body.push(
          strut(new THREE.Vector3(sx, 0, 0.45), new THREE.Vector3(sx, 0.9, 0), 0.05, PLANK_DARK),
        );
      }
      const drum = part(new THREE.CylinderGeometry(0.62, 0.62, 1.3, 10), NET);
      drum.rotateZ(Math.PI / 2).translate(0, 0.95, 0);
      body.push(drum);
      for (const sx of [-0.68, 0.68]) {
        const rim = part(new THREE.CylinderGeometry(0.7, 0.7, 0.05, 10), PLANK);
        rim.rotateZ(Math.PI / 2).translate(sx, 0.95, 0);
        body.push(rim);
      }
      break;
    }
    case 'kit.lumber_pile':
      for (let k = 0; k < 6; k++)
        body.push(
          box(w - (k % 2) * 0.2, 0.2, d - 0.1, 0, k * 0.23, 0, k % 2 ? 0xb4955f : 0xa38451),
        );
      for (const sx of [-1.2, 0, 1.2]) body.push(box(0.08, 0.04, d, sx, 0.2, 0, PLANK_DARK));
      break;
    case 'kit.coal_heap':
      body.push(frustum(0.4, w / 2, h, 9, 0, 0, 0, COAL));
      break;
    case 'kit.cart': {
      body.push(box(1.3, 0.12, 2.2, 0, 0.75, 0, PLANK));
      for (const sx of [-0.65, 0.65]) body.push(box(0.06, 0.35, 2.2, sx, 0.87, 0, PLANK_DARK));
      for (const sx of [-0.72, 0.72]) {
        const wheel = part(new THREE.CylinderGeometry(0.55, 0.55, 0.08, 10), PLANK_DARK);
        wheel.rotateZ(Math.PI / 2).translate(sx, 0.55, 0.3);
        body.push(wheel);
      }
      for (const sx of [-0.45, 0.45]) {
        body.push(
          strut(
            new THREE.Vector3(sx, 0.8, -1.1),
            new THREE.Vector3(sx * 0.8, 0.45, -2.3),
            0.04,
            PLANK,
          ),
        );
      }
      break;
    }
    case 'kit.woodpile':
      for (let k = 0; k < 4; k++) {
        for (let j = 0; j < 5; j++) {
          body.push(
            lying(
              0.13,
              d,
              5,
              -w / 2 + 0.25 + j * 0.47 + (k % 2) * 0.1,
              k * 0.26,
              0,
              j % 2 ? 0x7a5d3e : 0x8d6b47,
            ).rotateY(Math.PI / 2),
          );
        }
      }
      break;
    case 'kit.rowboat': {
      const hull = new THREE.Shape([
        new THREE.Vector2(-0.6, -1.6),
        new THREE.Vector2(0.6, -1.6),
        new THREE.Vector2(0.55, 1.2),
        new THREE.Vector2(0, 1.9),
        new THREE.Vector2(-0.55, 1.2),
      ]);
      const g = part(
        new THREE.ExtrudeGeometry(hull, { depth: 0.5, bevelEnabled: false }),
        0x4a5d58,
      );
      g.rotateX(Math.PI / 2).translate(0, 0.55, 0);
      body.push(g);
      body.push(box(1.0, 0.06, 0.25, 0, 0.35, -0.3, PLANK));
      body.push(box(1.0, 0.06, 0.25, 0, 0.35, 0.7, PLANK));
      break;
    }
    case 'kit.privy':
      body.push(box(w, h - 0.2, d, 0, 0, 0, PLANK));
      body.push(box(w + 0.3, 0.1, d + 0.3, 0, h - 0.2, 0.05, ROOF[1]).rotateX(0.12));
      body.push(box(0.7, 1.9, 0.04, 0, 0, -d / 2 - 0.02, PLANK_DARK));
      break;
    case 'kit.derrick':
      body.push(cylinder(0.18, h, 6, 0, 0, 0, PLANK_DARK));
      body.push(
        strut(new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, h * 0.75, -5), 0.12, PLANK_DARK),
      );
      body.push(strut(new THREE.Vector3(0, h, 0), new THREE.Vector3(0, h * 0.75, -5), 0.02, IRON));
      break;
    case 'kit.telegraph_pole':
      body.push(cylinder(0.12, h, 6, 0, 0, 0, 0x5a4636));
      body.push(box(1.4, 0.1, 0.1, 0, h - 0.6, 0, 0x5a4636));
      break;
    case 'kit.hitching_rail':
      for (const sx of [-1.1, 1.1]) body.push(box(0.12, h, 0.12, sx, 0, 0, PLANK_DARK));
      body.push(box(w, 0.1, 0.1, 0, h - 0.1, 0, PLANK));
      break;
    case 'kit.sign_post':
      body.push(box(0.12, h, 0.12, 0, 0, 0, PLANK_DARK));
      body.push(box(1.2, 0.4, 0.05, 0.5, h - 0.6, 0, TRIM));
      break;
    case 'kit.bar_counter':
      body.push(box(w, h - 0.06, d, 0, 0, 0, 0x5a3f2c));
      body.push(box(w + 0.1, 0.06, d + 0.12, 0, h - 0.06, 0, 0x7a5a3d));
      break;
    case 'kit.table':
      body.push(box(w, 0.06, d, 0, h - 0.06, 0, 0x7a5a3d));
      for (const [sx, sz] of [
        [-1, -1],
        [1, -1],
        [1, 1],
        [-1, 1],
      ] as const) {
        body.push(box(0.06, h - 0.06, 0.06, sx * (w / 2 - 0.1), 0, sz * (d / 2 - 0.1), PLANK_DARK));
      }
      break;
    case 'kit.bench':
      body.push(box(w, 0.06, d, 0, h - 0.06, 0, PLANK));
      for (const sx of [-1, 1])
        body.push(box(0.06, h - 0.06, d - 0.05, sx * (w / 2 - 0.1), 0, 0, PLANK_DARK));
      break;
    case 'kit.shelf':
      for (const sx of [-1, 1]) body.push(box(0.05, h, d, sx * (w / 2 - 0.03), 0, 0, PLANK_DARK));
      for (let k = 0; k < 4; k++) {
        body.push(box(w, 0.04, d, 0, 0.1 + k * 0.6, 0, PLANK));
        for (let j = 0; j < 4; j++) {
          if (hash(p.x * 9 + p.z * 5 + k * 3 + j) < 0.35) continue;
          body.push(
            box(
              0.3,
              0.3,
              d * 0.7,
              -w / 2 + 0.3 + j * 0.45,
              0.14 + k * 0.6,
              0,
              j % 2 ? CRATE : SACK,
            ),
          );
        }
      }
      break;
    case 'kit.desk':
      body.push(box(w, 0.05, d, 0, h - 0.05, 0, 0x6a4b33));
      body.push(box(0.5, h - 0.05, d - 0.05, -w / 2 + 0.27, 0, 0, 0x5a3f2c));
      body.push(box(0.05, h - 0.05, d - 0.05, w / 2 - 0.05, 0, 0, 0x5a3f2c));
      break;
    case 'kit.bunk':
      body.push(box(w, 0.3, d, 0, 0.2, 0, 0x6f6658));
      for (const [sx, sz] of [
        [-1, -1],
        [1, -1],
        [1, 1],
        [-1, 1],
      ] as const) {
        body.push(box(0.05, 0.25, 0.05, sx * (w / 2 - 0.05), 0, sz * (d / 2 - 0.05), IRON));
      }
      break;
    case 'kit.stove':
      body.push(cylinder(w / 2, h * 0.8, 8, 0, 0.15, 0, IRON));
      body.push(cylinder(0.08, 2.2, 6, 0, h * 0.95, 0, IRON));
      lit.push(box(0.2, 0.12, 0.05, 0, 0.45, -w / 2 + 0.02, 0xd8702e));
      break;
    case 'kit.safe':
      body.push(box(w, h, d, 0, 0, 0, 0x2f3533));
      body.push(
        cylinder(0.08, 0.04, 8, 0.1, h * 0.55, -d / 2 - 0.02, 0xb8a25a).rotateX(Math.PI / 2),
      );
      break;
    case 'kit.gas_lamp':
      body.push(frustum(0.06, 0.12, h - 0.5, 6, 0, 0, 0, IRON));
      body.push(box(0.3, 0.05, 0.3, 0, h - 0.55, 0, IRON));
      lit.push(frustum(0.18, 0.12, 0.42, 4, 0, h - 0.5, 0, LAMP));
      body.push(frustum(0.02, 0.24, 0.16, 4, 0, h - 0.1, 0, IRON));
      break;
    case 'kit.lantern_hook':
      // A bracket off a wall on the -z side (place the piece on the wall's face).
      body.push(box(0.04, 0.04, 0.4, 0, h - 0.05, 0.1, IRON));
      lit.push(box(0.16, 0.24, 0.16, 0, h - 0.4, -0.08, LAMP));
      body.push(frustum(0.02, 0.11, 0.08, 4, 0, h - 0.16, -0.08, IRON));
      break;
    case 'kit.lantern_post':
      body.push(box(0.12, h - 0.3, 0.12, 0, 0, 0, PLANK_DARK));
      body.push(box(0.4, 0.06, 0.06, 0.15, h - 0.35, 0, IRON));
      lit.push(box(0.18, 0.26, 0.18, 0.3, h - 0.62, 0, LAMP));
      break;
    case 'kit.bollard':
      body.push(cylinder(0.18, h - 0.08, 8, 0, 0, 0, IRON));
      body.push(cylinder(0.24, 0.08, 8, 0, h - 0.08, 0, IRON));
      break;
    case 'kit.pile_cluster':
      for (const [sx, sz] of [
        [0, -0.35],
        [0.32, 0.2],
        [-0.32, 0.2],
      ] as const) {
        body.push(cylinder(0.2, h + 4, 6, sx, -4, sz, PILE));
      }
      body.push(cylinder(0.62, 0.15, 8, 0, h - 0.5, 0, IRON));
      break;
    case 'kit.facade_one':
    case 'kit.facade_two': {
      // Town past the bounds: a front with windows (half lit) and a dark block behind.
      const paint = PAINTS[(v + 2) % PAINTS.length] as number;
      const storeys = p.piece.id === 'kit.facade_two' ? 2 : 1;
      body.push(box(w, h, d, 0, 0, 0, paint));
      body.push(box(w + 0.4, 0.3, 0.5, 0, h, -d / 2, TRIM));
      for (let s = 0; s < storeys; s++) {
        for (let k = 0; k < 3; k++) {
          const x = -w / 2 + (k + 0.5) * (w / 3);
          const lighted = hash(p.x * 3.3 + s * 7 + k * 11 + v) < 0.45;
          const g = box(1.0, 1.5, 0.1, x, 1.2 + s * 3.4, -d / 2 - 0.04, lighted ? LIT : GLASS);
          (lighted ? lit : body).push(g);
        }
      }
      break;
    }
    default:
      body.push(box(w, Math.max(h, 0.1), d, 0, 0, 0, CRATE));
      break;
  }
  place(body, p.x, p.y, p.z, p.heading);
  place(lit, p.x, p.y, p.z, p.heading);
  out.body.push(...body);
  out.lit.push(...lit);
}
