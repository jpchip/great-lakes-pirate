import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { compoundLayout } from '../src/debug/hideout/sample';
import { createHideoutView } from '../src/render/hideout/hideout-view';
import {
  buildExtension,
  buildPiece,
  buildProxy,
  CELL_M,
  PIECES,
  pieceDef,
} from '../src/render/hideout/pieces';
import { StyleLighting } from '../src/render/style/stylized-material';

/** The hideout kit (plan 09 §5, §10; Phase 8 piece B). */
describe('hideout kit pieces', () => {
  it('has about sixty pieces with unique ids', () => {
    expect(PIECES.length).toBeGreaterThanOrEqual(60);
    expect(new Set(PIECES.map((p) => p.id)).size).toBe(PIECES.length);
  });

  it('builds every piece in every material as one glow-tagged geometry', () => {
    for (const def of PIECES) {
      for (const m of def.materials) {
        const g = buildPiece(def, m);
        const n = g.getAttribute('position').count;
        expect(n, `${def.id}:${m}`).toBeGreaterThan(0);
        for (const a of ['normal', 'color', 'glow']) expect(g.getAttribute(a)?.count).toBe(n);
        // Low-poly: 1,500 pieces stay within a few hundred thousand triangles.
        expect(n / 3, `${def.id}:${m} triangles`).toBeLessThan(1500);
        // Inside its footprint, give or take eaves, overhanging logs and a lantern's arm.
        const bb = g.boundingBox as THREE.Box3;
        const [fx, fz] = def.footprint;
        expect(bb.max.x - bb.min.x, def.id).toBeLessThan(Math.max(fx, 1) * CELL_M + 1);
        expect(bb.max.z - bb.min.z, def.id).toBeLessThan(Math.max(fz, 1) * CELL_M + 1.5);
        g.dispose();
        buildProxy(def, m).dispose();
        buildExtension(def, m)?.dispose();
      }
    }
  });

  it('marks lamp glass, and every lamp piece has some', () => {
    for (const def of PIECES.filter((p) => p.lamp)) {
      const g = buildPiece(def, def.materials[0] as never);
      const glow = g.getAttribute('glow');
      let lit = 0;
      for (let k = 0; k < glow.count; k++) lit += glow.getX(k);
      expect(lit, def.id).toBeGreaterThan(0);
    }
  });

  it('draws every id in data/structures.json once piece A has landed it', () => {
    const path = join(import.meta.dirname, '../data/structures.json');
    if (!existsSync(path)) return;
    const ids = (JSON.parse(readFileSync(path, 'utf8')) as { id: string }[]).map((p) => p.id);
    for (const id of ids) expect(pieceDef(id), id).toBeDefined();
  });
});

describe('hideout view', () => {
  const lighting = new StyleLighting();

  it('draws a 1,500-piece compound in ≤ 80 instanced meshes and a one-mesh proxy', () => {
    const view = createHideoutView(lighting);
    view.setAll(compoundLayout(1500));
    expect(view.size).toBe(1500);
    expect(view.batches).toBeLessThanOrEqual(80);
    view.rebuildProxy();
    expect(view.proxy).toBeDefined();
    expect(view.proxyTriangles).toBeLessThan(view.triangles / 5);
    view.dispose();
  });

  it('places and removes pieces in their slots without disturbing the others', () => {
    const view = createHideoutView(lighting);
    const mesh = (): THREE.InstancedMesh =>
      view.near.children.find((c) => c.name === 'build.wall:plank') as THREE.InstancedMesh;
    for (let k = 0; k < 40; k++)
      view.set(`w${k}`, { id: 'build.wall', material: 'plank', x: k * 2, y: 0, z: 0, rot: 0 });
    expect(mesh().count).toBe(40);
    // Removing from the middle moves the last into the hole.
    view.remove('w3');
    view.remove('w10');
    expect(mesh().count).toBe(38);
    const xs = new Set<number>();
    const m = new THREE.Matrix4();
    const p = new THREE.Vector3();
    for (let k = 0; k < mesh().count; k++) {
      mesh().getMatrixAt(k, m);
      xs.add(Math.round(p.setFromMatrixPosition(m).x));
    }
    expect(xs.has(6)).toBe(false);
    expect(xs.has(20)).toBe(false);
    expect(xs.has(78)).toBe(true);
    // Moving a piece rewrites it; re-materialing moves it to another batch.
    view.set('w0', { id: 'build.wall', material: 'log', x: 0, y: 0, z: 0, rot: 1 });
    expect(mesh().count).toBe(37);
    expect(view.batches).toBe(2);
    // Growing past the starting capacity keeps every instance.
    for (let k = 0; k < 100; k++) view.set(`c${k}`, { id: 'build.crate_stack', x: k, y: 0, z: 9 });
    expect(view.size).toBe(138);
    view.clear();
    expect(view.size).toBe(0);
    expect(view.batches).toBe(0);
    view.dispose();
  });

  it('reaches foundations and piers down by extendM, and turns by rot', () => {
    const view = createHideoutView(lighting);
    view.set('f', { id: 'build.foundation', material: 'brownstone', x: 0, y: 2, z: 0, extendM: 3 });
    view.set('p', { id: 'build.pier', x: 10, y: 1, z: 0, extendM: 2 });
    view.set('w', { id: 'build.wall', x: 0, y: 0, z: 10 });
    const ext = view.near.children.find(
      (c) => c.name === 'build.foundation:brownstone:ext',
    ) as THREE.InstancedMesh;
    const m = new THREE.Matrix4();
    ext.getMatrixAt(0, m);
    const pos = new THREE.Vector3();
    const q = new THREE.Quaternion();
    const s = new THREE.Vector3();
    m.decompose(pos, q, s);
    expect(pos.y).toBeCloseTo(2 - 0.6);
    expect(s.y).toBeCloseTo(3);
    expect(view.batches).toBe(5);
    view.set('w', { id: 'build.wall', x: 0, y: 0, z: 10, rot: 1 });
    const wall = view.near.children.find(
      (c) => c.name === 'build.wall:plank',
    ) as THREE.InstancedMesh;
    wall.getMatrixAt(0, m);
    // rot 1 turns the wall's outside (-z) to face +x.
    const out = new THREE.Vector3(0, 0, -1).transformDirection(m);
    expect(out.x).toBeCloseTo(1);
    view.dispose();
  });

  it('collects lamps for the pools and swaps to the proxy far off', () => {
    const view = createHideoutView(lighting, { proxyDebounceMs: 0 });
    view.set('l', { id: 'build.lantern', x: 4, y: 0, z: 0 });
    view.set('s', { id: 'build.shelving', x: 0, y: 0, z: 0 });
    expect(view.lamps()).toHaveLength(1);
    view.update(new THREE.Vector3(0, 10, -20), 1, undefined, 1e9);
    expect(view.far).toBe(false);
    view.update(new THREE.Vector3(0, 10, -800), 1, undefined, 1e9);
    expect(view.far).toBe(true);
    expect(view.near.visible).toBe(false);
    expect(view.proxy?.visible).toBe(true);
    view.dispose();
  });

  it('draws an unknown id as a placeholder rather than failing', () => {
    const view = createHideoutView(lighting);
    view.set('x', { id: 'build.not_yet', x: 0, y: 0, z: 0 });
    expect(view.size).toBe(1);
    view.dispose();
  });
});

describe('gables up a wide roof', () => {
  it('stand on wall courses down to the eave, stacked one per 1.2 m of rise', () => {
    const view = createHideoutView(new StyleLighting());
    view.set('g', {
      id: 'build.wall_gable',
      material: 'log',
      x: 0,
      y: 3,
      z: 0,
      rot: 1,
      riseM: 2.4,
    });
    const ext = view.near.children.find(
      (c) => c.name === 'build.wall_gable:log:ext',
    ) as THREE.InstancedMesh;
    expect(ext.count).toBe(2);
    view.set('h', { id: 'build.wall_gable', material: 'log', x: 2, y: 3, z: 0, rot: 1 });
    expect(ext.count).toBe(2);
    view.remove('g');
    expect(ext.count).toBe(0);
    view.dispose();
  });
});
