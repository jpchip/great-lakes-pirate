import * as THREE from 'three';

/**
 * Rain (plan 04 §11, Phase 2 piece E): streaks falling through a box around the camera, one
 * draw call, with the count set by the preset and the share drawn by how hard it rains.
 * Every drop's position is a pure function of its seed and the clock, wrapped around the
 * camera in the vertex shader, so there's no per-frame CPU work and the box follows the
 * ship without the drops seeming to follow it. The wind slants the fall.
 */

const BOX = new THREE.Vector3(56, 40, 56);
/** Drop speed, m/s: faster than real rain looks on a 20 m ship, but it reads as rain. */
const FALL_MS = 11;
const STREAK_M = 1.6;
const MAX_STREAKS = 8000;

export interface Rain {
  readonly lines: THREE.LineSegments;
  /** Streaks drawn this frame. */
  readonly drawn: number;
  /** The preset's streak count at full rain. */
  setCapacity(n: number): void;
  /**
   * `rain01` the rate, `slant` the horizontal drift of a falling drop in m/s (x east, z
   * south), `light` 0–1 how bright the ambient light is, `time` real seconds.
   */
  update(
    camera: THREE.Vector3,
    rain01: number,
    slant: { x: number; z: number },
    light: number,
    time: number,
  ): void;
  dispose(): void;
}

const vertexShader = /* glsl */ `
attribute vec3 aSeed;
attribute float aEnd;

uniform float uTime;
uniform vec3 uCamera;
uniform vec3 uVelocity;
uniform vec3 uBox;
uniform float uLength;

varying float vAlpha;

void main() {
  // The drop's place in its box, moved along its fall, wrapped around the camera. The box
  // reaches a little more above the camera than below it, where the water is.
  vec3 q = aSeed * uBox + uVelocity * uTime;
  vec3 rel = mod(q - uCamera + uBox * vec3(0.5, 0.3, 0.5), uBox) - uBox * vec3(0.5, 0.3, 0.5);
  vec3 head = uCamera + rel;
  vec3 tail = head - normalize(uVelocity) * uLength;
  vec3 world = mix(head, tail, aEnd);
  float dist = length(rel);
  vAlpha = (1.0 - 0.75 * aEnd) * (1.0 - smoothstep(0.55 * uBox.x, 0.5 * uBox.x * 1.1, dist));
  gl_Position = projectionMatrix * viewMatrix * vec4(world, 1.0);
}
`;

const fragmentShader = /* glsl */ `
uniform vec3 uColor;
uniform float uOpacity;
varying float vAlpha;

void main() {
  gl_FragColor = vec4(uColor, vAlpha * uOpacity);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

export function createRain(capacity: number): Rain {
  const seeds = new Float32Array(MAX_STREAKS * 2 * 3);
  const ends = new Float32Array(MAX_STREAKS * 2);
  // A small seeded generator, so every run draws the same rain (and screenshots repeat).
  let state = 0x9e3779b9;
  const rand = (): number => {
    state = (Math.imul(state ^ (state >>> 15), 0x2c1b3c6d) + 0x297a2d39) | 0;
    return ((state ^ (state >>> 12)) >>> 0) / 4294967296;
  };
  for (let k = 0; k < MAX_STREAKS; k++) {
    const x = rand();
    const y = rand();
    const z = rand();
    for (let e = 0; e < 2; e++) {
      seeds.set([x, y, z], (k * 2 + e) * 3);
      ends[k * 2 + e] = e;
    }
  }
  const geometry = new THREE.BufferGeometry();
  // `position` is required to draw; the shader makes the real one.
  geometry.setAttribute(
    'position',
    new THREE.BufferAttribute(new Float32Array(MAX_STREAKS * 6), 3),
  );
  geometry.setAttribute('aSeed', new THREE.BufferAttribute(seeds, 3));
  geometry.setAttribute('aEnd', new THREE.BufferAttribute(ends, 1));
  geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e9);
  const material = new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uCamera: { value: new THREE.Vector3() },
      uVelocity: { value: new THREE.Vector3(0, -FALL_MS, 0) },
      uBox: { value: BOX.clone() },
      uLength: { value: STREAK_M },
      uColor: { value: new THREE.Color(0xa9bac6) },
      uOpacity: { value: 0 },
    },
    vertexShader,
    fragmentShader,
    transparent: true,
    depthWrite: false,
  });
  const lines = new THREE.LineSegments(geometry, material);
  lines.name = 'rain';
  lines.frustumCulled = false;
  lines.visible = false;
  lines.renderOrder = 3;
  let max = Math.min(capacity, MAX_STREAKS);
  let drawn = 0;
  const tint = new THREE.Color();

  return {
    lines,
    get drawn() {
      return drawn;
    },
    setCapacity(n) {
      max = Math.min(Math.max(0, n), MAX_STREAKS);
    },
    update(camera, rain01, slant, light, time) {
      drawn = Math.floor(max * Math.min(1, Math.max(0, rain01)));
      lines.visible = drawn > 0;
      if (!lines.visible) return;
      geometry.setDrawRange(0, drawn * 2);
      const u = material.uniforms as Record<string, THREE.IUniform>;
      (u['uTime'] as THREE.IUniform<number>).value = time;
      (u['uCamera'] as THREE.IUniform<THREE.Vector3>).value.copy(camera);
      (u['uVelocity'] as THREE.IUniform<THREE.Vector3>).value.set(slant.x, -FALL_MS, slant.z);
      (u['uOpacity'] as THREE.IUniform<number>).value = 0.3 + 0.3 * rain01;
      tint.setHex(0xa9bac6).multiplyScalar(0.25 + 0.75 * Math.min(1, light));
      (u['uColor'] as THREE.IUniform<THREE.Color>).value.copy(tint);
    },
    dispose() {
      geometry.dispose();
      material.dispose();
    },
  };
}
