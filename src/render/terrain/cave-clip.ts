import * as THREE from 'three';
import type { CaveClip, PlacedCave } from '../../sim/caves/caves';
import { caveClips } from '../../sim/caves/caves';

/**
 * The drawn ground cut away for the sea caves (plan 11 §5, §18.4 piece S): a heightmap
 * can't overhang, so the terrain shader discards its fragments inside each cave's passage
 * (a capsule per segment, between two heights) and the cave's own rock is drawn round the
 * hole. The water shader reads the same list to go dark and still under a roof.
 *
 * Caves are few and small, so each is boxed first: a fragment outside every box tests
 * nothing else.
 */

export const MAX_CAVES = 8;
export const MAX_CAVE_SEGMENTS = 40;

export interface CaveClipUniforms {
  [name: string]: THREE.IUniform;
  uCaveCount: THREE.IUniform<number>;
  /** Each cave's box, zone x/z: minX, minZ, maxX, maxZ. */
  uCaveBox: THREE.IUniform<THREE.Vector4[]>;
  /** Each cave's segments: first index and count. */
  uCaveRange: THREE.IUniform<THREE.Vector2[]>;
  /** A segment's two ends, x0, z0, x1, z1. */
  uCaveSeg: THREE.IUniform<THREE.Vector4[]>;
  /** A segment's radius, the heights cut between, and 1 under a roof (0 open). */
  uCaveDim: THREE.IUniform<THREE.Vector4[]>;
}

export function createCaveClipUniforms(): CaveClipUniforms {
  return {
    uCaveCount: { value: 0 },
    uCaveBox: { value: Array.from({ length: MAX_CAVES }, () => new THREE.Vector4()) },
    uCaveRange: { value: Array.from({ length: MAX_CAVES }, () => new THREE.Vector2()) },
    uCaveSeg: { value: Array.from({ length: MAX_CAVE_SEGMENTS }, () => new THREE.Vector4()) },
    uCaveDim: { value: Array.from({ length: MAX_CAVE_SEGMENTS }, () => new THREE.Vector4()) },
  };
}

/** Fills the uniforms from a zone's caves (none clears them). */
export function setCaveClips(u: CaveClipUniforms, caves: readonly PlacedCave[]): void {
  let seg = 0;
  let count = 0;
  for (const cave of caves) {
    if (count >= MAX_CAVES) break;
    const clips: CaveClip[] = caveClips(cave);
    if (seg + clips.length > MAX_CAVE_SEGMENTS) break;
    let minX = Infinity;
    let minZ = Infinity;
    let maxX = -Infinity;
    let maxZ = -Infinity;
    const start = seg;
    for (const c of clips) {
      minX = Math.min(minX, c.x0 - c.radius, c.x1 - c.radius);
      minZ = Math.min(minZ, c.z0 - c.radius, c.z1 - c.radius);
      maxX = Math.max(maxX, c.x0 + c.radius, c.x1 + c.radius);
      maxZ = Math.max(maxZ, c.z0 + c.radius, c.z1 + c.radius);
      u.uCaveSeg.value[seg]?.set(c.x0, c.z0, c.x1, c.z1);
      u.uCaveDim.value[seg]?.set(c.radius, c.minY, c.maxY, c.roofed ? 1 : 0);
      seg++;
    }
    u.uCaveBox.value[count]?.set(minX, minZ, maxX, maxZ);
    u.uCaveRange.value[count]?.set(start, clips.length);
    count++;
  }
  u.uCaveCount.value = count;
}

/**
 * `caveCut(p)`: 1 when a world point is inside a cave's cut (`roofedOnly` > 0.5: only
 * under a roof), else 0.
 */
export const CAVE_CLIP_GLSL = /* glsl */ `
uniform int uCaveCount;
uniform vec4 uCaveBox[${MAX_CAVES}];
uniform vec2 uCaveRange[${MAX_CAVES}];
uniform vec4 uCaveSeg[${MAX_CAVE_SEGMENTS}];
uniform vec4 uCaveDim[${MAX_CAVE_SEGMENTS}];

float caveCut(vec3 p, float roofedOnly) {
  for (int c = 0; c < ${MAX_CAVES}; c++) {
    if (c >= uCaveCount) break;
    vec4 box = uCaveBox[c];
    if (p.x < box.x || p.z < box.y || p.x > box.z || p.z > box.w) continue;
    int first = int(uCaveRange[c].x);
    int n = int(uCaveRange[c].y);
    for (int k = 0; k < ${MAX_CAVE_SEGMENTS}; k++) {
      if (k >= n) break;
      vec4 s = uCaveSeg[first + k];
      vec4 d = uCaveDim[first + k];
      if (d.w < roofedOnly) continue;
      if (p.y < d.y || p.y > d.z) continue;
      vec2 a = s.xy;
      vec2 ab = s.zw - a;
      float t = clamp(dot(p.xz - a, ab) / max(dot(ab, ab), 1e-6), 0.0, 1.0);
      if (distance(p.xz, a + ab * t) < d.x) return 1.0;
    }
  }
  return 0.0;
}
`;
