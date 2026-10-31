import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { setFlagsFromString } from 'node:v8';
import { runInNewContext } from 'node:vm';
import { beforeAll, describe, expect, it } from 'vitest';
import { recordZonePose, resolveStart, wrapHeading } from '../src/sim/location';
import { loadZoneTerrain, type LoadedZone } from '../src/sim/terrain/load';
import { edgeDistance, edgeFactor } from '../src/sim/terrain/zone-edge';
import { ZoneManager } from '../src/sim/terrain/zone-manager';
import {
  APOSTLES_ID,
  entryChartPos,
  entryPose,
  findEntry,
  nearestEntry,
  spawnPose,
  ZONE_DEFS,
  zoneDef,
} from '../src/sim/terrain/zones';
import { EDGE_CHIP } from '../src/ui/hud/model';
import { createWorldState } from '../src/sim/world-state';

const dir = join(__dirname, '..', 'public', 'world', 'apostles');
const baked =
  existsSync(join(dir, 'manifest.json')) &&
  readFileSync(join(dir, 'height', '0-0.bin')).byteLength > 200;
const readApostles = async (): Promise<LoadedZone> =>
  loadZoneTerrain(async (path) => new Uint8Array(readFileSync(join(dir, path))));

/** A fake zone: the manager only holds it, so any object will do. */
const fakeZone = (id: string): LoadedZone => ({ id }) as unknown as LoadedZone;

describe('zone manager', () => {
  const setup = (keepMs = 1000) => {
    const clock = { t: 0 };
    const loaded: string[] = [];
    const freed: string[] = [];
    const manager = new ZoneManager({
      load: async (id) => {
        loaded.push(id);
        return fakeZone(id);
      },
      keepMs,
      now: () => clock.t,
      onFree: (id) => freed.push(id),
    });
    return { clock, loaded, freed, manager };
  };

  it('loads a zone by id and keeps it while the player is in it', async () => {
    const { manager, loaded } = setup();
    const a = await manager.enter('zone.a');
    expect(manager.current?.id).toBe('zone.a');
    expect(await manager.enter('zone.a')).toBe(a);
    expect(loaded).toEqual(['zone.a']);
  });

  it('keeps the zone just left cached for a quick turn back, then frees it', async () => {
    const { manager, loaded, freed, clock } = setup(1000);
    const a = await manager.enter('zone.a');
    manager.leave();
    expect(manager.current).toBeUndefined();
    expect(manager.isWarm('zone.a')).toBe(true);
    clock.t = 999;
    manager.sweep();
    expect(await manager.enter('zone.a')).toBe(a);
    expect(loaded).toEqual(['zone.a']);
    expect(manager.stats.cacheHits).toBe(1);
    manager.leave();
    clock.t = 999 + 1000;
    manager.sweep();
    expect(freed).toEqual(['zone.a']);
    expect(manager.isWarm('zone.a')).toBe(false);
    await manager.enter('zone.a');
    expect(loaded).toEqual(['zone.a', 'zone.a']);
  });

  it('frees the cached zone before loading another, so one is resident at a time', async () => {
    const { manager, freed } = setup(60_000);
    let resident = 0;
    let most = 0;
    const counting = new ZoneManager({
      load: async (id) => {
        most = Math.max(most, ++resident);
        return fakeZone(id);
      },
      onFree: () => resident--,
    });
    await counting.enter('zone.a');
    await counting.enter('zone.b');
    await counting.enter('zone.a');
    expect(most).toBe(1);
    await manager.enter('zone.a');
    await manager.enter('zone.b');
    expect(freed).toEqual(['zone.a']);
    expect(manager.stats).toMatchObject({ current: 'zone.b', cached: undefined });
  });

  it('has no current zone when one fails to load, and can try again', async () => {
    let fail = true;
    const manager = new ZoneManager({
      load: async (id) => {
        if (fail) throw new Error('offline');
        return fakeZone(id);
      },
    });
    await expect(manager.enter('zone.a')).rejects.toThrow('offline');
    expect(manager.current).toBeUndefined();
    fail = false;
    await manager.enter('zone.a');
    expect(manager.current?.id).toBe('zone.a');
  });

  it('lets the later of two overlapping loads win', async () => {
    const manager = new ZoneManager({ load: async (id) => fakeZone(id) });
    const first = manager.enter('zone.a');
    const second = manager.enter('zone.b');
    await Promise.all([first, second]);
    expect(manager.current?.id).toBe('zone.b');
  });
});

describe('zone entry points', () => {
  it('every zone has entries with unique ids', () => {
    for (const def of ZONE_DEFS) {
      expect(def.entries.length).toBeGreaterThan(0);
      const ids = def.entries.map((e) => e.id);
      expect(new Set(ids).size).toBe(ids.length);
    }
  });

  it('finds an entry by id or short name, and the nearest to a chart point', () => {
    const def = zoneDef(APOSTLES_ID);
    expect(findEntry(def, 'west')?.id).toBe('entry.apostles_west');
    expect(findEntry(def, 'entry.apostles_east')?.id).toBe('entry.apostles_east');
    expect(findEntry(def, 'nowhere')).toBeUndefined();
    for (const entry of def.entries) {
      const at = entryChartPos(def, entry);
      // 5 km out on the chart beyond the entry, heading away from the zone.
      const h = entry.headingDeg * (Math.PI / 180);
      const out = { x: at.x - Math.sin(h) * 5000, y: at.y + Math.cos(h) * 5000 };
      expect(nearestEntry(def, out).id).toBe(entry.id);
    }
  });

  describe.skipIf(!baked)('on the baked Apostles', () => {
    let zone: LoadedZone;
    beforeAll(async () => {
      zone = await readApostles();
    });

    it('sit in deep water inside the fog fade, with a clear run in', () => {
      const def = zoneDef(APOSTLES_ID);
      const t = zone.terrain;
      for (const entry of def.entries) {
        const label = entry.id;
        const d = edgeDistance(t.bounds, entry.x, entry.z);
        // In the fog, but short of the "Zone edge" chip, so arriving doesn't offer to leave.
        expect(d, label).toBeLessThan(def.edge.fogFadeM);
        expect(edgeFactor(t.bounds, def.edge, entry.x, entry.z), label).toBeLessThan(EDGE_CHIP);
        // The heading points into the zone: a kilometre on is farther from the edge.
        const { x, z, heading } = entryPose(entry);
        const on = { x: x + Math.sin(heading) * 1000, z: z - Math.cos(heading) * 1000 };
        expect(edgeDistance(t.bounds, on.x, on.z), label).toBeGreaterThan(d + 900);
        // 1.5 km of water at least 6 m deep straight ahead, four times the schooner's draft.
        for (let s = 0; s <= 1500; s += 20) {
          const px = x + Math.sin(heading) * s;
          const pz = z - Math.cos(heading) * s;
          expect(t.depthAt(px, pz), `${label} at ${s} m`).toBeGreaterThan(6);
        }
      }
    });
  });
});

describe('the player location', () => {
  it('a new run starts at the Apostles spawn', () => {
    const state = createWorldState('seed');
    expect(resolveStart(state.player.location)).toEqual({
      zoneId: APOSTLES_ID,
      pose: spawnPose(zoneDef(APOSTLES_ID)),
      from: 'spawn',
    });
  });

  it('comes back to the saved pose, wrapping the heading', () => {
    const state = createWorldState('seed');
    recordZonePose(state, APOSTLES_ID, { x: 120, z: -40, heading: -Math.PI / 2 });
    expect(resolveStart(state.player.location)).toEqual({
      zoneId: APOSTLES_ID,
      pose: { x: 120, z: -40, heading: (3 * Math.PI) / 2 },
      from: 'saved',
    });
    expect(wrapHeading(5 * Math.PI)).toBeCloseTo(Math.PI);
  });

  it('falls back to the Apostles spawn for a zone the data no longer has', () => {
    const start = resolveStart({
      mode: 'zone',
      zoneId: 'zone.atlantis',
      pose: { x: 1, z: 2, heading: 0 },
    });
    expect(start).toMatchObject({ zoneId: APOSTLES_ID, from: 'spawn' });
  });

  it('comes in from the chart at the entry nearest the chart position', () => {
    const def = zoneDef(APOSTLES_ID);
    const east = findEntry(def, 'east');
    if (!east) throw new Error('no east entry');
    const at = entryChartPos(def, east);
    const start = resolveStart({
      mode: 'chart',
      chartPos: { x: at.x + 8000, y: at.y },
      heading: 0,
    });
    expect(start).toEqual({ zoneId: APOSTLES_ID, pose: entryPose(east), from: 'entry' });
  });
});

/**
 * Exit criterion 9's round trip (plan 03 §20.3) at the data level: entering another zone
 * and coming back leaves the memory within 20 MB of where it started. The scene's meshes
 * and the tile worker are checked in the browser, with the heap in the dev overlay.
 */
describe.skipIf(!baked)('memory round trip on the real zone', () => {
  setFlagsFromString('--expose-gc');
  const gc = runInNewContext('gc') as () => void;
  const used = async (): Promise<number> => {
    // Let the finished loads' promise chains go before collecting.
    await new Promise((resolve) => setTimeout(resolve, 0));
    gc();
    gc();
    const m = process.memoryUsage();
    return (m.heapUsed + m.arrayBuffers) / 1e6;
  };

  it('frees a zone left behind once another is entered or the cache expires', async () => {
    const clock = { t: 0 };
    // Two ids over the same files stand in for a second zone until piece C bakes one.
    const manager = new ZoneManager({ load: readApostles, keepMs: 60_000, now: () => clock.t });
    const before = await used();
    await manager.enter('zone.a');
    const one = await used();
    // The Apostles decoded is about 50 MB; the test means nothing if it isn't held.
    expect(one - before).toBeGreaterThan(30);
    await manager.enter('zone.b');
    // Never two resident: zone.a went before zone.b was decoded.
    expect((await used()) - before).toBeLessThan(one - before + 20);
    await manager.enter('zone.a');
    manager.leave();
    clock.t = 60_000;
    manager.sweep();
    expect(manager.stats).toMatchObject({ current: undefined, cached: undefined });
    expect((await used()) - before).toBeLessThan(20);
  }, 30_000);
});
