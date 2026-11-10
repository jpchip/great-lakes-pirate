import * as THREE from 'three';
import type { OutlineSettings } from '../style/outline';
import {
  STYLE_LIGHT_GLSL,
  type StyleId,
  type StyleLighting,
  type StyleLightingUniforms,
} from '../style/stylized-material';
import { REGION, REGION_COUNT } from './regions';

/**
 * The unified stylized material (plan 14 §4) for skinned characters: the same lighting,
 * bands, rim and fog as everything else, plus GPU skinning and a per-character palette.
 * Each vertex names its color region (`_look.x`) and a shade (`_look.y`); the palette
 * uniform holds the region colors, so one mesh dresses any number of characters.
 * The lantern glass region glows by `uGlow`. A negative shade marks vertices that take no
 * ink line (the eyes and brows).
 */

const vertexShader = /* glsl */ `
#include <common>
#include <fog_pars_vertex>
#include <skinning_pars_vertex>

attribute vec2 _look;
uniform vec3 uRegions[${REGION_COUNT}];

varying vec3 vWorldPos;
varying vec3 vWorldNormal;
varying vec3 vColor;
varying float vGlass;

void main() {
  #include <beginnormal_vertex>
  #include <skinbase_vertex>
  #include <skinnormal_vertex>
  #include <begin_vertex>
  #include <skinning_vertex>
  vec4 world = modelMatrix * vec4(transformed, 1.0);
  vWorldPos = world.xyz;
  vWorldNormal = normalize(mat3(modelMatrix) * objectNormal);
  int region = int(_look.x + 0.5);
  // A negative shade marks vertices without an ink line (eyes, brows); the color uses its size.
  vColor = uRegions[region] * abs(_look.y);
  vGlass = region == ${REGION.lampGlass} ? 1.0 : 0.0;
  vec4 mvPosition = viewMatrix * world;
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}
`;

const fragmentShader = /* glsl */ `
#include <common>
#include <fog_pars_fragment>

${STYLE_LIGHT_GLSL}
uniform vec3 uGlow;

varying vec3 vWorldPos;
varying vec3 vWorldNormal;
varying vec3 vColor;
varying float vGlass;

void main() {
  #ifdef STYLE_FLAT
    vec3 n = normalize(cross(dFdx(vWorldPos), dFdy(vWorldPos)));
  #else
    vec3 n = normalize(vWorldNormal);
  #endif
  vec3 toCamera = normalize(cameraPosition - vWorldPos);
  // Turn the normal toward the eye by the normal itself, not by winding: simplified LODs
  // carry a few flipped triangles, and the inside of a hat or collar is seen from behind.
  // Flipping by gl_FrontFacing sent those normals away from the camera, so the rim term
  // went to full and painted them pale grey.
  if (dot(n, toCamera) < 0.0) n = -n;
  vec3 light = styleLight(n, vWorldPos);
  float rim = pow(1.0 - max(dot(n, toCamera), 0.0), 3.0);
  #ifdef STYLE_TOON
    rim = smoothstep(0.5, 0.55, rim);
  #endif
  // A back face is an inside seen through an opening (hat, collar, boot top), never an
  // edge against the sky, so it takes no rim.
  if (!gl_FrontFacing) rim = 0.0;
  vec3 color = vColor * light + uRimColor * rim + vGlass * uGlow;
  gl_FragColor = vec4(color, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  #include <fog_fragment>
}
`;

export type CharacterMaterial = THREE.ShaderMaterial & {
  uniforms: StyleLightingUniforms & {
    uRegions: THREE.IUniform<THREE.Color[]>;
    uGlow: THREE.IUniform<THREE.Color>;
  };
};

/** `palette` is sRGB hex per region, in REGIONS order. */
export function createCharacterMaterial(
  style: StyleId,
  lighting: StyleLighting,
  palette: readonly number[],
): CharacterMaterial {
  const material = new THREE.ShaderMaterial({
    uniforms: {
      ...THREE.UniformsUtils.clone(THREE.UniformsLib.fog),
      ...lighting.uniforms,
      uRegions: { value: palette.map((hex) => new THREE.Color(hex)) },
      uGlow: { value: new THREE.Color(0, 0, 0) },
    },
    defines: style === 'flat' ? { STYLE_FLAT: '' } : { STYLE_TOON: '' },
    vertexShader,
    fragmentShader,
    // The outfit's cloth is single-layer in places (cuffs, collars): show both sides.
    side: THREE.DoubleSide,
    fog: true,
  });
  material.name = `character-${style}`;
  return material as CharacterMaterial;
}

export function setPalette(material: CharacterMaterial, palette: readonly number[]): void {
  palette.forEach((hex, i) => material.uniforms.uRegions.value[i]?.setHex(hex));
}

const outlineVertexShader = /* glsl */ `
#include <common>
#include <fog_pars_vertex>
#include <skinning_pars_vertex>

uniform float uWidth;
uniform float uReferenceDistance;
uniform vec2 uResolution;
uniform float uDepthOffset;
attribute vec2 _look;

void main() {
  if (_look.y < 0.0) {
    // No ink here (eyes, brows): park the vertex outside the clip volume.
    gl_Position = vec4(0.0, 0.0, 2.0, 1.0);
    return;
  }
  #include <beginnormal_vertex>
  #include <skinbase_vertex>
  #include <skinnormal_vertex>
  #include <begin_vertex>
  #include <skinning_vertex>
  vec4 mvPosition = modelViewMatrix * vec4(transformed, 1.0);
  mvPosition.xyz += normalize(mvPosition.xyz) * uDepthOffset;
  vec4 clip = projectionMatrix * mvPosition;
  vec3 viewNormal = normalize(normalMatrix * objectNormal);
  vec2 direction = (projectionMatrix * vec4(viewNormal, 0.0)).xy;
  direction /= max(length(direction), 1e-5);
  float thin = clamp(uReferenceDistance / max(-mvPosition.z, 1e-3), 0.35, 1.0);
  clip.xy += direction * (uWidth * thin * 2.0 / uResolution) * clip.w;
  gl_Position = clip;
  #include <fog_vertex>
}
`;

const outlineFragmentShader = /* glsl */ `
#include <common>
#include <fog_pars_fragment>
uniform vec3 uInk;
void main() {
  gl_FragColor = vec4(uInk, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  #include <fog_fragment>
}
`;

/**
 * The ink outline (plan 14 §3.3) for a skinned mesh: the inverted hull, skinned the same
 * way. People are small next to ships, so the shell sits closer behind the surface
 * (`depthOffset`) and the line keeps its width out to `referenceDistance`.
 */
export function createCharacterOutlineMaterial(
  settings: OutlineSettings,
  options: { depthOffset?: number; referenceDistance?: number; width?: number } = {},
): THREE.ShaderMaterial {
  const material = new THREE.ShaderMaterial({
    uniforms: {
      ...THREE.UniformsUtils.clone(THREE.UniformsLib.fog),
      ...settings.uniforms,
      // Own copies where characters differ from ships; the rest stays shared.
      uDepthOffset: { value: options.depthOffset ?? 0.03 },
      uReferenceDistance: { value: options.referenceDistance ?? 12 },
      uWidth: options.width === undefined ? settings.uniforms.uWidth : { value: options.width },
    },
    vertexShader: outlineVertexShader,
    fragmentShader: outlineFragmentShader,
    side: THREE.BackSide,
    fog: true,
  });
  material.name = 'character-outline';
  return material;
}
