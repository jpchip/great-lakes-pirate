import { MAX_WAVES, SEA_SCALE_BYTE } from '../../sim/weather/waves';

/**
 * The GLSL half of the shared Gerstner set (sim/weather/waves.ts), used by the water
 * and by everything that floats on it (wake ribbons). The loop must match
 * `displacementAt` term for term; see water-material.ts for the fades.
 */

/** Wave and sea-scale uniforms plus `seaScale(p)`; declare in every stage that reads them. */
export const waveUniformsChunk = /* glsl */ `
#define MAX_WAVES ${MAX_WAVES}
uniform float uTime;
uniform int uWaveCount;
uniform vec4 uWaveA[MAX_WAVES]; // dir.x, dir.z, k, amplitude
uniform vec4 uWaveB[MAX_WAVES]; // omega, phase, steepness, unused
uniform sampler2D uSeaScale;
uniform vec4 uSeaScaleRect; // minX, minZ, 1 / width m, 1 / height m
float seaScale(vec2 p) {
  return texture2D(uSeaScale, (p - uSeaScaleRect.xy) * uSeaScaleRect.zw).r * ${(255 / SEA_SCALE_BYTE).toFixed(6)};
}
`;

/**
 * `waveDisplacement(p0, dist, spacing)`: the displacement of the surface point resting at
 * p0, `dist` meters from the camera, where the water grid's vertices are `spacing` apart
 * (0 for no grid fade). Short waves fade with distance, and waves the grid samples fewer
 * than 2.5 times per wavelength are left out, so they don't alias as the grid moves.
 */
export const waveDisplacementChunk = /* glsl */ `
vec3 waveDisplacement(vec2 p0, float dist, float spacing) {
  float local = seaScale(p0);
  vec3 disp = vec3(0.0);
  for (int i = 0; i < MAX_WAVES; i++) {
    if (i >= uWaveCount) break;
    vec4 a = uWaveA[i];
    vec4 b = uWaveB[i];
    float wavelength = 6.2831853 / a.z;
    float fade = 1.0 - smoothstep(wavelength * 8.0, wavelength * 30.0, dist);
    fade = min(fade, 1.0 - smoothstep(wavelength * 0.2, wavelength * 0.4, spacing)) * local;
    float amp = a.w * fade;
    float steep = b.z * fade;
    float theta = a.z * dot(a.xy, p0) - b.x * uTime + b.y;
    disp.xz += a.xy * (steep / a.z) * cos(theta);
    disp.y += amp * sin(theta);
  }
  return disp;
}
`;

/** Value noise for foam breakup. */
export const noiseChunk = /* glsl */ `
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
`;
