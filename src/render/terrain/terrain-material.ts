import * as THREE from 'three';
import { PALETTE } from '../style/palette';
import { STYLE_LIGHT_GLSL, type StyleLighting } from '../style/stylized-material';

/**
 * The style B terrain shader (plan 14 §5 "Terrain", plan 03 §8.3; Phase 2 piece C). No
 * painted textures: the ground is colored by height, slope and the vegetation density map
 * (the `forest` attribute, sim/terrain/vegetation), with a little world-space noise so band
 * edges wander, and lit with the shared toon bands of the unified material. No outlines:
 * those are for hero objects only (plan 14 §14).
 *
 * - Pale beach sand on low, gentle ground, darker where the swash wets it.
 * - Red Apostles sandstone on steep ground near the lake, in horizontal beds, over a band
 *   of dark wave-washed rock at its foot; gray rock on steep ground higher up.
 * - Meadow in clearings, a dark forest floor under the trees, and, past the impostors'
 *   reach, the canopy color, so far forest still reads as forest.
 * - Shoals and seabed under the water, seen in the troughs at the waterline.
 */

export interface TerrainUniforms {
  [name: string]: THREE.IUniform;
  /** Forest turns to canopy color between these distances from the camera, meters. */
  uCanopyStart: THREE.IUniform<number>;
  uCanopyEnd: THREE.IUniform<number>;
}

const vertexShader = /* glsl */ `
#include <common>
#include <fog_pars_vertex>

attribute float forest;

varying vec3 vWorldPos;
varying vec3 vWorldNormal;
varying float vForest;

void main() {
  vec4 world = modelMatrix * vec4(position, 1.0);
  vWorldPos = world.xyz;
  vWorldNormal = normalize(mat3(modelMatrix) * normal);
  vForest = forest;
  vec4 mvPosition = viewMatrix * world;
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}
`;

const fragmentShader = /* glsl */ `
#include <common>
#include <fog_pars_fragment>

${STYLE_LIGHT_GLSL}

uniform vec3 uSeabed;
uniform vec3 uShoal;
uniform vec3 uWetSand;
uniform vec3 uSand;
uniform vec3 uMeadow;
uniform vec3 uForestFloor;
uniform vec3 uCanopy;
uniform vec3 uSandstone;
uniform vec3 uSandstoneDark;
uniform vec3 uWetRock;
uniform vec3 uSlopeRock;
uniform float uCanopyStart;
uniform float uCanopyEnd;

varying vec3 vWorldPos;
varying vec3 vWorldNormal;
varying float vForest;

// Arithmetic hash (Hoskins), cheaper and steadier on iGPUs than sin().
float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

float valueNoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  float a = hash12(i);
  float b = hash12(i + vec2(1.0, 0.0));
  float c = hash12(i + vec2(0.0, 1.0));
  float d = hash12(i + vec2(1.0, 1.0));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

void main() {
  vec3 n = normalize(vWorldNormal);
  if (!gl_FrontFacing) n = -n;
  float h = vWorldPos.y;
  vec2 xz = vWorldPos.xz;
  float dist = distance(cameraPosition, vWorldPos);

  // Two octaves of grain; the fine one fades out with distance so it doesn't shimmer.
  float fine = 1.0 - smoothstep(300.0, 900.0, dist);
  float grain = valueNoise(xz / 37.0) * (1.0 - 0.4 * fine) + valueNoise(xz / 7.0) * 0.4 * fine;

  // Clearings and forest floor, by the density map.
  float wooded = smoothstep(0.18, 0.6, vForest + (grain - 0.5) * 0.25);
  vec3 col = mix(uMeadow, uForestFloor, wooded);

  // Beach: low, gentle ground, its top edge wandering by most of a meter. It stays under
  // the set pieces' flattened ground (1.8 m and up), which is town, not beach.
  float beachTop = 0.95 + 0.75 * grain;
  float beach = 1.0 - smoothstep(beachTop - 0.35, beachTop, h);
  vec3 sand = mix(uWetSand, uSand, smoothstep(0.05, 0.45, h));
  col = mix(col, sand, beach);

  // Sandstone on steep ground near the lake, bedded every couple of meters; dark rock
  // at the waterline; gray rock on steep ground higher up.
  float steep = 1.0 - smoothstep(0.8, 0.9, n.y + (grain - 0.5) * 0.1);
  float beds = smoothstep(0.4, 0.6, fract(h / 3.1 + grain * 0.8));
  vec3 stone = mix(uSandstone, uSandstoneDark, beds * 0.45);
  stone = mix(uWetRock, stone, smoothstep(0.25, 1.1, h + (grain - 0.5) * 0.5));
  vec3 rock = mix(stone, uSlopeRock, smoothstep(18.0, 30.0, h));
  col = mix(col, rock, steep);

  // Under the water: shoals shading to seabed.
  vec3 bed = mix(uSeabed, uShoal, smoothstep(-8.0, -0.6, h));
  col = mix(col, bed, 1.0 - smoothstep(-0.6, 0.05, h));

  // Far forest reads as one canopy once the tree impostors give out.
  float canopy = smoothstep(uCanopyStart, uCanopyEnd, dist) * smoothstep(0.25, 0.6, vForest);
  col = mix(col, uCanopy * (0.9 + 0.2 * grain), canopy * (1.0 - steep));

  gl_FragColor = vec4(col * styleLight(n, vWorldPos), 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  #include <fog_fragment>
}
`;

export type TerrainMaterial = THREE.ShaderMaterial & { uniforms: TerrainUniforms };

const color = (hex: number): THREE.IUniform<THREE.Color> => ({ value: new THREE.Color(hex) });

/**
 * The terrain shader, lit by `lighting` (shared by reference). Set the canopy distances to
 * where the vegetation impostors fade out (render/vegetation).
 */
export function createTerrainMaterial(lighting: StyleLighting): TerrainMaterial {
  const material = new THREE.ShaderMaterial({
    uniforms: {
      ...THREE.UniformsUtils.clone(THREE.UniformsLib.fog),
      ...lighting.uniforms,
      uSeabed: color(PALETTE.seabed),
      uShoal: color(PALETTE.shoal),
      uWetSand: color(PALETTE.wetSand),
      uSand: color(PALETTE.beachSand),
      uMeadow: color(PALETTE.meadow),
      uForestFloor: color(PALETTE.forestFloor),
      uCanopy: color(PALETTE.canopy),
      uSandstone: color(PALETTE.sandstone),
      uSandstoneDark: color(PALETTE.sandstoneDark),
      uWetRock: color(PALETTE.wetRock),
      uSlopeRock: color(PALETTE.slopeRock),
      uCanopyStart: { value: 1500 },
      uCanopyEnd: { value: 2000 },
    },
    defines: { STYLE_TOON: '', STYLE_WRAP: '' },
    vertexShader,
    fragmentShader,
    // Skirts can be seen from inside a crack.
    side: THREE.DoubleSide,
    fog: true,
  });
  material.name = 'terrain-style-b';
  return material as TerrainMaterial;
}
