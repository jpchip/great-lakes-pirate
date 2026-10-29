import * as THREE from 'three';
import type { WakeShip, WaterlineHull } from './wake';
import { wakeStrength } from './wake';
import type { Water } from './water';

/**
 * Bow spray (plan 02 §8, plan 14 §10): a few toon puffs thrown off the bow, more at speed
 * and when the bow drops into a wave. One point-sprite draw call for every ship, from a
 * pool whose size the quality preset sets (0 turns spray off).
 */

const GRAVITY = 9.81;
/** Puffs per second at full speed with the bow level; plunging adds up to 4× that. */
const BASE_RATE = 10;
const PLUNGE_GAIN = 3;
/** Bow pitch rate (rad/s, bow down) that counts as a full plunge. */
const FULL_PLUNGE = 0.12;

const vertexShader = /* glsl */ `
#include <common>
#include <fog_pars_vertex>
uniform float uScale;
attribute float aSize;
attribute float aAge;
varying float vAge;
varying float vSeed;

void main() {
  vAge = aAge;
  vSeed = fract(float(gl_VertexID) * 0.618034);
  vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
  gl_PointSize = aAge >= 1.0 ? 0.0 : aSize * uScale / max(-mvPosition.z, 0.1);
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}
`;

const fragmentShader = /* glsl */ `
#include <common>
#include <fog_pars_fragment>
uniform vec3 uFoamColor;
uniform vec3 uCrestColor;
varying float vAge;
varying float vSeed;

void main() {
  vec2 c = gl_PointCoord * 2.0 - 1.0;
  // A lumpy disc that dissolves from the edge as it ages.
  float lumps = 0.12 * sin(atan(c.y, c.x) * 5.0 + vSeed * 30.0);
  float r = length(c) + lumps;
  if (r > 1.0 - 0.75 * vAge * vAge) discard;
  vec3 color = r > 0.6 - 0.3 * vAge ? mix(uCrestColor, uFoamColor, 0.55) : uFoamColor;
  gl_FragColor = vec4(color, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  #include <fog_fragment>
}
`;

export interface Spray {
  readonly points: THREE.Points;
  /** Resize the pool (quality preset); 0 hides spray. */
  setCapacity(n: number): void;
  /**
   * Throws spray off a ship's bow for `dt` real seconds. `key` tells ships apart so each
   * keeps its own plunge and emission state.
   */
  emit(key: object, ship: WakeShip & { pitch: number }, hull: WaterlineHull, dt: number): void;
  /** Moves the puffs on by `dt` real seconds. */
  update(dt: number): void;
}

interface Source {
  lastPitch: number;
  carry: number;
}

export function createSpray(capacity: number, water: Water): Spray {
  const w = water.material.uniforms;
  const material = new THREE.ShaderMaterial({
    uniforms: {
      ...THREE.UniformsUtils.clone(THREE.UniformsLib.fog),
      uScale: { value: 1 },
      uFoamColor: w.uFoamColor,
      uCrestColor: w.uCrestColor,
    },
    vertexShader,
    fragmentShader,
    fog: true,
  });
  const scale = material.uniforms['uScale'] as THREE.IUniform<number>;
  const size = new THREE.Vector2();

  let n = 0;
  let positions = new Float32Array(0);
  let velocities = new Float32Array(0);
  let ages = new Float32Array(0);
  let lives = new Float32Array(0);
  let sizes = new Float32Array(0);
  let next = 0;
  const geometry = new THREE.BufferGeometry();
  const points = new THREE.Points(geometry, material);
  points.name = 'spray';
  points.frustumCulled = false;
  points.onBeforeRender = (renderer, _scene, camera) => {
    // Point size in pixels for a puff `aSize` meters across at depth z: size · scale / z.
    renderer.getDrawingBufferSize(size);
    scale.value = size.y * 0.5 * (camera.projectionMatrix.elements[5] ?? 1);
  };

  const sources = new WeakMap<object, Source>();

  const spray: Spray = {
    points,
    setCapacity(count) {
      n = count;
      positions = new Float32Array(n * 3);
      velocities = new Float32Array(n * 3);
      ages = new Float32Array(n).fill(1);
      lives = new Float32Array(n).fill(1);
      sizes = new Float32Array(n);
      next = 0;
      geometry.setAttribute(
        'position',
        new THREE.BufferAttribute(positions, 3).setUsage(THREE.DynamicDrawUsage),
      );
      geometry.setAttribute(
        'aAge',
        new THREE.BufferAttribute(ages, 1).setUsage(THREE.DynamicDrawUsage),
      );
      geometry.setAttribute(
        'aSize',
        new THREE.BufferAttribute(sizes, 1).setUsage(THREE.DynamicDrawUsage),
      );
      points.visible = n > 0;
    },
    emit(key, ship, hull, dt) {
      let source = sources.get(key);
      if (!source) {
        source = { lastPitch: ship.pitch, carry: 0 };
        sources.set(key, source);
      }
      const pitchRate = dt > 0 ? (ship.pitch - source.lastPitch) / dt : 0;
      source.lastPitch = ship.pitch;
      if (n === 0 || dt <= 0) return;
      const strength = wakeStrength(ship.speed);
      if (strength <= 0) {
        source.carry = 0;
        return;
      }
      const plunge = Math.min(1, Math.max(0, -pitchRate / FULL_PLUNGE));
      source.carry += BASE_RATE * strength * strength * (1 + PLUNGE_GAIN * plunge) * dt;

      const fx = Math.sin(ship.heading);
      const fz = -Math.cos(ship.heading);
      const vx = Math.sin(ship.course) * ship.speed;
      const vz = -Math.cos(ship.course) * ship.speed;
      const bow = -hull.bowZ - 0.05 * (hull.sternZ - hull.bowZ);
      while (source.carry >= 1) {
        source.carry -= 1;
        const i = next;
        next = (next + 1) % n;
        const side = Math.random() < 0.5 ? -1 : 1;
        const out = (2 + 3 * Math.random()) * (0.5 + strength);
        const up = (2.5 + 3.5 * Math.random()) * (0.6 + 0.6 * strength) * (1 + plunge * 0.6);
        // Starboard is (−fz, fx).
        positions[i * 3] = ship.x + fx * bow - fz * side * hull.beam * 0.3;
        positions[i * 3 + 1] = 0.6;
        positions[i * 3 + 2] = ship.z + fz * bow + fx * side * hull.beam * 0.3;
        velocities[i * 3] = vx * 0.6 - fz * side * out;
        velocities[i * 3 + 1] = up;
        velocities[i * 3 + 2] = vz * 0.6 + fx * side * out;
        ages[i] = 0;
        lives[i] = 0.8 + 0.6 * Math.random();
        sizes[i] = 0.9 + 0.9 * Math.random() + strength;
      }
    },
    update(dt) {
      if (n === 0 || dt <= 0) return;
      for (let i = 0; i < n; i++) {
        if ((ages[i] ?? 1) >= 1) continue;
        const k = i * 3;
        velocities[k + 1] = (velocities[k + 1] ?? 0) - GRAVITY * dt;
        // Air drag slows the sideways throw.
        velocities[k] = (velocities[k] ?? 0) * (1 - 0.8 * dt);
        velocities[k + 2] = (velocities[k + 2] ?? 0) * (1 - 0.8 * dt);
        positions[k] = (positions[k] ?? 0) + (velocities[k] ?? 0) * dt;
        positions[k + 1] = (positions[k + 1] ?? 0) + (velocities[k + 1] ?? 0) * dt;
        positions[k + 2] = (positions[k + 2] ?? 0) + (velocities[k + 2] ?? 0) * dt;
        ages[i] = Math.min(1, (ages[i] ?? 1) + dt / (lives[i] ?? 1));
        sizes[i] = (sizes[i] ?? 0) * (1 + 0.6 * dt);
        if ((positions[k + 1] ?? 0) < -1) ages[i] = 1;
      }
      for (const name of ['position', 'aAge', 'aSize']) {
        const attr = geometry.getAttribute(name);
        if (attr) attr.needsUpdate = true;
      }
    },
  };
  spray.setCapacity(capacity);
  return spray;
}
