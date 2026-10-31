import * as THREE from 'three';
import type { LightKind } from './npc-lines';

/**
 * Ships' running lights at night (Phase 3 piece H; plan 03 §6.3: "running lights cut
 * through the night fog, so a ship reads before its hull"). One point sprite per lamp,
 * all of a ship's lamps in one draw call, each screened to its arc as the rules of the
 * road had it in 1900:
 *
 * - masthead (steamers, on the foremast) and the Great Lakes range light aft: white,
 *   from dead ahead to two points abaft the beam on either side (225°);
 * - port red and starboard green: dead ahead to two points abaft the beam on their side;
 * - stern: white, astern (135°); towing: white all round.
 *
 * So from ahead you see red and green, from abeam one color, from astern the white
 * stern light. A lamp keeps a few pixels at any range and fades in fog like the
 * lighthouses' glare, and the hull still hides it (depth test). Additive, no sorting.
 */

const DEG = Math.PI / 180;
/** Lamp colors: warm oil-lamp white, and the sidelights' red and green glass. */
export const LAMP_COLORS: Record<LightKind, number> = {
  masthead: 0xfff1d0,
  range: 0xfff1d0,
  stern: 0xfff1d0,
  towing: 0xfff1d0,
  port: 0xff3b2e,
  starboard: 0x3dff86,
};

/** Each kind's arc: the direction it faces (ship frame, bow -z) and half its arc. */
export function lampArc(kind: LightKind): { dirX: number; dirZ: number; halfArc: number } {
  const side = 112.5 * DEG;
  switch (kind) {
    case 'masthead':
    case 'range':
      return { dirX: 0, dirZ: -1, halfArc: side };
    case 'port':
      return { dirX: -Math.sin(side / 2), dirZ: -Math.cos(side / 2), halfArc: side / 2 };
    case 'starboard':
      return { dirX: Math.sin(side / 2), dirZ: -Math.cos(side / 2), halfArc: side / 2 };
    case 'stern':
      return { dirX: 0, dirZ: 1, halfArc: 67.5 * DEG };
    case 'towing':
      return { dirX: 0, dirZ: -1, halfArc: Math.PI };
  }
}

/**
 * Whether a lamp shows toward a viewer at `bearing` radians off the bow (clockwise,
 * starboard positive): the same test the shader makes, for tests and the lookout.
 */
export function lampVisible(kind: LightKind, bearing: number): boolean {
  const arc = lampArc(kind);
  const dx = Math.sin(bearing);
  const dz = -Math.cos(bearing);
  return dx * arc.dirX + dz * arc.dirZ >= Math.cos(arc.halfArc) - 1e-9;
}

export interface Lamp {
  kind: LightKind;
  position: THREE.Vector3;
}

export interface RunningLights {
  readonly points: THREE.Points;
  /** Lamp brightness 0–1 (lit from dusk, `lampLevel`), and the scene fog's density. */
  update(level: number, fogDensity: number): void;
  dispose(): void;
}

const vertexShader = /* glsl */ `
  attribute vec3 color;
  attribute vec3 aDir;
  attribute float aCos;
  uniform float uSize;
  uniform float uMinPx;
  uniform float uPxPerM;
  uniform float uLevel;
  uniform float uFog;
  varying vec3 vColor;
  varying float vGain;
  void main() {
    vec4 world = modelMatrix * vec4(position, 1.0);
    vec3 toEye = cameraPosition - world.xyz;
    vec2 eye = normalize(toEye.xz + vec2(1e-5, 0.0));
    vec3 facing = mat3(modelMatrix) * aDir;
    vec2 dir = normalize(facing.xz + vec2(1e-5, 0.0));
    // Screened to its arc, with a soft edge a couple of degrees wide.
    float shown = smoothstep(aCos - 0.03, aCos + 0.01, dot(eye, dir));
    float dist = length(toEye);
    float fogged = exp(-pow(dist * uFog * 0.55, 2.0));
    vGain = uLevel * shown * fogged;
    vColor = color;
    vec4 mv = viewMatrix * world;
    gl_Position = projectionMatrix * mv;
    gl_PointSize = vGain > 0.002 ? max(uMinPx, uSize * uPxPerM / -mv.z) : 0.0;
  }
`;

const fragmentShader = /* glsl */ `
  varying vec3 vColor;
  varying float vGain;
  void main() {
    float r = length(gl_PointCoord - 0.5) * 2.0;
    if (r > 1.0) discard;
    float core = 1.0 - smoothstep(0.0, 0.35, r);
    float halo = pow(1.0 - r, 2.2) * 0.55;
    vec3 c = mix(vColor, vec3(1.0), core * 0.5) * (core + halo) * vGain * 1.6;
    gl_FragColor = vec4(c, 1.0);
  }
`;

export function createRunningLights(lamps: readonly Lamp[], sizeM = 1.6): RunningLights {
  const geometry = new THREE.BufferGeometry();
  const positions: number[] = [];
  const colors: number[] = [];
  const dirs: number[] = [];
  const cosines: number[] = [];
  const c = new THREE.Color();
  for (const lamp of lamps) {
    positions.push(lamp.position.x, lamp.position.y, lamp.position.z);
    c.set(LAMP_COLORS[lamp.kind]);
    colors.push(c.r, c.g, c.b);
    const arc = lampArc(lamp.kind);
    dirs.push(arc.dirX, 0, arc.dirZ);
    cosines.push(Math.cos(arc.halfArc));
  }
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geometry.setAttribute('aDir', new THREE.Float32BufferAttribute(dirs, 3));
  geometry.setAttribute('aCos', new THREE.Float32BufferAttribute(cosines, 1));
  const uniforms = {
    uSize: { value: sizeM },
    uMinPx: { value: 3 },
    uPxPerM: { value: 800 },
    uLevel: { value: 0 },
    uFog: { value: 0 },
  };
  const material = new THREE.ShaderMaterial({
    uniforms,
    vertexShader,
    fragmentShader,
    blending: THREE.AdditiveBlending,
    transparent: true,
    depthWrite: false,
    toneMapped: false,
  });
  material.name = 'running-lights';
  const points = new THREE.Points(geometry, material);
  points.name = 'running-lights';
  points.renderOrder = 3;
  points.frustumCulled = false;
  points.userData['keepMaterial'] = true;
  points.visible = false;
  const size = new THREE.Vector2();
  points.onBeforeRender = (renderer, _scene, camera) => {
    // Pixels per meter at unit distance, so a lamp's sprite is a fixed size in the world.
    renderer.getDrawingBufferSize(size);
    const fov = (camera as THREE.PerspectiveCamera).fov ?? 50;
    uniforms.uPxPerM.value = size.y / (2 * Math.tan((fov * DEG) / 2));
    uniforms.uMinPx.value = Math.max(5, size.y / 110);
  };
  return {
    points,
    update(level, fogDensity) {
      uniforms.uLevel.value = level;
      uniforms.uFog.value = fogDensity;
      points.visible = level > 0.002;
    },
    dispose() {
      geometry.dispose();
      material.dispose();
    },
  };
}
