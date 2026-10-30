import * as THREE from 'three';
import type { HarborLayout } from '../../sim/harbors';
import { lampLevel } from '../../sim/lighthouses';
import { PALETTE } from '../style/palette';
import {
  createStylizedMaterial,
  type StyleLighting,
  type StylizedMaterial,
} from '../style/stylized-material';
import { buildHarbor } from './harbor-kit';

/**
 * Bayfield and Ashland drawn (plan 03 §3.4; Phase 2 piece G): per harbor, one mesh for
 * everything solid and one for the windows that light up from dusk, so the two towns cost
 * four draw calls. No outlines: the waterfront is scenery, and plan 14 keeps ink for hero
 * objects.
 */

export interface HarborView {
  readonly group: THREE.Group;
  readonly triangles: number;
  update(sunElevationDeg: number): void;
  dispose(): void;
}

export function createHarbors(
  layouts: readonly HarborLayout[],
  heightAt: (x: number, z: number) => number,
  lighting: StyleLighting,
): HarborView {
  const group = new THREE.Group();
  group.name = 'harbors';
  const body = createStylizedMaterial('toon', lighting, { vertexColors: true });
  const lit = createStylizedMaterial('toon', lighting, { vertexColors: true });
  const meshes: THREE.Mesh[] = [];
  let triangles = 0;
  for (const layout of layouts) {
    const parts = buildHarbor(layout, heightAt);
    triangles += parts.triangles;
    const solid = new THREE.Mesh(parts.body, body);
    solid.name = `${layout.def.id}-body`;
    const windows = new THREE.Mesh(parts.litWindows, lit);
    windows.name = `${layout.def.id}-windows`;
    group.add(solid, windows);
    meshes.push(solid, windows);
  }
  const glow = new THREE.Color(PALETTE.windowAmber);
  return {
    group,
    triangles,
    update(sunElevationDeg) {
      (lit as StylizedMaterial).uniforms.uEmissive.value
        .copy(glow)
        .multiplyScalar(0.95 * lampLevel(sunElevationDeg));
    },
    dispose() {
      for (const m of meshes) m.geometry.dispose();
      body.dispose();
      lit.dispose();
    },
  };
}
