import * as THREE from 'three';
import { WALL_M } from '../../sim/district/kit';
import type {
  DistrictBuilding,
  DistrictDoor,
  DistrictModel,
} from '../../gameplay/district/district';

/**
 * Signs on Bayfield's buildings (Phase 7, 0.7.2): a board over each building's door that
 * says what it is. A named building (a shop, the saloon, the lockup, the Hollister
 * warehouse) reads its own name from the district layout; the rest read by use. A sign
 * goes on the front a door is set in, just under the eaves, and faces out.
 */

/** What a building without a name is called, by its kind. */
const USE: Record<string, string> = {
  fishShed: 'Fish shed',
  iceHouse: 'Ice house',
  warehouse: 'Warehouse',
  packingHouse: 'Packing house',
  cooperage: 'Cooperage',
  saloon: 'Saloon',
  chandlery: 'Chandlery',
  store: 'General store',
  office: 'Harbor office',
  lockup: 'Lockup',
  shed: 'Shed',
};

/** The words on a building's board: its name, or else its use. Undefined for none. */
export function signLabel(b: { name?: string | undefined; kind: string }): string | undefined {
  return b.name ?? USE[b.kind];
}

export interface SignPlacement {
  /** The board's middle, district meters. */
  x: number;
  y: number;
  z: number;
  /** Turns the board about the vertical so its face looks out. */
  rotY: number;
  widthM: number;
  heightM: number;
}

/**
 * How far the board stands off the wall's center line: past the wall's own half thickness
 * and the battens and trim on its face, so it isn't buried in the wall.
 */
export const SIGN_OFFSET_M = WALL_M / 2 + 0.06;

/** Where a building's board goes: over the first door, on the wall that door is set in. */
export function signPlacement(b: DistrictBuilding, door: DistrictDoor): SignPlacement {
  const cx = (b.minX + b.maxX) / 2;
  const cz = (b.minZ + b.maxZ) / 2;
  const heightM = 0.7;
  if (b.def.roof === 'falseFront') {
    // A false front already has a dark board on the street (north) side, 0.9 m tall and
    // 0.12 m deep, its foot 1.2 m under the eaves (kit-meshes roofGeometry): paint on that.
    return {
      x: cx,
      y: b.eavesY - 1.2 + 0.1,
      z: b.minZ - 0.2 - 0.06 - 0.02,
      rotY: Math.PI,
      widthM: Math.min(b.maxX - b.minX - 1, 6) - 0.2,
      heightM,
    };
  }
  // Over the door's lintel, but no higher than just under the eaves.
  const y = Math.min(door.y + 2.7, b.eavesY - heightM - 0.2);
  const wallLen = door.alongX ? b.maxX - b.minX : b.maxZ - b.minZ;
  const widthM = Math.min(wallLen - 0.6, Math.max(door.widthM + 2.4, 3.2));
  if (door.alongX) {
    // A north or south wall: the board faces out along z.
    const out = door.z >= cz ? 1 : -1;
    return {
      x: door.x,
      y,
      z: door.z + out * SIGN_OFFSET_M,
      rotY: out > 0 ? 0 : Math.PI,
      widthM,
      heightM,
    };
  }
  // An east or west wall: the board faces out along x.
  const out = door.x >= cx ? 1 : -1;
  return {
    x: door.x + out * SIGN_OFFSET_M,
    y,
    z: door.z,
    rotY: out > 0 ? Math.PI / 2 : -Math.PI / 2,
    widthM,
    heightM,
  };
}

/** The board's words, painted: dark on cream, shrunk to fit the board. */
function paintLabel(text: string): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 96;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    ctx.fillStyle = '#e9dcb8';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.strokeStyle = '#3a2a1a';
    ctx.lineWidth = 8;
    ctx.strokeRect(6, 6, canvas.width - 12, canvas.height - 12);
    ctx.fillStyle = '#2a1d12';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    let size = 56;
    ctx.font = `bold ${size}px Georgia, serif`;
    while (size > 24 && ctx.measureText(text).width > canvas.width - 48) {
      size -= 4;
      ctx.font = `bold ${size}px Georgia, serif`;
    }
    ctx.fillText(text, canvas.width / 2, canvas.height / 2 + 2);
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/**
 * The boards for every building that has a door, as meshes (each named `sign:<building>`).
 * `dispose` frees their textures and geometry.
 */
export function buildingSigns(model: DistrictModel): {
  meshes: THREE.Mesh[];
  dispose(): void;
} {
  const meshes: THREE.Mesh[] = [];
  const geos: THREE.BufferGeometry[] = [];
  const mats: THREE.MeshBasicMaterial[] = [];
  const textures: THREE.CanvasTexture[] = [];
  for (const b of model.buildings) {
    const label = signLabel(b.def);
    const door = model.doors.find((d) => d.building === b.def.id);
    if (!label || !door) continue;
    const p = signPlacement(b, door);
    const geo = new THREE.PlaneGeometry(p.widthM, p.heightM);
    const tex = paintLabel(label);
    textures.push(tex);
    const mat = new THREE.MeshBasicMaterial({ map: tex, toneMapped: false });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.name = `sign:${b.def.id}`;
    mesh.position.set(p.x, p.y + p.heightM / 2, p.z);
    mesh.rotation.y = p.rotY;
    mesh.matrixAutoUpdate = false;
    mesh.updateMatrix();
    meshes.push(mesh);
    geos.push(geo);
    mats.push(mat);
  }
  return {
    meshes,
    dispose() {
      for (const g of geos) g.dispose();
      for (const t of textures) t.dispose();
      for (const m of mats) m.dispose();
    },
  };
}
