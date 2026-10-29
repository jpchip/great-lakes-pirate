import * as THREE from 'three';
import { noiseChunk, waveDisplacementChunk, waveUniformsChunk } from './wave-glsl';
import type { Water } from './water';

/**
 * Bow wave and wake (plan 02 §8, plan 14 §10): ribbons of foam on the water behind each
 * moving ship, one draw call per ship. Three trails per ship: the two arms of the bow
 * wave, which start at the bow's shoulders and spread outward as the ship passes (a
 * Kelvin wedge, a little wider than real so 24 visual knots read), and the churned
 * wake from the stern, which widens and fades.
 *
 * Trail points stay where the water was when they were laid (plus their spread), so the
 * wake marks the ship's track. The vertex shader floats the ribbons on the same waves as
 * the water (wave-glsl.ts) with the same grid fade, so they don't sink into the swell.
 * Toon look: opaque with a dissolve edge, white foam over a band of lighter churned
 * water, so there is no blending to sort.
 */

/** Where the hull meets the water, in the model's frame (bow toward −z, y up). */
export interface WaterlineHull {
  /** z of the bow and the stern at the waterline. */
  bowZ: number;
  sternZ: number;
  /** Widest beam at the waterline. */
  beam: number;
}

/** Waterline band: geometry between these heights counts as the hull at the water. */
const WATERLINE_MIN_Y = -0.6;
const WATERLINE_MAX_Y = 0.8;

/**
 * Measures a model's waterline footprint from its vertices near y = 0, so the bowsprit
 * and the overhanging counter don't count.
 */
export function measureWaterline(object: THREE.Object3D): WaterlineHull {
  let bowZ = Infinity;
  let sternZ = -Infinity;
  let halfBeam = 0;
  const v = new THREE.Vector3();
  const toRoot = new THREE.Matrix4();
  object.updateWorldMatrix(true, true);
  const rootInverse = object.matrixWorld.clone().invert();
  object.traverse((child) => {
    const mesh = child as THREE.Mesh;
    const position = mesh.isMesh ? mesh.geometry.getAttribute('position') : undefined;
    if (!position) return;
    toRoot.multiplyMatrices(rootInverse, mesh.matrixWorld);
    for (let i = 0; i < position.count; i++) {
      v.fromBufferAttribute(position, i).applyMatrix4(toRoot);
      if (v.y < WATERLINE_MIN_Y || v.y > WATERLINE_MAX_Y) continue;
      bowZ = Math.min(bowZ, v.z);
      sternZ = Math.max(sternZ, v.z);
      halfBeam = Math.max(halfBeam, Math.abs(v.x));
    }
  });
  if (!Number.isFinite(bowZ)) return { bowZ: -10, sternZ: 10, beam: 5 };
  return { bowZ, sternZ, beam: halfBeam * 2 };
}

export type TrailKind = 'stern' | 'port' | 'starboard';

interface TrailStyle {
  /** Real seconds a point lasts. */
  lifetime: number;
  /** Ribbon half-width when laid and when it dies, as a fraction of the beam. */
  halfWidth0: number;
  halfWidth1: number;
}

export const TRAIL_STYLES: Record<TrailKind, TrailStyle> = {
  stern: { lifetime: 9, halfWidth0: 0.3, halfWidth1: 1.1 },
  port: { lifetime: 5, halfWidth0: 0.12, halfWidth1: 0.4 },
  starboard: { lifetime: 5, halfWidth0: 0.12, halfWidth1: 0.4 },
};

/** Points per trail. At most this many are alive; spacing stretches at speed to fit. */
export const TRAIL_POINTS = 48;
/** Closest spacing of trail points, meters. */
const MIN_SPACING_M = 2.5;
/** A point every this many seconds even when barely moving, so the head never stalls. */
const MAX_INTERVAL_S = 0.5;
/** Half-angle of the bow-wave wedge; the real Kelvin angle is 19.5°. */
export const WEDGE_ANGLE = (24 * Math.PI) / 180;
/** Scene speed (m/s) at which the wake is at full strength (about 20 visual knots). */
const FULL_WAKE_MS = 10;

export interface TrailPoint {
  x: number;
  z: number;
  /** Sideways spread, m/s. */
  vx: number;
  vz: number;
  /** Real seconds when laid. */
  born: number;
  /** 0–1, from the ship's speed when laid. */
  strength: number;
  /** Distance along the trail when laid, meters (noise coordinate). */
  along: number;
}

/** One trail: a ring of points, oldest first. Pure, so it is unit tested. */
export class Trail {
  readonly points: TrailPoint[] = [];
  private along = 0;
  private lastX = Number.NaN;
  private lastZ = Number.NaN;
  private lastBorn = -Infinity;

  constructor(readonly style: TrailStyle) {}

  /**
   * The emitter is at (x, z) at real time `now`, moving at `speed` m/s; spread points
   * move sideways at (vx, vz). Lays a point when the emitter has moved far enough.
   */
  update(now: number, x: number, z: number, speed: number, vx: number, vz: number): void {
    // Forget points that have died.
    const life = this.style.lifetime;
    let dead = 0;
    while (dead < this.points.length && now - (this.points[dead] as TrailPoint).born >= life)
      dead++;
    if (dead) this.points.splice(0, dead);

    const moved = Number.isNaN(this.lastX) ? Infinity : Math.hypot(x - this.lastX, z - this.lastZ);
    const spacing = Math.max(MIN_SPACING_M, (Math.abs(speed) * life) / (TRAIL_POINTS - 2));
    if (moved < spacing && now - this.lastBorn < MAX_INTERVAL_S) return;
    if (Number.isFinite(moved)) this.along += moved;
    if (this.points.length >= TRAIL_POINTS) this.points.shift();
    this.points.push({
      x,
      z,
      vx,
      vz,
      born: now,
      strength: wakeStrength(speed),
      along: this.along,
    });
    this.lastX = x;
    this.lastZ = z;
    this.lastBorn = now;
  }

  /** Where point `p` is at `now`: laid position plus its spread. */
  positionAt(p: TrailPoint, now: number, out: { x: number; z: number }): { x: number; z: number } {
    const age = now - p.born;
    out.x = p.x + p.vx * age;
    out.z = p.z + p.vz * age;
    return out;
  }

  /** Distance along the trail at the newest point, meters. */
  get headAlong(): number {
    return this.along;
  }
}

/** Wake strength 0–1 for a scene speed (forward m/s); none going astern. */
export function wakeStrength(speed: number): number {
  const t = Math.min(1, Math.max(0, speed / FULL_WAKE_MS));
  return t * t * (3 - 2 * t);
}

const vertexShader = /* glsl */ `
#include <common>
#include <fog_pars_vertex>
${waveUniformsChunk}
uniform float uGridOffset;
uniform float uGridGrowth;
uniform vec2 uGridCenter;
${waveDisplacementChunk}
attribute vec4 aWake; // age 0–1, across −1…1, along m, strength
varying vec4 vWake;
varying vec2 vRestPos;

void main() {
  vec2 p0 = position.xz;
  float dist = distance(p0, cameraPosition.xz);
  float spacing = (distance(p0, uGridCenter) + uGridOffset) * uGridGrowth;
  vec3 world = vec3(p0.x, 0.12, p0.y) + waveDisplacement(p0, dist, spacing);
  vWake = aWake;
  vRestPos = p0;
  vec4 mvPosition = viewMatrix * vec4(world, 1.0);
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}
`;

const fragmentShader = /* glsl */ `
#include <common>
#include <fog_pars_fragment>
${noiseChunk}
uniform vec3 uFoamColor;
uniform vec3 uCrestColor;
varying vec4 vWake;
varying vec2 vRestPos;

void main() {
  float age = vWake.x;
  float across = vWake.y;
  // Strongest when new, along the middle of the ribbon.
  float foam = vWake.w * pow(1.0 - age, 1.4) * (1.0 - 0.7 * across * across);
  float n = valueNoise(vRestPos * 0.55 + vec2(vWake.z * 0.05, 0.0)) * 0.6
          + valueNoise(vRestPos * 1.7) * 0.4;
  float f = foam + (n - 0.5) * 0.7;
  if (f < 0.22) discard;
  // Two toon steps: white foam, then lighter churned water around it.
  vec3 churn = mix(uCrestColor, uFoamColor, 0.4);
  gl_FragColor = vec4(f > 0.5 ? uFoamColor : churn, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  #include <fog_fragment>
}
`;

const KINDS: readonly TrailKind[] = ['stern', 'port', 'starboard'];
/** Vertices per trail: two per point plus two for the live head at the emitter. */
const TRAIL_VERTS = (TRAIL_POINTS + 1) * 2;

/** The pose and speed a ship's wake follows, in zone meters and real seconds. */
export interface WakeShip {
  x: number;
  z: number;
  /** Radians clockwise from north. */
  heading: number;
  /** Direction of travel (heading plus leeway). */
  course: number;
  /** Scene speed through the water, m/s (negative astern). */
  speed: number;
}

export interface ShipWake {
  readonly mesh: THREE.Mesh;
  /** Lays and ages trail points and rebuilds the ribbons; `now` is real seconds. */
  update(ship: WakeShip, now: number): void;
  dispose(): void;
}

/**
 * A ship's bow wave and wake. `water` supplies the wave uniforms (shared, so they stay
 * in step) and the colors the environment sets.
 */
export function createShipWake(hull: WaterlineHull, water: Water): ShipWake {
  const w = water.material.uniforms;
  const material = new THREE.ShaderMaterial({
    uniforms: {
      ...THREE.UniformsUtils.clone(THREE.UniformsLib.fog),
      uTime: w.uTime,
      uWaveCount: w.uWaveCount,
      uWaveA: w.uWaveA,
      uWaveB: w.uWaveB,
      uSeaScale: w.uSeaScale,
      uSeaScaleRect: w.uSeaScaleRect,
      uGridOffset: w.uGridOffset,
      uGridGrowth: w.uGridGrowth,
      uGridCenter: { value: new THREE.Vector2() },
      uFoamColor: w.uFoamColor,
      uCrestColor: w.uCrestColor,
    },
    vertexShader,
    fragmentShader,
    fog: true,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
  });
  const gridCenter = material.uniforms['uGridCenter']?.value as THREE.Vector2;

  const count = KINDS.length * TRAIL_VERTS;
  const positions = new Float32Array(count * 3);
  const wake = new Float32Array(count * 4);
  const indices: number[] = [];
  for (let t = 0; t < KINDS.length; t++) {
    const base = t * TRAIL_VERTS;
    for (let i = 0; i < TRAIL_POINTS; i++) {
      const a = base + i * 2;
      // Left and right of point i, then of point i + 1; counter-clockwise from above.
      indices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
  }
  const geometry = new THREE.BufferGeometry();
  const positionAttr = new THREE.BufferAttribute(positions, 3).setUsage(THREE.DynamicDrawUsage);
  const wakeAttr = new THREE.BufferAttribute(wake, 4).setUsage(THREE.DynamicDrawUsage);
  geometry.setAttribute('position', positionAttr);
  geometry.setAttribute('aWake', wakeAttr);
  geometry.setIndex(indices);
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = 'wake';
  // Vertices are in zone meters and the shader moves them; nothing to cull by.
  mesh.frustumCulled = false;
  // After the water, so the polygon offset wins against it.
  mesh.renderOrder = 1;
  mesh.onBeforeRender = () => {
    gridCenter.set(water.mesh.position.x, water.mesh.position.z);
  };

  const trails = KINDS.map((kind) => new Trail(TRAIL_STYLES[kind]));
  const length = hull.sternZ - hull.bowZ;
  const p = { x: 0, z: 0 };
  const q = { x: 0, z: 0 };

  /** Writes a trail's ribbon: its points oldest first, then the emitter as the head. */
  const writeTrail = (
    t: number,
    trail: Trail,
    head: { x: number; z: number },
    headStrength: number,
    now: number,
  ): void => {
    const style = trail.style;
    const pts = trail.points;
    const n = pts.length + 1;
    const base = t * TRAIL_VERTS;
    const centerAt = (i: number, out: { x: number; z: number }): { x: number; z: number } => {
      if (i >= pts.length) {
        out.x = head.x;
        out.z = head.z;
        return out;
      }
      return trail.positionAt(pts[i] as TrailPoint, now, out);
    };
    for (let i = 0; i < TRAIL_POINTS + 1; i++) {
      const k = Math.min(i, n - 1);
      const point = pts[k];
      const age = point ? Math.min(1, (now - point.born) / style.lifetime) : 0;
      const strength = point ? point.strength : headStrength;
      const along = point ? point.along : trail.headAlong;
      centerAt(k, p);
      // Tangent from the neighbors, so the ribbon turns smoothly.
      centerAt(Math.min(k + 1, n - 1), q);
      let tx = q.x;
      let tz = q.z;
      centerAt(Math.max(k - 1, 0), q);
      tx -= q.x;
      tz -= q.z;
      const len = Math.hypot(tx, tz) || 1;
      const half =
        hull.beam * (style.halfWidth0 + (style.halfWidth1 - style.halfWidth0) * age) * strength;
      // Left of the direction of travel, then right.
      const nx = (tz / len) * half;
      const nz = (-tx / len) * half;
      for (let side = 0; side < 2; side++) {
        const v = base + i * 2 + side;
        const sign = side === 0 ? 1 : -1;
        positions[v * 3] = p.x + nx * sign;
        positions[v * 3 + 1] = 0;
        positions[v * 3 + 2] = p.z + nz * sign;
        wake[v * 4] = age;
        wake[v * 4 + 1] = sign;
        wake[v * 4 + 2] = along;
        wake[v * 4 + 3] = strength;
      }
    }
  };

  return {
    mesh,
    update(ship, now) {
      // Forward and starboard on the water plane (x east, z south).
      const fx = Math.sin(ship.heading);
      const fz = -Math.cos(ship.heading);
      const rx = -fz;
      const rz = fx;
      const strength = wakeStrength(ship.speed);
      const forward = Math.max(ship.speed, 0);
      const spread = forward * Math.tan(WEDGE_ANGLE);
      // Bow shoulders a little aft of the stem, stern at the transom.
      const shoulder = -hull.bowZ - 0.12 * length;
      const out = hull.beam * 0.42;
      const emitters: Record<TrailKind, { x: number; z: number; vx: number; vz: number }> = {
        stern: { x: ship.x - fx * hull.sternZ, z: ship.z - fz * hull.sternZ, vx: 0, vz: 0 },
        port: {
          x: ship.x + fx * shoulder - rx * out,
          z: ship.z + fz * shoulder - rz * out,
          vx: -rx * spread,
          vz: -rz * spread,
        },
        starboard: {
          x: ship.x + fx * shoulder + rx * out,
          z: ship.z + fz * shoulder + rz * out,
          vx: rx * spread,
          vz: rz * spread,
        },
      };
      KINDS.forEach((kind, t) => {
        const e = emitters[kind];
        const trail = trails[t] as Trail;
        trail.update(now, e.x, e.z, ship.speed, e.vx, e.vz);
        writeTrail(t, trail, e, strength, now);
      });
      positionAttr.needsUpdate = true;
      wakeAttr.needsUpdate = true;
    },
    dispose() {
      geometry.dispose();
      material.dispose();
    },
  };
}
