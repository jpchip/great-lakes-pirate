import * as THREE from 'three/webgpu';
import type { Node } from 'three/webgpu';
import {
  cameraPosition,
  clamp,
  cos,
  distance,
  dot,
  float,
  floor,
  Fn,
  fract,
  If,
  int,
  Loop,
  max,
  mix,
  modelWorldMatrix,
  normalize,
  pow,
  positionLocal,
  sin,
  smoothstep,
  step,
  uniform,
  uniformArray,
  varyingProperty,
  vec2,
  vec3,
  vec4,
} from 'three/tsl';
import { MAX_WAVES, writeWaveUniforms, type Sea } from '../../src/sim/weather/waves';
import type { QualityPreset } from '../../src/render/quality';
import { createPolarGrid } from '../../src/render/water/water';

/**
 * The S2 water shader ported to TSL for spike S1, term for term with
 * src/render/water/water-material.ts so both renderers draw the same sea. If S1 picks
 * WebGPU this moves into src/render/water/.
 */

const hash = (p: Node<'vec2'>): Node<'float'> =>
  fract(sin(dot(p, vec2(127.1, 311.7))).mul(43758.5453));

function valueNoise(p: Node<'vec2'>): Node<'float'> {
  const i = floor(p);
  const f = fract(p);
  const u = f.mul(f).mul(f.mul(-2).add(3));
  return mix(
    mix(hash(i), hash(i.add(vec2(1, 0))), u.x),
    mix(hash(i.add(vec2(0, 1))), hash(i.add(vec2(1, 1))), u.x),
    u.y,
  );
}

export interface TslWater {
  readonly mesh: THREE.Mesh;
  readonly crestFoam: { value: number };
  applyPreset(preset: QualityPreset): void;
  update(camera: THREE.Camera, seaTime: number): void;
}

const SNAP_M = 4;

export function createTslWater(
  sea: Sea,
  preset: QualityPreset,
  sun: THREE.Vector3,
  sky: THREE.Color,
): TslWater {
  const uTime = uniform(0);
  const uWaveCount = uniform(4, 'int');
  const waveA = Array.from({ length: MAX_WAVES }, () => new THREE.Vector4());
  const waveB = Array.from({ length: MAX_WAVES }, () => new THREE.Vector4());
  const packedA = new Float32Array(MAX_WAVES * 4);
  const packedB = new Float32Array(MAX_WAVES * 4);
  writeWaveUniforms(sea.waves, packedA, packedB);
  waveA.forEach((v, i) => v.fromArray(packedA, i * 4));
  waveB.forEach((v, i) => v.fromArray(packedB, i * 4));
  const uWaveA = uniformArray(waveA, 'vec4' as const); // dir.x, dir.z, k, amplitude
  const uWaveB = uniformArray(waveB, 'vec4' as const); // omega, phase, steepness, unused

  const uDeep = uniform(new THREE.Color(0x1d3a4a));
  const uCrest = uniform(new THREE.Color(0x4f7f8c));
  const uSky = uniform(sky.clone());
  const uFoam = uniform(new THREE.Color(0xe8eef0));
  const uSun = uniform(new THREE.Color(0xfff2d6));
  const uSunDir = uniform(sun.clone());
  const uCrestFoam = uniform(1);
  const uFoamThreshold = uniform(0.5);

  const vNormal = varyingProperty('vec3', 'vWaterNormal');
  const vWorld = varyingProperty('vec3', 'vWaterWorld');
  const vCrest = varyingProperty('float', 'vWaterCrest');
  const vHeight = varyingProperty('float', 'vWaterHeight');

  const material = new THREE.MeshBasicNodeMaterial();
  material.positionNode = Fn(() => {
    const world = modelWorldMatrix.mul(vec4(positionLocal, 1)).xyz;
    const p0 = world.xz;
    const dist = distance(p0, cameraPosition.xz);
    const disp = vec3(0, 0, 0).toVar();
    const n = vec3(0, 1, 0).toVar();
    const crest = float(0).toVar();
    Loop({ start: int(0), end: uWaveCount, type: 'int', condition: '<' }, ({ i }) => {
      const a = uWaveA.element(i);
      const b = uWaveB.element(i);
      const wavelength = float(6.2831853).div(a.z);
      const fade = float(1).sub(smoothstep(wavelength.mul(8), wavelength.mul(30), dist));
      const amp = a.w.mul(fade);
      const steep = b.z.mul(fade);
      const theta = a.z.mul(dot(a.xy, p0)).sub(b.x.mul(uTime)).add(b.y);
      const c = cos(theta);
      const s = sin(theta);
      const horizontal = steep.div(a.z).mul(c);
      disp.x.addAssign(a.x.mul(horizontal));
      disp.z.addAssign(a.y.mul(horizontal));
      disp.y.addAssign(amp.mul(s));
      n.x.subAssign(a.x.mul(a.z).mul(amp).mul(c));
      n.z.subAssign(a.y.mul(a.z).mul(amp).mul(c));
      n.y.subAssign(steep.mul(s));
      crest.addAssign(steep.mul(s));
    });
    vNormal.assign(n);
    vWorld.assign(world.add(disp));
    vCrest.assign(crest);
    vHeight.assign(disp.y);
    // The mesh is only ever translated, so a world-space offset is a local one.
    return positionLocal.add(disp);
  })();

  material.colorNode = Fn(() => {
    const n = normalize(vNormal);
    const toCamera = normalize(cameraPosition.sub(vWorld));

    // Toon-banded diffuse: three steps of sun light.
    const ndl = max(dot(n, uSunDir), 0);
    const band = floor(ndl.mul(3).add(0.5)).div(3);
    const lift = clamp(vHeight.mul(0.5).add(0.5), 0, 1);
    const color = mix(uDeep, uCrest, band.mul(0.25).add(lift.mul(0.35))).toVar();

    // Sky tint at grazing angles, in two bands.
    const fresnel = pow(float(1).sub(max(dot(n, toCamera), 0)), 3);
    color.assign(mix(color, uSky, step(0.3, fresnel).mul(0.12).add(step(0.65, fresnel).mul(0.2))));

    // Banded sun glint.
    const halfway = normalize(uSunDir.add(toCamera));
    const glint = pow(max(dot(n, halfway), 0), 220);
    color.addAssign(uSun.mul(step(0.35, glint)).mul(0.9));

    // Crest foam where the waves pinch, broken up by noise.
    If(uCrestFoam.greaterThan(0.5), () => {
      const p = vWorld.xz;
      const noise = valueNoise(p.mul(0.6))
        .mul(0.5)
        .add(valueNoise(p.mul(2.1)).mul(0.5));
      const foam = step(uFoamThreshold, vCrest.add(noise.sub(0.5).mul(0.25)));
      color.assign(mix(color, uFoam, foam.mul(0.85)));
    });
    return color;
  })();

  const mesh = new THREE.Mesh(createPolarGrid(preset.waterRings, preset.waterSegments), material);
  mesh.frustumCulled = false;
  mesh.name = 'water';

  const water: TslWater = {
    mesh,
    crestFoam: uCrestFoam,
    applyPreset(p) {
      mesh.geometry.dispose();
      mesh.geometry = createPolarGrid(p.waterRings, p.waterSegments);
      uWaveCount.value = Math.min(p.waveCount, sea.waves.length);
      uCrestFoam.value = p.crestFoam ? 1 : 0;
    },
    update(camera, seaTime) {
      mesh.position.set(
        Math.round(camera.position.x / SNAP_M) * SNAP_M,
        0,
        Math.round(camera.position.z / SNAP_M) * SNAP_M,
      );
      uTime.value = seaTime;
    },
  };
  water.applyPreset(preset);
  return water;
}

/** The gradient sky dome from src/render/sky.ts, in TSL. */
export function createTslSky(horizon: THREE.Color, zenith: THREE.Color): THREE.Mesh {
  const material = new THREE.MeshBasicNodeMaterial({ side: THREE.BackSide, depthWrite: false });
  material.fog = false;
  const h = clamp(normalize(positionLocal).y, 0, 1);
  material.colorNode = mix(uniform(horizon), uniform(zenith), pow(h, 0.6));
  const sky = new THREE.Mesh(new THREE.SphereGeometry(3000, 24, 12), material);
  sky.name = 'sky';
  sky.frustumCulled = false;
  sky.renderOrder = -1;
  return sky;
}
