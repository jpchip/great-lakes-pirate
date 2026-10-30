import * as THREE from 'three';
import type { HarborLayout, PlacedBuilding, PlacedPier } from '../../sim/harbors';
import { PALETTE } from '../style/palette';
import { box, frustum, gable, merged, part, strut } from '../style/parts';

/**
 * The harbor kit (plan 03 §3.4, plan 14 §8; Phase 2 piece G): piers, Ashland's ore dock and
 * the waterfront and town buildings, all at 1:1, merged per harbor into a body mesh and a
 * lit-windows mesh. Plank piers stand on piles down to the real seabed; the ore dock is a
 * timber trestle with its pocket body and chutes, climbing to the land on an approach.
 * Buildings are boxes with gable roofs, each kind with its own touch: the sawmill's stack
 * and sawdust burner, the church steeple, the store's false front.
 */

/** House paints, 1900 small-town: white lead, cream, red ochre, weathered and gray-green. */
const PAINTS = [0xe2dccb, 0xd5c59c, 0x8e4a35, 0x8b857a, 0x7d8a78, 0xb59a5c] as const;
const ROOFS = [PALETTE.roofGray, 0x5a4636, 0x3a3a38] as const;
const DECK = 0x6b5643;
const PILE = 0x3d3229;
const ORE_TIMBER = 0x5b4636;
const ORE_STAIN = 0x7a3d2a;
const DARK_GLASS = 0x2a3036;
const FOUNDATION = PALETTE.slopeRock;

export interface HarborParts {
  body: THREE.BufferGeometry;
  /** Windows lit at night (about half of them). */
  litWindows: THREE.BufferGeometry;
  triangles: number;
}

interface Sink {
  body: THREE.BufferGeometry[];
  lit: THREE.BufferGeometry[];
}

/** Moves parts built in a local frame (front toward -z) to the world. */
function toWorld(
  parts: THREE.BufferGeometry[],
  x: number,
  y: number,
  z: number,
  facing: number,
): void {
  for (const g of parts) g.rotateY(-facing).translate(x, y, z);
}

// --- Buildings ----------------------------------------------------------------------

/** Windows along one wall: `wall` is 'front' (z = -d/2) or 'back'. */
function windows(
  out: Sink,
  b: PlacedBuilding,
  w: number,
  d: number,
  rows: number[],
  spacing: number,
  salt: number,
): void {
  const n = Math.max(1, Math.floor((w - 2) / spacing));
  for (const wall of [-1, 1]) {
    for (const [r, y] of rows.entries()) {
      for (let i = 0; i < n; i++) {
        const x = (i - (n - 1) / 2) * spacing;
        const lit = hash(b.seed * 9973 + salt + wall * 31 + r * 7 + i) < 0.55;
        const g = box(
          0.9,
          1.3,
          0.12,
          x,
          y,
          wall * (d / 2 + 0.04),
          lit ? PALETTE.windowAmber : DARK_GLASS,
        );
        (lit ? out.lit : out.body).push(g);
      }
    }
  }
}

function hash(n: number): number {
  const s = Math.sin(n * 12.9898) * 43758.5453;
  return s - Math.floor(s);
}

function building(b: PlacedBuilding, out: Sink): void {
  const local: Sink = { body: [], lit: [] };
  const { widthM: w, depthM: d, heightM: h } = b;
  const paint = PAINTS[Math.floor(b.seed * PAINTS.length) % PAINTS.length] as number;
  const roof = ROOFS[Math.floor(b.seed * 7) % ROOFS.length] as number;
  const sink = local.body;
  // A foundation down to the lowest ground, so a house on a slope doesn't float.
  const drop = b.floorM - b.footM + 0.4;
  sink.push(box(w + 0.4, drop, d + 0.4, 0, -drop, 0, FOUNDATION));
  switch (b.kind) {
    case 'packingHouse': {
      sink.push(box(w, h, d, 0, 0, 0, 0xc9bfa6));
      sink.push(gable(d, w, h * 0.35, 0, h, 0, ROOFS[0]).rotateY(Math.PI / 2));
      // A cupola for the drying lofts.
      sink.push(box(2.4, 1.6, 2.4, 0, h + h * 0.35 - 0.4, 0, 0xc9bfa6));
      windows(local, b, w, d, [1.6, 4.4], 3.2, 1);
      break;
    }
    case 'cooperage':
    case 'warehouse':
    case 'fishShed': {
      const shed = b.kind === 'warehouse' ? 0x8b7a66 : b.kind === 'fishShed' ? 0x7d6f5f : 0x9a8468;
      sink.push(box(w, h, d, 0, 0, 0, shed));
      sink.push(gable(w, d, Math.min(3, d * 0.25), 0, h, 0, roof));
      if (b.kind === 'cooperage') sink.push(box(1, 3, 1, w * 0.3, h, d * 0.2, PALETTE.brick));
      windows(local, b, w, d, [1.6], 4, 2);
      break;
    }
    case 'sawmill': {
      sink.push(box(w, h, d, 0, 0, 0, 0x8a7258));
      sink.push(gable(w, d, 3, 0, h, 0, roof));
      // The boiler stack and the sawdust burner beside the mill.
      sink.push(frustum(0.7, 0.8, h + 12, 8, -w * 0.3, 0, d * 0.25, 0x3a3634));
      sink.push(frustum(2.2, 4.2, 9, 10, w / 2 + 6, 0, 0, 0x4a4542));
      sink.push(frustum(1.4, 2.2, 1.2, 10, w / 2 + 6, 9, 0, 0x2f2c2a));
      // A jack ladder up from the water for the logs.
      sink.push(
        strut(
          new THREE.Vector3(0, 0.5, -d / 2 - 14),
          new THREE.Vector3(0, h * 0.7, -d / 2),
          0.6,
          DECK,
        ),
      );
      windows(local, b, w, d, [2, 5], 4, 3);
      break;
    }
    case 'store': {
      sink.push(box(w, h, d, 0, 0, 0, paint));
      // The false front: a square facade taller than the roof.
      sink.push(box(w + 0.4, h + 2.2, 0.4, 0, 0, -d / 2 - 0.2, paint));
      sink.push(gable(d, w, 2.2, 0, h, 0, roof).rotateY(Math.PI / 2));
      sink.push(box(w + 0.8, 0.25, 2.4, 0, 3, -d / 2 - 1.2, roof));
      windows(local, b, w, d, [1.5, Math.max(4.2, h - 2.4)], 2.8, 4);
      break;
    }
    case 'depot': {
      sink.push(box(w, h, d, 0, 0, 0, 0x9a6b3e));
      // A low roof with deep eaves over the platform.
      sink.push(gable(d + 4, w + 5, 2.4, 0, h, 0, 0x4a3d33).rotateY(Math.PI / 2));
      windows(local, b, w, d, [1.6], 3, 5);
      break;
    }
    case 'church': {
      sink.push(box(w, h, d, 0, 0, 0, 0xe6e0d0));
      sink.push(gable(d, w, 4, 0, h, 0, roof).rotateY(Math.PI / 2));
      sink.push(box(3.2, h + 6, 3.2, 0, 0, -d / 2 - 1.2, 0xe6e0d0));
      sink.push(
        part(new THREE.ConeGeometry(2.6, 7, 4), roof)
          .rotateY(Math.PI / 4)
          .translate(0, h + 9.5, -d / 2 - 1.2),
      );
      windows(local, b, w, d, [3], 3.4, 6);
      break;
    }
    case 'house': {
      sink.push(box(w, h, d, 0, 0, 0, paint));
      sink.push(gable(w, d, 2.4 + d * 0.12, 0, h, 0, roof));
      sink.push(box(0.9, 2.2, 0.9, w * 0.25, h + 0.8, 0, PALETTE.brick));
      windows(local, b, w, d, h > 5.6 ? [1.4, 4.2] : [1.4], 2.6, 7);
      break;
    }
  }
  toWorld(local.body, b.x, b.floorM, b.z, b.facing);
  toWorld(local.lit, b.x, b.floorM, b.z, b.facing);
  out.body.push(...local.body);
  out.lit.push(...local.lit);
}

// --- Piers --------------------------------------------------------------------------

const PILE_SPACING_M = 5;

/** A plank pier on piles. Local frame: x across, the pier running out along -z from the root. */
function plankPier(p: PlacedPier, heightAt: (x: number, z: number) => number, out: Sink): void {
  const local: THREE.BufferGeometry[] = [];
  const deck = 0.4;
  local.push(box(p.widthM, deck, p.lengthM, 0, p.deckM - deck, -p.lengthM / 2, DECK));
  const fx = Math.sin(p.bearing);
  const fz = -Math.cos(p.bearing);
  const rx = -fz;
  const rz = fx;
  for (let s = PILE_SPACING_M / 2; s <= p.lengthM; s += PILE_SPACING_M) {
    for (const side of [-1, 1]) {
      const across = side * (p.widthM / 2 - 0.25);
      const wx = p.root.x + fx * s + rx * across;
      const wz = p.root.z + fz * s + rz * across;
      const bottom = Math.min(heightAt(wx, wz), p.deckM - 1) - 1;
      const top = p.deckM - deck;
      local.push(frustum(0.22, 0.22, top - bottom, 6, across, bottom, -s, PILE));
    }
  }
  // Bollards along both edges of the outer berths, and a fish house or lumber at the end.
  for (const side of [-1, 1]) {
    for (const s of [p.lengthM - 4, p.lengthM - 30]) {
      local.push(frustum(0.25, 0.3, 0.7, 6, side * (p.widthM / 2 - 0.45), p.deckM, -s, PILE));
    }
  }
  if (p.kind === 'lumber') {
    for (let k = 0; k < 3; k++) {
      local.push(box(3.2, 2.2, 6, (k - 1) * 3.6, p.deckM, -p.shoreM - 8, 0xb59268));
    }
  }
  if (p.kind === 'fish') local.push(box(p.widthM - 2, 3, 6, 0, p.deckM, -p.lengthM + 10, 0x7d6f5f));
  for (const g of local) g.rotateY(-p.bearing).translate(p.root.x, 0, p.root.z);
  out.body.push(...local);
}

/** Bent spacing along an ore dock and its approach, meters. */
const BENT_M = 9;
/** The approach climbs this far over the land to the dock's height. */
const APPROACH_M = 140;
/** The pocket body hangs this deep below the ore dock's deck. */
const POCKETS_M = 8;

/** A wooden ore dock: trestle bents, the pocket body, chutes each side, and its approach. */
function oreDock(p: PlacedPier, heightAt: (x: number, z: number) => number, out: Sink): void {
  const local: THREE.BufferGeometry[] = [];
  const fx = Math.sin(p.bearing);
  const fz = -Math.cos(p.bearing);
  const half = p.widthM / 2;
  // The pocket body and the deck with its rails, over the water part.
  const span = p.lengthM - p.shoreM;
  local.push(
    box(p.widthM, POCKETS_M, span, 0, p.deckM - POCKETS_M, -p.shoreM - span / 2, ORE_STAIN),
  );
  local.push(box(p.widthM + 1.2, 0.6, span, 0, p.deckM, -p.shoreM - span / 2, ORE_TIMBER));
  for (const x of [-1.6, 1.6]) {
    local.push(box(0.25, 0.3, span, x, p.deckM + 0.6, -p.shoreM - span / 2, 0x2f2b28));
  }
  // Bents: a row of posts to the bottom, with a brace, every few meters.
  for (let s = -APPROACH_M + 4; s <= p.lengthM; s += BENT_M) {
    const wx = p.root.x + fx * s;
    const wz = p.root.z + fz * s;
    const ground = heightAt(wx, wz);
    // Over the land the deck climbs from the ground to full height.
    const rise =
      s < p.shoreM ? Math.max(0, Math.min(1, (s + APPROACH_M) / (APPROACH_M + p.shoreM))) : 1;
    const top = s < p.shoreM ? ground + (p.deckM - ground) * rise : p.deckM - POCKETS_M;
    const bottom = Math.min(ground, top - 0.5) - 1;
    if (top - bottom < 1) continue;
    for (const x of [-half + 0.5, -half / 3, half / 3, half - 0.5]) {
      local.push(box(0.5, top - bottom, 0.5, x, bottom, -s, ORE_TIMBER));
    }
    local.push(
      strut(
        new THREE.Vector3(-half + 0.5, bottom + 1, -s),
        new THREE.Vector3(half - 0.5, top - 0.5, -s),
        0.18,
        ORE_TIMBER,
      ),
    );
    if (s < p.shoreM)
      local.push(box(p.widthM * 0.5, 0.5, BENT_M, 0, top, -s - BENT_M / 2, ORE_TIMBER));
  }
  // Chutes, lowered toward the water each side, every few pockets.
  for (let s = p.shoreM + 6; s <= p.lengthM - 3; s += 12) {
    for (const side of [-1, 1]) {
      local.push(
        strut(
          new THREE.Vector3(side * half, p.deckM - POCKETS_M + 1, -s),
          new THREE.Vector3(side * (half + 5), p.deckM - POCKETS_M - 2.5, -s),
          0.35,
          0x3b3330,
        ),
      );
    }
  }
  for (const g of local) g.rotateY(-p.bearing).translate(p.root.x, 0, p.root.z);
  out.body.push(...local);
}

/** Builds one harbor's meshes. */
export function buildHarbor(
  layout: HarborLayout,
  heightAt: (x: number, z: number) => number,
): HarborParts {
  const sink: Sink = { body: [], lit: [] };
  for (const p of layout.piers) (p.kind === 'ore' ? oreDock : plankPier)(p, heightAt, sink);
  for (const b of layout.buildings) building(b, sink);
  const body = merged(sink.body);
  const lit = merged(sink.lit);
  const triangles = (body.getAttribute('position').count + lit.getAttribute('position').count) / 3;
  return { body, litWindows: lit, triangles };
}
