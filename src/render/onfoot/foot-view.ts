import { createWinterView, type WinterFrame } from './winter-view';
import { createWildlifeView, type WildlifeFrameView } from './wildlife-view';
import * as THREE from 'three';
import type { DistrictModel } from '../../gameplay/district/district';
import type { DistrictFrame } from '../../gameplay/district/ground';
import { DEFAULT_CONTROLLER } from '../../gameplay/onfoot/controller';
import { ROWBOAT } from '../../sim/ashore/rowboat';
import { PALETTE } from '../style/palette';
import { box, frustum, merged, part, place } from '../style/parts';
import { createLampPools } from '../district/district-view';
import {
  createStylizedMaterial,
  type LampPoolUniforms,
  type StyleLighting,
} from '../style/stylized-material';

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
    /** Leaning (Q/E): where the head is from the feet, zone meters; the figure tips toward it. */
    lean?: { x: number; z: number };
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
  /**
   * The docks district you're walking (Phase 7), drawn in its own frame placed on the
   * zone; `focus` is you in its local meters (lamp pools near you, the roof you're under).
   */
  district?:
    | {
        /** The harbor it stands on: that harbor's kit buildings give way to it. */
        harbor: string;
        model: DistrictModel;
        frame: DistrictFrame;
        focus: { x: number; y: number; z: number };
        /** Lamps put out (indexes into `model.lamps`): no pool, dark glass. */
        doused?: readonly number[];
      }
    | undefined;
  /** The watch, zone meters (Phase 7 piece D's guards). */
  guards?: readonly GuardFrame[] | undefined;
  /** Winter on foot (Phase 9 piece M): the sled, your prints, the ice road. */
  winter?: WinterFrame | undefined;
  /** The island's animals, deer sign and traplines, and a carcass carried (piece V). */
  wildlife?: WildlifeFrameView | undefined;
}

export interface GuardFrame {
  id: string;
  /** `npc.watchman`, `npc.constable`, `npc.sailor`, `npc.marshal`, `npc.keeper`, a resident's. */
  type: string;
  /** The FSM state: down ones lie on the ground. */
  state: string;
  x: number;
  y: number;
  z: number;
  heading: number;
  crouching: boolean;
  /** Their lantern is lit. */
  lantern: boolean;
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

function captainGeometry(
  height: number,
  coat = COAT,
  hat = HAT,
  scarfColor: number = PALETTE.canvas,
  tallHat = false,
): THREE.BufferGeometry {
  const r = DEFAULT_CONTROLLER.radius;
  const body = part(new THREE.CapsuleGeometry(r, height - 2 * r - 0.22, 3, 10), coat);
  body.translate(0, (height - 0.22) / 2, 0);
  const head = part(new THREE.SphereGeometry(0.13, 10, 8), SKIN);
  head.translate(0, height - 0.16, 0);
  const brim = frustum(0.2, 0.2, 0.03, 12, 0, height - 0.06, 0, hat);
  const crown = tallHat
    ? frustum(0.11, 0.13, 0.24, 12, 0, height - 0.04, 0, hat)
    : frustum(0.12, 0.13, 0.14, 12, 0, height - 0.04, 0, hat);
  // A pale scarf at the front, so which way you face reads from behind the shoulder.
  const scarf = box(0.22, 0.08, 0.08, 0, height - 0.42, -r + 0.04, scarfColor);
  return merged([body, head, brim, crown, scarf]);
}

/**
 * The watch as capsule figures like the captain's until piece B's bodies are wired into
 * the game: the watchman in a brown coat, the constable in blue with brass buttons and a
 * tall hat, the marshal in a duster, the sailor in a pea coat.
 */
const GUARD_LOOKS: Record<string, { coat: number; hat: number; front: number; tall: boolean }> = {
  'npc.watchman': { coat: 0x6b4f35, hat: 0x2b241c, front: 0x8f8a7a, tall: false },
  'npc.constable': { coat: 0x1d2f5a, hat: 0x141c33, front: 0xc9a24a, tall: true },
  'npc.marshal': { coat: 0x9a8461, hat: 0x3b2e22, front: 0x6d5a3f, tall: false },
  'npc.sailor': { coat: 0x22262e, hat: 0x22262e, front: 0xd8d4c8, tall: false },
  // The Lighthouse Service's keepers (Phase 9 piece H): a navy uniform coat with brass buttons and a cap.
  'npc.keeper': { coat: 0x1c2638, hat: 0x1c2638, front: 0xb8963e, tall: false },
  // Behind the counters (piece F): a shopkeeper in shirtsleeves and an apron, the fence in black.
  'npc.shopkeeper': { coat: 0x7d7466, hat: 0x4a3f33, front: 0xe6e0d2, tall: false },
  'npc.fence': { coat: 0x26221f, hat: 0x26221f, front: 0x7a2f2a, tall: false },
  // The daytime crowd (0.7.1): a townsman in a brown coat, a dockhand in a blue shirt and cap.
  'npc.townsman': { coat: 0x5e4e3c, hat: 0x3a3028, front: 0x9c9284, tall: false },
  'npc.dockhand': { coat: 0x3d5068, hat: 0x2a2d33, front: 0xb8b0a0, tall: false },
  // The islands' people (Phase 9 piece Q): a fisherman in a tarred oilskin and sou'wester,
  // a farmer in a canvas coat and straw hat, a villager in a gray coat and cap.
  'npc.fisherman': { coat: 0x9a7f3c, hat: 0x6e5a2a, front: 0xd8cfb8, tall: false },
  'npc.farmer': { coat: 0x6f6448, hat: 0xc2a867, front: 0x5b4a39, tall: false },
  'npc.villager': { coat: 0x5a5a58, hat: 0x2e2c2a, front: 0xa59a88, tall: false },
};
const LANTERN_GLOW = 0xffc46b;

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

export function createFootView(
  lighting: StyleLighting,
  /**
   * The lamp pool uniforms, shared with the district view so a figure under a saloon
   * lantern comes up as warm as the floor under them (plan 08 §14). Defaults to a fresh,
   * unlit set for callers that draw the captain without a district (none today).
   */
  pools: LampPoolUniforms = createLampPools(),
): FootView {
  const group = new THREE.Group();
  group.name = 'on-foot';
  const material = createStylizedMaterial('toon', lighting, { vertexColors: true, pools });
  const standGeo = captainGeometry(DEFAULT_CONTROLLER.standHeight);
  const crouchGeo = captainGeometry(DEFAULT_CONTROLLER.crouchHeight);
  // Snow lies on the boat but not on a walking figure's shoulders (piece L).
  const figure = createStylizedMaterial('toon', lighting, {
    vertexColors: true,
    pools,
    noSnow: true,
  });
  const captain = new THREE.Mesh(standGeo, figure);
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
  const winter = createWinterView();
  group.add(winter.group);
  const wildlife = createWildlifeView(material);
  group.add(wildlife.group);
  const clock = { t: 0 };

  const guardGeo = new Map<string, THREE.BufferGeometry>();
  const guardShape = (type: string): THREE.BufferGeometry => {
    let g = guardGeo.get(type);
    if (!g) {
      const look = GUARD_LOOKS[type] ?? GUARD_LOOKS['npc.watchman'];
      g = captainGeometry(
        DEFAULT_CONTROLLER.standHeight,
        look?.coat,
        look?.hat,
        look?.front,
        look?.tall,
      );
      guardGeo.set(type, g);
    }
    return g;
  };
  const lanternMat = new THREE.MeshBasicMaterial({ color: LANTERN_GLOW });
  const lanternGeo = new THREE.BoxGeometry(0.14, 0.2, 0.14);
  const guardMeshes = new Map<string, { body: THREE.Mesh; lantern: THREE.Mesh }>();
  const guards = new THREE.Group();
  guards.name = 'guards';
  group.add(guards);
  const placeGuards = (list: readonly GuardFrame[] | undefined): void => {
    const seen = new Set<string>();
    for (const g of list ?? []) {
      seen.add(g.id);
      let m = guardMeshes.get(g.id);
      if (!m) {
        const body = new THREE.Mesh(guardShape(g.type), material);
        body.name = `guard:${g.id}`;
        body.rotation.order = 'YXZ';
        const lantern = new THREE.Mesh(lanternGeo, lanternMat);
        lantern.position.set(0.32, 0.85, -0.05);
        body.add(lantern);
        guards.add(body);
        m = { body, lantern };
        guardMeshes.set(g.id, m);
      }
      const down = g.state === 'unconscious' || g.state === 'bound' || g.state === 'dead';
      m.body.visible = true;
      m.body.position.set(g.x, g.y + (down ? 0.25 : 0), g.z);
      m.body.rotation.set(down ? -Math.PI / 2 : g.crouching ? -0.35 : 0, -g.heading, 0);
      m.lantern.visible = g.lantern;
    }
    for (const [id, m] of guardMeshes) if (!seen.has(id)) m.body.visible = false;
  };

  const UP = new THREE.Vector3(0, 1, 0);
  const yawQ = new THREE.Quaternion();
  const tiltQ = new THREE.Quaternion();
  const tiltAxis = new THREE.Vector3();
  return {
    group,
    update(frame, waterY) {
      group.visible = !!frame;
      if (!frame) return;
      placeGuards(frame.guards);
      clock.t += 1 / 60;
      winter.update(frame.winter, clock.t);
      const c = frame.captain;
      wildlife.update(frame.wildlife, c, clock.t);
      captain.visible = c.visible;
      captain.geometry = c.crouching || c.swimming ? crouchGeo : standGeo;
      captain.position.set(c.x, c.y, c.z);
      // Heading is clockwise from north; three.js yaw is counter-clockwise.
      yawQ.setFromAxisAngle(UP, -c.heading);
      // Leaning tips the figure about its feet toward the head's offset.
      const lx = c.lean?.x ?? 0;
      const lz = c.lean?.z ?? 0;
      const m = Math.hypot(lx, lz);
      if (m > 1e-3) {
        const h = c.crouching ? DEFAULT_CONTROLLER.crouchHeight : DEFAULT_CONTROLLER.standHeight;
        tiltAxis.set(lz / m, 0, -lx / m);
        tiltQ.setFromAxisAngle(tiltAxis, Math.asin(Math.min(0.6, m / h)));
        captain.quaternion.multiplyQuaternions(tiltQ, yawQ);
      } else {
        captain.quaternion.copy(yawQ);
      }
      const b = frame.boat;
      boat.visible = !!b;
      if (b) {
        boat.position.set(b.x, b.beached ? Math.max(waterY, 0) - 0.25 : waterY - 0.2, b.z);
        boat.rotation.set(b.beached ? 0.06 : 0, -b.heading, 0);
        rower.visible = b.manned;
      }
    },
    dispose() {
      winter.dispose();
      wildlife.dispose();
      for (const g of guardGeo.values()) g.dispose();
      lanternGeo.dispose();
      lanternMat.dispose();
      standGeo.dispose();
      crouchGeo.dispose();
      boat.geometry.dispose();
      material.dispose();
      figure.dispose();
    },
  };
}
