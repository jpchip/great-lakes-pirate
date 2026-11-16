import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import bayfieldJson from '../data/districts/bayfield.json';
import { buildDistrict, type DistrictModel } from '../src/gameplay/district/district';
import { DistrictNav } from '../src/gameplay/district/district-nav';
import { decodeGround } from '../src/gameplay/district/ground';
import { CROWD_PER_MARK, CROWD_RADIUS_M, createCrowd } from '../src/gameplay/onfoot/crowd';
import { createCharacter } from '../src/gameplay/onfoot/controller';
import { createWatch } from '../src/gameplay/onfoot/watch';
import { NavMesh, type NavMeshData } from '../src/sim/district/navmesh';
import { parseLayout } from '../src/sim/district/layout';

/**
 * Bayfield's daytime crowd (0.7.1): townsfolk and dockhands about the crowd marks by day,
 * walking the navmesh, gone at night, and never in the watch's stealth layer.
 */

const dir = join(import.meta.dirname, '..', 'public', 'districts', 'bayfield');
const groundPath = join(dir, 'ground.bin');
const baked = existsSync(groundPath) && readFileSync(groundPath).byteLength > 200;

/** Noon and 11 p.m. on a June day. */
const NOON = 160 * 86400 + 12 * 3600;
const NIGHT = 160 * 86400 + 23 * 3600;

function load(): { model: DistrictModel; nav: DistrictNav } {
  const model = buildDistrict(
    parseLayout(structuredClone(bayfieldJson)),
    decodeGround(new Uint8Array(readFileSync(groundPath))),
  );
  const mesh = new NavMesh(
    JSON.parse(readFileSync(join(dir, 'navmesh.json'), 'utf8')) as NavMeshData,
  );
  return { model, nav: new DistrictNav(mesh, (x, z) => model.floorAt(x, z)) };
}

describe.skipIf(!baked)('the daytime crowd in Bayfield (0.7.1)', () => {
  it('has three walkers at each crowd mark, on ground a person can stand', () => {
    const { model, nav } = load();
    const crowd = createCrowd(model, nav, 'crowd-test');
    const marks = model.marks.filter((m) => m.kind === 'crowd');
    expect(marks.length).toBeGreaterThan(0);
    expect(crowd?.count).toBe(marks.length * CROWD_PER_MARK);
    for (const f of crowd?.figures(NOON) ?? []) {
      expect(nav.walkable({ x: f.x, z: f.z }), f.id).toBe(true);
      expect(['npc.townsman', 'npc.dockhand']).toContain(f.type);
    }
  });

  it('strolls about its mark and keeps near it', () => {
    const { model, nav } = load();
    const crowd = createCrowd(model, nav, 'crowd-walk');
    if (!crowd) throw new Error('no crowd');
    const start = crowd.figures(NOON).map((f) => ({ x: f.x, z: f.z }));
    let moved = 0;
    for (let t = 0; t < 60 * 90; t++) {
      crowd.step(1 / 60);
      if (t % 600 === 0) {
        const now = crowd.figures(NOON);
        now.forEach((f, i) => {
          if (Math.hypot(f.x - (start[i]?.x ?? 0), f.z - (start[i]?.z ?? 0)) > 1) moved++;
        });
      }
    }
    const now = crowd.figures(NOON);
    expect(moved).toBeGreaterThan(0);
    for (const f of now) {
      const mark = model.marks.find((m) => f.id.startsWith(`crowd:${m.id}:`));
      expect(mark, f.id).toBeDefined();
      if (!mark) continue;
      expect(Math.hypot(f.x - mark.x, f.z - mark.z), f.id).toBeLessThanOrEqual(CROWD_RADIUS_M + 2);
    }
  });

  it('is out by day and gone at night', () => {
    const { model, nav } = load();
    const crowd = createCrowd(model, nav, 'crowd-time');
    expect(crowd?.figures(NOON).length).toBeGreaterThan(0);
    expect(crowd?.figures(NIGHT)).toEqual([]);
  });

  it('is scenery: no guard in the watch perceives it', () => {
    const { model, nav } = load();
    const watch = createWatch({
      model,
      nav,
      tier: 0,
      seed: 'crowd-watch',
      conditions: () => ({
        gameSeconds: NOON,
        cloud01: 0,
        fogM: 20_000,
        rain01: 0,
        wantedTier: 0,
        fame01: 0.2,
      }),
      onCaptured: () => undefined,
    });
    const me = createCharacter({ x: 0, y: model.floorAt(0, 0), z: 0 });
    for (let t = 0; t < 600; t++) watch.step(1 / 60, me);
    expect(watch.crowd().length).toBeGreaterThan(0);
    expect(watch.stealth.guards.some((g) => g.id.startsWith('crowd:'))).toBe(false);
  });
});
