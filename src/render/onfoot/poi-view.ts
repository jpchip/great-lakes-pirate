import * as THREE from 'three';
import type { PlacedIsland, PlacedPoiPiece } from '../../sim/islands/on-foot';
import { PALETTE } from '../style/palette';
import { box, frustum, gable, merged, part, strut } from '../style/parts';
import { createStylizedMaterial, type StyleLighting } from '../style/stylized-material';

/**
 * The walkable islands' points of interest drawn (plan 11 §3.1 POI kits; plan 08 §20.4
 * piece H): Stockton's brownstone quarry, its spoil wharf, cut ledges, block piles,
 * derrick and office shack, and the cache cairns. Every island of the zone in one merged,
 * toon-lit mesh: a draw call, seen from the deck as well as on foot.
 */

export interface PoiView {
  readonly group: THREE.Group;
  readonly triangles: number;
  dispose(): void;
}

const TIMBER = 0x6b5038;
const BOARDS = 0x8a7458;
const ROOF = 0x4a4038;
const ROPE = 0xb9a77f;
const CAIRN_STONE = 0x8d8576;

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
  for (const [x, z, s, y] of stones) {
    const g = part(new THREE.DodecahedronGeometry(s / 2, 0), CAIRN_STONE);
    g.scale(1, 0.75, 1);
    g.translate(x, y + s * 0.3, z);
    out.push(orient(g, p, p.minY + 0.3));
  }
  return out;
}

export function islandPiecesGeometry(islands: readonly PlacedIsland[]): THREE.BufferGeometry[] {
  const parts: THREE.BufferGeometry[] = [];
  for (const island of islands) {
    for (const p of island.pieces) {
      if (p.kind === 'ledge') parts.push(...ledgeGeometry(p));
      else if (p.kind === 'derrick') parts.push(...derrickGeometry(p));
      else if (p.kind === 'shack') parts.push(...shackGeometry(p));
      else if (p.kind === 'block') parts.push(...blockGeometry(p));
      else parts.push(...cairnGeometry(p));
    }
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
  return {
    group,
    triangles,
    dispose() {
      geometry?.dispose();
      material?.dispose();
    },
  };
}
