import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { PALETTE } from '../style/palette';

/**
 * Procedural vegetation meshes (plan 14 §5 "Vegetation", §9 budgets: a tree is 300–800
 * triangles at most, and these come in far under). Every model stands on y = 0 at scale 1
 * and carries palette vertex colors; per-instance tint and scale come from the planting.
 *
 * - Pine: a trunk and three stacked seven-sided cones, about 14 m tall (S7's 1:1 conifer).
 * - Birch: a white trunk under two faceted leaf clumps, about 11 m.
 * - Rock: a squashed, jittered icosahedron about 2 m across.
 */

export interface PlantModel {
  geometry: THREE.BufferGeometry;
  /** Half-width and height of the model, meters, for the impostor's quad. */
  radius: number;
  height: number;
}

function painted(geometry: THREE.BufferGeometry, hex: number, shade = 1): THREE.BufferGeometry {
  const g = geometry.index ? geometry.toNonIndexed() : geometry;
  if (!g.getAttribute('normal')) g.computeVertexNormals();
  const c = new THREE.Color(hex).multiplyScalar(shade);
  const n = g.getAttribute('position').count;
  const colors = new Float32Array(n * 3);
  for (let k = 0; k < n; k++) c.toArray(colors, k * 3);
  g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  g.deleteAttribute('uv');
  return g;
}

function merged(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const g = mergeGeometries(parts);
  if (!g) throw new Error('plant models: parts did not merge');
  g.computeBoundingSphere();
  return g;
}

const TRUNK_BROWN = 0x5a4330;

export function createPine(): PlantModel {
  const trunk = new THREE.CylinderGeometry(0.28, 0.4, 3.2, 5, 1, true).translate(0, 1.6, 0);
  const tiers: [number, number, number, number][] = [
    // radius, height, base, shade
    [3.0, 6.0, 2.4, 0.9],
    [2.3, 5.4, 5.4, 1.0],
    [1.5, 5.0, 8.8, 1.12],
  ];
  const parts = [painted(trunk, TRUNK_BROWN)];
  for (const [r, h, base, shade] of tiers) {
    const cone = new THREE.ConeGeometry(r, h, 7, 1).translate(0, base + h / 2, 0);
    parts.push(painted(cone, PALETTE.pine, shade));
  }
  return { geometry: merged(parts), radius: 3.0, height: 13.8 };
}

export function createBirch(): PlantModel {
  const trunk = new THREE.CylinderGeometry(0.16, 0.24, 8, 6, 1, true).translate(0, 4, 0);
  const low = new THREE.IcosahedronGeometry(2.2, 0).scale(1, 1.25, 1).translate(0, 7.2, 0);
  const high = new THREE.IcosahedronGeometry(1.6, 0)
    .scale(1, 1.3, 1)
    .rotateY(0.6)
    .translate(0.4, 9.4, -0.2);
  return {
    geometry: merged([
      painted(trunk, PALETTE.birch),
      painted(low, PALETTE.birchLeaf, 0.92),
      painted(high, PALETTE.birchLeaf, 1.08),
    ]),
    radius: 2.4,
    height: 11.5,
  };
}

export function createRock(): PlantModel {
  const g = new THREE.IcosahedronGeometry(1, 0);
  const p = g.getAttribute('position');
  // A fixed jitter keyed to each corner's position, so shared corners move together.
  for (let k = 0; k < p.count; k++) {
    const x = p.getX(k);
    const y = p.getY(k);
    const z = p.getZ(k);
    const j = 0.75 + ((Math.abs(Math.sin(x * 12.9898 + y * 78.233 + z * 37.719)) * 7.3) % 0.5);
    p.setXYZ(k, x * j * 1.1, y * j * 0.6, z * j);
  }
  g.computeVertexNormals();
  g.translate(0, 0.15, 0);
  return { geometry: merged([painted(g, PALETTE.shoreRock)]), radius: 1.1, height: 0.8 };
}
