import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { DEFAULT_COMPRESSION, sceneSpeed } from '../src/core/coords';
import { R_SAILING } from '../src/core/time';
import {
  createNpcShipEntity,
  NPC_RECORDS,
  npcParade,
  serviceSpeedKn,
} from '../src/gameplay/npc-ships';
import { createFunnelSmoke, PUFF_LIFE_S, PUFFS_PER_SECOND } from '../src/render/ships/funnel-smoke';
import { NPC_LINES, npcLines } from '../src/render/ships/npc-lines';
import { createNpcShip, styleNpcShip } from '../src/render/ships/npc-ship';
import { lampVisible } from '../src/render/ships/running-lights';
import { OutlineSettings } from '../src/render/style/outline';
import { StyleLighting, type StylizedMaterial } from '../src/render/style/stylized-material';
import { measureWaterline } from '../src/render/water/wake';

const DEG = Math.PI / 180;

function styled(id: string) {
  const record = NPC_RECORDS.find((r) => r.id === id);
  if (!record) throw new Error(id);
  const model = createNpcShip(npcLines(record.modelId), record.displayScale);
  styleNpcShip(model, new StyleLighting(), new OutlineSettings());
  return { record, model };
}

/** Objects the renderer issues a draw call for. */
function drawCalls(root: THREE.Object3D): number {
  let n = 0;
  root.traverse((o) => {
    if ((o as THREE.Mesh).isMesh || (o as THREE.Line).isLine || (o as THREE.Points).isPoints) n++;
  });
  return n;
}

describe('NPC ship classes (Phase 3 piece H)', () => {
  it('has the five Phase 3 classes, each with lines that match its record', () => {
    expect(NPC_RECORDS.map((r) => r.id)).toEqual([
      'ship.ore_freighter',
      'ship.schooner_barge',
      'ship.package_steamer',
      'ship.fish_tug',
      'ship.cutter_morrill',
    ]);
    expect(Object.keys(NPC_LINES)).toHaveLength(NPC_RECORDS.length);
    for (const r of NPC_RECORDS) {
      const l = npcLines(r.modelId);
      expect(l.length, r.id).toBe(r.lengthM);
      expect(l.draft, r.id).toBeGreaterThanOrEqual(r.draftEmptyM - 0.2);
      expect(l.draft, r.id).toBeLessThanOrEqual(r.draftFullM);
      // Buoyancy samples sit inside the drawn hull.
      expect(r.buoyancy.length, r.id).toBeLessThan(r.lengthM * r.displayScale);
      expect(r.buoyancy.beam, r.id).toBeLessThan(l.beam * r.displayScale);
      expect(serviceSpeedKn(r), r.id).toBeGreaterThan(0);
    }
  });

  it('shrinks the big freighter to 0.85 (plan 03 §3.5) and nothing else', () => {
    for (const r of NPC_RECORDS) {
      expect(r.displayScale, r.id).toBe(r.id === 'ship.ore_freighter' ? 0.85 : 1);
    }
  });

  it('reads smoke and size further than a tug (S8 conspicuity)', () => {
    const c = (id: string): number => NPC_RECORDS.find((r) => r.id === id)?.conspicuity ?? 0;
    expect(c('ship.ore_freighter')).toBeGreaterThan(1);
    expect(c('ship.fish_tug')).toBeLessThan(1);
  });
});

describe('NPC ship models', () => {
  it.each(NPC_RECORDS.map((r) => r.id))('%s stays inside the NPC budgets', (id) => {
    const { model } = styled(id);
    // Plan 14 §8: an NPC ship is at most 8k triangles at LOD0.
    expect(model.triangles).toBeLessThanOrEqual(8000);
    // Body and shell, windows, rigging, lights; sails and their edges on the barge.
    expect(drawCalls(model.group)).toBeLessThanOrEqual(7);
  });

  it('draws five ships, wakes and smoke in at most 40 draw calls (piece H budget)', () => {
    const total = NPC_RECORDS.reduce((n, r) => n + drawCalls(styled(r.id).model.group), 0);
    // Plus a wake each and one shared smoke system.
    expect(total + NPC_RECORDS.length + 1).toBeLessThanOrEqual(40);
  });

  it('floats at its drawn size, waterline and all', () => {
    for (const r of NPC_RECORDS) {
      const { model } = styled(r.id);
      const w = measureWaterline(model.group);
      const drawn = r.lengthM * r.displayScale;
      expect(w.sternZ - w.bowZ, r.id).toBeGreaterThan(drawn * 0.8);
      expect(w.sternZ - w.bowZ, r.id).toBeLessThan(drawn * 1.02);
      expect(w.beam, r.id).toBeGreaterThan(npcLines(r.modelId).beam * r.displayScale * 0.85);
    }
  });

  it('gives every steamer a stack to smoke from, and the barge none', () => {
    for (const r of NPC_RECORDS) {
      const { model } = styled(r.id);
      if (r.propulsion === 'steam') expect(model.stacks.length, r.id).toBeGreaterThan(0);
      else expect(model.stacks, r.id).toHaveLength(0);
      for (const s of model.stacks) expect(s.top.y, r.id).toBeGreaterThan(4);
    }
  });

  it('lights the lamps and windows from dusk, not by day', () => {
    const { model } = styled('ship.package_steamer');
    const windows = model.group.getObjectByName('ship.package_steamer-windows') as THREE.Mesh;
    const emissive = (windows.material as StylizedMaterial).uniforms.uEmissive.value;
    model.update(40, 0);
    expect(model.lights.points.visible).toBe(false);
    expect(emissive.r).toBe(0);
    model.update(-12, 0);
    expect(model.lights.points.visible).toBe(true);
    expect(emissive.r).toBeGreaterThan(0.5);
  });

  it('sets the barge’s sails to leeward', () => {
    const { model } = styled('ship.schooner_barge');
    expect(model.sails).toBeDefined();
    model.update(40, 0, false);
    expect(model.sails?.scale.x).toBe(1);
    model.update(40, 0, true);
    expect(model.sails?.scale.x).toBe(-1);
  });
});

describe('running lights (1900 rules of the road)', () => {
  it('shows red and green ahead, one color abeam, the stern light astern', () => {
    expect(lampVisible('port', 0)).toBe(true);
    expect(lampVisible('starboard', 0)).toBe(true);
    expect(lampVisible('masthead', 0)).toBe(true);
    expect(lampVisible('stern', 0)).toBe(false);

    expect(lampVisible('starboard', 90 * DEG)).toBe(true);
    expect(lampVisible('port', 90 * DEG)).toBe(false);
    expect(lampVisible('port', -90 * DEG)).toBe(true);

    // Two points abaft the beam is the edge of the sidelights and the masthead light.
    expect(lampVisible('starboard', 110 * DEG)).toBe(true);
    expect(lampVisible('starboard', 116 * DEG)).toBe(false);
    expect(lampVisible('masthead', 116 * DEG)).toBe(false);
    expect(lampVisible('stern', 116 * DEG)).toBe(true);

    expect(lampVisible('stern', 180 * DEG)).toBe(true);
    expect(lampVisible('towing', 180 * DEG)).toBe(true);
  });

  it('puts a masthead light on every steamer and sidelights on every ship', () => {
    for (const r of NPC_RECORDS) {
      const kinds = npcLines(r.modelId).lights.map((l) => l.kind);
      expect(kinds, r.id).toContain('port');
      expect(kinds, r.id).toContain('starboard');
      expect(kinds, r.id).toContain('stern');
      if (r.propulsion === 'steam') expect(kinds, r.id).toContain('masthead');
      else expect(kinds, r.id).not.toContain('masthead');
    }
  });
});

describe('funnel smoke', () => {
  it('trails downwind at a steady rate and frees its puffs', () => {
    const smoke = createFunnelSmoke(new StyleLighting(), 128);
    const source = { owed: 0 };
    const stack = new THREE.Vector3(0, 10, 0);
    const dt = 1 / 30;
    for (let t = 0; t < 3; t += dt) {
      smoke.emit(
        source,
        stack,
        { x: 0, z: 0 },
        { x: 8, z: 0 },
        1,
        new THREE.Color(0.2, 0.2, 0.2),
        dt,
      );
      smoke.update(dt);
    }
    expect(smoke.alive).toBeGreaterThan(PUFFS_PER_SECOND * 3 - 2);
    expect(smoke.alive).toBeLessThanOrEqual(PUFFS_PER_SECOND * 3 + 1);
    const pos = smoke.points.geometry.getAttribute('position');
    const size = smoke.points.geometry.getAttribute('aSize');
    let sumX = 0;
    let n = 0;
    for (let i = 0; i < pos.count; i++) {
      if (size.getX(i) <= 0) continue;
      sumX += pos.getX(i);
      expect(pos.getY(i)).toBeGreaterThan(9.5);
      n++;
    }
    expect(sumX / n).toBeGreaterThan(5);
    for (let t = 0; t < PUFF_LIFE_S + 0.1; t += dt) smoke.update(dt);
    expect(smoke.alive).toBe(0);
  });

  it('never holds more puffs than its capacity', () => {
    const smoke = createFunnelSmoke(new StyleLighting(), 16);
    const source = { owed: 0 };
    for (let i = 0; i < 100; i++) {
      smoke.emit(
        source,
        new THREE.Vector3(),
        { x: 0, z: 0 },
        { x: 0, z: 0 },
        1,
        new THREE.Color(),
        0.2,
      );
      smoke.update(0.2);
    }
    expect(smoke.alive).toBeLessThanOrEqual(16);
  });
});

describe('NPC entities', () => {
  it('steams on its heading at its service speed', () => {
    const record = NPC_RECORDS[0];
    if (!record) throw new Error('No NPC classes');
    const e = createNpcShipEntity(record, 0, 0, 90 * DEG);
    const v = sceneSpeed(serviceSpeedKn(record), R_SAILING, DEFAULT_COMPRESSION);
    expect(e.velocity?.x).toBeCloseTo(v);
    expect(e.velocity?.z).toBeCloseTo(0);
    expect(e.model).toBe('npc');
    expect(e.npc?.classId).toBe(record.id);
  });

  it('parades only where each class has water under it', () => {
    const deep = npcParade({ x: 0, z: 0, heading: 0 }, () => 30, 'ahead');
    expect(deep).toHaveLength(NPC_RECORDS.length);
    for (const e of deep) expect(e.transform?.position.z).toBeLessThan(0);
    // Six meters: the laker (5.5 m loaded, plus a meter) stays out.
    const shoal = npcParade({ x: 0, z: 0, heading: 0 }, () => 6, 'stop');
    expect(shoal.map((e) => e.npc?.classId)).not.toContain('ship.ore_freighter');
    for (const e of shoal) expect(e.velocity?.z).toBeCloseTo(0);
    const meet = npcParade({ x: 0, z: 0, heading: 0 }, () => 30, 'meet');
    for (const e of meet) expect(e.velocity?.z).toBeGreaterThan(0);
  });
});
