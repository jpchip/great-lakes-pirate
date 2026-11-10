import * as THREE from 'three';
import type { BeardStyle, HatStyle, HeldProp } from './looks';
import { REGION, type RegionName } from './regions';

/**
 * Hats, the mustache and carried props for the humanoid (plan 08 §13: "variety comes from
 * palette swaps and accessories"), built in code like the ships. Each comes out as a
 * skinned piece rigidly bound to one joint, in the body's bind space, with the same
 * attributes as the GLB pieces (position, normal, skinIndex, skinWeight, _look), so it
 * merges into the character's single mesh.
 */

/** Where the head sits in bind space, measured from the head piece. */
export interface HeadFrame {
  /** Crown of the head (the top of the skull, not the hair). */
  top: number;
  /** Center of the skull, horizontally. */
  centerZ: number;
  /** Radius of the ellipse (about the vertical axis) that holds the skull above the brow. */
  radius: number;
  /** How much longer the skull is front to back than wide. */
  scaleZ: number;
  /** Eyes' height and the front of the face (nose tip). */
  eyeY: number;
  frontZ: number;
}

interface Builder {
  pos: number[];
  nrm: number[];
  look: number[];
  index: number[];
}

function builder(): Builder {
  return { pos: [], nrm: [], look: [], index: [] };
}

/**
 * Append a surface of revolution about the vertical axis through (cx, cz): `profile` is
 * [radius, height] pairs bottom to top. `scaleZ` stretches it fore-aft (heads are long),
 * `arc` limits it to a part of the circle facing +Z (a cap's peak).
 */
function lathe(
  b: Builder,
  profile: readonly [number, number][],
  region: RegionName,
  opts: {
    cx?: number;
    cz?: number;
    scaleZ?: number;
    segments?: number;
    arc?: number;
    shiftZ?: (y: number, a: number) => number;
  } = {},
): void {
  const segments = opts.segments ?? 14;
  const arc = opts.arc ?? Math.PI * 2;
  const closed = arc >= Math.PI * 2 - 1e-6;
  const cols = closed ? segments : segments + 1;
  const start = b.pos.length / 3;
  const cx = opts.cx ?? 0;
  const cz = opts.cz ?? 0;
  const sz = opts.scaleZ ?? 1;
  for (let i = 0; i < profile.length; i++) {
    const [r, y] = profile[i] as [number, number];
    // Profile tangent for the normal.
    const prev = profile[Math.max(0, i - 1)] as [number, number];
    const next = profile[Math.min(profile.length - 1, i + 1)] as [number, number];
    const dr = next[0] - prev[0];
    const dy = next[1] - prev[1];
    for (let j = 0; j < cols; j++) {
      const a = (closed ? j / segments : j / segments - 0.5) * arc;
      // a = 0 faces +Z (forward).
      const sx = Math.sin(a);
      const cxz = Math.cos(a);
      const shift = opts.shiftZ ? opts.shiftZ(y, a) : 0;
      b.pos.push(cx + sx * r, y, cz + cxz * r * sz + shift);
      const n = new THREE.Vector3(sx * dy, -dr, (cxz * dy) / sz).normalize();
      b.nrm.push(n.x, n.y, n.z);
      b.look.push(REGION[region], 1);
    }
  }
  for (let i = 0; i < profile.length - 1; i++) {
    for (let j = 0; j < (closed ? segments : segments); j++) {
      const j1 = closed ? (j + 1) % cols : j + 1;
      const a = start + i * cols + j;
      const bb = start + i * cols + j1;
      const c = start + (i + 1) * cols + j;
      const d = start + (i + 1) * cols + j1;
      b.index.push(a, bb, c, bb, d, c);
    }
  }
}

/** A tapered tube along a path: the mustache, a strap, a stick. */
function tube(
  b: Builder,
  path: readonly THREE.Vector3[],
  radius: (t: number) => number,
  region: RegionName,
  sides = 6,
): void {
  const start = b.pos.length / 3;
  const up = new THREE.Vector3(0, 1, 0);
  for (let i = 0; i < path.length; i++) {
    const p = path[i] as THREE.Vector3;
    const t = i / (path.length - 1);
    const ahead = (path[Math.min(path.length - 1, i + 1)] as THREE.Vector3).clone();
    const behind = (path[Math.max(0, i - 1)] as THREE.Vector3).clone();
    const tangent = ahead.sub(behind).normalize();
    const side = new THREE.Vector3()
      .crossVectors(tangent, Math.abs(tangent.y) > 0.9 ? new THREE.Vector3(1, 0, 0) : up)
      .normalize();
    const normal = new THREE.Vector3().crossVectors(side, tangent).normalize();
    const r = radius(t);
    for (let s = 0; s < sides; s++) {
      const a = (s / sides) * Math.PI * 2;
      const n = side.clone().multiplyScalar(Math.cos(a)).addScaledVector(normal, Math.sin(a));
      b.pos.push(p.x + n.x * r, p.y + n.y * r, p.z + n.z * r);
      b.nrm.push(n.x, n.y, n.z);
      b.look.push(REGION[region], 1);
    }
  }
  for (let i = 0; i < path.length - 1; i++) {
    for (let s = 0; s < sides; s++) {
      const a = start + i * sides + s;
      const bb = start + i * sides + ((s + 1) % sides);
      const c = a + sides;
      const d = bb + sides;
      b.index.push(a, c, bb, bb, c, d);
    }
  }
}

/** A box, for the lantern's base and the rifle's stock. */
function box(
  b: Builder,
  center: THREE.Vector3,
  size: THREE.Vector3,
  region: RegionName,
  rotation = new THREE.Quaternion(),
): void {
  const g = new THREE.BoxGeometry(size.x, size.y, size.z);
  g.applyQuaternion(rotation);
  g.translate(center.x, center.y, center.z);
  const start = b.pos.length / 3;
  const p = g.getAttribute('position');
  const n = g.getAttribute('normal');
  for (let i = 0; i < p.count; i++) {
    b.pos.push(p.getX(i), p.getY(i), p.getZ(i));
    b.nrm.push(n.getX(i), n.getY(i), n.getZ(i));
    b.look.push(REGION[region], 1);
  }
  const idx = g.getIndex();
  if (idx) for (let i = 0; i < idx.count; i++) b.index.push(start + idx.getX(i));
  g.dispose();
}

function toGeometry(b: Builder, joint: number): THREE.BufferGeometry | null {
  if (b.index.length === 0) return null;
  const g = new THREE.BufferGeometry();
  const n = b.pos.length / 3;
  g.setAttribute('position', new THREE.Float32BufferAttribute(b.pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(b.nrm, 3));
  g.setAttribute('_look', new THREE.Float32BufferAttribute(b.look, 2));
  const skinIndex = new Uint16Array(n * 4);
  const skinWeight = new Float32Array(n * 4);
  for (let i = 0; i < n; i++) {
    skinIndex[i * 4] = joint;
    skinWeight[i * 4] = 1;
  }
  g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(skinIndex, 4));
  g.setAttribute('skinWeight', new THREE.Float32BufferAttribute(skinWeight, 4));
  g.setIndex(b.index);
  return g;
}

/** The hat for a style, bound to the head joint. */
export function hatGeometry(
  style: HatStyle,
  head: HeadFrame,
  headJoint: number,
): THREE.BufferGeometry | null {
  const b = builder();
  const R = head.radius;
  const T = head.top;
  const cz = head.centerZ;
  const sz = head.scaleZ; // heads are longer than wide
  const o = { cz, scaleZ: sz };
  switch (style) {
    case 'none':
      return null;
    case 'cap':
    case 'peaked': {
      // A peaked cap: a band, a soft crown flaring to a flat top, and a short peak.
      const base = T - 0.065;
      lathe(
        b,
        [
          [R * 1.05, base],
          [R * 1.07, base + 0.022],
        ],
        'hatBand',
        o,
      );
      lathe(
        b,
        [
          [R * 1.07, base + 0.022],
          [R * 1.22, T + 0.01],
          [R * 1.18, T + 0.022],
          [R * 0.7, T + 0.03],
          [0.001, T + 0.032],
        ],
        'hat',
        o,
      );
      lathe(
        b,
        [
          [R * 1.06, base + 0.003],
          [R * 1.06 + 0.05, base - 0.014],
          [R * 1.06 + 0.052, base - 0.018],
        ],
        'hatBand',
        { ...o, arc: Math.PI * 0.7, segments: 8 },
      );
      break;
    }
    case 'bowler': {
      const base = T - 0.06;
      lathe(
        b,
        [
          [R * 1.5, base - 0.004],
          [R * 1.58, base + 0.01],
        ],
        'hat',
        o,
      );
      lathe(
        b,
        [
          [R * 1.08, base - 0.006],
          [R * 1.5, base - 0.006],
        ],
        'hat',
        o,
      );
      lathe(
        b,
        [
          [R * 1.08, base],
          [R * 1.1, base + 0.022],
        ],
        'hatBand',
        o,
      );
      lathe(
        b,
        [
          [R * 1.1, base + 0.022],
          [R * 1.1, T],
          [R * 0.95, T + 0.045],
          [R * 0.6, T + 0.07],
          [0.001, T + 0.078],
        ],
        'hat',
        o,
      );
      break;
    }
    case 'souwester': {
      // Oilskin: a round crown and a brim that sweeps down behind to shed water off the neck.
      const base = T - 0.065;
      const droop = (y: number, a: number) => 0 * y * a;
      lathe(
        b,
        [
          [R * 1.1, base],
          [R * 1.12, T - 0.01],
          [R * 0.85, T + 0.04],
          [0.001, T + 0.05],
        ],
        'hat',
        { ...o, shiftZ: droop },
      );
      const brim: [number, number][] = [
        [R * 1.1, base],
        [R * 1.75, base - 0.02],
        [R * 1.85, base - 0.035],
      ];
      lathe(b, brim, 'hat', o);
      // The long back flap.
      lathe(
        b,
        [
          [R * 1.12, base - 0.005],
          [R * 1.9, base - 0.07],
          [R * 1.95, base - 0.085],
        ],
        'hat',
        {
          ...o,
          arc: Math.PI * 0.9,
          segments: 8,
          shiftZ: () => 0,
          cx: 0,
          cz: cz,
          scaleZ: -sz,
        },
      );
      break;
    }
    case 'wool': {
      // A knitted watch cap with a rolled cuff.
      const base = T - 0.075;
      lathe(
        b,
        [
          [R * 1.12, base],
          [R * 1.16, base + 0.012],
          [R * 1.14, base + 0.03],
        ],
        'hatBand',
        o,
      );
      lathe(
        b,
        [
          [R * 1.08, base + 0.03],
          [R * 1.08, T - 0.01],
          [R * 0.8, T + 0.035],
          [0.001, T + 0.045],
        ],
        'hat',
        o,
      );
      break;
    }
    case 'bonnet': {
      // A poke bonnet: a crown over the back of the head and a brim framing the face.
      const base = T - 0.09;
      lathe(
        b,
        [
          [R * 1.12, base],
          [R * 1.16, T - 0.02],
          [R * 0.9, T + 0.03],
          [0.001, T + 0.04],
        ],
        'hat',
        {
          cz: cz - 0.02,
          scaleZ: sz,
        },
      );
      lathe(
        b,
        [
          [R * 1.15, base + 0.01],
          [R * 1.25, T + 0.035],
          [R * 1.05, T + 0.06],
        ],
        'hat',
        { cz: cz - 0.01, scaleZ: sz * 1.2, arc: Math.PI * 1.1, segments: 10 },
      );
      // The ribbon under the brim.
      lathe(
        b,
        [
          [R * 1.17, base + 0.012],
          [R * 1.18, base + 0.03],
        ],
        'hatBand',
        { cz: cz - 0.02, scaleZ: sz },
      );
      break;
    }
    case 'helmet': {
      // The police helmet of the 1890s: tall, domed, a narrow brim, a badge on the front.
      const base = T - 0.075;
      lathe(
        b,
        [
          [R * 1.12, base - 0.006],
          [R * 1.42, base - 0.02],
          [R * 1.44, base - 0.026],
        ],
        'hat',
        o,
      );
      lathe(
        b,
        [
          [R * 1.1, base],
          [R * 1.14, T - 0.01],
          [R * 1.1, T + 0.05],
          [R * 0.85, T + 0.1],
          [R * 0.4, T + 0.122],
          [R * 0.12, T + 0.128],
          [R * 0.1, T + 0.14],
          [0.001, T + 0.142],
        ],
        'hat',
        o,
      );
      box(
        b,
        new THREE.Vector3(0, base + 0.06, cz + R * 1.14 * sz + 0.004),
        new THREE.Vector3(0.045, 0.05, 0.008),
        'metal',
      );
      break;
    }
    case 'slouch': {
      // A wide felt hat with a pinched crown: the marshal.
      const base = T - 0.06;
      lathe(
        b,
        [
          [R * 1.1, base],
          [R * 2.1, base - 0.012],
          [R * 2.25, base - 0.03],
        ],
        'hat',
        o,
      );
      lathe(
        b,
        [
          [R * 1.1, base],
          [R * 1.12, base + 0.025],
        ],
        'hatBand',
        o,
      );
      lathe(
        b,
        [
          [R * 1.12, base + 0.025],
          [R * 1.1, T + 0.04],
          [R * 0.7, T + 0.055],
          [R * 0.3, T + 0.04],
          [0.001, T + 0.05],
        ],
        'hat',
        o,
      );
      break;
    }
  }
  return toGeometry(b, headJoint);
}

/** A mustache (beards come from the GLB). */
export function beardGeometry(
  style: BeardStyle,
  head: HeadFrame,
  headJoint: number,
): THREE.BufferGeometry | null {
  if (style !== 'mustache') return null;
  const b = builder();
  const y = head.eyeY - 0.072;
  const z = head.frontZ - 0.018;
  const path: THREE.Vector3[] = [];
  for (let i = 0; i <= 10; i++) {
    const t = i / 10 - 0.5; // -0.5…0.5 left to right
    path.push(new THREE.Vector3(t * 0.07, y - Math.abs(t) * 0.035 + 0.004, z - t * t * 0.09));
  }
  tube(b, path, (t) => 0.003 + 0.0065 * Math.sin(Math.PI * t), 'hair', 6);
  return toGeometry(b, headJoint);
}

/** Bind-space frame of a joint: position and the hand's "down the fingers" direction. */
export interface JointFrame {
  index: number;
  position: THREE.Vector3;
  /** Unit vector from this joint toward its child (along the bone). */
  along: THREE.Vector3;
}

/**
 * A held prop. The lantern hangs below the right hand, bound to it; the club hangs at the
 * right hip and the rifle is slung across the back, bound to the pelvis and spine.
 */
export function propGeometry(
  prop: HeldProp,
  hand: JointFrame,
  pelvis: JointFrame,
  chest: JointFrame,
): THREE.BufferGeometry | null {
  const b = builder();
  switch (prop) {
    case 'none':
      return null;
    case 'lantern': {
      // Hand at the bail; the lantern a little past the palm along the fingers.
      const c = hand.position.clone().addScaledVector(hand.along, 0.07);
      const bottom = c.y - 0.27;
      lathe(
        b,
        [
          [0.001, c.y - 0.02],
          [0.012, c.y - 0.03],
          [0.012, c.y - 0.04],
        ],
        'prop',
        { cx: c.x, cz: c.z, segments: 8 },
      );
      lathe(
        b,
        [
          [0.03, c.y - 0.06],
          [0.055, c.y - 0.09],
        ],
        'prop',
        { cx: c.x, cz: c.z, segments: 10 },
      );
      lathe(
        b,
        [
          [0.045, c.y - 0.09],
          [0.05, c.y - 0.13],
          [0.05, c.y - 0.2],
          [0.045, c.y - 0.23],
        ],
        'lampGlass',
        {
          cx: c.x,
          cz: c.z,
          segments: 10,
        },
      );
      lathe(
        b,
        [
          [0.055, c.y - 0.23],
          [0.06, bottom],
          [0.001, bottom],
        ],
        'prop',
        { cx: c.x, cz: c.z, segments: 10 },
      );
      // Two guard wires.
      for (const dx of [-0.052, 0.052]) {
        tube(
          b,
          [
            new THREE.Vector3(c.x + dx, c.y - 0.09, c.z),
            new THREE.Vector3(c.x + dx, c.y - 0.23, c.z),
          ],
          () => 0.004,
          'prop',
          4,
        );
      }
      // The bail up to the fist.
      tube(
        b,
        [
          new THREE.Vector3(c.x - 0.03, c.y - 0.06, c.z),
          new THREE.Vector3(c.x, c.y + 0.01, c.z),
          new THREE.Vector3(c.x + 0.03, c.y - 0.06, c.z),
        ],
        () => 0.003,
        'prop',
        4,
      );
      return toGeometry(b, hand.index);
    }
    case 'club': {
      const top = pelvis.position.clone().add(new THREE.Vector3(-0.19, -0.02, 0.02));
      tube(
        b,
        [top, top.clone().add(new THREE.Vector3(-0.01, -0.42, 0.03))],
        (t) => 0.017 - 0.004 * t,
        'prop',
        6,
      );
      return toGeometry(b, pelvis.index);
    }
    case 'rifle': {
      // Slung barrel-up over the right shoulder, across the back.
      const back = chest.position.clone().add(new THREE.Vector3(0, 0, -0.17));
      const dir = new THREE.Vector3(0.45, 1, 0).normalize();
      const butt = back.clone().addScaledVector(dir, -0.5);
      const muzzle = back.clone().addScaledVector(dir, 0.62);
      tube(b, [butt.clone().addScaledVector(dir, 0.3), muzzle], () => 0.011, 'metal', 6);
      box(
        b,
        butt.clone().addScaledVector(dir, 0.15),
        new THREE.Vector3(0.04, 0.34, 0.07),
        'prop',
        new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir),
      );
      // The sling, chest to back.
      tube(
        b,
        [
          back.clone().add(new THREE.Vector3(0.12, 0.22, 0.02)),
          back.clone().add(new THREE.Vector3(0.05, 0.05, 0.22)),
          back.clone().add(new THREE.Vector3(-0.12, -0.2, 0.2)),
          butt.clone().add(new THREE.Vector3(0, 0.05, 0.02)),
        ],
        () => 0.007,
        'leather',
        4,
      );
      return toGeometry(b, chest.index);
    }
  }
}
