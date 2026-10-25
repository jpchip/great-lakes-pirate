import * as THREE from 'three';
import { mergeVertices, toCreasedNormals } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { PALETTE } from './palette';

/**
 * Ink outlines for style B (plan 14 §3.3), the "inverted hull" way: each closed mesh
 * gets a second copy drawn back faces only, pushed out along its smooth normals by a
 * fixed number of pixels. It costs one extra draw call and the mesh's triangles again,
 * only on the hero objects that carry it (plan 14 §14). Open surfaces (sails) have no
 * back to show, so they get 1-pixel edge lines instead.
 */

export interface OutlineUniforms {
  [name: string]: THREE.IUniform;
  /** Outline width in device pixels at `uReferenceDistance` or closer. */
  uWidth: THREE.IUniform<number>;
  /** Beyond this distance, meters, the outline thins (to 35% at 3× the distance). */
  uReferenceDistance: THREE.IUniform<number>;
  uResolution: THREE.IUniform<THREE.Vector2>;
  uInk: THREE.IUniform<THREE.Color>;
}

export class OutlineSettings {
  readonly uniforms: OutlineUniforms = {
    uWidth: { value: 2 },
    uReferenceDistance: { value: 60 },
    uResolution: { value: new THREE.Vector2(1920, 1080) },
    uInk: { value: new THREE.Color(PALETTE.ink) },
  };
  /** Shared by every edge-line material. */
  readonly lineMaterial = new THREE.LineBasicMaterial({ color: PALETTE.ink, fog: true });

  /** Call after every resize or pixel-ratio change. */
  setResolution(renderer: THREE.WebGLRenderer): void {
    renderer.getDrawingBufferSize(this.uniforms.uResolution.value);
  }
}

const vertexShader = /* glsl */ `
#include <common>
#include <fog_pars_vertex>

uniform float uWidth;
uniform float uReferenceDistance;
uniform vec2 uResolution;

void main() {
  vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
  vec4 clip = projectionMatrix * mvPosition;
  vec3 viewNormal = normalize(normalMatrix * normal);
  vec2 direction = (projectionMatrix * vec4(viewNormal, 0.0)).xy;
  direction /= max(length(direction), 1e-5);
  float thin = clamp(uReferenceDistance / max(-mvPosition.z, 1e-3), 0.35, 1.0);
  // Offset in pixels: clip space spans 2 units across the buffer, times w.
  clip.xy += direction * (uWidth * thin * 2.0 / uResolution) * clip.w;
  gl_Position = clip;
  #include <fog_vertex>
}
`;

const fragmentShader = /* glsl */ `
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

export function createOutlineMaterial(settings: OutlineSettings): THREE.ShaderMaterial {
  const material = new THREE.ShaderMaterial({
    uniforms: { ...THREE.UniformsUtils.clone(THREE.UniformsLib.fog), ...settings.uniforms },
    vertexShader,
    fragmentShader,
    side: THREE.BackSide,
    fog: true,
  });
  material.name = 'outline';
  return material;
}

/**
 * Replace flat-shaded triangle soups with creased smooth normals, so the toon bands follow
 * the shape instead of each face. Style A ignores mesh normals, so this is safe for both.
 */
export function creaseNormals(root: THREE.Object3D, creaseAngleDeg = 40): void {
  root.traverse((node) => {
    if (!(node instanceof THREE.Mesh) || node.userData['keepMaterial']) return;
    if (node.geometry.index) return; // indexed meshes (GLB) keep their authored normals
    const creased = toCreasedNormals(node.geometry, THREE.MathUtils.degToRad(creaseAngleDeg));
    node.geometry.dispose();
    node.geometry = creased;
  });
}

/** Smooth, welded normals for the outline shell, so it has no cracks at hard edges. */
function shellGeometry(source: THREE.BufferGeometry): THREE.BufferGeometry {
  const positions = new THREE.BufferGeometry();
  positions.setAttribute('position', source.getAttribute('position'));
  if (source.index) positions.setIndex(source.index);
  const welded = mergeVertices(positions, 1e-3);
  welded.computeVertexNormals();
  return welded;
}

export interface OutlineOptions {
  /** Meshes whose material is double-sided (sails) get edge lines instead of a shell. */
  edgeAngleDeg?: number;
}

/**
 * Add outline shells (closed meshes) and edge lines (double-sided surfaces) under every
 * mesh in `root`. Returns the added objects so the caller can toggle or remove them.
 */
export function addOutlines(
  root: THREE.Object3D,
  settings: OutlineSettings,
  options: OutlineOptions = {},
): THREE.Object3D[] {
  const added: THREE.Object3D[] = [];
  const meshes: THREE.Mesh[] = [];
  root.traverse((node) => {
    if (node instanceof THREE.Mesh && !node.userData['keepMaterial'] && !node.userData['noOutline'])
      meshes.push(node);
  });
  const shellMaterial = createOutlineMaterial(settings);
  for (const mesh of meshes) {
    const material = mesh.material as THREE.Material;
    let outline: THREE.Object3D;
    if (material.side === THREE.DoubleSide) {
      outline = new THREE.LineSegments(
        new THREE.EdgesGeometry(mesh.geometry, options.edgeAngleDeg ?? 30),
        settings.lineMaterial,
      );
    } else {
      outline = new THREE.Mesh(shellGeometry(mesh.geometry), shellMaterial);
    }
    outline.name = `${mesh.name || 'mesh'}-outline`;
    outline.userData['keepMaterial'] = true;
    outline.userData['outline'] = true;
    mesh.add(outline);
    added.push(outline);
  }
  return added;
}
