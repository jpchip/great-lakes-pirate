import * as THREE from 'three';
import { MAX_WAVES } from '../../sim/weather/waves';
import {
  SHORE_DEPTH_RANGE_M,
  SHORE_SDF_OFFSET_M,
  SHORE_SDF_RANGE_M,
  deepWaterTexture,
} from './shore';
import { noiseChunk, waveDisplacementChunk, waveUniformsChunk } from './wave-glsl';
import { GUST_SAMPLES } from './wind-cues';

/**
 * The stylized water shader (plan 04 §7): Gerstner displacement and analytic normals
 * from the shared wave set, toon-banded diffuse, a banded sun glint, sky tint at grazing
 * angles, and optional crest foam. Opaque, no reflections or refraction (iGPU budget).
 *
 * The wave loop must match sim/weather/waves.ts `displacementAt` term for term. The only
 * difference is the fade, which removes short waves far from the camera, and any wave
 * the grid is too coarse to sample where a vertex sits. Without that, an undersampled
 * wave aliases into shapes that jump each time the grid snaps to a moving camera.
 *
 * The local sea scale (shelter and fetch, waves.ts SeaScaleGrid) is an R8 texture over the
 * zone; it multiplies amplitude and steepness at each rest position, as heightAt does.
 *
 * Phase 1 piece F adds depth bands and shore foam from the zone's shore texture
 * (shore.ts), and wind streaks and cat's-paws from the wind (wind-cues.ts).
 */

const vertexShader = /* glsl */ `
#include <common>
#include <fog_pars_vertex>

${waveUniformsChunk}
// Grid vertex spacing at distance d from its center ≈ (d + uGridOffset) · uGridGrowth.
uniform float uGridOffset;
uniform float uGridGrowth;
${waveDisplacementChunk}
varying vec3 vWorldPos;
varying vec2 vRestPos;
varying float vHeight;

void main() {
  vec4 world = modelMatrix * vec4(position, 1.0);
  vec2 p0 = world.xz;
  float dist = distance(p0, cameraPosition.xz);
  float spacing = (distance(p0, modelMatrix[3].xz) + uGridOffset) * uGridGrowth;
  vec3 disp = waveDisplacement(p0, dist, spacing);

  world.xyz += disp;
  vWorldPos = world.xyz;
  vRestPos = p0;
  vHeight = disp.y;

  vec4 mvPosition = viewMatrix * world;
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}
`;

const fragmentShader = /* glsl */ `
#include <common>
#include <fog_pars_fragment>
${waveUniformsChunk}
${noiseChunk}

uniform vec3 uDeepColor;
uniform vec3 uCrestColor;
uniform vec3 uShallowColor;
uniform vec3 uSandColor;
uniform vec3 uSkyColor;
uniform vec3 uFoamColor;
uniform vec3 uSunColor;
uniform vec3 uSunDirection;
uniform float uCrestFoam;
uniform float uFoamThreshold;
// Depth bands and shore foam (shore.ts): depth in R, distance to shore in G.
uniform sampler2D uShore;
uniform vec4 uShoreRect;
uniform float uShoreOn;
uniform float uSurf;
// Wind cues (wind-cues.ts).
uniform vec2 uWindDir;
uniform float uWindOffset;
uniform float uStreaks;
uniform float uCatsPaws;
uniform float uGustAhead[${GUST_SAMPLES}];
uniform vec3 uGustOrigin;
varying vec3 vWorldPos;
varying vec2 vRestPos;
varying float vHeight;

// The normal and crest of every wave, per pixel at the undisplaced position. Short waves
// the vertex grid can't resolve still shade here, faded by the pixel's footprint
// instead of the grid's spacing, so they stay put as the grid follows the camera.
void waveShading(float footprint, float dist, float local, out vec3 n, out float crest) {
  n = vec3(0.0, 1.0, 0.0);
  crest = 0.0;
  for (int i = 0; i < MAX_WAVES; i++) {
    if (i >= uWaveCount) break;
    vec4 a = uWaveA[i];
    vec4 b = uWaveB[i];
    float wavelength = 6.2831853 / a.z;
    float fade = 1.0 - smoothstep(wavelength * 8.0, wavelength * 30.0, dist);
    fade = min(fade, 1.0 - smoothstep(wavelength * 0.25, wavelength * 0.5, footprint)) * local;
    float amp = a.w * fade;
    float steep = b.z * fade;
    float theta = a.z * dot(a.xy, vRestPos) - b.x * uTime + b.y;
    float c = cos(theta);
    float s = sin(theta);
    n.x -= a.x * a.z * amp * c;
    n.z -= a.y * a.z * amp * c;
    n.y -= steep * s;
    crest += steep * s;
  }
}

// 1 below the edge, 0 above, with an antialiased step about one pixel wide.
float below(float edge, float value, float aa) {
  return 1.0 - smoothstep(edge - aa, edge + aa, value);
}

// The gust that will reach the ship from this far upwind (wind-cues.ts), interpolated
// between the two samples either side.
float gustAhead(float upwindM) {
  float f = clamp(upwindM / uGustOrigin.z, 0.0, ${GUST_SAMPLES - 1}.0);
  int k = min(int(f), ${GUST_SAMPLES - 2});
  return mix(uGustAhead[k], uGustAhead[k + 1], f - float(k));
}

void main() {
  float footprint = length(fwidth(vRestPos));
  float dist = distance(vRestPos, cameraPosition.xz);
  float local = seaScale(vRestPos);
  vec3 n;
  float crestHere;
  waveShading(footprint, dist, local, n, crestHere);
  n = normalize(n);
  vec3 toCamera = normalize(cameraPosition - vWorldPos);

  // Toon-banded diffuse: three steps of sun light.
  float ndl = max(dot(n, uSunDirection), 0.0);
  float band = floor(ndl * 3.0 + 0.5) / 3.0;
  float lift = clamp(vHeight * 0.5 + 0.5, 0.0, 1.0);
  float tone = 0.25 * band + 0.35 * lift;
  vec3 color = mix(uDeepColor, uCrestColor, tone);

  // Depth bands (plan 04 §7): deep slate, then teal steps at 9 m and 4 m, then sand
  // under 1.5 m. Stored as √(depth / 32 m) and shore distance + 16 m over 128 m.
  vec2 shore = uShoreOn > 0.5
    ? texture2D(uShore, (vRestPos - uShoreRect.xy) * uShoreRect.zw).rg
    : vec2(1.0);
  float depth = shore.r * shore.r * ${SHORE_DEPTH_RANGE_M.toFixed(1)};
  float toShore = shore.g * ${SHORE_SDF_RANGE_M.toFixed(1)} - ${SHORE_SDF_OFFSET_M.toFixed(1)};
  float aa = max(fwidth(depth), 0.02);
  float teal = 0.5 * below(9.0, depth, aa) + 0.5 * below(4.0, depth, aa);
  float sand = below(1.5, depth, aa);
  color = mix(color, uShallowColor * (0.8 + 0.6 * tone), teal * 0.7);
  color = mix(color, uSandColor * (0.8 + 0.6 * tone), sand * 0.65);

  // Sky tint at grazing angles, in two bands.
  float fresnel = pow(1.0 - max(dot(n, toCamera), 0.0), 3.0);
  color = mix(color, uSkyColor, 0.12 * step(0.3, fresnel) + 0.2 * step(0.65, fresnel));

  // Banded sun glint.
  vec3 halfway = normalize(uSunDirection + toCamera);
  float glint = pow(max(dot(n, halfway), 0.0), 220.0);
  color += uSunColor * step(0.35, glint) * 0.9;

  // Wind cues (plan 02 §9): darker cat's-paws where gusts are coming, and foam streaks
  // along the wind in a blow. Both drift downwind with the air. Each noise is only
  // evaluated where it can show, to keep the cues inside the water budget (04 §23).
  if (uCatsPaws > 0.0 || uStreaks > 0.0) {
    vec2 q = vec2(dot(vRestPos, uWindDir) - uWindOffset,
                  dot(vRestPos, vec2(-uWindDir.y, uWindDir.x)));
    float pawFade = uCatsPaws * (1.0 - smoothstep(6.0, 16.0, footprint));
    if (pawFade > 0.0) {
      float g = gustAhead(dot(uGustOrigin.xy - vRestPos, uWindDir));
      // One octave; the threshold curve keeps the patch coverage the old two-octave sum
      // had at every gust strength.
      float paw = g < 0.08 ? 0.0 : step(1.0 - g * (0.2 + 0.27 * g), valueNoise(q * vec2(0.022, 0.032)));
      if (paw > 0.0) {
        // Darker, with fine ripples across the wind, so a paw reads as wind, not depth.
        float ripple = step(0.72, valueNoise(q * vec2(1.1, 0.3))) * (1.0 - smoothstep(0.3, 0.9, footprint));
        color *= 1.0 - paw * pawFade * (0.16 - 0.1 * ripple);
      }
    }
    // Short, slightly wavy streaks, tens of meters long.
    float streakFade = min(local, 1.0) * (1.0 - smoothstep(0.6, 2.0, footprint));
    if (uStreaks > 0.0 && streakFade > 0.0) {
      float streak = step(1.0 - 0.12 * uStreaks,
                          valueNoise(vec2(q.x * 0.035, q.y * 0.4 + 0.8 * sin(q.x * 0.03))));
      color = mix(color, uFoamColor, streak * streakFade * 0.45);
    }
  }

  // Crest foam where the waves pinch, broken up by noise. The noise moves the threshold
  // by at most ±0.125, so lower crests skip it.
  if (uCrestFoam > 0.5 && crestHere > uFoamThreshold - 0.125) {
    float noise = valueNoise(vWorldPos.xz * 0.6) * 0.5 + valueNoise(vWorldPos.xz * 2.1) * 0.5;
    float foam = step(uFoamThreshold, crestHere + (noise - 0.5) * 0.25);
    color = mix(color, uFoamColor, foam * 0.85);
  }

  // Shore foam (plan 04 §7): a wash line on the beach that widens with the surf, and
  // lines of surf running in to it, weaker in a lee.
  if (uShoreOn > 0.5 && toShore < 40.0) {
    float energy = 0.3 + 0.7 * clamp(uSurf * local, 0.0, 1.0);
    float n1 = valueNoise(vRestPos * 0.3 + vec2(uTime * 0.12, 0.0));
    float wash = below(1.0 + 2.5 * energy + (n1 - 0.5) * 2.0, toShore, 0.15);
    float reach = 5.0 + 15.0 * energy;
    float run = fract(toShore / 6.0 + uTime * 0.18 + n1 * 0.7);
    float surf = step(0.8, run) * below(reach, toShore + n1 * 4.0, 1.0);
    surf *= 1.0 - smoothstep(1.0, 3.0, footprint);
    color = mix(color, uFoamColor, max(wash, surf) * 0.9);
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
  uGridOffset: THREE.IUniform<number>;
  uGridGrowth: THREE.IUniform<number>;
  uSeaScale: THREE.IUniform<THREE.Texture>;
  uSeaScaleRect: THREE.IUniform<THREE.Vector4>;
  uDeepColor: THREE.IUniform<THREE.Color>;
  uCrestColor: THREE.IUniform<THREE.Color>;
  uShallowColor: THREE.IUniform<THREE.Color>;
  uSandColor: THREE.IUniform<THREE.Color>;
  uSkyColor: THREE.IUniform<THREE.Color>;
  uFoamColor: THREE.IUniform<THREE.Color>;
  uSunColor: THREE.IUniform<THREE.Color>;
  uSunDirection: THREE.IUniform<THREE.Vector3>;
  uCrestFoam: THREE.IUniform<number>;
  uFoamThreshold: THREE.IUniform<number>;
  uShore: THREE.IUniform<THREE.Texture>;
  uShoreRect: THREE.IUniform<THREE.Vector4>;
  uShoreOn: THREE.IUniform<number>;
  uSurf: THREE.IUniform<number>;
  uWindDir: THREE.IUniform<THREE.Vector2>;
  uWindOffset: THREE.IUniform<number>;
  uStreaks: THREE.IUniform<number>;
  uCatsPaws: THREE.IUniform<number>;
  uGustAhead: THREE.IUniform<Float32Array>;
  uGustOrigin: THREE.IUniform<THREE.Vector3>;
}

/** Shallow-water tints at full daylight; the environment scales them like the rest. */
export const SHALLOW_HEX = 0x3d8584;
export const SAND_HEX = 0x9a8a5e;

export function createWaterMaterial(): THREE.ShaderMaterial & { uniforms: WaterUniforms } {
  const uniforms: WaterUniforms = {
    ...THREE.UniformsUtils.clone(THREE.UniformsLib.fog),
    uTime: { value: 0 },
    uWaveCount: { value: 4 },
    uWaveA: { value: new Float32Array(MAX_WAVES * 4) },
    uWaveB: { value: new Float32Array(MAX_WAVES * 4) },
    // Set from the grid by water.ts; zero spacing disables the grid fade.
    uGridOffset: { value: 0 },
    uGridGrowth: { value: 0 },
    // Set from the sea by water.ts.
    uSeaScale: { value: new THREE.Texture() },
    uSeaScaleRect: { value: new THREE.Vector4(0, 0, 1, 1) },
    // Cold blue-gray Superior water (plan 04 §1); art direction retunes these.
    uDeepColor: { value: new THREE.Color(0x1d3a4a) },
    uCrestColor: { value: new THREE.Color(0x4f7f8c) },
    // Teal over the shallows and amber-sand under 1.5 m (plan 14 §2 "Lake").
    uShallowColor: { value: new THREE.Color(SHALLOW_HEX) },
    uSandColor: { value: new THREE.Color(SAND_HEX) },
    uSkyColor: { value: new THREE.Color(0xa9bfcc) },
    uFoamColor: { value: new THREE.Color(0xe8eef0) },
    uSunColor: { value: new THREE.Color(0xfff2d6) },
    uSunDirection: { value: new THREE.Vector3(0.4, 0.6, 0.3).normalize() },
    uCrestFoam: { value: 1 },
    uFoamThreshold: { value: 0.5 },
    // Set from the zone by water.ts; off over open water with no zone loaded.
    uShore: { value: deepWaterTexture() },
    uShoreRect: { value: new THREE.Vector4(0, 0, 1, 1) },
    uShoreOn: { value: 0 },
    uSurf: { value: 0.5 },
    // Set from the wind each frame (wind-cues.ts); 0 turns the cues off.
    uWindDir: { value: new THREE.Vector2(0, 1) },
    uWindOffset: { value: 0 },
    uStreaks: { value: 0 },
    uCatsPaws: { value: 0 },
    uGustAhead: { value: new Float32Array(GUST_SAMPLES) },
    uGustOrigin: { value: new THREE.Vector3(0, 0, 20) },
  };
  const material = new THREE.ShaderMaterial({
    uniforms,
    vertexShader,
    fragmentShader,
    fog: true,
  });
  return material as THREE.ShaderMaterial & { uniforms: WaterUniforms };
}
