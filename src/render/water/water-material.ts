import * as THREE from 'three';
import { MAX_WAVES } from '../../sim/weather/waves';

/**
 * The stylized water shader (plan 04 §7): Gerstner displacement and analytic normals
 * from the shared wave set, toon-banded diffuse, a banded sun glint, sky tint at grazing
 * angles, and optional crest foam. Opaque, no reflections or refraction (iGPU budget).
 *
 * The wave loop must match sim/weather/waves.ts `displacementAt` term for term. The only
 * difference is the distance fade, which removes short waves far from the camera so the
 * coarse outer rings don't alias; the ship is always well inside the fade radius.
 */

const vertexShader = /* glsl */ `
#include <common>
#include <fog_pars_vertex>

#define MAX_WAVES ${MAX_WAVES}

uniform float uTime;
uniform int uWaveCount;
uniform vec4 uWaveA[MAX_WAVES]; // dir.x, dir.z, k, amplitude
uniform vec4 uWaveB[MAX_WAVES]; // omega, phase, steepness, unused

varying vec3 vWorldPos;
varying vec3 vNormal;
varying float vCrest;
varying float vHeight;

void main() {
  vec4 world = modelMatrix * vec4(position, 1.0);
  vec2 p0 = world.xz;
  float dist = distance(p0, cameraPosition.xz);

  vec3 disp = vec3(0.0);
  vec3 n = vec3(0.0, 1.0, 0.0);
  float crest = 0.0;
  for (int i = 0; i < MAX_WAVES; i++) {
    if (i >= uWaveCount) break;
    vec4 a = uWaveA[i];
    vec4 b = uWaveB[i];
    float wavelength = 6.2831853 / a.z;
    float fade = 1.0 - smoothstep(wavelength * 8.0, wavelength * 30.0, dist);
    float amp = a.w * fade;
    float steep = b.z * fade;
    float theta = a.z * dot(a.xy, p0) - b.x * uTime + b.y;
    float c = cos(theta);
    float s = sin(theta);
    disp.xz += a.xy * (steep / a.z) * c;
    disp.y += amp * s;
    n.x -= a.x * a.z * amp * c;
    n.z -= a.y * a.z * amp * c;
    n.y -= steep * s;
    crest += steep * s;
  }

  world.xyz += disp;
  vWorldPos = world.xyz;
  vNormal = n;
  vCrest = crest;
  vHeight = disp.y;

  vec4 mvPosition = viewMatrix * world;
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}
`;

const fragmentShader = /* glsl */ `
#include <common>
#include <fog_pars_fragment>

uniform vec3 uDeepColor;
uniform vec3 uCrestColor;
uniform vec3 uSkyColor;
uniform vec3 uFoamColor;
uniform vec3 uSunColor;
uniform vec3 uSunDirection;
uniform float uCrestFoam;
uniform float uFoamThreshold;

varying vec3 vWorldPos;
varying vec3 vNormal;
varying float vCrest;
varying float vHeight;

float hash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}

float valueNoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x),
             mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
}

void main() {
  vec3 n = normalize(vNormal);
  vec3 toCamera = normalize(cameraPosition - vWorldPos);

  // Toon-banded diffuse: three steps of sun light.
  float ndl = max(dot(n, uSunDirection), 0.0);
  float band = floor(ndl * 3.0 + 0.5) / 3.0;
  float lift = clamp(vHeight * 0.5 + 0.5, 0.0, 1.0);
  vec3 color = mix(uDeepColor, uCrestColor, 0.25 * band + 0.35 * lift);

  // Sky tint at grazing angles, in two bands.
  float fresnel = pow(1.0 - max(dot(n, toCamera), 0.0), 3.0);
  color = mix(color, uSkyColor, 0.12 * step(0.3, fresnel) + 0.2 * step(0.65, fresnel));

  // Banded sun glint.
  vec3 halfway = normalize(uSunDirection + toCamera);
  float glint = pow(max(dot(n, halfway), 0.0), 220.0);
  color += uSunColor * step(0.35, glint) * 0.9;

  // Crest foam where the waves pinch, broken up by noise.
  if (uCrestFoam > 0.5) {
    float noise = valueNoise(vWorldPos.xz * 0.6) * 0.5 + valueNoise(vWorldPos.xz * 2.1) * 0.5;
    float foam = step(uFoamThreshold, vCrest + (noise - 0.5) * 0.25);
    color = mix(color, uFoamColor, foam * 0.85);
  }

  gl_FragColor = vec4(color, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  #include <fog_fragment>
}
`;

export interface WaterUniforms {
  [name: string]: THREE.IUniform;
  uTime: THREE.IUniform<number>;
  uWaveCount: THREE.IUniform<number>;
  uWaveA: THREE.IUniform<Float32Array>;
  uWaveB: THREE.IUniform<Float32Array>;
  uDeepColor: THREE.IUniform<THREE.Color>;
  uCrestColor: THREE.IUniform<THREE.Color>;
  uSkyColor: THREE.IUniform<THREE.Color>;
  uFoamColor: THREE.IUniform<THREE.Color>;
  uSunColor: THREE.IUniform<THREE.Color>;
  uSunDirection: THREE.IUniform<THREE.Vector3>;
  uCrestFoam: THREE.IUniform<number>;
  uFoamThreshold: THREE.IUniform<number>;
}

export function createWaterMaterial(): THREE.ShaderMaterial & { uniforms: WaterUniforms } {
  const uniforms: WaterUniforms = {
    ...THREE.UniformsUtils.clone(THREE.UniformsLib.fog),
    uTime: { value: 0 },
    uWaveCount: { value: 4 },
    uWaveA: { value: new Float32Array(MAX_WAVES * 4) },
    uWaveB: { value: new Float32Array(MAX_WAVES * 4) },
    // Cold blue-gray Superior water (plan 04 §1); art direction retunes these.
    uDeepColor: { value: new THREE.Color(0x1d3a4a) },
    uCrestColor: { value: new THREE.Color(0x4f7f8c) },
    uSkyColor: { value: new THREE.Color(0xa9bfcc) },
    uFoamColor: { value: new THREE.Color(0xe8eef0) },
    uSunColor: { value: new THREE.Color(0xfff2d6) },
    uSunDirection: { value: new THREE.Vector3(0.4, 0.6, 0.3).normalize() },
    uCrestFoam: { value: 1 },
    uFoamThreshold: { value: 0.5 },
  };
  const material = new THREE.ShaderMaterial({
    uniforms,
    vertexShader,
    fragmentShader,
    fog: true,
  });
  return material as THREE.ShaderMaterial & { uniforms: WaterUniforms };
}
