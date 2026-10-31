import * as THREE from 'three';
import { writeWaveUniforms, type Sea, type SeaScaleGrid } from '../../sim/weather/waves';
import type { QualityPreset } from '../quality';
import { createWaterMaterial } from './water-material';
import { deepWaterTexture, shoreRect, shoreTexture, type ShoreGrid } from './shore';

/** Radius of the detailed water disc: the rings the presets' counts cover (plan 04 §7). */
const WATER_RADIUS_M = 2500;
/**
 * The far-water LOD (S7 finding 3): the grid keeps adding rings at the same growth out
 * to here, so the water reaches the far side of a 7 km zone. Waves have faded out by
 * then, so the far rings are flat and cost a few thousand triangles; fog hides the edge.
 */
export const WATER_FAR_RADIUS_M = 10_000;
/** Spacing of the first ring at the camera, meters. */
const INNER_SPACING_M = 0.5;
/** The disc moves with the camera in steps of this size, so vertices don't swim. */
const SNAP_M = 4;

/**
 * A camera-centered polar grid, dense near the camera and sparse far away: one draw
 * call. Ring radii grow geometrically so the first ring is INNER_SPACING_M out and ring
 * `rings` is at WATER_RADIUS_M; past it, rings continue at the same growth out to
 * `farRadius`.
 */
export function createPolarGrid(
  rings: number,
  segments: number,
  farRadius = WATER_RADIUS_M,
): THREE.BufferGeometry {
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
  // The far rings, with the last one exactly on farRadius.
  const total =
    farRadius > WATER_RADIUS_M ? Math.ceil(Math.log(farRadius / a + 1) / b - 1e-9) : rings;
  const ringRadius = (r: number): number =>
    r > rings && r === total ? farRadius : a * (Math.exp(b * r) - 1);

  const positions = new Float32Array((1 + total * segments) * 3);
  for (let r = 1; r <= total; r++) {
    const radius = ringRadius(r);
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
  for (let r = 1; r < total; r++) {
    for (let s = 0; s < segments; s++) {
      indices.push(at(r, s), at(r, s + 1), at(r + 1, s));
      indices.push(at(r, s + 1), at(r + 1, s + 1), at(r + 1, s));
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  // Vertex spacing at distance d from the center is about (d + a) · growth: the larger
  // of the ring-to-ring step and the step around a ring. The shader fades waves the grid
  // can't resolve there.
  const spacing: GridSpacing = {
    offset: a,
    growth: Math.max(Math.exp(b) - 1, (2 * Math.PI) / segments),
  };
  geometry.userData['spacing'] = spacing;
  return geometry;
}

export interface GridSpacing {
  offset: number;
  growth: number;
}

function applySpacing(
  geometry: THREE.BufferGeometry,
  material: ReturnType<typeof createWaterMaterial>,
): void {
  const spacing = geometry.userData['spacing'] as GridSpacing;
  material.uniforms.uGridOffset.value = spacing.offset;
  material.uniforms.uGridGrowth.value = spacing.growth;
}

function seaScaleTexture(grid: SeaScaleGrid): THREE.DataTexture {
  const texture = new THREE.DataTexture(
    grid.data,
    grid.width,
    grid.height,
    THREE.RedFormat,
    THREE.UnsignedByteType,
  );
  // Linear filtering on texel centers matches sampleSeaScale on the CPU.
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearFilter;
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.needsUpdate = true;
  return texture;
}

export interface Water {
  readonly mesh: THREE.Mesh;
  readonly material: ReturnType<typeof createWaterMaterial>;
  applyPreset(preset: QualityPreset): void;
  /** Upload a new wave set (weather change, dev panel). */
  setWaves(sea: Sea): void;
  /** Upload the local sea scale (shelter and fetch). */
  setScale(sea: Sea): void;
  /** Depth bands and shore foam from the zone's shore texture (shore.ts). */
  setShore(grid: ShoreGrid): void;
  /** Open water again: no depth bands or shore foam (the zone was left). */
  clearShore(): void;
  /** Follows the camera and uploads any change the weather made to the sea. */
  update(camera: THREE.Camera, seaTime: number): void;
}

/**
 * `farRadius` is where the water ends; scenes with their own far water (the S7 greybox)
 * can keep the detailed disc only.
 */
export function createWater(
  sea: Sea,
  preset: QualityPreset,
  farRadius = WATER_FAR_RADIUS_M,
): Water {
  const material = createWaterMaterial();
  const mesh = new THREE.Mesh(
    createPolarGrid(preset.waterRings, preset.waterSegments, farRadius),
    material,
  );
  // The vertex shader moves vertices outside the flat bounds.
  mesh.frustumCulled = false;
  // Draw after the land and ships (renderOrder 0) and before the wake (1). The disc is
  // centered on the camera, so by distance it would sort first and shade every pixel the
  // land later covers; drawn after, the depth test skips those (plan 04 §23).
  mesh.renderOrder = 0.5;
  mesh.name = 'water';

  let wavesVersion = sea.wavesVersion;
  let scaleVersion = sea.scaleVersion;
  const water: Water = {
    mesh,
    material,
    applyPreset(p) {
      mesh.geometry.dispose();
      mesh.geometry = createPolarGrid(p.waterRings, p.waterSegments, farRadius);
      applySpacing(mesh.geometry, material);
      material.uniforms.uWaveCount.value = Math.min(p.waveCount, sea.waves.length);
      material.uniforms.uCrestFoam.value = p.crestFoam ? 1 : 0;
    },
    setWaves(next) {
      writeWaveUniforms(next.waves, material.uniforms.uWaveA.value, material.uniforms.uWaveB.value);
      wavesVersion = next.wavesVersion;
    },
    setScale(next) {
      const g = next.scale;
      material.uniforms.uSeaScale.value.dispose();
      material.uniforms.uSeaScale.value = seaScaleTexture(g);
      material.uniforms.uSeaScaleRect.value.set(
        g.minX,
        g.minZ,
        1 / (g.width * g.cellM),
        1 / (g.height * g.cellM),
      );
      scaleVersion = next.scaleVersion;
    },
    setShore(grid) {
      material.uniforms.uShore.value.dispose();
      material.uniforms.uShore.value = shoreTexture(grid);
      shoreRect(grid, material.uniforms.uShoreRect.value);
      material.uniforms.uShoreOn.value = 1;
    },
    clearShore() {
      material.uniforms.uShore.value.dispose();
      material.uniforms.uShore.value = deepWaterTexture();
      material.uniforms.uShoreOn.value = 0;
    },
    update(camera, seaTime) {
      if (sea.wavesVersion !== wavesVersion) water.setWaves(sea);
      if (sea.scaleVersion !== scaleVersion) water.setScale(sea);
      mesh.position.set(
        Math.round(camera.position.x / SNAP_M) * SNAP_M,
        0,
        Math.round(camera.position.z / SNAP_M) * SNAP_M,
      );
      material.uniforms.uTime.value = seaTime;
    },
  };
  water.setWaves(sea);
  water.setScale(sea);
  water.applyPreset(preset);
  return water;
}
