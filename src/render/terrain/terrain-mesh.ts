import * as THREE from 'three';
import type { GridField } from '../../sim/terrain/grid-field';
import type { TerrainBounds, ZoneTerrain } from '../../sim/terrain/zone-terrain';
import type { QualityPreset } from '../quality';

/**
 * Basic terrain rendering for the loaded slice (plan 03 §8.3, Phase 1 piece B): one mesh
 * per sailing tile at the preset's stride, with skirts to hide cracks, over a coarse
 * backdrop of the whole zone that stops land at the slice edge from ending in a wall.
 * Greybox colors by height and slope until the art style pick (plan 14) brings a shader.
 * Geomipmapping and tile streaming come with the full zone in Phase 2.
 */

/** Cells entirely deeper than this are never seen through the water, so they're skipped. */
const CULL_DEPTH_M = 12;
/** How far the skirts hang below each tile's edge. */
const SKIRT_M = 24;

const DEEP = new THREE.Color(0x2f3f3b);
const SHOAL = new THREE.Color(0x9a8c64);
const BEACH = new THREE.Color(0xcdbd8e);
const GRASS = new THREE.Color(0x5f7c46);
const FOREST = new THREE.Color(0x3f5a35);
const ROCK = new THREE.Color(0x77736a);

const tmp = new THREE.Color();

/** Greybox palette: seabed, shoals, beach, then grass to forest, rock on steep ground. */
export function terrainColor(height: number, upness: number, out: THREE.Color): THREE.Color {
  if (height < -8) out.copy(DEEP);
  else if (height < -1) out.copy(DEEP).lerp(SHOAL, (height + 8) / 7);
  else if (height < 1.2) out.copy(SHOAL).lerp(BEACH, Math.min(1, (height + 1) / 1.2));
  else if (height < 3) out.copy(BEACH).lerp(GRASS, (height - 1.2) / 1.8);
  else out.copy(GRASS).lerp(FOREST, Math.min(1, (height - 3) / 20));
  if (height > 0.5) {
    // Faces steeper than ~40° turn to rock.
    const rock = THREE.MathUtils.smoothstep(0.85 - upness, 0, 0.15);
    out.lerp(tmp.copy(ROCK), rock);
  }
  return out;
}

export interface GridMeshOptions {
  /** Sample range, inclusive. (i1 − i0) and (j1 − j0) must be multiples of `stride`. */
  i0: number;
  j0: number;
  i1: number;
  j1: number;
  stride: number;
  skirts: boolean;
  /** Leave out cells whose center falls inside these bounds (where finer tiles draw). */
  exclude?: TerrainBounds;
}

/** A terrain patch with positions, normals and colors, in zone meters. */
export function buildGridGeometry(field: GridField, o: GridMeshOptions): THREE.BufferGeometry {
  const s = o.stride;
  const cols = (o.i1 - o.i0) / s + 1;
  const rows = (o.j1 - o.j0) / s + 1;
  const ring = o.skirts ? 2 * (cols + rows) - 4 : 0;
  const count = cols * rows + ring;
  const positions = new Float32Array(count * 3);
  const normals = new Float32Array(count * 3);
  const colors = new Float32Array(count * 3);
  const heights = new Float32Array(cols * rows);
  const span = 2 * s * field.step;
  const color = new THREE.Color();
  const normal = new THREE.Vector3();

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const i = o.i0 + c * s;
      const j = o.j0 + r * s;
      const h = field.at(i, j);
      const k = r * cols + c;
      heights[k] = h;
      positions[k * 3] = field.x0 + i * field.step;
      positions[k * 3 + 1] = h;
      positions[k * 3 + 2] = field.z0 + j * field.step;
      // Normals from the field over the stride, so they match across tile edges.
      normal
        .set(field.at(i - s, j) - field.at(i + s, j), span, field.at(i, j - s) - field.at(i, j + s))
        .normalize();
      normals.set([normal.x, normal.y, normal.z], k * 3);
      terrainColor(h, normal.y, color);
      colors.set([color.r, color.g, color.b], k * 3);
    }
  }

  const indices: number[] = [];
  const deep = (k: number): boolean => (heights[k] ?? 0) < -CULL_DEPTH_M;
  for (let r = 0; r < rows - 1; r++) {
    for (let c = 0; c < cols - 1; c++) {
      const a = r * cols + c;
      const b = a + 1;
      const d = a + cols;
      const e = d + 1;
      if (deep(a) && deep(b) && deep(d) && deep(e)) continue;
      if (o.exclude) {
        const x = (positions[a * 3] ?? 0) + (s * field.step) / 2;
        const z = (positions[a * 3 + 2] ?? 0) + (s * field.step) / 2;
        const ex = o.exclude;
        if (x > ex.minX && x < ex.maxX && z > ex.minZ && z < ex.maxZ) continue;
      }
      // Counter-clockwise seen from above (+y), so faces point up.
      indices.push(a, d, b, b, d, e);
    }
  }

  if (o.skirts) {
    // The edge loop, clockwise seen from above: north edge east, east edge south, …
    const loop: number[] = [];
    for (let c = 0; c < cols - 1; c++) loop.push(c);
    for (let r = 0; r < rows - 1; r++) loop.push(r * cols + cols - 1);
    for (let c = cols - 1; c > 0; c--) loop.push((rows - 1) * cols + c);
    for (let r = rows - 1; r > 0; r--) loop.push(r * cols);
    const base = cols * rows;
    loop.forEach((top, n) => {
      const k = base + n;
      positions[k * 3] = positions[top * 3] ?? 0;
      positions[k * 3 + 1] = (positions[top * 3 + 1] ?? 0) - SKIRT_M;
      positions[k * 3 + 2] = positions[top * 3 + 2] ?? 0;
      normals.set(normals.subarray(top * 3, top * 3 + 3), k * 3);
      colors.set(colors.subarray(top * 3, top * 3 + 3), k * 3);
    });
    for (let n = 0; n < loop.length; n++) {
      const a = loop[n] ?? 0;
      const b = loop[(n + 1) % loop.length] ?? 0;
      if (deep(a) && deep(b)) continue;
      const a2 = base + n;
      const b2 = base + ((n + 1) % loop.length);
      // Faces outward; the material is double-sided for skirts seen from inside a crack.
      indices.push(a, b, a2, b, b2, a2);
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geometry.setIndex(indices);
  geometry.computeBoundingSphere();
  return geometry;
}

export interface TerrainView {
  readonly group: THREE.Group;
  applyPreset(preset: QualityPreset): void;
}

/**
 * The slice's tiles plus the backdrop. `tileSamples` is the sailing tile size in samples
 * (256), so each mesh matches one baked tile and can be culled on its own.
 */
export function createTerrainView(
  terrain: ZoneTerrain,
  backdrop: GridField,
  tileSamples: number,
  preset: QualityPreset,
): TerrainView {
  const group = new THREE.Group();
  group.name = 'terrain';
  const material = new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide });

  const back = new THREE.Mesh(
    buildGridGeometry(backdrop, {
      i0: 0,
      j0: 0,
      i1: backdrop.width - 1,
      j1: backdrop.height - 1,
      stride: 1,
      skirts: false,
      exclude: terrain.bounds,
    }),
    material,
  );
  back.name = 'terrain-backdrop';
  // Sit a hair lower so the tiles' skirts win wherever the two overlap at the seam.
  back.position.y = -0.05;
  group.add(back);

  const tiles: THREE.Mesh[] = [];
  const field = terrain.height;
  const build = (stride: number): void => {
    for (const mesh of tiles) {
      group.remove(mesh);
      mesh.geometry.dispose();
    }
    tiles.length = 0;
    for (let j0 = 0; j0 < field.height - 1; j0 += tileSamples) {
      for (let i0 = 0; i0 < field.width - 1; i0 += tileSamples) {
        const mesh = new THREE.Mesh(
          buildGridGeometry(field, {
            i0,
            j0,
            i1: i0 + tileSamples,
            j1: j0 + tileSamples,
            stride,
            skirts: true,
          }),
          material,
        );
        mesh.name = `terrain-tile-${i0 / tileSamples}-${j0 / tileSamples}`;
        // A tile that is all deep water has no triangles.
        if (mesh.geometry.index?.count) {
          tiles.push(mesh);
          group.add(mesh);
        } else {
          mesh.geometry.dispose();
        }
      }
    }
  };
  let stride = preset.terrainStride;
  build(stride);

  return {
    group,
    applyPreset(p) {
      if (p.terrainStride === stride) return;
      stride = p.terrainStride;
      build(stride);
    },
  };
}
