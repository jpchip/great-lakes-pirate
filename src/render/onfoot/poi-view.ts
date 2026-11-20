import * as THREE from 'three';
import type { PlacedIsland, PlacedPoiPiece } from '../../sim/islands/on-foot';
import { PALETTE } from '../style/palette';
import { box, frustum, gable, merged, part, strut } from '../style/parts';
import {
  createStylizedMaterial,
  type StyleLighting,
  type StylizedMaterial,
} from '../style/stylized-material';
import { lampLevel } from '../../sim/lighthouses';
import type { PoiPieceKind } from '../../../data/schemas/pois';
import * as kit from './poi-kit';

/**
 * The walkable islands' points of interest drawn (plan 11 §3.1 POI kits; plan 08 §20.4
 * piece H): Stockton's brownstone quarry, its spoil wharf, cut ledges, block piles,
 * derrick and office shack, and the cache cairns; and (Phase 8 piece D) the Siskiwit
 * logging camp's bunkhouse ruins, log decks and lumber piles on its mainland pad. Every island of the zone in one merged,
 * toon-lit mesh: a draw call, seen from the deck as well as on foot.
 */

export interface PoiView {
  readonly group: THREE.Group;
  readonly triangles: number;
  /** The lived-in buildings' windows glow from dusk (piece Q). */
  update(sunElevationDeg: number): void;
  dispose(): void;
}

const TIMBER = 0x6b5038;
const BOARDS = 0x8a7458;
const ROOF = 0x4a4038;
const ROPE = 0xb9a77f;
const CAIRN_STONE = 0x8d8576;
/** Peeled pine logs gone gray, and their sawn ends. */
const LOG = 0x7d6d58;
const LOG_END = 0xb39a72;
/** Sawn boards weathered on the pile, and the stickers between the courses. */
const LUMBER = 0xa08b68;
const STICKER = 0x5a4632;

/** A piece's own frame: its center on its foot, turned to its bearing. */
function orient(g: THREE.BufferGeometry, p: PlacedPoiPiece, y: number): THREE.BufferGeometry {
  g.rotateY(-p.bearing);
  return g.translate(p.x, y, p.z);
}

/** Brownstone in beds: alternating courses of the two sandstone tones up a cut face. */
function ledgeGeometry(p: PlacedPoiPiece): THREE.BufferGeometry[] {
  const parts: THREE.BufferGeometry[] = [];
  const bed = 1.1;
  let y = p.minY;
  let k = 0;
  while (y < p.maxY - 1e-3) {
    const h = Math.min(bed, p.maxY - y);
    // Each course set back a hand's width, so the cut reads as stepped beds.
    const inset = (k % 2) * 0.12;
    const color = k % 2 ? PALETTE.sandstoneDark : PALETTE.sandstone;
    parts.push(orient(box(p.widthM - inset, h, p.depthM - inset, 0, 0, 0, color), p, y));
    y += h;
    k++;
  }
  return parts;
}

function derrickGeometry(p: PlacedPoiPiece): THREE.BufferGeometry[] {
  const h = p.maxY - p.minY;
  const mast = frustum(0.16, 0.24, h, 6, 0, 0, 0, TIMBER);
  // The boom from the mast's foot out over the wharf, and the fall of rope from its end.
  const boomLen = h * 0.75;
  const boom = part(new THREE.CylinderGeometry(0.12, 0.15, boomLen, 6, 1), TIMBER);
  boom.rotateX(-Math.PI / 2 + 0.45);
  boom.translate(0, 1.2 + Math.sin(0.45) * (boomLen / 2), -Math.cos(0.45) * (boomLen / 2));
  const tipZ = -Math.cos(0.45) * boomLen;
  const tipY = 1.2 + Math.sin(0.45) * boomLen;
  const fall = frustum(0.03, 0.03, tipY - 1.5, 4, 0, 1.5, tipZ, ROPE);
  const hook = box(0.5, 0.3, 0.5, 0, 1.2, tipZ, PALETTE.sandstoneDark);
  const parts = [mast, boom, fall, hook];
  // Three guys from the masthead to stakes in the ground around it.
  const head = new THREE.Vector3(0, h - 0.3, 0);
  for (let k = 0; k < 3; k++) {
    const a = (k / 3) * Math.PI * 2 + 0.5;
    const reach = h * 0.55;
    parts.push(
      strut(head, new THREE.Vector3(Math.sin(a) * reach, 0, Math.cos(a) * reach), 0.025, ROPE),
    );
  }
  return parts.map((g) => orient(g, p, p.minY));
}

function shackGeometry(p: PlacedPoiPiece): THREE.BufferGeometry[] {
  const h = p.maxY - p.minY;
  const walls = box(p.widthM, h, p.depthM, 0, 0, 0, BOARDS);
  const door = box(0.9, 1.9, 0.06, 0, 0.1, -p.depthM / 2 - 0.02, TIMBER);
  const window = box(0.06, 0.6, 0.8, p.widthM / 2 + 0.02, 1.2, 0.6, 0x2a2f33);
  const roof = gable(p.widthM, p.depthM, 1.1, 0, h, 0, ROOF);
  return [walls, door, window, roof].map((g) => orient(g, p, p.minY));
}

function blockGeometry(p: PlacedPoiPiece): THREE.BufferGeometry[] {
  const h = p.maxY - p.minY;
  return [orient(box(p.widthM, h, p.depthM, 0, 0, 0, PALETTE.sandstone), p, p.minY)];
}

/** One stone tread of a flight of `steps`: a slab, its top at the piece's `maxY`. */
function stepsGeometry(p: PlacedPoiPiece): THREE.BufferGeometry[] {
  const h = p.maxY - p.minY;
  return [orient(box(p.widthM, h, p.depthM, 0, 0, 0, PALETTE.sandstoneDark), p, p.minY)];
}

/**
 * A log deck: logs lying along the piece's depth, stacked in courses that step in as they
 * rise, so the pile is a low pyramid to its height. Hexagonal logs keep it cheap.
 */
function logsGeometry(p: PlacedPoiPiece): THREE.BufferGeometry[] {
  const out: THREE.BufferGeometry[] = [];
  const h = p.maxY - p.minY - 0.3;
  const d = 0.5;
  const courses = Math.max(1, Math.round(h / (d * 0.87)));
  for (let c = 0; c < courses; c++) {
    const n = Math.max(1, Math.floor(p.widthM / d) - c);
    const y = 0.3 + d / 2 + c * d * 0.87;
    for (let k = 0; k < n; k++) {
      const x = (k - (n - 1) / 2) * d;
      // Logs never quite line up: a hand's width in or out, by a hash of where they lie.
      const jog = (((k * 7 + c * 13) % 5) - 2) * 0.08;
      const len = p.depthM - Math.abs(jog) * 2;
      const log = part(new THREE.CylinderGeometry(d / 2, d / 2, len, 6, 1), LOG);
      log.rotateX(Math.PI / 2);
      log.translate(x, y, jog);
      out.push(orient(log, p, p.minY));
      for (const s of [-1, 1]) {
        const end = part(new THREE.CircleGeometry(d / 2 - 0.04, 6), LOG_END);
        end.rotateY(s > 0 ? 0 : Math.PI);
        end.translate(x, y, jog + s * (len / 2 + 0.01));
        out.push(orient(end, p, p.minY));
      }
    }
  }
  return out;
}

/** Sawn lumber: courses of boards with dark stickers between them, on two skids. */
function lumberGeometry(p: PlacedPoiPiece): THREE.BufferGeometry[] {
  const out: THREE.BufferGeometry[] = [];
  const top = p.maxY - p.minY;
  for (const s of [-1, 1]) {
    out.push(box(p.widthM + 0.2, 0.25, 0.25, 0, 0.3, s * (p.depthM / 2 - 0.6), STICKER));
  }
  const course = 0.32;
  let y = 0.55;
  while (y + course <= top + 1e-3) {
    out.push(box(p.widthM, course - 0.06, p.depthM, 0, y, 0, LUMBER));
    for (const s of [-1, 0, 1]) {
      out.push(
        box(p.widthM + 0.06, 0.06, 0.12, 0, y + course - 0.06, s * (p.depthM / 2 - 0.6), STICKER),
      );
    }
    y += course;
  }
  return out.map((g) => orient(g, p, p.minY));
}

/** A log wall without its roof: courses of logs, the top one ragged where it fell in. */
function wallGeometry(p: PlacedPoiPiece): THREE.BufferGeometry[] {
  const out: THREE.BufferGeometry[] = [];
  const h = p.maxY - p.minY;
  const course = 0.3;
  const n = Math.max(1, Math.round(h / course));
  for (let k = 0; k < n; k++) {
    const color = k % 2 ? LOG : TIMBER;
    // Corner notching: alternate courses run a little past the ends.
    const over = k % 2 ? 0.25 : 0;
    out.push(box(p.widthM + over, course, p.depthM, 0, k * course, 0, color));
  }
  return out.map((g) => orient(g, p, p.minY));
}

function cairnGeometry(p: PlacedPoiPiece): THREE.BufferGeometry[] {
  const out: THREE.BufferGeometry[] = [];
  const stones: [number, number, number, number][] = [
    // x, z, size, y
    [-0.35, 0.1, 0.55, 0],
    [0.3, -0.15, 0.5, 0],
    [0.05, 0.35, 0.45, 0],
    [0, 0, 0.45, 0.35],
    [0.05, 0.05, 0.3, 0.62],
  ];
  // A cache cairn is 1.4 m across; a marker cairn (piece P) scales up from it.
  const k = p.widthM / 1.4;
  const kh = (p.maxY - p.minY - 0.3) / 0.8;
  for (const [x, z, s, y] of stones) {
    const g = part(new THREE.DodecahedronGeometry(s / 2, 0), CAIRN_STONE);
    g.scale(k, 0.75 * kh, k);
    g.translate(x * k, (y + s * 0.3) * kh, z * k);
    out.push(orient(g, p, p.minY + 0.3));
  }
  return out;
}

/** Every kind's builder: the quarry's and the logging camp's here, piece P's in the kit. */
const BUILDERS: Record<PoiPieceKind, (p: PlacedPoiPiece) => THREE.BufferGeometry[]> = {
  ledge: ledgeGeometry,
  derrick: derrickGeometry,
  shack: shackGeometry,
  block: blockGeometry,
  steps: stepsGeometry,
  logs: logsGeometry,
  lumber: lumberGeometry,
  wall: wallGeometry,
  cairn: cairnGeometry,
  dock: kit.dockGeometry,
  shanty: kit.shantyGeometry,
  fish_house: kit.fishHouseGeometry,
  net_reel: kit.netReelGeometry,
  drying_rack: kit.dryingRackGeometry,
  barrels: kit.barrelsGeometry,
  boat: kit.boatGeometry,
  cabin: kit.cabinGeometry,
  barn: kit.barnGeometry,
  field: kit.fieldGeometry,
  fence: kit.fenceGeometry,
  woodpile: kit.woodpileGeometry,
  stumps: kit.stumpsGeometry,
  hide_rack: kit.hideRackGeometry,
  signal: kit.signalGeometry,
  ribs: kit.ribsGeometry,
  spar: kit.sparGeometry,
  planks: kit.planksGeometry,
  dig: kit.digGeometry,
  blaze: kit.blazeGeometry,
  boulder: kit.boulderGeometry,
  cave_mouth: kit.caveMouthGeometry,
};

/** One placed piece's parts, zone meters. */
export function pieceGeometry(p: PlacedPoiPiece): THREE.BufferGeometry[] {
  return BUILDERS[p.kind](p);
}

export function islandPiecesGeometry(islands: readonly PlacedIsland[]): THREE.BufferGeometry[] {
  const parts: THREE.BufferGeometry[] = [];
  for (const island of islands) {
    for (const p of island.pieces) parts.push(...pieceGeometry(p));
  }
  return parts;
}

export function createPoiView(islands: readonly PlacedIsland[], lighting: StyleLighting): PoiView {
  const group = new THREE.Group();
  group.name = 'island-pois';
  const parts = islandPiecesGeometry(islands);
  let triangles = 0;
  let geometry: THREE.BufferGeometry | undefined;
  let material: THREE.Material | undefined;
  if (parts.length > 0) {
    geometry = merged(parts);
    material = createStylizedMaterial('toon', lighting, { vertexColors: true });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = 'island-pois-body';
    group.add(mesh);
    triangles = geometry.getAttribute('position').count / 3;
  }
  // Windows where someone lives (piece Q): one more mesh, lit from dusk as the towns' are.
  const panes = islands.flatMap((i) => i.pieces.flatMap(kit.litWindowsGeometry));
  let windows: THREE.BufferGeometry | undefined;
  let lit: StylizedMaterial | undefined;
  if (panes.length > 0) {
    windows = merged(panes);
    lit = createStylizedMaterial('toon', lighting, { vertexColors: true }) as StylizedMaterial;
    const mesh = new THREE.Mesh(windows, lit);
    mesh.name = 'island-pois-windows';
    group.add(mesh);
    triangles += windows.getAttribute('position').count / 3;
  }
  const glow = new THREE.Color(PALETTE.windowAmber);
  return {
    group,
    triangles,
    update(sunElevationDeg) {
      lit?.uniforms.uEmissive.value.copy(glow).multiplyScalar(0.95 * lampLevel(sunElevationDeg));
    },
    dispose() {
      geometry?.dispose();
      material?.dispose();
      windows?.dispose();
      lit?.dispose();
    },
  };
}
