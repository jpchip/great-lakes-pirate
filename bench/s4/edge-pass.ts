import * as THREE from 'three';
import { PALETTE } from '../../src/render/style/palette';

/**
 * The other outline option for style B (plan 14 §3.3): a screen-space edge pass. The
 * scene renders to a target with a depth texture, then one full-screen pass darkens
 * pixels where depth breaks. It outlines everything (sails, rigging, the islet) at a
 * fixed cost per pixel, unlike the inverted hull, which costs per outlined mesh.
 *
 * The edge test is the Laplacian of 1/depth: 1/z is linear across any plane in screen
 * space, so flat and gently curved surfaces (the water) give no edge, while silhouettes
 * and creases do. Edges fade with the scene fog so the horizon gets no ink line.
 */

const vertexShader = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

const fragmentShader = /* glsl */ `
#include <packing>
uniform sampler2D tColor;
uniform sampler2D tDepth;
uniform vec2 uTexel;
uniform float uWidth;
uniform float uNear;
uniform float uFar;
uniform float uThreshold;
uniform vec3 uInk;
uniform float uFogNear;
uniform float uFogFar;
varying vec2 vUv;

float viewDepth(vec2 uv) {
  return -perspectiveDepthToViewZ(texture2D(tDepth, uv).x, uNear, uFar);
}

void main() {
  vec4 color = texture2D(tColor, vUv);
  vec2 d = uTexel * uWidth;
  float c = viewDepth(vUv);
  float l = viewDepth(vUv - vec2(d.x, 0.0));
  float r = viewDepth(vUv + vec2(d.x, 0.0));
  float b = viewDepth(vUv - vec2(0.0, d.y));
  float t = viewDepth(vUv + vec2(0.0, d.y));
  // The nearest of the five decides the fog, so an object's edge against the sky inks.
  float nearest = min(c, min(min(l, r), min(b, t)));
  float ic = 1.0 / c;
  float lap = abs(1.0 / l + 1.0 / r - 2.0 * ic) + abs(1.0 / b + 1.0 / t - 2.0 * ic);
  // Far away, grazing waves break depth too; demand a bigger break with distance there,
  // so only real silhouettes (a ship against the sky, the tower) keep their ink.
  float threshold = uThreshold * (1.0 + c / 60.0);
  float edge = smoothstep(threshold, threshold * 2.0, lap / max(ic, 1e-6));
  edge *= 1.0 - smoothstep(uFogNear, uFogFar, nearest);
  gl_FragColor = vec4(mix(color.rgb, uInk, edge), 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

export class EdgePass {
  private readonly target: THREE.WebGLRenderTarget;
  private readonly material: THREE.ShaderMaterial;
  private readonly quad: THREE.Mesh;
  private readonly quadScene = new THREE.Scene();
  private readonly quadCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private readonly size = new THREE.Vector2();
  private readonly uniforms = {
    tColor: { value: null as THREE.Texture | null },
    tDepth: { value: null as THREE.DepthTexture | null },
    uTexel: { value: new THREE.Vector2() },
    uWidth: { value: 1.5 },
    uNear: { value: 0.5 },
    uFar: { value: 4000 },
    uThreshold: { value: 0.02 },
    uInk: { value: new THREE.Color(PALETTE.ink) },
    uFogNear: { value: 400 },
    uFogFar: { value: 2600 },
  };

  constructor(
    private readonly renderer: THREE.WebGLRenderer,
    samples: number,
  ) {
    this.renderer.getDrawingBufferSize(this.size);
    this.target = new THREE.WebGLRenderTarget(this.size.x, this.size.y, {
      type: THREE.HalfFloatType,
      depthTexture: new THREE.DepthTexture(this.size.x, this.size.y),
      samples,
    });
    this.material = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      vertexShader,
      fragmentShader,
      depthTest: false,
      depthWrite: false,
    });
    this.uniforms.tColor.value = this.target.texture;
    this.uniforms.tDepth.value = this.target.depthTexture;
    this.uniforms.uTexel.value.set(1 / this.size.x, 1 / this.size.y);
    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.material);
    this.quad.frustumCulled = false;
    this.quadScene.add(this.quad);
  }

  /** Width in device pixels. */
  set width(px: number) {
    this.uniforms.uWidth.value = px;
  }

  render(scene: THREE.Scene, camera: THREE.PerspectiveCamera): void {
    const size = this.renderer.getDrawingBufferSize(new THREE.Vector2());
    if (!size.equals(this.size)) {
      this.size.copy(size);
      this.target.setSize(size.x, size.y);
      this.uniforms.uTexel.value.set(1 / size.x, 1 / size.y);
    }
    const u = this.uniforms;
    u.uNear.value = camera.near;
    u.uFar.value = camera.far;
    if (scene.fog instanceof THREE.Fog) {
      u.uFogNear.value = scene.fog.near;
      u.uFogFar.value = scene.fog.far;
    }
    this.renderer.setRenderTarget(this.target);
    this.renderer.render(scene, camera);
    this.renderer.setRenderTarget(null);
    this.renderer.render(this.quadScene, this.quadCamera);
  }

  dispose(): void {
    this.target.depthTexture?.dispose();
    this.target.dispose();
    this.material.dispose();
    this.quad.geometry.dispose();
  }
}
