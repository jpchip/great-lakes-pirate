import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { bloom } from 'three/examples/jsm/tsl/display/BloomNode.js';
import { pass } from 'three/tsl';
import { RenderPipeline, WebGPURenderer } from 'three/webgpu';
import type { QualityPreset } from '../../src/render/quality';
import { createPlaceholderSchooner } from '../../src/render/ships/placeholder-schooner';
import { createSky } from '../../src/render/sky';
import { createWater } from '../../src/render/water/water';
import { createSea } from '../../src/sim/weather/waves';
import { createTslSky, createTslWater } from './water-tsl';

/**
 * One "rig" per renderer under test (plan 01 §11.2, spike S1). Each draws the S2 test
 * scene (sky, Gerstner water, the placeholder schooner, fog, hemisphere plus sun light)
 * from a fixed camera, so the only thing that changes between rigs is the renderer and
 * its shader language.
 */

export type RigId = 'webgl' | 'webgpu' | 'webgpu-gl';

export const RIG_LABELS: Record<RigId, string> = {
  webgl: 'WebGLRenderer + GLSL',
  webgpu: 'WebGPURenderer + TSL',
  'webgpu-gl': 'WebGPURenderer + TSL, WebGL2 fallback',
};

export interface Rig {
  readonly id: RigId;
  /** The backend that actually ran: WebGPURenderer falls back to WebGL2 silently. */
  readonly backend: 'WebGL2' | 'WebGPU';
  readonly gpu: string;
  /** Renderer construction (plus `init()` for WebGPURenderer), ms. */
  readonly initMs: number;
  readonly canvas: HTMLCanvasElement;
  /** Errors the device reported (WebGPU validation errors, device loss). */
  readonly deviceErrors: string[];
  setPreset(preset: QualityPreset): void;
  setBloom(on: boolean): void;
  /** Submit one frame; does not wait for the GPU. */
  frame(seaTime: number): void;
  /** Resolves once the GPU has finished every submitted frame. */
  finish(): Promise<void>;
  stats(): { drawCalls: number; triangles: number; width: number; height: number };
  dispose(): void;
}

const HORIZON = new THREE.Color(0xb7c6cf);
const ZENITH = new THREE.Color(0x6f8ea3);
const SUN_DIRECTION = new THREE.Vector3(0.45, 0.55, -0.35).normalize();
// Bloom tuned to catch the sun glint and foam; the cost barely depends on the values.
const BLOOM = { strength: 0.4, radius: 0.4, threshold: 0.85 };

function stage(): { scene: THREE.Scene; camera: THREE.PerspectiveCamera } {
  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog(HORIZON, 150, 1600);
  scene.add(new THREE.HemisphereLight(0xdfe9f0, 0x2a3a44, 1.4));
  const sun = new THREE.DirectionalLight(0xfff2d6, 2);
  sun.position.copy(SUN_DIRECTION).multiplyScalar(100);
  scene.add(sun);
  const schooner = createPlaceholderSchooner();
  schooner.rotation.set(0, -0.6, 0, 'YXZ');
  scene.add(schooner);

  const camera = new THREE.PerspectiveCamera(50, 1, 0.5, 4000);
  camera.position.set(46, 15, 38);
  camera.lookAt(0, 3, 0);
  return { scene, camera };
}

function size(container: HTMLElement, camera: THREE.PerspectiveCamera, preset: QualityPreset) {
  const width = container.clientWidth;
  const height = container.clientHeight;
  camera.aspect = width / Math.max(1, height);
  camera.updateProjectionMatrix();
  // Dynamic resolution held at the preset's top scale, as the S2 bench did.
  const ratio =
    Math.min(window.devicePixelRatio, preset.maxPixelRatio) * preset.resolutionScale.max;
  return { width, height, ratio };
}

function glName(gl: WebGLRenderingContext | WebGL2RenderingContext): string {
  const info = gl.getExtension('WEBGL_debug_renderer_info');
  return String(gl.getParameter(info ? info.UNMASKED_RENDERER_WEBGL : gl.RENDERER));
}

/** readPixels blocks until the GPU has drawn everything before it. */
function glFinish(gl: WebGL2RenderingContext): () => Promise<void> {
  const pixel = new Uint8Array(4);
  return () => {
    gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
    return Promise.resolve();
  };
}

export function createWebGLRig(container: HTMLElement, preset: QualityPreset): Rig {
  const t0 = performance.now();
  const renderer = new THREE.WebGLRenderer({
    antialias: false,
    powerPreference: 'high-performance',
  });
  const initMs = performance.now() - t0;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  container.appendChild(renderer.domElement);
  const gl = renderer.getContext() as WebGL2RenderingContext;

  const { scene, camera } = stage();
  const sky = createSky(HORIZON, ZENITH);
  scene.add(sky);
  const water = createWater(createSea(), preset);
  water.material.uniforms.uSunDirection.value.copy(SUN_DIRECTION);
  water.material.uniforms.uSkyColor.value.copy(HORIZON);
  scene.add(water.mesh);

  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  composer.addPass(
    new UnrealBloomPass(new THREE.Vector2(1, 1), BLOOM.strength, BLOOM.radius, BLOOM.threshold),
  );
  composer.addPass(new OutputPass());
  let bloomOn = false;

  const deviceErrors: string[] = [];
  renderer.domElement.addEventListener('webglcontextlost', () =>
    deviceErrors.push('WebGL context lost'),
  );

  const rig: Rig = {
    id: 'webgl',
    backend: 'WebGL2',
    gpu: glName(gl),
    initMs,
    canvas: renderer.domElement,
    deviceErrors,
    setPreset(p) {
      water.applyPreset(p);
      const { width, height, ratio } = size(container, camera, p);
      renderer.setPixelRatio(ratio);
      renderer.setSize(width, height);
      composer.setPixelRatio(ratio);
      composer.setSize(width, height);
    },
    setBloom(on) {
      bloomOn = on;
    },
    frame(seaTime) {
      sky.position.copy(camera.position);
      water.update(camera, seaTime);
      if (bloomOn) composer.render();
      else renderer.render(scene, camera);
    },
    finish: glFinish(gl),
    stats() {
      const buffer = renderer.getDrawingBufferSize(new THREE.Vector2());
      const { calls, triangles } = renderer.info.render;
      return { drawCalls: calls, triangles, width: buffer.x, height: buffer.y };
    },
    dispose() {
      composer.dispose();
      renderer.dispose();
      renderer.forceContextLoss();
      renderer.domElement.remove();
    },
  };
  rig.setPreset(preset);
  return rig;
}

interface NodeFrame {
  frameId: number;
  update(): void;
}

interface Backend {
  isWebGPUBackend?: boolean;
  device?: GPUDevice;
  gl?: WebGL2RenderingContext;
}

function adapterName(info: GPUAdapterInfo | undefined): string {
  if (!info) return 'unknown adapter';
  const parts = [info.vendor, info.architecture, info.device, info.description].filter(Boolean);
  return parts.join(' / ') || 'adapter info hidden';
}

export async function createWebGPURig(
  container: HTMLElement,
  preset: QualityPreset,
  forceWebGL: boolean,
): Promise<Rig> {
  const t0 = performance.now();
  const renderer = new WebGPURenderer({
    antialias: false,
    powerPreference: 'high-performance',
    forceWebGL,
  });
  await renderer.init();
  const initMs = performance.now() - t0;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  container.appendChild(renderer.domElement);

  const backend = renderer.backend as unknown as Backend;
  const deviceErrors: string[] = [];
  let finish: () => Promise<void>;
  let gpu: string;
  if (backend.isWebGPUBackend && backend.device) {
    const device = backend.device;
    gpu = adapterName(device.adapterInfo);
    device.addEventListener('uncapturederror', (event) =>
      deviceErrors.push(`WebGPU error: ${(event as GPUUncapturedErrorEvent).error.message}`),
    );
    void device.lost.then((info) => {
      if (info.reason !== 'destroyed') deviceErrors.push(`WebGPU device lost: ${info.message}`);
    });
    finish = () => device.queue.onSubmittedWorkDone();
  } else if (backend.gl) {
    gpu = glName(backend.gl);
    finish = glFinish(backend.gl);
  } else {
    throw new Error('WebGPURenderer started without a usable backend');
  }

  const { scene, camera } = stage();
  const sky = createTslSky(HORIZON, ZENITH);
  scene.add(sky);
  const water = createTslWater(createSea(), preset, SUN_DIRECTION, HORIZON);
  scene.add(water.mesh);

  // WebGPURenderer advances its node frame once per setAnimationLoop tick, and per-frame
  // nodes (the bloom's scene pass) skip repeats within one frame. The bench submits many
  // frames per task, so it advances the frame itself, as one game-loop tick would.
  const nodeFrame = (renderer as unknown as { _nodes: { nodeFrame: NodeFrame } })._nodes.nodeFrame;

  const pipeline = new RenderPipeline(renderer);
  const color = pass(scene, camera).getTextureNode('output');
  pipeline.outputNode = color.add(bloom(color, BLOOM.strength, BLOOM.radius, BLOOM.threshold));
  let bloomOn = false;

  const rig: Rig = {
    id: forceWebGL ? 'webgpu-gl' : 'webgpu',
    backend: backend.isWebGPUBackend ? 'WebGPU' : 'WebGL2',
    gpu,
    initMs,
    canvas: renderer.domElement,
    deviceErrors,
    setPreset(p) {
      water.applyPreset(p);
      const { width, height, ratio } = size(container, camera, p);
      renderer.setPixelRatio(ratio);
      renderer.setSize(width, height);
    },
    setBloom(on) {
      bloomOn = on;
    },
    frame(seaTime) {
      sky.position.copy(camera.position);
      water.update(camera, seaTime);
      renderer.info.reset();
      nodeFrame.update();
      (renderer.info as { frame: number }).frame = nodeFrame.frameId;
      if (bloomOn) pipeline.render();
      else renderer.render(scene, camera);
    },
    finish: () => finish(),
    stats() {
      const buffer = renderer.getDrawingBufferSize(new THREE.Vector2());
      const { drawCalls, triangles } = renderer.info.render;
      return { drawCalls, triangles, width: buffer.x, height: buffer.y };
    },
    dispose() {
      pipeline.dispose();
      renderer.dispose();
      renderer.domElement.remove();
    },
  };
  rig.setPreset(preset);
  return rig;
}
