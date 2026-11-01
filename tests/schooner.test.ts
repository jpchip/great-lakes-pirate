import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import {
  apparentWindFlow,
  boomTarget,
  sailHoists,
  sailShape,
  swingBoom,
} from '../src/render/ships/rig-state';
import { createSchooner } from '../src/render/ships/schooner';
import {
  schoonerLines,
  T1_SCHOONER_LINES,
  T2_SCHOONER_LINES,
} from '../src/render/ships/schooner-lines';
import { createSailingState, type SailingState } from '../src/sim/sailing/controller';
import { sailShipRecord, T1_SCHOONER_ID, T2_SCHOONER_ID } from '../src/sim/sailing/ships';

const DEG = Math.PI / 180;

function state(overrides: Partial<SailingState>): SailingState {
  return Object.assign(createSailingState(), { windKn: 14, windAngle: -90 * DEG }, overrides);
}

describe('schooner sail plan (plan 02 §3.2, §13)', () => {
  const reefed = T1_SCHOONER_LINES.reefedHoist;

  it('sets the right sails at each level', () => {
    expect(sailHoists(0, reefed)).toEqual({ gaff: 0, staysail: 0, jib: 0, topsail: 0 });
    expect(sailHoists(1, reefed)).toEqual({ gaff: reefed, staysail: 1, jib: 0, topsail: 0 });
    expect(sailHoists(2, reefed)).toEqual({ gaff: 1, staysail: 1, jib: 0, topsail: 0 });
    expect(sailHoists(3, reefed)).toEqual({ gaff: 1, staysail: 1, jib: 1, topsail: 1 });
  });

  it('hoists steadily between levels, so a sail change animates', () => {
    let last = sailHoists(0, reefed);
    for (let s = 0.1; s <= 3.001; s += 0.1) {
      const h = sailHoists(s, reefed);
      expect(h.gaff).toBeGreaterThanOrEqual(last.gaff);
      expect(h.jib).toBeGreaterThanOrEqual(last.jib);
      last = h;
    }
    const mid = sailHoists(2.5, reefed);
    expect(mid.jib).toBeGreaterThan(0.2);
    expect(mid.jib).toBeLessThan(0.8);
  });
});

describe('rig pose', () => {
  it('swings the booms to leeward, further out as the wind comes aft', () => {
    // Wind from port: booms to starboard (+).
    const reach = boomTarget(state({ windAngle: -90 * DEG, idealTrim: 0.36 }), 1);
    const run = boomTarget(state({ windAngle: -170 * DEG, idealTrim: 0.93 }), 1);
    expect(reach).toBeGreaterThan(0);
    expect(run).toBeGreaterThan(reach);
    // Wind from starboard: booms to port.
    expect(boomTarget(state({ windAngle: 50 * DEG, idealTrim: 0.07 }), 1)).toBeLessThan(0);
  });

  it('follows the manual sheet when manual trim is on', () => {
    const s = state({ manualTrim: true, trim: 1, idealTrim: 0.1 });
    expect(boomTarget(s, 1)).toBeCloseTo(78 * DEG);
  });

  it('centers stowed booms and lets luffing ones lie near the centerline', () => {
    expect(boomTarget(state({}), 0)).toBe(0);
    expect(Math.abs(boomTarget(state({ windAngle: 10 * DEG, inIrons: true }), 1))).toBeLessThan(
      5 * DEG,
    );
    expect(sailShape(state({ inIrons: true }))).toBe('luffing');
    expect(sailShape(state({}))).toBe('drawing');
  });

  it('slams a jibe over faster than it brings a tack across', () => {
    const tack = swingBoom(0.5, -0.5, 0.1, false);
    const jibe = swingBoom(0.5, -0.5, 0.1, true);
    expect(0.5 - jibe).toBeGreaterThan(0.5 - tack);
  });

  it('streams the pennant along the apparent wind', () => {
    // Head to wind and stopped: straight aft.
    const head = apparentWindFlow(state({ windAngle: 0, speed: 0 }));
    expect(head.z).toBeCloseTo(14);
    expect(head.x).toBeCloseTo(0);
    // Wind from starboard abeam: blows to port, and the ship's way bends it aft.
    const beam = apparentWindFlow(state({ windAngle: 90 * DEG, speed: 2 }));
    expect(beam.x).toBeLessThan(0);
    expect(beam.z).toBeGreaterThan(0);
    // Before the first tick: calm.
    expect(apparentWindFlow(state({ windAngle: Number.NaN }))).toEqual({ x: 0, z: 0 });
  });
});

describe('procedural T1 schooner (plan 14 §5)', () => {
  const bounds = (object: THREE.Object3D): THREE.Box3 => {
    let root = object;
    while (root.parent) root = root.parent;
    root.updateMatrixWorld(true);
    return new THREE.Box3().setFromObject(object);
  };

  it('matches the ship record and its buoyancy spans', () => {
    const record = sailShipRecord(T1_SCHOONER_ID);
    expect(T1_SCHOONER_LINES.length).toBe(record.lengthM);
    expect(T1_SCHOONER_LINES.length).toBeGreaterThanOrEqual(record.buoyancy.length);
    expect(T1_SCHOONER_LINES.beam).toBeGreaterThanOrEqual(record.buoyancy.beam);

    const model = createSchooner(T1_SCHOONER_LINES);
    const hull = model.group.getObjectByName('schooner-hull') as THREE.Mesh;
    const box = bounds(hull);
    const size = box.getSize(new THREE.Vector3());
    // Hull plus the bowsprit forward of the stem.
    expect(size.z).toBeGreaterThan(20);
    expect(size.z).toBeLessThan(30);
    expect(size.x).toBeCloseTo(T1_SCHOONER_LINES.beam, 0);
    expect(box.min.y).toBeLessThan(-T1_SCHOONER_LINES.draft * 0.9);
  });

  it('stays inside the hero-ship triangle budget', () => {
    const model = createSchooner(T1_SCHOONER_LINES);
    model.settle(state({ sailSetting: 3 }), 0);
    let triangles = 0;
    let meshes = 0;
    model.group.traverse((node) => {
      if (!(node instanceof THREE.Mesh)) return;
      meshes++;
      const g = node.geometry;
      triangles += (g.index ? g.index.count : g.getAttribute('position').count) / 3;
    });
    expect(triangles).toBeLessThan(12_000);
    expect(meshes).toBeLessThan(24);
  });

  it('shows only the sails set at each level', () => {
    const model = createSchooner(T1_SCHOONER_LINES);
    const visible = (): string[] =>
      Object.entries(model.sails)
        .filter(([, sail]) => sail.visible)
        .map(([name]) => name)
        .sort();
    model.settle(state({ sailSetting: 0 }), 0);
    expect(visible()).toEqual([]);
    model.settle(state({ sailSetting: 1 }), 0);
    expect(visible()).toEqual(['fore', 'main', 'staysail']);
    model.settle(state({ sailSetting: 2 }), 0);
    expect(visible()).toEqual(['fore', 'main', 'staysail']);
    model.settle(state({ sailSetting: 3 }), 0);
    expect(visible()).toEqual(['fore', 'foreTopsail', 'jib', 'main', 'mainTopsail', 'staysail']);
  });

  it('keeps a settled sail static and swaps to the slack shape in irons', () => {
    const model = createSchooner(T1_SCHOONER_LINES);
    const main = model.sails.main.mesh.geometry.getAttribute('position');
    const snapshot = (): number[] => Array.from(main.array as Float32Array);
    model.settle(state({ sailSetting: 2 }), 0);
    const drawing = snapshot();
    model.update(state({ sailSetting: 2 }), 5, 1 / 60);
    expect(snapshot()).toEqual(drawing);
    model.settle(state({ sailSetting: 2, windAngle: 10 * DEG, inIrons: true }), 0);
    const luffing = snapshot();
    expect(luffing).not.toEqual(drawing);
    expect(luffing.every(Number.isFinite)).toBe(true);
  });

  it('bellies the sails to leeward', () => {
    const model = createSchooner(T1_SCHOONER_LINES);
    // Wind from port: lee is starboard (+x) once the boom is out.
    model.settle(state({ sailSetting: 2, windAngle: -90 * DEG, idealTrim: 0.36 }), 0);
    const sail = model.sails.main.mesh;
    const box = bounds(sail);
    expect(box.getCenter(new THREE.Vector3()).x).toBeGreaterThan(1);
    model.settle(state({ sailSetting: 2, windAngle: 90 * DEG, idealTrim: 0.36 }), 0);
    expect(bounds(sail).getCenter(new THREE.Vector3()).x).toBeLessThan(-1);
  });
});

describe('procedural T2 schooner (plan 10 §2, Phase 4 piece G)', () => {
  const bounds = (object: THREE.Object3D): THREE.Box3 => {
    object.updateMatrixWorld(true);
    return new THREE.Box3().setFromObject(object);
  };
  const count = (model: ReturnType<typeof createSchooner>): [number, number] => {
    let triangles = 0;
    let meshes = 0;
    model.group.traverse((node) => {
      if (!(node instanceof THREE.Mesh)) return;
      meshes++;
      const g = node.geometry;
      triangles += (g.index ? g.index.count : g.getAttribute('position').count) / 3;
    });
    return [triangles, meshes];
  };

  it('matches its ship record and is looked up by it', () => {
    const record = sailShipRecord(T2_SCHOONER_ID);
    expect(record.tier).toBe(2);
    expect(T2_SCHOONER_LINES.id).toBe(T2_SCHOONER_ID);
    expect(T2_SCHOONER_LINES.length).toBe(record.lengthM);
    expect(T2_SCHOONER_LINES.length).toBeGreaterThanOrEqual(record.buoyancy.length);
    expect(T2_SCHOONER_LINES.beam).toBeGreaterThanOrEqual(record.buoyancy.beam);
    // Drawn draft between the record's empty and full drafts, as the T1's is.
    expect(T2_SCHOONER_LINES.draft).toBeGreaterThanOrEqual(record.draftEmptyM);
    expect(T2_SCHOONER_LINES.draft).toBeLessThanOrEqual(record.draftFullM);
    expect(schoonerLines(T2_SCHOONER_ID)).toBe(T2_SCHOONER_LINES);
    expect(schoonerLines(T1_SCHOONER_ID)).toBe(T1_SCHOONER_LINES);
    expect(schoonerLines(undefined)).toBe(T1_SCHOONER_LINES);
  });

  it('is half again the T1: longer, beamier, deeper and taller', () => {
    const t1 = createSchooner(T1_SCHOONER_LINES);
    const t2 = createSchooner(T2_SCHOONER_LINES);
    for (const m of [t1, t2]) m.settle(state({ sailSetting: 3 }), 0);
    const h1 = bounds(t1.group.getObjectByName('schooner-hull') as THREE.Object3D);
    const h2 = bounds(t2.group.getObjectByName('schooner-hull') as THREE.Object3D);
    const s1 = h1.getSize(new THREE.Vector3());
    const s2 = h2.getSize(new THREE.Vector3());
    expect(s2.z / s1.z).toBeGreaterThan(1.35);
    expect(s2.x).toBeCloseTo(T2_SCHOONER_LINES.beam, 0);
    expect(h2.min.y).toBeLessThan(-T2_SCHOONER_LINES.draft * 0.9);
    expect(bounds(t2.group).max.y / bounds(t1.group).max.y).toBeGreaterThan(1.35);
  });

  it('carries a yawl boat in davits clear of the main boom', () => {
    const half = T2_SCHOONER_LINES.length / 2;
    // The highest point of the hull mesh aft of the taffrail, and how far aft it reaches.
    const sternGear = (lines: typeof T2_SCHOONER_LINES): { aft: number; top: number } => {
      const model = createSchooner(lines);
      const hull = model.group.getObjectByName('schooner-hull') as THREE.Mesh;
      const p = hull.geometry.getAttribute('position');
      let aft = -Infinity;
      let top = -Infinity;
      for (let i = 0; i < p.count; i++) {
        aft = Math.max(aft, p.getZ(i));
        if (p.getZ(i) > lines.length / 2 + 0.2) top = Math.max(top, p.getY(i));
      }
      return { aft, top };
    };
    const t2 = sternGear(T2_SCHOONER_LINES);
    // The boat hangs aft of the taffrail; the T1 has nothing there.
    expect(t2.aft).toBeGreaterThan(half + (T2_SCHOONER_LINES.deck?.yawlBoat?.beam ?? 99));
    expect(sternGear(T1_SCHOONER_LINES).aft).toBeLessThan(T1_SCHOONER_LINES.length / 2 + 0.5);
    // The davit heads stay under the main boom's end, which swings out over them.
    const model = createSchooner(T2_SCHOONER_LINES);
    model.settle(state({ sailSetting: 0 }), 0);
    model.group.updateMatrixWorld(true);
    const boom = new THREE.Box3().setFromObject(
      model.group.getObjectByName('main-boom') as THREE.Object3D,
    );
    expect(boom.max.z).toBeGreaterThan(half);
    expect(t2.top).toBeLessThan(boom.max.y - 0.3);
  });

  it('stays inside the hero-ship triangle budget', () => {
    const model = createSchooner(T2_SCHOONER_LINES);
    model.settle(state({ sailSetting: 3 }), 0);
    const [triangles, meshes] = count(model);
    expect(triangles).toBeLessThan(12_000);
    expect(meshes).toBeLessThan(24);
  });

  it('sets the same sails at each level as the T1', () => {
    const model = createSchooner(T2_SCHOONER_LINES);
    const visible = (): string[] =>
      Object.entries(model.sails)
        .filter(([, sail]) => sail.visible)
        .map(([name]) => name)
        .sort();
    model.settle(state({ sailSetting: 1 }), 0);
    expect(visible()).toEqual(['fore', 'main', 'staysail']);
    model.settle(state({ sailSetting: 3 }), 0);
    expect(visible()).toEqual(['fore', 'foreTopsail', 'jib', 'main', 'mainTopsail', 'staysail']);
  });
});
