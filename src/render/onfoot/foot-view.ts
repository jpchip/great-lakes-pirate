import * as THREE from 'three';
import { DEFAULT_CONTROLLER } from '../../gameplay/onfoot/controller';
import { ROWBOAT } from '../../sim/ashore/rowboat';
import { PALETTE } from '../style/palette';
import { box, frustum, merged, part, place } from '../style/parts';
import { createStylizedMaterial, type StyleLighting } from '../style/stylized-material';

/**
 * The captain on foot and the ship's boat (Phase 7 piece A). The captain is a capsule
 * stand-in in a coat and hat until piece B's body lands; the boat a small clinker-ish
 * hull. Two draw calls, toon-lit like the harbors.
 */

/** What main hands the scene each frame while you're ashore, interpolated already. */
export interface FootFrame {
  /** Where the camera stands and looks, zone meters. */
  camera: {
    position: { x: number; y: number; z: number };
    target: { x: number; y: number; z: number };
  };
  captain: {
    x: number;
    y: number;
    z: number;
    heading: number;
    crouching: boolean;
    /** Hidden while you sit in the boat (the boat draws you), or aboard. */
    visible: boolean;
    swimming: boolean;
  };
  boat:
    | {
        x: number;
        z: number;
        heading: number;
        /** Drawn up on the beach: she sits on the sand, a little bow-up. */
        beached: boolean;
        /** Someone at the oars. */
        manned: boolean;
      }
    | undefined;
  /** Cast away from a lost ship: hers isn't drawn. */
  shipGone?: boolean;
}

export interface FootView {
  readonly group: THREE.Group;
  /** Places the meshes; `waterY` is the sea's height at the boat. */
  update(frame: FootFrame | undefined, waterY: number): void;
  dispose(): void;
}

const COAT = 0x2f3a4c;
const SKIN = 0xc79a78;
const HAT = 0x1f1c19;
const OAR = 0x8a6a45;

function captainGeometry(height: number): THREE.BufferGeometry {
  const r = DEFAULT_CONTROLLER.radius;
  const body = part(new THREE.CapsuleGeometry(r, height - 2 * r - 0.22, 3, 10), COAT);
  body.translate(0, (height - 0.22) / 2, 0);
  const head = part(new THREE.SphereGeometry(0.13, 10, 8), SKIN);
  head.translate(0, height - 0.16, 0);
  const brim = frustum(0.2, 0.2, 0.03, 12, 0, height - 0.06, 0, HAT);
  const crown = frustum(0.12, 0.13, 0.14, 12, 0, height - 0.04, 0, HAT);
  // A pale scarf at the front, so which way you face reads from behind the shoulder.
  const scarf = box(0.22, 0.08, 0.08, 0, height - 0.42, -r + 0.04, PALETTE.canvas);
  return merged([body, head, brim, crown, scarf]);
}

function boatGeometry(): THREE.BufferGeometry {
  const L = ROWBOAT.lengthM;
  const B = ROWBOAT.beamM;
  const fb = ROWBOAT.freeboardM;
  const parts: THREE.BufferGeometry[] = [];
  // The hull: a hollowed box with a pointed bow, in a few planks of white and a dark rail.
  const shape = new THREE.Shape([
    new THREE.Vector2(-B / 2, L / 2 - 0.2),
    new THREE.Vector2(B / 2, L / 2 - 0.2),
    new THREE.Vector2(B / 2, -L / 2 + 1.1),
    new THREE.Vector2(0, -L / 2),
    new THREE.Vector2(-B / 2, -L / 2 + 1.1),
  ]);
  const hull = new THREE.ExtrudeGeometry(shape, { depth: fb + 0.25, bevelEnabled: false });
  hull.rotateX(Math.PI / 2);
  hull.translate(0, fb, 0);
  parts.push(part(hull, PALETTE.hullWhite));
  // Thwarts and floorboards inside the rail, standing just proud of the hull's top face.
  parts.push(box(B - 0.1, 0.04, L - 1.6, 0, fb + 0.005, 0.3, PALETTE.deckWood));
  parts.push(box(B - 0.1, 0.06, 0.22, 0, fb + 0.02, 0.2, PALETTE.sparBrown));
  parts.push(box(B - 0.1, 0.06, 0.22, 0, fb + 0.02, 1.2, PALETTE.sparBrown));
  // The oars, shipped along the thwarts.
  for (const side of [-1, 1]) {
    parts.push(
      place(
        part(new THREE.BoxGeometry(0.06, 0.05, 2.6), OAR),
        side * (B / 2 - 0.15),
        fb + 0.1,
        0.4,
      ),
    );
  }
  return merged(parts);
}

export function createFootView(lighting: StyleLighting): FootView {
  const group = new THREE.Group();
  group.name = 'on-foot';
  const material = createStylizedMaterial('toon', lighting, { vertexColors: true });
  const standGeo = captainGeometry(DEFAULT_CONTROLLER.standHeight);
  const crouchGeo = captainGeometry(DEFAULT_CONTROLLER.crouchHeight);
  const captain = new THREE.Mesh(standGeo, material);
  captain.name = 'captain';
  const boat = new THREE.Mesh(boatGeometry(), material);
  boat.name = 'rowboat';
  boat.rotation.order = 'YXZ';
  // The rower: the captain's shape, sitting at the oars facing aft.
  const rower = new THREE.Mesh(crouchGeo, material);
  rower.position.set(0, ROWBOAT.freeboardM - 0.55, 0.7);
  rower.rotation.y = Math.PI;
  boat.add(rower);
  group.add(captain, boat);
  group.visible = false;
  return {
    group,
    update(frame, waterY) {
      group.visible = !!frame;
      if (!frame) return;
      const c = frame.captain;
      captain.visible = c.visible;
      captain.geometry = c.crouching || c.swimming ? crouchGeo : standGeo;
      captain.position.set(c.x, c.y, c.z);
      // Heading is clockwise from north; three.js yaw is counter-clockwise.
      captain.rotation.y = -c.heading;
      const b = frame.boat;
      boat.visible = !!b;
      if (b) {
        boat.position.set(b.x, b.beached ? Math.max(waterY, 0) - 0.25 : waterY - 0.2, b.z);
        boat.rotation.set(b.beached ? 0.06 : 0, -b.heading, 0);
        rower.visible = b.manned;
      }
    },
    dispose() {
      standGeo.dispose();
      crouchGeo.dispose();
      boat.geometry.dispose();
      material.dispose();
    },
  };
}
