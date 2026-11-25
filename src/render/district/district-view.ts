import * as THREE from 'three';
import type { DistrictModel, PlacedPiece } from '../../gameplay/district/district';
import { kitPiece } from '../../sim/district/kit';
import { buildingSigns } from './signs';
import { PALETTE } from '../style/palette';
import { merged, place } from '../style/parts';
import {
  createStylizedMaterial,
  type LampPoolUniforms,
  type StyleId,
  type StyleLighting,
  type StylizedMaterial,
} from '../style/stylized-material';
import {
  cellGeometry,
  doorLeafGeometry,
  dousedGlassGeometry,
  edgeGeometry,
  PAINTS,
  pileGeometry,
  propGeometry,
  roofGeometry,
  type EdgePaint,
  type KitSink,
} from './kit-meshes';
import { buildingStyle } from './styles';
import { decorGeometry } from './decor';
import { createDistrictLife } from './life';
import { CELL_M } from '../../sim/district/kit';

/**
 * A docks district drawn (plan 08 §2, §13–14; Phase 7 piece C). The static kit is merged
 * per 32 m block into one body mesh and one lit mesh (lamp glass and lit windows), so the
 * whole of Bayfield is a few dozen draw calls and the far blocks cull. Roofs are a mesh per
 * building so the one you're inside can fade (plan 08 §2.1). Lamps don't use three.js
 * lights: the nearest eight are pools of light in the stylized shader (plan 08 §14's "≤ 4
 * real lights, the rest emissive plus fake pools"), which is cheaper and works on every
 * surface the style draws, the ground included.
 */

export const POOL_SLOTS = 8;
const BLOCK_M = 32;
/** Pools reach this much further than the lamp's gameplay radius, for the soft edge. */
const POOL_REACH = 1.25;
/** Lamp brightness at full night. */
const POOL_GAIN = 1.05;

export interface DistrictView {
  readonly group: THREE.Group;
  readonly triangles: number;
  /** Draw calls if everything were in view (blocks, roofs, ground, water). */
  readonly meshes: number;
  /**
   * Per frame: `focus` is the player (pools near them, the roof they're under fades);
   * `night` is 0 by day to 1 at night (lamps lit, windows glowing); `doused` are lamps put
   * out (indexes into `model.lamps`): no pool, and dark glass over theirs. `shut` are the
   * doors locked now (ids in `model.doors`): their leaves are drawn shut, the rest open.
   */
  update(
    focus: THREE.Vector3,
    night: number,
    doused?: readonly number[],
    shut?: readonly string[],
  ): void;
  /** The building whose roof is faded, if any. */
  readonly inside: string | undefined;
  dispose(): void;
}

export function createLampPools(): LampPoolUniforms {
  return {
    uPoolPosition: {
      value: Array.from({ length: POOL_SLOTS }, () => new THREE.Vector4(0, -1e4, 0, 1)),
    },
    uPoolColor: { value: Array.from({ length: POOL_SLOTS }, () => new THREE.Color(0, 0, 0)) },
  };
}

export function createDistrictView(
  model: DistrictModel,
  lighting: StyleLighting,
  style: StyleId = 'toon',
  /**
   * The lamp pool uniforms, shared with whoever else should light by them (the on-foot
   * figures, `foot-view.ts`). Defaults to a fresh set so callers that only draw the
   * district (the dev page) are unchanged.
   */
  pools: LampPoolUniforms = createLampPools(),
): DistrictView {
  const group = new THREE.Group();
  group.name = `district:${model.layout.id}`;
  const body = createStylizedMaterial(style, lighting, { vertexColors: true, pools });
  const lit = createStylizedMaterial(style, lighting, { vertexColors: true });
  const groundMat = createStylizedMaterial(style, lighting, { vertexColors: true, pools });
  const waterMat = createStylizedMaterial(style, lighting, { color: 0x2a4655, pools });
  const geometries: THREE.BufferGeometry[] = [];
  let triangles = 0;
  let meshes = 0;
  const addMesh = (g: THREE.BufferGeometry, m: THREE.Material, name: string): THREE.Mesh => {
    const mesh = new THREE.Mesh(g, m);
    mesh.name = name;
    mesh.matrixAutoUpdate = false;
    group.add(mesh);
    geometries.push(g);
    triangles += g.getAttribute('position').count / 3;
    meshes++;
    return mesh;
  };

  // --- Ground and water ----------------------------------------------------------------
  addMesh(groundGeometry(model), groundMat, 'ground');
  const g = model.ground;
  const water = new THREE.PlaneGeometry(g.width + 800, g.depth + 800);
  water
    .rotateX(-Math.PI / 2)
    .translate(g.originX + g.width / 2, model.waterLevel, g.originZ + g.depth / 2);
  addMesh(water, waterMat, 'water');

  // --- Static kit, merged per block ----------------------------------------------------
  const blocks = new Map<string, KitSink>();
  const sinkAt = (x: number, z: number): KitSink => {
    const key = `${Math.floor((x - model.minX) / BLOCK_M)}:${Math.floor((z - model.minZ) / BLOCK_M)}`;
    let s = blocks.get(key);
    if (!s) blocks.set(key, (s = { body: [], lit: [] }));
    return s;
  };
  const groundAt = (x: number, z: number): number => g.heightAt(x, z);
  for (const c of model.cells) cellGeometry(c, groundAt, sinkAt(c.x, c.z));
  for (const pile of model.piles) pileGeometry(pile, sinkAt(pile.x, pile.z));
  const styles = new Map(model.buildings.map((b) => [b.def.id, buildingStyle(b)] as const));
  const near = (a: number, b: number): boolean => Math.abs(a - b) < 0.05;
  const paintOf = (p: PlacedPiece): EdgePaint => {
    const b = p.building ? model.buildings.find((k) => k.def.id === p.building) : undefined;
    const wallPiece = b ? kitPiece(b.def.wall) : undefined;
    const style = b ? styles.get(b.def.id) : undefined;
    const paint: EdgePaint = {
      wall: style ? style.wall : b ? (PAINTS[b.def.paint % PAINTS.length] as number) : 0x7a6450,
      trim: style ? style.trim : 0xe8e2d2,
      brick:
        p.piece.id.startsWith('kit.wall_brick') ||
        (wallPiece?.id.startsWith('kit.wall_brick') ?? false),
      seed: b ? b.def.paint * 17 + b.minX : 3,
      style,
    };
    if (!b) return paint;
    // Which face is outside, in the piece's frame (front toward −z; an edge along z is
    // turned a quarter, so its −z looks east), and whether the wall ends at a corner.
    const half = CELL_M / 2;
    if (p.heading === 0) {
      if (near(p.z, b.minZ)) paint.out = -1;
      else if (near(p.z, b.maxZ)) paint.out = 1;
      paint.corners = [near(p.x - half, b.minX), near(p.x + half, b.maxX)];
    } else {
      if (near(p.x, b.maxX)) paint.out = -1;
      else if (near(p.x, b.minX)) paint.out = 1;
      paint.corners = [near(p.z - half, b.minZ), near(p.z + half, b.maxZ)];
    }
    if (!paint.out) delete paint.corners;
    return paint;
  };
  for (const e of model.edges) edgeGeometry(e, paintOf(e), sinkAt(e.x, e.z), true);
  for (const p of model.props) propGeometry(p, sinkAt(p.x, p.z));
  // The lived-in clutter (wash lines, rain barrels, shop goods, telegraph wires).
  for (const d of decorGeometry(model)) {
    d.computeBoundingBox();
    const c = d.boundingBox?.getCenter(new THREE.Vector3()) ?? new THREE.Vector3();
    sinkAt(c.x, c.z).body.push(d);
  }
  for (const [key, sink] of blocks) {
    if (sink.body.length > 0) addMesh(merged(sink.body), body, `block:${key}`);
    if (sink.lit.length > 0) addMesh(merged(sink.lit), lit, `lit:${key}`);
  }

  // --- Roofs, one mesh per building -----------------------------------------------------
  const roofs = new Map<string, THREE.Mesh>();
  for (const b of model.buildings) {
    const sink: KitSink = { body: [], lit: [] };
    roofGeometry(b, sink);
    if (sink.body.length === 0) continue;
    roofs.set(b.def.id, addMesh(merged(sink.body), body, `roof:${b.def.id}`));
  }

  // --- Signs over the doors (0.7.2): each building says what it is ---------------------
  const sign = buildingSigns(model);
  for (const m of sign.meshes) {
    group.add(m);
    meshes++;
    triangles += m.geometry.getAttribute('position').count / 3;
  }
  if (sign.brackets.length > 0) addMesh(merged(sign.brackets), body, 'sign-irons');

  // --- What moves: chimney smoke, gulls, flags (0.9) ---------------------------------------
  const life = createDistrictLife(model);
  for (const o of life.objects) {
    group.add(o);
    meshes++;
  }
  const born = performance.now();

  for (const child of group.children) child.updateMatrix();

  // --- Per frame ------------------------------------------------------------------------
  const glow = new THREE.Color(PALETTE.windowAmber);
  const lampColors = model.lamps.map((l) =>
    new THREE.Color(l.color).multiplyScalar(l.intensity * POOL_GAIN),
  );
  const order = model.lamps.map((_, k) => k);
  const dist = new Float64Array(model.lamps.length);
  let inside: string | undefined;
  const lampAt = new THREE.Vector3();
  // The put-out lamps' dark glass: one small mesh, rebuilt only when the set changes.
  const lampProps = model.lamps.map((l) =>
    model.props.find((p) => p.piece.id === l.piece && p.x === l.x && p.z === l.z),
  );
  const out = new Set<number>();
  let outKey = '';
  let shades: THREE.Mesh | undefined;
  const syncShades = (doused: readonly number[]): void => {
    const key = doused.join(',');
    if (key === outKey) return;
    outKey = key;
    out.clear();
    for (const k of doused) out.add(k);
    if (shades) {
      group.remove(shades);
      shades.geometry.dispose();
      shades = undefined;
    }
    const parts: THREE.BufferGeometry[] = [];
    for (const k of doused) {
      const p = lampProps[k];
      const g = p && dousedGlassGeometry(p.piece.id, p.piece.heightM);
      if (p && g) parts.push(place(g, p.x, p.y, p.z, p.heading));
    }
    if (parts.length === 0) return;
    shades = new THREE.Mesh(merged(parts), body);
    shades.name = 'doused-lamps';
    group.add(shades);
  };
  // The door leaves that open and shut (a target's doors lock by the hour): one small
  // mesh, rebuilt only when the set of shut doors changes.
  const leafEdges = model.edges.filter((e) => e.door !== undefined && !e.shut);
  let leafKey: string | undefined;
  let leaves: THREE.Mesh | undefined;
  const syncLeaves = (shut: readonly string[]): void => {
    const closed = new Set(shut);
    const key = leafEdges
      .filter((e) => e.door !== undefined && closed.has(e.door))
      .map((e) => e.door)
      .join(',');
    if (key === leafKey) return;
    leafKey = key;
    if (leaves) {
      group.remove(leaves);
      leaves.geometry.dispose();
      leaves = undefined;
    }
    const parts: THREE.BufferGeometry[] = [];
    for (const e of leafEdges) {
      const color = e.building ? styles.get(e.building)?.door : undefined;
      const g = doorLeafGeometry(e, e.door !== undefined && closed.has(e.door), color);
      if (g) parts.push(g);
    }
    if (parts.length === 0) return;
    leaves = new THREE.Mesh(merged(parts), body);
    leaves.name = 'door-leaves';
    leaves.matrixAutoUpdate = false;
    leaves.updateMatrix();
    group.add(leaves);
  };
  syncLeaves([]);
  const firstLeaves = group.getObjectByName('door-leaves') as THREE.Mesh | undefined;
  if (firstLeaves) {
    meshes++;
    triangles += firstLeaves.geometry.getAttribute('position').count / 3;
  }

  return {
    group,
    get triangles() {
      return triangles;
    },
    get meshes() {
      return meshes;
    },
    get inside() {
      return inside;
    },
    update(focus, night, doused = [], shut = []) {
      syncShades(night > 0 ? doused : []);
      syncLeaves(shut);
      // The nearest lit lamps become the pools.
      for (let k = 0; k < model.lamps.length; k++) {
        const l = model.lamps[k];
        if (!l) continue;
        dist[k] = out.has(k) ? 1e18 : (l.x - focus.x) ** 2 + (l.z - focus.z) ** 2;
      }
      order.sort((a, b) => (dist[a] ?? 0) - (dist[b] ?? 0));
      for (let s = 0; s < POOL_SLOTS; s++) {
        const k = order[s];
        const pos = pools.uPoolPosition.value[s];
        const color = pools.uPoolColor.value[s];
        if (!pos || !color) continue;
        const l = k === undefined ? undefined : model.lamps[k];
        if (!l || k === undefined || night <= 0 || out.has(k)) {
          color.setRGB(0, 0, 0);
          continue;
        }
        // The pools are lit in world space: placed on a zone, the lamps go with the group.
        lampAt.set(l.x, l.y, l.z).applyMatrix4(group.matrix);
        pos.set(lampAt.x, lampAt.y, lampAt.z, l.radiusM * POOL_REACH);
        color.copy(lampColors[k] ?? color).multiplyScalar(night);
      }
      sign.light(night, out);
      life.update((performance.now() - born) / 1000, night);
      // Lamp glass and lit windows: dull glass by day, glowing after dusk.
      const litU = (lit as StylizedMaterial).uniforms;
      litU.uEmissive.value.copy(glow).multiplyScalar(0.9 * night);
      litU.uColor.value.setScalar(0.32 + 0.68 * night);

      const b = model.buildingAt(focus.x, focus.y, focus.z);
      const next = b?.def.id;
      if (next !== inside) {
        const was = inside ? roofs.get(inside) : undefined;
        if (was) was.visible = true;
        const now = next ? roofs.get(next) : undefined;
        if (now) now.visible = false;
        inside = next;
      }
    },
    dispose() {
      shades?.geometry.dispose();
      leaves?.geometry.dispose();
      for (const geo of geometries) geo.dispose();
      body.dispose();
      lit.dispose();
      sign.dispose();
      life.dispose();
      groundMat.dispose();
      waterMat.dispose();
    },
  };
}

/** The baked ground, colored: worn dirt in the district, grass past it, sand at the water. */
function groundGeometry(model: DistrictModel): THREE.BufferGeometry {
  const g = model.ground;
  const geo = new THREE.PlaneGeometry(g.width, g.depth, g.samplesX - 1, g.samplesZ - 1);
  geo.rotateX(-Math.PI / 2);
  geo.translate(g.originX + g.width / 2, 0, g.originZ + g.depth / 2);
  const pos = geo.getAttribute('position') as THREE.BufferAttribute;
  const colors = new Float32Array(pos.count * 3);
  const dirt = new THREE.Color(0x6e6150);
  const grass = new THREE.Color(PALETTE.meadow);
  const sand = new THREE.Color(PALETTE.wetSand);
  const rock = new THREE.Color(PALETTE.slopeRock);
  const seabed = new THREE.Color(PALETTE.seabed);
  const gravel = new THREE.Color(0x857c6c);
  const c = new THREE.Color();
  for (let k = 0; k < pos.count; k++) {
    const x = pos.getX(k);
    const z = pos.getZ(k);
    const h = g.heightAt(x, z);
    pos.setY(k, h);
    const inside = x > model.minX + 2 && x < model.maxX - 2 && z > model.minZ && z < model.maxZ - 8;
    if (h < model.waterLevel - 0.3) c.copy(seabed);
    else if (h < 1.1) c.copy(sand);
    else if (g.slopeAt(x, z, 1) > 0.5) c.copy(rock);
    else if (inside) {
      c.copy(dirt);
      if (model.surfaceAt(x, z, h) === 'gravel') c.copy(gravel);
      // A little mottling so the street isn't one flat color.
      const n = Math.sin(x * 0.37 + z * 0.11) * Math.sin(z * 0.29 - x * 0.07);
      c.lerp(grass, Math.max(0, n) * 0.25);
    } else c.copy(grass);
    c.toArray(colors, k * 3);
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geo.deleteAttribute('uv');
  geo.computeVertexNormals();
  return geo;
}
