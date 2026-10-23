import * as THREE from 'three';
import { writeWaveUniforms, type Sea } from '../../sim/weather/waves';
import type { QualityPreset } from '../quality';
import { createWaterMaterial } from './water-material';

/** Outer radius of the water disc; fog hides the edge well before it (plan 04 §7). */
const WATER_RADIUS_M = 2500;
/** Spacing of the first ring at the camera, meters. */
const INNER_SPACING_M = 0.5;
/** The disc moves with the camera in steps of this size, so vertices don't swim. */
const SNAP_M = 4;

/**
 * A camera-centered polar grid, dense near the camera and sparse far away: one draw
 * call. Ring radii grow geometrically so the first ring is INNER_SPACING_M out.
 */
export function createPolarGrid(rings: number, segments: number): THREE.BufferGeometry {
  // Solve a·(e^(b·rings) − 1) = R with a·(e^b − 1) = INNER_SPACING_M for b by bisection.
  const ratio = WATER_RADIUS_M / INNER_SPACING_M;
  let lo = 1e-4;
  let hi = 2;
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2;
    if ((Math.exp(mid * rings) - 1) / (Math.exp(mid) - 1) > ratio) hi = mid;
    else lo = mid;
  }
  const b = (lo + hi) / 2;
  const a = INNER_SPACING_M / (Math.exp(b) - 1);

  const positions = new Float32Array((1 + rings * segments) * 3);
  for (let r = 1; r <= rings; r++) {
    const radius = a * (Math.exp(b * r) - 1);
    for (let s = 0; s < segments; s++) {
      const angle = (s / segments) * Math.PI * 2;
      const i = (1 + (r - 1) * segments + s) * 3;
      positions[i] = Math.cos(angle) * radius;
      positions[i + 2] = Math.sin(angle) * radius;
    }
  }

  const indices: number[] = [];
  const at = (r: number, s: number): number => 1 + (r - 1) * segments + (s % segments);
  // Winding is counter-clockwise seen from above, so the top face points up.
  for (let s = 0; s < segments; s++) indices.push(0, at(1, s + 1), at(1, s));
  for (let r = 1; r < rings; r++) {
    for (let s = 0; s < segments; s++) {
      indices.push(at(r, s), at(r, s + 1), at(r + 1, s));
      indices.push(at(r, s + 1), at(r + 1, s + 1), at(r + 1, s));
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  return geometry;
}

export interface Water {
  readonly mesh: THREE.Mesh;
  readonly material: ReturnType<typeof createWaterMaterial>;
  applyPreset(preset: QualityPreset): void;
  /** Upload a new wave set (weather change, dev panel). */
  setWaves(sea: Sea): void;
  update(camera: THREE.Camera, seaTime: number): void;
}

export function createWater(sea: Sea, preset: QualityPreset): Water {
  const material = createWaterMaterial();
  const mesh = new THREE.Mesh(createPolarGrid(preset.waterRings, preset.waterSegments), material);
  // The vertex shader moves vertices outside the flat bounds.
  mesh.frustumCulled = false;
  mesh.name = 'water';

  const water: Water = {
    mesh,
    material,
    applyPreset(p) {
      mesh.geometry.dispose();
      mesh.geometry = createPolarGrid(p.waterRings, p.waterSegments);
      material.uniforms.uWaveCount.value = Math.min(p.waveCount, sea.waves.length);
      material.uniforms.uCrestFoam.value = p.crestFoam ? 1 : 0;
    },
    setWaves(next) {
      writeWaveUniforms(next.waves, material.uniforms.uWaveA.value, material.uniforms.uWaveB.value);
    },
    update(camera, seaTime) {
      mesh.position.set(
        Math.round(camera.position.x / SNAP_M) * SNAP_M,
        0,
        Math.round(camera.position.z / SNAP_M) * SNAP_M,
      );
      material.uniforms.uTime.value = seaTime;
    },
  };
  water.setWaves(sea);
  water.applyPreset(preset);
  return water;
}
