import * as THREE from 'three';
import { PLANT_STRIDE } from '../../sim/terrain/vegetation';
import { DITHER_GLSL, STYLE_LIGHT_GLSL, type StyleLighting } from '../style/stylized-material';
import type { PlantModel } from './plant-models';

/**
 * Generated tree impostors (plan 14 §7 step 5, plan 03 §8.3): each tree kind is drawn once
 * from the side into an atlas cell, color in one texture and normals in another, and far
 * trees become camera-facing quads that sample it. The normals let the quads take the same
 * toon light as the meshes, so the hand-over at the LOD distance doesn't flash at dusk.
 *
 * Trees are round enough that one view serves every direction; the quads turn about the
 * vertical only, so trunks stay upright from the deck and from the tactical view alike.
 */

/** Pixels per atlas cell; the cells sit side by side, one per tree kind. */
export const CELL_W = 128;
export const CELL_H = 256;
/** Extra room around each model in its cell, so mipmaps don't bleed between kinds. */
const PAD = 1.08;

export interface ImpostorAtlas {
  albedo: THREE.Texture;
  normal: THREE.Texture;
  /** Quad half-width and height per kind, meters at scale 1. */
  sizes: { halfWidth: number; height: number }[];
  dispose(): void;
}

const normalMaterial = (): THREE.ShaderMaterial =>
  new THREE.ShaderMaterial({
    vertexShader: /* glsl */ `
      varying vec3 vNormal;
      void main() {
        vNormal = normal;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      varying vec3 vNormal;
      void main() {
        vec3 n = normalize(vNormal);
        if (!gl_FrontFacing) n = -n;
        gl_FragColor = vec4(n * 0.5 + 0.5, 1.0);
      }`,
    side: THREE.DoubleSide,
  });

/**
 * Draws each model into its cell. The camera looks along −z, so the atlas's normals are in
 * the quad's own frame: x to the right, y up, z toward the viewer.
 */
export function bakeImpostors(renderer: THREE.WebGLRenderer, models: PlantModel[]): ImpostorAtlas {
  const width = CELL_W * models.length;
  const target = (srgb: boolean): THREE.WebGLRenderTarget => {
    const rt = new THREE.WebGLRenderTarget(width, CELL_H, {
      generateMipmaps: true,
      minFilter: THREE.LinearMipmapLinearFilter,
      magFilter: THREE.LinearFilter,
      depthBuffer: true,
    });
    if (srgb) rt.texture.colorSpace = THREE.SRGBColorSpace;
    return rt;
  };
  const albedoTarget = target(true);
  const normalTarget = target(false);

  const scene = new THREE.Scene();
  const albedoMaterial = new THREE.MeshBasicMaterial({
    vertexColors: true,
    side: THREE.DoubleSide,
  });
  const normals = normalMaterial();
  const mesh = new THREE.Mesh<THREE.BufferGeometry, THREE.Material>(
    models[0]?.geometry,
    albedoMaterial,
  );
  scene.add(mesh);
  const camera = new THREE.OrthographicCamera(-1, 1, 1, 0, 0.1, 100);
  camera.position.set(0, 0, 50);

  const previousTarget = renderer.getRenderTarget();
  const previousClear = renderer.getClearColor(new THREE.Color());
  const previousAlpha = renderer.getClearAlpha();
  const previousToneMapping = renderer.toneMapping;
  const previousAutoClear = renderer.autoClear;
  renderer.toneMapping = THREE.NoToneMapping;
  renderer.autoClear = false;
  renderer.setClearColor(0x000000, 0);

  const sizes = models.map((m) => ({ halfWidth: m.radius * PAD, height: m.height * PAD }));
  for (const [rt, material] of [
    [albedoTarget, albedoMaterial],
    [normalTarget, normals],
  ] as const) {
    renderer.setRenderTarget(rt);
    renderer.clear();
    mesh.material = material;
    models.forEach((m, k) => {
      const s = sizes[k] as { halfWidth: number; height: number };
      mesh.geometry = m.geometry;
      camera.left = -s.halfWidth;
      camera.right = s.halfWidth;
      camera.top = s.height;
      camera.bottom = 0;
      camera.updateProjectionMatrix();
      rt.viewport.set(k * CELL_W, 0, CELL_W, CELL_H);
      renderer.setRenderTarget(rt);
      renderer.render(scene, camera);
    });
  }

  renderer.setRenderTarget(previousTarget);
  renderer.setClearColor(previousClear, previousAlpha);
  renderer.toneMapping = previousToneMapping;
  renderer.autoClear = previousAutoClear;
  albedoMaterial.dispose();
  normals.dispose();

  return {
    albedo: albedoTarget.texture,
    normal: normalTarget.texture,
    sizes,
    dispose() {
      albedoTarget.dispose();
      normalTarget.dispose();
    },
  };
}

export interface ImpostorUniforms {
  [name: string]: THREE.IUniform;
  /** Impostors fade in between these distances as the meshes fade out, meters. */
  uNearStart: THREE.IUniform<number>;
  uNearEnd: THREE.IUniform<number>;
  /** And fade out between these, into the terrain's canopy color. */
  uFarStart: THREE.IUniform<number>;
  uFarEnd: THREE.IUniform<number>;
}

const vertexShader = /* glsl */ `
#include <common>
#include <fog_pars_vertex>

// One planted tree per instance (sim/terrain/vegetation): x, y, z, scale; yaw, kind, tint, rank.
attribute vec4 aPlace;
attribute vec4 aShape;

uniform vec2 uSize0;
uniform vec2 uSize1;
uniform float uKinds;
uniform float uNearStart;
uniform float uNearEnd;
uniform float uFarStart;
uniform float uFarEnd;

varying vec2 vUv;
varying vec3 vRight;
varying vec3 vToward;
varying vec3 vWorldPos;
varying float vNear;
varying float vFar;
varying float vTint;

void main() {
  vec3 base = aPlace.xyz - vec3(0.0, 0.3, 0.0);
  vec3 toCamera = cameraPosition - base;
  float d = length(toCamera);
  vNear = 1.0 - smoothstep(uNearStart, uNearEnd, d);
  vFar = 1.0 - smoothstep(uFarStart, uFarEnd, d);
  if (vNear >= 1.0 || vFar <= 0.0) {
    // The mesh draws it, or nothing does: a zero-area triangle outside the clip volume.
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    return;
  }
  float kind = aShape.y;
  vec2 size = kind < 0.5 ? uSize0 : uSize1;
  vec3 toward = normalize(vec3(toCamera.x, 0.0, toCamera.z) + vec3(1e-4, 0.0, 0.0));
  vec3 right = vec3(toward.z, 0.0, -toward.x);
  float s = aPlace.w;
  vec3 world = base + right * (position.x * 2.0 * size.x * s) + vec3(0.0, position.y * size.y * s, 0.0);
  vUv = vec2((kind + position.x + 0.5) / uKinds, position.y);
  vRight = right;
  vToward = toward;
  vWorldPos = world;
  vTint = 0.85 + 0.3 * aShape.z;
  vec4 mvPosition = viewMatrix * vec4(world, 1.0);
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}
`;

const fragmentShader = /* glsl */ `
#include <common>
#include <fog_pars_fragment>

${STYLE_LIGHT_GLSL}
${DITHER_GLSL}

uniform sampler2D uAlbedo;
uniform sampler2D uNormalMap;

varying vec2 vUv;
varying vec3 vRight;
varying vec3 vToward;
varying vec3 vWorldPos;
varying float vNear;
varying float vFar;
varying float vTint;

void main() {
  vec4 albedo = texture2D(uAlbedo, vUv);
  if (albedo.a < 0.4) discard;
  // The mesh draws the pixels below vNear; together they cover each pixel exactly once.
  float t = ditherThreshold();
  if (t < vNear || t >= vFar) discard;
  vec3 b = texture2D(uNormalMap, vUv).xyz * 2.0 - 1.0;
  vec3 n = normalize(vRight * b.x + vec3(0.0, b.y, 0.0) + vToward * b.z);
  gl_FragColor = vec4(albedo.rgb * vTint * styleLight(n, vWorldPos), 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  #include <fog_fragment>
}
`;

export type ImpostorMaterial = THREE.ShaderMaterial & { uniforms: ImpostorUniforms };

/** The impostor material; the fade uniforms are shared, so presets move every tile at once. */
export function createImpostorMaterial(
  atlas: ImpostorAtlas,
  lighting: StyleLighting,
  fades: Pick<ImpostorUniforms, 'uNearStart' | 'uNearEnd' | 'uFarStart' | 'uFarEnd'>,
): ImpostorMaterial {
  const size = (k: number): THREE.Vector2 => {
    const s = atlas.sizes[k] ?? atlas.sizes[0] ?? { halfWidth: 1, height: 1 };
    return new THREE.Vector2(s.halfWidth, s.height);
  };
  const material = new THREE.ShaderMaterial({
    uniforms: {
      ...THREE.UniformsUtils.clone(THREE.UniformsLib.fog),
      ...lighting.uniforms,
      ...fades,
      uAlbedo: { value: atlas.albedo },
      uNormalMap: { value: atlas.normal },
      uSize0: { value: size(0) },
      uSize1: { value: size(1) },
      uKinds: { value: atlas.sizes.length },
    },
    defines: { STYLE_TOON: '' },
    vertexShader,
    fragmentShader,
    side: THREE.DoubleSide,
    fog: true,
  });
  material.name = 'tree-impostor';
  return material as ImpostorMaterial;
}

/**
 * One tile's impostors as one instanced draw, straight over the planting array (no copy).
 * `bounds` is the tile's box for frustum culling.
 */
export function createImpostorGeometry(
  trees: Float32Array,
  bounds: THREE.Box3,
): THREE.InstancedBufferGeometry {
  const geometry = new THREE.InstancedBufferGeometry();
  // A unit quad, x across −0.5…0.5 and y up 0…1. Each tile has its own, so disposing one
  // tile never frees another's buffers.
  geometry.setAttribute(
    'position',
    new THREE.BufferAttribute(new Float32Array([-0.5, 0, 0, 0.5, 0, 0, 0.5, 1, 0, -0.5, 1, 0]), 3),
  );
  geometry.setIndex([0, 1, 2, 0, 2, 3]);
  const buffer = new THREE.InstancedInterleavedBuffer(trees, PLANT_STRIDE, 1);
  geometry.setAttribute('aPlace', new THREE.InterleavedBufferAttribute(buffer, 4, 0));
  geometry.setAttribute('aShape', new THREE.InterleavedBufferAttribute(buffer, 4, 4));
  geometry.instanceCount = trees.length / PLANT_STRIDE;
  geometry.boundingBox = bounds.clone();
  geometry.boundingSphere = bounds.getBoundingSphere(new THREE.Sphere());
  return geometry;
}
