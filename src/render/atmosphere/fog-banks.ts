import * as THREE from 'three';
import type { ZoneFogBank } from '../../sim/weather/local-weather';

/**
 * Fog banks seen from outside (plan 04 §10, Phase 2 piece E): each bank the weather sim
 * has alive is drawn as a soft white wall standing on the water, so you can watch one come
 * across the lake long before its thick edge reaches you. Inside a bank the sim's own
 * visibility, and the exp² fog it drives, take over, so the wall fades out once the camera
 * is well inside it.
 *
 * One open cylinder per bank, all sharing a geometry and a material: the wall sits where
 * the sim's fog is half strength (three-quarters of the bank's radius). Advection fog
 * stands about 150 m tall with a billowy top; radiation fog hugs the water at about 30 m.
 * The wall softens toward its silhouette so it has no hard vertical edge, and takes a
 * lighter fog than the rest of the scene so it still shows a few kilometers out. Medium
 * and up (the preset's `fogBankSlabs`); Low has the global fog alone.
 */

const MAX_BANKS = 12;
/** Where the wall stands, as a share of the bank's radius: the sim's fog is half there. */
const WALL = 0.75;
const HEIGHT_M: Record<ZoneFogBank['kind'], number> = { advection: 150, radiation: 30 };

export interface FogBankView {
  readonly group: THREE.Group;
  /** Banks drawn this frame. */
  readonly drawn: number;
  setEnabled(on: boolean): void;
  /**
   * `fogColor` is the scene fog's color, `light` 0–1 how bright the ambient light is (so a
   * bank is dark at night), `fogDensity` the scene's exp² density, capped for the wall.
   */
  update(
    banks: readonly ZoneFogBank[],
    camera: THREE.Vector3,
    fogColor: THREE.Color,
    light: number,
    fogDensity: number,
  ): void;
  dispose(): void;
}

const vertexShader = /* glsl */ `
varying vec3 vWorldPos;
varying vec3 vNormalW;
varying float vHeight;

void main() {
  vec4 world = modelMatrix * vec4(position, 1.0);
  vWorldPos = world.xyz;
  vNormalW = normalize(vec3(position.x, 0.0, position.z));
  vHeight = position.y;
  gl_Position = projectionMatrix * viewMatrix * world;
}
`;

const fragmentShader = /* glsl */ `
uniform vec3 uColor;
uniform vec3 uFogColor;
uniform float uFogDensity;
uniform float uStrength;
uniform vec2 uCenter;
uniform float uWall;
uniform float uSeed;

varying vec3 vWorldPos;
varying vec3 vNormalW;
varying float vHeight;

float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

float vnoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash12(i), hash12(i + vec2(1.0, 0.0)), u.x),
             mix(hash12(i + vec2(0.0, 1.0)), hash12(i + vec2(1.0, 1.0)), u.x), u.y);
}

void main() {
  // A billowy top: the wall's height wanders with the angle around the bank.
  float angle = atan(vWorldPos.z - uCenter.y, vWorldPos.x - uCenter.x);
  float billow = 0.6 * vnoise(vec2(angle * 7.0, uSeed)) + 0.4 * vnoise(vec2(angle * 19.0, uSeed + 9.0));
  float top = 0.5 + 0.45 * billow;
  float vertical = 1.0 - smoothstep(top - 0.3, top, vHeight);

  // Soft toward the silhouette, where the wall is seen edge-on.
  vec3 toCamera = normalize(cameraPosition - vWorldPos);
  float facing = abs(dot(normalize(vNormalW), toCamera));
  float edge = smoothstep(0.04, 0.5, facing);

  // Well inside the bank the global fog does the work.
  float outside = smoothstep(0.55 * uWall, 0.95 * uWall, distance(cameraPosition.xz, uCenter));

  float dist = distance(cameraPosition, vWorldPos);
  float haze = 1.0 - exp(-pow(uFogDensity * dist, 2.0));
  // Shaded toward the water, bright at the top, and whiter than the haze behind it.
  vec3 color = uColor * mix(0.66, 1.04, smoothstep(0.0, 0.8, vHeight));
  color = mix(color, uFogColor, 0.5 * haze);
  float alpha = vertical * edge * outside * uStrength * 0.94;
  gl_FragColor = vec4(color, alpha);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

export function createFogBanks(): FogBankView {
  const group = new THREE.Group();
  group.name = 'fog-banks';
  // An open cylinder from the water up: unit radius, unit height.
  const geometry = new THREE.CylinderGeometry(1, 1, 1, 72, 1, true).translate(0, 0.5, 0);
  const color = new THREE.Color();
  const fog = new THREE.Color();
  const meshes: { mesh: THREE.Mesh; material: THREE.ShaderMaterial }[] = [];
  for (let k = 0; k < MAX_BANKS; k++) {
    const material = new THREE.ShaderMaterial({
      uniforms: {
        uColor: { value: new THREE.Color() },
        uFogColor: { value: new THREE.Color() },
        uFogDensity: { value: 0 },
        uStrength: { value: 0 },
        uCenter: { value: new THREE.Vector2() },
        uWall: { value: 1 },
        uSeed: { value: k * 17.3 },
      },
      vertexShader,
      fragmentShader,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = `fog-bank-${k}`;
    mesh.visible = false;
    // After the water (0.5) and the wake (1), so the wall draws over them.
    mesh.renderOrder = 2;
    group.add(mesh);
    meshes.push({ mesh, material });
  }
  let enabled = true;
  let drawn = 0;

  return {
    group,
    get drawn() {
      return drawn;
    },
    setEnabled(on) {
      enabled = on;
      group.visible = on;
    },
    update(banks, camera, fogColor, light, fogDensity) {
      drawn = 0;
      meshes.forEach(({ mesh, material }, k) => {
        const bank = enabled ? banks[k] : undefined;
        mesh.visible = bank !== undefined;
        if (!bank) return;
        const wall = bank.radiusM * WALL;
        const height = HEIGHT_M[bank.kind];
        mesh.position.set(bank.x, 0, bank.z);
        mesh.scale.set(wall, height, wall);
        const u = material.uniforms as Record<string, THREE.IUniform>;
        // A touch brighter than the sky's fog so the wall reads against it, dimmed at night.
        fog.copy(fogColor);
        color
          .copy(fog)
          .lerp(WHITE, 0.35)
          .multiplyScalar(Math.min(1.1, 0.2 + light));
        (u['uColor'] as THREE.IUniform<THREE.Color>).value.copy(color);
        (u['uFogColor'] as THREE.IUniform<THREE.Color>).value.copy(fog);
        (u['uFogDensity'] as THREE.IUniform<number>).value = Math.min(fogDensity, 3.5e-4) * 0.4;
        (u['uStrength'] as THREE.IUniform<number>).value = bank.strength;
        (u['uCenter'] as THREE.IUniform<THREE.Vector2>).value.set(bank.x, bank.z);
        (u['uWall'] as THREE.IUniform<number>).value = wall;
        drawn++;
      });
      void camera;
    },
    dispose() {
      geometry.dispose();
      for (const { material } of meshes) material.dispose();
    },
  };
}

const WHITE = new THREE.Color(0xffffff);
