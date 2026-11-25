import * as THREE from 'three';
import type { DistrictBuilding, DistrictPile, PlacedPiece } from '../../gameplay/district/district';
import { CELL_M, DECK_THICK_M, DOOR_HEIGHT_M, WALL_M } from '../../sim/district/kit';
import { PALETTE } from '../style/palette';
import { box, frustum, gable, merged, part, strut } from '../style/parts';
import { buildingStyle, chimneys, flagpole, idHash, type BuildingStyle } from './styles';

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
const FACADE_PAINTS = [
  0xe4ddca, 0xd8c99f, 0xc9ae78, 0xb5b0a2, 0x8e9a7f, 0x7b8a92, 0x2f4a3b, 0x8a3a2a,
] as const;
const FACADE_TRIMS = [0xe8e2d2, 0x2f4a3b, 0x6c2b22, 0x5b3f2b, 0xd8c99f] as const;

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

export function barrel(
  out: THREE.BufferGeometry[],
  x: number,
  y: number,
  z: number,
  scale = 1,
): void {
  const r = 0.3 * scale;
  const h = 0.9 * scale;
  out.push(frustum(r, r * 0.86, h / 2, 8, x, y, z, BARREL));
  out.push(frustum(r * 0.86, r, h / 2, 8, x, y + h / 2, z, BARREL));
  out.push(cylinder(r * 1.01, 0.05, 8, x, y + h * 0.2, z, IRON));
  out.push(cylinder(r * 1.01, 0.05, 8, x, y + h * 0.75, z, IRON));
}

export function crate(
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
  /** The building's dress (siding, sash, shutters…); none for a loose wall. */
  style?: BuildingStyle | undefined;
  /** Which side of the piece (its local z) faces out of the building: −1, 1, or 0 inside. */
  out?: number;
  /** The wall turns the building's corner at its local −x and +x ends. */
  corners?: readonly [boolean, boolean];
}

/** A flat panel facing +z (or −z with `flip`), its foot at y: siding lines, paint. */
function panel(
  w: number,
  h: number,
  x: number,
  y: number,
  z: number,
  color: number,
  flip: boolean,
): THREE.BufferGeometry {
  const g = part(new THREE.PlaneGeometry(w, h), color);
  if (flip) g.rotateY(Math.PI);
  return g.translate(x, y + h / 2, z);
}

function shade(color: number, k: number): number {
  return new THREE.Color(color).multiplyScalar(k).getHex();
}

/** Stone sills, lintels and footings on the brick buildings. */
const STONE_TRIM = 0xb3aa98;
const FOOTING = 0x6f6a61;
const CURTAIN = [0xd9ccae, 0x9b3b2f, 0xc9b98f, 0x6f7f5e] as const;
const FLOWERS = [0xb3392b, 0xd77a8a, 0xe6dcc2, 0xd9a83a] as const;

/**
 * Siding lines on a wall's outside face over x0..x1, y0..y1 (piece frame): clapboard's
 * shadow lines, brick's mortar courses. Board-and-batten has its battens drawn through.
 */
function sidingLines(
  out: THREE.BufferGeometry[],
  style: BuildingStyle,
  wall: number,
  side: number,
  x0: number,
  x1: number,
  y0: number,
  y1: number,
): void {
  if (side === 0 || x1 - x0 < 0.05) return;
  const z = side * (WALL_M / 2 + 0.004);
  const flip = side < 0;
  if (style.siding === 'clapboard') {
    const line = shade(wall, 0.74);
    for (let y = y0 + 0.26; y < y1 - 0.08; y += 0.27)
      out.push(panel(x1 - x0, 0.045, (x0 + x1) / 2, y, z, line, flip));
  } else if (style.siding === 'brick') {
    const mortar = shade(wall, 1.28);
    for (let y = y0 + 0.3; y < y1 - 0.1; y += 0.32)
      out.push(panel(x1 - x0, 0.028, (x0 + x1) / 2, y, z, mortar, flip));
  }
}

/**
 * A door's leaf in the piece's own frame: shut across the opening, or swung open against
 * the wall's inside face (+z here). A board gate's leaf is half its width. A cargo door
 * has a brace across it; a house or shop door rails and a light.
 */
function leafGeometry(
  p: PlacedPiece,
  w: number,
  height: number,
  shut: boolean,
  color?: number,
): THREE.BufferGeometry {
  const gate = p.piece.id === 'kit.gate_board';
  const c = color ?? (gate ? PLANK_DARK : 0x5a3f2c);
  const h = Math.min(DOOR_HEIGHT_M, height) - 0.05;
  const lw = w * (shut ? 0.95 : gate ? 0.5 : 0.95);
  const parts: THREE.BufferGeometry[] = [box(lw, h, 0.06, 0, 0, 0, c)];
  if (!gate) {
    const rail = shade(c, 0.72);
    if (w >= 1.7) {
      // A cargo door's ledges and brace, both faces.
      for (const y of [0.35, h / 2, h - 0.4]) parts.push(box(lw, 0.12, 0.09, 0, y, 0, rail));
      const len2 = Math.hypot(lw * 0.85, h * 0.7);
      const brace = box(0.12, len2, 0.09, 0, -len2 / 2, 0, rail).rotateZ(
        Math.atan2(lw * 0.85, h * 0.7),
      );
      parts.push(brace.translate(0, h / 2, 0));
    } else {
      for (const y of [0.25, 1.0]) parts.push(box(lw * 0.9, 0.07, 0.08, 0, y, 0, rail));
      parts.push(box(lw * 0.5, 0.45, 0.075, 0, h - 0.7, 0, GLASS));
    }
  }
  const g = merged(parts);
  if (shut) return g;
  return g
    .translate(-lw / 2, 0, 0)
    .rotateY(-Math.PI / 2 + 0.25)
    .translate(w / 2, 0, WALL_M / 2);
}

/** A door piece's leaf placed in the district, open or shut (the view's locking doors). */
export function doorLeafGeometry(
  p: PlacedPiece,
  shut: boolean,
  color?: number,
): THREE.BufferGeometry | undefined {
  if (p.piece.collider !== 'door') return undefined;
  const g = leafGeometry(p, p.piece.openingM ?? 1.4, p.topY - p.y, shut, color);
  place([g], p.x, p.y, p.z, p.heading);
  return g;
}

/**
 * An edge piece's geometry. With `dynamicLeaf`, a door piece that names its door leaves its
 * leaf out, for the view to draw open or shut (`doorLeafGeometry`).
 */
export function edgeGeometry(
  p: PlacedPiece,
  paint: EdgePaint,
  out: KitSink,
  dynamicLeaf = false,
): void {
  const body: THREE.BufferGeometry[] = [];
  const lit: THREE.BufferGeometry[] = [];
  const len = CELL_M + WALL_M;
  const height = p.topY - p.y;
  const footing = 0.4;
  const style = paint.style;
  const side = style ? (paint.out ?? 0) : 0;
  const wallColor = paint.brick ? (style?.wall ?? PALETTE.brick) : paint.wall;
  const trimColor = paint.brick ? STONE_TRIM : paint.trim;
  const sash = style?.sash ?? paint.trim;
  const kind = p.piece.collider;
  const id = p.piece.id;
  /** Outside face, `d` deep: the z of a part's middle. */
  const face = (d: number): number => side * (WALL_M / 2 + d / 2);
  const window = (cx: number, sill: number): void => {
    const r = hash(paint.seed * 31.7 + p.x * 1.3 + p.z * 2.9);
    const lighted = r < 0.5;
    body.push(box(1.0, 1.5, WALL_M + 0.06, cx, sill - 0.05, 0, trimColor));
    const pane = box(0.8, 1.3, WALL_M + 0.1, cx, sill + 0.05, 0, lighted ? LIT : GLASS);
    (lighted ? lit : body).push(pane);
    if (!style) return;
    // Two-over-two sash: a meeting rail and a muntin, both faces.
    body.push(box(0.05, 1.3, WALL_M + 0.13, cx, sill + 0.05, 0, sash));
    body.push(box(0.8, 0.06, WALL_M + 0.13, cx, sill + 0.66, 0, sash));
    if (side === 0) return;
    if (style.curtains) {
      const c = CURTAIN[Math.floor(hash(paint.seed * 3.1) * CURTAIN.length)] as number;
      for (const sx of [-1, 1])
        body.push(box(0.17, 1.22, 0.02, cx + sx * 0.3, sill + 0.08, face(0.13), c));
    }
    // A sill under, a cap or a stone lintel over.
    body.push(box(1.16, 0.07, 0.18, cx, sill - 0.12, face(0.18), trimColor));
    if (paint.brick) {
      body.push(box(1.24, 0.22, 0.08, cx, sill + 1.45, face(0.08), STONE_TRIM));
      body.push(box(0.2, 0.3, 0.1, cx, sill + 1.42, face(0.1), shade(STONE_TRIM, 0.9)));
    } else {
      body.push(box(1.22, 0.1, 0.16, cx, sill + 1.48, face(0.16), trimColor));
      body.push(box(1.1, 0.12, 0.06, cx, sill + 1.36, face(0.06), trimColor));
    }
    if (style.shutters) {
      for (const sx of [-1, 1]) {
        body.push(box(0.4, 1.42, 0.05, cx + sx * 0.72, sill - 0.01, face(0.05), sash));
        for (const y of [0.35, 1.0])
          body.push(box(0.3, 0.04, 0.07, cx + sx * 0.72, sill + y, face(0.07), shade(sash, 0.75)));
      }
    }
    if (style.flowerBoxes && sill < 2) {
      body.push(box(0.92, 0.22, 0.24, cx, sill - 0.36, face(0.3), sash));
      for (let k = 0; k < 5; k++) {
        const c = FLOWERS[Math.floor(hash(p.x * 7.1 + p.z * 3.3 + k) * FLOWERS.length)] as number;
        body.push(
          box(0.15, 0.13, 0.13, cx - 0.36 + k * 0.18, sill - 0.15, face(0.3), k % 2 ? 0x4f6a3a : c),
        );
      }
    }
  };
  /** Paint over the outside face: footing, frieze, corner boards and the siding lines. */
  const dress = (regions: readonly (readonly [number, number, number, number])[]): void => {
    if (!style || side === 0) return;
    for (const [x0, x1, y0, y1] of regions)
      sidingLines(body, style, wallColor, side, x0, x1, y0, y1);
    // A stone or tarred footing, and a frieze board (or a corbel course) under the eaves.
    body.push(
      box(len, footing + 0.32, 0.05, 0, -footing, face(0.05), paint.brick ? STONE_TRIM : FOOTING),
    );
    if (paint.brick) {
      body.push(box(len, 0.12, 0.1, 0, height - 0.5, face(0.1), shade(wallColor, 0.8)));
      body.push(box(len, 0.16, 0.06, 0, height - 0.34, face(0.06), shade(wallColor, 0.9)));
    } else if (style.siding === 'clapboard') {
      body.push(box(len, 0.32, 0.05, 0, height - 0.32, face(0.05), trimColor));
    }
    const [lo, hi] = paint.corners ?? [false, false];
    const cornerColor = paint.brick ? shade(wallColor, 0.92) : trimColor;
    if (lo)
      body.push(
        box(0.24, height + footing, 0.06, -len / 2 + 0.12, -footing, face(0.06), cornerColor),
      );
    if (hi)
      body.push(
        box(0.24, height + footing, 0.06, len / 2 - 0.12, -footing, face(0.06), cornerColor),
      );
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
      if (!paint.brick && style?.siding !== 'clapboard') {
        // Board-and-batten: a few dark battens so the planking reads.
        const batten = style ? shade(wallColor, 0.7) : PLANK_DARK;
        for (const bx of [-0.66, 0, 0.66])
          body.push(box(0.06, height, WALL_M + 0.03, bx, 0, 0, batten));
      }
      dress([[-len / 2, len / 2, 0, height]]);
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
      const lintel = height > DOOR_HEIGHT_M + 0.05;
      if (lintel) {
        body.push(box(w, height - DOOR_HEIGHT_M, WALL_M, 0, DOOR_HEIGHT_M, 0, color));
        body.push(box(w + 0.2, 0.15, WALL_M + 0.08, 0, DOOR_HEIGHT_M, 0, trimColor));
        if (height > 5) window(0, 3.6);
      }
      if (!door) {
        if (!paint.brick && style?.siding !== 'clapboard') {
          const batten = style ? shade(wallColor, 0.7) : PLANK_DARK;
          for (const bx of [-len / 2 + jamb / 2, len / 2 - jamb / 2])
            body.push(box(0.06, height, WALL_M + 0.03, bx, 0, 0, batten));
        }
        dress([
          [-len / 2, -w / 2, 0, height],
          [w / 2, len / 2, 0, height],
          [-w / 2, w / 2, DOOR_HEIGHT_M + 0.15, height],
        ]);
        if (style && side !== 0) {
          // Casing round the opening, a lit transom, a hood on brackets.
          for (const sx of [-1, 1])
            body.push(
              box(0.14, DOOR_HEIGHT_M, 0.07, sx * (w / 2 + 0.07), 0, face(0.07), trimColor),
            );
          if (style.transom && lintel && height > DOOR_HEIGHT_M + 0.6 && w < 1.7) {
            const lighted = hash(paint.seed * 5.3 + p.x * 0.7 + p.z) < 0.6;
            const t = box(
              w - 0.2,
              0.32,
              WALL_M + 0.08,
              0,
              DOOR_HEIGHT_M + 0.2,
              0,
              lighted ? LIT : GLASS,
            );
            (lighted ? lit : body).push(t);
            body.push(box(w + 0.1, 0.08, 0.1, 0, DOOR_HEIGHT_M + 0.54, face(0.1), trimColor));
          }
          if (style.doorHood && height > DOOR_HEIGHT_M + 0.75) {
            const hy = DOOR_HEIGHT_M + 0.62;
            body.push(box(w + 0.6, 0.1, 0.7, 0, hy, face(0.7), trimColor));
            body.push(box(w + 0.7, 0.06, 0.8, 0, hy + 0.1, face(0.8), style.roof));
            for (const sx of [-1, 1])
              body.push(
                box(0.08, 0.36, 0.42, sx * (w / 2 + 0.2), hy - 0.36, face(0.42), trimColor),
              );
          }
        }
      }
      // A door that locks and unlocks has its leaf drawn apart (`doorLeafGeometry`), open
      // or shut by the hour; the rest are drawn here, an empty house's shut.
      if (!(dynamicLeaf && p.door && !p.shut))
        body.push(leafGeometry(p, w, height, !!p.shut, door ? undefined : style?.door));
      break;
    }
    case 'fence': {
      body.push(box(len, p.piece.heightM, 0.08, 0, 0, 0, PLANK));
      body.push(box(0.14, p.piece.heightM + 0.15, 0.14, -CELL_M / 2, -0.1, 0, PLANK_DARK));
      for (const bx of [-0.5, 0.5])
        body.push(box(0.05, p.piece.heightM, 0.1, bx, 0, 0, shade(PLANK, 0.85)));
      break;
    }
    case 'rail': {
      const ht = p.piece.heightM;
      if (id === 'kit.fence_picket') {
        for (let k = 0; k < 8; k++) {
          const x = -CELL_M / 2 + (k + 0.5) * (CELL_M / 8);
          body.push(box(0.07, ht - 0.08, 0.03, x, 0, 0, TRIM));
          body.push(frustum(0.0, 0.05, 0.1, 4, x, ht - 0.08, 0, TRIM));
        }
        body.push(box(CELL_M, 0.06, 0.05, 0, ht * 0.7, 0, TRIM));
        body.push(box(CELL_M, 0.06, 0.05, 0, ht * 0.25, 0, TRIM));
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

/** A louvered ridge ventilator (fish sheds, ice houses, warehouses), its foot at y. */
function ventilator(
  out: THREE.BufferGeometry[],
  x: number,
  y: number,
  z: number,
  ridgeX: boolean,
  body: number,
  roof: number,
): void {
  out.push(box(1.1, 0.9, 1.1, x, y - 0.3, z, body));
  for (const ly of [0.05, 0.25, 0.45])
    out.push(box(1.16, 0.06, 1.16, x, y + ly, z, shade(body, 0.6)));
  const cap = gable(1.1, 1.1, 0.5, 0, 0, 0, roof);
  if (!ridgeX) cap.rotateY(Math.PI / 2);
  out.push(cap.translate(x, y + 0.6, z));
}

/** A gable's bargeboards: trim up both rakes of a gable end, at x (ridge along z) or z. */
function bargeboards(
  out: THREE.BufferGeometry[],
  b: DistrictBuilding,
  rise: number,
  color: number,
): void {
  const ridgeX = b.def.ridge === 'x';
  const cx = (b.minX + b.maxX) / 2;
  const cz = (b.minZ + b.maxZ) / 2;
  const y = b.eavesY;
  for (const end of [-1, 1]) {
    if (ridgeX) {
      const x = end < 0 ? b.minX - 0.32 : b.maxX + 0.32;
      const top = new THREE.Vector3(x, y + rise + 0.04, cz);
      for (const s of [-1, 1])
        out.push(
          strut(
            new THREE.Vector3(x, y - 0.06, cz + s * ((b.maxZ - b.minZ) / 2 + 0.3)),
            top,
            0.07,
            color,
          ),
        );
    } else {
      const z = end < 0 ? b.minZ - 0.32 : b.maxZ + 0.32;
      const top = new THREE.Vector3(cx, y + rise + 0.04, z);
      for (const s of [-1, 1])
        out.push(
          strut(
            new THREE.Vector3(cx + s * ((b.maxX - b.minX) / 2 + 0.3), y - 0.06, z),
            top,
            0.07,
            color,
          ),
        );
    }
  }
}

/** A building's roof, separate from its walls so it can fade when you're inside. */
export function roofGeometry(b: DistrictBuilding, out: KitSink): void {
  const def = b.def;
  const style = buildingStyle(b);
  const w = b.maxX - b.minX;
  const d = b.maxZ - b.minZ;
  const cx = (b.minX + b.maxX) / 2;
  const cz = (b.minZ + b.maxZ) / 2;
  const roof = style.roof;
  const paint = style.wall;
  const trim = style.siding === 'brick' ? STONE_TRIM : style.trim;
  const parts: THREE.BufferGeometry[] = [];
  const rise = b.topY - b.eavesY;
  const h = idHash(def.id);
  if (def.roof === 'gable' || def.roof === 'falseFront') {
    // A false front hides its roof from the street: the ridge stays under its top.
    const gr = def.roof === 'gable' ? rise : Math.min(Math.min(w, d) * 0.3, 3, rise - 0.15);
    // parts.gable puts the ridge along x; turn it for a ridge along z.
    const g =
      def.ridge === 'x'
        ? gable(w, d, gr, 0, 0, 0, roof)
        : gable(d, w, gr, 0, 0, 0, roof).rotateY(Math.PI / 2);
    // Under a false front the roof stops at the front instead of overhanging it.
    const tuck = def.roof === 'falseFront' && def.ridge === 'z' ? 0.32 : 0;
    parts.push(g.translate(cx, b.eavesY, cz + tuck));
    // A ridge cap.
    parts.push(
      def.ridge === 'x'
        ? box(w + 0.7, 0.14, 0.3, cx, b.eavesY + gr - 0.08, cz, shade(roof, 0.7))
        : box(0.3, 0.14, d + 0.7, cx, b.eavesY + gr - 0.08, cz + tuck, shade(roof, 0.7)),
    );
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
      // A round or square gable vent in the peak (lit glass in a house's attic, sometimes).
      if (gr > 1.2 && style.siding !== 'brick') {
        const vy = b.eavesY + gr * 0.45;
        const vent = box(
          0.5,
          0.5,
          WALL_M + 0.06,
          0,
          vy,
          0,
          style.siding === 'clapboard' ? trim : shade(paint, 0.6),
        );
        const pane = box(0.36, 0.36, WALL_M + 0.1, 0, vy + 0.07, 0, GLASS);
        for (const v of [vent, pane]) {
          if (def.ridge === 'x') v.rotateY(Math.PI / 2).translate(cx + (s * w) / 2, 0, cz);
          else v.translate(cx, 0, cz + (s * d) / 2);
          parts.push(v);
        }
      }
    }
    if (def.roof === 'gable' && style.siding !== 'brick') bargeboards(parts, b, gr, trim);
    if (def.kind === 'packingHouse') {
      parts.push(box(2.4, 1.6, 2.4, cx, b.eavesY + gr - 0.4, cz, TRIM));
      for (const ly of [0.3, 0.7, 1.1])
        parts.push(box(2.46, 0.08, 2.46, cx, b.eavesY + gr - 0.4 + ly, cz, shade(TRIM, 0.6)));
      parts.push(gable(2.8, 2.8, 0.8, cx, b.eavesY + gr + 1.2, cz, roof));
    }
    if (style.ventilators > 0 && def.roof === 'gable') {
      const ridgeLen = def.ridge === 'x' ? w : d;
      const n = ridgeLen < 12 ? 1 : style.ventilators;
      for (let k = 0; k < n; k++) {
        const t = n === 1 ? 0 : (k / (n - 1) - 0.5) * ridgeLen * 0.5;
        const vx = def.ridge === 'x' ? cx + t : cx;
        const vz = def.ridge === 'x' ? cz : cz + t;
        ventilator(
          parts,
          vx,
          b.eavesY + gr,
          vz,
          def.ridge === 'x',
          style.siding === 'batten' ? style.trim : paint,
          roof,
        );
      }
    }
    if (def.kind === 'warehouse' && def.wallHeightM > 8) {
      // A grain elevator's cupola: the tall headhouse along the ridge that holds the legs.
      const hw = Math.min(w * 0.3, 9);
      const hd = Math.min(d * 0.45, 5);
      const hy = b.eavesY + gr - 0.6;
      parts.push(box(hw, 5.2, hd, cx, hy, cz, paint));
      for (const sx of [-1, 1])
        parts.push(box(0.1, 5.2, hd + 0.04, cx + sx * (hw / 2), hy, cz, shade(paint, 0.7)));
      for (let k = 0; k < 3; k++) {
        const wx = cx - hw / 3 + (k * hw) / 3;
        parts.push(box(0.8, 1.1, hd + 0.08, wx, hy + 3.2, cz, GLASS));
      }
      parts.push(gable(hw, hd, 1.6, cx, hy + 5.2, cz, roof));
    }
    if (def.id === 'union_depot') {
      // The depot's tower, over the street front, with a hipped spire and a clock.
      const tx = cx + w * 0.28;
      const tz = b.minZ + 2.2;
      const ty = b.eavesY - 1;
      parts.push(box(3.6, gr + 5.2, 3.6, tx, ty, tz, paint));
      parts.push(box(3.9, 0.3, 3.9, tx, ty + gr + 5.2, tz, STONE_TRIM));
      parts.push(box(3.9, 0.25, 3.9, tx, ty + gr + 1.4, tz, STONE_TRIM));
      for (const [ox, oz] of [
        [0, -1.82],
        [0, 1.82],
        [-1.82, 0],
        [1.82, 0],
      ] as const) {
        const face2 = cylinder(0.75, 0.06, 12, 0, 0, 0, 0xe6e0cf).rotateX(Math.PI / 2);
        if (ox !== 0) face2.rotateY(Math.PI / 2);
        parts.push(face2.translate(tx + ox, ty + gr + 3.7, tz + oz));
        const hand = box(0.06, 0.55, 0.04, 0, 0, 0, IRON);
        if (ox !== 0) hand.rotateY(Math.PI / 2);
        parts.push(hand.translate(tx + ox * 1.02, ty + gr + 3.65, tz + oz * 1.02));
      }
      const spire = part(new THREE.ConeGeometry(3.0, 4.2, 4, 1), SLATE_ROOF);
      parts.push(spire.rotateY(Math.PI / 4).translate(tx, ty + gr + 5.5 + 2.1, tz));
      parts.push(cylinder(0.04, 1.4, 4, tx, ty + gr + 9.6, tz, IRON));
    }
    if (def.roof === 'falseFront') {
      const fy0 = b.eavesY - 0.4;
      const fz = b.minZ - 0.05;
      // The tall square front on the street (north) side, its siding, corner pilasters.
      parts.push(box(w + 0.3, rise + 0.4, 0.3, cx, fy0, fz, paint));
      if (style.siding === 'clapboard') {
        const line = shade(paint, 0.74);
        for (let y = fy0 + 0.25; y < b.topY - 0.3; y += 0.27)
          parts.push(panel(w + 0.3, 0.045, cx, y, fz - 0.155, line, true));
      }
      for (const sx of [-1, 1])
        parts.push(
          box(0.34, b.topY - b.floorY + 0.4, 0.42, cx + sx * (w / 2), b.floorY - 0.4, fz, trim),
        );
      // The cornice: plain, on brackets, with a pediment, or stepped up in the middle.
      parts.push(box(w + 0.6, 0.3, 0.6, cx, b.topY, fz, trim));
      parts.push(box(w + 0.4, 0.22, 0.42, cx, b.topY - 0.22, fz, shade(trim, 0.88)));
      if (style.cornice === 'bracketed' || style.cornice === 'pediment') {
        const n = Math.max(3, Math.round(w / 1.6));
        for (let k = 0; k <= n; k++) {
          const bx = cx - w / 2 + (k * w) / n;
          parts.push(box(0.16, 0.5, 0.5, bx, b.topY - 0.5, fz - 0.05, trim));
        }
        parts.push(box(w, 0.35, 0.36, cx, b.topY - 0.85, fz, shade(trim, 0.95)));
      }
      if (style.cornice === 'pediment') {
        const pw = Math.min(w * 0.45, 5);
        const tri2 = new THREE.Shape([
          new THREE.Vector2(-pw / 2, 0),
          new THREE.Vector2(pw / 2, 0),
          new THREE.Vector2(0, 1.0),
        ]);
        const pg = part(
          new THREE.ExtrudeGeometry(tri2, { depth: 0.36, bevelEnabled: false }),
          trim,
        );
        parts.push(pg.translate(cx, b.topY + 0.3, fz - 0.18));
        const pin = part(
          new THREE.ExtrudeGeometry(tri2, { depth: 0.1, bevelEnabled: false }),
          paint,
        );
        parts.push(pin.scale(0.78, 0.7, 1).translate(cx, b.topY + 0.36, fz - 0.24));
      } else if (style.cornice === 'stepped') {
        const sw = Math.min(w * 0.5, 6);
        parts.push(box(sw, 0.9, 0.3, cx, b.topY + 0.3, fz, paint));
        parts.push(box(sw + 0.4, 0.26, 0.55, cx, b.topY + 1.2, fz, trim));
        for (const sx of [-1, 1])
          parts.push(
            box(w * 0.18, 0.45, 0.3, cx + sx * (sw / 2 + w * 0.09), b.topY + 0.3, fz, paint),
          );
      }
      // A blank sign board over the door.
      parts.push(box(Math.min(w - 1, 6), 0.9, 0.12, cx, b.eavesY - 1.2, b.minZ - 0.2, 0x3d3428));
      parts.push(
        box(Math.min(w - 1, 6) + 0.24, 1.14, 0.08, cx, b.eavesY - 1.32, b.minZ - 0.16, trim),
      );
      const a = style.awning;
      if (a) awning(parts, a, b, b.floorY + 2.95, b.minZ - 0.12, Math.min(w - 0.9, 9.5));
    }
  } else {
    // Flat: tar roof, a parapet with a stone coping and a corbelled course under it.
    parts.push(box(w + 0.2, 0.3, d + 0.2, cx, b.eavesY, cz, 0x3a3836));
    for (const [px, pz, pw, pd] of [
      [cx, b.minZ, w + 0.3, 0.3],
      [cx, b.maxZ, w + 0.3, 0.3],
      [b.minX, cz, 0.3, d + 0.3],
      [b.maxX, cz, 0.3, d + 0.3],
    ] as const) {
      parts.push(box(pw, rise + 0.2, pd, px, b.eavesY, pz, paint));
      parts.push(box(pw + 0.16, 0.14, pd + 0.16, px, b.eavesY + rise + 0.2, pz, STONE_TRIM));
      parts.push(box(pw + 0.12, 0.18, pd + 0.12, px, b.eavesY - 0.05, pz, shade(paint, 0.82)));
    }
    // A name stone in the middle of the street front's parapet.
    parts.push(box(Math.min(w * 0.4, 4), rise + 0.5, 0.36, cx, b.eavesY, b.minZ, paint));
    parts.push(
      box(Math.min(w * 0.4, 4) + 0.2, 0.16, 0.5, cx, b.eavesY + rise + 0.5, b.minZ, STONE_TRIM),
    );
  }
  for (const c of chimneys(b)) {
    if (c.kind === 'brick') {
      const color = h < 0.5 ? PALETTE.brick : 0x8a4434;
      parts.push(box(0.62, c.y1 - c.y0, 0.62, c.x, c.y0, c.z, color));
      parts.push(box(0.8, 0.14, 0.8, c.x, c.y1 - 0.3, c.z, shade(color, 0.75)));
      parts.push(box(0.7, 0.1, 0.7, c.x, c.y1 - 0.06, c.z, shade(color, 0.6)));
    } else {
      parts.push(cylinder(0.1, c.y1 - c.y0, 6, c.x, c.y0, c.z, IRON));
      parts.push(frustum(0.03, 0.24, 0.16, 6, c.x, c.y1 + 0.04, c.z, IRON));
    }
  }
  const flag = flagpole(b);
  if (flag) parts.push(cylinder(0.05, FLAG_POLE_M, 5, flag.x, flag.y - 0.2, flag.z, TRIM));
  if (flag)
    parts.push(cylinder(0.09, 0.12, 6, flag.x, flag.y - 0.2 + FLAG_POLE_M, flag.z, 0xc9a54a));
  out.body.push(...parts);
}

/** A flagpole's height over the roof it stands on. */
export const FLAG_POLE_M = 4.5;
const SLATE_ROOF = 0x464a4d;

/** A shop's awning across the street front: striped canvas on iron rods, or a plank hood. */
function awning(
  out: THREE.BufferGeometry[],
  a: NonNullable<BuildingStyle['awning']>,
  b: DistrictBuilding,
  y: number,
  z: number,
  w: number,
): void {
  const cx = (b.minX + b.maxX) / 2;
  const depth = a.kind === 'canvas' ? 1.7 : 1.9;
  const drop = a.kind === 'canvas' ? 0.55 : 0.32;
  const slope = Math.atan2(drop, depth);
  const run = Math.hypot(depth, drop);
  const local: THREE.BufferGeometry[] = [];
  if (a.kind === 'canvas') {
    const n = Math.max(6, Math.round(w / 0.55));
    const sw = w / n;
    for (let k = 0; k < n; k++) {
      const c = k % 2 ? a.a : a.b;
      local.push(box(sw, 0.04, run, -w / 2 + (k + 0.5) * sw, 0, -run / 2, c));
      // The valance, scalloped by alternating lengths.
      const vl = k % 2 ? 0.26 : 0.32;
      out.push(box(sw, vl, 0.03, cx - w / 2 + (k + 0.5) * sw, y - drop - vl, z - depth, c));
    }
  } else {
    local.push(box(w, 0.1, run, 0, 0, -run / 2, a.b));
    local.push(box(w + 0.1, 0.2, 0.08, 0, -0.16, -run, a.a));
  }
  for (const g of local) {
    g.rotateX(-slope);
    g.translate(cx, y, z);
    out.push(g);
  }
  // Rods or brackets from the wall to the front edge.
  const n = Math.max(2, Math.round(w / 3.2));
  for (let k = 0; k <= n; k++) {
    const bx = cx - w / 2 + 0.1 + (k * (w - 0.2)) / n;
    if (a.kind === 'canvas')
      out.push(
        strut(
          new THREE.Vector3(bx, y + 0.5, z),
          new THREE.Vector3(bx, y - drop, z - depth),
          0.018,
          IRON,
        ),
      );
    else
      out.push(
        strut(
          new THREE.Vector3(bx, y - 0.9, z),
          new THREE.Vector3(bx, y - drop * 0.8, z - depth * 0.85),
          0.05,
          a.a,
        ),
      );
  }
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
      // The crossarm across the line (the poles run along x), glass insulators on its pins.
      body.push(cylinder(0.12, h, 6, 0, 0, 0, 0x5a4636));
      body.push(box(0.1, 0.1, TELEGRAPH_ARM_M * 2 + 0.2, 0, h - 0.6, 0, 0x5a4636));
      for (const sz of [-TELEGRAPH_ARM_M, -0.25, 0.25, TELEGRAPH_ARM_M])
        body.push(cylinder(0.045, 0.12, 5, 0, h - 0.5, sz, 0x6f9a8e));
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
      // Town past the bounds: fronts of four kinds (a false-fronted frame store, a brick
      // block, a gable-fronted house, a shop under an awning), windows half lit.
      const storeys = p.piece.id === 'kit.facade_two' ? 2 : 1;
      const type = (v + Math.floor(hash(p.x * 0.37 + p.z * 0.11) * 4)) % 4;
      const brick = type === 1;
      const paint = brick
        ? (([PALETTE.brick, 0x7d3a2b, 0xc9b48a] as const)[v % 3] as number)
        : (FACADE_PAINTS[(v * 3 + Math.floor(hash(p.x) * 7)) % FACADE_PAINTS.length] as number);
      const trim = brick
        ? 0xb3aa98
        : (FACADE_TRIMS[(v + Math.floor(hash(p.z + 3) * 5)) % FACADE_TRIMS.length] as number);
      const fz = -d / 2;
      const wallH = type === 2 ? h - 2.2 : h;
      body.push(box(w, wallH, d, 0, 0, 0, paint));
      if (type === 2) {
        // A house end-on to the street: the gable faces out.
        const g = gable(d, w, 2.2, 0, 0, 0, ROOF[v % ROOF.length] as number).rotateY(Math.PI / 2);
        body.push(g.translate(0, wallH, 0));
        const tri = new THREE.Shape([
          new THREE.Vector2(-w / 2, 0),
          new THREE.Vector2(w / 2, 0),
          new THREE.Vector2(0, 2.2),
        ]);
        body.push(
          part(
            new THREE.ExtrudeGeometry(tri, { depth: 0.1, bevelEnabled: false }),
            paint,
          ).translate(0, wallH, fz - 0.05),
        );
      } else {
        body.push(box(w + 0.4, 0.3, 0.5, 0, h, fz, trim));
        body.push(box(w + 0.2, 0.25, 0.3, 0, h - 0.3, fz, brick ? 0x7d3a2b : trim));
        if (type !== 1)
          for (let k = 0; k <= 4; k++)
            body.push(box(0.14, 0.4, 0.3, -w / 2 + (k * w) / 4, h - 0.7, fz - 0.05, trim));
      }
      // Siding or courses on the front.
      const line = brick ? 0xb0876d : new THREE.Color(paint).multiplyScalar(0.74).getHex();
      for (let y = 0.3; y < wallH - 0.3; y += brick ? 0.32 : 0.27)
        body.push(box(w, brick ? 0.03 : 0.045, 0.02, 0, y, fz - 0.01, line));
      for (const sx of [-1, 1])
        body.push(box(0.26, wallH, 0.08, sx * (w / 2 - 0.13), 0, fz - 0.04, trim));
      for (let s2 = 0; s2 < storeys; s2++) {
        const shop = s2 === 0 && (type === 0 || type === 3);
        for (let k = 0; k < 3; k++) {
          const x = -w / 2 + (k + 0.5) * (w / 3);
          const lighted = hash(p.x * 3.3 + s2 * 7 + k * 11 + v) < 0.45;
          const ww = shop && k !== 1 ? 1.8 : 1.0;
          const wh = shop && k !== 1 ? 1.9 : 1.5;
          const y0 = shop ? 0.7 : 1.2 + s2 * 3.4;
          if (shop && k === 1) {
            body.push(box(1.1, 2.3, 0.12, x, 0, fz - 0.04, 0x4a3426));
            continue;
          }
          body.push(box(ww + 0.2, wh + 0.2, 0.1, x, y0 - 0.1, fz - 0.03, trim));
          const g = box(ww, wh, 0.1, x, y0, fz - 0.06, lighted ? LIT : GLASS);
          (lighted ? lit : body).push(g);
          body.push(box(0.05, wh, 0.12, x, y0, fz - 0.08, trim));
          body.push(box(ww + 0.3, 0.12, 0.2, x, y0 + wh + 0.1, fz - 0.08, brick ? 0xb3aa98 : trim));
        }
      }
      if (type === 3) {
        // A striped awning over the shop windows.
        const a = (v % 2 ? 0x8a3426 : 0x2f4a3b) as number;
        const n = Math.round(w / 0.55);
        for (let k = 0; k < n; k++) {
          const g = box(
            w / n,
            0.04,
            1.5,
            -w / 2 + (k + 0.5) * (w / n),
            0,
            -0.75,
            k % 2 ? 0xd9cfb4 : a,
          );
          body.push(g.rotateX(-0.32).translate(0, 3.0, fz - 0.05));
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

/** Half a telegraph pole's crossarm: its outer insulators, where the wires hang. */
export const TELEGRAPH_ARM_M = 0.6;

/** Dark glass, for a lamp that's been put out. */
const DOUSED_GLASS = 0x2a2721;

/**
 * A put-out lamp's glass (plan 08 §6): a dark copy a hair larger than the lit glass of
 * `propGeometry`, drawn over it, so the merged lit block needn't be rebuilt. In the prop's
 * own frame (the caller places it as the prop is placed). Undefined for a piece with no glass.
 */
export function dousedGlassGeometry(
  pieceId: string,
  heightM: number,
): THREE.BufferGeometry | undefined {
  const h = heightM;
  const k = 1.08;
  switch (pieceId) {
    case 'kit.gas_lamp':
      return frustum(0.18 * k, 0.12 * k, 0.42 * k, 4, 0, h - 0.5 - 0.42 * 0.04, 0, DOUSED_GLASS);
    case 'kit.lantern_hook':
      return box(0.16 * k, 0.24 * k, 0.16 * k, 0, h - 0.4 - 0.01, -0.08, DOUSED_GLASS);
    case 'kit.lantern_post':
      return box(0.18 * k, 0.26 * k, 0.18 * k, 0.3, h - 0.62 - 0.01, 0, DOUSED_GLASS);
    default:
      return undefined;
  }
}
