import * as THREE from 'three';
import type { Lamp } from './running-lights';
import type { SchoonerLines } from './schooner-lines';

/**
 * A schooner's running lights (Phase 5 piece B; the 1900 rules for a sailing vessel): a
 * red and a green sidelight in the fore shrouds and a white stern light on the taffrail,
 * no masthead light (that's for steam). In the hull's frame: bow -z, starboard +x,
 * waterline y = 0.
 */
export function schoonerLamps(l: Pick<SchoonerLines, 'length' | 'beam' | 'freeboard'>): Lamp[] {
  const side = { x: l.beam * 0.5, y: l.freeboard + 1.3, z: -l.length / 2 + l.length * 0.3 };
  return [
    { kind: 'port', position: new THREE.Vector3(-side.x, side.y, side.z) },
    { kind: 'starboard', position: new THREE.Vector3(side.x, side.y, side.z) },
    { kind: 'stern', position: new THREE.Vector3(0, l.freeboard + 1.1, l.length / 2 - 0.4) },
  ];
}
