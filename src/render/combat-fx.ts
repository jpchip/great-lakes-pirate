import * as THREE from 'three';

/**
 * Gunfire you can see (plan 07 §3; Phase 6 piece B): powder smoke rolling off the muzzle
 * and drifting downwind, the flash, splinters off a hull that's struck, and torn canvas
 * fluttering down from a rig. One point-sprite draw call for all of it, from a fixed pool;
 * the splash of a ball in the water is the spray's column.
 */

const CAPACITY = 900;
const GRAVITY = 9.81;

type Kind = 'smoke' | 'flash' | 'splinter' | 'canvas';

const COLORS: Record<Kind, THREE.Color> = {
  smoke: new THREE.Color(0xd9d6cf),
  flash: new THREE.Color(0xffc46b),
  splinter: new THREE.Color(0x6b4a2b),
  canvas: new THREE.Color(0xeee6d2),
};

const vertexShader = /* glsl */ `
#include <common>
#include <fog_pars_vertex>
uniform float uScale;
attribute float aSize;
attribute float aAge;
attribute float aSoft;
attribute vec3 aColor;
varying float vAge;
varying float vSoft;
varying vec3 vColor;

void main() {
  vAge = aAge;
  vSoft = aSoft;
  vColor = aColor;
  vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
  gl_PointSize = aAge >= 1.0 ? 0.0 : max(1.5, aSize * uScale / max(-mvPosition.z, 0.1));
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}
`;

const fragmentShader = /* glsl */ `
#include <common>
#include <fog_pars_fragment>
varying float vAge;
varying float vSoft;
varying vec3 vColor;

void main() {
  vec2 c = gl_PointCoord * 2.0 - 1.0;
  float r = length(c);
  if (r > 1.0) discard;
  // Smoke is a soft puff that thins as it spreads; chips and canvas are hard flecks.
  float alpha = vSoft > 0.5 ? (1.0 - r * r) * (1.0 - vAge) * 0.6 : 1.0 - vAge * vAge;
  gl_FragColor = vec4(vColor, alpha);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  #include <fog_fragment>
}
`;

export interface CombatFx {
  readonly points: THREE.Points;
  /** A gun goes off at `at` (muzzle, meters) laid on `bearing` (radians from north). */
  muzzle(at: { x: number; y: number; z: number }, bearing: number, guns?: number): void;
  /** A ball strikes a ship: splinters off the hull or deck, canvas from the rig. */
  hit(at: { x: number; y: number; z: number }, aloft: boolean): void;
  /** Moves everything on by `dt` real seconds, the smoke carried by the wind (m/s). */
  update(dt: number, wind: { x: number; z: number }): void;
  /** Live particles (tests and the dev readout). */
  live(): number;
}

export function createCombatFx(): CombatFx {
  const material = new THREE.ShaderMaterial({
    uniforms: { ...THREE.UniformsUtils.clone(THREE.UniformsLib.fog), uScale: { value: 1 } },
    vertexShader,
    fragmentShader,
    fog: true,
    transparent: true,
    depthWrite: false,
  });
  const scale = material.uniforms['uScale'] as THREE.IUniform<number>;
  const size = new THREE.Vector2();

  const positions = new Float32Array(CAPACITY * 3);
  const velocities = new Float32Array(CAPACITY * 3);
  const ages = new Float32Array(CAPACITY).fill(1);
  const lives = new Float32Array(CAPACITY).fill(1);
  const sizes = new Float32Array(CAPACITY);
  const grow = new Float32Array(CAPACITY);
  const soft = new Float32Array(CAPACITY);
  const colors = new Float32Array(CAPACITY * 3);
  const kinds: Kind[] = new Array<Kind>(CAPACITY).fill('smoke');
  let next = 0;

  const geometry = new THREE.BufferGeometry();
  const attr = (name: string, array: Float32Array, n: number): void => {
    geometry.setAttribute(
      name,
      new THREE.BufferAttribute(array, n).setUsage(THREE.DynamicDrawUsage),
    );
  };
  attr('position', positions, 3);
  attr('aAge', ages, 1);
  attr('aSize', sizes, 1);
  attr('aSoft', soft, 1);
  attr('aColor', colors, 3);
  const points = new THREE.Points(geometry, material);
  points.name = 'combat-fx';
  points.frustumCulled = false;
  points.renderOrder = 2;
  points.onBeforeRender = (renderer, _scene, camera) => {
    renderer.getDrawingBufferSize(size);
    scale.value = size.y * 0.5 * (camera.projectionMatrix.elements[5] ?? 1);
  };

  const spawn = (
    kind: Kind,
    p: { x: number; y: number; z: number },
    v: { x: number; y: number; z: number },
    life: number,
    sizeM: number,
    growMs = 0,
  ): void => {
    const i = next;
    next = (next + 1) % CAPACITY;
    positions[i * 3] = p.x;
    positions[i * 3 + 1] = p.y;
    positions[i * 3 + 2] = p.z;
    velocities[i * 3] = v.x;
    velocities[i * 3 + 1] = v.y;
    velocities[i * 3 + 2] = v.z;
    ages[i] = 0;
    lives[i] = life;
    sizes[i] = sizeM;
    grow[i] = growMs;
    soft[i] = kind === 'smoke' || kind === 'flash' ? 1 : 0;
    const c = COLORS[kind];
    // A little variety in the shade, so a cloud isn't one flat grey.
    const shade = kind === 'flash' ? 1 : 0.85 + Math.random() * 0.15;
    colors[i * 3] = c.r * shade;
    colors[i * 3 + 1] = c.g * shade;
    colors[i * 3 + 2] = c.b * shade;
    kinds[i] = kind;
  };

  let alive = 0;
  return {
    points,
    muzzle(at, bearing, guns = 1) {
      const fx = Math.sin(bearing);
      const fz = -Math.cos(bearing);
      for (let g = 0; g < Math.max(1, guns); g++) {
        spawn('flash', at, { x: fx * 6, y: 0.5, z: fz * 6 }, 0.14, 3.2);
        // A broadside's cloud billows out from her side and hangs there, downwind.
        for (let k = 0; k < 18; k++) {
          const out = 10 + Math.random() * 26;
          const side = (Math.random() - 0.5) * 6;
          spawn(
            'smoke',
            {
              x: at.x + (Math.random() - 0.5) * 0.8,
              y: at.y + (Math.random() - 0.5) * 0.6,
              z: at.z + (Math.random() - 0.5) * 0.8,
            },
            { x: fx * out - fz * side, y: 2 + Math.random() * 4, z: fz * out + fx * side },
            6 + Math.random() * 4,
            3 + Math.random() * 2,
            2.5 + Math.random() * 1.5,
          );
        }
      }
    },
    hit(at, aloft) {
      if (aloft) {
        for (let k = 0; k < 16; k++) {
          const a = Math.random() * Math.PI * 2;
          const out = 1 + Math.random() * 3;
          spawn(
            'canvas',
            at,
            { x: Math.cos(a) * out, y: 1 + Math.random() * 2, z: Math.sin(a) * out },
            2.5 + Math.random() * 2,
            0.5 + Math.random() * 0.5,
          );
        }
        return;
      }
      for (let k = 0; k < 22; k++) {
        const a = Math.random() * Math.PI * 2;
        const out = 3 + Math.random() * 7;
        spawn(
          'splinter',
          at,
          { x: Math.cos(a) * out, y: 3 + Math.random() * 7, z: Math.sin(a) * out },
          1.2 + Math.random() * 0.8,
          0.25 + Math.random() * 0.3,
        );
      }
      // A puff of dust and splinters' smoke where she was struck.
      for (let k = 0; k < 4; k++) {
        spawn('smoke', at, { x: 0, y: 1, z: 0 }, 1.5, 1.2, 1.5);
      }
    },
    update(dt, wind) {
      if (dt <= 0) return;
      alive = 0;
      for (let i = 0; i < CAPACITY; i++) {
        if ((ages[i] ?? 1) >= 1) continue;
        alive++;
        const kind = kinds[i];
        const vx = velocities[i * 3] ?? 0;
        const vy = velocities[i * 3 + 1] ?? 0;
        const vz = velocities[i * 3 + 2] ?? 0;
        let nvx = vx;
        let nvy = vy;
        let nvz = vz;
        if (kind === 'smoke' || kind === 'flash') {
          // Drag pulls the puff to the wind's speed; it rises a little, warm.
          const k = 1 - Math.exp(-dt * 0.8);
          nvx += (wind.x - vx) * k;
          nvz += (wind.z - vz) * k;
          nvy += (1.2 - vy) * k;
          sizes[i] = (sizes[i] ?? 0) + (grow[i] ?? 0) * dt;
        } else if (kind === 'canvas') {
          // Flutters down slowly, carried by the wind.
          const k = 1 - Math.exp(-dt * 2);
          nvx += (wind.x * 0.6 - vx) * k + (Math.random() - 0.5) * 4 * dt;
          nvz += (wind.z * 0.6 - vz) * k + (Math.random() - 0.5) * 4 * dt;
          nvy += (-1.2 - vy) * k;
        } else {
          nvy -= GRAVITY * dt;
        }
        velocities[i * 3] = nvx;
        velocities[i * 3 + 1] = nvy;
        velocities[i * 3 + 2] = nvz;
        positions[i * 3] = (positions[i * 3] ?? 0) + nvx * dt;
        positions[i * 3 + 1] = (positions[i * 3 + 1] ?? 0) + nvy * dt;
        positions[i * 3 + 2] = (positions[i * 3 + 2] ?? 0) + nvz * dt;
        // Flecks that reach the water are gone.
        if (kind !== 'smoke' && kind !== 'flash' && (positions[i * 3 + 1] ?? 0) < 0) ages[i] = 1;
        else ages[i] = Math.min(1, (ages[i] ?? 1) + dt / (lives[i] ?? 1));
      }
      for (const name of ['position', 'aAge', 'aSize', 'aSoft', 'aColor']) {
        (geometry.getAttribute(name) as THREE.BufferAttribute).needsUpdate = true;
      }
    },
    live() {
      return alive;
    },
  };
}
