import * as THREE from 'three';
import type { DistrictFrame } from '../../gameplay/district/ground';
import type { Heightfield } from '../../gameplay/onfoot/heightfield';

/**
 * Cuts the zone terrain mesh out under a docks district's ground (plan 08): the district
 * draws its own ground on the flattened set piece, and without this discard the two surfaces
 * z-fight.
 */

export interface DistrictGroundClipUniforms {
  [name: string]: THREE.IUniform;
  uDistrictClipActive: THREE.IUniform<number>;
  uDistrictClipCenter: THREE.IUniform<THREE.Vector2>;
  uDistrictClipAxisX: THREE.IUniform<THREE.Vector2>;
  uDistrictClipAxisZ: THREE.IUniform<THREE.Vector2>;
  uDistrictClipHalf: THREE.IUniform<THREE.Vector2>;
}

export function createDistrictGroundClipUniforms(): DistrictGroundClipUniforms {
  return {
    uDistrictClipActive: { value: 0 },
    uDistrictClipCenter: { value: new THREE.Vector2() },
    uDistrictClipAxisX: { value: new THREE.Vector2(1, 0) },
    uDistrictClipAxisZ: { value: new THREE.Vector2(0, 1) },
    uDistrictClipHalf: { value: new THREE.Vector2() },
  };
}

export function clearDistrictGroundClip(u: DistrictGroundClipUniforms): void {
  u.uDistrictClipActive.value = 0;
}

const axisX = new THREE.Vector2();
const axisZ = new THREE.Vector2();

/** Oriented rectangle in zone x/z over the baked district ground. */
export function setDistrictGroundClip(
  u: DistrictGroundClipUniforms,
  ground: Heightfield,
  frame: DistrictFrame,
): void {
  const o = frame.toZone(0, 0);
  const ex = frame.toZone(1, 0);
  const ez = frame.toZone(0, 1);
  const center = frame.toZone(ground.originX + ground.width / 2, ground.originZ + ground.depth / 2);
  axisX.set(ex.x - o.x, ex.z - o.z).normalize();
  axisZ.set(ez.x - o.x, ez.z - o.z).normalize();
  u.uDistrictClipCenter.value.set(center.x, center.z);
  u.uDistrictClipAxisX.value.copy(axisX);
  u.uDistrictClipAxisZ.value.copy(axisZ);
  u.uDistrictClipHalf.value.set(ground.width / 2, ground.depth / 2);
  u.uDistrictClipActive.value = 1;
}

export const DISTRICT_GROUND_CLIP_GLSL = /* glsl */ `
uniform float uDistrictClipActive;
uniform vec2 uDistrictClipCenter;
uniform vec2 uDistrictClipAxisX;
uniform vec2 uDistrictClipAxisZ;
uniform vec2 uDistrictClipHalf;

float districtGroundCut(vec2 xz) {
  if (uDistrictClipActive < 0.5) return 0.0;
  vec2 rel = xz - uDistrictClipCenter;
  float alongX = dot(rel, uDistrictClipAxisX);
  float alongZ = dot(rel, uDistrictClipAxisZ);
  if (abs(alongX) <= uDistrictClipHalf.x && abs(alongZ) <= uDistrictClipHalf.y) return 1.0;
  return 0.0;
}
`;
