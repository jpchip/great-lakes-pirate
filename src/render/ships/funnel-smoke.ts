import * as THREE from 'three';
import type { StyleLighting } from '../style/stylized-material';

/**
 * Funnel smoke (plan 14 §10 "chimneys … low particle count"; Phase 3 piece H): toon puffs
 * of coal smoke from every steamer's stack, all ships in one draw call. A puff leaves the
 * stack with the ship's way and a little lift, then the air takes it: it eases onto the
 * wind's drift, swells and thins, so the plume trails downwind and bends when the ship
 * turns. Like the wake, it is opaque with a dithered dissolve, so nothing needs sorting.
 * Lit by the style lighting (sky ambient and the key), so it darkens at dusk with
 * everything else and catches the sun on its upper side.
 */

export interface SmokeSource {
  /** Accumulated puffs owed, so the rate holds at any frame time. */
  owed: number;
}

export interface FunnelSmoke {
  readonly points: THREE.Points;
  readonly capacity: number;
  /** Puffs alive now. */
  readonly alive: number;
  /**
   * Emit from a stack top at `at` (world), the ship moving at `shipVelocity` and the air
   * at `wind` (both scene m/s, x and z). `radius` is the stack's, which sets the puff size.
   */
  emit(
    source: SmokeSource,
    at: THREE.Vector3,
    shipVelocity: { x: number; z: number },
    wind: { x: number; z: number },
    radius: number,
    color: THREE.Color,
    dt: number,
  ): void;
  update(dt: number): void;
  dispose(): void;
}

/** Puffs per second per stack, and a puff's life, seconds. */
export const PUFFS_PER_SECOND = 5;
export const PUFF_LIFE_S = 7;
/** Seconds for a puff to lose the ship's way and take up the wind. */
const DRAG_TAU_S = 1.4;
const RISE_MS = 3.2;

const vertexShader = /* glsl */ `
  attribute float aSize;
  attribute float aAge;
  attribute vec3 color;
  uniform float uPxPerM;
  varying vec3 vColor;
  varying float vAge;
  varying float vSeed;
  #include <fog_pars_vertex>
  void main() {
    vColor = color;
    vAge = aAge;
    vSeed = fract(sin(float(gl_VertexID) * 12.9898) * 43758.5453);
    vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * mvPosition;
    gl_PointSize = aSize > 0.0 ? aSize * uPxPerM / -mvPosition.z : 0.0;
    #include <fog_vertex>
  }
`;

const fragmentShader = /* glsl */ `
  uniform vec3 uSkyAmbient;
  uniform vec3 uKeyColor;
  uniform vec3 uKeyDirection;
  varying vec3 vColor;
  varying float vAge;
  varying float vSeed;
  #include <fog_pars_fragment>
  float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float noise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(
      mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x),
      mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x),
      f.y
    );
  }
  void main() {
    vec2 p = gl_PointCoord - 0.5;
    p.y = -p.y;
    // A lumpy round puff: lobes around a core.
    float a = atan(p.y, p.x) + vSeed * 6.28;
    float edge = 0.42 + 0.05 * sin(a * 3.0) + 0.03 * sin(a * 5.0 + 1.7);
    float r = length(p);
    if (r > edge) discard;
    // Thins as it ages: holes open in the puff from the edge in, in toon blobs rather
    // than a fine dither, so it breaks up like smoke and needs no blending.
    float n = noise(p * 5.0 + vSeed * 17.0) * 0.7 + noise(p * 11.0 - vSeed * 9.0) * 0.3;
    if (n + (1.0 - r / edge) * 0.3 < vAge * 1.35 + 0.12) discard;
    // Toon light: the top faces the sky and the key light, the underside stays dark.
    float key = step(-0.05, p.y + 0.12 * p.x) * clamp(uKeyDirection.y * 3.0, 0.0, 1.0);
    vec3 light = uSkyAmbient * (0.75 + 0.35 * p.y) + uKeyColor * key * 0.35;
    vec3 c = vColor * light;
    #ifdef USE_FOG
      // After dark, smoke takes some of the sky's color, so a plume at night is a dim
      // shape against the dark rather than ink; by day it stays coal black.
      float dark = 1.0 - clamp(dot(uSkyAmbient, vec3(0.3, 0.59, 0.11)) * 2.5, 0.0, 1.0);
      c = mix(c, fogColor, 0.35 * dark);
    #endif
    gl_FragColor = vec4(c, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
    #include <fog_fragment>
  }
`;

export function createFunnelSmoke(lighting: StyleLighting, capacity = 384): FunnelSmoke {
  const positions = new Float32Array(capacity * 3);
  const sizes = new Float32Array(capacity);
  const ages = new Float32Array(capacity);
  const colors = new Float32Array(capacity * 3);
  const velocity = new Float32Array(capacity * 3);
  const drift = new Float32Array(capacity * 2);
  const size0 = new Float32Array(capacity);
  const life = new Float32Array(capacity); // seconds lived; < 0 means free
  life.fill(-1);
  const geometry = new THREE.BufferGeometry();
  const position = new THREE.BufferAttribute(positions, 3).setUsage(THREE.DynamicDrawUsage);
  const size = new THREE.BufferAttribute(sizes, 1).setUsage(THREE.DynamicDrawUsage);
  const age = new THREE.BufferAttribute(ages, 1).setUsage(THREE.DynamicDrawUsage);
  const color = new THREE.BufferAttribute(colors, 3).setUsage(THREE.DynamicDrawUsage);
  geometry.setAttribute('position', position);
  geometry.setAttribute('aSize', size);
  geometry.setAttribute('aAge', age);
  geometry.setAttribute('color', color);
  const pxPerM = { value: 800 };
  const material = new THREE.ShaderMaterial({
    uniforms: {
      ...THREE.UniformsUtils.clone(THREE.UniformsLib.fog),
      uSkyAmbient: lighting.uniforms.uSkyAmbient,
      uKeyColor: lighting.uniforms.uKeyColor,
      uKeyDirection: lighting.uniforms.uKeyDirection,
      uPxPerM: pxPerM,
    },
    vertexShader,
    fragmentShader,
    fog: true,
  });
  material.name = 'funnel-smoke';
  const points = new THREE.Points(geometry, material);
  points.name = 'funnel-smoke';
  points.frustumCulled = false;
  points.userData['keepMaterial'] = true;
  const buffer = new THREE.Vector2();
  points.onBeforeRender = (renderer, _scene, camera) => {
    renderer.getDrawingBufferSize(buffer);
    const fov = (camera as THREE.PerspectiveCamera).fov ?? 50;
    pxPerM.value = buffer.y / (2 * Math.tan((fov * Math.PI) / 360));
  };

  let next = 0;
  let alive = 0;
  const spawn = (): number => {
    // Round-robin over the pool: the oldest puff gives way when it's full.
    for (let n = 0; n < capacity; n++) {
      const i = (next + n) % capacity;
      if ((life[i] as number) < 0) {
        next = (i + 1) % capacity;
        return i;
      }
    }
    const i = next;
    next = (next + 1) % capacity;
    alive--;
    return i;
  };

  return {
    points,
    capacity,
    get alive() {
      return alive;
    },
    emit(source, at, ship, wind, radius, tint, dt) {
      source.owed += PUFFS_PER_SECOND * dt;
      while (source.owed >= 1) {
        source.owed -= 1;
        const i = spawn();
        alive++;
        // Puffs laid during this frame spread back along the way already made.
        const back = Math.random() * dt;
        positions[i * 3] = at.x - ship.x * back + (Math.random() - 0.5) * radius * 0.6;
        positions[i * 3 + 1] = at.y + Math.random() * radius * 0.4;
        positions[i * 3 + 2] = at.z - ship.z * back + (Math.random() - 0.5) * radius * 0.6;
        velocity[i * 3] = ship.x;
        velocity[i * 3 + 1] = RISE_MS * (0.8 + Math.random() * 0.4);
        velocity[i * 3 + 2] = ship.z;
        drift[i * 2] = wind.x;
        drift[i * 2 + 1] = wind.z;
        size0[i] = radius * (2.2 + Math.random() * 0.6);
        life[i] = 0;
        const shade = 0.85 + Math.random() * 0.3;
        colors[i * 3] = tint.r * shade;
        colors[i * 3 + 1] = tint.g * shade;
        colors[i * 3 + 2] = tint.b * shade;
      }
    },
    update(dt) {
      const k = 1 - Math.exp(-dt / DRAG_TAU_S);
      for (let i = 0; i < capacity; i++) {
        const lived = life[i] as number;
        if (lived < 0) continue;
        const t = lived + dt;
        if (t >= PUFF_LIFE_S) {
          life[i] = -1;
          sizes[i] = 0;
          alive--;
          continue;
        }
        life[i] = t;
        const vx = velocity[i * 3] as number;
        const vz = velocity[i * 3 + 2] as number;
        velocity[i * 3] = vx + ((drift[i * 2] as number) - vx) * k;
        velocity[i * 3 + 2] = vz + ((drift[i * 2 + 1] as number) - vz) * k;
        velocity[i * 3 + 1] = (velocity[i * 3 + 1] as number) * (1 - k * 0.6);
        positions[i * 3] = (positions[i * 3] as number) + (velocity[i * 3] as number) * dt;
        positions[i * 3 + 1] =
          (positions[i * 3 + 1] as number) + (velocity[i * 3 + 1] as number) * dt;
        positions[i * 3 + 2] =
          (positions[i * 3 + 2] as number) + (velocity[i * 3 + 2] as number) * dt;
        const f = t / PUFF_LIFE_S;
        sizes[i] = (size0[i] as number) * (1 + 2.4 * Math.sqrt(f));
        ages[i] = f;
      }
      position.needsUpdate = true;
      size.needsUpdate = true;
      age.needsUpdate = true;
      color.needsUpdate = true;
    },
    dispose() {
      geometry.dispose();
      material.dispose();
    },
  };
}
