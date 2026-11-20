import * as THREE from 'three';
import type { CurioSlot } from '../../sim/discovery/discovery';
import { box, frustum, merged, part } from '../style/parts';

/**
 * The curios set out at a hideout, drawn on its shelves, tables and sea chests (plan 11
 * §7.1, §12; Phase 9 piece O's catalog, drawn in piece P). Each is a handful of palette
 * parts a hand or two across, standing on its slot; all of a site's curios merge into one
 * mesh in the site's frame.
 */

const BRASS = 0xb8913a;
const BRONZE = 0x8a6a3a;
const GLASS_GREEN = 0x4f8a6a;
const PRISM = 0xd8e6e2;
const SILVER = 0xb8b8b0;
const HICKORY = 0xa48760;
const IRON = 0x3a3a38;
const GILT = 0xc9a24a;
const NAMEBOARD = 0x2a3a4a;
const TWINE = 0xb9a77f;

type Builder = () => THREE.BufferGeometry[];

const CURIOS: Record<string, Builder> = {
  'curio.brass_compass': () => [
    frustum(0.07, 0.07, 0.03, 10, 0, 0, 0, BRASS),
    frustum(0.058, 0.058, 0.005, 10, 0, 0.03, 0, 0xe8e0c8),
    box(0.08, 0.004, 0.012, 0, 0.034, 0, 0xa02418),
  ],
  'curio.ships_bell': () => [
    frustum(0.07, 0.14, 0.2, 10, 0, 0.02, 0, BRONZE),
    box(0.04, 0.05, 0.04, 0, 0.22, 0, BRONZE),
    box(0.3, 0.02, 0.2, 0, 0, 0, 0x5a4632),
  ],
  'curio.quarry_pick': () => {
    const handle = part(new THREE.CylinderGeometry(0.015, 0.018, 0.55, 5), HICKORY);
    handle.rotateZ(Math.PI / 2);
    handle.translate(0, 0.02, 0);
    return [handle, box(0.04, 0.03, 0.32, 0.26, 0.005, 0, IRON)];
  },
  'curio.lens_prism': () => {
    const g = part(new THREE.CylinderGeometry(0.1, 0.1, 0.12, 3, 1), PRISM);
    g.rotateZ(Math.PI / 2);
    g.translate(0, 0.05, 0);
    return [g];
  },
  'curio.glass_float': () => [
    (() => {
      const g = part(new THREE.SphereGeometry(0.1, 8, 6), GLASS_GREEN);
      return g.translate(0, 0.1, 0);
    })(),
    frustum(0.105, 0.105, 0.01, 8, 0, 0.09, 0, TWINE),
    frustum(0.04, 0.04, 0.02, 6, 0, 0, 0, TWINE),
  ],
  'curio.trade_medal': () => [
    box(0.16, 0.12, 0.02, 0, 0, 0.03, 0x4a2f2a),
    (() => {
      const g = part(new THREE.CylinderGeometry(0.045, 0.045, 0.01, 10), SILVER);
      g.rotateX(Math.PI / 2);
      return g.translate(0, 0.06, 0.018);
    })(),
  ],
  'curio.keepers_spyglass': () => {
    const tube = part(new THREE.CylinderGeometry(0.025, 0.035, 0.45, 8), BRASS);
    tube.rotateZ(Math.PI / 2);
    tube.translate(0, 0.045, 0);
    return [
      tube,
      box(0.06, 0.012, 0.03, -0.12, 0, 0, 0x3a2a1e),
      box(0.06, 0.012, 0.03, 0.12, 0, 0, 0x3a2a1e),
    ];
  },
  'curio.nameboard': () => [
    box(0.62, 0.14, 0.03, 0, 0, 0.1, NAMEBOARD),
    box(0.5, 0.04, 0.032, 0, 0.05, 0.1, GILT),
  ],
};

/** A curio not in the list: a small wrapped bundle. */
const fallback: Builder = () => [box(0.18, 0.1, 0.14, 0, 0, 0, 0x8a7a5a)];

/** The curios on their slots, merged, in the site's frame; undefined when there are none. */
export function curiosGeometry(
  shown: readonly { id: string; slot: CurioSlot }[],
): THREE.BufferGeometry | undefined {
  const parts: THREE.BufferGeometry[] = [];
  for (const { id, slot } of shown) {
    for (const g of (CURIOS[id] ?? fallback)()) {
      g.rotateY(slot.yaw);
      parts.push(g.translate(slot.x, slot.y, slot.z));
    }
  }
  return parts.length ? merged(parts) : undefined;
}

/** Every curio the kit draws, for the tests. */
export const DRAWN_CURIOS: readonly string[] = Object.keys(CURIOS);
