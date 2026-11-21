import * as THREE from 'three';
import { caveMouthBlocks, signalFeet, type PlacedPoiPiece } from '../../sim/islands/on-foot';
import { PALETTE } from '../style/palette';
import { box, frustum, gable, part, strut } from '../style/parts';

/**
 * The Phase 9 POI kits (plan 11 §2.3, §13; plan 14 §8, §13; piece P), in the quarry's
 * style and pipeline: procedural, palette-colored, merged with the rest of the zone's
 * points of interest into one toon-lit mesh. The fish camp (dock, shanties, the fish
 * house, net reels, drying racks, barrels, a hauled-out boat), the farmstead (a log cabin,
 * a barn, fields, split-rail fences, the woodpile, stumps), the trapper's cabin (its
 * stretching racks), the viewpoint (a Lake Survey signal), beach wreckage (ribs, a spar,
 * strewn planks), dig spots and blazes, boulders, and the cave mouth.
 *
 * Every builder takes a placed piece and returns parts in zone meters. In a piece's own
 * frame x is to its right, -z is out (forward), y is up from its foot (`minY`).
 */

// Timber and boards, a shade apart so a building's parts read.
const TIMBER = 0x6b5038;
const BOARDS = 0x8a7458;
const GRAY_BOARDS = PALETTE.weatheredWood;
const DARK_BOARDS = 0x5e5446;
const ROOF = 0x4a4038;
const TARPAPER = 0x34322f;
const SHAKES = 0x6a5c4c;
const DOOR = 0x3a2a1e;
const PANE = 0x2a2f33;
const ROPE = 0xb9a77f;
const LOG = 0x7d6d58;
const LOG_DARK = 0x655744;
const LOG_END = 0xb39a72;
const FIELDSTONE = 0x7d766a;
const STOVEPIPE = PALETTE.lanternBlack;
/** Tarred cotton gill net, brown-green. */
const NET = 0x5e5a48;
const NET_DARK = 0x4a4739;
const FLOAT = 0xc9b98f;
/** Barrel staves and hoops. */
const STAVE = 0x86664a;
const HOOP = 0x3a3530;
/** The Mackinaw boat's painted bottom and its gunwale. */
const BOAT = 0x3c4a44;
const BOAT_RAIL = 0xc8bfa8;
/** A weathered red barn, faded toward brown (needs Jared's eye). */
const BARN = 0x7a4434;
const BARN_TRIM = 0xb8ab90;
/** Turned earth, and the crops on it. */
const SOIL = 0x5f4c38;
const SOIL_DARK = 0x4c3c2c;
const CROPS = [SOIL_DARK, 0xa8995e, 0x5d7040, 0x948f58] as const;
const RAIL = 0x8a7f6c;
const STUMP = 0x6f5f4a;
const HIDES = [0x7a5638, 0x8f6a46, 0x5e4630] as const;
const HOOP_WILLOW = 0xa89268;
/** The survey's white target. */
const TARGET = PALETTE.towerWhite;
/** A wreck's timber: wet and dark at the keel, bleached where the sun has had it. */
const WRECK_DARK = 0x4a3f33;
const WRECK_BLEACHED = 0x9a8e7c;
const CAVE_DARK = 0x15110e;
const TURF = PALETTE.meadow;
const RAG = PALETTE.flagRed;

/** A tiny deterministic hash in [0, 1): the same scatter every time a piece is built. */
function hash(n: number): number {
  const s = Math.sin(n * 12.9898 + 4.1414) * 43758.5453;
  return s - Math.floor(s);
}

/** A seed from where a piece stands, so two barrels side by side don't match. */
const seedOf = (p: PlacedPoiPiece): number => Math.round(p.x * 3.7 + p.z * 1.3);

/** A piece's own frame: its center on its foot, turned to its bearing. */
export function orient(
  g: THREE.BufferGeometry,
  p: PlacedPoiPiece,
  y: number,
): THREE.BufferGeometry {
  g.rotateY(-p.bearing);
  return g.translate(p.x, y, p.z);
}

const framed = (p: PlacedPoiPiece, parts: THREE.BufferGeometry[]): THREE.BufferGeometry[] =>
  parts.map((g) => orient(g, p, p.minY));

/** A cylinder lying along z (local), its middle at (x, y, z). */
function lyingZ(
  r: number,
  len: number,
  sides: number,
  x: number,
  y: number,
  z: number,
  color: number,
): THREE.BufferGeometry {
  const g = part(new THREE.CylinderGeometry(r, r, len, sides, 1), color);
  g.rotateX(Math.PI / 2);
  return g.translate(x, y, z);
}

/** A cylinder lying along x (local). */
function lyingX(
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
  return g.translate(x, y, z);
}

/** A shed (single-pitch) roof over w × d, high at the back (+z), its low eave at `y`. */
function shedRoof(
  w: number,
  d: number,
  rise: number,
  y: number,
  color: number,
): THREE.BufferGeometry {
  const len = Math.hypot(d + 0.5, rise);
  const g = part(new THREE.BoxGeometry(w + 0.4, 0.1, len), color);
  g.rotateX(-Math.atan2(rise, d + 0.5));
  return g.translate(0, y + rise / 2, 0);
}

/** A door on the front face (-z) and a window beside it, for a building `d` deep. */
function frontOpenings(
  out: THREE.BufferGeometry[],
  d: number,
  doorX: number,
  windowX: number | undefined,
  y0 = 0,
): void {
  out.push(box(0.9, 1.9, 0.06, doorX, y0 + 0.05, -d / 2 - 0.03, DOOR));
  if (windowX !== undefined) out.push(box(0.7, 0.6, 0.06, windowX, y0 + 1.1, -d / 2 - 0.03, PANE));
}

// ---- The fish camp.

/** A timber dock on rock-filled cribs: planks across stringers, cribs down to the bed. */
export function dockGeometry(p: PlacedPoiPiece): THREE.BufferGeometry[] {
  const out: THREE.BufferGeometry[] = [];
  const top = p.maxY - p.minY;
  const deckT = 0.12;
  // Planks across the dock, a finger's gap between, alternating a shade.
  const plank = 0.3;
  const n = Math.max(1, Math.floor(p.depthM / plank));
  for (let k = 0; k < n; k++) {
    const z = -p.depthM / 2 + (k + 0.5) * (p.depthM / n);
    const c = hash(k * 1.7 + seedOf(p)) < 0.3 ? DARK_BOARDS : GRAY_BOARDS;
    out.push(box(p.widthM, deckT, p.depthM / n - 0.03, 0, top - deckT, z, c));
  }
  // Stringers under the deck, and the cribs: square timber boxes full of stones.
  for (const x of [-p.widthM / 2 + 0.25, 0, p.widthM / 2 - 0.25]) {
    out.push(box(0.2, 0.25, p.depthM, x, top - deckT - 0.25, 0, TIMBER));
  }
  const cribs = Math.max(2, Math.round(p.depthM / 6) + 1);
  for (let k = 0; k < cribs; k++) {
    const z = -p.depthM / 2 + 1.2 + (k / (cribs - 1)) * (p.depthM - 2.4);
    const h = top - deckT - 0.25;
    for (let c = 0; c < Math.ceil(h / 0.35); c++) {
      const y = c * 0.35;
      const color = c % 2 ? LOG_DARK : TIMBER;
      // Log courses crossing at the corners, as cribwork is built.
      if (c % 2) {
        out.push(box(0.25, 0.3, 2.2, -p.widthM / 2 + 0.6, y, z, color));
        out.push(box(0.25, 0.3, 2.2, p.widthM / 2 - 0.6, y, z, color));
      } else {
        out.push(box(p.widthM - 0.8, 0.3, 0.25, 0, y, z - 1, color));
        out.push(box(p.widthM - 0.8, 0.3, 0.25, 0, y, z + 1, color));
      }
    }
    out.push(box(p.widthM - 1.4, Math.max(0.3, h - 0.5), 1.7, 0, 0, z, FIELDSTONE));
  }
  // Mooring posts at the far end's corners.
  for (const x of [-p.widthM / 2 + 0.2, p.widthM / 2 - 0.2]) {
    out.push(frustum(0.12, 0.14, 0.9, 6, x, top, -p.depthM / 2 + 0.3, TIMBER));
  }
  return framed(p, out);
}

/** A fisherman's shanty: board walls, a shed roof, a stovepipe. */
export function shantyGeometry(p: PlacedPoiPiece): THREE.BufferGeometry[] {
  const out: THREE.BufferGeometry[] = [];
  const h = p.maxY - p.minY - 0.7;
  const { widthM: w, depthM: d } = p;
  out.push(box(w, h, d, 0, 0, 0, GRAY_BOARDS));
  // Battens on the front, so it reads as boards up close.
  for (let x = -w / 2 + 0.4; x < w / 2 - 0.2; x += 0.6) {
    out.push(box(0.06, h, 0.04, x, 0, -d / 2 - 0.02, DARK_BOARDS));
  }
  frontOpenings(out, d, -w / 4, w / 4 + 0.2);
  out.push(shedRoof(w, d, 0.7, h, p.variant === 1 ? SHAKES : TARPAPER));
  out.push(frustum(0.1, 0.1, 1.4, 6, w / 2 - 0.5, h + 0.2, d / 4, STOVEPIPE));
  out.push(frustum(0.16, 0.16, 0.08, 6, w / 2 - 0.5, h + 1.6, d / 4, STOVEPIPE));
  return framed(p, out);
}

/** The fish house: a gabled shed on low posts, a wide door, a loft hatch, fish boxes. */
export function fishHouseGeometry(p: PlacedPoiPiece): THREE.BufferGeometry[] {
  const out: THREE.BufferGeometry[] = [];
  const { widthM: w, depthM: d } = p;
  const lift = 0.45;
  const h = Math.max(2.4, p.maxY - p.minY - 1.6 - lift);
  for (const x of [-w / 2 + 0.3, w / 2 - 0.3]) {
    for (const z of [-d / 2 + 0.3, 0, d / 2 - 0.3])
      out.push(box(0.3, lift + 0.3, 0.3, x, 0, z, TIMBER));
  }
  out.push(box(w, h, d, 0, lift + 0.3, 0, BOARDS));
  for (let x = -w / 2 + 0.3; x < w / 2; x += 0.55) {
    out.push(box(0.05, h, 0.04, x, lift + 0.3, -d / 2 - 0.02, DARK_BOARDS));
  }
  out.push(gable(w, d, 1.6, 0, lift + 0.3 + h, 0, ROOF));
  // The wide sliding door on its rail, open a crack, and a ramp up to it.
  out.push(box(2.2, 2.1, 0.08, -w / 6, lift + 0.32, -d / 2 - 0.06, DARK_BOARDS));
  out.push(box(2.2, 2.1, 0.02, -w / 6 + 0.3, lift + 0.32, -d / 2 - 0.01, CAVE_DARK));
  out.push(box(3.4, 0.1, 0.12, -w / 6, lift + 2.5, -d / 2 - 0.08, STOVEPIPE));
  const ramp = part(new THREE.BoxGeometry(2, 0.1, 1.4), GRAY_BOARDS);
  ramp.rotateX(Math.atan2(lift + 0.3, 1.4));
  out.push(ramp.translate(-w / 6, (lift + 0.3) / 2, -d / 2 - 0.7));
  // A loft hatch high in the gable end.
  out.push(box(0.06, 0.9, 0.8, w / 2 + 0.03, lift + 0.3 + h - 0.2, 0, DOOR));
  out.push(box(0.06, 0.6, 0.6, -w / 2 - 0.03, lift + 1.3, d / 5, PANE));
  // Fish boxes stacked by the door.
  for (let k = 0; k < 3; k++) {
    out.push(box(0.9, 0.3, 0.55, w / 4, k * 0.31, -d / 2 - 0.5, k % 2 ? BOARDS : GRAY_BOARDS));
  }
  return framed(p, out);
}

/** A gill-net reel: a slatted drum on its axle between two trestles, the net wound on. */
export function netReelGeometry(p: PlacedPoiPiece): THREE.BufferGeometry[] {
  const out: THREE.BufferGeometry[] = [];
  const h = p.maxY - p.minY - 0.3;
  const r = Math.min(h * 0.42, p.depthM / 2);
  const axleY = 0.3 + h - r - 0.05;
  const len = p.widthM - 0.5;
  // The trestles, each an A of two legs.
  for (const sx of [-1, 1]) {
    const x = (sx * p.widthM) / 2 - sx * 0.12;
    for (const sz of [-1, 1]) {
      out.push(
        strut(
          new THREE.Vector3(x, axleY + 0.15, 0),
          new THREE.Vector3(x, 0.3, (sz * p.depthM) / 2),
          0.07,
          TIMBER,
        ),
      );
    }
    out.push(box(0.12, 0.12, p.depthM * 0.7, x, 0.75, 0, TIMBER));
  }
  out.push(lyingX(0.06, p.widthM, 6, 0, axleY, 0, TIMBER));
  // The drum: its spoked ends and the net wound thick on the slats.
  for (const sx of [-1, 1]) {
    out.push(lyingX(r, 0.08, 8, (sx * len) / 2, axleY, 0, TIMBER));
  }
  out.push(lyingX(r * 0.86, len - 0.1, 8, 0, axleY, 0, NET));
  // A few turns of net hanging loose at the bottom, with its corks.
  for (let k = 0; k < 3; k++) {
    const x = -len / 3 + (k * len) / 3;
    out.push(box(0.6, 0.5, 0.03, x, axleY - r - 0.45, -r * 0.4, NET_DARK));
    out.push(box(0.1, 0.06, 0.06, x, axleY - r - 0.48, -r * 0.4, FLOAT));
  }
  return framed(p, out);
}

/** A net-drying rack: posts in a row, two rails, nets hung over them with their floats. */
export function dryingRackGeometry(p: PlacedPoiPiece): THREE.BufferGeometry[] {
  const out: THREE.BufferGeometry[] = [];
  const h = p.maxY - p.minY - 0.3;
  const bays = Math.max(1, Math.round(p.widthM / 3));
  const bay = p.widthM / bays;
  for (let k = 0; k <= bays; k++) {
    const x = -p.widthM / 2 + k * bay;
    out.push(box(0.14, h + 0.3, 0.14, x, 0, 0, TIMBER));
  }
  for (const y of [h * 0.55, h]) out.push(lyingX(0.05, p.widthM, 5, 0, 0.3 + y, 0, TIMBER));
  for (let k = 0; k < bays; k++) {
    const x = -p.widthM / 2 + (k + 0.5) * bay;
    // Each bay's net hung double over the top rail, sagging, a gap here and there.
    if (hash(k + seedOf(p)) < 0.15) continue;
    const drop = h * (0.7 + hash(k * 3 + seedOf(p)) * 0.2);
    for (const sz of [-1, 1]) {
      const net = part(new THREE.BoxGeometry(bay - 0.25, drop, 0.02), k % 2 ? NET : NET_DARK);
      net.rotateX(sz * 0.08);
      out.push(net.translate(x, 0.3 + h - drop / 2, sz * 0.08));
    }
    for (let f = 0; f < 3; f++) {
      out.push(box(0.12, 0.07, 0.07, x - bay / 3 + (f * bay) / 3, 0.3 + h - 0.05, -0.1, FLOAT));
    }
  }
  return framed(p, out);
}

/** Barrels and half-barrels huddled in the piece's rectangle, one lying on its side. */
export function barrelsGeometry(p: PlacedPoiPiece): THREE.BufferGeometry[] {
  const out: THREE.BufferGeometry[] = [];
  const s = seedOf(p);
  const step = 0.7;
  const nx = Math.max(1, Math.floor(p.widthM / step));
  const nz = Math.max(1, Math.floor(p.depthM / step));
  const tall = Math.min(0.95, p.maxY - p.minY - 0.3);
  for (let i = 0; i < nx; i++) {
    for (let j = 0; j < nz; j++) {
      const k = i * 7 + j * 13 + s;
      if (hash(k) < 0.2) continue;
      const x = -p.widthM / 2 + (i + 0.5) * (p.widthM / nx) + (hash(k + 1) - 0.5) * 0.1;
      const z = -p.depthM / 2 + (j + 0.5) * (p.depthM / nz) + (hash(k + 2) - 0.5) * 0.1;
      const h = hash(k + 3) < 0.35 ? tall * 0.55 : tall;
      if (i === nx - 1 && j === 0 && nx * nz > 2) {
        // One lying on its side, staves to the sky.
        out.push(lyingZ(0.3, 0.85, 8, x, 0.3 + 0.3, z, STAVE));
        out.push(lyingZ(0.31, 0.05, 8, x, 0.6, z - 0.28, HOOP));
        out.push(lyingZ(0.31, 0.05, 8, x, 0.6, z + 0.28, HOOP));
        continue;
      }
      out.push(frustum(0.27, 0.27, h, 8, x, 0.3, z, STAVE));
      for (const f of [0.18, 0.82]) out.push(frustum(0.28, 0.28, 0.05, 8, x, 0.3 + h * f, z, HOOP));
      out.push(
        frustum(0.24, 0.24, 0.02, 8, x, 0.3 + h, z, hash(k + 4) < 0.5 ? BOARDS : DARK_BOARDS),
      );
    }
  }
  return framed(p, out);
}

/** A Mackinaw boat (a double-ender) hauled out and turned over on two blocks. */
export function boatGeometry(p: PlacedPoiPiece): THREE.BufferGeometry[] {
  const out: THREE.BufferGeometry[] = [];
  const len = p.depthM;
  const beam = p.widthM;
  const y = 0.3 + 0.35;
  // Two half-cones back to back, the round side up: pointed at both ends.
  for (const sz of [-1, 1]) {
    const half = part(
      new THREE.CylinderGeometry(0.05, beam / 2, len / 2, 10, 1, false, Math.PI / 2, Math.PI),
      BOAT,
    );
    half.rotateX((sz * Math.PI) / 2);
    half.rotateZ(Math.PI / 2);
    half.scale(1, Math.min(1, (p.maxY - p.minY - 0.65) / (beam / 2)), 1);
    out.push(half.translate(0, y, (sz * len) / 4));
  }
  // The gunwale's pale rail along the ground line, and the blocks she rests on.
  for (const sx of [-1, 1]) {
    out.push(box(0.08, 0.1, len * 0.8, (sx * beam) / 2 - sx * 0.08, y - 0.05, 0, BOAT_RAIL));
  }
  for (const z of [-len / 4, len / 4]) out.push(box(beam * 0.9, 0.35, 0.35, 0, 0.3, z, TIMBER));
  // Her oars, laid beside her.
  out.push(lyingZ(0.04, len * 0.7, 4, beam / 2 + 0.3, 0.33, 0, BOARDS));
  out.push(lyingZ(0.04, len * 0.7, 4, beam / 2 + 0.45, 0.33, 0.2, BOARDS));
  return framed(p, out);
}

// ---- The farmstead and the trapper's cabin.

/**
 * A log cabin: notched courses, a gable roof over the long side, a door and a window in
 * front. A settler's (variant 0) has a fieldstone chimney at one end; a trapper's
 * (variant 1) a stovepipe and a lean-to of poles and shakes along one side.
 */
export function cabinGeometry(p: PlacedPoiPiece): THREE.BufferGeometry[] {
  const out: THREE.BufferGeometry[] = [];
  const { widthM: w, depthM: d } = p;
  const trapper = p.variant === 1;
  const rise = Math.min(d * 0.35, 1.6);
  const h = Math.max(1.8, p.maxY - p.minY - rise);
  const course = 0.3;
  const n = Math.max(2, Math.round((h - 0.3) / course));
  out.push(box(w + 0.2, 0.3, d + 0.2, 0, 0, 0, FIELDSTONE));
  for (let k = 0; k < n; k++) {
    const y = 0.3 + k * course;
    const color = k % 2 ? LOG : LOG_DARK;
    // The long walls run past the corners on odd courses, the ends on even: the notching.
    const over = 0.35;
    if (k % 2) {
      for (const sz of [-1, 1])
        out.push(box(w + over, course, 0.28, 0, y, (sz * (d - 0.28)) / 2, color));
      for (const sx of [-1, 1])
        out.push(box(0.28, course, d - 0.56, (sx * (w - 0.28)) / 2, y, 0, color));
    } else {
      for (const sz of [-1, 1])
        out.push(box(w - 0.56, course, 0.28, 0, y, (sz * (d - 0.28)) / 2, color));
      for (const sx of [-1, 1])
        out.push(box(0.28, course, d + over, (sx * (w - 0.28)) / 2, y, 0, color));
    }
  }
  const top = 0.3 + n * course;
  // The inside, dark behind the door and the window, so they read as openings.
  out.push(box(w - 0.6, top - 0.3, d - 0.6, 0, 0.3, 0, CAVE_DARK));
  out.push(gable(w, d, rise, 0, top, 0, trapper ? SHAKES : ROOF));
  // Log ends showing at the corners.
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      out.push(box(0.3, top - 0.3, 0.3, (sx * (w + 0.1)) / 2, 0.3, (sz * (d + 0.1)) / 2, LOG_END));
    }
  }
  frontOpenings(out, d, -w / 5, w / 4, 0.3);
  out.push(box(0.08, 0.25, 0.9, -w / 5, 0.05, -d / 2 - 0.5, TIMBER));
  if (trapper) {
    out.push(frustum(0.1, 0.1, rise + 0.9, 6, w / 4, top, d / 4, STOVEPIPE));
    // The lean-to along the +x end: poles and a shake roof over the firewood.
    const lw = 1.6;
    for (const z of [-d / 2 + 0.2, d / 2 - 0.2]) {
      out.push(box(0.12, top - 0.4, 0.12, w / 2 + lw, 0, z, TIMBER));
    }
    const lean = part(new THREE.BoxGeometry(lw + 0.4, 0.08, d + 0.3), SHAKES);
    lean.rotateZ(-Math.atan2(0.6, lw));
    out.push(lean.translate(w / 2 + lw / 2, top - 0.1, 0));
    for (let k = 0; k < 3; k++) {
      out.push(lyingZ(0.12, d - 0.8, 5, w / 2 + 0.4 + k * 0.32, 0.12 + (k % 2) * 0.1, 0, LOG));
    }
  } else {
    out.push(box(1.2, top + rise + 0.6, 0.9, w / 2 + 0.3, 0, 0, FIELDSTONE));
    out.push(box(0.9, 0.3, 0.7, w / 2 + 0.3, top + rise + 0.6, 0, 0x5d5850));
  }
  return framed(p, out);
}

/** A board-and-batten barn: stone footing, big doors with their X braces, a hay door. */
export function barnGeometry(p: PlacedPoiPiece): THREE.BufferGeometry[] {
  const out: THREE.BufferGeometry[] = [];
  const { widthM: w, depthM: d } = p;
  const rise = d * 0.42;
  const h = Math.max(3, p.maxY - p.minY - rise);
  out.push(box(w + 0.2, 0.5, d + 0.2, 0, 0, 0, FIELDSTONE));
  out.push(box(w, h - 0.5, d, 0, 0.5, 0, BARN));
  for (const sz of [-1, 1]) {
    for (let x = -w / 2 + 0.3; x < w / 2; x += 0.7) {
      out.push(box(0.07, h - 0.5, 0.04, x, 0.5, (sz * (d + 0.04)) / 2, 0x693a2c));
    }
  }
  out.push(gable(w, d, rise, 0, h, 0, ROOF));
  // The big doors in front, white-framed with their X braces.
  const dw = Math.min(3.6, w * 0.4);
  const dh = Math.min(3.2, h - 0.8);
  out.push(box(dw, dh, 0.08, 0, 0.5, -d / 2 - 0.05, 0x6a382a));
  for (const sx of [-1, 1]) {
    const x0 = (sx * dw) / 4;
    out.push(
      strut(
        new THREE.Vector3(x0 - dw / 4 + 0.1, 0.6, -d / 2 - 0.11),
        new THREE.Vector3(x0 + dw / 4 - 0.1, 0.5 + dh - 0.1, -d / 2 - 0.11),
        0.05,
        BARN_TRIM,
      ),
      strut(
        new THREE.Vector3(x0 + dw / 4 - 0.1, 0.6, -d / 2 - 0.11),
        new THREE.Vector3(x0 - dw / 4 + 0.1, 0.5 + dh - 0.1, -d / 2 - 0.11),
        0.05,
        BARN_TRIM,
      ),
    );
  }
  out.push(box(dw + 0.3, 0.12, 0.1, 0, 0.5 + dh, -d / 2 - 0.08, BARN_TRIM));
  out.push(box(0.12, dh, 0.1, 0, 0.5, -d / 2 - 0.1, BARN_TRIM));
  // The hay door high in the gable end, and the hay hood's beam over it.
  out.push(box(0.08, 1.2, 1.2, w / 2 + 0.04, h - 0.6, 0, DOOR));
  out.push(box(0.9, 0.18, 0.18, w / 2 + 0.4, h + rise * 0.55, 0, TIMBER));
  // A small window on the side for the stalls.
  out.push(box(0.06, 0.5, 0.7, -w / 2 - 0.03, 1.6, d / 4, PANE));
  return framed(p, out);
}

/** A field's height at (right, out) in its own frame, from its drape grid. */
function drapeAt(p: PlacedPoiPiece, r: number, o: number): number {
  const dr = p.drape;
  if (!dr) return p.minY;
  const fi = Math.min(dr.nx - 1, Math.max(0, (r / p.widthM + 0.5) * (dr.nx - 1)));
  const fj = Math.min(dr.nz - 1, Math.max(0, (0.5 - o / p.depthM) * (dr.nz - 1)));
  const i = Math.min(dr.nx - 2, Math.floor(fi));
  const j = Math.min(dr.nz - 2, Math.floor(fj));
  const u = fi - i;
  const v = fj - j;
  const at = (a: number, b: number): number => dr.heights[b * dr.nx + a] ?? p.minY;
  const h0 = at(i, j) * (1 - u) + at(i + 1, j) * u;
  const h1 = at(i, j + 1) * (1 - u) + at(i + 1, j + 1) * u;
  return h0 * (1 - v) + h1 * v;
}

/**
 * A field laid over the ground: dark soil, and rows a meter apart running along its depth
 * (furrows when plowed, oats, potatoes or hay by its variant). Zone meters directly.
 */
export function fieldGeometry(p: PlacedPoiPiece): THREE.BufferGeometry[] {
  const pos: number[] = [];
  const col: number[] = [];
  const cos = Math.cos(p.bearing);
  const sin = Math.sin(p.bearing);
  // Local (right, out) → zone, as the sim's axes: right (cos, sin), out (sin, -cos).
  const toZone = (r: number, o: number, lift: number): [number, number, number] => [
    p.x + cos * r + sin * o,
    drapeAt(p, r, o) + lift,
    p.z + sin * r - cos * o,
  ];
  const quad = (
    a: [number, number, number],
    b: [number, number, number],
    c: [number, number, number],
    d: [number, number, number],
    color: THREE.Color,
  ): void => {
    // a b c d counter-clockwise from above, so the faces point up.
    for (const v of [a, c, b, a, d, c]) {
      pos.push(...v);
      col.push(color.r, color.g, color.b);
    }
  };
  const soil = new THREE.Color(SOIL);
  const rowColor = new THREE.Color(CROPS[p.variant ?? 0] ?? SOIL_DARK);
  const steps = Math.max(1, Math.ceil(p.depthM / 2));
  const W = p.widthM / 2;
  const D = p.depthM / 2;
  for (let j = 0; j < steps; j++) {
    const o0 = D - (j * p.depthM) / steps;
    const o1 = D - ((j + 1) * p.depthM) / steps;
    const across = Math.max(1, Math.ceil(p.widthM / 2));
    for (let i = 0; i < across; i++) {
      const r0 = -W + (i * p.widthM) / across;
      const r1 = -W + ((i + 1) * p.widthM) / across;
      quad(
        toZone(r0, o0, 0.04),
        toZone(r1, o0, 0.04),
        toZone(r1, o1, 0.04),
        toZone(r0, o1, 0.04),
        soil,
      );
    }
    const lift = p.variant === 3 ? 0.18 : p.variant ? 0.12 : 0.07;
    const half = p.variant === 3 ? 0.35 : p.variant ? 0.22 : 0.18;
    for (let r = -W + 0.5; r < W - 0.2; r += 1) {
      quad(
        toZone(r - half, o0, lift),
        toZone(r + half, o0, lift),
        toZone(r + half, o1, lift),
        toZone(r - half, o1, lift),
        rowColor,
      );
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.computeVertexNormals();
  return [g];
}

/** A split-rail ("worm") fence: rails zigzagging along its width, stacked four high. */
export function fenceGeometry(p: PlacedPoiPiece): THREE.BufferGeometry[] {
  const out: THREE.BufferGeometry[] = [];
  const h = p.maxY - p.minY - 0.3;
  const panel = 3.2;
  const n = Math.max(1, Math.round(p.widthM / panel));
  const len = p.widthM / n;
  const zig = Math.min(0.5, p.depthM / 2);
  const rails = 4;
  for (let k = 0; k < n; k++) {
    const x0 = -p.widthM / 2 + k * len;
    const z0 = k % 2 ? zig : -zig;
    const a = new THREE.Vector3(x0, 0, z0);
    const b = new THREE.Vector3(x0 + len, 0, -z0);
    for (let r = 0; r < rails; r++) {
      const y = 0.3 + 0.15 + (r * h) / rails;
      out.push(
        strut(
          a.clone().setY(y + (r % 2) * 0.06),
          b.clone().setY(y + ((r + 1) % 2) * 0.06),
          0.06,
          r % 2 ? RAIL : 0x9a8e78,
        ),
      );
    }
  }
  return framed(p, out);
}

/** Cordwood stacked between end posts, its end grain to the front. */
export function woodpileGeometry(p: PlacedPoiPiece): THREE.BufferGeometry[] {
  const out: THREE.BufferGeometry[] = [];
  const h = p.maxY - p.minY - 0.3;
  out.push(box(p.widthM, h, p.depthM - 0.04, 0, 0.3, 0, LOG_DARK));
  for (const sx of [-1, 1])
    out.push(box(0.12, h + 0.2, 0.12, (sx * (p.widthM + 0.12)) / 2, 0.3, 0, TIMBER));
  const r = 0.12;
  const s = seedOf(p);
  for (let y = 0.3 + r; y < 0.3 + h - r * 0.5; y += r * 1.9) {
    for (let x = -p.widthM / 2 + r; x < p.widthM / 2 - r * 0.5; x += r * 2.05) {
      const k = Math.round(x * 31 + y * 17) + s;
      const end = part(new THREE.CircleGeometry(r * (0.85 + hash(k) * 0.2), 5), LOG_END);
      end.rotateY(Math.PI);
      out.push(end.translate(x, y, -p.depthM / 2 - 0.005));
    }
  }
  // A chopping block and an axe in it.
  out.push(frustum(0.28, 0.3, 0.55, 7, p.widthM / 2 + 0.7, 0.3, -p.depthM / 2 - 0.4, STUMP));
  out.push(box(0.05, 0.6, 0.05, p.widthM / 2 + 0.75, 0.75, -p.depthM / 2 - 0.4, BOARDS));
  return framed(p, out);
}

/** Stumps left in a clearing, each standing where the sim put it (zone meters). */
export function stumpsGeometry(p: PlacedPoiPiece): THREE.BufferGeometry[] {
  const out: THREE.BufferGeometry[] = [];
  for (const [k, s] of (p.posts ?? []).entries()) {
    const h = 0.35 + hash(k + seedOf(p)) * 0.3;
    out.push(frustum(s.r * 0.9, s.r * 1.15, h + 0.3, 7, s.x, s.y - 0.3, s.z, STUMP));
    const top = part(new THREE.CircleGeometry(s.r * 0.85, 7), LOG_END);
    top.rotateX(-Math.PI / 2);
    out.push(top.translate(s.x, s.y + h + 0.005, s.z));
  }
  return out;
}

/** A pelt-stretching rack: a pole frame with beaver hides on their willow hoops. */
export function hideRackGeometry(p: PlacedPoiPiece): THREE.BufferGeometry[] {
  const out: THREE.BufferGeometry[] = [];
  const h = p.maxY - p.minY - 0.3;
  for (const sx of [-1, 1]) out.push(box(0.1, h, 0.1, (sx * p.widthM) / 2, 0.3, 0, TIMBER));
  out.push(lyingX(0.05, p.widthM + 0.3, 5, 0, 0.3 + h - 0.05, 0, TIMBER));
  out.push(lyingX(0.05, p.widthM + 0.3, 5, 0, 0.3 + h * 0.3, 0, TIMBER));
  const n = Math.max(1, Math.floor(p.widthM / 0.95));
  for (let k = 0; k < n; k++) {
    const x = -p.widthM / 2 + (k + 0.5) * (p.widthM / n);
    const r = Math.min(0.42, (h * 0.6) / 2);
    const y = 0.3 + h * 0.65;
    const hoop = part(new THREE.CircleGeometry(r, 9), HOOP_WILLOW);
    hoop.rotateY(Math.PI);
    out.push(hoop.translate(x, y, -0.03));
    const hide = part(new THREE.CircleGeometry(r * 0.86, 8), HIDES[k % HIDES.length] ?? STUMP);
    hide.rotateY(Math.PI);
    hide.scale(1, 1.1, 1);
    out.push(hide.translate(x, y, -0.05));
    // The back faces too, so they read from behind.
    const back = part(new THREE.CircleGeometry(r, 9), HOOP_WILLOW);
    out.push(back.translate(x, y, -0.01));
  }
  return framed(p, out);
}

// ---- The viewpoint.

/**
 * A Lake Survey signal: three legs to a head, a ring of braces, and the white target
 * boards with a pole and pennant over them.
 */
export function signalGeometry(p: PlacedPoiPiece): THREE.BufferGeometry[] {
  const out: THREE.BufferGeometry[] = [];
  const h = p.maxY - p.minY - 0.3;
  const head = new THREE.Vector3(0, 0.3 + h * 0.78, 0);
  // Its feet in the sim's frame: right is x, out is -z.
  const feet = signalFeet(p.widthM).map((f) => new THREE.Vector3(f.right, 0.3, -f.out));
  for (const f of feet) out.push(strut(f, head, 0.09, TIMBER));
  for (let k = 0; k < 3; k++) {
    const a = feet[k];
    const b = feet[(k + 1) % 3];
    if (!a || !b) continue;
    const lerp = (v: THREE.Vector3, t: number): THREE.Vector3 => v.clone().lerp(head, t);
    out.push(strut(lerp(a, 0.4), lerp(b, 0.4), 0.05, TIMBER));
  }
  // The target: two crossed white boards, then the pole and its pennant.
  out.push(box(1.4, 0.9, 0.06, 0, head.y + 0.1, 0, TARGET));
  out.push(box(0.06, 0.9, 1.4, 0, head.y + 0.1, 0, TARGET));
  out.push(frustum(0.05, 0.06, h * 0.22 + 0.4, 5, 0, head.y, 0, TIMBER));
  out.push(box(0.6, 0.3, 0.02, 0.32, head.y + h * 0.22 + 0.05, 0, RAG));
  return framed(p, out);
}

// ---- Beach wreckage.

/**
 * A wreck's bones in the sand: the keel along the piece's depth, half-buried, and her
 * frames curving up from it either side, some broken off short, the stem standing at the
 * far end.
 */
export function ribsGeometry(p: PlacedPoiPiece): THREE.BufferGeometry[] {
  const out: THREE.BufferGeometry[] = [];
  const h = p.maxY - p.minY - 0.3;
  const half = p.widthM / 2;
  const s = seedOf(p);
  out.push(box(0.35, 0.35, p.depthM * 0.92, 0, 0.15, 0, WRECK_DARK));
  const frames = Math.max(3, Math.floor(p.depthM / 0.9));
  for (let k = 0; k < frames; k++) {
    const z = -p.depthM * 0.42 + (k / (frames - 1)) * p.depthM * 0.84;
    // The hull narrows toward both ends.
    const t = Math.abs(k / (frames - 1) - 0.5) * 2;
    const beam = half * (1 - 0.55 * t * t);
    for (const sx of [-1, 1]) {
      const kk = k * 2 + (sx > 0 ? 1 : 0) + s;
      const keep = hash(kk);
      if (keep < 0.18) continue;
      const tall = h * (keep < 0.45 ? 0.45 : 0.75 + hash(kk + 1) * 0.25) * (1 - 0.3 * t);
      // Three segments: out along the floor, round the bilge, up the side.
      const pts = [
        new THREE.Vector3(0, 0.35, z),
        new THREE.Vector3(sx * beam * 0.7, 0.3 + tall * 0.15, z),
        new THREE.Vector3(sx * beam, 0.3 + tall * 0.5, z),
        new THREE.Vector3(sx * beam * 1.05, 0.3 + tall, z),
      ];
      const color = keep > 0.6 ? WRECK_BLEACHED : WRECK_DARK;
      for (let i = 0; i < 3; i++) {
        const a = pts[i];
        const b = pts[i + 1];
        if (a && b) out.push(strut(a, b, 0.11, color));
      }
    }
  }
  // The stem post, raking up at the out end, and a strake or two still on the frames.
  out.push(
    strut(
      new THREE.Vector3(0, 0.3, -p.depthM * 0.46),
      new THREE.Vector3(0, 0.3 + h, -p.depthM * 0.56),
      0.16,
      WRECK_DARK,
    ),
  );
  for (const sx of [-1, 1]) {
    out.push(
      box(
        0.08,
        0.28,
        p.depthM * 0.45,
        sx * half * 0.78,
        0.3 + h * 0.18,
        -p.depthM * 0.1,
        WRECK_BLEACHED,
      ),
    );
  }
  return framed(p, out);
}

/** A broken spar on the beach, with a crosstree, a block and a snarl of its rigging. */
export function sparGeometry(p: PlacedPoiPiece): THREE.BufferGeometry[] {
  const out: THREE.BufferGeometry[] = [];
  const r = Math.min(0.22, (p.maxY - p.minY - 0.3) / 2);
  const y = 0.3 + r * 0.8;
  out.push(lyingZ(r, p.depthM, 8, 0, y, 0, WRECK_BLEACHED));
  // The jagged broken end.
  const end = part(new THREE.ConeGeometry(r, 0.5, 8), WRECK_DARK);
  end.rotateX(-Math.PI / 2);
  out.push(end.translate(0, y, -p.depthM / 2 - 0.2));
  // The crosstree near the head, and a block.
  out.push(box(p.widthM, 0.12, 0.2, 0, y - 0.06, p.depthM * 0.35, WRECK_DARK));
  out.push(box(0.25, 0.35, 0.2, 0.4, 0.3, p.depthM * 0.2, TIMBER));
  // Rigging trailing off it.
  const s = seedOf(p);
  for (let k = 0; k < 3; k++) {
    const z = p.depthM * (0.35 - k * 0.2);
    out.push(
      strut(
        new THREE.Vector3(0, y + r, z),
        new THREE.Vector3((hash(s + k) - 0.3) * p.widthM, 0.32, z - 1 - hash(s + k + 3)),
        0.025,
        ROPE,
      ),
    );
  }
  return framed(p, out);
}

/** Planks and wreck timber strewn over the piece's rectangle, lying on the sand. */
export function planksGeometry(p: PlacedPoiPiece): THREE.BufferGeometry[] {
  const out: THREE.BufferGeometry[] = [];
  const s = seedOf(p);
  const n = Math.max(3, Math.round((p.widthM * p.depthM) / 4));
  for (let k = 0; k < n; k++) {
    const len = 1.2 + hash(s + k * 5) * 2.4;
    const w = 0.18 + hash(s + k * 7) * 0.14;
    const g = part(
      new THREE.BoxGeometry(w, 0.06, len),
      hash(s + k) < 0.5 ? WRECK_BLEACHED : hash(s + k) < 0.8 ? GRAY_BOARDS : WRECK_DARK,
    );
    g.rotateY(hash(s + k * 3) * Math.PI);
    g.rotateZ((hash(s + k * 11) - 0.5) * 0.15);
    g.translate(
      (hash(s + k * 13) - 0.5) * p.widthM,
      0.3 + 0.03 + (k % 3) * 0.04,
      (hash(s + k * 17) - 0.5) * p.depthM,
    );
    out.push(g);
  }
  return framed(p, out);
}

// ---- Cairns, dig spots and marks.

/** A dig spot: a hump of turned earth, a pit beside it, and a blazed stake with a rag. */
export function digGeometry(p: PlacedPoiPiece): THREE.BufferGeometry[] {
  const out: THREE.BufferGeometry[] = [];
  const mound = part(new THREE.DodecahedronGeometry(0.5, 0), SOIL);
  mound.scale(p.widthM, 0.35, p.depthM * 0.8);
  out.push(mound.translate(0.15, 0.3, 0.1));
  const pit = part(new THREE.CircleGeometry(p.widthM * 0.28, 7), SOIL_DARK);
  pit.rotateX(-Math.PI / 2);
  out.push(pit.translate(-p.widthM * 0.25, 0.33, -p.depthM * 0.15));
  out.push(box(0.07, 1.0, 0.07, p.widthM / 2 + 0.1, 0.3, -p.depthM / 2, LOG_END));
  out.push(box(0.04, 0.25, 0.25, p.widthM / 2 + 0.15, 1.0, -p.depthM / 2, RAG));
  return framed(p, out);
}

/** A blazed post: a peeled marker post with an axe-cut blaze near its top. */
export function blazeGeometry(p: PlacedPoiPiece): THREE.BufferGeometry[] {
  const h = p.maxY - p.minY;
  return framed(p, [
    frustum(0.09, 0.11, h, 6, 0, 0, 0, TIMBER),
    box(0.14, 0.3, 0.05, 0, h - 0.6, -0.08, LOG_END),
  ]);
}

/** A tumbled boulder of shore rock: a squashed many-sided stone, tinted by where it lies. */
export function boulderGeometry(p: PlacedPoiPiece): THREE.BufferGeometry[] {
  const h = p.maxY - p.minY;
  const s = seedOf(p);
  const color = hash(s) < 0.5 ? PALETTE.shoreRock : PALETTE.sandstoneDark;
  const g = part(new THREE.DodecahedronGeometry(0.5, 0), color);
  g.rotateY(hash(s + 1) * Math.PI);
  g.scale(p.widthM, h, p.depthM);
  return [orient(g.translate(0, h * 0.45, 0), p, p.minY)];
}

// ---- The cave mouth.

/** A cave mouth: its blocks in bedded sandstone, a turf cap, and the dark going in. */
export function caveMouthGeometry(p: PlacedPoiPiece): THREE.BufferGeometry[] {
  const out: THREE.BufferGeometry[] = [];
  const bed = 1.1;
  for (const b of caveMouthBlocks(p)) {
    if (b.dark) {
      out.push(box(b.w, b.y1 - b.y0, b.d, b.right, b.y0, -b.out, CAVE_DARK));
      continue;
    }
    // Courses of the two sandstone tones, set back a hand's width every other bed.
    let y = b.y0;
    while (y < b.y1 - 1e-3) {
      const k = Math.floor(y / bed);
      const top = Math.min(b.y1, (k + 1) * bed);
      const inset = (k % 2) * 0.1;
      const color = k % 2 ? PALETTE.sandstoneDark : PALETTE.sandstone;
      out.push(box(b.w - inset * 0.5, top - y, b.d - inset, b.right, y, -b.out, color));
      y = top;
    }
  }
  // The passage's lining: dark walls and a dark roof, just inside the opening.
  const W = p.widthM;
  const D = p.depthM;
  const H = p.maxY - p.minY;
  const mouth = caveMouthBlocks(p)[2];
  const ow = mouth?.w ?? W * 0.4;
  const oh = mouth?.y0 ?? H * 0.6;
  const inner = D - 0.8;
  for (const sx of [-1, 1]) {
    out.push(
      box(0.02, oh, inner * 0.8, sx * (ow / 2 - 0.01), 0, D / 2 - inner * 0.5 - 0.2, CAVE_DARK),
    );
  }
  out.push(box(ow, 0.02, inner * 0.8, 0, oh - 0.56, D / 2 - inner * 0.5 - 0.2, CAVE_DARK));
  // Its floor, unless it opens into a cave (piece S), whose own floor runs out through it.
  if (!p.open) {
    out.push(box(ow, 0.02, inner - 0.2, 0, 0.32, D / 2 - inner * 0.5 - 0.2, PALETTE.wetRock));
  }
  // Turf and moss over the top, hanging a little over the face.
  out.push(box(W + 0.4, 0.25, D + 0.3, 0, H, 0, TURF));
  return framed(p, out);
}

// ---- Lit windows (Phase 9 piece Q).

const LAMPLIGHT = PALETTE.windowAmber;

/**
 * The glass of a lived-in cabin, shanty or fish house lit from inside: a pane over each
 * window the kit draws dark, a hair proud of it, for the evening's glow mesh. Nothing for
 * a building nobody lives in.
 */
export function litWindowsGeometry(p: PlacedPoiPiece): THREE.BufferGeometry[] {
  if (!p.lit) return [];
  const { widthM: w, depthM: d } = p;
  switch (p.kind) {
    case 'shanty':
      return framed(p, [box(0.62, 0.52, 0.04, w / 4 + 0.2, 1.14, -d / 2 - 0.07, LAMPLIGHT)]);
    case 'cabin':
      return framed(p, [box(0.62, 0.52, 0.04, w / 4, 1.44, -d / 2 - 0.07, LAMPLIGHT)]);
    case 'fish_house':
      return framed(p, [box(0.04, 0.52, 0.52, -w / 2 - 0.07, 0.45 + 1.34, d / 5, LAMPLIGHT)]);
    default:
      return [];
  }
}
