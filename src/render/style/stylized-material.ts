import * as THREE from 'three';
import type { TimeOfDay } from './time-of-day';

/**
 * The unified stylized material, v1 (plan 14 §4). Every mesh except water, sky and UI
 * uses it, so assets from different sources light the same way. It has two looks, the
 * two candidates of the S4 style test (plan 14 §3):
 *
 * - `flat` (A, low-poly flat): one color per face. The normal comes from screen-space
 *   derivatives, so any mesh looks faceted, however its normals were authored.
 * - `toon` (B, toon/cel): the mesh's own smooth normals and three hard light bands. The
 *   ink outline that goes with it is a separate pass (outline.ts).
 *
 * Both share a hemisphere ambient, one key light (sun or moon), one local lamp (the
 * lighthouse lantern), a rim light for night silhouettes, an emissive term and scene fog.
 * Lighting uniforms are one shared object, so a time-of-day change updates every material.
 *
 * Instanced meshes work as they are (instance matrices and colors), and a distance fade
 * dithers vegetation out where its impostors take over. Still to come from plan 14 §4: the
 * palette texture atlas, detail textures, and season and weather uniforms. Assets use
 * palette.ts colors as vertex colors until then.
 */

export type StyleId = 'flat' | 'toon';
export const STYLE_IDS: readonly StyleId[] = ['flat', 'toon'];

export interface StyleLightingUniforms {
  [name: string]: THREE.IUniform;
  uKeyDirection: THREE.IUniform<THREE.Vector3>;
  /** Color times intensity. */
  uKeyColor: THREE.IUniform<THREE.Color>;
  uSkyAmbient: THREE.IUniform<THREE.Color>;
  uGroundAmbient: THREE.IUniform<THREE.Color>;
  uRimColor: THREE.IUniform<THREE.Color>;
  uLampPosition: THREE.IUniform<THREE.Vector3>;
  uLampColor: THREE.IUniform<THREE.Color>;
  /** Lamp light reaches zero at this distance, meters. */
  uLampRange: THREE.IUniform<number>;
  /** How wet surfaces are, 0–1: rain darkens everything lit by the style (plan 04 §11). */
  uWet: THREE.IUniform<number>;
}

export class StyleLighting {
  readonly uniforms: StyleLightingUniforms = {
    uKeyDirection: { value: new THREE.Vector3(0, 1, 0) },
    uKeyColor: { value: new THREE.Color(1, 1, 1) },
    uSkyAmbient: { value: new THREE.Color(0.4, 0.45, 0.5) },
    uGroundAmbient: { value: new THREE.Color(0.1, 0.1, 0.1) },
    uRimColor: { value: new THREE.Color(0, 0, 0) },
    uLampPosition: { value: new THREE.Vector3(0, -1e4, 0) },
    uLampColor: { value: new THREE.Color(0, 0, 0) },
    uLampRange: { value: 40 },
    uWet: { value: 0 },
  };

  apply(tod: TimeOfDay): void {
    const u = this.uniforms;
    u.uKeyDirection.value.copy(tod.keyDirection).normalize();
    u.uKeyColor.value.set(tod.keyColor).multiplyScalar(tod.keyIntensity);
    u.uSkyAmbient.value.set(tod.skyAmbient).multiplyScalar(tod.ambientIntensity);
    u.uGroundAmbient.value.set(tod.groundAmbient).multiplyScalar(tod.ambientIntensity);
    u.uRimColor.value.set(tod.rimColor).multiplyScalar(tod.rimIntensity);
  }

  /**
   * Follow the scene's three.js lights, as the game's environment view drives them (a
   * hemisphere and one directional light, plan 04 §9). Standard materials scale diffuse
   * light by 1/π, so this does too, times `gain`, so toon-shaded hero objects sit at the
   * same brightness as the standard-lit terrain around them. `rim` is color × intensity.
   */
  fromSceneLights(
    hemi: THREE.HemisphereLight,
    key: THREE.DirectionalLight,
    rim: THREE.Color,
    gain = 1,
  ): void {
    const u = this.uniforms;
    const scale = gain / Math.PI;
    u.uKeyDirection.value.subVectors(key.position, key.target.position).normalize();
    u.uKeyColor.value.copy(key.color).multiplyScalar(key.intensity * scale);
    u.uSkyAmbient.value.copy(hemi.color).multiplyScalar(hemi.intensity * scale);
    u.uGroundAmbient.value.copy(hemi.groundColor).multiplyScalar(hemi.intensity * scale);
    u.uRimColor.value.copy(rim);
  }

  setLamp(position: THREE.Vector3, color: THREE.Color, range: number): void {
    this.uniforms.uLampPosition.value.copy(position);
    this.uniforms.uLampColor.value.copy(color);
    this.uniforms.uLampRange.value = range;
  }
}

const vertexShader = /* glsl */ `
#include <common>
#include <fog_pars_vertex>

uniform vec3 uColor;
#ifdef USE_DISTANCE_FADE
  // Fully drawn out to uFadeStart, gone by uFadeEnd (meters from the camera).
  uniform float uFadeStart;
  uniform float uFadeEnd;
  varying float vFade;
#endif

varying vec3 vWorldPos;
varying vec3 vWorldNormal;
varying vec3 vColor;

void main() {
  #ifdef USE_INSTANCING
    mat4 placed = modelMatrix * instanceMatrix;
  #else
    mat4 placed = modelMatrix;
  #endif
  vec4 world = placed * vec4(position, 1.0);
  vWorldPos = world.xyz;
  // Assets and instances are scaled uniformly, so the matrix rotates normals correctly.
  vWorldNormal = normalize(mat3(placed) * normal);
  vColor = uColor;
  #ifdef USE_COLOR
    vColor *= color;
  #endif
  #ifdef USE_INSTANCING_COLOR
    vColor *= instanceColor;
  #endif
  #ifdef USE_DISTANCE_FADE
    // By the instance's origin, so a whole tree fades together.
    vec3 origin = (placed * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
    vFade = 1.0 - smoothstep(uFadeStart, uFadeEnd, distance(origin, cameraPosition));
  #endif
  vec4 mvPosition = viewMatrix * world;
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}
`;

/**
 * The shared lighting as a GLSL chunk: the StyleLighting uniforms and `styleLight(n, pos)`,
 * which returns ambient plus key plus lamp light for a world normal and position, banded
 * when STYLE_TOON is defined and wrapped when STYLE_WRAP is. The terrain and vegetation
 * shaders light with it too.
 */
export const STYLE_LIGHT_GLSL = /* glsl */ `
uniform vec3 uKeyDirection;
uniform vec3 uKeyColor;
uniform vec3 uSkyAmbient;
uniform vec3 uGroundAmbient;
uniform vec3 uRimColor;
uniform vec3 uLampPosition;
uniform vec3 uLampColor;
uniform float uLampRange;
uniform float uWet;

vec3 styleLight(vec3 n, vec3 worldPos) {
  #ifdef STYLE_WRAP
    // Wrapped key light for broad surfaces (terrain), so a hillside turned a little from
    // the sun takes the mid band instead of dropping straight to the dark one.
    float key = clamp(dot(n, uKeyDirection) * 0.75 + 0.25, 0.0, 1.0);
  #else
    float key = max(dot(n, uKeyDirection), 0.0);
  #endif
  #ifdef STYLE_TOON
    // Three bands (dark, mid, lit) with a sliver of smoothing so edges don't crawl.
    key = 0.5 * smoothstep(0.02, 0.06, key) + 0.5 * smoothstep(0.42, 0.46, key);
  #endif

  vec3 ambient = mix(uGroundAmbient, uSkyAmbient, n.y * 0.5 + 0.5);

  vec3 toLamp = uLampPosition - worldPos;
  float lampDistance = length(toLamp);
  float lamp = max(dot(n, toLamp / max(lampDistance, 1e-3)), 0.0);
  float falloff = clamp(1.0 - lampDistance / uLampRange, 0.0, 1.0);
  #ifdef STYLE_TOON
    lamp = step(0.2, lamp);
  #endif
  // Wet surfaces are darker (rain, spray and wet rock), and so are their colors' lights.
  return (ambient + uKeyColor * key + uLampColor * lamp * falloff * falloff) * (1.0 - 0.22 * uWet);
}
`;

/**
 * Screen-door dithering for distance fades (vegetation LODs): a stable per-pixel threshold
 * in [0, 1). Two LODs that use the same threshold with complementary tests hand over
 * without a gap or a double-drawn pixel.
 */
export const DITHER_GLSL = /* glsl */ `
float ditherThreshold() {
  // Interleaved gradient noise (Jimenez 2014).
  return fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));
}
`;

const fragmentShader = /* glsl */ `
#include <common>
#include <fog_pars_fragment>

${STYLE_LIGHT_GLSL}
${DITHER_GLSL}
uniform vec3 uEmissive;

varying vec3 vWorldPos;
varying vec3 vWorldNormal;
varying vec3 vColor;
#ifdef USE_DISTANCE_FADE
  varying float vFade;
#endif

void main() {
  #ifdef USE_DISTANCE_FADE
    if (ditherThreshold() >= vFade) discard;
  #endif
  #ifdef STYLE_FLAT
    // Face normal from screen-space derivatives; it always faces the camera.
    vec3 n = normalize(cross(dFdx(vWorldPos), dFdy(vWorldPos)));
  #else
    vec3 n = normalize(vWorldNormal);
    if (!gl_FrontFacing) n = -n;
  #endif
  vec3 toCamera = normalize(cameraPosition - vWorldPos);
  vec3 light = styleLight(n, vWorldPos);

  float rim = pow(1.0 - max(dot(n, toCamera), 0.0), 3.0);
  #ifdef STYLE_TOON
    rim = smoothstep(0.5, 0.55, rim);
  #endif

  vec3 color = vColor * light + uRimColor * rim + uEmissive;
  gl_FragColor = vec4(color, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  #include <fog_fragment>
}
`;

export interface StylizedMaterialOptions {
  /** Base color; multiplied by vertex colors when `vertexColors` is set. */
  color?: THREE.ColorRepresentation;
  vertexColors?: boolean;
  /** Added after lighting: lantern glass, lit windows (plan 14 §4 emissive mask). */
  emissive?: THREE.ColorRepresentation;
  doubleSided?: boolean;
  /**
   * Dither out between these distances from the camera, meters (vegetation meshes handing
   * over to impostors). The uniforms are shared, so one preset change moves them all.
   */
  fade?: { start: THREE.IUniform<number>; end: THREE.IUniform<number> };
}

export type StylizedMaterial = THREE.ShaderMaterial & {
  uniforms: StyleLightingUniforms & {
    uColor: THREE.IUniform<THREE.Color>;
    uEmissive: THREE.IUniform<THREE.Color>;
  };
};

export function createStylizedMaterial(
  style: StyleId,
  lighting: StyleLighting,
  options: StylizedMaterialOptions = {},
): StylizedMaterial {
  const material = new THREE.ShaderMaterial({
    uniforms: {
      ...THREE.UniformsUtils.clone(THREE.UniformsLib.fog),
      // Shared by reference: one time-of-day change reaches every material.
      ...lighting.uniforms,
      uColor: { value: new THREE.Color(options.color ?? 0xffffff) },
      uEmissive: { value: new THREE.Color(options.emissive ?? 0x000000) },
      ...(options.fade ? { uFadeStart: options.fade.start, uFadeEnd: options.fade.end } : {}),
    },
    defines: {
      ...(style === 'flat' ? { STYLE_FLAT: '' } : { STYLE_TOON: '' }),
      ...(options.fade ? { USE_DISTANCE_FADE: '' } : {}),
    },
    vertexShader,
    fragmentShader,
    vertexColors: options.vertexColors ?? false,
    side: options.doubleSided ? THREE.DoubleSide : THREE.FrontSide,
    fog: true,
  });
  material.name = `stylized-${style}`;
  return material as StylizedMaterial;
}

/**
 * Swap every mesh under `root` to the stylized material, keeping each mesh's vertex
 * colors, base color, emissive and sidedness. Meshes tagged `userData.keepMaterial`
 * (the lighthouse beam, glare sprites) are left alone.
 */
export function applyStylizedMaterials(
  root: THREE.Object3D,
  style: StyleId,
  lighting: StyleLighting,
): void {
  root.traverse((node) => {
    if (!(node instanceof THREE.Mesh) || node.userData['keepMaterial']) return;
    const old = node.material as THREE.Material & {
      color?: THREE.Color;
      emissive?: THREE.Color;
      vertexColors?: boolean;
    };
    const source = (node.userData['styleSource'] as typeof old | undefined) ?? old;
    node.userData['styleSource'] = source;
    const options: StylizedMaterialOptions = {
      vertexColors: source.vertexColors === true,
      doubleSided: source.side === THREE.DoubleSide,
    };
    if (source.color) options.color = source.color;
    if (source.emissive) options.emissive = source.emissive;
    node.material = createStylizedMaterial(style, lighting, options);
    if (old !== source) old.dispose();
  });
}
