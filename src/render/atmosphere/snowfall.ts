import * as THREE from 'three';

/**
 * Falling snow (plan 04 §11; plan 11 §18.4 piece L): flakes drifting down through a box
 * around the camera, one point-sprite draw, the count set by the preset and the share
 * drawn by how hard it snows. As with the rain, every flake's place is a pure function of
 * its seed and the clock, wrapped round the camera in the vertex shader, so there's no
 * per-frame CPU work. Flakes fall slowly, sway as they come down and go with the wind, so
 * a gale drives the snow nearly flat.
 */

const BOX = new THREE.Vector3(60, 34, 60);
/** A flake's fall, m/s. */
const FALL_MS = 1.3;
const MAX_FLAKES = 8000;

export interface Snowfall {
  readonly points: THREE.Points;
  /** Flakes drawn this frame. */
  readonly drawn: number;
  /** The preset's flake count at full snow. */
  setCapacity(n: number): void;
  /**
   * `snow01` the rate, `drift` the wind's carry of a flake in m/s (x east, z south),
   * `light` 0–1 how bright the ambient light is, `time` real seconds.
   */
  update(
    camera: THREE.Vector3,
    snow01: number,
    drift: { x: number; z: number },
    light: number,
    time: number,
  ): void;
  dispose(): void;
}

const vertexShader = /* glsl */ `
attribute vec4 aSeed;

uniform float uTime;
uniform vec3 uCamera;
uniform vec3 uVelocity;
uniform vec3 uBox;
uniform float uScale;

varying float vAlpha;

void main() {
  // Each flake falls at its own speed and sways on its own beat.
  float speed = 0.7 + 0.6 * aSeed.w;
  vec3 q = aSeed.xyz * uBox + uVelocity * speed * uTime;
  float sway = 6.2831853 * aSeed.w;
  q.x += 0.45 * sin(uTime * (1.1 + aSeed.w) + sway);
  q.z += 0.45 * cos(uTime * (0.9 + 0.7 * aSeed.w) + sway * 1.7);
  vec3 rel = mod(q - uCamera + uBox * vec3(0.5, 0.35, 0.5), uBox) - uBox * vec3(0.5, 0.35, 0.5);
  vec3 world = uCamera + rel;
  float dist = length(rel);
  vAlpha = 1.0 - smoothstep(0.42 * uBox.x, 0.5 * uBox.x, dist);
  vec4 mv = viewMatrix * vec4(world, 1.0);
  // About 5 cm across (a clump of flakes), a couple of pixels at the far side of the box.
  gl_PointSize = clamp(uScale * (0.045 + 0.035 * aSeed.w) / max(-mv.z, 0.2), 1.5, 14.0);
  gl_Position = projectionMatrix * mv;
}
`;

const fragmentShader = /* glsl */ `
uniform vec3 uColor;
uniform float uOpacity;
varying float vAlpha;

void main() {
  vec2 c = gl_PointCoord * 2.0 - 1.0;
  float r = dot(c, c);
  if (r > 1.0) discard;
  gl_FragColor = vec4(uColor, vAlpha * uOpacity * (1.0 - r * r));
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

export function createSnowfall(capacity: number): Snowfall {
  const seeds = new Float32Array(MAX_FLAKES * 4);
  // Seeded, so the same snow falls every run (and screenshots repeat).
  let state = 0x2545f491;
  const rand = (): number => {
    state = (Math.imul(state ^ (state >>> 15), 0x2c1b3c6d) + 0x297a2d39) | 0;
    return ((state ^ (state >>> 12)) >>> 0) / 4294967296;
  };
  for (let k = 0; k < MAX_FLAKES * 4; k++) seeds[k] = rand();
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(MAX_FLAKES * 3), 3));
  geometry.setAttribute('aSeed', new THREE.BufferAttribute(seeds, 4));
  geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e9);
  const uniforms = {
    uTime: { value: 0 },
    uCamera: { value: new THREE.Vector3() },
    uVelocity: { value: new THREE.Vector3(0, -FALL_MS, 0) },
    uBox: { value: BOX.clone() },
    uScale: { value: 800 },
    uColor: { value: new THREE.Color(0xf2f5f8) },
    uOpacity: { value: 0 },
  };
  const material = new THREE.ShaderMaterial({
    uniforms,
    vertexShader,
    fragmentShader,
    transparent: true,
    depthWrite: false,
  });
  const points = new THREE.Points(geometry, material);
  points.name = 'snowfall';
  points.frustumCulled = false;
  points.visible = false;
  points.renderOrder = 3;
  let max = Math.min(capacity, MAX_FLAKES);
  let drawn = 0;

  return {
    points,
    get drawn() {
      return drawn;
    },
    setCapacity(n) {
      max = Math.min(Math.max(0, n), MAX_FLAKES);
    },
    update(camera, snow01, drift, light, time) {
      drawn = Math.floor(max * Math.min(1, Math.max(0, snow01)));
      points.visible = drawn > 0;
      if (!points.visible) return;
      geometry.setDrawRange(0, drawn);
      uniforms.uTime.value = time;
      uniforms.uCamera.value.copy(camera);
      uniforms.uVelocity.value.set(drift.x, -FALL_MS, drift.z);
      uniforms.uOpacity.value = 0.55 + 0.35 * snow01;
      uniforms.uColor.value.setHex(0xe4eaf0).multiplyScalar(0.18 + 0.72 * Math.min(1, light));
      // Points are sized in pixels: scale by the drawing buffer's height.
      uniforms.uScale.value = Math.max(400, window.innerHeight * window.devicePixelRatio * 1.1);
    },
    dispose() {
      geometry.dispose();
      material.dispose();
    },
  };
}
